# Make Targets

> **The commands you'll actually type** -- BFF and operator Makefiles side by side, what each target does, and the operator's codegen targets that have no BFF equivalent.

Every Go module in the repo drives its build, test, and lint through `make`, not raw `go` commands. That's not ceremony -- the make targets encode the flags you'd otherwise forget (envtest asset paths, ldflags version injection, the exact `golangci-lint` config). Learn the targets and you never have to remember the flags.

This page puts the BFF and operator workflows next to each other so you can see where they overlap (`build`/`test`/`lint`) and where they diverge (the operator's `generate`/`manifests` codegen has no BFF counterpart; the BFF's mock flags have no operator counterpart).

::: info Think npm Scripts, Not Webpack
If `make dev-bff` feels foreign, map it onto what you know: a Makefile target is just a named script, exactly like an entry in `package.json`'s `"scripts"`. `make test` is `npm test`; `make build` is `npm run build`. The difference is only the runner (`make` vs `npm run`) -- the *idea* is identical.
:::

## The Shared Trio: `build`, `test`, `lint`

Every module -- operator and BFF alike -- has these three, and they mean the same thing everywhere:

| Target | What it does |
|---|---|
| `make build` | Compile the binary into `bin/` (BFFs run `fmt vet test` first) |
| `make test` | Run the test suite (the operator adds `-race` and coverage; BFFs don't) |
| `make lint` / `make lint-fix` | Run `golangci-lint` v2 (check / auto-fix) |

The difference is *what gets compiled and how it's tested* -- which is where the two worlds split.

## BFF Make Targets

BFFs are HTTP servers. Their Makefiles are about running a dev server, toggling mocks, and validating the API contract. This section uses the [Core BFF](/guide/core-bff/) (`distributions/core-bff/`) as the reference; module BFFs have the same Go-layer targets but their own extras (gen-ai, for instance, adds `debug` for Delve and `mlflow-up` / `llamastack-up` to start local upstreams). There are **two layers** of Makefile:

- The **top-level `Makefile`** (`distributions/core-bff/Makefile`) orchestrates BFF + frontend together and handles Docker.
- The **`bff/Makefile`** (`distributions/core-bff/bff/Makefile`) has the Go-specific targets.

### Running the dev server

```bash
# From distributions/core-bff/ -- start BFF + frontend together
make dev-start

# BFF only (listens on :4000)
make dev-bff
```

### Mock mode -- develop without a cluster

This is the single most useful BFF workflow feature. In core-bff, `make dev-bff` **is** mock mode: it starts the BFF with every backend faked, so a frontend developer needs no cluster, no `kubectl`, no upstream services. Under the hood it runs:

```bash
cd bff && make run PORT=4000 MOCK_K8S_CLIENT=true MOCK_HTTP_CLIENT=true \
  DEV_MODE=true DEPLOYMENT_MODE=standalone AUTH_METHOD=disabled
```

which `bff/Makefile` turns into these flags on the binary:

```bash
--mock-k8s-client     # envtest-backed fake Kubernetes API
--mock-http-client    # Canned upstream HTTP responses
--auth-method=disabled
```

core-bff also has `--mock-bff-clients` (mock inter-BFF clients, see the [inter-BFF chapter](/guide/deep-dive/inter-bff-communication)), but `dev-bff` doesn't pass it. The federated variants (`dev-bff-federated`, `dev-bff-federated-mock`, `dev-start-federated`, `dev-start-mock-federated`) run the same thing in federated deployment mode.

::: tip This Is `jest.mock()` for the Whole Backend
Mock mode is the backend equivalent of mocking every dependency in a Jest test -- the BFF returns realistic canned data so you can build and click through the UI in complete isolation. It's what makes frontend-only development possible against a Go BFF.
:::

### Testing and the contract check

```bash
# From bff/ -- unit + integration tests
make test        # fmt + vet, then ENVTEST_ASSETS=... go test ./...
```

BFF `make test` is plain `go test ./...` -- no `-race`, no coverage file. What it does add is **envtest** (a real kube-apiserver + etcd started locally): the Makefile downloads the binaries and exports their path as `ENVTEST_ASSETS` for you (see [Debugging](./debugging#envtest-binary-setup) for the manual version). Add `-race` yourself when hunting a concurrency bug.

Then there's the **contract test**, which has no operator equivalent:

```bash
# From distributions/core-bff/ -- validate responses against the OpenAPI spec
pnpm run test:contract
```

It boots the BFF in mock mode, fires HTTP requests, and asserts every response matches the OpenAPI schema the frontend was coded against -- catching API drift (missing fields, wrong types, extra fields, wrong status codes) before it reaches a reviewer. In core-bff it runs twice, once per platform: `test:contract:openshift` and `test:contract:xks`, each with `BFF_MOCK_FLAGS='--mock-k8s-client --mock-http-client --auth-method=user_token --platform-type=...'`.

### BFF quick reference

```bash
# distributions/core-bff/Makefile (top-level)
make dev-start         # BFF + frontend dev servers (mock mode)
make dev-bff           # BFF only, mock mode, auth disabled, :4000
make dev-frontend      # Frontend dev server only
make build             # Build everything (frontend + BFF)
make docker-build      # Build container image (also -standalone / -federated)
make run-local-mocked  # Build, then run the standalone bundle mocked

# distributions/core-bff/bff/Makefile (Go layer)
make build             # fmt + vet + test, then go build -o bin/bff ./cmd
make test              # go test ./... with ENVTEST_ASSETS
make lint / lint-fix   # golangci-lint v2
make run               # Run BFF with full flag passthrough
make fmt / vet         # go fmt / go vet
make clean             # Remove build artifacts
```

## Operator Make Targets

The operator's Makefile has everything the BFF has *plus* a codegen layer that the BFF completely lacks -- because the operator owns Kubernetes types, and Kubernetes types generate code.

### Version injection at build time

```bash
# From dashboard-operator/
make build
```

`make build` injects the version into the binary via `-ldflags`:

```bash
# SAFE_VERSION = git describe --tags --always --dirty, sanitized
go build -ldflags "-X .../internal/controller.Version=$(SAFE_VERSION)" \
    -o bin/manager ./cmd/manager
```

The `Version` variable shows up in the operator's status reporting, so the running controller reports the exact git tag/commit it was built from. (BFFs generally don't do this -- it's an operator idiom.)

### Testing -- three layers

The operator has three test targets, from fastest to most realistic:

```bash
make test               # fmt + vet + go test -race -coverprofile=cover.out ./...
make test-integration   # envtest: -tags=integration, KUBEBUILDER_ASSETS set for you
make test-e2e           # real cluster: -tags=e2e, needs KUBECONFIG + TEST_NAMESPACE
```

- **Unit** (`make test`) -- fake clients and direct function calls, no API server. Fast, and what you run on every change.
- **Integration** (`make test-integration`) -- runs `./internal/controller/...` against **envtest**, with `ENVTEST_K8S_VERSION=1.31.0` binaries downloaded into `bin/k8s` and exported as `KUBEBUILDER_ASSETS`. Test files carry the `integration` build tag, so plain `go test` skips them.
- **End-to-end** (`make test-e2e`) -- builds and runs the `e2e`-tagged suite in `test/e2e/` against the cluster `KUBECONFIG` points at, with its own Dashboard fixture in `TEST_NAMESPACE`. There is also `make test-e2e-chaos` (destructive operator-chaos scenarios; requires `TEST_ENABLE_CHAOS=true` plus gateway and operator-namespace variables) and `make build-e2e` / `make e2e-image` to package the suite.

See the [operator testing chapter](/guide/operator/testing) for the fake-client + `export_test.go` patterns.

### Codegen -- the targets with no BFF equivalent

This is the part that trips up everyone new to the operator. Whenever you edit `api/v1alpha1/dashboard_types.go`, the generated code and CRD YAML go stale, and **CI fails if they're out of sync**. Two targets fix that:

```bash
make generate    # controller-gen object -> regenerates zz_generated.deepcopy.go
make manifests   # controller-gen crd    -> regenerates config/crd/bases/*.yaml
```

- `make generate` writes the `DeepCopy` methods every Kubernetes type needs so the runtime can clone objects safely.
- `make manifests` reads your kubebuilder markers and emits the CRD's OpenAPI v3 schema, validation rules, and print columns.

::: danger Always Run Both After a Type Change
This is the #1 mistake for new operator contributors. After editing `dashboard_types.go`:

```bash
cd dashboard-operator
make generate && make manifests
git diff api/v1alpha1/zz_generated.deepcopy.go config/crd/bases/
```

If either changed, **commit it alongside your type change**. Never hand-edit `config/crd/bases/` -- your edits get blown away the next time anyone runs `make manifests`. Edit the Go types and markers; regenerate.
:::

### Chart sync and validation

The CRD YAML also lives in the Helm chart, so after regenerating you sync and validate:

```bash
make sync-chart-crds    # Copy CRD into charts/dashboard/crds/
make chart-validate     # = chart-lint (helm lint) + chart-template (helm template)
make check-chart-crds   # Fail if the chart CRD differs from the generated one (CI guard)
```

### Container image (cross-compiling from Apple Silicon)

```bash
cd dashboard-operator
make docker-build IMG=<registry>/<image>:<tag>
```

It runs `docker build --build-arg OPERATOR_VERSION=$(SAFE_VERSION) -t $(IMG) -f Dockerfile ..` -- note the build context is the **repo root** (`..`), because the image needs files outside `dashboard-operator/`. Deploying to an amd64 cluster from an M1/M2 Mac? Build for the target platform explicitly:

```bash
docker build --platform linux/amd64 --build-arg OPERATOR_VERSION=dev -t $(IMG) -f Dockerfile ..
```

(The full build-and-deploy flow is its own tutorial: [Build & Deploy the Operator](/tutorials/build-and-deploy-operator).)

### Operator quick reference

```bash
# dashboard-operator/Makefile
make build           # Build manager binary (with ldflags version)
make test            # fmt + vet + go test -race (unit)
make test-integration # envtest integration tests
make test-e2e        # real-cluster E2E (KUBECONFIG, TEST_NAMESPACE)
make test-e2e-chaos  # destructive chaos E2E (TEST_ENABLE_CHAOS=true, ...)
make chaos-validate  # validate chaos knowledge model + experiments
make lint / lint-fix # golangci-lint v2
make generate        # controller-gen object (DeepCopy)
make manifests       # controller-gen crd (CRD YAML)
make sync-chart-crds # Copy CRD into the Helm chart
make chart-validate  # chart-lint + chart-template
make check-chart-crds # Diff guard: chart CRD vs generated CRD
make docker-build    # Build container image (context: repo root)
make build-e2e / e2e-image # Package the E2E suite
make run             # Run controller locally (needs --namespace, --manifests-base-path)
make clean           # Remove build artifacts
```

## Side by Side

| Concern | BFF | Operator |
|---|---|---|
| Build | `make build` | `make build` (+ ldflags version) |
| Test | `make test` (envtest, no `-race`) | `make test` (unit) + `test-integration` (envtest) + `test-e2e` |
| Lint | `make lint` / `lint-fix` | `make lint` / `lint-fix` |
| Dev server | `make dev-bff` (mock mode) / `make run` | `make run` (needs flags) |
| Mock backends | `--mock-*` flags | -- (none) |
| API validation | `pnpm run test:contract` | -- (none) |
| Codegen | -- (none) | `make generate` / `make manifests` |
| Chart | -- | `make sync-chart-crds` / `chart-validate` |

::: tip Key Takeaway
`build`/`test`/`lint` mean the same thing in every module. What differs: BFFs add `--mock-*` flags and `pnpm run test:contract`; the operator adds `-ldflags` version injection and, crucially, the `make generate` + `make manifests` codegen pair you **must** run after any CRD type change (CI fails otherwise). When unsure which target to run, `make test && make lint` is always safe before a commit -- the operator adds `make chart-validate` to that.
:::

::: info See Also
- [Monorepo Setup](./index) -- why you run these from inside a module, not the root
- [Debugging](./debugging) -- envtest asset setup, mock flags in detail, Delve
- [Operator Testing](/guide/operator/testing) -- the fake-client patterns behind `make test`
- [Core BFF](/guide/core-bff/) -- the reference BFF used on this page
- [Build & Deploy the Operator](/tutorials/build-and-deploy-operator) -- the full image + Helm flow
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Which three targets exist in every module, and what do they do?
- [ ] What do `make dev-bff` and the `--mock-*` flags let a frontend developer skip?
- [ ] What does `pnpm run test:contract` catch, and why is there no operator equivalent?
- [ ] What are the operator's three test layers, and which one needs a real cluster?
- [ ] What must you run after editing `dashboard_types.go`, and why does CI fail if you don't?
- [ ] Why should you never hand-edit `config/crd/bases/`?

</div>
