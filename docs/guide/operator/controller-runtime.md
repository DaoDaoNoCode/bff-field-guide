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

From `dashboard-operator/cmd/manager/main.go` (around L33):

```go
var scheme = runtime.NewScheme()

func init() {
    // init() runs before main(), so the Scheme is fully populated
    // by the time we build the Manager.
    utilruntime.Must(clientgoscheme.AddToScheme(scheme))    // Pod, Deployment, Service, ConfigMap...
    utilruntime.Must(v1alpha1.AddToScheme(scheme))          // our Dashboard CRD types
    utilruntime.Must(routev1.AddToScheme(scheme))           // OpenShift Route (for the dashboard URL)
    utilruntime.Must(gatewayv1.Install(scheme))             // Gateway API HTTPRoute
    utilruntime.Must(apiextensionsv1.AddToScheme(scheme))   // CRD types (to check if PersesDashboard CRD exists)
}
```

::: tip What `utilruntime.Must` Does
`Must` panics if its argument returns an error. That sounds scary, but it's the right call at startup: if a type fails to register, the operator is fundamentally broken, so crash *immediately* rather than run with a half-configured Scheme. This is the Go equivalent of throwing during module load instead of failing mysteriously at request time.
:::

::: info The Log Format
`main.go` builds the logger from `zap.Options{Development: true}` and binds zap's flags, so the default output is human-readable development logs. Turn up verbosity with `--zap-log-level=debug`.
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

The operator reads CLI flags — where its manifests live, metrics/health addresses, leader election, which namespace it runs in, and the optional webhook:

```go
flag.StringVar(&manifestsBasePath, "manifests-base-path", "/opt/manifests/dashboard", "Base path for dashboard manifests")
flag.StringVar(&metricsAddr, "metrics-bind-address", ":8443", "Address the metrics endpoint binds to")
flag.StringVar(&healthProbeAddr, "health-probe-bind-address", ":8081", "Address the health probe endpoint binds to")
flag.BoolVar(&leaderElect, "leader-elect", false, "Enable leader election for controller manager")
flag.BoolVar(&secureMetrics, "secure-metrics", true, "Serve metrics over HTTPS")
flag.StringVar(&operatorNamespace, "namespace", "", "Namespace where the operator is deployed")
flag.BoolVar(&enableWebhook, "enable-webhook", false, "Enable the validating webhook server")
flag.IntVar(&webhookPort, "webhook-port", 9443, "Port the webhook server binds to")

opts := zap.Options{Development: true}
opts.BindFlags(flag.CommandLine) // adds --zap-log-level and friends
flag.Parse()
```

`--namespace` is **required**: if it is empty the operator falls back to the `OPERATOR_NAMESPACE` env var and exits if that is empty too. `APPLICATIONS_NAMESPACE` (where the dashboard itself runs) falls back to the operator namespace.

::: tip Remember `--manifests-base-path` and `--leader-elect`
You'll set both by hand when you run the operator locally in dev mode — pointing `--manifests-base-path` at the repo's `manifests/` and `--leader-elect=false`. The [Build & Deploy the Operator](/tutorials/build-and-deploy-operator) tutorial uses exactly these flags.
:::

### Creating the Manager

From `main.go` (condensed):

```go
restCfg := ctrl.GetConfigOrDie()

tlsResult, err := pkgtls.Resolve(context.Background(), restCfg) // cluster TLS profile, see below

mgr, err := ctrl.NewManager(restCfg, ctrl.Options{
    Scheme:                 scheme,                                          // populated in init()
    NewCache:               controller.NewManagerCache(applicationsNamespace), // scoped cache, see below
    Metrics:                metricsserver.Options{BindAddress: metricsAddr, SecureServing: true, TLSOpts: tlsResult.TLSOpts},
    HealthProbeBindAddress: healthProbeAddr,
    LeaderElection:         leaderElect,
    LeaderElectionID:       "dashboard.components.platform.opendatahub.io",
    Client: client.Options{Cache: &client.CacheOptions{DisableFor: []client.Object{
        &corev1.ConfigMap{}, &corev1.Secret{}, // always read live, never cached
    }}},
})
```

`ctrl.GetConfigOrDie()` finds your cluster credentials the same way `kubectl` does — the `KUBECONFIG` env var when running locally, or the in-cluster ServiceAccount when running as a pod. The Manager it returns owns:

- a shared **cache** (the informers that power watches),
- the **client** every reconciler uses,
- the **metrics** and **health** servers,
- **leader election** (so only one replica reconciles at a time in HA setups).

### The cache is scoped, on purpose

By default a controller-runtime cache watches *every* object of each type it is asked for, cluster-wide. On a big cluster that means holding every Deployment and every ConfigMap in memory. The dashboard-operator narrows it down in `internal/controller/controller_cache.go`:

