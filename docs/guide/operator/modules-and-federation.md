# Modules & Federation

> How the operator decides *which* modules to run, and how it tells the frontend where to find them. This is the payoff — the part that makes the dashboard modular.

Step 11 of the reconcile pipeline said "resolve module statuses" and moved on. This page unpacks that: the registry that defines every module, the three-pass algorithm that decides each module's fate, and the federation ConfigMap that wires deployed modules into the running frontend.

## The module registry is *code*, not config

Adding a module to the dashboard is a change to a Go map — not a CRD schema change, not a YAML edit. From `dashboard-operator/internal/controller/modules.go:13`:

```go
type ModuleDefinition struct {
    Name                    string   // unique id, camelCase, matches the map key
    ContainerName           string   // the container name in the pod spec
    Port                    int32    // the port the BFF listens on
    ImageEnvVar             string   // env var holding the image reference
    RequiredDSCComponents   []string // DSC components that must be available
    InterModuleDependencies []string // other modules that must be enabled
    ManifestSlug            string   // dir under manifests/modules/
}

var moduleRegistry = map[string]ModuleDefinition{
    "modelRegistry": {
        Name: "modelRegistry", ContainerName: "model-registry-ui", Port: 8043,
        ImageEnvVar:           "RELATED_IMAGE_ODH_MOD_ARCH_MODEL_REGISTRY_IMAGE",
        RequiredDSCComponents: []string{"modelregistry"},
        ManifestSlug:          "model-registry",
    },
    "genAi":    { /* :8143, no required components — always deployable */ },
    "maas":     { /* :8243, no required components */ },
    "mlflow":   { /* :8343, requires "mlflowoperator" */ },
    "evalHub":  { /* :8543, requires "trustyai" */ },
    "automl":   { /* :8643, requires "aipipelines" */ },
    "autorag":  { /* :8743, requires "aipipelines" AND depends on module "genAi" */ },
    "agentOps": { /* :8843, no required components */ },
}
```

Here's the full registry as a table — a useful reference when you onboard a module:

| Module | Container | Port | Requires DSC component | Depends on module |
|---|---|---|---|---|
| `modelRegistry` | model-registry-ui | 8043 | `modelregistry` | — |
| `genAi` | gen-ai-ui | 8143 | — | — |
| `maas` | maas-ui | 8243 | — | — |
| `mlflow` | mlflow-ui | 8343 | `mlflowoperator` | — |
| `evalHub` | eval-hub-ui | 8543 | `trustyai` | — |
| `automl` | automl-ui | 8643 | `aipipelines` | — |
| `autorag` | autorag-ui | 8743 | `aipipelines` | `genAi` |
| `agentOps` | agent-ops-ui | 8843 | — | — |

::: tip The Port Convention
Module BFF ports march in hundreds: 8043, 8143, 8243, … 8843. `8443` is reserved for `kube-rbac-proxy` and `8943` for `core-bff`. When you allocate a port for a new module, follow the pattern and check it doesn't collide (the [Onboard a Module](/tutorials/onboard-a-module) tutorial walks through port allocation).
:::

`autorag` is the interesting one — it shows both dependency kinds at once: it needs the `aipipelines` **DSC component** *and* the `genAi` **module**. If either is missing, `autorag` is disabled.

## Three-pass dependency resolution

`resolveModuleStatuses` (lines 80–171) is a pure function: give it a `DashboardSpec`, get back a `map[string]ModuleStatus`. Pure means trivially testable — no cluster, no client (see [Testing the Operator](./testing)). It runs three passes.

```
Pass 1: gate each module      → DSC components available? explicitly disabled?
Pass 2: propagate deps        → a disabled dep cascades to its dependents
Pass 3: catch typos           → unknown module names in spec.modules
```

### Pass 1 — component gate + explicit override

```go
for name, mod := range moduleRegistry {
    // (a) DSC component gate: every required component must be Managed/Unmanaged.
    for _, comp := range mod.RequiredDSCComponents {
        ca, exists := spec.Components[comp]
        if !exists || (ca.ManagementState != "Managed" && ca.ManagementState != "Unmanaged") {
            result[name] = ModuleStatus{Phase: ModulePhaseDisabled, Reason: "ComponentNotAvailable", ...}
            // ... skip to next module
        }
    }
    // (b) explicit admin override wins over automatic resolution.
    if override, ok := spec.Modules[name]; ok && override.State == ModuleDisabled {
        result[name] = ModuleStatus{Phase: ModulePhaseDisabled, Reason: "ExplicitOverride"}
        continue
    }
    // (c) survived both checks → tentatively Deployed.
    result[name] = ModuleStatus{Phase: ModulePhaseDeployed, Reason: "Deployed"}
}
```

::: warning The `nil` Map Special Case
If `spec.Components` is `nil` (the map was never provided), the component gate is **skipped** — modules are assumed available. This matters for tests and for platforms that don't project components. Reading a missing key from a `nil` map is safe in Go (returns the zero value); *writing* to a `nil` map panics. That asymmetry is a classic operator gotcha — see [Gotchas](/reference/gotchas).
:::

### Pass 2 — cascade disabled dependencies

