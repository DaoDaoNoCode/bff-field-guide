# The Dashboard CRD

> The custom resource is the operator's *props*. Define its shape in Go, decorate it with markers, and let `controller-gen` turn that into the schema Kubernetes enforces.

A Custom Resource Definition (CRD) teaches the Kubernetes API server a new resource type. Once the `Dashboard` CRD is installed, `kubectl get dashboard` works exactly like `kubectl get pod` — the API server stores, validates, and serves your type as a first-class citizen.

Here's the part that surprises frontend developers: **the CRD schema is written in Go, not YAML.** You define plain structs, annotate them with `// +kubebuilder:...` comment markers, and a code generator produces the OpenAPI schema the API server uses to validate every `Dashboard` anyone submits. It's like defining a Zod schema and having your class definition *be* the schema.

Everything on this page lives in `dashboard-operator/api/v1alpha1/dashboard_types.go` (~255 lines).

## Constants: naming is a contract

```go
const (
    DashboardComponentName = "dashboard"
    DashboardInstanceName  = "default-dashboard"   // the ONLY allowed name
    DashboardKind          = "Dashboard"
)
```

These aren't decoration — they're used across the codebase for label values, resource naming, and owner-reference construction. `default-dashboard` in particular is load-bearing: it's the one name a `Dashboard` CR is allowed to have (enforced below).

## Enums are named string types

Go has no `enum` keyword. The idiom is a named `string` type plus a set of `const` values — and a kubebuilder marker that tells the API server which values are legal.

```go
// What the admin WANTS (spec) — desired state.
type ModuleOverrideState string
const (
    ModuleEnabled  ModuleOverrideState = "Enabled"
    ModuleDisabled ModuleOverrideState = "Disabled"
)

// What is actually HAPPENING (status) — observed state.
type ModulePhase string
const (
    ModulePhaseDeployed    ModulePhase = "Deployed"
    ModulePhaseNotDeployed ModulePhase = "NotDeployed"
    ModulePhaseDegraded    ModulePhase = "Degraded"
    ModulePhaseDisabled    ModulePhase = "Disabled"
)

type DeploymentMode string
const (
    DeploymentModeSidecar    DeploymentMode = "Sidecar"
    DeploymentModeStandalone DeploymentMode = "Standalone"
)
```

::: tip This Is the TypeScript String-Literal Union
`type ModulePhase string` with a fixed set of consts is Go's version of `type ModulePhase = 'Deployed' | 'NotDeployed' | 'Degraded' | 'Disabled'`. The difference: TypeScript enforces the union at *compile time only*; here the `+kubebuilder:validation:Enum` marker (shown later) pushes the same constraint all the way down into the *API server*, so an invalid value is rejected before the operator ever runs. (Part 1's [Types & Variables](/guide/go-basics/types-and-variables) covers named-type enums.)
:::

::: warning Spec State vs Status Phase — Don't Mix Them
Notice `ModuleOverrideState` (spec: `Enabled`/`Disabled`) is a *different type* from `ModulePhase` (status: `Deployed`/`Degraded`/...). This split between **desired state** (spec, what the admin asked for) and **observed state** (status, what the reconciler found) is the deepest idea in Kubernetes. The reconciler reads spec and writes status — never the reverse.
:::

## Building up the spec

The spec is assembled from small, focused structs. A few worth calling out:

### Validation markers do the guarding

```go
type GatewaySpec struct {
    // +kubebuilder:validation:MaxLength=253
    // +kubebuilder:validation:Pattern=`^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`
    Domain string `json:"domain"`
}
```

The `Pattern` marker enforces FQDN format *at admission time*. A malformed domain is rejected by the API server — the reconciler never sees garbage. This is validation-as-schema, the same instinct behind a Zod `.regex()`, but enforced at the cluster boundary.

### Defaults get filled in by the API server

```go
type ServiceTarget struct {
    Name      string `json:"name"`
    Namespace string `json:"namespace"`
    // +kubebuilder:default=8080
    Port int32 `json:"port,omitempty"`
}
```