```go
func ManagerCacheOptions(applicationsNamespace string, mapper meta.RESTMapper) (cache.Options, error) {
    // label platform.opendatahub.io/part-of in (dashboard, maas-portal)
    ownedSelector := ...
    appsNamespaceOnly := map[string]cache.Config{applicationsNamespace: {}}

    byObject := map[client.Object]cache.ByObject{}
    for _, obj := range []client.Object{&appsv1.Deployment{}, &corev1.Service{},
        &corev1.ServiceAccount{}, &policyv1.PodDisruptionBudget{}} {
        byObject[obj] = cache.ByObject{Namespaces: appsNamespaceOnly, Label: ownedSelector}
    }
    for _, obj := range []client.Object{&networkingv1.NetworkPolicy{}, &rbacv1.Role{},
        &rbacv1.RoleBinding{}, &rbacv1.ClusterRole{}, &rbacv1.ClusterRoleBinding{}} {
        byObject[obj] = cache.ByObject{Label: ownedSelector}
    }
    // + HTTPRoute and ConsoleLink, only if their APIs exist on this cluster
    return cache.Options{ByObject: byObject, ReaderFailOnMissingInformer: true}, nil
}
```

Four rules follow from this, and they bite new contributors:

- **Only labelled objects are visible.** A cached `r.Get` on a Deployment without the `part-of` label returns NotFound, even if it exists.
- **`ReaderFailOnMissingInformer: true`** means a cached read of a type that is not in `ByObject` fails at runtime instead of silently starting a new cluster-wide informer. If you add a new owned type, add it to **both** `ManagerCacheOptions` and `Owns()`.
- **ConfigMaps and Secrets bypass the cache** (`DisableFor`): every read goes to the API server. ConfigMap *events* come from small dedicated caches instead: one selected by the owned label in the applications namespace, and one per named input ConfigMap (`dashboard-operator-config`, `odh-dashboard-config`) selected by `metadata.name` (`controller_configmaps.go`). The `OdhDashboardConfig` watch also gets its own single-object cache (`addOdhDashboardConfigWatch`).
- **Use `APIReader` for anything outside the cache.** The reconciler carries `APIReader: mgr.GetAPIReader()`, an uncached reader, for direct reads such as the input ConfigMaps, the Route lookup and the federation ConfigMap.

### Platform detection, then start

Once — at startup, not per reconcile — the operator detects whether it's on OpenShift or plain Kubernetes, then registers the reconciler and starts:

```go
// APIReader: the cache isn't running yet. A detection error is fatal.
platform, err := cluster.DetectPlatform(context.Background(), mgr.GetAPIReader(),
    os.Getenv("ODH_PLATFORM_TYPE"), operatorNamespace)

controller.SetupWithManager(mgr, controller.Options{ /* paths, platform, namespaces */ })
if enableWebhook {
    mgr.GetWebhookServer().Register("/validate-dashboard", webhook.NewSingletonHandler(mgr.GetAPIReader()))
}

mgr.AddHealthzCheck("healthz", healthz.Ping)
mgr.AddReadyzCheck("readyz", healthz.Ping)

ctx, cancel := context.WithCancel(ctrl.SetupSignalHandler())
if tlsResult.APIAvailable {
    watcher := &pkgtls.ProfileWatcher{Client: mgr.GetClient(), InitialProfile: tlsResult.Profile,
        OnProfileChange: func(context.Context) { cancel() }} // TLS profile changed: stop, restart, reload
    watcher.SetupWithManager(mgr)
}

setupLog.Info("Starting manager")
// BLOCKS until SIGTERM/SIGINT (or cancel()), then shuts down gracefully.
mgr.Start(ctx)
```

### TLS: following the cluster's profile

OpenShift lets an admin pick a cluster-wide TLS security profile (Old, Intermediate, Modern or Custom) on `apiservers.config.openshift.io/cluster`. `internal/tls/resolve.go` reads it once at startup and turns it into `TLSOpts` for the metrics server and the webhook. Off OpenShift, or if the API server object isn't there, it falls back to hardened Intermediate defaults; an unexpected error is fatal (fail-closed).

Go's `tls.Config` can't be swapped under a running server, so `ProfileWatcher` takes the blunt route: when the profile changes it cancels the manager's context, the process exits, and Kubernetes restarts the pod with the new settings. The BFFs follow the same profile through the shared `pkg/tls` package (`tlsprofile.ServerTLSConfig`).

::: info `mgr.Start()` Blocks — On Purpose
This is the opposite of a BFF's `server.listen()` in one way and identical in another. Identical: it's the line that "runs forever." Different: instead of accepting HTTP connections, it's running the cache, the controllers, leader election, and the metrics/health servers all at once, and it only returns when the process receives a shutdown signal.
:::

## Pillar 3 & 4: The Controller and Your Reconciler

The Reconciler is the part you write. It's a struct that **embeds** `client.Client` (so you can call `r.Get`, `r.List`, etc. directly on it) plus the config injected at setup.

From `dashboard-operator/internal/controller/dashboard_controller.go` (around L138):

