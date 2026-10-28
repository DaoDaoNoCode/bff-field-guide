# Debugging

> **When it doesn't work** -- structured logging, Delve, mock modes, envtest setup, and a field guide to the mistakes that cost new contributors the most time.

Debugging Go in this repo is mostly about knowing which lever to pull: crank up `slog`, attach Delve, flip a mock flag, or fix an envtest asset path. This page walks each one, then closes with a "Common Mistakes" list -- the specific traps that turn a five-minute change into a lost afternoon.

## Structured Logging with `slog`

Both the operator and the BFFs log with structured loggers -- `logr` (backed by zap) in the operator, the standard library's `log/slog` in the BFFs. Instead of interpolating strings, you pass **key-value pairs** -- so logs are machine-parseable and greppable:

```go
// Operator -- controller-runtime's logr logger (zap underneath), pulled from context
logger := log.FromContext(ctx)
logger.Info("Reconciling Dashboard", "name", dashboard.Name)
logger.Error(err, "Failed to deploy", "module", name)

// BFF -- the standard library slog
slog.Info("Starting server", "port", port, "mode", mode)
slog.Debug("Request received", "path", r.URL.Path)
```

::: warning Never `fmt.Sprintf` Into a Log Message
Don't write `slog.Info(fmt.Sprintf("starting on port %d", port))`. Pass the value as a field instead: `slog.Info("starting", "port", port)`. The structured logger handles formatting, and keeping values as fields is what makes logs filterable (`| grep port=8080`) and safe. This is the Go equivalent of preferring structured logging over `console.log("port: " + port)` in Node.
:::

Turn on debug output with a flag. The two binaries spell it differently -- the operator binds controller-runtime's zap flags, the BFFs have their own `--log-level`:

```bash
./bin/manager --zap-log-level=debug   # Operator (zap flags; also --zap-devel, --zap-encoder)
./bin/bff --log-level=debug           # BFF (or LOG_LEVEL=debug)
```

## Delve: The Interactive Debugger

`dlv` is Go's debugger -- the equivalent of stepping through code in the Node inspector or Chrome DevTools. Launch a debug session against the operator's manager, passing the manager's own flags after `--`:

```bash
# From dashboard-operator/
dlv debug ./cmd/manager -- --namespace=test --manifests-base-path=/opt/manifests
```

Everything after the `--` is passed to *your program*, not to Delve. Once in the `(dlv)` prompt, `break`, `continue`, `next`, `step`, and `print` do what you'd expect.

::: tip Use the VS Code GUI Instead
You rarely need the raw `dlv` prompt. The VS Code Go extension wraps Delve in a full graphical debugger -- set breakpoints in the gutter, press **F5**, inspect variables in the sidebar. It's the same Delve underneath, but with the ergonomics of the Node debugger you already use. (This is also why the `go.work` setup from [the monorepo page](./index) matters -- the debugger resolves symbols through gopls.)
:::

Some BFFs ship a `debug` make target that builds with optimizations off and starts a DAP listener:

```bash
# From packages/gen-ai/bff/
make debug   # builds with -gcflags=all=-N -l, Delve listens for DAP on :2345
```

The `-N -l` flags disable inlining and optimization so the debugger's line numbers and variables map cleanly to your source.

## Mock Flags: Isolating What You're Debugging

The `--mock-*` flags aren't just for frontend devs -- they're a debugging tool. Mock the parts you *aren't* investigating so the bug can't hide behind an unrelated failure:

```bash
# core-bff / maas: mock everything -- no cluster, no upstreams (pure handler-logic debugging)
./bin/bff --mock-k8s-client --mock-http-client

# Real cluster, mocked upstreams (debug K8s interactions in isolation)
./bin/bff --mock-http-client

# Everything real (needs port-forwards to upstream services)
./bin/bff
```

`--mock-http-client` exists only in [core-bff](/guide/core-bff/) and maas. gen-ai has no generic HTTP mock; instead it has finer-grained mocks for its specific upstreams:

```bash
--mock-k8s-client      # envtest-backed Kubernetes
--mock-ls-client       # Mock Llama Stack
--mock-mcp-client      # Mock MCP servers
--mock-mlflow-client   # Mock MLflow
--mock-nemo            # Mock NeMo Guardrails (note: no "-client" suffix)
--mock-bff-clients     # Mock inter-BFF calls
```

