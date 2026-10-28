# Tutorial 8: Register a Module in the Operator

In the last tutorial you scaffolded a federated module and ran it on your laptop. But a laptop is not a cluster. For your module to ship, two things have to exist that `mod-arch-installer` does *not* create:

1. **Standalone deployment manifests** -- the Kubernetes YAML (Deployment, Service, RBAC, NetworkPolicy) that runs your module's image in a pod.
2. **An operator registry entry** -- so the dashboard-operator knows your module exists, deploys it, wires its proxy path into the federation ConfigMap, and resolves its image.

The `/module-onboarding` skill now covers both: Phase 6 writes the deployment manifests and Phase 7 registers the module in the operator. The build pipeline and image publishing stay with `/konflux-onboarding`. This tutorial walks through what those phases do, so the generated YAML and the Go edit are not a black box.

**Time:** ~35 minutes

::: warning Read This First -- The Corrected Model
The `module-onboarding` skill's Phase 7 still tells you to edit a `moduleProxyPaths` map in `module_deploy.go` and `imagesMap` in `support.go` by hand. **That text is stale** -- `moduleProxyPaths` no longer exists. The `moduleRegistry` map in `dashboard-operator/internal/controller/modules.go` is the *single source of truth*: proxy paths (`ProxyPaths`, or the `/<slug>/api` default via `proxyPathsFor`), the image env var (`support.go` fills `imagesMap` from the registry in `init()`), DSC gates, inter-module deps and inter-BFF deps all live in one struct. You add **one** entry to `modules.go`. You do **not** touch `module_deploy.go` or `support.go`. See the struct doc comment at `dashboard-operator/internal/controller/modules.go:13`.
:::

::: info The React Analogy
Registering with the operator is like adding your micro-frontend to the deployment config that the CI/CD pipeline reads -- the shell already knows how to *mount* a remote (Tutorial 7); now the platform needs to know how to *ship* one. The registry entry is that deployment manifest, expressed once in Go.
:::

## The Ordering Rule: Buildable Image First

Before anything else, internalize the sequence. The operator deploys your module by pulling its **container image**. If you register the module before the image exists in a registry, every pod it creates hits `ImagePullBackOff` and the reconcile loop churns.

```
1. Module builds in CI  ──▶  2. Image published  ──▶  3. Register in operator
   (Tutorial 7)                (Konflux pipeline)        (this tutorial)
```

So the real order is: get the module building and its image published (the Konflux pipeline work), *then* add the registry entry. This tutorial covers steps 2's manifests and step 3; the pipeline plumbing is in `.claude/skills/konflux-onboarding/references/pipeline-templates.md`.

## Step 1: Create the Standalone Manifests

Each module gets a directory under `manifests/modules/<manifest-slug>/`. The slug is the kebab-case name (`my-module`). Copy an existing module's manifests as your template -- `eval-hub` is a clean, BFF-having example:

```bash
cp -r manifests/modules/eval-hub manifests/modules/my-module
```

**What you should see:** a new directory with exactly these eight files:

```
manifests/modules/my-module/
├── cluster-role.yaml           # ClusterRole -- the permissions the module's SA needs
├── cluster-role-binding.yaml   # Binds the ClusterRole to the ServiceAccount
├── deployment.yaml             # The Deployment -- pod spec, container, ports, probes
├── kustomization.yaml          # Ties the files together + sets the image
├── networkpolicy.yaml          # Restricts ingress to the module's port
├── params.env                  # Image ref parameter (patched at build time)
├── service-account.yaml        # The SA the pod runs as
└── service.yaml                # The Service the operator's federation config points at
```

Now find-and-replace the old module's identifiers with yours. Every file references `eval-hub` / `eval-hub-ui` / port `8543` -- replace with `my-module` / `my-module-ui` / your allocated service port. The registry uses 8043…8843 and 9043…9243, with 8443 (kube-rbac-proxy) and 8943 (core-bff) reserved, so the next free one is **`9343`**:

```bash
cd manifests/modules/my-module
grep -rl 'eval-hub' . | xargs sed -i '' 's/eval-hub/my-module/g'   # macOS sed
# Then hand-fix the port and container name to your values
```

::: warning The Manifest Port Must Match Three Places
`service.yaml` `targetPort`, `deployment.yaml` `containerPort`, and the `modules.go` `Port` (Step 2) must all be your allocated service port. This is the same port from your `package.json` `module-federation.service.port` in Tutorial 7. Four files, one number -- keep them identical or the Service routes to a dead port.
:::

Check the files carefully:

- **`deployment.yaml`** -- container name (`my-module-ui`), `containerPort`, liveness/readiness probe paths, and the env vars the BFF reads.
- **`service.yaml`** -- `name: odh-dashboard-my-module-ui`, port + `targetPort`.
- **`kustomization.yaml`** -- `images:` block pointing at `params.env`'s image ref, and the `resources:` list naming all the other files.
- **`params.env`** -- the `my-module-ui-image` key (`<slug>-ui-image`, the same key `support.go` derives) with the default image ref. The operator overwrites it from `RELATED_IMAGE_*` when that env var is set.
- **`networkpolicy.yaml`** -- ingress on your port from the main dashboard pod (`deployment in (odh-dashboard, rhods-dashboard)`) and the ingress policy group. If another BFF will call yours, add that caller here too, or its requests time out.

Then register the directory in the parent kustomization:

```bash
# manifests/modules/kustomization.yaml -- add your module to resources:
#   - my-module
```

## Step 2: Add the Registry Entry (One Struct, One File)

This is the single Go edit. Open `dashboard-operator/internal/controller/modules.go` and add an entry to the `moduleRegistry` map. Model it on the `automl` entry (around `modules.go:88`):

```go
"myModule": {                        // camelCase key = the Module Federation name
    Name:          "myModule",       // must match the key
    ContainerName: "my-module-ui",   // must match deployment.yaml's container name
    Port:          9343,             // must match service.yaml / package.json service port
    ImageEnvVar:   "RELATED_IMAGE_ODH_MOD_ARCH_MY_MODULE_IMAGE",  // the RELATED_IMAGE_* contract
    ManifestSlug:  "my-module",      // must match manifests/modules/<slug>/
    TLS:           true,             // true if the module serves HTTPS in-cluster
    RequiredDSCComponents: []string{"aipipelines"},  // DSC gate -- omit if always-on
    // InterModuleDependencies: []string{"genAi"},   // optional -- gate on another module running
    // ProxyPaths:  []proxyRoute{{Path: "/_bff/my-module/api", PathRewrite: "/api"}}, // optional custom path
    // RequiredByMaaSPortal: true,  // only if the MaaS Portal needs this module
},
```

What each field controls -- this is *why* one struct replaces the old scattered edits:

| Field | Drives | If omitted |
|-------|--------|-----------|
| `Name` / key | The federation ConfigMap module name | -- (required) |
| `ContainerName` | Stale-container cleanup (readiness comes from the module Deployment, via `overlayStandaloneReadiness`) | -- (required) |
| `Port` | The Service port the federation proxy targets | -- (required) |
| `ImageEnvVar` | Image resolution -- read from the operator's env at reconcile | pod has no image |
| `ManifestSlug` | Which `manifests/modules/<slug>/` to apply | -- (required) |
| `ProxyPaths` | The Fastify/federation proxy route | defaults to `/<slug>/api → /api` |
| `RequiredDSCComponents` | DSC gate -- module only deploys if these DSC components are on | always deploys |
| `InterModuleDependencies` | Deploy gate -- waits for another module to be running | no dependency |
| `InterBFFDeps` | Writes `BFF_<TARGET>_SERVICE_*` keys into your `<slug>-params` ConfigMap; consume them with `envFrom` (Tutorial 6) | no inter-BFF wiring |
| `RequiredByMaaSPortal` | Keeps the module deployed while a Managed MaaS Portal needs it, even if the core dashboard is `Removed` | not kept for the portal |
| `TLS` | Federation entry uses `https` to your Service | plain HTTP |

