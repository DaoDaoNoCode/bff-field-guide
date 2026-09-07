# Controller-Runtime: The Four Pillars

> Every Go operator is built from the same four building blocks. Learn them once here, and the dashboard-operator's `main.go` reads like a checklist.

The dashboard-operator is built on **controller-runtime** (`sigs.k8s.io/controller-runtime`), the same library nearly every Kubernetes operator in the ecosystem uses. It hides the low-level informer/lister/work-queue machinery so you write business logic, not plumbing.

Think of controller-runtime the way you think of Express or Fastify: a framework that owns the event loop and calls *your* handler when something happens. In a BFF, the "something" is an HTTP request. In an operator, it's a change to a Kubernetes resource.

## The Four Pillars

Everything reduces to four concepts. Hold these four in your head and the rest is detail.

```
┌─────────────────────────────────────────────────────────────┐
│  Manager   ── owns the process: client, cache, leader        │
│               election, metrics & health servers             │
│                                                              │
│    ├── Scheme      ── maps Go types  ⇄  Kubernetes GVKs      │
│    │                                                         │
│    └── Controller  ── connects watches → a work queue        │
│           │                                                  │
│           └── Reconciler ── YOUR CODE. Reconcile(ctx, req)   │
└─────────────────────────────────────────────────────────────┘
```

| Pillar | One-liner | Frontend analogy |
|---|---|---|
| **Scheme** | A registry mapping Go structs to Kubernetes Group-Version-Kind (GVK) | A type registry / serializer config that tells JSON how to (de)serialize a class |
| **Manager** | The top-level process orchestrator you create once | Your Express `app` — owns the server, middleware, config |
| **Controller** | Wires watch events to a work queue; calls your reconciler | The router — maps incoming events to a handler |
| **Reconciler** | Your business logic: one `Reconcile` method | The route handler |

::: info You Rarely Touch the Controller Directly
Of the four, you write the **Reconciler**, configure the **Manager**, populate the **Scheme**, and let `ctrl.NewControllerManagedBy(mgr)` build the **Controller** for you. So really there are three things you author and one the framework hands you.
:::

## Pillar 1: The Scheme

A Scheme answers one question: *when my code says `&v1alpha1.Dashboard{}`, what Kubernetes GVK does that correspond to?* Without it, the client can't serialize your custom type to send to the API server, or deserialize what comes back.

Every type the operator touches must be registered before the Manager starts. The dashboard-operator does this in an `init()` function so it runs before `main()`.

From `dashboard-operator/cmd/manager/main.go:28`:

```go
var scheme = runtime.NewScheme()

func init() {
    // init() runs before main(), so the Scheme is fully populated
    // by the time we build the Manager.
    utilruntime.Must(clientgoscheme.AddToScheme(scheme))    // Pod, Deployment, Service, ConfigMap...
    utilruntime.Must(v1alpha1.AddToScheme(scheme))          // our Dashboard CRD types
    utilruntime.Must(routev1.AddToScheme(scheme))           // OpenShift Route (for the dashboard URL)
    utilruntime.Must(apiextensionsv1.AddToScheme(scheme))   // CRD types (to check if PersesDashboard CRD exists)
}
```

::: tip What `utilruntime.Must` Does
`Must` panics if its argument returns an error. That sounds scary, but it's the right call at startup: if a type fails to register, the operator is fundamentally broken, so crash *immediately* rather than run with a half-configured Scheme. This is the Go equivalent of throwing during module load instead of failing mysteriously at request time.
:::

### Where `AddToScheme` comes from

Each package that defines Kubernetes types ships an `AddToScheme` function. For the Dashboard CRD it's generated (never hand-written) in `dashboard-operator/api/v1alpha1/groupversion_info.go`:

```go
var (
    GroupVersion = schema.GroupVersion{
        Group:   "components.platform.opendatahub.io",
        Version: "v1alpha1",
    }
    SchemeBuilder = &scheme.Builder{GroupVersion: GroupVersion}
    AddToScheme   = SchemeBuilder.AddToScheme
)
```

Calling `v1alpha1.AddToScheme(scheme)` registers the two-way mapping:

- `*v1alpha1.Dashboard` ⇄ GVK `components.platform.opendatahub.io/v1alpha1, Kind=Dashboard`
- `*v1alpha1.DashboardList` ⇄ the matching list kind

That's what lets the generic `client.Client` handle your custom type as transparently as a built-in Pod.

## Pillar 2: The Manager

