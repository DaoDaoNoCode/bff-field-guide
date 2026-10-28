# The Reconcile Pipeline

> One function, called over and over, that drives the whole dashboard. This is where the CRD's `spec` becomes running pods.

`Reconcile` is the heart of the operator. The framework calls it every time the `Dashboard` CR changes, every time an owned resource changes, and periodically for good measure. Your job is to make it **idempotent**: calling it once or a hundred times with the same input must produce the same cluster state.

::: tip The React `render` Mental Model — For Real This Time
`Reconcile(ctx, req)` is `render(props)`. It reads the current desired state (`spec`, the props), computes what the cluster should look like, and applies the difference. Like `render`, it must be a pure-ish function of its input: no "I already did this last time" shortcuts, no side effects that don't converge. React can call `render` whenever it wants; controller-runtime can call `Reconcile` whenever *it* wants. Write it to survive that.
:::

The pipeline lives in `dashboard-operator/internal/controller/dashboard_controller.go` (`Reconcile` starts around L158). It's a linear sequence with strict ordering — each step depends on the ones before it.

## The Pipeline at a Glance

```
 1. Fetch the Dashboard CR                    ← r.Get; 404 → done
 2. Handle deletion (finalizer cleanup)       ← MaaS Portal first, then cross-namespace
 3. Add finalizer (first reconcile only)      ← then return, re-reconcile
 4. Migrate legacy MaaS Portal status         ← migrateMaaSPortalStatus
 5. Create the conditions manager             ← Ready rolls up 4 conditions
 6. Auto-detect observability (Perses)
 7. Handle managementState: Removed           ← teardown, keep the CR (and the portal)
 8. Read inputs (ConfigMaps, via APIReader)   ← operator config + distribution config
 9. reconcileDeployment                       ← the big one, see below
10. Set release status
11. Compute overall phase                     ← from condition happiness
12. updateStatusIfChanged                     ← writes only on a semantic diff
```

Steps 1–3 are lifecycle gates. Steps 4–8 prepare state and gather inputs. Step 9 does the work. Steps 10–12 record the outcome. Inside step 9:

```
reconcileDeployment
  ├─ cleanupLegacyResources        ← delete leftovers of the old sidecar layout
  ├─ render kustomize              ← manifests/ base + /odh or /rhoai source path
  ├─ remap Ray + DCH gateway RBAC
  ├─ sanitizeDeploymentProbes      ← SSA probe quirk
  ├─ removeStaleContainers
  ├─ SSA deploy                    ← main Deployment, Services, RBAC, ...
  ├─ OdhDashboardConfig defaults
  ├─ reconcileModuleDemand         ← resolve → deploy modules → delete disabled → readiness
  ├─ namespaced RBAC               ← notebooksNamespace / modelRegistryNamespace
  ├─ observability (Perses)
  ├─ deployFederationConfigMap
  ├─ reconcileMaaSPortalOperand
  ├─ patchDeploymentFederationHash ← rolling restart when federation changes
  ├─ reconcileURL
  └─ degraded condition
```

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
        cleanup, err := r.deleteMaaSPortalResources(ctx) // the portal goes first
        if err != nil {
            return ctrl.Result{}, err
        }
        if cleanup.Pending {
            return ctrl.Result{RequeueAfter: maasPortalRetryInterval}, nil // come back in 1m
        }
        // namespaced RBAC, Ray + DCH gateway RBAC, observability
        r.cleanupCrossNamespaceResources(ctx, dashboard, false)
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

The finalizer is `components.platform.opendatahub.io/cleanup`.

::: warning Why Step 3 Returns Early
Adding the finalizer and *then returning* looks wasteful — why not keep going? Because if the operator crashed between "create resources" and "persist finalizer," you'd have orphaned resources with no finalizer to trigger their cleanup. Persisting the finalizer first, in its own reconcile cycle, closes that race. The `Update` itself triggers the next cycle, so nothing is lost — just deferred by milliseconds.
:::

## Steps 4–6: Prepare before branching

Before it looks at `managementState`, the reconciler does three things that apply in every state:

- **`migrateMaaSPortalStatus`** backfills `maasPortalUrl` from the legacy `maasConsumerPortalUrl` and drops the old `MaaSConsumerPortalAvailable` condition, so old CRs read the same as new ones.
- **The conditions manager** is built with `Ready` as a rollup of `ProvisioningSucceeded`, `Degraded`, `ObservabilityAvailable` and `MaaSPortalAvailable`. It is built this early because the MaaS Portal is reconciled even when the core dashboard is `Removed`.
- **`autoDetectObservability`** looks for a Perses install and fills in `spec.observability` in memory if the admin didn't. A detection failure keeps existing observability resources instead of tearing them down.