::: tip Default Proxy Path Is Usually What You Want
The doc comment at `modules.go:17` spells it out: `ProxyPaths` nil means the default `/<ManifestSlug>/api → /api`. Only set `ProxyPaths` if your module needs a non-standard route (like `mlflow`'s `/_bff/mlflow/api`). Most modules leave it out.
:::

## Step 3: Bump the Registry Count Test

The operator has a guard test asserting the exact registry size, so a stray or missing entry fails CI loudly. Open `dashboard-operator/internal/controller/modules_test.go` and update the count (`modules_test.go:508`):

```go
assert.Len(t, moduleRegistry, 12, "expected 12 modules in registry")  // was 11
```

While you're in that file, add `"myModule"` in alphabetical order to the expected list in `TestModuleNames`, and bump the `wantLen` values in `TestResolveModuleStatuses` by one.

**What you should see** after adding your entry and bumping the number:

```bash
cd dashboard-operator
go test ./internal/controller/ -run TestModuleRegistry -v
```

```
=== RUN   TestModuleRegistry
--- PASS: TestModuleRegistry (0.00s)
PASS
ok      github.com/opendatahub-io/odh-dashboard/dashboard-operator/internal/controller
```

If it fails with *"expected 11 ... got 12"*, you forgot to bump the count. If it fails the other way, your entry did not register -- check for a duplicate key.

## Step 4: Wire the RELATED_IMAGE Contract

`ImageEnvVar` (`RELATED_IMAGE_ODH_MOD_ARCH_MY_MODULE_IMAGE`) is a **contract** with the external `opendatahub-operator`. At runtime, that operator injects the env var into the dashboard-operator's pod, and the reconciler reads it to know which image digest to deploy. Two ends must agree:

1. **In this repo** -- add `RELATED_IMAGE_ODH_MOD_ARCH_MY_MODULE_IMAGE: ""` to `relatedImages:` in `dashboard-operator/charts/dashboard/values.yaml`, alphabetically. The empty value is deliberate: the chart only injects non-empty values, so by default the digest in `params.env` wins. Then run `make chart-validate` in `dashboard-operator/` to lint and render the chart.
2. **In `opendatahub-operator`** -- a separate PR adds `RELATED_IMAGE_ODH_MOD_ARCH_MY_MODULE_IMAGE` to `relatedImages()` in `internal/controller/modules/dashboard/support.go`, plus an image entry in `manifests-config.yaml`. Until that merges, the ODH Operator never injects the env var into the dashboard-operator's Deployment, and your module silently runs the default image from `params.env`.

::: warning Two Repos, Two PRs
The registry entry (this repo) references an env var that a *different* repo must define. Open the `opendatahub-operator` PR early -- it is the long pole. Note it in your module's onboarding checklist so review does not stall waiting on it. See `.claude/skills/konflux-onboarding/references/devops-integration.md`.
:::

## Step 5: Verify the Operator Builds and Reconciles

Compile the operator and run the module-facing tests:

```bash
cd dashboard-operator
go build ./...              # operator compiles with your entry
make test                   # unit tests (fake client, pure functions)
make test-integration       # envtest suites, behind //go:build integration
```

**What you should see:** a clean build and passing tests. Plain `go test` and `make test` do **not** run the envtest suites (`deployment_integration_test.go`, `federation_integration_test.go`): they carry the `integration` build tag, and only `make test-integration` sets it and downloads the API server binaries. Those suites exercise the reconcile pipeline against an in-process API server -- if your entry is malformed (bad port, missing slug), they catch it before a real cluster does.

## How the Operator Deploys It From Here

Once registered, your module flows through the reconcile pipeline automatically. No further code:

```
Dashboard CR reconcile
      │
      ├─▶ resolve module image from RELATED_IMAGE_ODH_MOD_ARCH_MY_MODULE_IMAGE
      ├─▶ check RequiredDSCComponents + InterModuleDependencies gates
      ├─▶ apply manifests/modules/my-module/ (Deployment, Service, RBAC, NetworkPolicy)
      ├─▶ check its Deployment is Available (overlayStandaloneReadiness)
      ├─▶ add module + proxy path to the federation-config ConfigMap
      └─▶ SHA-256 hash the ConfigMap → rolling-restart the dashboard if it changed
```

The federation ConfigMap + content-hash restart is how a newly-registered module appears in the running dashboard without a manual redeploy. See [Modules & Federation](../guide/operator/modules-and-federation) for the full mechanism.

---

<div class="checkpoint">

#### Checkpoint

Before moving on, verify:

- [ ] `manifests/modules/my-module/` has all 8 files with your name/port/container substituted
- [ ] `manifests/modules/kustomization.yaml` lists `my-module` in `resources:`
- [ ] One entry added to `moduleRegistry` in `modules.go` -- and **no** edits to `module_deploy.go` / `support.go`
- [ ] Port `9343` (or the next free one) used in `modules.go`, `deployment.yaml`, `service.yaml`, `networkpolicy.yaml` and `package.json`
- [ ] The count in `modules_test.go` bumped (11 → 12), `TestModuleNames` updated, and `TestModuleRegistry` passes
- [ ] `charts/dashboard/values.yaml` has the module's related-image entry, and `make chart-validate` passes
- [ ] The `opendatahub-operator` PR (`relatedImages()` + `manifests-config.yaml`) is opened (or tracked)
- [ ] `cd dashboard-operator && go build ./... && make test && make test-integration` pass

</div>

::: info If You Get Stuck
- [Modules & Federation](../guide/operator/modules-and-federation) -- registry, dependency resolution, federation ConfigMap
- [The Reconciler](../guide/operator/reconciler) -- the reconcile pipeline your module now flows through
- `.claude/skills/module-onboarding/SKILL.md` (Phases 6-7) and `.claude/skills/konflux-onboarding/SKILL.md` (pipeline and images) -- the onboarding workflows; trust `modules.go` over the skill where they disagree
- `dashboard-operator/internal/controller/modules.go:13` -- the `ModuleDefinition` struct doc
:::

## What's Next

Your module is registered, but you have been testing against tests and envtest -- not a live operator in a real cluster. In the final tutorial, [Build & Deploy the Operator](./build-and-deploy-operator), you will build the operator image with Docker/Podman, deploy it and a `Dashboard` CR to a cluster, and run it in local dev mode so you can watch it reconcile your module for real.
