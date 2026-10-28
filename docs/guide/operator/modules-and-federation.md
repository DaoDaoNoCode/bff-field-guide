# Modules & Federation

> How the operator decides *which* modules to run, and how it tells the frontend where to find them. This is the payoff — the part that makes the dashboard modular.

The reconcile pipeline said `reconcileModuleDemand` and moved on. This page unpacks that: the registry that defines every module, the three-pass algorithm that decides each module's fate, and the federation ConfigMap that wires deployed modules into the running frontend.

## The module registry is *code*, not config

Adding a module to the dashboard is a change to a Go map — not a CRD schema change, not a YAML edit. From `dashboard-operator/internal/controller/modules.go` (L13 onwards):

```go
type ModuleDefinition struct {
    Name                    string   // unique id, camelCase, matches the map key
    ContainerName           string   // container name, used by stale-container cleanup
    Port                    int32    // the port the BFF listens on
    ImageEnvVar             string   // env var holding the image reference
    RequiredDSCComponents   []string // DSC components that must be available
    InterModuleDependencies []string // other modules that must be enabled
    ManifestSlug            string   // dir under manifests/modules/, Service odh-dashboard-<slug>-ui
    TLS                     bool     // federation entry uses https to the module Service
    ProxyPaths              []proxyRoute         // nil → default /<slug>/api → /api
    InterBFFDeps            []interBFFDependency // service-discovery params for callers
    RequiredByMaaSPortal    bool     // keep deployed while a Managed MaaS Portal needs it
}

var moduleRegistry = map[string]ModuleDefinition{
    "modelRegistry": {
        Name: "modelRegistry", ContainerName: "model-registry-ui", Port: 8043,
        ImageEnvVar:           "RELATED_IMAGE_ODH_MOD_ARCH_MODEL_REGISTRY_IMAGE",
        ManifestSlug:          "model-registry",
        TLS:                   true,
        RequiredDSCComponents: []string{"modelregistry"},
    },
    "genAi":          { /* :8143, RequiredByMaaSPortal, InterBFFDeps → maas */ },
    "maas":           { /* :8243, RequiredByMaaSPortal */ },
    "mlflow":         { /* :8343, requires "mlflowoperator", ProxyPaths /_bff/mlflow/api */ },
    "evalHub":        { /* :8543, requires "trustyai" */ },
    "automl":         { /* :8643, requires "aipipelines" */ },
    "autorag":        { /* :8743, requires "aipipelines" AND depends on module "genAi" */ },
    "agentOps":       { /* :8843, ProxyPaths /agent-ops/api + /agent-ops/healthcheck */ },
    "notebooks":      { /* :9043 */ },
    "dataRegistry":   { /* :9143, requires "dataRegistry" */ },
    "dataConnectHub": { /* :9243, ProxyPaths /data-connect-hub/api + /healthcheck */ },
}
```

Here's the full registry (11 modules) as a table — a useful reference when you onboard a module:

| Module | Container | Port | Requires DSC component | Depends on module | Notes |
|---|---|---|---|---|---|
| `modelRegistry` | model-registry-ui | 8043 | `modelregistry` | — | |
| `genAi` | gen-ai-ui | 8143 | — | — | MaaS Portal dep; InterBFFDeps → maas |
| `maas` | maas-ui | 8243 | — | — | MaaS Portal dep |
| `mlflow` | mlflow-ui | 8343 | `mlflowoperator` | — | proxy `/_bff/mlflow/api` |
| `evalHub` | eval-hub-ui | 8543 | `trustyai` | — | |
| `automl` | automl-ui | 8643 | `aipipelines` | — | |
| `autorag` | autorag-ui | 8743 | `aipipelines` | `genAi` | |
| `agentOps` | agent-ops-ui | 8843 | — | — | proxies api + healthcheck |
| `notebooks` | notebooks-ui | 9043 | — | — | |
| `dataRegistry` | data-registry-ui | 9143 | `dataRegistry` | — | proxy `/data-registry/api` |
| `dataConnectHub` | data-connect-hub-ui | 9243 | — | — | proxies api + healthcheck |