## Step 7: `Removed` is a soft delete

`managementState: Removed` is **not** deletion. The CR stays in the cluster with all its config and status history; the core dashboard's resources are torn down. Two things survive, because the MaaS Portal may still need them:

```go
if dashboard.Spec.ManagementState == "Removed" {
    // maas and genAi stay up if a Managed MaaS Portal requires them
    nextStatuses, err := r.reconcileModuleDemand(ctx, dashboard)
    dashboard.Status.ModuleStatuses = nextStatuses

    portalRetryAfter := r.reconcileMaaSPortalOperand(ctx, dashboard, cm, nextStatuses, ...)

    preserveObservability := maasPortalManaged && /* observability enabled or unknown */
    r.teardownManagedResources(ctx, dashboard, nextStatuses, preserveObservability)

    dashboard.Status.URL = ""
    dashboard.Status.Distribution = nil
    cm.MarkFalse("ProvisioningSucceeded", conditions.WithReason("Removed"), conditions.WithSeverity(Info))
    if portal == nil || portal.ManagementState != "Managed" {
        cm.MarkFalse("Ready", conditions.WithReason("Removed"))
    }
    // Phase can still be Ready if the portal is Managed and healthy.
    return ctrl.Result{RequeueAfter: portalRetryAfter}, r.updateStatusIfChanged(...)
}
```

Note that `moduleStatuses` is **not** cleared: it reports which modules the portal is keeping alive (the others show `NotDeployed` / `NotRequired`). Flip `managementState` back to `Managed` and the next reconcile redeploys everything. Useful for temporarily parking the dashboard without losing its configuration.

| | `managementState: Removed` | `kubectl delete dashboard` |
|---|---|---|
| The CR | **stays** | removed |
| Deployed resources | torn down | torn down (via finalizer) |
| Config & status history | preserved | gone |
| To restore | set `Managed` | recreate the CR |

## Step 8: Gather inputs, never block

