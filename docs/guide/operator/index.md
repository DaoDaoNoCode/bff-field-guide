# Part 5: The Dashboard Operator

> **The deep dive** -- what the dashboard-operator actually is, why it exists, and how the pieces you'll read in the next six pages fit together.

You've spent Parts 1–3 learning Go and the BFF. You spent Part 4 loading the Kubernetes concepts an operator relies on. Now we open the operator itself: `dashboard-operator/`, roughly 3,400 lines of Go that turn a single custom resource into a running dashboard with all its module containers, Services, RBAC, and federation config.

If you've never seen an operator before, here's the one-sentence version: **an operator is a program that runs a control loop inside the cluster, watching a resource you define and continuously making reality match it.** You already met the mental model in Part 4 — it's React's render loop, but the DOM is your Kubernetes cluster.

::: info Where This Code Lives
Everything in Part 5 lives under `dashboard-operator/` in the `opendatahub-io/odh-dashboard` monorepo — the *same* repo as the frontend and the BFFs. That co-location is deliberate, and we'll explain why on the [ODH Operator Connection](./odh-operator-connection) page.
:::

## What the Dashboard Module Controller Does

The operator's official name is the **Dashboard Module Controller**. Its job is narrow and specific:

- It watches **one** custom resource — a `Dashboard` CR named `default-dashboard`.
- It reads that CR's `spec` to learn which platform components are available and which UI modules the admin wants.
- It renders and applies all the Kubernetes resources that make up a running dashboard: the main Deployment, the module BFF containers, Services, RBAC, NetworkPolicies, and the Module Federation ConfigMap.
- It writes back a `status` describing what actually happened — the dashboard URL, per-module health, and conditions.

That's it. It does not manage the whole platform. It does not decide whether the dashboard should exist. It takes one resource and reconciles the world to match it.

::: tip The One-Resource Rule
The `Dashboard` CR is a **cluster-scoped singleton** — exactly one can exist in the entire cluster, and it *must* be named `default-dashboard`. This is enforced at the API server by a CEL validation rule, so you can never accidentally create two. We'll see the exact rule on [The CRD](./the-crd) page.
:::

## The Two-Level Architecture

The single most important thing to understand before reading any operator code is that there are **two** operators, not one:

```
┌────────────────────────────────────────────────────────────┐
│  Level 1: ODH Operator                                       │
│  (repo: opendatahub-io/opendatahub-operator)                 │
│                                                              │
│   watches ──► DataScienceCluster (DSC) CR                    │
│   decides ──► Should the Dashboard exist? With what config?  │
│   creates ──► the Dashboard CR  +  deploys this operator     │
└───────────────────────────┬────────────────────────────────┘
                            │ creates & updates
                            ▼
┌────────────────────────────────────────────────────────────┐
│  Level 2: Dashboard Module Controller  ◄── YOU ARE HERE      │
│  (repo: opendatahub-io/odh-dashboard → dashboard-operator/)  │
│                                                              │
│   watches ──► Dashboard CR                                   │
│   decides ──► Which modules? Which images? Sidecar or        │
│               Standalone? What goes in federation config?    │
│   creates ──► Deployments, Services, RBAC, ConfigMaps,       │
│               NetworkPolicies                                │
└────────────────────────────────────────────────────────────┘
```

The ODH Operator is corporate headquarters — it decides which stores (components) to open. The Dashboard operator is the local store manager — it knows how to actually run *this* store. The full handshake between them, including the `ModuleHandler` interface and the `spec.components` projection, is the subject of the [ODH Operator Connection](./odh-operator-connection) page.

::: info Analogy for the React Developer
Think of the ODH Operator as a **layout component** that decides which pages exist based on feature flags, and the Dashboard operator as a **page component** that owns its own state and renders its children. The `Dashboard` CR is the **props** passed from layout to page. The layout never reaches into the page's internal state — it passes props and trusts the page to render.
:::

## Why an Operator at All?

A fair question from a frontend perspective: why not just ship a Helm chart or a set of YAML manifests and be done?

Because the dashboard's shape is **dynamic and dependency-driven**. Which module containers run depends on which platform components are installed. Disabling one component has to cascade to the modules that depend on it. When a module is added or removed, the frontend's Module Federation config has to change *and* the main pod has to restart to pick it up. Container images have to be resolved from environment variables that Konflux rewrites at build time. None of that is expressible as static YAML — it needs a program that reacts to change. That program is the operator.

::: warning This Is Not a CI/CD Pipeline
A common misconception: an operator is *not* a deploy script that runs once. It's a long-lived process that runs a reconcile loop **continuously**, reacting to every change to its watched resources — forever, event-driven, no cron. If someone hand-edits a Service the operator owns, the next reconcile puts it back. Keep this "always converging" model in mind; it explains a lot of the design decisions ahead.
:::

## How the Rest of Part 5 Is Organized

Read these in order — each builds on the last:

| Page | What it covers |
|---|---|
| [Controller-Runtime](./controller-runtime) | The four pillars — Scheme, Manager, Controller, Reconciler — and how `main.go` wires them together |
| [The CRD](./the-crd) | The `Dashboard` CRD Go types, kubebuilder markers, CEL validation, and deep-copy generation |
| [The Reconciler](./reconciler) | The 14-step reconcile pipeline, idempotency, Sidecar vs Standalone modes, teardown |
| [Modules & Federation](./modules-and-federation) | The module registry, three-pass dependency resolution, and the federation ConfigMap |
| [ODH Operator Connection](./odh-operator-connection) | The `ModuleHandler` interface and how DSC state flows into the Dashboard CR |
| [Testing the Operator](./testing) | envtest, the fake client, `export_test.go`, and idempotency tests |

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] What single resource does the Dashboard Module Controller watch, and what must it be named?
- [ ] Which operator *creates* the `Dashboard` CR, and which one *reconciles* it?
- [ ] Why is a static Helm chart insufficient for deploying the dashboard?
- [ ] What does "the operator is always converging" mean in practice?

</div>

::: info What's Next
Start with **[Controller-Runtime](./controller-runtime)** — the four building blocks every operator is made of, and how the dashboard-operator's `main.go` assembles them.
:::