`--mock-k8s-client` starts envtest, so it needs the envtest binaries -- run through `make run MOCK_K8S_CLIENT=true ...`, which exports `ENVTEST_ASSETS`, rather than a bare binary or `go run`.

::: info Mock Inter-BFF Calls Too
`--mock-bff-clients` (or the `MOCK_BFF_CLIENTS=true` env var) fakes calls to *other BFFs*, so you can debug one BFF without standing up the ones it depends on. See [Inter-BFF Communication](/guide/deep-dive/inter-bff-communication#mock-mode-developing-one-bff-at-a-time) for how it works.
:::

## envtest Binary Setup

BFF integration tests use **envtest** -- a real Kubernetes API server (etcd + kube-apiserver) running in-process, with no kubelet, scheduler, or controllers. When you run a test and see **"envtest binaries not found"**, the API-server binaries just aren't installed yet:

```bash
# Install the setup tool, then fetch the envtest binaries
go install sigs.k8s.io/controller-runtime/tools/setup-envtest@latest
setup-envtest use
```

The Makefiles automate this, but if you run `go test` directly, point Go at the binaries yourself. The BFFs read **`ENVTEST_ASSETS`** (see `k8smocks/base_testenv.go`), using the Kubernetes version pinned in the BFF's Makefile (`ENVTEST_K8S_VERSION`, e.g. 1.29.3):

```bash
# BFF
export ENVTEST_ASSETS=$(setup-envtest use 1.29.3 -p path)
go test ./...
```

::: info The Operator Uses envtest Too -- With a Different Variable
The operator's `make test` is pure unit tests, but `make test-integration` runs `-tags=integration` tests against envtest and sets **`KUBEBUILDER_ASSETS`** (the controller-runtime convention) with `ENVTEST_K8S_VERSION=1.31.0`. So: `ENVTEST_ASSETS` for BFFs, `KUBEBUILDER_ASSETS` for operator integration tests. If you export the wrong one, the test can't find its API server. See [Make Targets](./make-targets#testing-three-layers).
:::

## Common Mistakes

The traps below account for most of the "why won't this work" time newcomers lose. Read them once now; they'll save you later.

### 1. Forgetting `make generate && make manifests`

**Symptom:** CI fails with "generated files are out of date," or the CRD doesn't reflect your type change.
**Fix:** After editing `api/v1alpha1/dashboard_types.go`, always run both, then commit any diff in `zz_generated.deepcopy.go` or `config/crd/bases/`. (See [Make Targets](./make-targets#codegen-the-targets-with-no-bff-equivalent).)

### 2. Hand-editing `config/crd/bases/`

**Symptom:** Your CRD tweak vanishes the next time someone runs `make manifests`.
**Fix:** Never edit generated CRD YAML. Change the Go types and kubebuilder markers in `api/v1alpha1/`, then regenerate.

### 3. Blocking in `Reconcile`

**Symptom:** Reconciliation hangs; other resources stop being processed.
**Fix:** The reconciler runs one goroutine per controller -- blocking it blocks everything. Never `time.Sleep`; return a requeue instead:

```go
// Bad -- freezes the controller
time.Sleep(30 * time.Second)

// Good -- yields, and controller-runtime re-invokes you later
return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
```

### 4. `fmt.Errorf` without `%w`

**Symptom:** `errors.Is()` / `errors.As()` don't match your wrapped error.
**Fix:** Wrap with `%w`, not `%v` -- `%w` preserves the error chain so callers can inspect it without string matching:

```go
return fmt.Errorf("failed to deploy: %w", err)   // not %v
```

### 5. Missing `Owns()` registration (and cache scoping)

**Symptom:** The controller creates a new kind of resource, but doesn't react when something else deletes or edits it -- or reads of it fail outright.
**Fix:** Register `Owns()` for every resource type the controller creates, so changes to those objects trigger a reconcile. The real setup (`controller_setup.go`, trimmed) owns a long list, some with predicates to ignore noise:

```go
ctrl.NewControllerManagedBy(mgr).
    For(&v1alpha1.Dashboard{}).
    Owns(&appsv1.Deployment{}).
    Owns(&corev1.Service{}, builder.WithPredicates(serviceChangedPredicate())).
    Owns(&corev1.ServiceAccount{}).
    Owns(&networkingv1.NetworkPolicy{}).
    Owns(&rbacv1.ClusterRole{}).
    Owns(&rbacv1.ClusterRoleBinding{}).
    Owns(&rbacv1.Role{}).
    Owns(&rbacv1.RoleBinding{}).
    Owns(&policyv1.PodDisruptionBudget{}, builder.WithPredicates(podDisruptionBudgetChangedPredicate()))
    // ... plus Watches(...), then addConfigMapWatches and optional owned types
```

ConfigMaps are **not** `Owns()`: they get dedicated caches in `controller_configmaps.go` (`addConfigMapWatches`). And the manager's shared cache is scoped by `ManagerCacheOptions` (`controller_cache.go`) to labelled, owned resources -- it rejects reads for types without a registered informer. A new owned type must be registered there too, or reads fail.

### 6. Confusing `core-bff/bff/` with `dashboard-operator/`

**Symptom:** Applying controller-runtime patterns to BFF code, or HTTP-handler patterns to the operator.
**Fix:** They're separate modules with separate worlds -- don't cross the wires (more on core-bff in the [Core BFF section](/guide/core-bff/architecture)):

| Aspect | `dashboard-operator/` | `distributions/core-bff/bff/` |
|---|---|---|
| Pattern | Kubernetes operator | HTTP server |
| Framework | controller-runtime | httprouter + custom middleware |
| Entry point | Reconcile loop | HTTP request handlers |
| Testing | Fake client (unit), envtest (integration) | envtest + httptest |

### 7. Adding a module without updating the full chain

**Symptom:** The module resolves in the registry but never actually deploys (or lands in `ImagePullBackOff`).
**Fix:** The `moduleRegistry` entry in `modules.go` is the **single source of truth** -- but three *other* things must line up with it:

1. `modules.go` -- add the `ModuleDefinition` (ports, image key, DSC gate, inter-module deps).
2. `charts/dashboard/values.yaml` -- add the module's `relatedImages` entry, and the matching external `RELATED_IMAGE_*` in the opendatahub-operator.
3. `manifests/modules/<slug>/` -- create the standalone kustomize manifests.

::: warning No `module_deploy.go` / `support.go` Edits
Older notes tell you to also edit `support.go`'s `imagesMap` and `module_deploy.go`. **That's outdated.** In the current model those are derived from the `modules.go` registry -- adding a module needs *no* manual edits there. And build the image *before* registering the module, or the operator will deploy a Deployment that can't pull. The authoritative flow lives in the [Register a Module in the Operator](/tutorials/register-module-in-operator) tutorial and the [Modules & Federation](/guide/operator/modules-and-federation) chapter.
:::

### 8. Not running tests before committing

**Symptom:** A CI failure that a 30-second local run would have caught.
**Fix:** Run the same checks CI does, locally:

```bash
# Operator -- full pre-commit sweep
make lint && make test && make chart-validate

# BFF
make lint && make test
```

::: tip Key Takeaway
Reach for the right lever: `--log-level=debug` (BFF) or `--zap-log-level=debug` (operator) + structured fields for tracing, Delve (or the VS Code GUI) for stepping, `--mock-*` flags to isolate the layer you're investigating, and `setup-envtest` when tests can't find their API-server binaries (`ENVTEST_ASSETS` for BFFs, `KUBEBUILDER_ASSETS` for operator integration tests). Then internalize the Common Mistakes -- especially the codegen pair (#1), never blocking `Reconcile` (#3), and the corrected module-onboarding chain (#7, no `support.go`/`module_deploy.go` edits).
:::

::: info See Also
- [Make Targets](./make-targets) -- the commands referenced throughout this page
- [Monorepo Setup](./index) -- `go.work` so the debugger resolves symbols across modules
- [Operator Testing](/guide/operator/testing) -- envtest and fake-client patterns in depth
- [Inter-BFF Communication](/guide/deep-dive/inter-bff-communication) -- what `--mock-bff-clients` fakes
- [Register a Module in the Operator](/tutorials/register-module-in-operator) -- the correct onboarding chain (Mistake #7)
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Why pass log values as key-value fields instead of `fmt.Sprintf`-ing them into the message?
- [ ] How do you pass flags to your program (not to Delve) when running `dlv debug`?
- [ ] How do the `--mock-*` flags help you *debug*, not just develop?
- [ ] What does "envtest binaries not found" mean, and which variable does a BFF vs. the operator's `make test-integration` use to find them?
- [ ] Why must you run `make generate && make manifests` after a type change?
- [ ] In the current model, which files do you *not* edit when onboarding a module?

</div>