Every module has `TLS: true`. "MaaS Portal dep" means `RequiredByMaaSPortal: true` (see [the MaaS Portal operand](./reconciler#the-maas-portal-operand)).

::: tip The Port Convention
Module BFF ports march in hundreds: 8043, 8143, 8243, … 8843, then 9043, 9143, 9243. `8443` is reserved for `kube-rbac-proxy` and `8943` for [core-bff](/guide/core-bff/distributions), which is why the sequence jumps to 9043. **The next free port is 9343.** When you allocate a port for a new module, follow the pattern; uniqueness is enforced by `modules_test.go` (the [Onboard a Module](/tutorials/onboard-a-module) tutorial walks through port allocation).
:::

`autorag` is the interesting one — it shows both dependency kinds at once: it needs the `aipipelines` **DSC component** *and* the `genAi` **module**. If either is missing, `autorag` is disabled.

## Three-pass dependency resolution

`resolveModuleStatuses` (`modules.go`, around L159) is a pure function: give it a `DashboardSpec`, get back a `map[string]ModuleStatus`. Pure means trivially testable — no cluster, no client (see [Testing the Operator](./testing)). It runs three passes.

```
Pass 1: gate each module      → explicitly disabled? demanded? DSC components available?
Pass 2: propagate deps        → a disabled dep cascades to its dependents
Pass 3: catch typos           → unknown module names in spec.modules
```

### Pass 1 — explicit override, demand, component gate

```go
coreRequiresModules := spec.ManagementState != "Removed"
portal := effectiveMaaSPortal(*spec)
maasPortalRequiresModules := portal != nil && portal.ManagementState == "Managed"

for name, mod := range moduleRegistry {
    // (a) explicit admin override wins over everything.
    if override, ok := spec.Modules[name]; ok && override.State == ModuleDisabled {
        result[name] = ModuleStatus{Phase: ModulePhaseDisabled, Reason: "ExplicitOverride", ...}
        continue
    }
    // (b) demand gate: is any Managed operand asking for this module?
    if !coreRequiresModules && (!maasPortalRequiresModules || !mod.RequiredByMaaSPortal) {
        result[name] = ModuleStatus{Phase: ModulePhaseNotDeployed, Reason: "NotRequired", ...}
        continue
    }
    // (c) DSC component gate: only when the module has requirements AND spec.components is set.
    if len(mod.RequiredDSCComponents) > 0 && spec.Components != nil {
        for _, comp := range mod.RequiredDSCComponents {
            ca, exists := spec.Components[comp]
            if !exists || (ca.ManagementState != "Managed" && ca.ManagementState != "Unmanaged") {
                result[name] = ModuleStatus{Phase: ModulePhaseDisabled, Reason: "ComponentNotAvailable", ...}
                // ... skip to next module
            }
        }
    }
    // (d) survived every check → tentatively Deployed.
    result[name] = ModuleStatus{Phase: ModulePhaseDeployed, Reason: "Deployed", ...}
}
```

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

Every status also carries a `lastTransitionTime`. `preserveModuleStatusTransitionTimes` keeps the previous timestamp when phase, reason and message didn't change, so the field means "when this last changed", not "when the operator last looked".

## Readiness overlay: desired vs actual

Resolution decides what *should* run. But a module can be `Deployed` in the plan and still be crash-looping in reality. `overlayStandaloneReadiness` (`module_deploy.go`, around L421) reconciles the two by listing each module's Deployment, found by the `app.kubernetes.io/component=<slug>` label, and downgrading unhealthy modules:

```go
for name, mod := range moduleRegistry {
    if statuses[name].Phase != ModulePhaseDeployed {
        continue // only overlay modules we expected to be up
    }
    var deployList appsv1.DeploymentList
    if err := r.List(ctx, &deployList, client.InNamespace(r.ApplicationsNamespace),
        client.MatchingLabels{labels.PlatformPartOf: "dashboard", moduleComponentLabel: mod.ManifestSlug}); err != nil {
        statuses[name] = ModuleStatus{Phase: ModulePhaseDegraded, Reason: "ListFailed", ...}
        continue
    }
    if len(deployList.Items) == 0 {
        statuses[name] = ModuleStatus{Phase: ModulePhaseNotDeployed, Reason: "DeploymentNotFound", ...}
        continue
    }
    for _, dep := range deployList.Items {
        if dep.Status.ReadyReplicas < desiredReplicas(dep) {
            reason := "ReplicasNotReady"
            // prefer the Deployment's own Available condition reason, if it's False
            statuses[name] = ModuleStatus{Phase: ModulePhaseDegraded, Reason: reason, ...}
            break
        }
    }
}
```

This catches the real-world failures: a bad image (`ImagePullBackOff` keeps replicas at 0), a BFF that starts and dies, a Deployment that never got created. (`modules.go` still has an older `overlayContainerReadiness` that inspected pod container statuses; it's only used in tests now.)

::: info This Is the Whole Point of Status
The resolver is the "props → what should render" step; the overlay is the "did it actually mount and stay mounted?" step. Together they give the admin an honest `status.moduleStatuses` — not "I asked for it," but "here's what's actually up." That's the desired-vs-observed split from [The CRD](./the-crd), made concrete.
:::

## The federation ConfigMap

Each module runs in its own pod, so the frontend can't assume `localhost`. It needs a map of *where each module's `remoteEntry.js` and BFF API endpoint live*. That map is the **`federation-config` ConfigMap**, generated fresh each reconcile by `buildFederationConfigMap(ctx, statuses, dashboard)` (`module_deploy.go`, around L366).

For every deployed (or degraded) module it emits an entry (`moduleFederationEntry` in `dashboard_federation.go`); it always adds `coreBff`; it adds `perses` when observability is enabled and `mlflowEmbedded` when mlflow is present; then it sorts by name for deterministic output. Community plugins, read from `community-plugins-config` in the `redhat-ods-community-plugins` namespace (`community_plugin.go`), are merged in with their proxy paths under `/community-plugins/<name>/…`. The ConfigMap has three keys:

| Key | Contents |
|---|---|
| `dashboard-federation-config.json` | entries the operator owns (modules, coreBff, perses, mlflowEmbedded) |
| `community-federation-config.json` | community plugin entries (last-known-good kept on a read error) |
| `module-federation-config.json` | the runtime merge of both — what the frontend reads |

The JSON shape (`federation_config.go`):

```json
[
  {
    "name": "coreBff",
    "proxyService": [{
      "path": "/core-bff/api", "pathRewrite": "/api",
      "authorize": true, "tls": true,
      "service": {"name": "odh-dashboard", "namespace": "<apps-ns>", "port": 8943}
    }]
  },
  {
    "name": "genAi",
    "backend": {
      "remoteEntry": "/remoteEntry.js",
      "authorize": true, "tls": true,
      "service": {"name": "odh-dashboard-gen-ai-ui", "namespace": "<apps-ns>", "port": 8143}
    },
    "proxyService": [{
      "path": "/gen-ai/api", "pathRewrite": "/api",
      "authorize": true, "tls": true,
      "service": {"name": "odh-dashboard-gen-ai-ui", "namespace": "<apps-ns>", "port": 8143}
    }]
  }
]
```

The `coreBff` entry points at the main dashboard Service on port 8943 — `odh-dashboard` on ODH, `rhods-dashboard` on RHOAI (`mainDashboardServiceName`). What core-bff does with the traffic is covered in [Core BFF Across Distributions](/guide/core-bff/distributions).

Fastify receives `module-federation-config.json` as the env var **`MODULE_FEDERATION_CONFIG`**, through a `configMapKeyRef` in `manifests/base/deployment.yaml`, and uses it to configure the Module Federation remotes and the backend's proxy routes. (The `module-federation` block in each package's `package.json` is only the local-dev fallback.) Core-bff's `module_proxy.go` understands the same structure for its own module front-door proxy. Each module's proxy paths come from `ModuleDefinition.ProxyPaths`, or the default `/<slug>/api → /api` (`proxyPathsFor`) — e.g. `/gen-ai/api/models` rewrites to `/api/models` and proxies to the genAi Service on `:8143`.

::: info This Is the Operator↔Frontend Contract
The federation ConfigMap is the single runtime handshake between the operator and the frontend. The operator decides what's deployed and writes this JSON; the frontend reads it and wires up federation + proxying. Change the shape of this contract and both sides must agree — which is exactly why the operator generates it rather than shipping it as static config.
:::

## The SHA-256 hash trick: forcing a rolling restart

Kubernetes does **not** restart pods when a ConfigMap changes, and an env var sourced from a ConfigMap is read only when the container starts — it never updates in place. So when a module is added or removed and the federation ConfigMap changes, the frontend pod would keep serving the stale config. The operator's fix (`patchDeploymentFederationHash`, `module_deploy.go` around L72–117) is a classic:

```go
const federationHashAnnotation = "dashboard.opendatahub.io/federation-config-hash"

hash := computeFederationConfigHash(configData)         // sha256 of the JSON
current := deploy.Spec.Template.Annotations[federationHashAnnotation]
if current == hash {
    return nil                                          // unchanged → do nothing
}
patch := client.MergeFrom(deploy.DeepCopy())   // deploy = odh-dashboard / rhods-dashboard
deploy.Spec.Template.Annotations[federationHashAnnotation] = hash  // on the POD TEMPLATE
r.Patch(ctx, &deploy, patch)
```

The hash goes on the **pod template**, not the Deployment metadata. Changing the pod template is exactly what the Deployment controller watches for — so it triggers a normal rolling update. Same content → same hash → patch skipped, no churn. Different content → new hash → rolling restart that picks up the new ConfigMap.

::: tip You've Seen This Pattern Before
This is the "checksum annotation" trick Helm charts use (`checksum/config`) to roll pods on ConfigMap changes. The operator just computes it in Go instead of a template. Whenever you need "restart the pod when this external file changes," reach for a content hash on the pod template.
:::

## Inter-BFF service-discovery params

Some module BFFs call *other* module BFFs (genAi → maas, for one). The caller needs the callee's Service name and port. The registry declares that in `ModuleDefinition.InterBFFDeps`:

```go
"genAi": {
    // ...
    InterBFFDeps: []interBFFDependency{{
        EnvServiceName: "BFF_MAAS_SERVICE_NAME",
        EnvServicePort: "BFF_MAAS_SERVICE_PORT",
        TargetModule:   "maas",
    }},
},
```

`addInterBFFParams` (`module_deploy.go`, around L340) writes `BFF_MAAS_SERVICE_NAME=odh-dashboard-maas-ui` and `BFF_MAAS_SERVICE_PORT=8243` into the caller's **`<slug>-params` ConfigMap** (via its `params.env`) only while the target is `Deployed` or `Degraded`, and deletes the keys otherwise. It does not touch the Deployment's env directly.

::: warning These Keys Are Inert Today
gen-ai, the only declared consumer, still hardcodes the maas coordinates in its own Deployment, so nothing reads these params yet. A module that wants them must consume them at runtime with `envFrom` on the generated `<slug>-params` ConfigMap, and must **not** ship static defaults for those keys in its own `params.env` (the operator overwrites or deletes them). Also remember the target's `networkpolicy.yaml` must allow the caller, or the call times out. See [Network policies](#network-policies-per-module).
:::

The BFF side of this — the `bffclient` package that *reads* those vars — is covered in [Inter-BFF Communication](/guide/deep-dive/inter-bff-communication).

## Network policies per module

Every `manifests/modules/<slug>/` directory ships a `networkpolicy.yaml`. The pattern is least-privilege ingress on the module port, from:

- the main dashboard pod (`deployment in (odh-dashboard, rhods-dashboard)`), where Fastify and core-bff proxy API calls from;
- the OpenShift ingress policy group (`network.openshift.io/policy-group: ingress`);
- named callers, such as the `maas-portal` pod for genAi and maas.

Egress is scoped to DNS, the API server and whatever the module genuinely needs. The practical consequence: **a new inter-BFF call needs the target's policy edited**, or it fails as a silent timeout rather than a clear error. The operator's own controller pod has a separate metrics policy from the Helm chart (`<prefix>dashboard-operator-metrics`), which teardown never deletes. The MaaS Portal adds temporary peers while it migrates away from the legacy consumer portal (`maas_portal_network_policy.go`).

## The `RELATED_IMAGE_*` contract

Every module's `ImageEnvVar` uses the `RELATED_IMAGE_` prefix. That's not a style choice — it's a **Konflux / operator-framework contract**:

```go
ImageEnvVar: "RELATED_IMAGE_ODH_MOD_ARCH_GEN_AI_IMAGE"
```

The prefix tells OLM and the Konflux build system "this env var holds a container image reference," which unlocks:

- **Image pinning** — floating tags replaced with immutable digests at build time
- **Disconnected installs** — OLM can mirror every image for air-gapped clusters
- **Vulnerability scanning** — the build system knows which images to scan

The mapping from kustomize param keys to these env vars lives in `support.go`'s `imagesMap`. For modules it is filled automatically from `moduleRegistry` in an `init()` function (key `<slug>-ui-image` → `ImageEnvVar`), so registering a module is enough. `resolveImageParams` reads the env vars to produce the params written to `params.env` before rendering.

In the operator's Helm chart, `values.yaml` `relatedImages` default to `""`. An empty value means "don't set the env var", so the digest-pinned default already in the manifests' `params.env` wins.

::: warning Registration Order Matters
When you onboard a module, the buildable image and its `RELATED_IMAGE_*` wiring must exist *before* you flip the module on — otherwise the container lands in `ImagePullBackOff` and the readiness overlay marks it `Degraded`. The [Register a Module in the Operator](/tutorials/register-module-in-operator) tutorial covers the correct ordering.
:::

## Probe sanitization: an SSA sharp edge

One last subtlety, because it bites during upgrades. A Kubernetes probe may specify exactly one handler: `httpGet`, `tcpSocket`, `exec`, or `grpc`. When SSA changes a probe from `httpGet` to `tcpSocket`, it *adds* `tcpSocket` but doesn't *remove* the old `httpGet` — because SSA only manages fields you declare, and the stale field belongs to a different field owner. The API server then rejects the apply: "may not specify more than 1 handler type."

`sanitizeDeploymentProbes` (`probe_sanitize.go`) fixes this by pre-patching the live Deployment to `null` out stale handler types *before* the SSA apply runs, so by the time SSA fires there's only one handler. This is why `reconcileDeployment` calls `sanitizeDeploymentProbes` before the SSA apply — an essential step for safe version upgrades.

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Where do you add a new module — a YAML file, the CRD, or a Go map?
- [ ] What do the three resolution passes each do, and why is Pass 2 guaranteed to terminate?
- [ ] What's the difference between a module's *resolved* status and its *overlaid* status?
- [ ] What does the federation ConfigMap tell the frontend, how does Fastify receive it, and why does that force a restart?
- [ ] Why put the content hash on the pod template instead of the Deployment metadata?
- [ ] What three things does the `RELATED_IMAGE_*` prefix unlock?
- [ ] Why would a new genAi → myModule call time out even though both BFFs are healthy?

</div>

::: info What's Next
Next: **[ODH Operator Connection](./odh-operator-connection)** — where `spec.components` actually comes from, the `ModuleHandler` interface, and why this is a two-level architecture.
:::

::: info See Also
- [The Reconciler](./reconciler) — `reconcileModuleDemand` in context
- [Core BFF Across Distributions](/guide/core-bff/distributions) — what sits behind the `coreBff` entry
- [Inter-BFF Communication](/guide/deep-dive/inter-bff-communication) — the BFF side of service discovery
- [Onboard a Module](/tutorials/onboard-a-module) and [Register a Module in the Operator](/tutorials/register-module-in-operator) — do this end to end
:::
