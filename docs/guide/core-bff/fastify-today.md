# Fastify Today

> Everything the Node.js backend does in the RHOAI dashboard pod, route by route -- and how much of it Core BFF already covers. This is the inventory the route audit ([RHOAIENG-83701](https://redhat.atlassian.net/browse/RHOAIENG-83701)) starts from.

The Fastify server lives in `backend/` (TypeScript, Fastify, `@kubernetes/client-node`). It started as the whole dashboard backend, long before module BFFs and the dashboard operator existed, and it still does five different jobs:

1. **Serves the SPA** and renders `index.html`.
2. **Hosts Module Federation**: proxies `/_mf/<module>/*` and module APIs.
3. **Runs ~35 API route groups** under `/api/*`.
4. **Caches cluster state** with `ResourceWatcher`s.
5. **Runs side jobs** at startup.

Core BFF has to absorb the jobs that should survive and the rest has to be deleted on purpose. Nothing should disappear by accident.

## 1. Serving the SPA -- `backend/src/routes/root.ts`

Fastify serves `frontend/public` and renders `index.html` through **EJS**, injecting the module remotes as a `<script id="mf-remotes-json">` tag built from the federation config. The frontend reads that tag at boot to know which remotes to load.

Core BFF serves static files and the SPA fallback with the same cache policy, **but has no template step**. This is the first piece of the MF gap.

## 2. Module Federation Hosting -- `backend/src/routes/module-federation.ts`

For every entry in the federation config (the operator's `federation-config` ConfigMap, read as `MODULE_FEDERATION_CONFIG`; the `package.json` `module-federation` blocks are only the dev fallback), Fastify registers:

- `/_mf/<name>/*` → the module Service (the remote entry and its chunks);
- each `proxyService` path (for example `/gen-ai/api/*`, `/core-bff/api/*`) → the module BFF, with `Authorization: Bearer <token>` when the entry has `authorize: true`.

Core BFF already does the second (`module_proxy.go`) but **not the first**.

## 3. The API Routes

Grouped by what happens to them in the plan. "In Core BFF" means an equivalent route already exists in `distributions/core-bff/bff`.

### Already in Core BFF

| Fastify group | Core BFF equivalent | Notes |
|---|---|---|
| `status`, `status/:ns/allowedUsers` | `GET /api/status`, `/api/status/:namespace/allowedUsers` | allowedUsers is OpenShift only |
| `config` | `GET/PATCH /api/config` | GET is cache-dependent in Fastify |
| `dashboardConfig` | `GET/PATCH /api/dashboardConfig/:ns/:name` | Marked for deprecation anyway (direct CR access) |
| `cluster-settings` | `GET/PUT /api/cluster-settings` | Real business logic -- stays |
| `components` | `GET /api/components`, `/api/components/remove` | Cache-dependent in Fastify |
| `connection-types` | full CRUD | Stays |
| `servingRuntimes` | `POST /api/servingRuntimes` | Marked for deprecation |
| `namespaces` | `GET /api/v1/namespaces`, `/api/namespaces/:name/:context` | Stays |
| `integrations/nim`, `nim-serving` | `/api/integrations/nim`, `/api/nim-serving/:nimResource` | OpenShift only; GETs are public |
| `operator-subscription-status` | `GET /api/operator-subscription-status` | OpenShift only |
| `prometheus` (query, queryRange, pvc, bias, serving) | `POST /api/prometheus/*` | **`prometheus/cluster` is missing** |
| `k8s` | `/api/k8s/*` | The pass-through proxy |
| `wss/k8s` | `/wss/k8s/*` | WebSocket watches |
| `service/model-serving` | `/api/service/model-serving/*` | With the SSRF guard |

### Not in Core BFF -- to deprecate (the frontend calls Kubernetes directly)

The route audit's position: thin CRUD wrappers do not move to Go. The frontend calls the API through `/api/k8s/*`, and where the route used the **service-account** token, the operator provisions a RoleBinding so the user can make the call with their own token.

| Route | Approx. LOC | Why it goes |
|---|---|---|
| `dashboardConfig` | 72 | Direct CR get/patch |
| `templates` | 168 | Direct Template CRUD |
| `servingRuntimes` | 40 | A single POST |
| `rolebindings` | 82 | Plain RBAC CRUD |
| `envs` | 46 | Read Secrets/ConfigMaps directly |
| `route` | 17 | Read an OpenShift Route |
| `modelRegistryRoleBindings` | 134 | Plain CRUD |
| `modelRegistryCertificates` | 87 | List certificates |
| `dsci/status` | 6 | One CR read |

(`dashboardConfig` and `servingRuntimes` already have Go equivalents; the plan is still to deprecate them rather than keep two paths.)

### Not in Core BFF -- to port (genuine business logic)

| Route | Approx. LOC | Why it stays server-side |
|---|---|---|
| `notebooks` | 173 + ~800 utils | Full workbench lifecycle: PVC, RBAC, env, start/stop |
| `modelRegistries` | 608 | CR + Secret created together, cross-referenced |
| `featurestores` | 1,133 | Multi-resource CRUD with workbench integration |
| `validate-isv` | 374 | Creates and watches a Job |
| `ray-job-logs` | 174 | Pod exec for log streaming |

Already ported from the same list: `cluster-settings`, `namespaces`, `connection-types`, `integrations/nim`.

### Not in Core BFF -- decided by the data-access spike

These routes read from a `ResourceWatcher` cache today, so their future depends on the measurements in [RHOAIENG-83698](https://redhat.atlassian.net/browse/RHOAIENG-83698): direct fetch per request, frontend fetch via `/api/k8s/` with React Query, or (only with evidence) an informer.

`builds`, `components`, `config` (GET), `console-links`, `docs`, `dsc/status`, `operator-subscription-status`, `quickstarts`, `aihub`.

### Not in Core BFF -- not in the plan yet

The initiatives do not name these yet. Each needs an explicit decision in the audit document:

| Route | What it does | Likely answer |
|---|---|---|
| `service/pipelines`, `service/mlmd`, `service/trustyai` | Service proxies that resolve the target URL from a CR's status and gate access | Keep as proxies (per 83704); evaluate moving gating to operator status |
| `service/modelregistry` | Model Registry service proxy | Probably dead since Model Registry has its own BFF -- confirm and delete |
| `prometheus/cluster` | Cluster-wide Prometheus query | Port with the other Prometheus routes, behind an admin guard |
| `segment-key` | Analytics key for the frontend | Small; port or serve via config |
| `dev-impersonate` | Dev-only user impersonation | Replace with Core BFF dev flags (`--dev-user`, `--dev-groups`) |
| `health` | Fastify's own probe (`/api/health`) | Disappears with Fastify; Core BFF uses `/healthcheck` |
| `/_mf/*` and `index.html` | MF hosting | [RHOAIENG-83703](https://redhat.atlassian.net/browse/RHOAIENG-83703) |

::: info Counting
Roughly 17 Fastify groups have a Core BFF equivalent and about 22 do not. Of those 22, the plan already decides 9 (deprecate) + 5 (port) + 9 (spike). The remaining ones in the last table are the audit's homework.
:::

## 4. The Cache -- `ResourceWatcher`

`backend/src/utils/resourceUtils.ts` starts ten watchers at boot (`initializeWatchedResources`, called from `plugins/kube.ts`):

| Watcher | Resource |
|---|---|
| `dashboardConfigWatcher` | OdhDashboardConfig |
| `authWatcher` | Auth CR (`services.platform.opendatahub.io/auths`) |
| `aihubWatcher` | AIHub |
| `clusterStatusWatcher` | DataScienceCluster status |
| `subscriptionWatcher` | OLM Subscriptions |
| `appWatcher` | OdhApplications |
| `docWatcher` | OdhDocuments |
| `quickStartWatcher` | QuickStarts |
| `buildsWatcher` | Builds / BuildConfigs (custom refresh time) |
| `consoleLinksWatcher` | ConsoleLinks |

Each one **polls** (every 2 minutes while there is activity, every 30 minutes otherwise -- `resourceWatcher.ts`) with the **service-account token** and serves the cached result to every user. The initiative lists what is wrong with that:

- users can see data their own RBAC would not allow;
- data is up to two minutes stale (30 when idle);
- fetch errors are swallowed (`.catch(() => {})`), so failures are invisible;
- there is no per-user view;
- timer callbacks race with request handlers.

The plan's categories:

| Category | Resources | Default decision |
|---|---|---|
| A. Global config | DashboardConfig, Auth CR, DSC status | Direct fetch per request; an informer only if measured latency demands it (likely candidate: the Auth CR, read on every request) |
| B. Content | Applications, Documents, QuickStarts, ConsoleLinks | Direct fetch, or frontend fetch via `/api/k8s/` with React Query |
| C. Build status | Builds | Frontend WebSocket watch -- or deprecate if workbenches stop using BuildConfig |
| D. Subscriptions | OLM Subscriptions | Direct fetch, no cache |

## 5. Side Behaviours

Easy to miss because they are not routes:

| Behaviour | Where | What to decide |
|---|---|---|
| `cleanupKserveRoleBindings` | `resourceUtils.ts`, run once at startup from `plugins/kube.ts` | A one-off migration job. Move it to the operator or drop it once no supported upgrade path needs it |
| `requestSecurityGuard` | `utils/route-security.ts` | Namespace check (dashboard or workbench namespace), admin check, and notebook ownership (`jupyter-nb-<translated username>`). Ported as `secureNamespacedRoute` in [RHOAIENG-83697](https://redhat.atlassian.net/browse/RHOAIENG-83697) |
| `usernameTranslate` | `utils/userUtils.ts` | The encoding behind notebook names. The Go version must produce **byte-identical** results |
| The 5-strategy `getUserInfo` | `utils/userUtils.ts` | kube-rbac-proxy header → OpenShift User API → SelfSubjectReview → JWT parsing → dev SA. Only the first and last survive ([RHOAIENG-83696](https://redhat.atlassian.net/browse/RHOAIENG-83696)) |
| Admin check | `utils/adminUtils.ts` | SSAR `patch` on `auths/default-auth` -- the same check Core BFF's `IsUserAdmin` does |
| Cache headers | `utils/cacheHeaders.ts` (and `setNoStoreCacheHeaders`) | Already mirrored in `cache_headers.go`; verified again in [RHOAIENG-83706](https://redhat.atlassian.net/browse/RHOAIENG-83706) |

::: tip Key Takeaway
Fastify does five jobs. Core BFF already covers the platform APIs that matter most and the Kubernetes proxies; it is missing MF hosting (`/_mf/*` and `index.html`), about five business-logic routes, and a decision for every cached or unlisted route. Most Fastify routes should not be ported at all -- they become direct Kubernetes calls.
:::
