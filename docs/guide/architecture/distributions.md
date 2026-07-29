# Distributions

> **The deployable product layer** -- how the dashboard composes BFFs, shell frameworks, and frontends into shippable container images.

The previous chapters showed you what a single BFF looks like inside: `cmd/`, `internal/api/`, `internal/integrations/`. But a BFF on its own is not a product. The `distributions/` folder is where individual pieces become container images that ship to clusters.

There are three distributions. They are not three copies of the same thing.

## At a Glance

| Distribution | What It Is | Has Go Code? | Has Frontend? | Deployable? |
|---|---|---|---|---|
| `base` | React shell framework (library) | No | Yes -- but it is a library, not an app | No |
| `core-bff` | Standalone Go BFF + dev frontend | Yes -- its own Go module | Yes | Yes |
| `rhaii` | RHAII frontend + core-bff binary | No -- builds core-bff verbatim | Yes | Yes |

The key insight: `rhaii` does not have its own Go backend. It builds the exact same `core-bff` binary and pairs it with a different frontend. The distributions layer is where the "plug different frontends onto the same backend" pattern materializes as deployable artifacts.

## `base/` -- The Shell Framework

`base` is not a deployable distribution. It is a React component library that other distributions import. Think of it as the app shell that every frontend plugs into.

It exports:

- **`Shell`**, **`ShellHeader`**, **`ShellNav`**, **`ShellRoutes`** -- the structural components that render the sidebar, top bar, and routed page content
- **`createDistribution(config)`** -- a factory function that accepts a `DistributionConfig` (extensions + feature flags), creates a `PluginStore`, and renders the shell with all extensions wired in
- **`ThemeProvider`**, **`ErrorBoundary`** -- infrastructure components

