# Testing the Operator

> Most operator logic can be tested with no cluster at all. Here's the ladder — from pure-function unit tests to a real in-process API server.

You learned to test BFF handlers with `httptest` in Part 3 and the tutorials. Operator testing has the same spirit — table-driven, fast, isolated — but adds two tools you haven't met: the **fake client** (an in-memory Kubernetes API) and **envtest** (a real API server in your test process). Reach for the cheapest tool that covers what you're testing.

```
cheapest ─────────────────────────────────────────────► most realistic
 pure function     fake client            envtest
 (no client)       (in-memory K8s)        (real API server, no kubelet)
 resolveModule…    reconcile logic,       CEL validation, defaulting,
 hash, naming      status updates         admission, real GVK behavior
```

## Level 1: Pure functions — the cheapest wins

The operator's most important logic is deliberately pure. `resolveModuleStatuses` (from [Modules & Federation](./modules-and-federation)) takes a `DashboardSpec` and returns a map — no client, no context, no cluster. That makes it testable the way any Go function is, with a **table-driven test** (the same pattern from the [Writing Tests](/tutorials/writing-tests) tutorial).

From `dashboard-operator/internal/controller/modules_test.go`:

```go
func TestResolveModuleStatuses(t *testing.T) {
    tests := []struct {
        name       string
        spec       v1alpha1.DashboardSpec
        wantPhases map[string]v1alpha1.ModulePhase
        wantReason map[string]string
    }{
        {
            name:    "default spec — all modules deployed",
            spec:    v1alpha1.DashboardSpec{},
            wantPhases: map[string]v1alpha1.ModulePhase{
                "modelRegistry": v1alpha1.ModulePhaseDeployed,
                "genAi":         v1alpha1.ModulePhaseDeployed,
            },
        },
        {
            name: "explicit disable cascades to dependents",
            spec: v1alpha1.DashboardSpec{
                Modules: map[string]v1alpha1.ModuleOverride{
                    "genAi": {State: v1alpha1.ModuleDisabled},
                },
            },
            wantPhases: map[string]v1alpha1.ModulePhase{
                "genAi":   v1alpha1.ModulePhaseDisabled,   // ExplicitOverride
                "autorag": v1alpha1.ModulePhaseDisabled,   // DependencyNotMet (cascade!)
            },
            wantReason: map[string]string{
                "genAi":   "ExplicitOverride",
                "autorag": "DependencyNotMet",
            },
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := resolveModuleStatuses(&tt.spec)
            for name, wantPhase := range tt.wantPhases {
                status, ok := got[name]
                require.True(t, ok, "module %q should be present", name)
                assert.Equal(t, wantPhase, status.Phase)
            }
        })
    }
}
```

::: tip `require` Fails Fast, `assert` Keeps Going
The `testify` library (used throughout the operator) gives you two families: `require.*` stops the subtest immediately on failure (use it when later assertions would panic — e.g. after checking a map key exists), and `assert.*` records the failure and continues (use it to collect *all* the mismatches in one run). Same distinction as an early `throw` vs accumulating expectation failures in Jest.
:::

Keeping the decision logic pure is the single biggest testability win in the operator. Test the algorithm here, exhaustively and instantly; save the client-level tools for wiring.

## Level 2: The fake client — in-memory Kubernetes

When you need to test code that *calls* the client — `Reconcile`, status updates, resource creation — use the **fake client**. It's an in-memory implementation of `client.Client` supporting Get/List/Create/Update/Patch/Delete/Status. No API server process, no network — just a map behind the client interface.

```go
s := runtime.NewScheme()
utilruntime.Must(clientgoscheme.AddToScheme(s))   // built-in types
utilruntime.Must(v1alpha1.AddToScheme(s))         // the Dashboard CRD types

cl := fake.NewClientBuilder().
    WithScheme(s).
    WithObjects(existingDeployment).               // seed initial cluster state
    WithStatusSubresource(&v1alpha1.Dashboard{}).  // ← easy to forget!
    Build()
```

::: warning Don't Forget `WithStatusSubresource`
Without `WithStatusSubresource(&v1alpha1.Dashboard{})`, a call to `r.Status().Update(...)` **silently succeeds without changing anything** — your test passes while asserting nothing. Because the reconciler's whole job culminates in a status update (Step 14), a test missing this line is testing a no-op. This is *the* classic fake-client footgun.
:::

The fake client is dramatically faster than envtest and covers the vast majority of reconciler logic. You seed the "cluster," run `Reconcile`, and assert on what changed.

## Level 3: envtest — a real API server

Some behavior only a real API server produces: CEL validation, server-side defaulting (`+kubebuilder:default`), admission, and true GVK round-tripping. **envtest** (from controller-runtime) starts a real `kube-apiserver` and `etcd` *in your test process* — no kubelet, so no pods actually run, but the API layer is genuine.

