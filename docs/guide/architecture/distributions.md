# Distributions

> **The deployable product layer** -- how the dashboard composes BFFs, shell frameworks, and frontends into shippable container images.

The previous chapters showed you what a single BFF looks like inside: `cmd/`, `internal/api/`, `internal/integrations/`. But a BFF on its own is not a product. The `distributions/` folder is where individual pieces become container images that ship to clusters.

There are four distributions. They are not four copies of the same thing.

## At a Glance

| Distribution | What It Is | Has Go Code? | Has Frontend? | Deployable? |
|---|---|---|---|---|
| `base` | React shell framework (library) | No | Yes -- but it is a library, not an app | No |
| `core-bff` | The dashboard's platform Go BFF + dev frontend | Yes -- its own Go module | Yes (a dev UI) | Yes |
| `rhaii` | RHAII frontend + core-bff binary | No -- builds core-bff verbatim | Yes | Yes |
| `maas-portal` | MaaS Portal frontend, served by core-bff | No -- uses core-bff | Yes | Yes (inside the core-bff image) |

The key insight: neither `rhaii` nor `maas-portal` has its own Go backend. Both run the exact same `core-bff` binary with a different frontend. The distributions layer is where the "plug different frontends onto the same backend" pattern materializes as deployable artifacts. How core-bff behaves in each shape is covered in [Part 7: Core BFF Across Distributions](/guide/core-bff/distributions).

## `base/` -- The Shell Framework

`base` is not a deployable distribution. It is a React component library that other distributions import. Think of it as the app shell that every frontend plugs into.

It exports (`distributions/base/src/lib.ts`):

- **`Shell`**, **`ShellHeader`**, **`ShellNav`**, **`ShellRoutes`** -- the structural components that render the sidebar, top bar, and routed page content
- **`createDistribution(config)`** -- a factory function that accepts a `DistributionConfig` (extensions + feature flags; the type is exported too), creates a `PluginStore`, and renders the shell with all extensions wired in
- **`ThemeProvider`**, **`useThemeContext`**, **`ErrorBoundary`**, **`K8sSdkProvider`** -- infrastructure components

The framework is extension-driven. A distribution declares its routes, navigation items, and toolbar items in an `extensions.ts` file. At build time, an rspack plugin reads a `distribution.yaml` manifest, resolves the declared packages, and generates a module that the shell consumes.

```
distributions/base/
├── src/
│   ├── lib.ts                   # public API -- exports Shell, createDistribution, etc.
│   ├── createDistribution.tsx   # the factory: config → rendered app
│   ├── ShellRoutes.tsx          # reads RouteExtension from plugin store → React Router routes
│   ├── ShellNav.tsx             # reads NavExtension from plugin store → PatternFly sidebar
│   ├── Shell.tsx                # top-level layout: header + nav + content area
│   └── ...
├── config/
│   ├── rspack.common.js         # shared rspack factory all distributions extend
│   ├── rspack.dev.js / rspack.prod.js
│   └── generateDistributionExtensionsPlugin.js  # rspack plugin: distribution.yaml → extensions module
└── package.json                 # @odh-dashboard/base-distribution
```

No Go code. No Dockerfile. No K8s manifests. If you need to change the app shell structure (header, sidebar, route rendering), this is where you work.

## `core-bff/` -- The Platform BFF

`core-bff` is the BFF for the dashboard itself: dashboard configuration, cluster settings, components, connection types, serving runtimes, NIM, Prometheus, K8s API proxying and WebSocket relay, plus serving the SPA when it is the only backend. It is a standalone Go module under `distributions/core-bff/bff/` that does not import from `packages/` -- the one exception is the shared TLS module, pulled in with `replace github.com/opendatahub-io/odh-dashboard/pkg/tls => ../../../pkg/tls`.

What it does depends on the distribution:

| Distribution | Core BFF's role |
|---|---|
| RHOAI / ODH dashboard | Third container in the dashboard pod, on `:8943` (TLS). Fastify is still primary and forwards `/core-bff/api/*` to it |
| `rhaii` | Sole backend: serves the shell, the baked-in model-serving remote and all APIs |
| `maas-portal` | Sole backend: serves the portal SPA and proxies the maas and gen-ai module BFFs |

Two things trip people up:

- **Where it is deployed.** On ODH/RHOAI, core-bff is not deployed from `distributions/core-bff/manifests/base/`; it is the third container of `manifests/base/deployment.yaml`, with its image from `RELATED_IMAGE_ODH_CORE_BFF_IMAGE`. The kustomize under `distributions/core-bff/manifests/base/` is a standalone dev/xKS path (its own ServiceAccount and ClusterRole, port 4000).
- **Its auth model is not the package BFFs'.** Instead of `RequireAccessToService` with a SAR per resource, it wraps routes in `secureRoute` / `secureAdminRoute` and gates platform-specific endpoints with `requirePlatform`.

The binary itself -- flags, the handler tree, the 15 repositories, the K8s, WebSocket, model-serving and module proxies, and static serving -- is documented in [Part 7: Core BFF](/guide/core-bff/), starting with [Core BFF Architecture](/guide/core-bff/architecture).

## `rhaii/` -- The Product Distribution

`rhaii` is the Red Hat AI distribution for non-OpenShift Kubernetes (xKS). It pairs the core-bff Go binary with an RHAII-specific frontend built on the `base` shell framework.

```
distributions/rhaii/
├── src/
│   ├── bootstrap.tsx            # imports createDistribution from base, passes extensions
│   ├── extensions.ts            # RHAII-specific nav sections, routes, toolbar items
│   ├── context/                 # RHAII providers
│   └── development/tilt/        # local fixtures for the Tilt dev loop
├── distribution.yaml            # declares distribution name and extension packages
├── config/
│   ├── rspack.common.js         # extends the base rspack config, adds the modelServing remote
│   └── rspack.dev.js / rspack.prod.js
├── Makefile
├── Dockerfile                   # three-stage build: RHAII frontend + core-bff binary → distroless
└── developing/                  # local dev tooling (Kind, KServe, Tiltfile)
```

The `distribution.yaml` bundles the model-serving packages it needs:

```yaml
name: rhaii
productName: "Red Hat AI"

packages:
  local:
    - name: rhaii
      extensionsPath: ./extensions
  bundled:
    - package: '@odh-dashboard/kserve'
      extensionsPath: ./extensions
      featureFlags:
        kserve: true
    - package: '@odh-dashboard/llmd-serving'
      extensionsPath: ./extensions
      featureFlags:
        llmd-serving: true

featureFlags: {}
```

The model-serving UI itself arrives as a Module Federation remote. When the `MODEL_SERVING_REMOTE_ENTRY` build arg is set, `config/rspack.common.js` adds a `modelServing` remote; the Dockerfile defaults it to `/_mf/modelServing/remoteEntry.js` and copies the model-serving bundle into `static/_mf/modelServing/`, so the same core-bff static handler serves it.