Omit `port` and the API server writes `8080` for you at admission — a server-side default, not a Go zero value. That distinction matters: the persisted object actually contains `8080`, so every reader (including `kubectl get -o yaml`) sees it.

### The `Components` map: the bridge from the ODH Operator

```go
type ComponentAvailability struct {
    // +kubebuilder:validation:Enum=Managed;Unmanaged;Removed
    ManagementState string `json:"managementState"`
}
```

Each entry in `spec.components` is keyed by a DSC component name (`"modelregistry"`, `"aipipelines"`, `"trustyai"`, ...) and carries its availability. The module resolver reads this map to decide which UI modules to deploy. *Where this map comes from* is the whole story of the [ODH Operator Connection](./odh-operator-connection) page — for now, just know it's the incoming signal.

### The tri-state override

```go
type ModuleOverride struct {
    // +kubebuilder:validation:Enum=Enabled;Disabled
    // +optional
    State ModuleOverrideState `json:"state,omitempty"`
}
```

`spec.modules.<name>.state` lets an admin explicitly force a module on or off, overriding the automatic component-based resolution. Three effective states: *Enabled*, *Disabled*, or *unset* (`omitempty` → fall back to automatic resolution).

## Putting the spec together

```go
type DashboardSpec struct {
    common.ManagementSpec `json:",inline"`   // promotes ManagementState to spec top level

    Gateway        *GatewaySpec                     `json:"gateway,omitempty"`
    Components     map[string]ComponentAvailability `json:"components,omitempty"`
    Modules        map[string]ModuleOverride        `json:"modules,omitempty"`
    Observability  *ObservabilitySpec               `json:"observability,omitempty"`

    // +kubebuilder:default=Sidecar
    DeploymentMode DeploymentMode `json:"deploymentMode,omitempty"`
}
```

::: tip `json:",inline"` Is Spreading Props
The `common.ManagementSpec` field has no JSON name and the `,inline` tag — so its fields are *promoted* to the top level of `spec`. The CR gets `spec.managementState`, **not** `spec.managementSpec.managementState`. It's the Go struct-tag equivalent of `{...managementSpec}` in a React props object.
:::

`DeploymentMode` defaults to `Sidecar` (all module BFFs run as containers in one pod). The alternative, `Standalone` (each module gets its own Deployment), is a major branch in the reconciler — covered on the [Reconciler](./reconciler) page.

## The status: what actually happened

```go
type DashboardStatus struct {
    common.Status                 `json:",inline"`  // Phase, Conditions, ObservedGeneration
    common.ComponentReleaseStatus `json:",inline"`  // version/release tracking

    URL            string                  `json:"url,omitempty"`
    ModuleStatuses map[string]ModuleStatus `json:"moduleStatuses,omitempty"`
    Distribution   *Distribution           `json:"distribution,omitempty"`
}
```

The status is what `kubectl` shows the admin — the dashboard URL and per-module health:

```yaml
status:
  phase: Ready
  url: https://dashboard.apps.cluster.example.com
  moduleStatuses:
    modelRegistry:
      phase: Deployed
      message: Module container deployed
    mlflow:
      phase: Disabled
      reason: ComponentNotAvailable
      message: Required DSC component "mlflowoperator" is not available
```

## CEL: cross-field validation at the API server

Marker-based validation handles single fields. For rules that span fields — or enforce the singleton — the CRD uses **CEL** (Common Expression Language) via `XValidation` markers on the top-level type:

```go
// +kubebuilder:validation:XValidation:rule="self.metadata.name == 'default-dashboard'",
//   message="Dashboard must be named 'default-dashboard'"
// +kubebuilder:validation:XValidation:rule="!has(self.spec.observability) || !self.spec.observability.enabled || has(self.spec.observability.persesService)",
//   message="observability requires persesService when enabled"
type Dashboard struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    Spec              DashboardSpec   `json:"spec,omitempty"`
    Status            DashboardStatus `json:"status,omitempty"`
}
```

