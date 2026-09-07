# The Reconcile Pipeline

> One function, called over and over, that drives the whole dashboard. This is where the CRD's `spec` becomes running pods.

`Reconcile` is the heart of the operator. The framework calls it every time the `Dashboard` CR changes, every time an owned resource changes, and periodically for good measure. Your job is to make it **idempotent**: calling it once or a hundred times with the same input must produce the same cluster state.

::: tip The React `render` Mental Model — For Real This Time
`Reconcile(ctx, req)` is `render(props)`. It reads the current desired state (`spec`, the props), computes what the cluster should look like, and applies the difference. Like `render`, it must be a pure-ish function of its input: no "I already did this last time" shortcuts, no side effects that don't converge. React can call `render` whenever it wants; controller-runtime can call `Reconcile` whenever *it* wants. Write it to survive that.
:::

The pipeline lives in `dashboard-operator/internal/controller/dashboard_reconciler.go:90`. It's a linear sequence of 14 steps with strict ordering — each depends on the ones before it.

## The 14 Steps at a Glance

```
 1. Fetch the Dashboard CR                    ← r.Get; 404 → done
 2. Handle deletion (finalizer cleanup)       ← DeletionTimestamp set?
 3. Add finalizer (first reconcile only)      ← then return, re-reconcile
 4. Handle managementState: Removed           ← teardown, keep the CR
 5. Read operator config       (ConfigMap)
 6. Read distribution config   (ConfigMap)
 7. Read platform version      (ConfigMap)
 8. Create the conditions manager
 9. Branch on deployment mode  → Sidecar | Standalone
10.   Extract the dashboard URL
11.   Resolve module statuses  (three-pass algorithm)
12.   Set release status
13.   Compute overall phase    (from condition happiness)
14. Update status subresource                 ← r.Status().Update
```

Steps 1–4 are lifecycle gates. Steps 5–8 gather inputs. Step 9 is the fork in the road. Steps 10–14 do the work and record the outcome. Let's walk the interesting ones.

## Step 1: Fetch — and the 404 idiom

```go
dashboard := &v1alpha1.Dashboard{}
if err := r.Get(ctx, req.NamespacedName, dashboard); err != nil {
    return ctrl.Result{}, client.IgnoreNotFound(err)
}
```

`req` told us *what* changed; now we fetch it. If it's been deleted, `client.IgnoreNotFound` converts the 404 into `nil` — "nothing to reconcile, don't requeue." You'll see this idiom everywhere in operator code.

## Steps 2–3: The finalizer dance

