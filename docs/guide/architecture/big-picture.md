# The Big Picture

> The complete architecture of ODH Dashboard, from the browser on your laptop to the Kubernetes API in the cluster -- every layer, every connection, every proxy hop.

## Building the Architecture Layer by Layer

Instead of throwing the full architecture diagram at you all at once, let us build it piece by piece. Each step adds one layer, so you understand why it exists before we move on.

### Step 1: The Simplest World -- Browser Talks to BFF

In the simplest possible world, your React app would talk directly to the Go BFF:

```
+-----------------------------+
|        YOUR BROWSER         |     <- you are here, writing React components
|   React App (PatternFly)    |
+-------------+---------------+
              |
        fetch('/api/v1/models')     <- a simple HTTP request from your React code
              |
              v
+-----------------------------+
|         BFF (Go)            |     <- the Go service that handles business logic
|   - Has K8s credentials    |
|   - Calls upstream services |
|   - Returns clean JSON      |
+-----------------------------+
```

**What just happened?** This is the core relationship. Your React code calls a URL, and the BFF responds with JSON. If the world were simple, we could stop here. But it is not, and here is why.

### Step 2: Adding Authentication -- The Backend Layer

The BFF does not handle user login. When a user visits the dashboard, the cluster Gateway and a `kube-rbac-proxy` container in the dashboard pod authenticate them and check they may use the dashboard. The request then reaches the Fastify backend carrying the user's token in an `x-forwarded-access-token` header, and Fastify forwards that token to the right BFF.

The Fastify backend also serves the dashboard configuration, proxies Kubernetes API requests for packages that do not have BFFs, and injects Module Federation config into the HTML page. It is the central nervous system of the dashboard.

```
+-----------------------------+
|        YOUR BROWSER         |
|   React App (PatternFly)    |
+-------------+---------------+
              |
        fetch('/gen-ai/api/v1/models')  <- browser sends request to same origin
              |
              v
+-----------------------------+
|    BACKEND (Fastify/Node)   |     <- proxies to the right BFF
|   Port :8080                |     <- behind kube-rbac-proxy, which already
|   - Rewrites /gen-ai/api    |        authenticated the user
|     to /api                 |     <- strips the package prefix from the path
|   - Forwards to BFF service |     <- sends the request to the Go BFF
|   - Sets Authorization:     |     <- forwards the user's token to the BFF
|     Bearer <user token>     |
+-------------+---------------+
              |
        GET /api/v1/models          <- path rewritten, auth headers added
              |
              v
+-----------------------------+
|         BFF (Go)            |
|   Port :8143 (gen-ai)      |     <- each BFF has its own Service and port
+-----------------------------+
```

The proxy layer is the key addition here. The browser never talks to the BFF directly. Instead, it sends requests to the dashboard (same origin as the page); kube-rbac-proxy authenticates the user, and the Fastify backend rewrites the URL path and forwards the request, with the user's token, to the BFF. This is how authentication flows from the browser to the BFF without the browser knowing anything about Go servers or Kubernetes tokens.

::: info Why Not Just Put Auth in the BFF?
Authentication happens once, in front of the whole dashboard -- not just BFF requests but also direct Kubernetes API proxying (`/api/k8s/*`), dashboard config (`/api/config`), and Module Federation assets. Centralizing it means every service benefits from the same checks. The BFF still does its own authorization: it uses the forwarded token to run access reviews against Kubernetes.
:::

### Step 3: Adding the Dev Server -- Hot Reloading in Development

In development, there is one more layer: the rspack dev server. It serves your JavaScript bundles, handles hot module replacement (change a React component, see it update without a page refresh), and proxies API requests to the backend so you do not have to deal with CORS during development.

```
+-----------------------------+
|        YOUR BROWSER         |
|   React App (PatternFly)    |
+-------------+---------------+
              |
        fetch('/gen-ai/api/v1/models')  <- browser sends request to localhost:4010
              |
              v
+-----------------------------+
|   FRONTEND DEV SERVER       |     <- only exists during local development
|   rspack :4010              |
|   - Serves JS/CSS/HTML      |     <- compiles TypeScript to JavaScript on the fly
|   - Hot module replacement  |     <- change code, see updates instantly
|   - Proxies /api/* to :4000 |     <- forwards API requests to the backend
+-------------+---------------+
              |
        proxy pass to :4000         <- dev server is a transparent proxy for API calls
              |
              v
+-----------------------------+
|    BACKEND (Fastify/Node)   |
|   Port :4000 (dev)          |
+-------------+---------------+
              |
              v
+-----------------------------+
|         BFF (Go)            |
+-----------------------------+
```

