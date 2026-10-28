# Core BFF Architecture

> How the binary is put together: flags, bootstrap, the request pipeline, auth guards, the proxies and static serving. Paths are relative to `distributions/core-bff/bff/` in odh-dashboard unless stated otherwise.

Core BFF follows the same shape as every module BFF you met in [Part 3](/guide/deep-dive/entry-point) -- `cmd/main.go` builds a config, `internal/api` builds an `App`, `Routes()` returns an `http.Handler`. What makes it different is **what** it serves: it is a platform backend, so it also carries a Kubernetes API proxy, a WebSocket proxy, a module proxy and an SPA file server.

## File Layout

```
distributions/core-bff/
├── bff/                          ← the Go module
│   ├── cmd/main.go               ← flags, env, TLS, server lifecycle
│   ├── internal/
│   │   ├── api/                  ← App, routes_*.go, handlers, middleware, proxies
│   │   │   ├── routes.go         ← the handler tree (start here)
│   │   │   ├── routes_base.go    ← healthcheck, user, namespaces
│   │   │   ├── routes_config.go  ← config, components, status, cluster settings
│   │   │   ├── routes_connection_types.go
│   │   │   ├── routes_model_serving.go  ← serving runtimes, Prometheus, NIM, model-serving proxy
│   │   │   ├── routes_openapi.go ← /core-bff/openapi.{json,yaml}, Swagger UI
│   │   │   ├── middleware.go / middleware_auth.go
│   │   │   ├── module_proxy.go   ← proxies module APIs from federation-config
│   │   │   ├── security_headers.go / cache_headers.go
│   │   │   └── cluster_info.go   ← platform auto-detection
│   │   ├── repositories/         ← 15 repositories: one per domain (wired in repositories.go)
│   │   ├── integrations/
│   │   │   ├── kubernetes/       ← token client, shared (SA) client, k8mocks/ (envtest)
│   │   │   ├── bffclient/        ← inter-BFF client (copy of the shared pattern)
│   │   │   └── httpclient/
│   │   ├── proxy/                ← k8s_proxy.go, ws_proxy.go, ws_tracker.go
│   │   ├── ssrf/                 ← SSRF guard for proxied hosts
│   │   ├── k8sutil/  models/  config/  constants/  helpers/
│   └── openapi/src/core-bff.yaml ← the contract
├── contract-tests/__tests__/{foundation,openshift,xks}/
├── frontend/                     ← the shell used when Core BFF serves its own SPA
├── manifests/                    ← standalone (RHAII-style) manifests
├── Dockerfile                    ← upstream image
└── Dockerfile.workspace          ← Konflux image (FIPS, UBI9-minimal)
```

::: info Differences from a module BFF
- Extra packages: `repositories/`, `proxy/`, `ssrf/`, `k8sutil/`.
- Routes are split across `routes_*.go` files by domain instead of one big `routes()`.
- The guards are `secureRoute` / `secureAdminRoute`, not `RequireAccessToService`.
- The mocks directory is spelled `k8mocks/`.
- The only shared Go dependency is `pkg/tls` (via a `replace` directive in `go.mod`); everything else is self-contained.
:::

## Flags and Environment

