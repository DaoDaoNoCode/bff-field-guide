# What Is Coming Next

> The BFF architecture you have learned is about to evolve. Here is a heads-up on what is changing, why, and what it means for your daily work -- so nothing catches you off guard.

## The Split-Stack Problem

Right now, the ODH Dashboard runs a **split backend**. The Fastify (Node.js) server handles ~33 API route categories across ~12,700 lines of code -- dashboard config, Kubernetes proxying, RBAC, WebSocket watch, and more. Meanwhile, 8 Go-based module BFFs (gen-ai, model-registry, maas, automl, autorag, eval-hub, mlflow, agent-ops) handle package-specific logic.

This means the dashboard team maintains two backend languages, two sets of patterns, and two mental models. If you are a frontend developer who just learned Go for the BFF, you still need to understand Fastify when you touch dashboard-level routes. If you are debugging a request, you might start in Go and end up in TypeScript. Context-switching is expensive.

The initiative to fix this is already underway: **migrate the Fastify backend into a unified Go BFF.**

## Why a Core BFF? The Multi-Team Need

The core BFF is not just about eliminating TypeScript. Multiple teams need a Go backend for dashboard-level functionality right now:

| Team | What They Need | Without Core BFF | With Core BFF |
|---|---|---|---|
| **Dashboard** | Migrate Fastify routes to Go | Rewrite ~12,700 LOC from scratch | Gradual migration, route by route |
| **Connections** | Test S3, URI, OCI connections before saving | Build a new BFF with own auth, router, K8s client | Add probe handlers to the shared infrastructure |
| **Purple-Scrum** | S3 browser / FileExplorer | Duplicate S3 logic from automl/autorag | Share the S3 browser as a common handler |
| **xKC/Pewter** | Platform-agnostic backend (non-OpenShift K8s) | Fork Fastify or build new app-shell backend | Contribute a non-OpenShift auth strategy |

Without a core BFF, each team builds its own auth, routing, K8s client, and deployment infrastructure independently. The core BFF eliminates that duplication -- teams contribute handlers, the platform provides everything else.

## The Core BFF -- Shared Infrastructure for Everyone

The core BFF already exists at `distributions/core-bff/` in the monorepo. It is a standalone Go service that follows the same conventions as the module BFFs you have been learning about.

What is built today:

- **Authentication** -- user token extraction via configurable header (`x-forwarded-access-token` by default) with `disabled` mode for testing. Admin RBAC middleware (`secureAdminRoute`) for gating admin-only endpoints.
- **Platform detection** -- auto-detects OpenShift vs vanilla K8s (XKS) at startup via ClusterVersion CRD probe. Platform-specific routes are gated by `requirePlatform` middleware, so OpenShift-only endpoints return 404 on vanilla K8s.
- **K8s client** -- a token-switching client factory so each request runs with the user's own permissions
- **Router, CORS, panic recovery** -- uses Go's standard `http.ServeMux` (not httprouter) with routes split across `routes_base.go`, `routes_config.go`, `routes_connection_types.go`, `routes_model_serving.go`, and `routes_openapi.go`
- **Dashboard config CRUD** -- `GET/PATCH /api/config`, `GET/PATCH /api/dashboardConfig/:namespace/:name`, cluster settings (`GET/PUT /api/cluster-settings`)
- **Components and status** -- `GET /api/components`, `GET /api/components/remove`, `GET /api/status`
- **Connection types** -- full CRUD for connection types (`GET/POST/PUT/PATCH/DELETE /api/connection-types`)
- **Connection testing** -- `POST /api/v1/connections/test` for S3, URI, and OCI connection probes
- **Serving runtimes** -- `POST /api/servingRuntimes` for serving runtime creation
- **Prometheus query proxy** -- `POST /api/prometheus/query`, `queryRange`, `pvc`, `bias`, `serving`
- **NIM integration** -- `POST/DELETE/GET /api/integrations/nim`, `GET /api/nim-serving/:nimResource`
- **Model serving proxy** -- reverse proxy at `/api/service/model-serving/*`
- **Inter-BFF communication** -- a `bffclient` package for calling module BFFs (maas, gen-ai, model-registry, mlflow) with auth forwarding
- **Cluster discovery** -- startup-time queries for OpenShift cluster ID and branding (graceful fallback on vanilla K8s -- no OpenShift assumptions in core)
- **OpenAPI + Swagger UI** -- embedded spec with Swagger UI in dev mode
- **Static file serving** -- serves the React frontend with SPA fallback routing
- **K8s API proxy** -- reverse proxy at `/api/k8s/*` forwarding all HTTP methods to the Kubernetes API server with bearer token auth injection and sensitive header stripping (cookie, x-forwarded-*, impersonation headers)
- **WebSocket proxy** -- full-duplex WebSocket passthrough at `/wss/k8s/*` for K8s watch streams with bearer token subprotocol auth, 15-second heartbeat pings, connection tracking, and stale connection cleanup
- **SSRF protection** -- hostname resolution and private IP blocking (RFC 1918, loopback, link-local) with DNS rebinding prevention via resolve-then-connect-by-IP and redirect validation on proxy responses
- **Namespace management** -- `GET /api/namespaces/:name/:context` for namespace mutation
- **Allowed users** -- `GET /api/status/:namespace/allowedUsers`