This is the development-only layer. When you run `pnpm dev` (or `pnpm start:dev`) from the repo root, the rspack dev server starts on port 4010 and the Fastify backend on port 4000 (`FRONTEND_PORT` and `BACKEND_PORT` in `.env.development`). Your browser talks to `:4010`, which serves the React app and proxies API requests to the Fastify backend on `:4000`. This is why you see `localhost:4010` in your browser's address bar during development.

::: info Development Only
This layer disappears in production. In production, the Fastify backend (or a static file server) serves the pre-built JavaScript bundles directly. There is no rspack dev server, no hot reloading, no dev proxy.
:::

::: info npm and webpack in older material
The repo moved from npm to **pnpm** (workspaces, `pnpm-lock.yaml`) and from webpack to **rspack** (with `@module-federation/enhanced` for Module Federation). Older docs, READMEs and blog posts still say `npm run ...` and `webpack.*.js`; read them as `pnpm run ...` and `rspack.*.js`. A few vendored subtrees, such as model-registry's `upstream/`, still call `npm` inside their own Makefiles.
:::

### Step 4: Adding External Services -- The Data Layer

The BFF does not work alone. It talks to Kubernetes and external services to get the actual data:

```
+-----------------------------+
|        YOUR BROWSER         |
+-------------+---------------+
              |
              v
+-----------------------------+
|   FRONTEND DEV SERVER :4010 |     <- dev only
+-------------+---------------+
              |
              v
+-----------------------------+
|    BACKEND (Fastify) :8080  |     <- :4000 in dev
+-------------+---------------+
              |
              v
+-----------------------------+
|         BFF (Go)            |
+-------------+---------------+
              |
    +---------+---------+
    |         |         |
    v         v         v
+-------+ +-------+ +-------+
| K8s   | | Llama | | Other |      <- the actual data sources
| API   | | Stack | | Svcs  |
+-------+ +-------+ +-------+
```

This is the data layer -- the bottom of the stack. The BFF uses Go's `client-go` library for Kubernetes operations (listing CRDs, running SubjectAccessReviews) and standard HTTP clients for external services like LlamaStack, MLflow, and S3. Some of these services (like the Kubernetes API) are strictly internal to the cluster, while others (like MLflow) may be exposed through a gateway. Either way, the BFF provides a unified API surface, handles auth injection, and keeps orchestration logic out of React components.

<div class="checkpoint">

#### Checkpoint

You have now seen all four layers built up one at a time:
1. **Browser** -- your React app, making simple fetch calls
2. **Dev Server** -- rspack, serving bundles and proxying API requests (dev only)
3. **Backend** -- Fastify, behind kube-rbac-proxy, routing requests to BFFs
4. **BFF** -- Go, handling business logic and calling Kubernetes/services

</div>

## The Complete Architecture Diagram

Now that you understand each layer, here is the full picture with all the details:

```
+------------------------------------------------------------------+
|                        YOUR BROWSER                               |
|   React App (PatternFly v6 UI)                                    |
|   - Main dashboard (host)                                         |
|   - Federated modules loaded via Module Federation                |
|     (gen-ai, model-registry, maas, mlflow, automl, autorag,       |
|      agent-ops, eval-hub, notebooks, data-registry, ...)          |
+-----------------------------------+------------------------------+
                                    |
                              fetch('/gen-ai/api/v1/models')
                                    |
                                    v
+------------------------------------------------------------------+
|              FRONTEND DEV SERVER  (dev only)                      |
|   rspack dev server (:4010)                                       |
|   - Serves JS/CSS/HTML bundles                                    |
|   - Hot module replacement                                        |
|   - Proxies /api/* to Backend                                     |
|   - Proxies /_mf/* to Backend                                     |
+-----------------------------------+------------------------------+
                                    |
                 proxy pass (dev) / Gateway + kube-rbac-proxy (prod)
                                    |
                                    v
+------------------------------------------------------------------+
|                    BACKEND  (Fastify / Node.js)                   |
|   (:8080; BACKEND_PORT=4000 in dev)                               |
|   - Receives the authenticated user's token from kube-rbac-proxy |
|   - Serves dashboard config (/api/config)                         |
|   - Proxies K8s API requests (/api/k8s/*)                        |
|   - Proxies BFF API requests (/{name}/api/* -> BFF service)       |
|   - Forwards /core-bff/api/* to core-bff (:8943, same pod)        |
|   - Injects Module Federation remotes config into HTML            |
+-----------------------------------+------------------------------+
                                    |
         /gen-ai/api/* -> odh-dashboard-gen-ai-ui:8143 (TLS)
                                    |
                                    v
+------------------------------------------------------------------+
|                       BFF  (Go)                                   |
|   (own Deployment + Service, package-specific port)               |
|   - Package-specific business logic                               |
|   - Extracts user identity from forwarded headers                 |
|   - RBAC checks (SubjectAccessReview / SelfSubjectAccessReview)   |
|   - Calls upstream services with proper auth                      |
|   - Shapes responses for the frontend                             |
+-----------------------------------+------------------------------+
                                    |
                       K8s client / HTTP calls
                                    |
                                    v
+------------------------------------------------------------------+
|              KUBERNETES API / EXTERNAL SERVICES                   |
|   - Kubernetes API Server (CRDs, Pods, Services, etc.)            |
|   - LlamaStack (AI model serving)                                 |
|   - MLflow (experiment tracking)                                  |
|   - Model Registry (kubeflow model catalog)                       |
|   - S3 (object storage)                                           |
|   - Other services                                                |
+------------------------------------------------------------------+
```

