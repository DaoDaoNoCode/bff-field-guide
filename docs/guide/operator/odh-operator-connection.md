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
└───────────────────────────┬──────────────────────────────────┘
                            │  BuildModuleCR() projects DSC → Dashboard spec
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Level 2 — Dashboard Module Controller  (dashboard-operator/)   │
│   watches ─► Dashboard CR                                       │
│   decides ─► which modules, which images, sidecar/standalone    │
│   creates ─► Deployments, Services, RBAC, ConfigMaps            │
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

Each component the ODH Operator manages implements a **ModuleHandler** — a deliberately tiny interface (just three methods) that bridges platform-level DSC config to a component-specific CR. Dashboard's handler lives in the ODH Operator repo, under `components/dashboard/`.

```go
// 1. Factory — called once at ODH Operator startup, when registering handlers.
func NewHandler() *Handler

// 2. Should this component be deployed? (reads the DSC)
func (h *Handler) IsEnabled(dsc *dscv1.DataScienceCluster) bool

// 3. Project the DSC onto a component CR.
func (h *Handler) BuildModuleCR(
    dsc *dscv1.DataScienceCluster,
    dsci *dsciv1.DSCInitialization,
    platform cluster.Platform,
) (*v1alpha1.Dashboard, error)
```

- **`NewHandler`** — construct the handler; register it alongside every other component's handler.
- **`IsEnabled`** — during the ODH Operator's own reconcile, this decides whether Dashboard needs attention (typically: is `dashboard` set to `Managed` in the DSC?). Return `false` and the ODH Operator won't deploy the dashboard-operator, and may clean up existing Dashboard resources.
- **`BuildModuleCR`** — the important one. It takes the high-level DSC and *projects* it into a full `DashboardSpec`: gateway domain, the `components` map, observability, module overrides, deployment mode.

::: tip Deliberately Minimal
Three methods, on purpose. The interface was pared down to match the simplest existing handler (`mlflowoperator`) so a new component can be added without understanding ODH Operator internals. Small interfaces are idiomatic Go — the smaller the surface, the easier to implement and mock.
:::

## The `spec.components` projection

Here's the design decision that makes everything decoupled: the dashboard-operator **never reads the DataScienceCluster directly.** It only reads the `spec.components` map on its *own* Dashboard CR — a map that `BuildModuleCR` populated for it.

```
DSC (owned by ODH Operator)        Dashboard CR (owned by dashboard-operator)
───────────────────────────        ──────────────────────────────────────────
spec:                              spec:
  components:                        components:            ◄── projected subset
    dashboard:      Managed            modelregistry: Managed
    modelregistry:  Managed            aipipelines:   Managed
    aipipelines:    Managed
```

`BuildModuleCR` translates the DSC's component list into the Dashboard CR's `components` map, where each entry's `ManagementState` is `Managed`, `Unmanaged`, or `Removed`. The dashboard-operator's [three-pass resolver](./modules-and-federation) reads exactly this map:

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
- **RBAC minimization** — the dashboard-operator needs no permission to read DSCs, and doesn't import the ODH Operator's types.

## The full lifecycle, end to end

Trace one admin action all the way to a running dashboard:

```
1. Admin applies a DataScienceCluster:
     spec.components.dashboard      = Managed
     spec.components.modelregistry  = Managed

2. ODH Operator reconciles the DSC:
     handler.IsEnabled(dsc)   → true
     handler.BuildModuleCR(…) → a Dashboard CR with projected spec.components

3. ODH Operator deploys the dashboard-operator Deployment
   and creates/updates the Dashboard CR (+ its RBAC)

4. dashboard-operator's watch fires → Reconcile runs (the 14 steps)
     reads spec.components → resolveModuleStatuses → renders → SSA applies
     writes status.url, status.moduleStatuses, conditions

5. Dashboard is running; status shows phase: Ready
```

And when the admin **changes** a component — say, removes Model Registry:

```
1. Admin: spec.components.modelregistry → Removed   (on the DSC)
2. ODH Operator re-runs BuildModuleCR → Dashboard CR now has modelregistry: Removed
3. dashboard-operator sees the update → re-runs resolveModuleStatuses
4. modelRegistry module disabled → its resources garbage-collected
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
- [ ] What are the three ModuleHandler methods, and what does `BuildModuleCR` do?
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
