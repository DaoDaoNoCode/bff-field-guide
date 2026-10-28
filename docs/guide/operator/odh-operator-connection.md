# The ODH Operator Connection

> The Dashboard operator doesn't decide whether it should exist. A *different* operator does. This page is the handshake between the two.

Throughout Part 5 we've treated the `Dashboard` CR's `spec` — especially `spec.components` — as a given. Something hands the operator that resource, already populated. This page is about that something: the **ODH Operator**, and the small interface that connects the two levels.

## Two operators, one lifecycle

The dashboard-operator you've been reading is **Level 2**. Above it sits **Level 1**, the ODH Operator, in a *separate repository* (`opendatahub-io/opendatahub-operator`).

```
┌──────────────────────────────────────────────────────────────┐
│ Level 1 — ODH Operator   (opendatahub-io/opendatahub-operator) │
│   watches ─► DataScienceCluster (DSC) CR                       │
│   decides ─► Should Dashboard exist? With what config?         │
│   creates ─► the Dashboard CR  +  deploys the dashboard-operator│
│              (Helm chart dashboard-operator/charts/dashboard)  │
└───────────────────────────┬──────────────────────────────────┘
                            │  BuildModuleCR() projects DSC → Dashboard spec
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Level 2 — Dashboard Module Controller  (dashboard-operator/)   │
│   watches ─► Dashboard CR                                       │
│   decides ─► which modules, which images, MaaS Portal on/off    │
│   creates ─► a Deployment per module, Services, RBAC, ConfigMaps│
└──────────────────────────────────────────────────────────────┘
```

| Repository | Contains |
|---|---|
| `opendatahub-io/opendatahub-operator` | The ODH Operator — manages *all* components (Dashboard, Model Registry, Pipelines, …) |
| `opendatahub-io/odh-dashboard` | The Dashboard app **and** the Dashboard Module Controller (`dashboard-operator/`) |

::: info Why Does the Controller Live in the App Repo?
The dashboard-operator sits in the *dashboard* repo — not the ODH Operator repo — because it's tightly coupled to the dashboard's manifests, container naming, and module list. When the Dashboard team adds a module or restructures a manifest, they change the controller in the *same PR*. Co-location keeps the tightly-coupled things together.
:::

## The ModuleHandler interface

In the ODH Operator, the dashboard is a **module**: an out-of-tree operator plus its CR, managed through a common **ModuleHandler** interface (`internal/controller/modules/types.go`). Dashboard's handler lives at `internal/controller/modules/dashboard/handler.go`. (Older ODH versions had an in-tree `components/dashboard` controller; that is gone.)

The interface has about a dozen methods:

```go
type ModuleHandler interface {
    GetName() string
    IsEnabled(modules *configApi.PlatformModules) bool
    GetGVK() schema.GroupVersionKind
    GetOperatorManifests(platform *PlatformContext) OperatorManifests      // Helm chart or kustomize
    PopulatePlatformModule(pm *configApi.PlatformModules, dscCtx *DSCContext)
    BuildModuleCR(ctx context.Context, cli client.Client, dscCtx *DSCContext, cfg *ModuleCRConfig) (*unstructured.Unstructured, error)
    GetRelatedImages() []string
    GetModuleStatus(ctx context.Context, cli client.Client) (*ModuleStatus, error)
    GetModuleCRState(ctx context.Context, cli client.Client) (CRState, error)
    DeleteModuleCR(ctx context.Context, cli client.Client) error
    DeleteOperatorResources(ctx context.Context, cli client.Client, platform *PlatformContext) error
    WriteDSCComponentStatus(dsc *dscApi.DataScienceCluster, enabled bool, releases []common.ComponentRelease)
}
```

That looks like a lot, but a module team rarely writes most of it. The handler **embeds `modules.BaseHandler`**, which implements nearly everything from a `ModuleConfig`:

```go
type handler struct {
    modules.BaseHandler
}

func NewHandler() *handler {
    return &handler{BaseHandler: modules.BaseHandler{Config: modules.ModuleConfig{
        Name:        "dashboard",
        CRName:      "default-dashboard",          // must match the CRD's CEL rule
        ReleaseName: "dashboard-operator",
        ChartDir:    "dashboard-operator",
        Values: map[string]any{
            "namePrefix":    "",                                  // Deployment = "dashboard-operator"
            "webhook":       map[string]any{"enabled": false},    // CEL enforces the singleton
            "relatedImages": emptyRelatedImageValues(),           // let params.env digests win
        },
        GVK:             gvk.Dashboard,
        ControllerImage: "RELATED_IMAGE_ODH_DASHBOARD_OPERATOR_IMAGE",
        RelatedImages:   relatedImages(),               // support.go
        SubmoduleConditions: []modules.SubmoduleCondition{{
            SourceConditionType: "MaaSPortalAvailable", // lifted from the Dashboard CR into the DSC
            DSCConditionType:    "MaaSPortalAvailable",
            // ...
        }},
    }}}
}
```