Every flag has an env-var fallback except `--static-assets-dir`, `--cert-file` and `--key-file`. The ones that matter:

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--port` | `PORT` | `4000` | Listen port. **8943** in the RHOAI pod, **8443** in RHAII and the MaaS Portal |
| `--cert-file` / `--key-file` | -- | empty | When set, serve HTTPS using the cluster TLS profile (`pkg/tls`) |
| `--auth-method` | `AUTH_METHOD` | `user_token` | `user_token` or `disabled` |
| `--auth-token-header` | `AUTH_TOKEN_HEADER` | `x-forwarded-access-token` | Header the user token comes from |
| `--auth-token-prefix` | `AUTH_TOKEN_PREFIX` | none | Prefix to strip (set to empty in production) |
| `--deployment-mode` | `DEPLOYMENT_MODE` | `standalone` | `standalone` or `federated` |
| `--platform-type` | `ODH_PLATFORM_TYPE` | auto | `OpenShift`, `XKS`, or empty to auto-detect |
| `--namespace` | `NAMESPACE` → `OC_PROJECT` | `opendatahub` | The dashboard namespace |
| `--workbench-namespace` | `WORKBENCH_NAMESPACE` | = namespace | Second namespace allowed by `isAllowedNamespace` |
| `--dashboard-config-name` | `DASHBOARD_CONFIG_NAME` | `odh-dashboard-config` | The OdhDashboardConfig CR name |
| `--mf-remotes-config` | `MF_REMOTES_CONFIG` | empty | Path to the federation-config JSON; enables the module proxy |
| `--static-assets-dir` | -- (flag only) | `./static` | SPA root |
| `--bundle-paths` | `BUNDLE_PATHS` | the ODH CA bundles | CA bundles trusted for outbound TLS |
| `--prometheus-*` | `PROMETHEUS_*` | `thanos-querier` in `openshift-monitoring`, port `9092` | Prometheus target |
| `--model-serving-host` | `MODEL_SERVING_HOST` | empty | Target of the model-serving proxy |
| `--dev-mode`, `--mock-k8s-client`, `--mock-http-client`, `--mock-bff-clients` | `MOCK_BFF_CLIENTS` for the last | false | Local development |
| `--dev-user` / `--dev-groups` | `DEV_USER` / `DEV_GROUPS` | `developer` | Identity when auth is disabled |

::: warning Two documentation traps
- `--static-assets-dir` has **no** env fallback, even though some docs mention `STATIC_ASSETS_DIR`. The Makefile passes it as a flag.
- Core BFF supports only `user_token` and `disabled`. The "five auth strategies" sometimes attributed to it belong to **Fastify** (`backend/src/utils/userUtils.ts`).
:::

## Bootstrap: `NewApp`

`internal/api/app.go` builds the `App` once at startup:

1. **Kubernetes clients.** A factory that creates a **per-request client with the user's token**, plus a **service-account client** for the few reads that need it (for example the platform probe). With `--mock-k8s-client`, both point at an envtest API server seeded by `k8mocks/`.
2. **Platform detection.** If `--platform-type` is empty, `cluster_info.go` probes for the OpenShift `ClusterVersion` resource: present means `OpenShift`, absent means `XKS`. The result gates routes through `requirePlatform`.
3. **Repositories.** `repositories.NewRepositories(...)` wires the 15 domain repositories. A new repository is wired there, not in `app.go`.
4. **Proxies.** The Kubernetes proxy, the WebSocket proxy, the model-serving proxy (when a host is set) and the module proxies (when `--mf-remotes-config` is set).
5. **OpenAPI.** The embedded `core-bff.yaml` is served under `/core-bff/openapi.*`.

There is **no informer, no watch and no cache**. Each request becomes one or more API calls with the caller's token. That is a deliberate contrast with Fastify's `ResourceWatcher` (see [Fastify Today](/guide/core-bff/fastify-today)).

## The Handler Tree

`Routes()` in `routes.go` assembles three layers:

```go
func (app *App) Routes() http.Handler {
    serviceMux := app.newServiceMux()     // API router + proxies (authenticated)
    staticHandler := app.newStaticHandler() // SPA with index.html fallback
    return app.SetSecurityHeaders(app.newCombinedMux(serviceMux, staticHandler))
}
```

```
SetSecurityHeaders                            ← every response
└── combinedMux
    ├── /healthcheck                 publicRoute
    ├── GET /api/integrations/nim, /api/nim-serving/*   publicRoute (OpenShift only)
    ├── /core-bff/openapi.*, /core-bff/swagger-ui       publicRoute
    ├── /                            publicRoute(staticHandler)   ← SPA
    └── /api/*, /core-bff/*, /wss/k8s/*, /<module>/*
        └── RecoverPanic → EnableTelemetry → EnableCORS → InjectRequestIdentity
            └── serviceMux
                ├── /api/*               httprouter (apiRouter)
                ├── /core-bff/api/*      StripPrefix("/core-bff") → same apiRouter
                ├── /api/k8s/*           Kubernetes proxy (+ /core-bff prefix)
                ├── /wss/k8s/*           WebSocket proxy  (+ /core-bff prefix)
                ├── /api/service/model-serving/*   model-serving proxy
                └── /<module>/api/*      module proxies (from federation-config)
```

Three details worth knowing:

- **Every route exists twice:** `/api/...` and `/core-bff/api/...`. The second exists because, in RHOAI, Fastify forwards `/core-bff/api/*` with a path rewrite, and other callers may use either form.
- **Secure by default.** Anything under `/api`, `/core-bff` or a module prefix goes through `InjectRequestIdentity`. Only paths explicitly wrapped in `publicRoute` skip it.
- **Bare prefixes return 404.** `/api`, `/core-bff` and each bare module path get an explicit not-found handler so `ServeMux` does not issue 307 redirects to the subtree.

## Auth: Identity, Then Guards

Auth happens in two steps.

**1. `InjectRequestIdentity`** (`middleware_auth.go`) reads the token from `--auth-token-header` (default `x-forwarded-access-token`), strips `--auth-token-prefix`, and stores a `RequestIdentity` in the context. With `--auth-method=disabled` it uses `--dev-user` / `--dev-groups` instead. It does not validate the token: it only extracts it.

**2. Route guards** decide what the identity may do:

| Guard | What it checks | Fails with |
|---|---|---|
| `secureRoute` | Gets a client with the user's token and calls `GetUser` -- a **SelfSubjectReview** -- so an invalid or expired token is rejected. Emits an audit log line | 401 |
| `secureAdminRoute` | Everything `secureRoute` does, then `IsUserAdmin`: a **SelfSubjectAccessReview** for `patch` on `auths/default-auth` (the dashboard admin check) | 401 / 403 |
| `requirePlatform(p, h)` | The detected platform equals `p` (for example OpenShift-only routes) | 404 |
| `requirePlatformPublic` | Same, for public routes on the outer mux | 404 |
| `isAllowedNamespace(ns)` | Called inside handlers: `ns` is the dashboard namespace or the workbench namespace | 403 |

```go
r.GET(ConfigPath, app.secureRoute(app.GetConfigHandler))
r.PATCH(ConfigPath, app.secureAdminRoute(app.PatchConfigHandler))
r.GET(OperatorSubscriptionStatusPath,
    app.requirePlatform(config.PlatformOpenShift, app.secureRoute(app.GetOperatorSubscriptionStatusHandler)))
```

::: warning Routes without a guard
A few registrations skip `secureRoute`:
- the five `POST /api/prometheus/*` routes use only `requirePlatform` (they still pass through `InjectRequestIdentity`, so a token must be present, but it is not validated by a SelfSubjectReview);
- `GET /api/integrations/nim` and `GET /api/nim-serving/:nimResource` are mounted as **public** routes.

Both mirror Fastify's behaviour today. Revisit them during the route audit ([RHOAIENG-83694](https://redhat.atlassian.net/browse/RHOAIENG-83694)).
:::

## The API Surface

| Group | Routes | Guard |
|---|---|---|
| Base | `GET /healthcheck`, `GET /api/v1/healthcheck`, `GET /api/v1/user`, `GET /api/v1/namespaces` | public / secure |
| Config | `GET/PATCH /api/config`, `GET /api/components`, `GET /api/components/remove`, `GET /api/status`, `GET /api/status/:namespace/allowedUsers` (OpenShift) | secure / admin |
| Dashboard config | `GET/PATCH /api/dashboardConfig/:namespace/:name` | admin |
| Cluster settings | `GET/PUT /api/cluster-settings` | admin |
| Operator | `GET /api/operator-subscription-status` (OpenShift) | secure |
| Connection types | `GET /api/connection-types[/:name]`; `POST/PUT/PATCH/DELETE` | secure / admin |
| Connection test | `POST /api/v1/connections/test` | secure |
| Serving runtimes | `POST /api/servingRuntimes` | admin |
| Namespaces | `GET /api/namespaces/:name/:context` | secure |
| Prometheus | `POST /api/prometheus/{query,queryRange,pvc,bias,serving}` (OpenShift) | platform only |
| NIM | `GET /api/integrations/nim`, `GET /api/nim-serving/:nimResource` (public); `POST/DELETE /api/integrations/nim` (admin) | mixed |
| OpenAPI | `/core-bff/openapi.json`, `.yaml`, `/core-bff/swagger-ui` | public |

Notice the mixed naming: `/api/v1/...` for routes born in Core BFF, and Fastify's original paths (`/api/config`, `/api/servingRuntimes`) for routes ported from Node. Keeping the Fastify paths lets the frontend switch backends without changing its calls.

## The Proxies

### Kubernetes proxy -- `/api/k8s/*`

`internal/proxy/k8s_proxy.go` forwards any request under `/api/k8s/` to the Kubernetes API server, **with the user's token**. This is what `k8sGetResource`, `k8sListResource` and friends in the frontend talk to, and it is the escape hatch that makes many thin Fastify routes unnecessary: if a route only reads or writes a resource the user can already access, the frontend can call the API through this proxy.

### WebSocket proxy -- `/wss/k8s/*`

`ws_proxy.go` upgrades the connection and pipes watch streams from the API server, with a 15-second heartbeat. `ws_tracker.go` tracks open connections so they close cleanly on shutdown.

### Model-serving proxy -- `/api/service/model-serving/*`

Forwards inference and serving calls to `--model-serving-host`. The target goes through the SSRF guard in `internal/ssrf` before any request is made.

### Module proxy -- `/<module>/api/*`

`module_proxy.go` ([RHOAIENG-85775](https://redhat.atlassian.net/browse/RHOAIENG-85775), #9444) reads the federation-config JSON from `--mf-remotes-config` -- the same structure the operator generates (`dashboard-operator/internal/controller/module_deploy.go`) -- and registers a reverse proxy for every module entry:

1. Parse the file (maximum 1 MiB) and skip the `coreBff` entry (it points at itself).
2. Reject duplicate paths, validate each service name and namespace as RFC 1123 labels, and refuse any path that overlaps a route Core BFF already owns (`reservedBFFPrefixes`: `/api/`, `/api/k8s/`, `/wss/k8s/`, the model-serving prefix, `/healthcheck`, the OpenAPI paths and `/core-bff/`).
3. Build the in-cluster target `https://<svc>.<ns>.svc.cluster.local:<port>`, run it through the SSRF guard, and apply `pathRewrite`.
4. Strip the inbound auth headers (so a client cannot spoof them) and, when the entry has `authorize: true`, re-inject the validated user token twice: as `Authorization: Bearer …` and in the ingress header, `x-forwarded-access-token`, which is what mod-arch BFFs read (the second header was added in [RHOAIENG-93083](https://redhat.atlassian.net/browse/RHOAIENG-93083), #9667). Responses are checked for SSRF redirects and forced to `no-store`, matching Fastify.

::: danger What the module proxy does not do
It proxies **API paths only**. Core BFF has **no `/_mf/<module>/*` proxy** for remote entry bundles, and it does **not inject `mfRemotesJson`** into `index.html`. In Fastify, both happen: `backend/src/routes/root.ts` renders `index.html` with EJS and injects the remotes, and Fastify proxies `/_mf/*` to each module Service. That gap is why the main dashboard cannot run on Core BFF yet -- see [Replacing Fastify](/guide/core-bff/replacing-fastify).
:::

## Static Serving and the SPA

`newStaticHandler()` serves `--static-assets-dir`:

- If the file exists, it is served with `getCacheControlForStaticFile` (`cache_headers.go`): long-lived for hashed bundles, short or `no-cache` for the rest. `/` itself is `no-store`.
- If it does not exist, `index.html` is served with `no-store` -- the SPA fallback, so client-side routes work on reload.

These rules intentionally mirror Fastify (`setNoStoreCacheHeaders`), so swapping backends does not change caching behaviour.

`SetSecurityHeaders` (`security_headers.go`) wraps the whole tree and sets the standard browser security headers on every response.

## TLS

With `--cert-file` and `--key-file`, `cmd/main.go` builds the server TLS config from the **cluster TLS profile** via the shared `pkg/tls` module (`tlsprofile.ServerTLSConfig`) and serves with `ListenAndServeTLS`. In RHOAI the certificate comes from the `proxy-tls` secret (an OpenShift service-serving certificate) mounted at `/etc/tls/private`. Outbound calls trust the CA bundles in `--bundle-paths` (by default the `odh-trusted-ca-bundle` and `odh-ca-bundle` mounts).

## Images

| File | Used by | Base | Notes |
|---|---|---|---|
| `distributions/core-bff/Dockerfile` | Upstream / local | distroless static | Builds `frontend/` and the Go binary |
| `distributions/core-bff/Dockerfile.workspace` | Konflux (RHOAI) | UBI9-minimal, FIPS build | Builds from the workspace and also bundles the MaaS Portal static assets |

On RHOAI the image is referenced as `RELATED_IMAGE_ODH_CORE_BFF_IMAGE` (`dashboard-operator/internal/controller/support.go`).

## Contract-First Workflow

The contract lives in `openapi/src/core-bff.yaml`. A change goes in this order:

1. Edit the OpenAPI spec.
2. Implement the handler and repository; add Go tests (envtest via `k8mocks/`).
3. Add or update the contract test under `contract-tests/__tests__/` -- `foundation/` for both platforms, `openshift/` or `xks/` for platform-only behaviour.
4. Run both platform variants.

## Running It Locally

From `distributions/core-bff/bff/`:

```bash
# Mocked cluster (envtest) -- no cluster needed
make run PORT=4000 MOCK_K8S_CLIENT=true

make test        # unit tests with envtest
make lint
```

From `distributions/core-bff/`:

```bash
make dev-bff                 # mock mode: MOCK_K8S_CLIENT, MOCK_HTTP_CLIENT, DEV_MODE, AUTH_METHOD=disabled, port 4000

pnpm run test:contract       # runs both variants:
pnpm run test:contract:openshift
pnpm run test:contract:xks   # BFF_MOCK_FLAGS='--mock-k8s-client --mock-http-client --auth-method=user_token --platform-type=…'
```

Against a real cluster, with the Cypress static build:

```bash
STATIC_ASSETS_DIR=../frontend/public-cypress make dev-bff-e2e-cluster
```

::: tip Key Takeaway
Core BFF is a standard BFF with three extra jobs: proxying the Kubernetes API (HTTP and WebSocket), proxying module APIs from the operator's federation-config, and serving the SPA. Identity comes only from `x-forwarded-access-token`; `secureRoute` validates it with a SelfSubjectReview and `secureAdminRoute` adds the admin SelfSubjectAccessReview. Nothing is cached.
:::