What is planned but not yet implemented:

- **Rate limiting** -- per-user request limits

```
Today (current state):                       Future (migration complete):

Dashboard Pod                               Dashboard Pod
┌──────────────────────┐                     ┌──────────────────────┐
│  Fastify (Node.js)   │ ← still runs       │  Core BFF (Go)       │
│  - Some route groups │   (shrinking)       │  - All routes        │
│  - Auth, config      │                     │  - Auth, config      │
│  - MF proxy          │                     │  - K8s proxy         │
│                      │                     │  - WebSocket watch   │
│                      │                     │  - MF proxy          │
├──────────────────────┤                     ├──────────────────────┤
│  Core BFF (Go)       │ ← growing fast      │                      │
│  - 30+ routes        │   (distributions/   │                      │
│  - Dashboard config  │    core-bff/)       │                      │
│  - K8s API proxy     │                     │                      │
│  - WebSocket proxy   │                     │                      │
│  - Connection types  │                     │                      │
│  - Prometheus, NIM   │                     │                      │
│  - Model serving     │                     │                      │
├──────────────────────┤                     ├──────────────────────┤
│  gen-ai BFF (Go)     │                     │  gen-ai BFF (Go)     │
│  model-reg BFF (Go)  │                     │  model-reg BFF (Go)  │
│  maas BFF (Go)       │                     │  maas BFF (Go)       │
│  agent-ops BFF (Go)  │                     │  agent-ops BFF (Go)  │
│  ...                 │                     │  ...                 │
└──────────────────────┘                     └──────────────────────┘
  Two languages + core BFF growing              One language, one pattern
```

### Core BFF vs Module BFFs -- What Goes Where?

The module BFFs (gen-ai, maas, automl, etc.) own **package-specific** logic -- LlamaStack integration, pipeline management, model subscriptions. The core BFF owns **dashboard-level** logic -- the routes that do not belong to any one package but are needed by the platform itself.

| Core BFF (dashboard-level) | Module BFFs (package-level) |
|---|---|
| Dashboard config, feature flags ✅ | LlamaStack models, MCP tools (gen-ai) |
| K8s API passthrough proxy ✅ | Pipeline runs, S3 files (automl/autorag) |
| User identity, namespace listing ✅ | Model subscriptions, API keys (maas) |
| Connection types CRUD ✅ | Experiment tracking (mlflow) |
| Connection testing (S3, URI, OCI) ✅ | Evaluation jobs (eval-hub) |
| Prometheus query proxy ✅ | Model versions, artifacts (model-registry) |
| NIM integration ✅ | Agent runtime management (agent-ops) |
| Model serving proxy ✅ | |
| WebSocket watch proxy ✅ | |
| Admin RBAC middleware ✅ | |
| Module Federation proxy | |

