# Resources & CRDs

> **Extending the API** -- how the operator adds a brand-new resource type, `Dashboard`, to Kubernetes, and how its validation is generated from Go comments.

You already know how to *use* Kubernetes resources. This page connects that operational knowledge to the Go code, then introduces the one genuinely new idea: a Custom Resource Definition (CRD).

## The 30-Second Refresh

Here are the core resources and where they show up in the dashboard codebase. Nothing new -- just anchoring names to real things.

| Resource | What it is | Dashboard example |
|---|---|---|
| **Pod** | Smallest deployable unit; one or more containers | The dashboard pod runs the `odh-dashboard`, `kube-rbac-proxy`, and `core-bff` containers |
| **Deployment** | Manages Pod replicas and rolling updates | The `odh-dashboard` Deployment; each module runs its own 2-replica Deployment |
| **Service** | Stable network endpoint for a set of Pods | `odh-dashboard-gen-ai-ui` exposing the gen-ai BFF on port 8143 |
| **ConfigMap** | Non-sensitive configuration data | `federation-config` stores the module federation routing table |
| **Secret** | Sensitive data (tokens, certs) | TLS material for inter-BFF communication |
| **Namespace** | Resource isolation boundary | `opendatahub` (ODH) or `redhat-ods-applications` (RHOAI) |

::: tip The TypeScript Anchor
Think of each resource type as a TypeScript `interface`, and each resource *instance* as an object matching that interface. `kubectl get deployments` is basically `deployments.filter(...)` over a live, cluster-wide store of typed objects. What makes Kubernetes special is that a controller is *watching* that store and acting on every change.
:::

**Routes vs Ingress:** on OpenShift the dashboard is exposed via a `Route`; on vanilla Kubernetes it uses an `Ingress` built from `spec.gateway.domain`. Same idea, different resource, chosen by platform.

## The New Idea: Custom Resource Definitions

Every resource above is *built in* -- Kubernetes ships knowing what a Deployment is. A **CRD** lets you teach Kubernetes a resource type it didn't ship with.

::: info The Database Analogy
A CRD is like a `CREATE TABLE` statement. Once you install it, the API server knows about a new "table" (`dashboards`), and you can `get`, `list`, `create`, `update`, and `delete` rows in it -- with full validation, RBAC, and `kubectl` support -- exactly like a built-in resource. Your operator is the code that reacts whenever a row changes.
:::

The dashboard defines one CRD: `Dashboard`. It is the single source of truth for what the dashboard should look like. Here's an instance:

```yaml
# What a Dashboard resource looks like once created
apiVersion: components.platform.opendatahub.io/v1alpha1
kind: Dashboard
metadata:
  name: default-dashboard          # Singleton -- only ONE allowed (enforced by CEL, below)
spec:                              # DESIRED state -- what you want
  managementState: Managed
  gateway:
    domain: dashboard.example.com
  deploymentMode: Standalone
  components:                       # A snapshot of which DSC components are available
    modelregistry:
      managementState: Managed
  observability:
    enabled: true
    persesService:
      name: perses
      namespace: observability
      port: 8080
status:                           # OBSERVED state -- what the controller reports back
  phase: Ready
  url: https://dashboard.example.com/
  conditions:
    - type: Ready
      status: "True"
  moduleStatuses:
    modelRegistry:
      phase: Deployed
```

Notice the two halves. `spec` is what *you* (or the ODH Operator) declare. `status` is what the *controller* writes back after doing the work. That split is the heartbeat of the whole system.

## From Go Struct to CRD

Here's the part that surprises frontend developers: **the CRD schema is generated from Go structs.** You write a plain Go type, decorate it with special comments, and a tool turns it into the OpenAPI validation schema Kubernetes enforces.

The types live in `dashboard-operator/api/v1alpha1/dashboard_types.go`:

```go
type DashboardSpec struct {                          // The "spec" half of the resource
    // ManagementSpec carries the orchestrator's intent: Managed or Removed.
    common.ManagementSpec `json:",inline"`           // Embedded -- inlines its fields (see Part 1: Structs)

    Gateway *GatewaySpec `json:"gateway,omitempty"`  // Pointer + omitempty = optional field

    // Components is a snapshot of DSC component availability.
    Components map[string]ComponentAvailability `json:"components,omitempty"`

    // Modules holds per-module override configuration.
    Modules map[string]ModuleOverride `json:"modules,omitempty"`

    Observability *ObservabilitySpec `json:"observability,omitempty"`

    // DeploymentMode controls how BFF modules are deployed.
    // +kubebuilder:validation:Enum=Sidecar;Standalone     <- a "marker" comment (see below)
    // +kubebuilder:default=Sidecar
    DeploymentMode DeploymentMode `json:"deploymentMode,omitempty"`
}

type DashboardStatus struct {                        // The "status" half
    common.Status                 `json:",inline"`
    common.ComponentReleaseStatus `json:",inline"`

    URL string `json:"url,omitempty"`                // The externally-reachable dashboard URL

    // ModuleStatuses reports each module's deployment state.
    ModuleStatuses map[string]ModuleStatus `json:"moduleStatuses,omitempty"`
}
```