Use envtest to verify things like the singleton CEL rule from [The CRD](./the-crd):

```go
// Applying a Dashboard named anything other than "default-dashboard"
// must be REJECTED by the API server's CEL validation.
bad := &v1alpha1.Dashboard{ ObjectMeta: metav1.ObjectMeta{Name: "wrong-name"} }
err := k8sClient.Create(ctx, bad)
require.Error(t, err) // fake client would NOT catch this — envtest does
```

envtest needs its binaries installed once (`setup-envtest`), which the operator's Makefile wires up.

::: info Deep Dive: envtest Integration Tests
The monorepo has a full rule for writing and debugging these: **`docs/envtest-integration-tests.md`** in the repo root (and the `envtest-debug` skill for triaging failures). If you're writing envtest integration tests for the operator, read that first — it covers binary setup, the test harness, and the common failure patterns. The [Development Workflow](/guide/workflow/) part covers the `make` targets that run them.
:::

## `export_test.go`: white-box access without leaking internals

Much of the operator's logic is unexported (`computeFederationConfigHash`, `buildFederationConfigMap`, `mainDashboardDeploymentName`). A `_test` package can't see those. The idiom is a file named `export_test.go` in `package controller` (not `controller_test`) — compiled *only* during testing — that re-exports privates:

```go
package controller

// Alias private functions to public names for tests.
var ComputeFederationConfigHash = computeFederationConfigHash
var MainDashboardDeploymentName = mainDashboardDeploymentName

// Wrap a method on an unexported receiver.
func BuildFederationConfigMap(r *DashboardReconciler, statuses map[string]v1alpha1.ModuleStatus,
    dashboard *v1alpha1.Dashboard) (*corev1.ConfigMap, error) {
    return r.buildFederationConfigMap(statuses, dashboard)
}

// Override package state for a test, returning a restore closure.
func SetOperatorDeploymentName(name string) (restore func()) {
    old := operatorDeploymentName
    operatorDeploymentName = name
    return func() { operatorDeploymentName = old }
}
```

Because the filename ends in `_test.go`, none of this ships in the production binary — external consumers still see a clean, encapsulated package. Test code in a sibling `_test` package imports these public aliases. The restore-closure trick pairs with `defer`:

```go
restore := SetOperatorDeploymentName("test-operator")
defer restore()   // always put package state back, even on failure
```

::: tip This Pattern Is Everywhere in Go
`export_test.go` is used in the Go standard library and controller-runtime itself. It's the sanctioned way to white-box test unexported code without either (a) dumping everything into the main test package or (b) exporting symbols you don't want in your public API.
:::

## Idempotency tests: prove the loop converges

The reconciler *must* be idempotent (see [The Reconciler](./reconciler)). The way you prove it is direct: reconcile twice, assert the second call is a no-op with the same result.

```go
result1, err1 := reconciler.Reconcile(ctx, req)
require.NoError(t, err1)

result2, err2 := reconciler.Reconcile(ctx, req)   // same input, again
require.NoError(t, err2)

assert.Equal(t, result1, result2)                 // stable — no drift, no churn
```

If the second reconcile produces different resources or a different `ctrl.Result`, you have a non-idempotent bug — the operator would thrash forever, re-applying changes on every loop. These tests are cheap insurance against the most damaging class of operator bug.

## Choosing the right level

| You're testing… | Use | Why |
|---|---|---|
| Decision logic (resolution, hashing, naming) | Pure function test | No client needed — fastest, most exhaustive |
| Reconcile flow, status writes, resource creation | Fake client | In-memory K8s; fast; covers most of it |
| CEL rules, defaulting, admission, GVK behavior | envtest | Only a real API server produces these |
| Unexported functions | `export_test.go` + any level above | White-box access without leaking internals |
| Convergence / no-thrash | Idempotency test (fake client) | Reconcile twice, compare |

Default to the cheapest tool that actually exercises the behavior. Reach up the ladder only when the level below can't see what you need to assert.

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Why can `resolveModuleStatuses` be tested with no client at all?
- [ ] What breaks silently if you forget `WithStatusSubresource` on the fake client?
- [ ] What does envtest give you that the fake client cannot?
- [ ] What problem does `export_test.go` solve, and why doesn't it leak into the production binary?
- [ ] How do you prove the reconciler is idempotent?

</div>

::: info What's Next
That completes Part 5. Head to **[Part 6: Development Workflow](/guide/workflow/)** — the `make` targets, multi-module Go layout, and debugging tools you'll use day to day across the BFFs *and* the operator.
:::

::: info See Also
- `docs/envtest-integration-tests.md` (repo root) — the full envtest integration-testing rule
- [Writing Handler Tests](/tutorials/writing-tests) — the table-driven pattern, on the BFF side
- [Modules & Federation](./modules-and-federation) — the pure functions tested at Level 1
- [The Reconciler](./reconciler) — why idempotency matters
:::