Think of it this way: if every team might need it, it belongs in the core BFF. If only one package uses it, it stays in that package's module BFF.

### How Module BFFs Interact with the Core BFF

The core BFF has a `bffclient` package that can call module BFFs over HTTP. This is for scenarios where a dashboard-level route needs data from a module BFF -- for example, a future dashboard overview page that aggregates model counts from model-registry and prompt counts from gen-ai.

The flow is one-directional in practice: **core BFF calls module BFFs**, not the other way around. Module BFFs do not call the core BFF. Each module BFF is self-contained and talks directly to its own upstream services (LlamaStack, Pipeline Server, etc.).

```
Core BFF (distributions/core-bff/)
  |
  |-- bffclient.Call("maas", "GET", "/api/v1/models", ...) --> maas BFF (:8243)
  |-- bffclient.Call("gen-ai", "GET", "/api/v1/lsd/models", ...) --> gen-ai BFF (:8143)
  |-- bffclient.Call("model-registry", ...) --> model-registry BFF (:8043)
  |-- bffclient.Call("mlflow", ...) --> mlflow BFF (:8343)
```

The `bffclient` forwards the user's auth token to the target BFF, so RBAC checks are performed as the user, not as the core BFF's service account.

## How to Add an Endpoint to the Core BFF

If you need to add a dashboard-level endpoint (one that does not belong to any module BFF), here is the workflow. It is the same pattern you learned for module BFFs -- the skills transfer directly.

**1. Define the model** in `distributions/core-bff/bff/internal/models/`:

```go
// internal/models/widget.go
type Widget struct {
    ID   string `json:"id"`
    Name string `json:"name"`
}
```

**2. Write the handler** in `distributions/core-bff/bff/internal/api/`:

```go
// internal/api/widget_handler.go
func (app *App) GetWidgetsHandler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
    // Your logic here -- use app.kubernetesClientFactory, app.bffClientFactory, etc.
    app.WriteJSON(w, http.StatusOK, WidgetsEnvelope{Data: widgets}, nil)
}
```

**3. Register the route** in `internal/api/app.go` inside the `Routes()` method:

```go
apiRouter.GET(APIVersion+"/widgets", app.GetWidgetsHandler)
```

**4. Add to the OpenAPI spec** in `distributions/core-bff/bff/openapi/src/core-bff.yaml`.

**5. Write tests** -- the core BFF uses `envtest` for K8s mocking and `httptest` for handler tests, just like the module BFFs.

::: tip Same Pattern, Different Location
The main difference from a module BFF is the directory: `distributions/core-bff/bff/` instead of `packages/<name>/bff/`. The App struct, middleware chain, handler signature, WriteJSON helper, error envelope, and testing patterns are similar, though the core BFF uses Go's standard `http.ServeMux` (with `{param}` syntax) instead of `httprouter` (with `:param` syntax), and routes are split across `routes_*.go` files instead of one `app.go`.
:::

## How the Migration Works

The migration is **gradual, not a big-bang cutover**. Fastify endpoints move over in waves, starting with the simplest routes and ending with the most complex. Nothing breaks along the way -- the old Fastify route and the new Go route can run side by side until the team is confident the Go version is solid.

### Phase 0: Lay the Foundation ✅ (done)

The core BFF now exists at `distributions/core-bff/` in the monorepo. It handles healthcheck, user, namespaces, and OpenAPI documentation endpoints. It also has inter-BFF communication infrastructure (`bffclient` package) for calling maas, gen-ai, model-registry, and mlflow BFFs. Additionally, the K8s API proxy (`/api/k8s/*`) and WebSocket proxy (`/wss/k8s/*`) are already implemented, along with SSRF protection and TLS infrastructure for mTLS to the K8s API server.

### Phases 1-2: Audit and Extend ✅ (done)

