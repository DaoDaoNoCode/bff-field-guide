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

The BFF does not handle user login. When a user visits the dashboard, they go through an OpenShift OAuth login flow, and their identity needs to be validated on every request. That is the Fastify backend's job.

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
|    BACKEND (Fastify/Node)   |     <- validates auth, proxies to the right BFF
|   Port :8080                |
|   - Validates OAuth token   |     <- checks the user is who they say they are
|   - Rewrites /gen-ai/api    |     <- strips the package prefix from the path
|     to /api                 |
|   - Forwards to BFF service |     <- sends the request to the Go BFF
|   - Passes auth headers     |     <- forwards user identity to the BFF
+-------------+---------------+
              |
        GET /api/v1/models          <- path rewritten, auth headers added
              |
              v
+-----------------------------+
|         BFF (Go)            |
|   Port :8080 (gen-ai)      |     <- each BFF runs on its own port
+-----------------------------+
```

**What just happened?** We added a proxy layer. The browser never talks to the BFF directly. Instead, it sends requests to the Fastify backend (same origin as the page), which validates the user's OAuth token, rewrites the URL path, and forwards the request to the BFF. This is how authentication flows from the browser to the BFF without the browser knowing anything about Go servers or Kubernetes tokens.

::: info Why Not Just Put Auth in the BFF?
The Fastify backend handles authentication for the entire dashboard -- not just BFF requests but also direct Kubernetes API proxying (`/api/k8s/*`), dashboard config (`/api/config`), and Module Federation assets. Centralizing auth in one place means every service benefits from the same security checks.
:::

### Step 3: Adding the Dev Server -- Hot Reloading in Development

In development, there is one more layer: the Webpack dev server. It serves your JavaScript bundles, handles hot module replacement (change a React component, see it update without a page refresh), and proxies API requests to the backend so you do not have to deal with CORS during development.

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
|   Webpack :4010             |
|   - Serves JS/CSS/HTML      |     <- compiles TypeScript to JavaScript on the fly
|   - Hot module replacement  |     <- change code, see updates instantly
|   - Proxies /api/* to :8080 |     <- forwards API requests to the backend
+-------------+---------------+
              |
        proxy pass to :8080         <- dev server is a transparent proxy for API calls
              |
              v
+-----------------------------+
|    BACKEND (Fastify/Node)   |
|   Port :8080                |
+-------------+---------------+
              |
              v
+-----------------------------+
|         BFF (Go)            |
+-----------------------------+
```

**What just happened?** We added the development server. When you run `npm run dev`, the Webpack dev server starts on port 4010 (configured via `FRONTEND_PORT` in `.env.development`). Your browser talks to `:4010`, which serves the React app and proxies API requests to the Fastify backend on `:8080`. This is why you see `localhost:4010` in your browser's address bar during development.

::: info Development Only
This layer disappears in production. In production, the Fastify backend (or a static file server) serves the pre-built JavaScript bundles directly. There is no Webpack, no hot reloading, no dev proxy.
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
|    BACKEND (Fastify) :8080  |
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

**What just happened?** We added the bottom layer. The BFF uses Go's `client-go` library for Kubernetes operations (listing CRDs, running SubjectAccessReviews) and standard HTTP clients for external services like LlamaStack, MLflow, and S3. Some of these services (like the Kubernetes API) are strictly internal to the cluster, while others (like MLflow) may be exposed through a gateway. Either way, the BFF provides a unified API surface, handles auth injection, and keeps orchestration logic out of React components.

<div class="checkpoint">

#### Checkpoint

You have now seen all four layers built up one at a time:
1. **Browser** -- your React app, making simple fetch calls
2. **Dev Server** -- Webpack, serving bundles and proxying API requests (dev only)
3. **Backend** -- Fastify, handling auth and routing requests to BFFs
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
|     (gen-ai, model-registry, maas, automl, autorag, ...)         |
+-----------------------------------+------------------------------+
                                    |
                              fetch('/gen-ai/api/v1/models')
                                    |
                                    v
+------------------------------------------------------------------+
|              FRONTEND DEV SERVER  (dev only)                      |
|   Webpack Dev Server (:4010)                                      |
|   - Serves JS/CSS/HTML bundles                                    |
|   - Hot module replacement                                        |
|   - Proxies /api/* to Backend                                     |
|   - Proxies /_mf/* to Backend                                     |
+-----------------------------------+------------------------------+
                                    |
                              proxy pass
                                    |
                                    v
+------------------------------------------------------------------+
|                    BACKEND  (Fastify / Node.js)                   |
|   (:8080, configurable via PORT env var)                          |
|   - Authenticates user (OpenShift OAuth token)                    |
|   - Serves dashboard config (/api/config)                         |
|   - Proxies K8s API requests (/api/k8s/*)                        |
|   - Proxies BFF API requests (/{name}/api/* -> BFF service)       |
|   - Injects Module Federation remotes config into HTML            |
+-----------------------------------+------------------------------+
                                    |
                    /gen-ai/api/* -> BFF :8080
                                    |
                                    v
+------------------------------------------------------------------+
|                       BFF  (Go)                                   |
|   (:8080 or package-specific port)                                |
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

This is your world. The main dashboard is a React 18 application using PatternFly v6 for the UI. It runs in the browser and is the **host** in a Module Federation setup.

At startup, the host app discovers available remote packages (gen-ai, model-registry, maas, automl, autorag, etc.) and dynamically loads their JavaScript bundles. Each remote package contributes **extensions** -- navigation items, routes, pages, and status providers -- that plug into the host's shell.

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
This layer only exists when you run `npm run dev`. In production, a static file server or the backend itself serves the built JavaScript bundles.
:::

The Webpack dev server runs on port **4010** (for the main dashboard, set via `FRONTEND_PORT` in `.env.development`) and provides:

- **Hot module replacement** -- change a React component, see it update without a page refresh
- **JavaScript/CSS bundle serving** -- compiles TypeScript to JavaScript on the fly
- **Proxy** -- forwards API requests to the backend so you do not have to deal with CORS during development

The dev server's proxy configuration forwards:
- `/api/*` requests to the Fastify backend (for dashboard config, K8s API proxy, etc.)
- `/_mf/*` requests to the Fastify backend (for Module Federation static assets like `remoteEntry.js`)
- `/{package-name}/api/*` requests to the Fastify backend (which then proxies to individual BFFs)

Each federated package also runs its own dev server on a unique port for standalone development and testing. More on those ports in the [port reference table](#development-port-reference) below.

### Layer 3: Backend (Fastify / Node.js)

The Fastify backend is the central nervous system of the dashboard. It serves multiple critical roles:

**Authentication.** Every request that hits the backend is checked for a valid OpenShift OAuth token. The backend validates this token against the OpenShift API server and extracts the user's identity. If the token is invalid or expired, the backend returns 401.

**Dashboard configuration.** The `/api/config` endpoint serves the `OdhDashboardConfig` that controls feature flags, notification banners, and dashboard behavior. This is how the frontend knows which features are enabled.

**Kubernetes API proxy.** Requests to `/api/k8s/*` are proxied directly to the Kubernetes API server using the user's token. This is how the frontend creates projects, lists notebooks, and manages resources without a BFF.

**BFF proxy.** This is the critical connection for our purposes. The backend registers proxy routes from each package's `module-federation.proxy` configuration in `package.json`. When a request arrives at the package's proxy path (e.g., `/gen-ai/api/*`), the backend rewrites the path and forwards to the BFF service:

```
Browser request:     GET /gen-ai/api/v1/models?namespace=X       <- what the browser sends
Backend strips:      /gen-ai/api -> /api (per pathRewrite config) <- path prefix removed
Backend forwards to: GET http://bff-service:8080/api/v1/models?namespace=X  <- what the BFF receives
                     (with user auth headers forwarded)           <- identity travels with the request
```

**Module Federation config injection.** When the HTML page is first loaded, the backend injects a `<script>` tag containing the list of available remote modules and their entry points. This is how the host app knows which remote bundles to load.

::: warning Path Confusion
The path the browser sees (`/gen-ai/api/v1/models`) is different from the path the BFF receives (`/api/v1/models`). The `pathRewrite` in the proxy config strips the package prefix. When you are writing BFF route handlers, register paths starting with `/api/...`, not `/gen-ai/api/...`. This catches many newcomers.
:::

**Key files for this layer:**

| File | Purpose |
|---|---|
| `backend/src/routes/module-federation.ts` | Registers BFF proxy routes from package configs |
| `backend/src/routes/root.ts` | Injects Module Federation remotes config into HTML |

### Layer 4: BFF (Go)

This is where your Go code lives. Each BFF is a standalone Go HTTP server that handles the business logic for one specific package.

When a request arrives at the BFF, it goes through a middleware chain:

1. **Identity extraction** -- reads the user's ID and groups from headers (`kubeflow-userid`, `kubeflow-groups`) or the `Authorization` bearer token
2. **Namespace validation** -- extracts and validates the namespace from query params or URL path
3. **Access check** -- performs a SubjectAccessReview against the Kubernetes API to verify the user has permission in that namespace
4. **Client attachment** -- creates the appropriate service client (LlamaStack, Model Registry, etc.) and attaches it to the request context
5. **Handler execution** -- your actual endpoint logic runs, calls the service, shapes the response, and returns JSON

::: tip The Middleware Chain Is Key
Understanding the middleware chain is the single most important thing for working with BFF code. Every request passes through the same pipeline. When you add a new endpoint, you are mostly choosing which middleware to wrap it with and writing the handler function at the end. We will cover this in detail in [Request Flow](./request-flow).
:::

### Layer 5: Kubernetes API and External Services

The BFF talks to the actual services that hold the data:

- **Kubernetes API Server** -- for creating, reading, updating, and deleting Kubernetes resources (CRDs like LlamaStackDistributions, InferenceServices, etc.) and for RBAC checks via SubjectAccessReview
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
3. **Backend** -- authenticates users, proxies to BFFs and K8s API
4. **BFF** -- business logic, RBAC, service orchestration
5. **K8s/Services** -- the actual data sources

</div>

## Module Federation: How the UI Pieces Connect

The ODH Dashboard uses Webpack Module Federation to compose the UI from multiple independently-deployed packages. This is how gen-ai, model-registry, and other packages add their pages to the dashboard without being compiled into the main app.

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
         :8080           :4000              :8081
```

**What just happened?** Each remote package exposes an `extensions` module that defines navigation items (sidebar links), routes (URL paths), and area flags (feature gates). The host dynamically loads these extensions at runtime and integrates them into the unified dashboard experience. This is why you see navigation items for Gen AI, Model Registry, etc., even though they are developed in separate packages.

Each remote package can optionally have its own BFF running on a unique port. The BFF serves the API that the package's React components consume.

## The BFF Proxy Pattern

The backend's BFF proxy is configured by each package's `module-federation` settings in `package.json`. Let us walk through how the routing works:

```
Step 1: Package declares its proxy config in package.json:
  "proxy": [{ "path": "/gen-ai/api", "pathRewrite": "/api" }]

Step 2: API request arrives at the backend:
  GET /gen-ai/api/v1/models?namespace=X

Step 3: Backend proxy (module-federation.ts) processes it:
  1. Matches /gen-ai/api from the registered proxy config
  2. Rewrites /gen-ai/api -> /api (strips the package prefix)
  3. Forwards to BFF service: GET http://bff:8080/api/v1/models?namespace=X
  4. Passes through auth headers (Authorization, kubeflow-userid, kubeflow-groups)

Step 4 (separate path, not API): Static asset requests go through /_mf/:
  GET /_mf/genAi/remoteEntry.js
       ^^^^^^^^^
       Module Federation prefix (static assets only, not API calls)
  Backend proxies to the BFF's static file server
```

**What just happened?** There are two different URL patterns at play. API requests use the proxy path declared in `package.json` (e.g., `/gen-ai/api`). Static Module Federation assets (like `remoteEntry.js` and JS chunks) use the `/_mf/{name}/` prefix. Do not confuse the two -- they are separate routing mechanisms.

## Development Mode vs Production Mode

The architecture changes depending on whether you are running locally or in a production cluster. Understanding both is important for debugging.

### Development Mode

In development, each service runs on its own port on your machine:

```
Browser (you open localhost:4010 in your browser)
  |
  +-- localhost:4010 (frontend dev server - main dashboard)
  |     |
  |     +-- proxies /api/* to localhost:8080 (backend)
  |     +-- proxies /_mf/* to localhost:8080 (backend)
  |     +-- proxies /{pkg}/api/* to localhost:8080 (backend)
  |
  +-- localhost:9102 (gen-ai frontend dev server - for standalone dev)
  +-- localhost:9100 (model-registry frontend dev server)
  +-- localhost:9104 (maas frontend dev server)
  ...

Backend (localhost:8080)
  |
  +-- proxies /gen-ai/api/* to localhost:8080 (gen-ai BFF)
  +-- proxies /model-registry/api/* to localhost:4000 (model-registry BFF)
  +-- proxies /maas/api/* to localhost:8081 (maas BFF)
  ...
```

**What just happened?** In dev mode, everything runs as separate processes on your machine. The main frontend dev server on `:4010` serves your React app and proxies API calls to the Fastify backend on `:8080`. The backend then proxies BFF requests to the individual Go services on their respective ports.

### Production Mode

In production, everything runs behind a single OpenShift route:

```
Browser (user opens the dashboard URL)
  |
  https://dashboard.apps.cluster.example.com  <- single entry point
  |
  OpenShift Route (TLS termination)           <- handles HTTPS
  |
  +-- Dashboard Pod
  |     |
  |     +-- Container: Fastify backend (:8080)
  |     |     |
  |     |     +-- serves static frontend bundles    <- pre-built JS, no Webpack
  |     |     +-- proxies /_mf/* to BFF containers  <- Module Federation assets
  |     |     +-- proxies /{name}/api/* to BFFs     <- API requests
  |     |
  |     +-- Container: gen-ai BFF (:8143)           <- sidecar container, same pod
  |     +-- Container: model-registry BFF           <- sidecar container, same pod
  |     +-- Container: maas BFF                     <- sidecar container, same pod
  |     +-- Container: mlflow BFF                   <- sidecar container, same pod
  |     +-- ...                                     <- one sidecar per package
  ...
```

**What just happened?** In production, there is no Webpack dev server. The Fastify backend serves pre-built JavaScript bundles directly and proxies API requests to BFF containers running in the same pod. Each BFF runs as a **sidecar container** alongside the Fastify backend -- they share the same pod, so the backend can reach each BFF on `localhost` at its designated port. The federation config is managed via a ConfigMap (`manifests/modular-architecture/federation-configmap.yaml`).

## Development Port Reference

Each BFF package uses specific ports during local development. These ports are declared in the package's `package.json` under `module-federation.local.port` (frontend) and `bffConfig.port` (BFF):

| Package | Frontend Port | BFF Port | Proxy Path |
|---|---|---|---|
| **gen-ai** | 9102 | 8080 | `/gen-ai/api` |
| **model-registry** | 9100 | 4000 | `/model-registry/api` |
| **maas** | 9104 | 8081 | `/maas/api` |
| **automl** | 9108 | 4003 | `/automl/api` |
| **autorag** | 9107 | 4001 | `/autorag/api` |
| **eval-hub** | 9106 | 4002 | `/eval-hub/api` |
| **mlflow** | 9110 | 4020 | `/_bff/mlflow/api` |

::: warning gen-ai BFF Port Collision
The gen-ai BFF defaults to port **8080**, which is the same port the Fastify backend uses. In local development, the dev proxy handles routing so both can coexist, but if you need to run the gen-ai BFF standalone alongside the Fastify backend, you will need to start one of them on a different port (e.g., `--port 8090`).
:::

::: info Main Dashboard Ports
The main dashboard frontend dev server runs on **:4010** (configurable via `FRONTEND_PORT` in `.env.development`) and the Fastify backend runs on **:8080** (configurable via `PORT`). These are the "host" services that all the module-specific services connect through.
:::

::: warning MLflow Uses a Different Proxy Prefix
Notice that mlflow uses `/_bff/mlflow/api` instead of `/mlflow/api`. This is because the `/mlflow/` path prefix is reserved for the embedded MLflow UI (served by the `mlflow-embedded` package). The BFF uses the `/_bff/` prefix to avoid conflicts.
:::

**Where these ports are configured:**

| Setting | Location |
|---|---|
| Frontend dev port | `module-federation.local.port` in `packages/<name>/package.json` |
| BFF dev port | `bffConfig.port` in `packages/<name>/package.json` |
| Proxy path and rewrite | `module-federation.proxy` in `packages/<name>/package.json` |
| Production service port | `service.port` in `manifests/modular-architecture/federation-configmap.yaml` |
| Port conflict validation | `npm run validate:ports` from the repo root |

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
| Webpack / dev server config | Layer 2 (Dev Server) | `packages/<name>/frontend/config/` |
| Backend auth / proxy | Layer 3 (Backend) | `backend/src/routes/` |

**Most of this guide focuses on Layer 4 -- the BFF.** That is where you will be writing Go code. Layers 1-3 are context so you understand how your BFF code connects to the rest of the system.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
1. Draw the four-layer architecture from memory (Browser, Dev Server, Backend, BFF, K8s)
2. Explain what each layer does and why it exists
3. Look up the correct port for any BFF package
4. Identify the difference between dev mode and production mode
5. Point to the directory where your code fits in the architecture

</div>

## How It All Fits Together

Here is the mental model to carry with you:

1. **Your React code** lives in `packages/<name>/frontend/` and knows nothing about Go, Kubernetes, or service meshes. It calls `fetch('/package-name/api/...')` and gets JSON.

2. **The Fastify backend** is the traffic cop. It authenticates users, serves config, and routes BFF requests to the right Go service.

3. **Your Go BFF** lives in `packages/<name>/bff/` and is the brains of the operation for your package. It validates permissions, calls upstream services, and returns clean JSON.

4. **Kubernetes and external services** are the data layer. The BFF talks to them so the frontend does not have to.

Each layer only knows about the layer directly below it. The React code does not know about Go. The BFF does not know about Webpack. This separation of concerns is what makes the architecture maintainable -- you can change the BFF internals without touching React code, and vice versa.

::: tip Key Takeaway
The ODH Dashboard is a layered architecture: Browser (React) -> Frontend Dev Server (Webpack) -> Backend (Fastify) -> BFF (Go) -> Kubernetes/Services. Each layer handles a specific concern. The BFF layer is where package-specific business logic lives, and it is the layer you will be writing Go code in. In development, each piece runs on its own port. In production, everything is behind a single OpenShift route.
:::

::: info See Also
- [What is a BFF?](./what-is-bff) -- Why the BFF pattern exists and what problems it solves
- [Request Flow](./request-flow) -- Follow a single request through every layer in detail
- [Directory Structure](./directory-structure) -- What is inside the `bff/` directory
:::