## Each Layer in Detail

### Layer 1: The Browser (React App)

This is your world. The main dashboard is a React 18 application using PatternFly v6 for the UI, built with rspack and `@module-federation/enhanced`. It runs in the browser and is the **host** in a Module Federation setup.

At startup, the host app discovers available remote packages (gen-ai, model-registry, maas, mlflow, automl, autorag, eval-hub, notebooks, data-registry, etc.) and dynamically loads their JavaScript bundles. Each remote package contributes **extensions** -- navigation items, routes, pages, and status providers -- that plug into the host's shell.

From the browser's perspective, everything is a `fetch()` call to a relative URL:

```typescript
// From a gen-ai React component                                     
const response = await fetch('/gen-ai/api/v1/lsd/models?namespace=my-project'); // call the gen-ai BFF

// From a model-registry React component
const response = await fetch('/model-registry/api/v1/model_registry?namespace=default'); // call the model-registry BFF
```

The browser has no idea these requests will pass through multiple proxies before reaching the actual service. It just calls a path and gets JSON back.

::: tip Relative URLs Are Key
Using relative URLs like `/gen-ai/api/...` instead of absolute URLs like `http://localhost:8080/api/...` means the same React code works in development, production, and testing without configuration changes. The browser always sends the request to the same origin that served the page.
:::

### Layer 2: Frontend Dev Server (Development Only)

::: info Development Only
This layer only exists when you run `pnpm dev`. In production, a static file server or the backend itself serves the built JavaScript bundles.
:::

The rspack dev server runs on port **4010** (for the main dashboard, set via `FRONTEND_PORT` in `.env.development`) and provides:

- **Hot module replacement** -- change a React component, see it update without a page refresh
- **JavaScript/CSS bundle serving** -- compiles TypeScript to JavaScript on the fly
- **Proxy** -- forwards API requests to the backend (`:4000`) so you do not have to deal with CORS during development

The dev server's proxy configuration (`frontend/config/rspack.dev.js`) forwards:
- `/api/*` requests to the Fastify backend (for dashboard config, K8s API proxy, etc.)
- `/_mf/*` requests to the Fastify backend (for Module Federation static assets like `remoteEntry.js`)
- `/{package-name}/api/*` requests to the Fastify backend (which then proxies to individual BFFs)