A finalizer is how the operator gets a chance to clean up *before* Kubernetes deletes the CR. (Part 4's [Controller Concepts](/guide/kubernetes/controller-concepts) covers the mechanism; here's how it's used.)

```go
// Step 2: the CR is being deleted (DeletionTimestamp is set, but the
// finalizer keeps it alive until we're done).
if !dashboard.DeletionTimestamp.IsZero() {
    if controllerutil.ContainsFinalizer(dashboard, dashboardFinalizer) {
        r.cleanupCrossNamespaceResources(ctx, dashboard) // owner refs can't reach these
        r.cleanupRayDashboardGatewayRBAC(ctx)
        controllerutil.RemoveFinalizer(dashboard, dashboardFinalizer)
        r.Update(ctx, dashboard) // finalizer gone → API server completes deletion
    }
    return ctrl.Result{}, nil
}

// Step 3: brand-new CR — add the finalizer, then RETURN so it's persisted
// before we create anything.
if !controllerutil.ContainsFinalizer(dashboard, dashboardFinalizer) {
    controllerutil.AddFinalizer(dashboard, dashboardFinalizer)
    r.Update(ctx, dashboard)
    return ctrl.Result{}, nil  // this Update triggers a fresh reconcile
}
```

::: warning Why Step 3 Returns Early
Adding the finalizer and *then returning* looks wasteful — why not keep going? Because if the operator crashed between "create resources" and "persist finalizer," you'd have orphaned resources with no finalizer to trigger their cleanup. Persisting the finalizer first, in its own reconcile cycle, closes that race. The `Update` itself triggers the next cycle, so nothing is lost — just deferred by milliseconds.
:::

## Step 4: `Removed` is a soft delete

`managementState: Removed` is **not** deletion. The CR stays in the cluster with all its config and status history; only the deployed resources (the "operand") are torn down.

```go
if dashboard.Spec.ManagementState == "Removed" {
    r.teardownManagedResources(ctx)              // delete everything we deployed
    r.cleanupCrossNamespaceResources(ctx, dashboard)
    dashboard.Status.URL = ""
    dashboard.Status.ModuleStatuses = nil
    conditionsMgr.MarkFalse("Ready", "Removed", "...")
    dashboard.Status.Phase = common.PhaseNotReady
    return ctrl.Result{}, r.Status().Update(ctx, dashboard)
}
```

Flip `managementState` back to `Managed` and the next reconcile redeploys everything from scratch. Useful for temporarily parking the dashboard without losing its configuration.

| | `managementState: Removed` | `kubectl delete dashboard` |
|---|---|---|
| The CR | **stays** | removed |
| Deployed resources | torn down | torn down (via finalizer) |
| Config & status history | preserved | gone |
| To restore | set `Managed` | recreate the CR |

## Steps 5–8: Gather inputs, never block

Three ConfigMap reads (operator config, distribution identity, platform version) and one conditions-manager setup. The notable design choice:

```go
opConfig := readOperatorConfig(ctx, r.Client, r.Namespace)
```

A missing or malformed ConfigMap returns **zero-value defaults** — it never errors out and blocks reconciliation. This is defensive operator design: optional inputs degrade gracefully instead of wedging the loop.

## Step 9: The fork — Sidecar vs Standalone

```go
func (r *DashboardReconciler) reconcile(ctx context.Context, dashboard *v1alpha1.Dashboard, ...) error {
    switch dashboard.Spec.DeploymentMode {
    case v1alpha1.DeploymentModeSidecar:
        return r.reconcileSidecar(ctx, dashboard, ...)
    default:
        return r.reconcileStandalone(ctx, dashboard, ...)
    }
}
```

This is the biggest branch in the operator. The two modes deploy the *same modules* in fundamentally different topologies.

### Sidecar mode (the default)

Every module BFF runs as a container in **one** pod, next to the frontend and core-bff:

```
Pod: odh-dashboard
├── odh-dashboard       (frontend + backend, :8080)
├── kube-rbac-proxy     (auth proxy, :8443)
├── core-bff            (Go BFF, :8943)
├── gen-ai-ui           (:8143)
├── model-registry-ui   (:8043)
├── maas-ui             (:8243)
└── ... one container per enabled module
```

`reconcileSidecar` (lines 244–358) renders kustomize (base + platform overlay + sidecar overlay), sanitizes probe handlers on live Deployments (an SSA quirk covered on the [Modules & Federation](./modules-and-federation) page), applies everything via SSA, then overlays *container* readiness — marking a module `Degraded` if its container is in `CrashLoopBackOff` or `ImagePullBackOff`.

### Standalone mode

The main pod shrinks to three containers; **each enabled module gets its own Deployment**:

```
Pod: odh-dashboard (core)          Pod: odh-dashboard-gen-ai-ui
├── odh-dashboard                  └── gen-ai-ui
├── kube-rbac-proxy
└── core-bff                       Pod: odh-dashboard-model-registry-ui
                                    └── model-registry-ui
```

`reconcileStandalone` (lines 402–546) additionally: deploys per-module manifests from `manifests/modules/<slug>/`, garbage-collects Deployments for disabled modules, deploys the **federation ConfigMap** (which tells the frontend where each module's `remoteEntry.js` and API live), and patches a content-hash annotation to trigger a rolling restart. All of that is the subject of the next page.

::: info Why Two Modes?
**Sidecar** is simpler networking — one pod, `localhost` between containers — and is the default. **Standalone** lets each module scale and roll out independently, at the cost of a federation ConfigMap and per-module Deployments. Same registry, same resolution logic; only the topology differs.
:::

## Steps 10–14: Do the work, record the outcome

Inside the mode-specific reconciler:

- **Step 10 — URL:** extracted from the Gateway domain or the OpenShift Route. If the Route isn't ready yet, `return ctrl.Result{RequeueAfter: 10 * time.Second}` (never block — see [Controller-Runtime](./controller-runtime)).
- **Step 11 — Module statuses:** the three-pass resolution algorithm decides which modules deploy, disable, or degrade. This is meaty enough to get [its own page](./modules-and-federation).
- **Step 12 — Release status:** records operator + component versions.
- **Step 13 — Phase:** derived purely from conditions — `conditionsMgr.IsHappy()` → `PhaseReady`, else `PhaseNotReady`.
- **Step 14 — Persist:** `r.Status().Update(ctx, dashboard)` writes conditions, phase, URL, and module statuses to the **status subresource** (separate RBAC from the main resource; never touches `spec`).

## Teardown: how the operator deletes its own work

Both deletion (Step 2) and `Removed` (Step 4) call into teardown, and it's more subtle than "delete the things I made" for two reasons.

### Cross-namespace cleanup can't use owner references

Owner references (and their automatic garbage collection) only work within a namespace, or from cluster-scoped to namespaced. But the operator deploys into several namespaces — the app namespace, an observability namespace (Perses dashboards), `openshift-ingress` (Ray gateway RBAC). Resources over there can't point an owner reference back to the Dashboard CR, so the operator finds and deletes them by **label**:

```go
matchLabels := client.MatchingLabels{
    labels.PlatformPartOf: strings.ToLower(v1alpha1.DashboardKind), // "dashboard"
}
var deployments appsv1.DeploymentList
r.List(ctx, &deployments, matchLabels, inNamespace)
for i := range deployments.Items {
    if protected[deployments.Items[i].Name] {
        continue  // never delete the operator's own resources
    }
    r.Delete(ctx, &deployments.Items[i])
}
```

::: tip Label-Based Discovery Is Robust Against Drift
Rather than remembering a list of what it created, teardown *discovers* resources by their `platform.opendatahub.io/part-of=dashboard` label. Even if a past reconcile crashed halfway and left something behind, teardown still finds and removes it — as long as it carries the label. Set the label on everything you create and cleanup takes care of itself.
:::

### Self-protection: don't delete yourself

Teardown deletes everything labeled `part-of=dashboard` — which *includes the operator's own Deployment, ServiceAccount, and RBAC*. So those names are protected:

```go
func operatorOwnedResourceNames() map[string]bool {
    return map[string]bool{
        operatorDeploymentName:                  true,
        operatorDeploymentName + "-sa":          true,
        operatorDeploymentName + "-role":        true,
        operatorDeploymentName + "-rolebinding": true,
    }
}
```

Skip those during teardown, or the operator would delete itself mid-`Removed` and never finish the reconcile.

### Ordered deletion

Resources are deleted in reverse-dependency order — Deployments first (stop workloads), then Services, ConfigMaps/Secrets, ServiceAccounts, NetworkPolicies, ClusterRoles/Bindings, PDBs last. This avoids cascading errors like deleting a ServiceAccount while pods still reference it.

### The `extractItems` type switch

One Go wrinkle worth seeing. Each typed list (`*appsv1.DeploymentList`, `*corev1.ServiceList`, ...) has an `Items` field, but there's no shared interface exposing it. So a type switch converts each into `[]client.Object`:

```go
func extractItems(list client.ObjectList) ([]client.Object, error) {
    switch l := list.(type) {
    case *appsv1.DeploymentList:
        items := make([]client.Object, len(l.Items))
        for i := range l.Items {
            items[i] = &l.Items[i]
        }
        return items, nil
    case *corev1.ServiceList:
        // ... same shape, different type
    }
}
```

::: info Why a Type Switch and Not Generics?
You might reach for generics here. The catch: Go generics can't yet abstract over "any struct with an `Items []T` field" — there's no way to name that constraint. The type switch is the idiomatic solution the Kubernetes ecosystem settled on. (This shows up in the [Gotchas](/reference/gotchas) list.)
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] What does "idempotent" mean for `Reconcile`, and why is it non-negotiable?
- [ ] Why does the finalizer step (3) return early instead of continuing?
- [ ] How does `managementState: Removed` differ from `kubectl delete dashboard`?
- [ ] What's the core difference between Sidecar and Standalone topology?
- [ ] Why can't cross-namespace cleanup use owner references, and what does it use instead?
- [ ] Why must teardown protect the operator's own resource names?

</div>

::: info What's Next
Next: **[Modules & Federation](./modules-and-federation)** — the module registry, the three-pass resolution algorithm that Step 11 runs, and how the federation ConfigMap and its content hash drive rolling restarts.
:::

::: info See Also
- [Part 4: Controller Concepts](/guide/kubernetes/controller-concepts) — finalizers, owner references, GC, and the status subresource
- [The CRD](./the-crd) — `managementState`, `deploymentMode`, and the spec this pipeline reads
- [Build & Deploy the Operator](/tutorials/build-and-deploy-operator) — watch these steps run against a real cluster
:::