The Manager is the process. You build **one** per binary, register your controllers on it, and call `Start()` — which blocks until the process is told to shut down. Here's the bootstrap sequence from `main.go`, condensed.

### Flags and namespace resolution

The operator reads CLI flags — where its manifests live, metrics/health addresses, leader election, which namespace to manage:

```go
flag.StringVar(&manifestsBasePath, "manifests-base-path", "/opt/manifests",
    "Path to the kustomize base directory")
flag.BoolVar(&enableLeaderElection, "leader-elect", false,
    "Enable leader election for controller manager")
flag.Parse()
```

::: tip Remember `--manifests-base-path` and `--leader-elect`
You'll set both by hand when you run the operator locally in dev mode — pointing `--manifests-base-path` at the repo's `manifests/` and `--leader-elect=false`. The [Build & Deploy the Operator](/tutorials/build-and-deploy-operator) tutorial uses exactly these flags.
:::

### Creating the Manager

From `main.go:78` (condensed):

```go
mgr, err := ctrl.NewManager(ctrl.GetConfigOrDie(), ctrl.Options{
    Scheme:                 scheme,             // the Scheme we populated in init()
    Metrics:                metricsserver.Options{ BindAddress: metricsAddr },
    HealthProbeBindAddress: probeAddr,
    LeaderElection:         enableLeaderElection,
    LeaderElectionID:       "dashboard-operator.opendatahub.io",
})
```

`ctrl.GetConfigOrDie()` finds your cluster credentials the same way `kubectl` does — the `KUBECONFIG` env var when running locally, or the in-cluster ServiceAccount when running as a pod. The Manager it returns owns:

- a shared **cache** (the informers that power watches),
- the **client** every reconciler uses,
- the **metrics** and **health** servers,
- **leader election** (so only one replica reconciles at a time in HA setups).

### Platform detection, then start

Once — at startup, not per reconcile — the operator detects whether it's on OpenShift or plain Kubernetes, then registers the reconciler and starts:

```go
platform, _ := cluster.DetectPlatform(ctx, mgr.GetClient(), os.Getenv("ODH_PLATFORM_TYPE"), namespace)

controller.SetupWithManager(mgr, controller.Options{ /* paths, platform, namespaces */ })

mgr.AddHealthzCheck("healthz", healthz.Ping)
mgr.AddReadyzCheck("readyz", healthz.Ping)

// BLOCKS until SIGTERM/SIGINT, then shuts down gracefully.
mgr.Start(ctrl.SetupSignalHandler())
```

::: info `mgr.Start()` Blocks — On Purpose
This is the opposite of a BFF's `server.listen()` in one way and identical in another. Identical: it's the line that "runs forever." Different: instead of accepting HTTP connections, it's running the cache, the controllers, leader election, and the metrics/health servers all at once, and it only returns when the process receives a shutdown signal.
:::

## Pillar 3 & 4: The Controller and Your Reconciler

The Reconciler is the part you write. It's a struct that **embeds** `client.Client` (so you can call `r.Get`, `r.List`, etc. directly on it) plus the config injected at setup.

From `dashboard-operator/internal/controller/dashboard_reconciler.go:72`:

```go
type DashboardReconciler struct {
    client.Client                       // embedded — r.Get / r.List / r.Create work directly
    Scheme                *runtime.Scheme
    ManifestsBasePath     string
    Platform              cluster.Platform
    Namespace             string
    ApplicationsNamespace string
}
```

::: tip Embedding Is Go's "extends," Sort Of
`client.Client` sitting there with no field name is **struct embedding** — the reconciler gets all of `client.Client`'s methods promoted onto it. It's the closest Go gets to `class DashboardReconciler extends Client`, and it's why you'll see `r.Get(...)` instead of `r.Client.Get(...)`. (Part 1 covers embedding in depth.)
:::

The one method that matters:

```go
func (r *DashboardReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    dashboard := &v1alpha1.Dashboard{}
    if err := r.Get(ctx, req.NamespacedName, dashboard); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)  // deleted? nothing to do.
    }
    // ... reconcile logic ...
}
```

`req` carries only a `NamespacedName` — *what* changed, not the object itself. So your first move is always to `Get` the full resource. If it's gone (a 404), `client.IgnoreNotFound` turns the error into `nil`: "done, no requeue."

### `ctrl.Result`: how you tell the framework what to do next

The return value is a tiny state machine. This is the single most important table on this page:

```go
return ctrl.Result{}, nil                              // Done. Wait for the next watch event.
return ctrl.Result{}, err                              // Failed. Requeue with exponential backoff.
return ctrl.Result{RequeueAfter: 10 * time.Second}, nil // Poll: call me again in 10s.
return ctrl.Result{Requeue: true}, nil                 // Requeue ASAP (rare).
```

The dashboard-operator uses `RequeueAfter` in exactly two situations: the OpenShift Route isn't ready yet (retry in 10s), and when a `reconcileInterval` is configured for periodic re-sync.

::: warning Never Block Inside `Reconcile`
This is the cardinal rule of operators. Do **not** `time.Sleep`, do **not** poll a channel in a loop, do **not** wait for an external system inline. If you need to wait, `return ctrl.Result{RequeueAfter: d}, nil` and let the framework call you again. Blocking here stalls the work queue for *every* resource, not just this one. It's the operator equivalent of a synchronous `fs.readFileSync` in a hot request path — except worse, because there's one shared loop.
:::

### Wiring the watches: `For()` and `Owns()`

`SetupWithManager` (bottom of `dashboard_reconciler.go:942`) is where you declare which cluster events trigger reconciliation:

```go
return ctrl.NewControllerManagedBy(mgr).
    For(&v1alpha1.Dashboard{}).                 // primary: watch Dashboard CRs
    Owns(&appsv1.Deployment{}).                 // also: Deployments we created
    Owns(&corev1.Service{}).                    // Services we created
    Owns(&corev1.ConfigMap{}).                  // ConfigMaps we created
    Owns(&policyv1.PodDisruptionBudget{}).      // PDBs we created
    Complete(r)
```

- **`For(&Dashboard{})`** — the primary trigger. Create/update/delete a `Dashboard` CR and the reconciler fires.
- **`Owns(&Deployment{})`** — watch Deployments carrying an `ownerReference` back to a Dashboard CR. Someone runs `kubectl delete deployment odh-dashboard`? The framework maps that event to the owning Dashboard CR and re-reconciles, **recreating it**. This is self-healing.

```
   kubectl delete deployment odh-dashboard
              │
              ▼
   Owns() sees the delete event on an owned Deployment
              │
              ▼
   maps it to ownerReference → Dashboard "default-dashboard"
              │
              ▼
   enqueue Reconcile(default-dashboard) → Deployment recreated
```

::: info Why Not `Owns()` Everything?
Cluster-scoped resources like `ClusterRole` and `ClusterRoleBinding` can't carry a namespace-scoped owner reference (an owner reference can't point "up" from cluster scope to a namespaced object, and the GC rules differ). The operator manages those through **label-based discovery** during teardown instead — you'll see that on the [Reconciler](./reconciler) page.
:::

## The Whole Startup Flow

Putting the four pillars together, here's what happens from process start to first reconcile:

```
main.go
  1. init()            → register types in the Scheme
  2. flag.Parse()      → read CLI flags
  3. ctrl.NewManager   → build the Manager (client, cache, metrics, health)
  4. DetectPlatform    → OpenShift vs plain Kubernetes (once)
  5. SetupWithManager  → build the Controller; For(Dashboard) + Owns(...)
  6. mgr.Start()       → BLOCKS forever

A Dashboard CR appears (or an owned resource changes):
  7. Controller sees the watch event → enqueues a request
  8. Calls DashboardReconciler.Reconcile(ctx, req)
  9. Reconcile reads state, applies desired state, returns ctrl.Result
```

Steps 1–6 are this page. Step 9 — everything the reconciler actually *does* — is the next three pages.

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] What are the four pillars, and which one is "your code"?
- [ ] Why must every type be registered in the Scheme *before* the Manager starts?
- [ ] What are the three most common `ctrl.Result` return values and what does each mean?
- [ ] What's the difference between `For()` and `Owns()`, and why does `Owns()` give you self-healing?
- [ ] Why must you never block inside `Reconcile`?

</div>

::: info What's Next
Next up: **[The CRD](./the-crd)** — the `Dashboard` custom resource's Go types, the kubebuilder markers that generate its schema, and the CEL rule that enforces the singleton.
:::

::: info See Also
- [Part 4: Controller Concepts](/guide/kubernetes/controller-concepts) — finalizers, owner references, and SSA at the Kubernetes level
- [Part 1: Struct Embedding](/guide/go-basics/structs) — how `DashboardReconciler` gets `client.Client`'s methods
- [Testing the Operator](./testing) — the `export_test.go` pattern mentioned above
:::