```go
changed := true
for changed {              // fixpoint loop: repeat until nothing changes
    changed = false
    for name, mod := range moduleRegistry {
        if result[name].Phase != ModulePhaseDeployed {
            continue
        }
        for _, dep := range mod.InterModuleDependencies {
            if s, ok := result[dep]; !ok || s.Phase == ModulePhaseDisabled || s.Phase == ModulePhaseNotDeployed {
                result[name] = ModuleStatus{Phase: ModulePhaseDisabled, Reason: "DependencyNotMet", ...}
                changed = true
            }
        }
    }
}
```

The loop runs until a full pass makes no changes. Each iteration can only *disable* modules (never re-enable), so it's guaranteed to terminate — at worst once per link in the dependency chain. This handles transitive chains: disable C, and B (depends on C) and A (depends on B) both fall.

**Worked example** — disabling `genAi` cascades to `autorag`:

```
spec.modules.genAi.state = Disabled
  → Pass 1: genAi   = Disabled (ExplicitOverride)
  → Pass 2: autorag = Disabled (DependencyNotMet, needs genAi)
            automl  = Deployed (unaffected — different deps)
```

### Pass 3 — catch typos

```go
for name := range spec.Modules {
    if _, known := moduleRegistry[name]; !known {
        result[name] = ModuleStatus{Phase: ModulePhaseNotDeployed, Reason: "UnknownModule",
            Message: fmt.Sprintf("Module %q is not in the controller's registry (possible typo)", name)}
    }
}
```

Write `modelregistry` (lowercase) instead of `modelRegistry` and it isn't silently ignored — it surfaces as `NotDeployed / UnknownModule` in the CR's status and `kubectl describe`. A small kindness that saves real debugging time.

## Container readiness overlay: desired vs actual

Resolution decides what *should* run. But a module can be `Deployed` in the plan and still be crash-looping in reality. `overlayContainerReadiness` (lines 176–235) reconciles the two by inspecting live pod container statuses and downgrading unhealthy modules to `Degraded`:

```go
for name, mod := range moduleRegistry {
    if statuses[name].Phase != ModulePhaseDeployed {
        continue // only overlay modules we expected to be up
    }
    cs, found := containerByName[mod.ContainerName]
    if !found {
        statuses[name] = ModuleStatus{Phase: ModulePhaseNotDeployed, ...}
    } else if !cs.Ready {
        reason := "ContainerNotReady"
        if cs.State.Waiting != nil {
            reason = cs.State.Waiting.Reason // e.g. "ImagePullBackOff", "CrashLoopBackOff"
        }
        statuses[name] = ModuleStatus{Phase: ModulePhaseDegraded, Reason: reason, ...}
    }
}
```

This catches the real-world failures: `ImagePullBackOff` (wrong tag/auth), `CrashLoopBackOff` (starts then dies), container missing from the pod spec. In Standalone mode a sibling function checks per-module *Deployment* health instead of container statuses.

::: info This Is the Whole Point of Status
The resolver is the "props → what should render" step; the overlay is the "did it actually mount and stay mounted?" step. Together they give the admin an honest `status.moduleStatuses` — not "I asked for it," but "here's what's actually up." That's the desired-vs-observed split from [The CRD](./the-crd), made concrete.
:::

## The federation ConfigMap

In **Standalone** mode each module runs in its own pod, so the frontend can't assume `localhost`. It needs a map of *where each module's `remoteEntry.js` and BFF API endpoint live*. That map is the **federation ConfigMap**, generated fresh each reconcile by `buildFederationConfigMap` (`module_deploy.go:375`).

For every deployed (or degraded) module it emits an entry; it always adds `coreBff`; it conditionally adds Perses and an embedded-mlflow entry; then it sorts for deterministic output and marshals to JSON:

```json
[
  {
    "name": "coreBff",
    "authorize": true, "tls": true,
    "proxyService": [{
      "path": "/core-bff/api", "pathRewrite": "/api",
      "service": {"name": "odh-dashboard", "namespace": "apps", "port": 8943}
    }]
  },
  {
    "name": "genAi",
    "remoteEntry": "/remoteEntry.js",
    "authorize": true, "tls": true,
    "proxy": [{"path": "/gen-ai/api", "pathRewrite": "/api"}],
    "service": {"name": "odh-dashboard-gen-ai-ui", "namespace": "apps", "port": 8143}
  }
]
```

The frontend mounts this ConfigMap as a volume and reads it to configure webpack Module Federation remotes and the backend's proxy routes. Each module's proxy paths come from a static `moduleProxyPaths` map — e.g. `/gen-ai/api/models` rewrites to `/api/models` and proxies to the genAi service on `:8143`.

::: info This Is the Operator↔Frontend Contract
The federation ConfigMap is the single runtime handshake between the operator and the frontend. The operator decides what's deployed and writes this JSON; the frontend reads it and wires up federation + proxying. Change the shape of this contract and both sides must agree — which is exactly why the operator generates it rather than shipping it as static config.
:::

## The SHA-256 hash trick: forcing a rolling restart