The framework is extension-driven. A distribution declares its routes, navigation items, and toolbar items in an `extensions.ts` file. At build time, a webpack plugin reads a `distribution.yaml` manifest, resolves the declared packages, and generates a virtual module that the shell consumes.

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
│   ├── webpack.common.js        # shared webpack factory all distributions extend
│   └── generateDistributionExtensionsPlugin.js  # reads distribution.yaml → virtual module
└── package.json                 # @odh-dashboard/base-distribution
```

No Go code. No Dockerfile. No K8s manifests. If you need to change the app shell structure (header, sidebar, route rendering), this is where you work.

## `core-bff/` -- The Full-Stack Distribution

`core-bff` is a standalone Go BFF that handles platform-wide concerns: dashboard configuration, cluster settings, component management, connection types, serving runtimes, K8s API proxying, and WebSocket relay. It does not depend on any code in `packages/` -- its `go.mod` is a self-contained module.

```
distributions/core-bff/
├── bff/                         # the Go BFF
│   ├── cmd/main.go              # entry point (30+ flags, env var support)
│   ├── internal/
│   │   ├── api/
│   │   │   ├── app.go           # App struct, NewApp()
│   │   │   ├── routes.go        # Routes() → newServiceMux() → newCombinedMux()
│   │   │   ├── routes_base.go   # healthcheck, user, namespaces
│   │   │   ├── routes_config.go # config, components, status, dashboard-config, cluster-settings
│   │   │   ├── routes_connection_types.go  # connection test, connection type CRUD
│   │   │   ├── routes_model_serving.go     # serving runtimes, NIM, Prometheus queries
│   │   │   ├── routes_openapi.go           # Swagger UI, spec serving (dev mode only)
│   │   │   ├── middleware.go               # RecoverPanic, EnableTelemetry, EnableCORS
│   │   │   ├── middleware_auth.go          # secureRoute, secureAdminRoute, requirePlatform
│   │   │   └── *_handler.go               # one file per domain
│   │   ├── repositories/        # 14 repositories (see below)
│   │   ├── integrations/        # K8s client, bffclient, httpclient
│   │   ├── proxy/               # K8s HTTP proxy + WebSocket relay
│   │   └── config/              # EnvConfig with 30+ settings
│   ├── go.mod                   # standalone module -- Go 1.25, does NOT import from packages/
│   └── openapi/                 # OpenAPI spec
├── frontend/                    # dev UI for testing core-bff endpoints
├── manifests/base/              # kustomize: Deployment, Service, Role, RoleBinding
├── Dockerfile                   # three-stage build → distroless
└── contract-tests/              # API contract validation
```

### How Routes Compose

The route composition is the interesting part. Instead of one massive route registration, core-bff splits routes across domain-specific files that each register their own subset:

```go
func (app *App) Routes() http.Handler {
    serviceMux := app.newServiceMux()
    staticHandler := app.newStaticHandler()
    return app.newCombinedMux(serviceMux, staticHandler)
}
```

`newServiceMux()` creates an `httprouter.Router` and calls four registration functions:

```go
app.registerBaseRoutes(apiRouter)            // routes_base.go
app.registerConfigRoutes(apiRouter)          // routes_config.go
app.registerConnectionTypeRoutes(apiRouter)  // routes_connection_types.go
app.registerModelServingRoutes(apiRouter)    // routes_model_serving.go
```

Each function receives the same router and registers its routes on it. This is straightforward -- no magic, no auto-discovery. Adding a new domain means creating a `routes_newdomain.go` file and calling its registration function from `newServiceMux()`.

The same mux also mounts three reverse proxies:

- `/api/k8s/*` -- HTTP passthrough to the Kubernetes API server
- `/wss/k8s/*` -- WebSocket relay to the Kubernetes API server
- `/api/service/model-serving/*` -- passthrough to the model-serving service

Every path is served both bare (`/api/...`) and with a `/core-bff` prefix (`/core-bff/api/...`) via `http.StripPrefix`, so the routing works regardless of whether the request comes through a gateway or directly.

### Auth Model

Core-bff uses a different auth pattern than the package BFFs. Instead of `RequireAccessToService` with SAR checks per resource, it has two auth wrappers:

- **`secureRoute(handler)`** -- validates the token, resolves the user via `SelfSubjectReview`, emits an audit log entry. Used for endpoints any authenticated user can access.
- **`secureAdminRoute(handler)`** -- same as `secureRoute` plus an `IsUserAdmin` SAR check. Returns 403 for non-admin users.

There is also **`requirePlatform(platform, handler)`** which returns 404 if the current platform does not match. For example, the `AllowedUsersPath` endpoint is registered as:

```go
r.GET(AllowedUsersPath,
    app.requirePlatform(config.PlatformOpenShift,
        app.secureAdminRoute(app.GetAllowedUsersHandler)))
```

This means: OpenShift-only, admin-only. On a non-OpenShift cluster, the endpoint does not exist. On OpenShift, non-admins get 403.

### The 14 Repositories

Core-bff organizes its business logic into repositories, one per domain:

| Repository | Domain |
|---|---|
| HealthCheck | Liveness/readiness checks |
| User | Current user info |
| Namespace | Namespace listing and metadata |
| DashboardConfig | OdhDashboardConfig CR CRUD |
| Status | Dashboard status and feature flags |
| Auth | Token validation, user resolution |
| Components | OdhApplication CR management |
| ClusterSettings | Cluster-wide settings |
| ConnectionType | Connection type CRUD with test probes |
| AllowedUsers | OpenShift-only user allowlist |
| ServingRuntime | ServingRuntime/InferenceService management |
| NIM | NVIDIA NIM integration status |
| NamespaceMutation | Namespace creation and annotation |
| Prometheus | Prometheus query proxy |

## `rhaii/` -- The Product Distribution

`rhaii` is the Red Hat AI distribution. It pairs the core-bff Go binary with an RHAII-specific frontend built on the `base` shell framework.

```
distributions/rhaii/
├── src/
│   ├── bootstrap.tsx            # imports createDistribution from base, passes extensions
│   └── extensions.ts            # RHAII-specific nav sections, routes, toolbar items
├── distribution.yaml            # declares distribution name and extension packages
├── config/
│   └── webpack.common.js        # extends base webpack config, adds model-serving packages conditionally
├── Dockerfile                   # three-stage build: RHAII frontend + core-bff binary → distroless
└── developing/                  # local dev tooling (Kind, KServe, Tiltfile)
```

The `distribution.yaml` is minimal:

```yaml
name: rhaii
productName: "Red Hat AI"

packages:
  local:
    - name: rhaii
      extensionsPath: ./extensions
  bundled: []

featureFlags: {}
```

The webpack config conditionally includes model-serving packages when `ENABLE_MODEL_SERVING=true` is set at build time.

The critical thing about `rhaii` is what it does NOT have: no Go code. Its Dockerfile builds the core-bff binary from `distributions/core-bff/bff/` and packages it alongside the RHAII frontend assets. Same backend, different frontend.

## The Dockerfile Pattern

Both `core-bff` and `rhaii` use the same three-stage build:

1. **UI stage** (Node 22) -- builds the frontend inside the full npm workspace (`npm ci` at workspace root, then build the specific distribution)
2. **BFF stage** (Go 1.25) -- compiles the core-bff binary from `distributions/core-bff/bff/`
3. **Final stage** (`gcr.io/distroless/static:nonroot`) -- copies the binary, OpenAPI spec, and static assets into a minimal container

The final image runs as nonroot user 65532 with a read-only root filesystem and all Linux capabilities dropped.

::: warning Go Version Difference
The core-bff and rhaii Dockerfiles use Go 1.25, while the package BFFs (gen-ai, automl, maas, etc.) use Go 1.26. These are independent Go modules with independent version requirements.
:::

## Quick Reference: Where Does X Go?

| I need to... | Put it in... |
|---|---|
| Add a platform-wide API route (config, RBAC, components) | `distributions/core-bff/bff/internal/api/routes_*.go` |
| Add a feature-specific BFF route (AI models, pipelines) | `packages/*/bff/internal/api/app.go` |
| Change the RHAII frontend shell (nav items, routes, toolbar) | `distributions/rhaii/src/extensions.ts` |
| Change the shared app shell framework (header, sidebar, routing) | `distributions/base/src/` |
| Add K8s manifests for deployment | `distributions/core-bff/manifests/base/` |
| Change the container build process | `distributions/core-bff/Dockerfile` or `distributions/rhaii/Dockerfile` |
| Add a new repository to core-bff | `distributions/core-bff/bff/internal/repositories/` and wire it in `app.go` |

::: tip Key Takeaway
The `distributions/` folder turns individual BFFs into deployable products. `base` is a frontend library that provides the shell framework. `core-bff` is a standalone Go BFF handling platform-wide concerns, with routes split across domain-specific files. `rhaii` builds the exact same core-bff binary and pairs it with a product-specific frontend. The pattern is "same backend, different frontend" -- and the Dockerfile is where they meet.
:::

::: info See Also
- [Directory Structure](./directory-structure) -- how a single package BFF is organized
- [The Big Picture](./big-picture) -- where distributions fit in the overall architecture
- [The App Struct & Routes](../deep-dive/app-and-routes) -- deep dive into route registration (covers package BFFs)
- [What Is Coming Next](./whats-next) -- the migration roadmap for core-bff
:::