```go
type DashboardReconciler struct {
    client.Client                       // embedded — r.Get / r.List / r.Create work directly
    APIReader             client.Reader // uncached reads (ConfigMaps, Route, federation ConfigMap)
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

The dashboard-operator uses `RequeueAfter` in several places:

- the dashboard Route hasn't been admitted yet (retry in 10s);
- a `reconcileInterval` is set in `dashboard-operator-config` (periodic re-sync, minimum 5s);
- observability auto-detection found nothing (look again in 5 minutes);
- the MaaS Portal operand isn't ready (retry in 1 minute);
- deletion is waiting for MaaS Portal cleanup to finish.

::: warning Never Block Inside `Reconcile`
This is the cardinal rule of operators. Do **not** `time.Sleep`, do **not** poll a channel in a loop, do **not** wait for an external system inline. If you need to wait, `return ctrl.Result{RequeueAfter: d}, nil` and let the framework call you again. Blocking here stalls the work queue for *every* resource, not just this one. It's the operator equivalent of a synchronous `fs.readFileSync` in a hot request path — except worse, because there's one shared loop.
:::

### Wiring the watches: `For()` and `Owns()`

`SetupWithManager` (in `internal/controller/controller_setup.go`) is where you declare which cluster events trigger reconciliation:

```go
controllerBuilder := ctrl.NewControllerManagedBy(mgr).
    For(&v1alpha1.Dashboard{}).                 // primary: watch Dashboard CRs
    Owns(&appsv1.Deployment{}).                 // Deployments we created
    Owns(&corev1.Service{}, builder.WithPredicates(serviceChangedPredicate())).
    Owns(&corev1.ServiceAccount{}).
    Owns(&networkingv1.NetworkPolicy{}).
    Owns(&rbacv1.ClusterRole{}).
    Owns(&rbacv1.ClusterRoleBinding{}).
    Owns(&rbacv1.Role{}).
    Owns(&rbacv1.RoleBinding{}).
    Owns(&policyv1.PodDisruptionBudget{}, builder.WithPredicates(podDisruptionBudgetChangedPredicate())).
    Watches(&corev1.Namespace{}, /* MaaS operator namespace → Dashboard */ ...)

addConfigMapWatches(mgr, controllerBuilder, r)                     // dedicated ConfigMap caches
addOptionalOwnedResourceWatches(mgr.GetRESTMapper(), controllerBuilder) // HTTPRoute, ConsoleLink if present
dashboardController, err := controllerBuilder.Build(r)
return addOdhDashboardConfigWatch(mgr, dashboardController, r)
```

Note what is *not* there: ConfigMaps are not `Owns()`-ed. Their events come through the dedicated, selector-scoped caches described above. The Service and PDB predicates ignore status-only updates so the operator doesn't reconcile on every endpoint change.

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

::: info Owner References Aren't the Whole Teardown Story
Because the `Dashboard` CR is cluster-scoped, it *can* own cluster-scoped objects like `ClusterRole` and `ClusterRoleBinding`, which is why they appear in `Owns()`. But garbage collection only runs when the owner is deleted. `managementState: Removed` keeps the CR, so GC never fires, and some extras (the RBAC in `openshift-ingress`) live outside the normal flow. So the operator also tears down by **label-based discovery** — you'll see that on the [Reconciler](./reconciler) page.
:::

## The Whole Startup Flow

Putting the four pillars together, here's what happens from process start to first reconcile:

```
main.go
  1. init()            → register types in the Scheme
  2. flag.Parse()      → read CLI flags, resolve namespaces
  3. pkgtls.Resolve    → read the cluster TLS profile
  4. ctrl.NewManager   → build the Manager (scoped cache, client, metrics, health)
  5. DetectPlatform    → OpenShift vs plain Kubernetes (once)
  6. SetupWithManager  → build the Controller; For(Dashboard) + Owns(...) + ConfigMap caches
  7. mgr.Start()       → BLOCKS until a signal or a TLS profile change

A Dashboard CR appears (or an owned resource changes):
  8. Controller sees the watch event → enqueues a request
  9. Calls DashboardReconciler.Reconcile(ctx, req)
 10. Reconcile reads state, applies desired state, returns ctrl.Result
```

Steps 1–7 are this page. Step 10 — everything the reconciler actually *does* — is the next three pages.

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] What are the four pillars, and which one is "your code"?
- [ ] Why must every type be registered in the Scheme *before* the Manager starts?
- [ ] What are the three most common `ctrl.Result` return values and what does each mean?
- [ ] What's the difference between `For()` and `Owns()`, and why does `Owns()` give you self-healing?
- [ ] Why must you never block inside `Reconcile`?
- [ ] What happens if you add a new owned type to `Owns()` but forget `ManagerCacheOptions`?

</div>

::: info What's Next
Next up: **[The CRD](./the-crd)** — the `Dashboard` custom resource's Go types, the kubebuilder markers that generate its schema, and the CEL rule that enforces the singleton.
:::

::: info See Also
- [Part 4: Controller Concepts](/guide/kubernetes/controller-concepts) — finalizers, owner references, and SSA at the Kubernetes level
- [Part 1: Struct Embedding](/guide/go-basics/structs) — how `DashboardReconciler` gets `client.Client`'s methods
- [Testing the Operator](./testing) — the `export_test.go` pattern mentioned above
:::