The team audited the 33 Fastify route categories and extended the core BFF with infrastructure for the migration. All three planned items are now implemented:

- **Admin RBAC middleware** -- `secureAdminRoute` in the route registration, gating admin-only endpoints
- **HTTP reverse proxy framework** -- `internal/proxy/` package with `NewReverseProxy` factory supporting K8s API, WebSocket, and model serving proxies
- **K8s pass-through resource handler** -- the K8s proxy at `/api/k8s/*` handles all HTTP methods

Additionally, significant route migration has already happened: dashboard config CRUD, cluster settings, components, status, connection types (full CRUD), Prometheus query proxy, NIM integration, model serving proxy, and namespace management are all implemented in the core BFF.

### Phases 3-5: Move the Routes

Fastify endpoints migrate in three waves of increasing complexity:

| Wave | What Moves | Route Groups | Examples |
|---|---|---|---|
| **Simple** | K8s passthroughs, service proxies, status endpoints | 11 groups | builds, docs, console-links, health |
| **Moderate** | Config, templates, RBAC, connection types | 12 groups | dashboardConfig, cluster-settings, Prometheus |
| **Complex** | Multi-step orchestration, feature stores | 9 groups | notebooks, servingRuntimes, ray-job-logs |

Each endpoint follows the same pattern: implement the Go handler, write contract tests, validate with the E2E suite, switch traffic, remove the Fastify route.

::: info Ahead of Schedule
Many items from the Simple and Moderate waves are already implemented in the core BFF, ahead of the formal migration plan. The K8s API proxy (`/api/k8s/*`, `/wss/k8s/*`), dashboard config, cluster settings, connection types, Prometheus queries, NIM integration, and model serving proxy are all live. The migration is progressing faster than the original wave plan.
:::

### Phases 6-8: The Hard Parts and Finish Line

The most complex pieces -- resource caching (~980 LOC, 9 watchers) and Module Federation proxy -- migrate last. These get prototype spikes before production implementation. Note that the WebSocket K8s watch proxy (~560 LOC across `ws_proxy.go` and `ws_tracker.go`) has already been implemented in Phase 0, ahead of the original plan.

Once everything is migrated, shared Go modules are extracted from the core BFF and module BFFs (auth, K8s client factory, response helpers). Finally, the `backend/` directory and all Node.js dependencies are removed.

::: info This Is a Plan, Not a Promise
The migration is dependency-ordered, not calendar-driven. Phases happen when they are ready, not on a fixed schedule. Some phases can overlap. The timeline depends on team capacity and competing priorities. What matters is the direction: from split-stack to unified Go.
:::

## What This Means for You

**Where we are now:** The core BFF exists at `distributions/core-bff/` and Fastify still runs at `backend/`. Both coexist. When adding new dashboard-level routes, check whether they should go in the core BFF (new Go code at `distributions/core-bff/bff/`) or Fastify (legacy, will be migrated later). When in doubt, ask the team.

**When Fastify is gone:** The `backend/` directory will no longer exist. All routes will be Go. The architecture diagram from [The Big Picture](./big-picture) will simplify: no more Fastify layer.

Regardless of timing, the key takeaway is this: **the Go patterns you are learning in this guide are the future of the entire dashboard backend, not just the module BFFs.** Every hour you spend understanding Go handlers, middleware, and testing is an investment that becomes more valuable as the migration progresses.

::: tip The Skills Transfer Directly
The core BFF follows the same conventions as the module BFFs you have been learning about: `cmd/main.go` entry point, `internal/api/app.go` with the App struct, `Routes()` function, middleware chain, `httprouter`, OpenAPI specs, and contract tests. If you can write a handler for the gen-ai BFF, you can write one for the core BFF.
:::

::: info See Also
- [The Big Picture](./big-picture) -- the current architecture, layer by layer
- [The App Struct & Routes](../deep-dive/app-and-routes) -- the pattern the core BFF follows
- [Middleware Chain](../deep-dive/middleware) -- the same middleware pipeline used everywhere
:::