Kubernetes does **not** restart pods when a mounted ConfigMap changes. So when a module is added or removed and the federation ConfigMap changes, the frontend pod would keep serving the stale config. The operator's fix (`module_deploy.go:131`) is a classic:

```go
const federationHashAnnotation = "dashboard.opendatahub.io/federation-config-hash"

hash := computeFederationConfigHash(configData)         // sha256 of the JSON
current := deploy.Spec.Template.Annotations[federationHashAnnotation]
if current == hash {
    return nil                                          // unchanged → do nothing
}
patch := client.MergeFrom(deploy.DeepCopy())
deploy.Spec.Template.Annotations[federationHashAnnotation] = hash  // on the POD TEMPLATE
r.Patch(ctx, &deploy, patch)
```

The hash goes on the **pod template**, not the Deployment metadata. Changing the pod template is exactly what the Deployment controller watches for — so it triggers a normal rolling update. Same content → same hash → patch skipped, no churn. Different content → new hash → rolling restart that picks up the new ConfigMap.

::: tip You've Seen This Pattern Before
This is the "checksum annotation" trick Helm charts use (`checksum/config`) to roll pods on ConfigMap changes. The operator just computes it in Go instead of a template. Whenever you need "restart the pod when this external file changes," reach for a content hash on the pod template.
:::

## Inter-BFF env-var injection

Some module BFFs call *other* module BFFs (genAi → maas, for one). In Standalone mode the caller needs the callee's service name and port, injected as env vars via kustomize params (`module_deploy.go:86`):

```go
var interBFFDependencies = map[string][]interBFFDependency{
    "genAi": {{ EnvServiceName: "BFF_MAAS_SERVICE_NAME", EnvServicePort: "BFF_MAAS_SERVICE_PORT", TargetModule: "maas" }},
}
```

When genAi deploys and maas is available, genAi's container gets `BFF_MAAS_SERVICE_NAME=odh-dashboard-maas-ui` and `BFF_MAAS_SERVICE_PORT=8243`. If the target module isn't deployed, injection is skipped. The BFF side of this — the `bffclient` package that *reads* those vars — is covered in [Inter-BFF Communication](/guide/deep-dive/inter-bff-communication).

## The `RELATED_IMAGE_*` contract

Every module's `ImageEnvVar` uses the `RELATED_IMAGE_` prefix. That's not a style choice — it's a **Konflux / operator-framework contract**:

```go
ImageEnvVar: "RELATED_IMAGE_ODH_MOD_ARCH_GEN_AI_IMAGE"
```

The prefix tells OLM and the Konflux build system "this env var holds a container image reference," which unlocks:

- **Image pinning** — floating tags replaced with immutable digests at build time
- **Disconnected installs** — OLM can mirror every image for air-gapped clusters
- **Vulnerability scanning** — the build system knows which images to scan

The mapping from kustomize param keys to these env vars lives in `support.go`, and `resolveImageParams` reads the env vars to produce the params written to `params.env` before rendering.

::: warning Registration Order Matters
When you onboard a module, the buildable image and its `RELATED_IMAGE_*` wiring must exist *before* you flip the module on — otherwise the container lands in `ImagePullBackOff` and the readiness overlay marks it `Degraded`. The [Register a Module in the Operator](/tutorials/register-module-in-operator) tutorial covers the correct ordering.
:::

## Probe sanitization: an SSA sharp edge

One last subtlety, because it bites during upgrades. A Kubernetes probe may specify exactly one handler: `httpGet`, `tcpSocket`, `exec`, or `grpc`. When SSA changes a probe from `httpGet` to `tcpSocket`, it *adds* `tcpSocket` but doesn't *remove* the old `httpGet` — because SSA only manages fields you declare, and the stale field belongs to a different field owner. The API server then rejects the apply: "may not specify more than 1 handler type."

`sanitizeDeploymentProbes` (`probe_sanitize.go`) fixes this by pre-patching the live Deployment to `null` out stale handler types *before* the SSA apply runs, so by the time SSA fires there's only one handler. This is why `reconcileSidecar` sanitizes probes on live Deployments — an essential step for safe version upgrades.

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Where do you add a new module — a YAML file, the CRD, or a Go map?
- [ ] What do the three resolution passes each do, and why is Pass 2 guaranteed to terminate?
- [ ] What's the difference between a module's *resolved* status and its *overlaid* status?
- [ ] What does the federation ConfigMap tell the frontend, and why does the operator regenerate it every reconcile?
- [ ] Why put the content hash on the pod template instead of the Deployment metadata?
- [ ] What three things does the `RELATED_IMAGE_*` prefix unlock?

</div>

::: info What's Next
Next: **[ODH Operator Connection](./odh-operator-connection)** — where `spec.components` actually comes from, the `ModuleHandler` interface, and why this is a two-level architecture.
:::

::: info See Also
- [The Reconciler](./reconciler) — Step 11 (resolution) and Steps in context
- [Inter-BFF Communication](/guide/deep-dive/inter-bff-communication) — the BFF side of the env-var injection
- [Onboard a Module](/tutorials/onboard-a-module) and [Register a Module in the Operator](/tutorials/register-module-in-operator) — do this end to end
:::