Each federated package also runs its own dev server on a unique port for standalone development and testing. More on those ports in the [port reference table](#development-port-reference) below.

### Layer 3: Backend (Fastify / Node.js)

The Fastify backend is the central nervous system of the dashboard. It serves multiple critical roles:

**Authentication -- done in front of it.** In the cluster, Fastify listens on `:8080`, but the Service only exposes `:8443`: the only way in is through the `kube-rbac-proxy` container in the same pod, which forwards to Fastify over loopback (`--upstream=http://localhost:8080`). kube-rbac-proxy authenticates the user against the cluster, checks access, and passes the request on with the user's token in `x-forwarded-access-token`. Fastify reads that token when it needs to act as the user -- for the K8s proxy, and when forwarding to a BFF whose federation entry has `authorize: true` (it then sets `Authorization: Bearer <token>`, `backend/src/utils/proxy.ts`).

**Dashboard configuration.** The `/api/config` endpoint serves the `OdhDashboardConfig` that controls feature flags, notification banners, and dashboard behavior. This is how the frontend knows which features are enabled.

**Kubernetes API proxy.** Requests to `/api/k8s/*` are proxied directly to the Kubernetes API server using the user's token. This is how the frontend creates projects, lists notebooks, and manages resources without a BFF.

**BFF proxy.** This is the critical connection for our purposes. The backend registers one proxy route per `proxyService` entry in the federation config -- in the cluster, the operator-generated `federation-config` ConfigMap; in local dev, each package's `module-federation` block in `package.json` (see [The Federation Config, End to End](#the-federation-config-end-to-end)). When a request arrives at the package's proxy path (e.g., `/gen-ai/api/*`), the backend rewrites the path and forwards to the BFF service:

```
Browser request:     GET /gen-ai/api/v1/models?namespace=X       <- what the browser sends
Backend strips:      /gen-ai/api -> /api (per pathRewrite config) <- path prefix removed
Backend forwards to: GET https://odh-dashboard-gen-ai-ui.<ns>.svc.cluster.local:8143/api/v1/models?namespace=X
                     (with Authorization: Bearer <user token>)    <- identity travels with the request
```

**Module Federation config injection.** When the HTML page is first loaded, the backend injects a `<script>` tag containing the list of available remote modules and their entry points. This is how the host app knows which remote bundles to load.

::: warning Path Confusion
The path the browser sees (`/gen-ai/api/v1/models`) is different from the path the BFF receives (`/api/v1/models`). The `pathRewrite` in the proxy config strips the package prefix. When you are writing BFF route handlers, register paths starting with `/api/...`, not `/gen-ai/api/...`. This catches many newcomers.
:::

**Key files for this layer:**

| File | Purpose |
|---|---|
| `backend/src/routes/module-federation.ts` | Registers the `/_mf/<name>` and BFF proxy routes from the federation config |
| `backend/src/utils/proxy.ts` | `registerProxy`: builds the upstream URL and sets `Authorization` when `authorize` is true |
| `backend/src/routes/root.ts` | Injects the Module Federation remotes into `index.html` |
| `packages/app-config/src/module-federation.ts` | `getModuleFederationConfigs`: reads `MODULE_FEDERATION_CONFIG`, falls back to `package.json` in dev |

::: info Fastify is on its way out
Fastify still fronts the main dashboard, but a Go platform BFF -- **core-bff** -- already runs next to it in the same pod (`:8943`), reached at `/core-bff/api/*`, and is the only backend of the RHAII and MaaS Portal distributions. The plan is to make it the dashboard's only backend. See [Part 7: Core BFF](/guide/core-bff/) and [Fastify Today](/guide/core-bff/fastify-today).
:::

### Layer 4: BFF (Go)

This is where your Go code lives. Each BFF is a standalone Go HTTP server that handles the business logic for one specific package.

When a request arrives at the BFF, it goes through a middleware chain:

1. **Identity extraction** -- reads the user's identity from HTTP headers. The exact headers depend on the auth method: a token (`user_token` auth -- in production every module BFF reads `x-forwarded-access-token`) or `kubeflow-userid`/`kubeflow-groups` (`internal` auth, standalone/kubeflow dev only)
2. **Namespace validation** -- extracts and validates the namespace from query params
3. **Access check** -- performs an access review (SAR or SSAR) against the Kubernetes API to verify the user has permission in that namespace
4. **Client attachment** -- creates the appropriate service client (LlamaStack, Model Registry, etc.) and attaches it to the request context
5. **Handler execution** -- your actual endpoint logic runs, calls the service, shapes the response, and returns JSON

::: tip The Middleware Chain Is Key
Understanding the middleware chain is the single most important thing for working with BFF code. Every request passes through the same pipeline. When you add a new endpoint, you are mostly choosing which middleware to wrap it with and writing the handler function at the end. We will cover this in detail in [Request Flow](./request-flow).
:::

### Layer 5: Kubernetes API and External Services

The BFF talks to the actual services that hold the data:

- **Kubernetes API Server** -- for creating, reading, updating, and deleting Kubernetes resources (CRDs like OGXServers, InferenceServices, etc.) and for RBAC checks via access reviews (SAR/SSAR)
- **LlamaStack** -- AI model serving, inference, tool use, and vector stores
- **MLflow** -- experiment tracking and prompt management
- **Model Registry** -- kubeflow's model catalog service
- **S3-compatible storage** -- for dataset and artifact management
- **MaaS** -- Models-as-a-Service for API key and subscription management

The BFF uses Go's `client-go` library for Kubernetes operations and standard HTTP clients for external service calls. It forwards the user's auth token to upstream services so that permission checks are performed in the user's context, not the BFF's service account.

<div class="checkpoint">

#### Checkpoint

You should now understand what each of the five layers does:
1. **Browser** -- runs the React app, makes fetch calls to relative URLs
2. **Dev Server** -- serves bundles, proxies API requests (dev only)
3. **Backend** -- sits behind kube-rbac-proxy, proxies to BFFs and K8s API
4. **BFF** -- business logic, RBAC, service orchestration
5. **K8s/Services** -- the actual data sources

</div>

## Module Federation: How the UI Pieces Connect

The ODH Dashboard uses Module Federation (rspack with `@module-federation/enhanced`) to compose the UI from multiple independently-deployed packages. This is how gen-ai, model-registry, and other packages add their pages to the dashboard without being compiled into the main app.

Here is how it works:

```
                     Host (frontend/)
                    +-------------------+
                    |  Shell UI         |     <- the main dashboard application
                    |  - Sidebar nav    |
                    |  - Page router    |
                    |  - Auth context   |
                    +--------+----------+
                             |
              loadRemote('{name}/extensions')  <- dynamically loads each package's extensions
                             |
         +-------------------+-------------------+
         |                   |                   |
    +---------+        +---------+        +---------+
    | gen-ai  |        | model-  |        |  maas   |
    | remote  |        | registry|        | remote  |
    |---------|        | remote  |        |---------|
    |Extensions:       |---------|        |Extensions:
    | - nav items      |Extensions:       | - nav items
    | - routes         | - nav items      | - routes
    | - pages          | - routes         | - pages
    +---------+        | - pages          +---------+
              |        +---------+               |
              |               |                  |
         BFF (Go)        BFF (Go)           BFF (Go)
         :8143           :8043              :8243      <- production Service ports
```

Here is the key point: each remote package exposes an `extensions` module that defines navigation items (sidebar links), routes (URL paths), and area flags (feature gates). The host dynamically loads these extensions at runtime and integrates them into the unified dashboard experience. This is why you see navigation items for Gen AI, Model Registry, etc., even though they are developed in separate packages.

Each remote package can optionally have its own BFF running on a unique port. The BFF serves the API that the package's React components consume -- and, in production, also the package's built frontend bundle (`remoteEntry.js` and chunks), which Fastify proxies under `/_mf/<name>/`.

## The BFF Proxy Pattern

The backend's BFF proxy is configured by the federation config: in the cluster the operator generates it; in local dev it falls back to each package's `module-federation` settings in `package.json`. Let us walk through how the routing works:

```
Step 1: The package's federation entry declares its proxy path
  (package.json in dev, the federation-config ConfigMap in the cluster):
  "proxy": [{ "path": "/gen-ai/api", "pathRewrite": "/api" }]

Step 2: API request arrives at the backend:
  GET /gen-ai/api/v1/models?namespace=X

Step 3: Backend proxy (module-federation.ts) processes it:
  1. Matches /gen-ai/api from the registered proxy config
  2. Rewrites /gen-ai/api -> /api (strips the package prefix)
  3. Forwards to the BFF Service:
     GET https://odh-dashboard-gen-ai-ui.<ns>.svc.cluster.local:8143/api/v1/models?namespace=X
  4. If the entry has authorize: true, sets Authorization: Bearer <user token>
     (kube-rbac-proxy's x-forwarded-access-token is passed through as well)

Step 4 (separate path, not API): Static asset requests go through /_mf/:
  GET /_mf/genAi/remoteEntry.js
       ^^^^^^^^^
       Module Federation prefix (static assets only, not API calls)
  Backend proxies to the BFF, which serves the bundle from its static/ directory
```

Notice two separate URL patterns at play. API requests use the proxy path declared in `package.json` (e.g., `/gen-ai/api`). Static Module Federation assets (like `remoteEntry.js` and JS chunks) use the `/_mf/{name}/` prefix. Do not confuse the two -- they are separate routing mechanisms.

## Development Mode vs Production Mode

The architecture changes depending on whether you are running locally or in a production cluster. Understanding both is important for debugging.

### Development Mode

In development, each service runs on its own port on your machine:

```
Browser (you open localhost:4010 in your browser)
  |
  +-- localhost:4010 (rspack dev server - main dashboard)
        |
        +-- proxies /api/*, /_mf/*, /{pkg}/api/* to localhost:4000 (backend)

Backend (localhost:4000, BACKEND_PORT in .env.development)
  |
  +-- /gen-ai/api/*  and /_mf/genAi/*  -> localhost:9102 (gen-ai frontend dev server)
  +-- /maas/api/*    and /_mf/maas/*   -> localhost:9104 (maas frontend dev server)
  +-- ...                                 (the module-federation.local.port of each package)

Module frontend dev server (e.g. localhost:9104, maas)
  |
  +-- serves remoteEntry.js and the module's chunks
  +-- proxies /api/* to localhost:<PROXY_PORT> (the module's BFF, e.g. :8081 for maas)
```

In dev mode, everything runs as separate processes on your machine. The main dev server on `:4010` serves your React app and proxies API calls to the Fastify backend on `:4000`. In dev, the backend reads each package's `module-federation` block and sends that package's API path **and** its `/_mf/<name>` assets to the package's own frontend dev server (`module-federation.local.port`). That dev server, started with `PROXY_PORT=<bff port>` by `make dev-start-federated`, then forwards `/api` to the Go BFF. So there are two hops before your BFF: backend -> module dev server -> BFF.

### Production Mode

In production there is no dev server, and the BFFs are **not** sidecars: each module runs as its own Deployment and Service.

```
Browser (user opens the dashboard URL)
  |
  https://<gateway domain>/                      <- single entry point
  |
  Gateway API: HTTPRoute odh-dashboard            <- manifests/base/httproute.yaml
  |
  Service odh-dashboard :8443 (rhods-dashboard on RHOAI)
  |
  +-- Dashboard Pod (manifests/base/deployment.yaml)
  |     |
  |     +-- Container: kube-rbac-proxy (:8443)     <- authenticates the user, checks access,
  |     |     |                                       sets x-forwarded-access-token
  |     |     +-- http://localhost:8080
  |     |
  |     +-- Container: Fastify backend (:8080)
  |     |     +-- serves the pre-built dashboard bundles and index.html
  |     |     +-- /core-bff/api/*  -> core-bff (:8943, same pod)
  |     |     +-- /_mf/{name}/*    -> the module's Service   <- Module Federation assets
  |     |     +-- /{name}/api/*    -> the module's Service   <- API requests
  |     |
  |     +-- Container: core-bff (:8943, TLS)       <- the Go platform BFF
  |
  +-- Module Deployments (manifests/modules/<slug>/, one per enabled module)
        |  each: own ServiceAccount, RBAC, NetworkPolicy, TLS cert (<slug>-proxy-tls)
        |
        +-- Service odh-dashboard-model-registry-ui   :8043
        +-- Service odh-dashboard-gen-ai-ui           :8143
        +-- Service odh-dashboard-maas-ui             :8243
        +-- Service odh-dashboard-mlflow-ui           :8343
        +-- Service odh-dashboard-eval-hub-ui         :8543
        +-- Service odh-dashboard-automl-ui           :8643
        +-- Service odh-dashboard-autorag-ui          :8743
        +-- Service odh-dashboard-agent-ops-ui        :8843
        +-- Service odh-dashboard-notebooks-ui        :9043
        +-- Service odh-dashboard-data-registry-ui    :9143
        +-- Service odh-dashboard-data-connect-hub-ui :9243
```

Fastify reaches a module at `https://odh-dashboard-<slug>-ui.<namespace>.svc.cluster.local:<port>`, over TLS. Each module container serves both its API and its built frontend bundle, and runs with `--auth-method=user_token --auth-token-header=x-forwarded-access-token --auth-token-prefix=`, plus `--cert-file`/`--key-file` from its `<slug>-proxy-tls` secret and `--bundle-paths` for the cluster CA bundles. The dashboard operator deploys a module only when the platform components it needs are enabled in the DataScienceCluster (`RequiredDSCComponents` in `dashboard-operator/internal/controller/modules.go`). The ports above come from the same file (`Port:`).

core-bff is the exception: it is a container in the dashboard pod, reached through Fastify at `/core-bff/api/*` thanks to a `coreBff` entry the operator adds to the federation config. What it serves, and how it is the whole backend in other distributions, is in [Part 7: Core BFF](/guide/core-bff/) and [Core BFF Across Distributions](/guide/core-bff/distributions).

### The Federation Config, End to End

One JSON document tells every component which modules exist, where their bundles and APIs live, and whether to forward the user's token. Its journey:

1. **The operator generates it.** The dashboard operator builds the `federation-config` ConfigMap (`dashboard-operator/internal/controller/module_deploy.go`) from its module registry: one entry per deployed module (name, `remoteEntry`, Service, port, TLS, `proxyService` paths, `authorize`), plus the `coreBff` entry. The main key is `module-federation-config.json`.
2. **Fastify reads it as an environment variable.** `manifests/base/deployment.yaml` maps that key into the Fastify container as `MODULE_FEDERATION_CONFIG`. `getModuleFederationConfigs()` (`packages/app-config/src/module-federation.ts`) parses it, and `backend/src/routes/module-federation.ts` registers one `/_mf/<name>` proxy and one proxy per `proxyService` path.
3. **`root.ts` injects the remotes into the page.** `backend/src/routes/root.ts` renders `index.html` with the list of remotes (`name` + `remoteEntry`), so the host knows at runtime which bundles to load. Enabling a module needs no frontend rebuild.
4. **core-bff can read the same shape.** core-bff's module proxy (`distributions/core-bff/bff/internal/api/module_proxy.go`) loads a federation config file passed with `--mf-remotes-config` and proxies the module API paths it lists, with SSRF and reserved-prefix checks. Today the MaaS Portal uses this (with its own `maas-portal-federation-config`); in the RHOAI pod the flag is not set yet and Fastify does the proxying.
5. **`package.json` is only the dev fallback.** When `MODULE_FEDERATION_CONFIG` is unset and the backend runs in dev mode, `getModuleFederationConfigs(true)` falls back to the `module-federation` block of each workspace package. In the cluster, `package.json` values (including the `service` block) are ignored.

::: warning Production config does not live in the repo
`manifests/modular-architecture/federation-configmap.yaml` no longer exists. If you need to change a production port, path or `authorize` flag, change the operator's module registry (`modules.go`, `module_deploy.go`), not a manifest or `package.json`.
:::

## Development Port Reference

Each BFF package uses specific ports during local development. Frontend ports are declared in `module-federation.local.port` in `packages/<name>/package.json`. The BFF ports below are the ones each package's `make dev-start-federated` (or `dev-bff-federated`) passes as `PORT`/`PROXY_PORT` -- not necessarily the `-port` default in `cmd/main.go`:

| Package | Frontend Port | BFF Port (federated dev) | Proxy Path | Production Service Port |
|---|---|---|---|---|
| **gen-ai** | 9102 | 8080 (BFF Makefile default) | `/gen-ai/api` | 8143 |
| **model-registry** | 9100 | 4005 (`pnpm start:dev`; Makefile default 4000) | `/model-registry/api` | 8043 |
| **maas** | 9104 | 8081 | `/maas/api` | 8243 |
| **automl** | 9108 | 4003 | `/automl/api` | 8643 |
| **autorag** | 9107 | 4001 | `/autorag/api` | 8743 |
| **eval-hub** | 9106 | 4002 | `/eval-hub/api` | 8543 |
| **mlflow** | 9110 | 4020 | `/_bff/mlflow/api` | 8343 |
| **agent-ops** | 9111 | 4021 | `/agent-ops/api` | 8843 |
| **data-registry** | 9103 | 4000 | `/data-registry/api` | 9143 |
| **data-connect-hub** | 9113 | 4004 | `/data-connect-hub/api` | 9243 |
| **notebooks** | 9105 | -- (see its Makefile) | `/notebooks/api` | 9043 |

Because the dev backend runs on `:4000`, the gen-ai BFF on `:8080` does not collide with it -- unless you override `BACKEND_PORT` to 8080, in which case start one of them on a different port. Some defaults collide (data-registry and a bare model-registry `make dev-start-federated` both use `:4000`), so run only one of them at a time, or override `PORT`.

::: info Main Dashboard Ports
The main dashboard frontend dev server runs on **:4010** (`FRONTEND_PORT` in `.env.development`) and the Fastify backend on **:4000** in dev (`BACKEND_PORT`; it defaults to `8080` when unset, which is what the cluster uses). These are the "host" services that all the module-specific services connect through.
:::

::: warning MLflow Uses a Different Proxy Prefix
Notice that mlflow uses `/_bff/mlflow/api` instead of `/mlflow/api`. This is because the `/mlflow/` path prefix is reserved for the embedded MLflow UI (served by the `mlflow-embedded` package). The BFF uses the `/_bff/` prefix to avoid conflicts.
:::

**Where these ports are configured:**

| Setting | Location |
|---|---|
| Frontend dev port | `module-federation.local.port` in `packages/<name>/package.json` |
| BFF dev port | `PORT` / `PROXY_PORT` in the `dev-*-federated` recipes of `packages/<name>/Makefile` (`-port` default in `cmd/main.go` otherwise) |
| Proxy path and rewrite (dev) | `module-federation.proxy` in `packages/<name>/package.json` |
| Production service port and paths | `moduleRegistry` in `dashboard-operator/internal/controller/modules.go` (`Port:`, `ProxyPaths`) |
| Port conflict validation | `pnpm run validate:ports` from the repo root -- local dev ports only |

::: warning `validate:ports` does not check production
`scripts/validate-module-ports.js` still looks for two federation ConfigMap files that no longer exist, so it only catches clashes between local dev ports. Production port uniqueness is enforced by `modules.go` and its tests.
:::

## Where Am I in This Picture?

Let us map where your code fits in the architecture:

| If you are working on... | You are in layer... | Key directories |
|---|---|---|
| React components, hooks, pages | Layer 1 (Browser) | `packages/<name>/frontend/src/` |
| API calls from React | Layer 1 (Browser) | `packages/<name>/frontend/src/app/api/` |
| BFF route handlers | Layer 4 (BFF) | `packages/<name>/bff/internal/api/` |
| BFF middleware | Layer 4 (BFF) | `packages/<name>/bff/internal/api/middleware.go` |
| Service clients (K8s, LlamaStack) | Layer 4 (BFF) | `packages/<name>/bff/internal/integrations/` |
| Data types / DTOs | Layer 4 (BFF) | `packages/<name>/bff/internal/models/` |
| rspack / dev server config | Layer 2 (Dev Server) | `packages/<name>/frontend/config/` |
| Backend proxy / federation | Layer 3 (Backend) | `backend/src/routes/` |
| Platform-wide Go APIs | core-bff | `distributions/core-bff/bff/` -- see [Part 7](/guide/core-bff/) |

**Most of this guide focuses on Layer 4 -- the BFF.** That is where you will be writing Go code. Layers 1-3 are context so you understand how your BFF code connects to the rest of the system.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
1. Draw the layered architecture from memory (Browser, Dev Server, Backend, BFF, K8s)
2. Explain what each layer does and why it exists
3. Look up the correct port for any BFF package
4. Identify the difference between dev mode and production mode
5. Point to the directory where your code fits in the architecture

</div>

## How It All Fits Together

Here is the mental model to carry with you:

1. **Your React code** lives in `packages/<name>/frontend/` and knows nothing about Go, Kubernetes, or service meshes. It calls `fetch('/package-name/api/...')` and gets JSON.

2. **The Fastify backend** is the traffic cop. Behind kube-rbac-proxy, which authenticates users, it serves config and routes BFF requests to the right Go service.

3. **Your Go BFF** lives in `packages/<name>/bff/` and is the brains of the operation for your package. It validates permissions, calls upstream services, and returns clean JSON.

4. **Kubernetes and external services** are the data layer. The BFF talks to them so the frontend does not have to.

Each layer only knows about the layer directly below it. The React code does not know about Go. The BFF does not know about rspack. This separation of concerns is what makes the architecture maintainable -- you can change the BFF internals without touching React code, and vice versa.

::: tip Key Takeaway
The ODH Dashboard is a layered architecture: Browser (React) -> Frontend Dev Server (rspack) -> Backend (Fastify) -> BFF (Go) -> Kubernetes/Services. Each layer handles a specific concern. The BFF layer is where package-specific business logic lives, and it is the layer you will be writing Go code in. In development, each piece runs on its own port. In production, everything is behind a single Gateway HTTPRoute and kube-rbac-proxy, and each module BFF runs as its own Deployment and Service.
:::

::: info See Also
- [What is a BFF?](./what-is-bff) -- Why the BFF pattern exists and what problems it solves
- [Request Flow](./request-flow) -- Follow a single request through every layer in detail
- [Directory Structure](./directory-structure) -- What is inside the `bff/` directory
:::