Two rules, both enforced by the API server *before* the reconciler runs:

1. **Singleton naming** — the CR must be named `default-dashboard`. Any other name is rejected. This is *how* the "one Dashboard per cluster" rule from the [overview](./index) is enforced; there's no code in the reconciler checking it.
2. **Cross-field consistency** — if `observability.enabled` is true, `observability.persesService` must be present. A misconfiguration is caught at submit time, not at reconcile time.

::: info CEL Is a Zod Schema for Kubernetes
CEL runs declaratively at the API boundary — the same role a Zod `.refine()` plays validating a request body before it reaches your handler. The payoff is identical: bad input never reaches your business logic, and the error message goes straight back to whoever submitted it (`kubectl apply` prints it).
:::

## The `PlatformObject` interface

The `Dashboard` type implements a small interface from `odh-platform-utilities` so shared utility code (the conditions manager, release tracking) can operate on it without importing the concrete type:

```go
func (d *Dashboard) GetStatus() *common.Status        { return &d.Status.Status }
func (d *Dashboard) GetConditions() []common.Condition { return d.Status.Conditions }
func (d *Dashboard) SetConditions(c []common.Condition) { d.Status.Conditions = c }
// ... plus GetReleaseStatus / SetReleaseStatus
```

::: tip Interfaces Are Duck Typing, Verified at Compile Time
Go interfaces are satisfied *implicitly* — no `implements` keyword. By defining these methods, `*Dashboard` automatically satisfies `PlatformObject`, and shared code can accept any component's CRD that does the same. It's structural typing, exactly like a TypeScript `interface` matched by shape — but checked when you compile, not when you call. (See Part 1's [Functions & Methods](/guide/go-basics/functions-and-methods).)
:::

## Generated code: deep-copy and the CRD YAML

Two kinds of code are generated from these types — you never hand-write either:

```bash
cd dashboard-operator
make generate    # regenerates zz_generated.deepcopy.go (DeepCopy methods)
make manifests   # regenerates config/crd/bases/*.yaml (the CRD schema)
```

- **`make generate`** produces `DeepCopy()` methods for every type. controller-runtime requires them because the cache hands out shared pointers — mutating one without copying first would corrupt other reconciles. (Kubernetes has no structural sharing; a deep copy is a deep copy.)
- **`make manifests`** reads all your `+kubebuilder:` markers and emits the CRD YAML in `config/crd/bases/`. That YAML is then copied into the Helm chart via `make sync-chart-crds`.

::: warning Never Hand-Edit Generated Files
`zz_generated.deepcopy.go` and `config/crd/bases/*.yaml` are outputs. Edit the Go structs and their markers, then re-run `make generate` / `make manifests`. Forgetting this step is one of the most common operator mistakes — you change a field, forget to regenerate, and the API server keeps enforcing the *old* schema. (See [Gotchas](/reference/gotchas).)
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Where is the CRD schema actually defined — YAML or Go?
- [ ] What's the difference between `ModuleOverrideState` (spec) and `ModulePhase` (status)?
- [ ] How is the "only one Dashboard, named `default-dashboard`" rule enforced, and by which component?
- [ ] What do `make generate` and `make manifests` each produce, and why must you never hand-edit their output?
- [ ] What does `json:",inline"` do to a struct's fields?

</div>

::: info What's Next
Next: **[The Reconciler](./reconciler)** — the 14-step pipeline that turns this CRD's `spec` into a running dashboard, plus Sidecar vs Standalone modes and teardown.
:::

::: info See Also
- [Part 4: Resources & CRDs](/guide/kubernetes/resources-and-crds) — CRDs, kubebuilder markers, and CEL at the Kubernetes level
- [ODH Operator Connection](./odh-operator-connection) — where `spec.components` comes from
- [Part 1: Types & Variables](/guide/go-basics/types-and-variables) — named-type enums
:::
