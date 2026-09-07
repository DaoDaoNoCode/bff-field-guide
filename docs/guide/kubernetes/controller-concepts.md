# Controller Concepts

> **What makes the loop correct** -- finalizers, owner references, Server-Side Apply, and the status subresource. Master these four and the reconciler stops being mysterious.

The [reconcile loop](/guide/kubernetes/) reduces to "make actual state match desired state, forever." This page covers the four Kubernetes mechanisms that make that loop *safe*: it cleans up after itself, it doesn't leak resources, it doesn't fight other controllers, and it reports honest status. It ends with the practical question you'll hit immediately: why does the operator use a *different* Kubernetes client library than the BFF?

## 1. Finalizers: Cleanup Before Deletion

Normally, `kubectl delete` removes a resource immediately. But sometimes a controller needs to run cleanup *first* -- and a **finalizer** is how it buys that time.

A finalizer is just a string in `metadata.finalizers`. The rule Kubernetes enforces: **a resource with any finalizer cannot be fully deleted.** When you delete it, Kubernetes sets `metadata.deletionTimestamp` (marking it "terminating") but keeps the object alive until every finalizer is removed. The controller notices the timestamp, does its cleanup, removes its finalizer, and *then* Kubernetes completes the delete.

```go
const dashboardFinalizer = "components.platform.opendatahub.io/cleanup"

// Inside Reconcile:
if !dashboard.DeletionTimestamp.IsZero() {                       // Is it being deleted?
    if controllerutil.ContainsFinalizer(dashboard, dashboardFinalizer) {
        if err := r.cleanupCrossNamespaceResources(ctx, dashboard); err != nil {
            return ctrl.Result{}, fmt.Errorf("cleanup failed: %w", err)  // Keep the finalizer, retry
        }
        controllerutil.RemoveFinalizer(dashboard, dashboardFinalizer)    // Cleanup done -> release
        if err := r.Update(ctx, dashboard); err != nil {
            return ctrl.Result{}, err
        }
    }
    return ctrl.Result{}, nil                                   // Now K8s can finish deleting
}

// First reconcile after creation: register the finalizer so future deletes wait for us
if !controllerutil.ContainsFinalizer(dashboard, dashboardFinalizer) {
    controllerutil.AddFinalizer(dashboard, dashboardFinalizer)
    if err := r.Update(ctx, dashboard); err != nil {
        return ctrl.Result{}, err
    }
    return ctrl.Result{}, nil                                   // Re-reconcile immediately
}
```

::: tip The React Anchor
A finalizer is a `useEffect` cleanup function -- but enforced by the platform. `return () => cleanup()` runs before React tears the component down; a finalizer runs before Kubernetes tears the resource down. The difference: Kubernetes *will not proceed* until your cleanup succeeds and you signal completion by removing the finalizer.
:::

**Why the dashboard needs one:** the operator creates some resources in *other* namespaces (observability resources in the observability namespace, Gateway RBAC in `openshift-ingress`). As you'll see next, automatic garbage collection only reaches *same-namespace* children. Without a finalizer, deleting the `Dashboard` CR would orphan those cross-namespace resources. `cleanupCrossNamespaceResources` deletes them explicitly before the finalizer is removed.

## 2. Owner References & Garbage Collection

When the operator creates a Deployment, Service, or ConfigMap, it stamps an **owner reference** on it pointing back to the `Dashboard` CR. That reference tells Kubernetes: "if the owner is deleted, delete this too."

```go
deployer := deploy.NewDeployer(
    deploy.WithFieldOwner("dashboard-operator"),
    deploy.WithLabel(labels.PlatformPartOf, strings.ToLower(v1alpha1.DashboardKind)),
)

err := deployer.Deploy(ctx, deploy.DeployInput{
    Client:    r.Client,
    Owner:     dashboard,   // <-- every created resource gets an ownerRef to the Dashboard CR
    Resources: allResources,
})
```

Delete the `Dashboard`, and Kubernetes **cascade-deletes** every resource that references it -- automatically, no controller code required.

::: warning The Catch: Garbage Collection Is Same-Namespace
Automatic cascade deletion works for children *in the same namespace* as the owner (or for cluster-scoped owners with cluster-scoped children). It does **not** cross namespaces. That single limitation is the entire reason the finalizer above exists -- owner references handle the common case, the finalizer handles the exceptions.
:::

## 3. Server-Side Apply & Field Ownership

The old way (`kubectl apply`, client-side) computes a diff on the client and PATCHes it. **Server-Side Apply (SSA)** moves that to the API server and adds **field ownership**: every field records *which manager* set it.

```go
deployer := deploy.NewDeployer(
    deploy.WithFieldOwner("dashboard-operator"),   // "I own the fields I set"
    deploy.WithMergeStrategy(deploymentGVK, deploy.MergeDeployments),
)
```

Why this matters: more than one controller may touch the same object. The dashboard operator manages a Deployment; a service mesh might inject a sidecar container into the *same* Deployment. With field ownership, Kubernetes tracks that the operator owns the app container while the mesh owns the sidecar -- so the operator's next apply doesn't wipe the sidecar, and a conflicting write is *detected* instead of silently clobbered.