The Dashboard handler only writes three methods itself:

- **`PopulatePlatformModule`** — sets the dashboard module to `Managed` when *either* `dashboard.standard` *or* `dashboard.maasPortal` is `Managed` in the DSC. The dashboard-operator ships both workloads, so it must stay up for portal-only installs.
- **`IsEnabled`** — reads that already-computed `PlatformModules.Dashboard` state.
- **`BuildModuleCR`** — the important one. It projects the DSC into a full `Dashboard` spec (next section).

::: tip Embedding Does the Heavy Lifting
This is Go struct embedding at work: `handler` gets every `BaseHandler` method for free and overrides only the three it cares about. It's the closest Go gets to "extend a base class and override a few methods", and it's why adding a new module to ODH is mostly configuration. (See Part 1's [Structs](/guide/go-basics/structs).)
:::

### How the dashboard-operator gets deployed

`BaseHandler.GetOperatorManifests` renders the Helm chart that lives in *this* repo, `dashboard-operator/charts/dashboard`, with release name `dashboard-operator` and the values above. The chart source is pinned in the ODH Operator's `manifests-config.yaml` under `componentCharts.dashboard-operator`: ODH points at `opendatahub-io/odh-dashboard` `main@<sha>`, RHOAI at the downstream `rhoai-x.y@<sha>` branch. A chart change in odh-dashboard therefore reaches ODH only when someone bumps that pinned SHA.

`relatedImages()` in `internal/controller/modules/dashboard/support.go` lists every `RELATED_IMAGE_*` env var injected into the operator Deployment. A module whose image is not in that list never gets its env var, so it silently falls back to the default in `params.env`.

## The `spec.components` projection

Here's the design decision that makes everything decoupled: the dashboard-operator **never reads the DataScienceCluster directly.** It only reads the `spec.components` map on its *own* Dashboard CR — a map that `BuildModuleCR` populated for it.

```
DSC (owned by ODH Operator)        Dashboard CR (owned by dashboard-operator)
───────────────────────────        ──────────────────────────────────────────
spec:                              spec:
  components:                        managementState: Managed
    dashboard:                       maasPortal:
      standard:                        managementState: Removed
        managementState: Managed     components:            ◄── projected subset
      maasPortal:                      modelregistry:  {managementState: Managed}
        managementState: Removed       mlflowoperator: {managementState: Removed}
    aiHub:                             trustyai:       {managementState: Removed}
      managementState: Managed         aipipelines:    {managementState: Managed}
    aipipelines:                       dataRegistry:   {managementState: Removed}
      managementState: Managed       notebooksNamespace: rhods-notebooks
    workbenches:                     gateway:
      managementState: Managed         domain: <from GatewayConfig status>
```

The DSC is v3. `BuildModuleCR` does the projection in a few small functions:

- **`dashboardModuleSpec`** maps `dashboard.standard.managementState` to `spec.managementState`, and `dashboard.maasPortal.managementState` to `spec.maasPortal.managementState`.
- **`buildComponentsMap`** projects exactly five keys:

  | Dashboard `spec.components` key | DSC source |
  |---|---|
  | `modelregistry` | `aiHub` |
  | `mlflowoperator` | `mlflowoperator` |
  | `trustyai` | `trustyai` |
  | `aipipelines` | `aipipelines` |
  | `dataRegistry` | `data.dataRegistry` |

- **`notebooksNamespace`** is set when workbenches is `Managed` (the workbench namespace, or the platform default); **`modelRegistryNamespace`** comes from `aiHub.instancesNamespace`; **`gateway.domain`** comes from the GatewayConfig status.

There is no "deployment mode" and no `spec.modules` projection: module overrides are for admins, not for the ODH Operator. The dashboard-operator's [three-pass resolver](./modules-and-federation) reads the `components` map:

```
DSC says modelregistry = Managed   →  deploy the model-registry-ui module
DSC says aipipelines   = Removed   →  disable automl AND autorag (they need aipipelines)
```

::: info The React Props Analogy — Completed
Remember the framing from the [overview](./index): ODH Operator = **layout component**, dashboard-operator = **page component**, Dashboard CR = **props**. `BuildModuleCR` is the layout computing the child's props from its own state. The page (reconciler) is a render function of those props. The layout never reaches into the page's internal state — it re-renders with new props and trusts the page to reconcile. `spec.components` *is* the props object.
:::

### Why projection instead of passthrough?

Reading its own stable schema rather than the DSC buys the dashboard-operator four things:

- **Schema insulation** — if the DSC CRD renames a field or restructures, only `BuildModuleCR` changes. The dashboard-operator is untouched.
- **Testability** — unit tests construct a `DashboardSpec` directly; no DSC, no ODH Operator, no cluster:
  ```go
  spec := v1alpha1.DashboardSpec{
      Components: map[string]v1alpha1.ComponentAvailability{
          "modelregistry": {ManagementState: "Managed"},
          "aipipelines":   {ManagementState: "Removed"},
      },
  }
  statuses := resolveModuleStatuses(&spec)   // pure, offline, fast
  ```
- **Version independence** — the DSC CRD can move to `v1beta1`/`v2` without touching the Dashboard CRD.
- **No type coupling** — the controller never reads the DSC to make decisions and doesn't import the ODH Operator's types. (Its ClusterRole does include get/list/watch on DataScienceClusters and DSCInitializations, and get on `aihubs/default-aihub`. Kubernetes RBAC won't let an operator grant permissions it doesn't hold itself, and the dashboard's own ServiceAccount needs those reads.)

## The full lifecycle, end to end

Trace one admin action all the way to a running dashboard:

```
1. Admin applies a DataScienceCluster (v3):
     spec.components.dashboard.standard.managementState = Managed
     spec.components.aiHub.managementState              = Managed

2. ODH Operator reconciles the DSC:
     handler.PopulatePlatformModule(…) → PlatformModules.Dashboard = Managed
     handler.IsEnabled(…)              → true
     handler.BuildModuleCR(…)          → a Dashboard CR with the projected spec

3. ODH Operator renders the Helm chart dashboard-operator/charts/dashboard
   (GetOperatorManifests) → the dashboard-operator Deployment, RBAC, CRD,
   then creates/updates the Dashboard CR

4. dashboard-operator's watch fires → Reconcile runs (the pipeline on The Reconciler page)
     reads spec.components → resolveModuleStatuses → renders → SSA applies
     writes status.url, status.moduleStatuses, conditions

5. Dashboard is running; status shows phase: Ready
```

And when the admin **changes** a component — say, removes Model Registry:

```
1. Admin: spec.components.aiHub.managementState → Removed   (on the DSC)
2. ODH Operator re-runs BuildModuleCR → Dashboard CR now has modelregistry: Removed
3. dashboard-operator sees the update → re-runs resolveModuleStatuses
4. modelRegistry module disabled → deleteModuleResources removes its Deployment, Service, ...
5. federation ConfigMap regenerated without model-registry
6. new federation hash on the pod template → rolling restart
```

::: info Everything Is Event-Driven
No polling, no cron. Each level reacts to watch events on the resource it owns: admin → DSC → ODH Operator → Dashboard CR → dashboard-operator → cluster resources. Change flows downhill, one watch at a time, until the cluster converges. That's the whole system.
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Which operator creates the Dashboard CR, and which one reconciles it?
- [ ] Which ModuleHandler methods does the Dashboard handler write itself, and where do the rest come from?
- [ ] How does the ODH Operator deploy the dashboard-operator, and how does a chart change reach it?
- [ ] Why does the dashboard-operator read `spec.components` instead of the DSC directly?
- [ ] Name two benefits the projection (vs passthrough) buys you.
- [ ] Walk the event chain from "admin edits the DSC" to "a module's pods restart."

</div>

::: info What's Next
Last page of Part 5: **[Testing the Operator](./testing)** — how all this logic gets tested without a real cluster, with envtest, the fake client, and `export_test.go`.
:::

::: info See Also
- [The CRD](./the-crd) — the `spec.components` and `ManagementSpec` types being projected
- [Modules & Federation](./modules-and-federation) — the resolver that consumes `spec.components`
- [Part 5 Overview](./index) — the two-level architecture introduced
:::