::: tip This Is Just Structs and JSON Tags
You already learned all of this in Part 1. `json:"gateway,omitempty"` is the same struct tag you use for BFF DTOs. Embedding (`common.ManagementSpec` with no field name) is the composition pattern from [Structs](/guide/go-basics/structs). The only new thing is the `// +kubebuilder:...` comments -- and those are just annotations a code generator reads.
:::

## Kubebuilder Markers: Validation From Comments

A **kubebuilder marker** is a magic comment starting with `// +kubebuilder:`. A tool called `controller-gen` reads them and writes the CRD's validation schema. This is the Go equivalent of decorating a class with Pydantic `Field(...)` constraints or a Zod schema -- except it runs at build time and produces a schema the *API server* enforces.

**Enum -- restrict to a fixed set of values:**

```go
// +kubebuilder:validation:Enum=Managed;Unmanaged;Removed
// +kubebuilder:default=Removed
ManagementState string `json:"managementState"`
```

This produces `enum: [Managed, Unmanaged, Removed]` in the CRD. Kubernetes rejects any `Dashboard` that uses another value -- the operator never even sees it. Compare to a TypeScript union: `type ManagementState = 'Managed' | 'Unmanaged' | 'Removed'`, but enforced at the cluster boundary.

**String -- length and pattern:**

```go
// +kubebuilder:validation:Required
// +kubebuilder:validation:MaxLength=253
// +kubebuilder:validation:Pattern=`^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`
Domain string `json:"domain"`
```

Enforces a valid DNS hostname, max 253 chars. This is `z.string().max(253).regex(...)` in Zod terms.

**Numeric -- range and default:**

```go
// +kubebuilder:validation:Minimum=1
// +kubebuilder:validation:Maximum=65535
// +kubebuilder:default=8080
Port int32 `json:"port,omitempty"`
```

## CEL: Cross-Field Rules

Markers validate one field at a time. When a rule spans *multiple* fields, kubebuilder uses **CEL** (Common Expression Language). These live as `XValidation` markers on the type:

```go
// +kubebuilder:validation:XValidation:rule="self.metadata.name == 'default-dashboard'",message="Dashboard name must be default-dashboard"
// +kubebuilder:validation:XValidation:rule="!has(self.spec.observability) || !self.spec.observability.enabled || has(self.spec.observability.persesService)",message="persesService must be specified when observability is enabled"
```

- The **first** rule enforces the singleton: only a `Dashboard` named `default-dashboard` is valid. (This is why the CRD doesn't need a webhook just to guarantee "one instance".)
- The **second** rule is conditional: *if* observability is enabled, `persesService` must be present.

::: info CEL Runs Inside the API Server
CEL rules execute *before* the object is persisted. An invalid `Dashboard` is rejected at `kubectl apply` time with your custom message -- the operator's Go code is never invoked for a resource that violates a rule. Think of it as validation middleware that runs on the server for every write.
:::

## Print Columns: Shaping `kubectl get`

Markers also control the columns in `kubectl get`:

```go
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Ready",type=string,JSONPath=`.status.conditions[?(@.type=="Ready")].status`
// +kubebuilder:printcolumn:name="URL",type=string,JSONPath=`.status.url`
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"
```

Which is what makes this readable:

```
NAME                PHASE   READY   URL                              AGE
default-dashboard   Ready   True    https://dashboard.example.com/   5d
```

## The Non-Negotiable: Regenerate After Editing Types

Change *anything* in `dashboard-operator/api/v1alpha1/` and you must regenerate two things:

```bash
cd dashboard-operator
make generate    # Regenerates DeepCopy methods -> zz_generated.deepcopy.go
make manifests   # Regenerates the CRD YAML -> config/crd/bases/
```

- **`make generate`** writes `zz_generated.deepcopy.go`. Kubernetes needs a `DeepCopy()` method on every API type (to safely cache and mutate objects); `controller-gen` writes those for you. You never hand-edit that file.
- **`make manifests`** rewrites the CRD YAML from your markers. That YAML is the contract the API server enforces.

::: danger Forgetting This Breaks CI
If you edit the Go types but skip regeneration, your struct and the installed CRD schema drift apart, and CI fails on a "generated files are out of date" check. It's the operator equivalent of editing a `.ts` file but forgetting to rebuild the generated OpenAPI client -- except here it's enforced. Run both targets, commit the generated files.
:::

::: tip Key Takeaway
A CRD teaches Kubernetes a new resource type. In this repo the type is `Dashboard`, defined as an ordinary Go struct with `spec` and `status` halves. Kubebuilder markers (`// +kubebuilder:...`) generate its validation; CEL handles cross-field rules; print columns shape `kubectl get`. After any change to the types, run `make generate && make manifests` and commit the output.
:::

---

<div class="checkpoint">

#### Before You Continue

You should be able to:
- [ ] Explain what a CRD is using the "new table" analogy
- [ ] Identify the `spec` (desired) and `status` (observed) halves of a resource
- [ ] Recognize a kubebuilder marker and say what `controller-gen` does with it
- [ ] Explain what CEL `XValidation` rules add on top of per-field markers
- [ ] Recite the two commands to run after editing `api/v1alpha1/` types

</div>

::: info What's Next
Next: **[RBAC & Access](./rbac-and-access)** -- how the operator (and the BFF) get permission to do what they do.
:::