The critical thing about `rhaii` is what it does NOT have: no Go code. Its Dockerfile builds the core-bff binary from `distributions/core-bff/bff/` and packages it alongside the RHAII frontend assets. Same backend, different frontend. See [RHAII on xKS: Core BFF Alone](/guide/core-bff/distributions#rhaii-on-xks-core-bff-alone).

## `maas-portal/` -- The Portal Distribution

`maas-portal` is a frontend-only distribution: the MaaS Portal, which gives model consumers endpoints, API keys and usage without the full dashboard. Its `distribution.yaml` bundles three packages:

```yaml
name: maas-portal
productName: "MaaS Portal"

packages:
  local:
    - name: maas-portal
      extensionsPath: ./extensions
  bundled:
    - package: '@odh-dashboard/observability'
      ...
    - package: '@odh-dashboard/maas'
      ...
    - package: '@odh-dashboard/gen-ai'
      ...
```

There is no Dockerfile and no Go code in `distributions/maas-portal/`. The portal is built inside the core-bff workspace image (`distributions/core-bff/Dockerfile.workspace`, `pnpm --filter @odh-dashboard/maas-portal-distribution run build:prod`) and served by core-bff from `/static/maas-portal`. Because the module UIs are bundled, no `/_mf/*` proxy is needed; core-bff only proxies `/maas/api/*` and `/gen-ai/api/*` to the module BFFs, using the operator-generated `maas-portal-federation-config`. Details: [MaaS Portal: Core BFF as a Product Front Door](/guide/core-bff/distributions#maas-portal-core-bff-as-a-product-front-door).

## The Dockerfile Pattern

`core-bff` and `rhaii` use the same three-stage build:

1. **UI stage** (Node 22, `pnpm@11.22.0`) -- `rhaii` runs `pnpm install --frozen-lockfile` on the whole pnpm workspace and builds the distribution; the upstream `core-bff/Dockerfile` installs and builds only `./frontend`. The workspace images (`distributions/core-bff/Dockerfile.workspace`, `Dockerfile.konflux.core-bff`) build from the full workspace and also bundle the MaaS Portal.
2. **BFF stage** (Go 1.25) -- compiles the core-bff binary from `distributions/core-bff/bff/`, together with `pkg/tls`
3. **Final stage** (`gcr.io/distroless/static:nonroot`) -- copies the binary, OpenAPI spec, and static assets into a minimal container

The final image runs as nonroot user 65532 with a read-only root filesystem and all Linux capabilities dropped. More on the images in [Core BFF Architecture](/guide/core-bff/architecture#images).

::: warning Go Version Difference
The core-bff and rhaii Dockerfiles use Go 1.25, while most package BFFs (gen-ai, automl, maas, etc.) use Go 1.26 (agent-ops is on 1.25). These are independent Go modules with independent version requirements.
:::

## Quick Reference: Where Does X Go?

| I need to... | Put it in... |
|---|---|
| Add a platform-wide API route (config, RBAC, components) | `distributions/core-bff/bff/internal/api/routes_*.go` -- see [Core BFF Architecture](/guide/core-bff/architecture) |
| Add a feature-specific BFF route (AI models, pipelines) | `packages/*/bff/internal/api/app.go` |
| Change the RHAII frontend shell (nav items, routes, toolbar) | `distributions/rhaii/src/extensions.ts` |
| Change the MaaS Portal shell | `distributions/maas-portal/src/extensions.ts` |
| Change the shared app shell framework (header, sidebar, routing) | `distributions/base/src/` |
| Change how core-bff is deployed in ODH/RHOAI | `manifests/base/deployment.yaml` (standalone: `distributions/core-bff/manifests/base/`) |
| Change the container build process | `distributions/core-bff/Dockerfile`, `Dockerfile.workspace`, or `distributions/rhaii/Dockerfile` |
| Add a new repository to core-bff | `distributions/core-bff/bff/internal/repositories/` and wire it in `repositories.go` (`Repositories`, `NewRepositories`) |

::: tip Key Takeaway
The `distributions/` folder turns individual BFFs into deployable products. `base` is a frontend library that provides the shell framework. `core-bff` is the dashboard's platform BFF. `rhaii` and `maas-portal` run the exact same core-bff binary with a product-specific frontend. The pattern is "same backend, different frontend" -- and the Dockerfile is where they meet.
:::

::: info See Also
- [Part 7: Core BFF](/guide/core-bff/) -- the platform BFF in depth, and the plan to replace Fastify with it
- [Core BFF Across Distributions](/guide/core-bff/distributions) -- containers, ports and auth for each shape
- [Directory Structure](./directory-structure) -- how a single package BFF is organized
- [The Big Picture](./big-picture) -- where distributions fit in the overall architecture
:::
