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
| `make build` | Compile the binary into `bin/` |
| `make test` | Run the test suite (with `-race` and coverage) |
| `make lint` / `make lint-fix` | Run `golangci-lint` v2 (check / auto-fix) |

The difference is *what gets compiled and how it's tested* -- which is where the two worlds split.

## BFF Make Targets

BFFs are HTTP servers. Their Makefiles are about running a dev server, toggling mocks, and validating the API contract. Using `distributions/core-bff/` as the reference, there are **two layers** of Makefile:

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

This is the single most useful BFF workflow feature. `make dev-bff-mock` starts the BFF with every backend faked, so a frontend developer needs no cluster, no `kubectl`, no upstream services:

```bash
make dev-bff-mock
```

Under the hood it passes mock flags to the binary:

```bash
--mock-k8s-client     # In-memory fake Kubernetes client
--mock-http-client    # Canned upstream HTTP responses
--mock-bff-clients    # Mock inter-BFF clients (see the inter-BFF chapter)
```

::: tip This Is `jest.mock()` for the Whole Backend
Mock mode is the backend equivalent of mocking every dependency in a Jest test -- the BFF returns realistic canned data so you can build and click through the UI in complete isolation. It's what makes frontend-only development possible against a Go BFF.
:::

### Testing and the contract check

```bash
# From bff/ -- unit + integration tests
make test        # go test -race -coverprofile=cover.out ./...
```

The `-race` flag turns on Go's race detector (catches concurrent-access bugs); `-coverprofile` writes a coverage report. Some BFFs also use **envtest** (a real in-process API server) -- the Makefile wires up the `KUBEBUILDER_ASSETS` path for you (see [Debugging](./debugging#envtest-binary-setup) for the manual version).

Then there's the **contract test**, which has no operator equivalent:

```bash
# From distributions/core-bff/ -- validate responses against the OpenAPI spec
npm run test:contract
```

It boots the BFF in mock mode, fires HTTP requests, and asserts every response matches the OpenAPI schema the frontend was coded against -- catching API drift (missing fields, wrong types, extra fields, wrong status codes) before it reaches a reviewer.

### BFF quick reference

```bash
# distributions/core-bff/Makefile (top-level)
make dev-start         # BFF + frontend dev servers
make dev-bff           # BFF only
make dev-bff-mock      # BFF with all mocks
make dev-frontend      # Frontend dev server only
make build             # Build everything
make docker-build      # Build container image

# distributions/core-bff/bff/Makefile (Go layer)
make build             # Build BFF binary -> bin/
make test              # go test (with envtest where used)
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
go build -ldflags "-X .../controller.Version=$(git describe --tags)" \
    -o bin/manager ./cmd/manager
```

The `Version` variable shows up in the operator's status reporting, so the running controller reports the exact git tag/commit it was built from. (BFFs generally don't do this -- it's an operator idiom.)

### Testing -- pure unit tests, no envtest

```bash
make test
```

which runs, in order:

```bash
go fmt ./...     # Format first
go vet ./...     # Static analysis
go test -race -coverprofile=cover.out ./...
```

::: info Operator Tests Don't Use envtest
Unlike the BFFs, the operator's tests are **pure unit tests** -- fake clients and direct function calls, no in-process API server. That's why they're fast and need no `KUBEBUILDER_ASSETS`. See the [operator testing chapter](/guide/operator/testing) for the fake-client + `export_test.go` patterns.
:::

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
make chart-validate     # helm lint + helm template
```

### Container image (cross-compiling from Apple Silicon)

```bash
make docker-build
```

Deploying to an amd64 cluster from an M1/M2 Mac? Build for the target platform explicitly:

```bash
docker build --platform linux/amd64 -t $(IMG) -f Dockerfile ..
```

(The full build-and-deploy flow is its own tutorial: [Build & Deploy the Operator](/tutorials/build-and-deploy-operator).)

### Operator quick reference

```bash
# dashboard-operator/Makefile
make build           # Build manager binary (with ldflags version)
make test            # fmt + vet + go test -race
make lint / lint-fix # golangci-lint v2
make generate        # controller-gen object (DeepCopy)
make manifests       # controller-gen crd (CRD YAML)
make sync-chart-crds # Copy CRD into the Helm chart
make chart-validate  # helm lint + helm template
make docker-build    # Build container image
make run             # Run controller locally (needs --namespace, --manifests-base-path)
make clean           # Remove build artifacts
```

## Side by Side

| Concern | BFF | Operator |
|---|---|---|
| Build | `make build` | `make build` (+ ldflags version) |
| Test | `make test` (may use envtest) | `make test` (pure unit, fmt+vet first) |
| Lint | `make lint` / `lint-fix` | `make lint` / `lint-fix` |
| Dev server | `make dev-bff` / `dev-bff-mock` | `make run` (needs flags) |
| Mock backends | `--mock-*` flags | -- (none) |
| API validation | `npm run test:contract` | -- (none) |
| Codegen | -- (none) | `make generate` / `make manifests` |
| Chart | -- | `make sync-chart-crds` / `chart-validate` |

::: tip Key Takeaway
`build`/`test`/`lint` mean the same thing in every module. What differs: BFFs add `--mock-*` flags and `npm run test:contract`; the operator adds `-ldflags` version injection and, crucially, the `make generate` + `make manifests` codegen pair you **must** run after any CRD type change (CI fails otherwise). When unsure which target to run, `make test && make lint` is always safe before a commit -- the operator adds `make chart-validate` to that.
:::

::: info See Also
- [Monorepo Setup](./index) -- why you run these from inside a module, not the root
- [Debugging](./debugging) -- envtest asset setup, mock flags in detail, Delve
- [Operator Testing](/guide/operator/testing) -- the fake-client patterns behind `make test`
- [Build & Deploy the Operator](/tutorials/build-and-deploy-operator) -- the full image + Helm flow
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Which three targets exist in every module, and what do they do?
- [ ] What do `make dev-bff-mock` and the `--mock-*` flags let a frontend developer skip?
- [ ] What does `npm run test:contract` catch, and why is there no operator equivalent?
- [ ] What must you run after editing `dashboard_types.go`, and why does CI fail if you don't?
- [ ] Why should you never hand-edit `config/crd/bases/`?

</div>