Two ConfigMaps, both read live through the `APIReader` (ConfigMaps are never cached; see [Controller-Runtime](./controller-runtime#the-cache-is-scoped-on-purpose)):

```go
cfg := readOperatorConfig(ctx, r.apiReader(), r.Namespace)

distributionConfig, distErr := readDistributionConfig(ctx, r.apiReader(), r.Namespace)
if distErr != nil {
    logger.Error(distErr, "Failed to read distribution config, preserving last-known-good value ...")
} else {
    dashboard.Status.Distribution = distributionConfig.Distribution
}
platformVersion := distributionConfig.PlatformVersion
```

| ConfigMap | Where it comes from | What it carries |
|---|---|---|
| `dashboard-operator-config` | optional, created by an admin | `reconcileInterval` (minimum 5s) |
| `odh-dashboard-config` (name overridable with `OPERATOR_CONFIGMAP_NAME`) | the operator's Helm chart | distribution name and version (annotations override), `platformVersion` |

A missing or malformed operator config returns **zero-value defaults** — it never errors out and blocks reconciliation. A read error on the distribution ConfigMap is logged and the last-known-good `status.distribution` is kept. This is defensive operator design: optional inputs degrade gracefully instead of wedging the loop.

## Step 9: One topology, a Deployment per module

`reconcileDeployment` first renders **one** kustomize manifest set: the `manifests/` base plus the platform source path (`/odh` or `/rhoai`). That produces the main pod, which always has three containers:

```
Pod: odh-dashboard (rhods-dashboard on RHOAI)
├── odh-dashboard     (Fastify frontend + backend, :8080)
├── kube-rbac-proxy   (auth proxy, :8443)
└── core-bff          (Go platform BFF, :8943)
```

The core-bff container and how it differs per distribution are covered in [Core BFF Across Distributions](/guide/core-bff/distributions).

Before the SSA apply, `cleanupLegacyResources` deletes what the old sidecar layout left behind (`sidecar-params`, the `odh-dashboard-modules` ServiceAccount and ClusterRole, ...), `sanitizeDeploymentProbes` fixes an SSA probe quirk (see [Modules & Federation](./modules-and-federation)), and `removeStaleContainers` patches out containers that live Deployments still have but the desired manifests no longer list (for example, module containers from the sidecar days, still owned by an old SSA field manager).

Then the modules. Each enabled module is its **own** Deployment, Service, ServiceAccount, NetworkPolicy and RBAC, named `odh-dashboard-<slug>-ui`:

```
Pod: odh-dashboard-gen-ai-ui          Pod: odh-dashboard-model-registry-ui
└── gen-ai-ui (:8143)                 └── model-registry-ui (:8043)
```

All of that happens in `reconcileModuleDemand` (`module_deploy.go`):

```go
func (r *DashboardReconciler) reconcileModuleDemand(ctx context.Context, dashboard *v1alpha1.Dashboard) (map[string]v1alpha1.ModuleStatus, error) {
    statuses := resolveModuleStatuses(&dashboard.Spec)            // three-pass resolution
    if err := r.deployModuleManifests(ctx, dashboard, statuses); err != nil { // manifests/modules/<slug>/
        return nil, err
    }
    if err := r.deleteModuleResources(ctx, statuses); err != nil {  // GC disabled modules
        return nil, err
    }
    r.overlayStandaloneReadiness(ctx, statuses)                    // Deployed → Degraded if not Available
    return statuses, nil
}
```

After the modules come namespaced RBAC, observability, the **federation ConfigMap** (which tells the frontend where each module's `remoteEntry.js` and API live), the MaaS Portal operand, and a content-hash annotation that triggers a rolling restart of the main pod. The federation details are the subject of the next page.

::: info There Used to Be Two Modes
Older versions had a `Sidecar` mode (every module BFF as a container in the main pod) and a `Standalone` mode. Sidecar was removed in PR #9392, and with it `spec.deploymentMode`. What was "Standalone" is now simply how the operator works. If you find `reconcileSidecar` in an old branch, that's the history.
:::

## The MaaS Portal operand

The MaaS Portal is a second, independent operand the same controller runs. It is RHOAI-only and is switched on with `spec.maasPortal.managementState: Managed` (which the ODH Operator projects from `dashboard.maasPortal` in the DSC).

- **What it deploys:** a `maas-portal` Deployment rendered from `manifests/distributions/maas-portal`, behind an HTTPRoute on the `data-science-gateway` at `/maas-portal/`. It needs `spec.gateway.domain`; without one the condition reports `MaaSPortalDomainRequired`.
- **Labels:** its resources carry `platform.opendatahub.io/part-of=maas-portal`, not `dashboard`, so core teardown can't prune a portal that's still wanted. That's also why the cache selector allows both values.
- **Dependencies:** it needs the maas and genAi modules. Those carry `RequiredByMaaSPortal: true` in the registry, so they stay deployed even when the core dashboard is `Removed`.
- **Status:** it writes `status.maasPortalUrl` (`https://<domain>/maas-portal/`, mirrored into the deprecated `maasConsumerPortalUrl`) and the `MaaSPortalAvailable` condition, which feeds the `Ready` rollup. The ODH Operator lifts that condition into the DSC.
- **Retries:** while the portal is not ready, it asks for a requeue after 1 minute.
- **Migration:** clusters that ran the older "consumer portal" are moved over by `maas_portal_migration.go` and `maas_portal_compat.go`.

## Steps 9–12: Finish the work, record the outcome

- **URL (end of step 9):** `extractDashboardURL` in `actions.go` returns an empty URL on XKS; `https://<domain>/` when `spec.gateway.domain` is set; otherwise the host of the single admitted Route labelled `part-of=dashboard`. If that Route isn't admitted yet it returns `ErrDashboardRouteNotReady` and the reconciler asks for `RequeueAfter: 10 * time.Second` (never block — see [Controller-Runtime](./controller-runtime)).
- **Module statuses (inside step 9):** the three-pass resolution algorithm decides which modules deploy, disable, or degrade. This is meaty enough to get [its own page](./modules-and-federation).
- **Step 10 — Release status:** records the dashboard version, plus a `platform` entry when `platformVersion` is known, in `status.releases`.
- **Step 11 — Phase:** derived purely from conditions — `cm.IsHappy()` → `PhaseReady`, else `PhaseNotReady`.
- **Step 12 — Persist:** `updateStatusIfChanged` compares the new status with the one read at the start (keeping condition timestamps that didn't really change) and calls `r.Status().Update` only if something differs. Writing the **status subresource** has separate RBAC from the main resource and never touches `spec`; skipping no-op writes avoids an update → watch event → reconcile loop.

## Teardown: how the operator deletes its own work

Both deletion (Step 2) and `Removed` (Step 7) call into teardown, and it's more subtle than "delete the things I made."

### Why owner references aren't enough

The main reason is soft removal: `managementState: Removed` keeps the CR, so owner-reference garbage collection never fires — the operator has to delete things itself. A second reason covers a few extras outside the normal flow, such as the Ray and data-connect-hub gateway RBAC in `openshift-ingress`, the namespaced RBAC in the notebooks and model-registry namespaces, and Perses resources in the monitoring namespace. `cleanupCrossNamespaceResources(ctx, dashboard, preserveObservability)` removes those explicitly. So the operator finds and deletes what it made by **label**:

```go
matchLabels := client.MatchingLabels{
    labels.PlatformPartOf: strings.ToLower(v1alpha1.DashboardKind), // "dashboard"
}
var deployments appsv1.DeploymentList
r.List(ctx, &deployments, matchLabels, inNamespace)
for i := range deployments.Items {
    if isOperatorOwned(operatorResources, "Deployment", deployments.Items[i].Name) ||
        shouldPreserve(&deployments.Items[i]) { // MaaS Portal deps, observability
        continue
    }
    r.Delete(ctx, &deployments.Items[i])
}
```

::: tip Label-Based Discovery Is Robust Against Drift
Rather than remembering a list of what it created, teardown *discovers* resources by their `platform.opendatahub.io/part-of=dashboard` label. Even if a past reconcile crashed halfway and left something behind, teardown still finds and removes it — as long as it carries the label. Set the label on everything you create and cleanup takes care of itself.
:::

### Self-protection: don't delete yourself

Teardown deletes everything labeled `part-of=dashboard` — and the operator's own Helm chart stamps that label on *everything it renders*, including the operator's Deployment, ServiceAccount and RBAC. So those are protected, keyed by kind and name:

```go
func operatorOwnedResources() map[string]bool {
    base := operatorDeploymentName // OPERATOR_DEPLOYMENT_NAME, default "dashboard-operator"
    return map[string]bool{
        "Deployment/" + base:                              true,
        "ServiceAccount/" + operatorServiceAccountName():  true, // OPERATOR_SERVICE_ACCOUNT_NAME
        "Service/" + base + "-webhook":                    true,
        "ConfigMap/" + resolveDistributionConfigMapName(): true, // the chart's odh-dashboard-config
        "ClusterRole/" + base + "-role":                   true,
        "ClusterRoleBinding/" + base + "-rolebinding":     true,
        "NetworkPolicy/" + base + "-metrics":              true,
    }
}
```

Teardown checks each item with `isOperatorOwned(resources, kind, name)`. Keying on kind *and* name means a module ConfigMap that happens to share a name with an operator resource still gets deleted. The names come from env vars the chart sets, so a non-default install doesn't delete itself mid-`Removed`.

### Ordered deletion

Resources are deleted in reverse-dependency order — HTTPRoutes and Deployments first (stop traffic and workloads), then Services, ConfigMaps, ServiceAccounts, Secrets, NetworkPolicies, Roles/RoleBindings, ClusterRoles/Bindings, and the ConsoleLink last. This avoids cascading errors like deleting a ServiceAccount while pods still reference it.

### The `extractItems` type switch

One Go wrinkle worth seeing. Each typed list (`*appsv1.DeploymentList`, `*corev1.ServiceList`, ...) has an `Items` field, but there's no shared interface exposing it. So a type switch converts each into `[]client.Object`:

```go
func extractItems(list client.ObjectList) []client.Object {
    switch l := list.(type) {
    case *appsv1.DeploymentList:
        items := make([]client.Object, len(l.Items))
        for i := range l.Items {
            items[i] = &l.Items[i]
        }
        return items
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
- [ ] Which three containers run in the main pod, and where does each module BFF run?
- [ ] Why do maas and genAi survive `managementState: Removed` when the MaaS Portal is Managed?
- [ ] Why doesn't owner-reference GC cover `Removed`, and what does teardown use instead?
- [ ] Why must teardown protect the operator's own resource names?

</div>

::: info What's Next
Next: **[Modules & Federation](./modules-and-federation)** — the module registry, the three-pass resolution algorithm that `reconcileModuleDemand` runs, and how the federation ConfigMap and its content hash drive rolling restarts.
:::

::: info See Also
- [Part 4: Controller Concepts](/guide/kubernetes/controller-concepts) — finalizers, owner references, GC, and the status subresource
- [The CRD](./the-crd) — `managementState`, `maasPortal`, and the spec this pipeline reads
- [Build & Deploy the Operator](/tutorials/build-and-deploy-operator) — watch these steps run against a real cluster
:::