::: tip The Anchor
Client-side apply is last-write-wins, like two people saving the same doc and one silently losing their edits. SSA is closer to a merge with per-field ownership -- like a CRDT or a well-behaved merge tool: each writer owns their fields, and true conflicts are surfaced rather than swallowed.
:::

## 4. The Status Subresource & Conditions

You saw `spec` (desired) and `status` (observed) in the CRD. In Kubernetes, `status` is a **separate subresource** -- updated through a distinct API call and gated by distinct RBAC. That's declared with a marker:

```go
// +kubebuilder:subresource:status
type Dashboard struct { ... }
```

and written with its own call:

```go
if err := r.Status().Update(ctx, dashboard); err != nil {   // NOT r.Update -- this writes .status only
    logger.Error(err, "failed to update status")
}
```

::: info Why Separate?
Splitting `status` out lets RBAC grant `update` on the spec to admins while restricting `update` on `status` to the controller alone. Users can request changes (spec); only the controller reports reality (status). It also prevents an accidental spec write from clobbering status and vice versa.
:::

### Conditions: Structured Health

Rather than a single "ok/error" string, Kubernetes resources report health as an array of **conditions** -- each with a type, a true/false status, a reason, and a message. The Dashboard uses four:

| Condition | Meaning |
|---|---|
| `Ready` | Rollup -- true only when everything is healthy |
| `ProvisioningSucceeded` | Manifests rendered and applied successfully |
| `Degraded` | One or more modules are unhealthy |
| `ObservabilityAvailable` | The observability stack is deployed and functional |

The operator manages these through a conditions manager (from `odh-platform-utilities`). Crucially, `Ready` is **never set by hand** -- it's *derived*:

```go
cm.MarkTrue(string(common.ConditionTypeProvisioningSucceeded),
    conditions.WithReason("ResourcesApplied"))

if cm.IsHappy() {                          // true when all positive conditions hold
    dashboard.Status.Phase = common.PhaseReady   //   and no negative ones are tripped
} else {
    dashboard.Status.Phase = common.PhaseNotReady
}
```

::: tip The Anchor
Conditions are derived state, like a `useMemo` that computes an overall "is this healthy?" boolean from several independent signals. You set the inputs (`ProvisioningSucceeded`, `Degraded`, ...); `Ready` falls out of them. You never write `Ready` directly, the same way you don't manually keep a memoized value in sync -- you let it compute.
:::

## client-go vs controller-runtime

Here's the practical question: the BFF and the operator talk to the *same* Kubernetes API, so why do they use *different* Go libraries?

Because they have different jobs. The BFF makes many short-lived, per-user calls with the *user's* token. The operator makes cached, scheme-aware calls with *its own* service account, inside a long-running control loop.

| Aspect | `client-go` (BFFs) | `controller-runtime` (operator) |
|---|---|---|
| Type safety | Typed for built-ins; dynamic client for CRDs | Typed for *anything* in the scheme (built-in or CRD) |
| Caching | Manual (informers/listers) | Built-in read cache from the manager |
| Auth | Per-request, user token | Manager's kubeconfig / service account |
| Lifecycle | Create a client per request | One client for the manager's lifetime |
| Status update | `clientset...Status().Update()` | `r.Status().Update(ctx, obj)` |
| Used by | BFFs (per-user, fine-grained) | Operator (cached, integrated with the manager) |

```go
// BFF style (client-go): dynamic client, per-user token, for CRDs the BFF reads
dynClient, _ := dynamic.NewForConfig(userScopedConfig)
list, _ := dynClient.Resource(gvr).Namespace(ns).List(ctx, metav1.ListOptions{})

// Operator style (controller-runtime): typed, cached, scheme-aware
dashboard := &v1alpha1.Dashboard{}
_ = r.Get(ctx, req.NamespacedName, dashboard)         // typed Get, served from cache
var pods corev1.PodList
_ = r.List(ctx, &pods, client.InNamespace(ns), client.MatchingLabels{"app": "dashboard"})
```

::: info The Rule of Thumb
Writing a control loop that watches and owns resources with a service account? Use `controller-runtime`. Making per-user API calls in a request handler? Use `client-go`. This isn't a style preference -- each library is built for one of those two jobs.
:::

::: tip Key Takeaway
Four mechanisms keep the loop correct: **finalizers** delay deletion until cleanup runs (needed for cross-namespace resources); **owner references** cascade-delete same-namespace children automatically; **Server-Side Apply** gives each field an owner so controllers don't clobber each other; the **status subresource** with derived **conditions** reports honest, structured health. And the operator uses `controller-runtime` (cached, typed, service-account) while BFFs use `client-go` (per-user, per-request) -- same API, different jobs.
:::

---

<div class="checkpoint">

#### Part 4 Complete

You should now be able to:
- [ ] Explain what a finalizer does and why cross-namespace resources need one
- [ ] Describe how owner references cause cascade deletion -- and their same-namespace limit
- [ ] Explain field ownership in Server-Side Apply and the conflict it prevents
- [ ] Say why `status` is a separate subresource and why `Ready` is derived, not set
- [ ] Choose between `client-go` and `controller-runtime` for a given job

</div>

::: info What's Next
You now have every Kubernetes concept the operator relies on. Time to read the real thing: **[Part 5: The Dashboard Operator](/guide/operator/)** -- where these ideas come together in an actual reconciler.
:::
