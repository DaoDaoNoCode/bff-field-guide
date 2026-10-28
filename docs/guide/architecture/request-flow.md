# Request Flow

> Follow a single API request from the moment a user clicks a button in React all the way down to the Kubernetes API and back -- every hop, every header, every transformation.

## Let Us Trace a Button Click

You are looking at the Gen AI playground in the ODH Dashboard. The page needs to show a list of available AI models. Let us follow that request through every layer of the stack, one step at a time, with real code at each layer.

Here is the full journey we will trace:

```
  Browser (React)        Fastify Backend         BFF (Go)           K8s / LlamaStack
       |                      |                     |                      |
  1.   |--- fetch() --------->|                     |                      |
       |  GET /gen-ai/api/    |                     |                      |
       |  v1/lsd/models       |                     |                      |
       |  ?namespace=my-proj  |                     |                      |
       |                      |                     |                      |
  2.   | (kube-rbac-proxy, in |                     |                      |
       |  front of Fastify,   |                     |                      |
       |  authenticates the   |                     |                      |
       |  user first)         |                     |                      |
       |                      |                     |                      |
  3.   |                      |-- proxy request --->|                      |
       |                      |   GET /api/v1/lsd/  |                      |
       |                      |   models?namespace= |
       |                      |   my-proj           |                      |
       |                      |   + auth headers    |                      |
       |                      |                     |                      |
  4.   |                      |                     |-- extract identity ->|
       |                      |                     |   (from headers)     |
       |                      |                     |                      |
  5.   |                      |                     |-- access review ---->|
       |                      |                     |   "can user list     |
       |                      |                     |    in my-proj?"      |
       |                      |                     |<-- allowed ----------|
       |                      |                     |                      |
  6.   |                      |                     |-- find OGXServer ---->|
       |                      |                     |   (K8s CRD)          |
       |                      |                     |<-- service URL ------|
       |                      |                     |                      |
  7.   |                      |                     |-- GET /v1/models --->|
       |                      |                     |   (to LlamaStack)    |
       |                      |                     |<-- model list -------|
       |                      |                     |                      |
  8.   |                      |<-- JSON response ---|                      |
       |                      |    200 OK           |                      |
       |                      |                     |                      |
  9.   |<-- JSON response ----|                     |                      |
       |    200 OK            |                     |                      |
       |                      |                     |                      |
 10.   | setState(models)     |                     |                      |
       | re-render UI         |                     |                      |
```

Do not worry about memorizing this. We will walk through each step in detail, with actual code.

## Layer 1: React Component Calls a Service Function

Everything starts in a React component. The user navigates to the Gen AI playground, and a hook fires to load available models:

```typescript
// In a React component (simplified for clarity)
const { namespace } = useNamespace();                        // get the current namespace from context
const [models, setModels] = React.useState<Model[]>([]);     // state to hold the list of models

React.useEffect(() => {                                      // run this effect when the namespace changes
  async function loadModels() {                              // define an async function to fetch models
    const response = await fetch(                            // make an HTTP GET request
      `/gen-ai/api/v1/lsd/models?namespace=${namespace}`     // relative URL -- the browser resolves this
    );                                                       // against the current page origin
    const data = await response.json();                      // parse the JSON response body
    setModels(data.models);                                  // update React state with the model list
  }                                                          // end of the async function
  loadModels();                                              // invoke the function immediately
}, [namespace]);                                             // re-run when namespace changes
```

**What just happened?** The `fetch()` call goes to a **relative URL**. The browser resolves this against the current page origin. In development, that is `http://localhost:4010`. In production, that is `https://dashboard.apps.cluster.example.com`. The React code does not know or care which one -- it works identically in both environments.

::: info Why Relative URLs?
Using relative URLs like `/gen-ai/api/...` instead of absolute URLs like `http://localhost:8080/api/...` means the same React code works in development, production, and testing without any configuration changes. The browser always sends the request to whatever origin served the page.
:::

## Layer 2: Frontend Dev Server Proxies the Request (Dev Only)

In development, the request first hits the rspack dev server on `:4010`. The dev server's proxy configuration matches the path and forwards the request to the Fastify backend:

```
What the browser sends:                                          
  GET http://localhost:4010/gen-ai/api/v1/lsd/models?namespace=my-proj

What the dev server does:                                        
  Matches /gen-ai/api/* against its proxy rules                  
  Forwards to -> http://localhost:4000/gen-ai/api/v1/lsd/models?namespace=my-proj

What changes:                                                    
  Only the host changes (4010 -> 4000). The path stays the same.
```

The dev server is a transparent proxy. It does not modify the request path or body -- it just forwards the request to the backend on `:4000` (`BACKEND_PORT`). In dev, the backend then sends it to the gen-ai **frontend** dev server (`localhost:9102`, the package's `module-federation.local.port`), which proxies `/api` to the BFF on its `PROXY_PORT`. In production, none of these dev servers exist; the browser talks to the Gateway, and from there to the dashboard pod.

## Layer 3: The Dashboard Pod Authenticates and Proxies to the BFF

In the cluster, the request enters through the Gateway's HTTPRoute and reaches the dashboard Service on `:8443`. Two containers of the dashboard pod handle it. Let us walk through each step:

### 3a. kube-rbac-proxy Authenticates the User

Authentication happens **before** Fastify sees the request. The `kube-rbac-proxy` container listens on `:8443`, authenticates the user against the cluster, checks they may access the dashboard, and only then forwards to Fastify on `localhost:8080`:

```
kube-rbac-proxy:
  Authenticates the user's token against the cluster  <- who is this user?
  Checks they can list projects                       <- may they use the dashboard?
  If not: the request never reaches Fastify            <- 401/403 from the proxy

Forwards to Fastify with:
  x-forwarded-access-token: <user's token>            <- the user's own token
  X-Auth-Request-User / X-Auth-Request-Groups         <- user name, groups
```

The access check is configured in `manifests/base/kube-rbac-proxy-config.yaml`. The `x-forwarded-access-token` header is the same one the old OAuth proxy used to set, so code downstream did not have to change. Fastify does not validate the token itself; it trusts the proxy in front of it.

### 3b. Match the BFF Route

The backend's Module Federation proxy matches the path `/gen-ai/api/*` against the registered proxy rules. In the cluster those rules come from the operator-generated `federation-config` ConfigMap (env `MODULE_FEDERATION_CONFIG`); in local dev, from the gen-ai package's `package.json`. Either way, the gen-ai entry says:

```json
{
  "proxy": [{                          
    "path": "/gen-ai/api",             // match requests starting with this path
    "pathRewrite": "/api"              // replace /gen-ai/api with /api
  }]
}
```

### 3c. Forward to the BFF

The backend proxies the request to the BFF's own Service, over TLS, rewriting the path and forwarding the user's token:

```
Incoming path:     GET /gen-ai/api/v1/lsd/models?namespace=my-proj    <- what the backend received
Rewritten path:    GET /api/v1/lsd/models?namespace=my-proj           <- /gen-ai/api stripped to /api

Forwarded to:      https://odh-dashboard-gen-ai-ui.<ns>.svc.cluster.local:8143/api/v1/lsd/models?namespace=my-proj

Headers forwarded:                                                     
  x-forwarded-access-token: <user's token>                             <- passed through from kube-rbac-proxy
  Authorization: Bearer <user's token>                                 <- set by Fastify when the entry has authorize: true
```

Three things happened in the dashboard pod. kube-rbac-proxy authenticated the user, Fastify rewrote the URL path (stripping the `/gen-ai/api` prefix to just `/api`), and Fastify forwarded the request to the Go BFF with the user's token. Fastify never sets `kubeflow-userid` or `kubeflow-groups`; those headers only matter for `internal` auth in standalone or kubeflow dev setups.

::: info Not every request goes to a package BFF
`/api/k8s/*`, `/wss/k8s/*`, `/api/config`, `/api/components` and the other platform endpoints are served by Fastify itself, and `/core-bff/api/*` goes to core-bff in the same pod. None of them reach a package BFF. See [Part 7: Core BFF](/guide/core-bff/) and [Fastify Today](/guide/core-bff/fastify-today).
:::

::: warning The Path Rewrite Matters
The path the browser sees (`/gen-ai/api/v1/models`) is different from the path the BFF receives (`/api/v1/models`). When you write BFF route handlers, register paths starting with `/api/...`, not `/gen-ai/api/...`. This is a common source of confusion for newcomers.
:::

<div class="checkpoint">

#### Checkpoint

We have traced the request from the browser through the dev server and backend. At this point:
- The browser made a simple `fetch()` call to a relative URL
- The dev server proxied it to the backend (dev only)
- kube-rbac-proxy authenticated the user in front of the backend
- The backend rewrote the path and forwarded to the BFF with the user's token

Now the request enters the Go BFF. This is where things get interesting.

</div>

## Layer 4: BFF Global Middleware -- InjectRequestIdentity

The request arrives at the Gen AI BFF (a Go HTTP server). Before it reaches the handler function, it passes through middleware. The first middleware is **global** -- it runs on every `/api` request. The healthcheck has its own, shorter chain, and `InjectRequestIdentity` skips paths that are not under the API prefix (static assets), so neither needs a token.

The global middleware chain wraps the app's mux (simplified from gen-ai's `Routes()`):

```go
// From internal/api/app.go -- the Routes() method (gen-ai, trimmed)
// Health check endpoint, isolated with its own middleware
healthcheckMux.Handle(constants.HealthCheckPath,
    app.RecoverPanic(app.EnableTelemetry(healthcheckRouter)))
combinedMux.Handle(constants.HealthCheckPath, healthcheckMux)

// Everything else: read from inside out -- appMux (API router + static files)
// is wrapped by InjectRequestIdentity, then EnableCORS, EnableTelemetry, RecoverPanic.
combinedMux.Handle("/", otelhttp.NewHandler(
    app.RecoverPanic(app.EnableTelemetry(app.EnableCORS(app.InjectRequestIdentity(appMux)))),
    "gen-ai-bff", ...))
```

The middleware chain runs outermost-first: `RecoverPanic` -> `EnableTelemetry` -> `EnableCORS` -> `InjectRequestIdentity` -> router. Each middleware wraps the next one.

::: warning RequestIdentity Differs Between BFFs
The `RequestIdentity` struct differs between BFFs. maas, eval-hub and agent-ops store `UserID`, `Groups`, and `Token`; automl and autorag share one from `packages/autox-core/services/kubernetes/models.go`; data-registry stores only `UserID` and `Token`; mlflow keeps the token as a redacting `BearerToken`; gen-ai stores only `Token` and `MCPToken` (`internal/integrations/types.go`). The example below uses the maas pattern -- check your specific BFF's `internal/integrations/kubernetes/types.go` (or the files above) for the actual fields.
:::

Now let us look at `InjectRequestIdentity`, the middleware that extracts who the user is:

```go
// Simplified from internal/api/middleware.go (maas pattern -- other BFFs differ).
// The real code first skips non-/api paths, then delegates to
// kubernetesClientFactory.ExtractRequestIdentity(r.Header).
func (app *App) InjectRequestIdentity(next http.Handler) http.Handler {  // wraps the entire router
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { // returns a new handler
        userID := r.Header.Get("kubeflow-userid")      // internal auth only (standalone/kubeflow dev)
        groups := r.Header.Get("kubeflow-groups")      // internal auth only
        token := r.Header.Get("Authorization")         // user_token auth: the configured token header

        identity := RequestIdentity{                   // create an identity struct
            UserID: userID,                            // store the username
            Groups: strings.Split(groups, ","),        // split groups into a slice (Go's array)
            Token:  strings.TrimPrefix(token, "Bearer "), // strip the "Bearer " prefix from the token
        }

        ctx := context.WithValue(r.Context(), identityKey, identity) // attach identity to the context
        next.ServeHTTP(w, r.WithContext(ctx))          // call the next handler with the updated context
    })
}
```

The middleware extracted the user's identity from HTTP headers and stored it in the request context. Every subsequent middleware and handler can access this identity via `r.Context().Value(identityKey)`.

::: info Global vs Per-Route Middleware
`InjectRequestIdentity` is a **global middleware** that wraps the entire router as an `http.Handler`. It runs on every API request. This is different from per-route middleware like `AttachNamespace` and `RequireAccessToService`, which wrap individual `httprouter.Handle` functions and are composed per-endpoint. We will see those next.
:::

## Layer 5: BFF Per-Route Middleware -- Namespace and Permissions

After global middleware, the request hits the router, which dispatches to the specific route. But the route has its own middleware chain. Here is how the route for listing models is registered:

```go
// From internal/api/app.go -- route registration
router.GET("/api/v1/lsd/models",            // the URL path this handler responds to
    app.AttachNamespace(                     // middleware 1: extract namespace from query params
        app.RequireAccessToService(          // middleware 2: check RBAC permissions
            app.AttachOGXClient(             // middleware 3: create LlamaStack service client
                app.LlamaStackModelsHandler)))) // the actual handler function
```

Read this inside-out. The handler `LlamaStackModelsHandler` is wrapped by three middleware functions. The request flows from outside in:

```
Request arrives at route /api/v1/lsd/models
  |
  v
AttachNamespace
  - Reads ?namespace=my-proj from the query string     <- extracts the namespace
  - Validates it is not empty                          <- rejects if missing
  - Stores the namespace in the request context        <- available to later middleware
  |
  v
RequireAccessToService
  - Gets the namespace from context                    <- reads what AttachNamespace stored
  - Gets the user identity from context                <- reads what InjectRequestIdentity stored
  - Performs K8s access review (SAR/SSAR)               <- "can this user access my-proj?"
  - If denied: returns 403, request stops here         <- fail closed -- deny if unsure
  |
  v
AttachOGXClient
  - Gets the namespace from context                    <- reads the namespace again
  - Looks up the OGXServer CRD                          <- finds the K8s Custom Resource
  - Gets the service URL from the CRD's .status field  <- where is LlamaStack running?
  - Creates an HTTP client pointing to that URL         <- ready to make requests
  - Stores the client in the request context            <- handler can use it
  |
  v
LlamaStackModelsHandler
  - Gets the LlamaStack client from context            <- pulls out what the middleware set up
  - Calls client.ListModels()                          <- makes the actual API call
  - Returns the JSON response                          <- sends data back to the browser
```

Let us look at the RBAC middleware in detail, because this is the security gate:

```go
// Simplified from internal/api/middleware.go
func (app *App) RequireAccessToService(next httprouter.Handle) httprouter.Handle { // wraps a route handler
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {   // returns a new handler
        namespace := getNamespace(r.Context())      // get the namespace from context (set by AttachNamespace)
        identity := getIdentity(r.Context())        // get the user identity (set by InjectRequestIdentity)

        allowed, err := app.kubeClient.CanListOGXServers( // ask Kubernetes: can this user access this resource?
            identity,                               // use the user's own token for the check
            namespace,                              // check against this specific namespace
        )
        if err != nil {                             // if the K8s API call itself failed
            app.serverErrorResponse(w, r, err)      // return 500 Internal Server Error
            return                                  // stop processing
        }
        if !allowed {                               // if the user does not have permission
            app.forbiddenResponse(w, r,             // return 403 Forbidden
                "user does not have permission in this namespace")
            return                                  // stop processing -- handler never runs
        }

        next(w, r, ps)                              // permission granted -- pass to the next middleware/handler
    }
}
```

**What just happened?** The middleware asked Kubernetes "does this user have permission to access this specific resource type in the `my-proj` namespace?" using an access review (SelfSubjectAccessReview in `user_token` mode, SubjectAccessReview in `internal` mode -- see [Authentication & RBAC](../deep-dive/auth) for the difference). If the answer is no, the request is rejected with a 403 and the handler never executes. This is the **fail closed** pattern -- if we cannot verify permission, we deny access.

**Why not just rely on Kubernetes?** You might think: "The BFF uses the user's token for K8s API calls, so K8s would reject unauthorized requests anyway." That is true for direct K8s API calls. But the BFF also calls **upstream services** (LlamaStack, MLflow, NeMo Guardrails) that do not enforce K8s RBAC. LlamaStack does not know about Kubernetes namespaces or roles -- it just sees a valid token. Without the SAR check, any authenticated user could reach any upstream service in any namespace.

::: warning RBAC Is Non-Negotiable
Every endpoint that accesses namespace-scoped resources MUST go through the access check middleware. The current implementation checks a specific resource type per service (e.g., "can this user list OGXServers in this namespace?"). This means the check is **resource-scoped, not namespace-scoped** -- a user might have access to one resource type in a namespace but not another. As the dashboard evolves toward shared namespaces (where users can access specific resources without having broad namespace access), these checks will likely become more fine-grained.
:::

## Layer 6: BFF Handler Executes Business Logic

After passing through all middleware, the request reaches the handler function. By this point, the middleware has already:
- Extracted the user's identity
- Validated the namespace
- Checked RBAC permissions
- Created a LlamaStack client configured for the right service URL

The handler itself is simple:

```go
// Simplified from internal/api/lsd_models_handler.go
// The real handler uses a repository layer and wraps the response in a ModelsResponse envelope,
// but the pattern is the same: get data, handle errors, write JSON.
func (app *App) LlamaStackModelsHandler(
    w http.ResponseWriter,           // the response writer -- like Express's res
    r *http.Request,                 // the incoming request -- like Express's req
    _ httprouter.Params,             // URL path parameters (not used for this endpoint)
) {
    ctx := r.Context()

    models, err := app.repositories.Models.ListModels(ctx) // call the repository to list models
    if err != nil {                                         // if the call failed
        app.handleLlamaStackClientError(w, r, err)          // return an appropriate error response
        return                                              // stop processing
    }

    response := ModelsResponse{Data: models}                // wrap in the standard response envelope
    app.WriteJSON(w, http.StatusOK, response, nil)          // write as JSON with 200 OK status
}
```

**What just happened?** The handler is intentionally simple. All the hard work (auth, RBAC, client creation) was done by middleware. The handler calls the repository (which uses the service client from context), wraps the result, and returns JSON. This is the pattern you will follow for every handler you write.

::: info Context Is the Thread
Notice how each middleware adds something to the request context: the namespace, the identity, the service client. The handler (or repository layer) at the end pulls everything it needs from the context. This is Go's pattern for passing data through a middleware chain -- instead of mutating a request object (like Express's `req.locals`), you create a new context with the added value.
:::

## Layer 7: BFF Calls Upstream Service

The LlamaStack client (created by middleware) makes an HTTP call to the LlamaStack service running in the cluster:

```go
// Simplified from internal/integrations/httpclient/
func (c *HTTPClient) ListModels(ctx context.Context) (*ModelsResponse, error) { // method on the HTTP client
    req, err := http.NewRequestWithContext(ctx, "GET",  // create a new HTTP GET request
        c.baseURL + "/v1/models", nil)                  // targeting the LlamaStack models endpoint
    if err != nil {                                     // if request creation failed (unlikely)
        return nil, err                                 // return the error
    }

    req.Header.Set("Authorization", "Bearer " + c.token) // forward the user's token to LlamaStack

    resp, err := c.httpClient.Do(req)                     // execute the HTTP request
    if err != nil {                                       // if the network call failed
        return nil, err                                   // return the error
    }
    defer resp.Body.Close()                               // ensure the response body is closed when done

    var models ModelsResponse                              // declare a variable to hold the parsed response
    err = json.NewDecoder(resp.Body).Decode(&models)       // parse the JSON response into the struct
    return &models, err                                    // return the parsed models (and any decode error)
}
```

**What just happened?** The BFF made an HTTP call to the LlamaStack service. The service URL came from a Kubernetes CRD status field (`OGXServer.Status.ServiceURL`), discovered by the `AttachOGXClient` middleware. The user's token is forwarded as an auth credential, but LlamaStack does not perform K8s RBAC checks -- that was already handled by the BFF's access review middleware in the previous step.

## Layers 8-9: Response Flows Back

The response flows back through each layer in reverse. Each proxy layer is transparent -- the JSON the BFF returns is exactly what the browser receives:

```
LlamaStack returns:                                          
  { "models": [{ "id": "llama-3", "name": "Llama 3", ... }] }

BFF handler calls app.WriteJSON():                           
  HTTP/1.1 200 OK                                            <- status code
  Content-Type: application/json                             <- response type
  {"models": [{"id": "llama-3", "name": "Llama 3", ...}]}   <- JSON body

Backend proxy passes response through unchanged              <- no modification

Dev server proxy passes response through unchanged           <- no modification (dev only)

Browser receives:                                            
  {"models": [{"id": "llama-3", "name": "Llama 3", ...}]}   <- same JSON the BFF sent
```

The response flowed back through each layer unchanged. The JSON the BFF produced is exactly what the browser receives.

## Layer 10: React Updates the UI

Back in the browser, the `fetch()` promise resolves and the React component updates its state:

```typescript
const data = await response.json(); // parse the JSON response from the BFF
setModels(data.models);             // update React state with the model list
// React re-renders the component with the new data
```

The user sees a list of AI models on the page. The entire journey -- from button click to rendered UI -- took milliseconds.

<div class="checkpoint">

#### Checkpoint

You have now traced a complete request through all layers:
1. **React** called `fetch()` with a relative URL
2. **Dashboard pod** authenticated the user (kube-rbac-proxy), rewrote the path and forwarded to the BFF (Fastify)
3. **BFF middleware** extracted identity, validated namespace, checked RBAC, and created the service client
4. **BFF handler** called the upstream service and returned JSON

</div>

## The Authentication Flow in Detail

Now let us zoom in on how authentication works at each layer. This is one of the trickiest parts to understand because the user's identity is transformed multiple times as it passes through the system.

```
+-- User's Browser -----------------------------------------------+
|                                                                  |
|  1. User visits the dashboard URL (the cluster Gateway)          |
|  2. The cluster's login flow runs if there is no session         |
|                                                                  |
+------------------------------------------------------------------+
                              |
                    Gateway HTTPRoute -> Service :8443
                              |
                              v
+-- Dashboard pod: kube-rbac-proxy (:8443) ---------------------+
|                                                              |
|  3. Authenticates the user against the cluster               |
|  4. Checks the user may access the dashboard                 |
|  5. Sets x-forwarded-access-token (+ X-Auth-Request-*)       |
|  6. Forwards to Fastify on localhost:8080                    |
|                                                              |
+--------------------------------------------------------------+
                              |
                              v
+-- Dashboard pod: Fastify (:8080) ----------------------------+
|                                                              |
|  7. Matches the module's proxy path, rewrites it             |
|  8. If the entry has authorize: true, sets                   |
|     Authorization: Bearer <x-forwarded-access-token>         |
|  9. Forwards over TLS to odh-dashboard-<slug>-ui:<port>      |
|                                                              |
+--------------------------------------------------------------+
                              |
                    x-forwarded-access-token: <token>       <- what production BFFs read
                    Authorization: Bearer <token>           <- when authorize: true
                              |
                              v
+-- BFF (Go) --------------------------------------------------+
|                                                              |
| 10. InjectRequestIdentity middleware reads headers           |
| 11. Auth method determines which headers to trust:           |
|     - "user_token": reads the configured token header        |
|       (production: x-forwarded-access-token, no prefix)      |
|     - "internal": reads kubeflow-userid + kubeflow-groups    |
|       (standalone/kubeflow dev only)                         |
|     - "disabled": no auth (mock/testing only)                |
| 12. Identity stored in request context                       |
| 13. SAR/SSAR uses the token for K8s permission checks        |
|                                                              |
+--------------------------------------------------------------+
```

**What just happened?** The user logs in once at the cluster edge. kube-rbac-proxy turns that session into a verified token in `x-forwarded-access-token`, Fastify carries it to the BFF, and the BFF reassembles it into a `RequestIdentity` struct. The same token is what the BFF uses for Kubernetes API calls and upstream service authentication, so every check runs as the user.

::: tip Auth Methods and Headers Vary by BFF
BFFs support up to three authentication methods, configured by the `--auth-method` flag. Not every BFF supports all three:

- **`internal`** -- reads identity from `kubeflow-userid` and `kubeflow-groups` headers
- **`user_token`** -- reads the auth token from a configurable header (varies by BFF)
- **`disabled`** -- skips auth entirely (useful for local dev with mocks)

The defaults in `cmd/main.go` and the supported methods differ across BFFs, but **in production they do not matter**: every module Deployment in `manifests/modules/` passes `--auth-method=user_token --auth-token-header=x-forwarded-access-token --auth-token-prefix=`.

| BFF | Supported | Default | Default Token Header | Production |
|---|---|---|---|---|
| gen-ai, mlflow | `disabled`, `user_token` | `user_token` | `x-forwarded-access-token` (gen-ai), `Authorization` (mlflow) | `user_token` / `x-forwarded-access-token` |
| automl, autorag | `disabled`, `internal`, `user_token` | `user_token` | `Authorization` | `user_token` / `x-forwarded-access-token` |
| data-registry | `user_token` only | `user_token` | `Authorization` | `user_token` / `x-forwarded-access-token` |
| data-connect-hub | `internal`, `user_token` | `user_token` | `Authorization` | `user_token` / `x-forwarded-access-token` |
| maas, eval-hub | `internal`, `user_token` | `internal` | `x-forwarded-access-token` (maas), `Authorization` (eval-hub) | `user_token` / `x-forwarded-access-token` |
| agent-ops | `internal`, `user_token`, `disabled` | `internal` | `Authorization` | `user_token` / `x-forwarded-access-token` |

Always check the specific BFF's `cmd/main.go` for the supported methods and default, and its `manifests/modules/<slug>/deployment.yaml` for what really runs.
:::

## The Complete Middleware Chain

Let us see the full middleware chain one more time, now that you understand what each piece does:

```go
// From internal/api/app.go -- route registration
router.GET("/api/v1/lsd/models",                     // URL path pattern
    app.AttachNamespace(                              // per-route middleware 1
        app.RequireAccessToService(                   // per-route middleware 2
            app.AttachOGXClient(                      // per-route middleware 3
                app.LlamaStackModelsHandler))))       // the actual handler

// The full chain for this request, including global middleware
// (the healthcheck skips InjectRequestIdentity):
// RecoverPanic -> EnableTelemetry -> EnableCORS -> InjectRequestIdentity
//   -> router dispatches to /api/v1/lsd/models
//     -> AttachNamespace -> RequireAccessToService -> AttachOGXClient
//       -> LlamaStackModelsHandler
```

Every request passes through global middleware first, then per-route middleware, then the handler. When you add a new endpoint, you choose which per-route middleware to wrap it with and write the handler function.

## Error Flow: What Happens When Things Go Wrong

When things go wrong, errors flow back up through the same path. Let us trace a permission denial:

```
Scenario: User does not have access to the namespace

Browser:  GET /gen-ai/api/v1/lsd/models?namespace=restricted-proj  <- user tries to access a namespace
  |
Pod:      kube-rbac-proxy authenticates (OK), Fastify proxies to BFF <- auth passes, but RBAC might not
  |
BFF global middleware: InjectRequestIdentity -> OK                 <- identity extracted successfully
  |
BFF per-route middleware: AttachNamespace -> OK                    <- namespace parsed from query
  |
BFF per-route middleware: RequireAccessToService
  |-- Performs access review: "can user list in restricted-proj?"
  |-- K8s returns: DENIED                                          <- user lacks permission
  |
BFF returns:                                                       <- handler never executes
  HTTP/1.1 403 Forbidden
  {
    "error": {
      "code": "403",                                               <- HTTP status code as string
      "message": "user does not have permission to access services in this namespace"
    }
  }
  |
Backend: Passes 403 response through unchanged                    <- proxy is transparent
  |
Browser: fetch() resolves with response.status === 403            <- not a network error
  |
React: Shows "Access denied" error message to the user            <- UI handles the error
```

The RBAC middleware denied the request before the handler could run. The error follows the standard error envelope format:

```json
{
  "error": {                             
    "code": "403",                       // HTTP status code as string (not a named code)
    "message": "user does not have permission to access services in this namespace"
  }
}
```

Every BFF uses the same error envelope structure. Your React code can rely on this format for consistent error handling:

```typescript
if (!response.ok) {                          // check if the HTTP status indicates an error
  const errorData = await response.json();   // parse the error response body
  throw new Error(errorData.error.message);  // extract the human-readable message
}
```

## A Second Example: Creating a Resource (POST)

Let us trace a write operation to see how POST requests differ. A user creates a new vector store in the Gen AI playground:

```
Browser sends:
  POST /gen-ai/api/v1/lsd/vectorstores?namespace=my-proj  <- POST instead of GET
  Content-Type: application/json                           <- sending JSON in the request body
  {
    "name": "my-docs",                                     <- the vector store name
    "metadata": { "team": "search" }                       <- optional key-value pairs
  }
```

The route is registered with the same middleware as the GET (`app.go`):

```go
apiRouter.POST(constants.VectorStoresListPath,
    app.AttachNamespace(app.RequireAccessToService(app.AttachOGXClient(
        app.LlamaStackCreateVectorStoreHandler))))
```

The request flows through the same layers: dev server proxy, authentication and path rewrite in the dashboard pod, BFF global middleware, per-route middleware. The handler is slightly different because it reads a request body:

```go
// From internal/api/lsd_vectorstores_handler.go (trimmed)
func (app *App) LlamaStackCreateVectorStoreHandler(
    w http.ResponseWriter,             // response writer
    r *http.Request,                   // incoming request (has a body this time)
    _ httprouter.Params,               // URL path parameters (unused)
) {
    ctx := r.Context()

    var createRequest CreateVectorStoreRequest                  // the request body: Name, Metadata
    if err := json.NewDecoder(r.Body).Decode(&createRequest); err != nil {
        app.badRequestResponse(w, r, err)                       // malformed JSON -> 400
        return
    }

    if strings.TrimSpace(createRequest.Name) == "" {            // validate required fields
        app.badRequestResponse(w, r, errors.New("name is required"))
        return
    }

    params := llamastack.CreateVectorStoreParams{               // convert to client params
        Name:     createRequest.Name,
        Metadata: createRequest.Metadata,
    }

    vectorStore, err := app.repositories.VectorStores.CreateVectorStore(ctx, params)
    if err != nil {
        app.handleLlamaStackClientError(w, r, err)              // map LlamaStack errors to HTTP
        return
    }

    response := VectorStoreResponse{Data: vectorStore}          // the standard data envelope
    if err := app.WriteJSON(w, http.StatusCreated, response, nil); err != nil {
        app.serverErrorResponse(w, r, err)
    }
}
```

The pattern is the same as GET requests: middleware handles auth and permissions, the handler handles business logic. The only differences for POST are: (1) the handler reads and validates a request body, and (2) it returns 201 Created instead of 200 OK, with the new vector store under `data`.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
1. Trace any request from React through all layers to the BFF and back
2. Identify the middleware execution order (global first, then per-route)
3. Recognize the pattern for both GET and POST handlers

</div>

## Summary: The Request Lifecycle

Every API request in the ODH Dashboard follows this lifecycle:

| Step | Layer | What Happens |
|------|-------|------|
| 1 | **React** | Component calls `fetch('/package/api/v1/...')` |
| 2 | **Dev Server** | Proxies to backend (dev only) |
| 3 | **Dashboard pod** | kube-rbac-proxy authenticates; Fastify rewrites the path and proxies to the BFF |
| 4 | **BFF Global Middleware** | Extracts user identity from headers |
| 5 | **BFF Per-Route Middleware** | Validates namespace, checks RBAC via SAR/SSAR |
| 6 | **BFF Per-Route Middleware** | Creates service client, attaches to context |
| 7 | **BFF Handler** | Calls upstream service, shapes response |
| 8 | **BFF** | Returns JSON response |
| 9 | **Backend** | Passes response through to browser |
| 10 | **React** | Updates state, re-renders UI |

::: tip Key Takeaway
Every request follows the same path: React -> Backend -> BFF Middleware Chain -> BFF Handler -> Upstream Service. The middleware chain handles cross-cutting concerns (auth, RBAC, client creation) so your handler functions stay simple and focused on business logic. When you add a new endpoint, you choose which middleware to wrap it with and write a handler function -- that is it.
:::

::: info See Also
- [The Big Picture](./big-picture) -- How all the layers fit together architecturally
- [Directory Structure](./directory-structure) -- Where to find the middleware, handlers, and clients in the codebase
- [Middleware Chain (Deep Dive)](../deep-dive/middleware) -- Line-by-line walkthrough of real middleware code
- [Writing Handlers (Deep Dive)](../deep-dive/handlers) -- How to write your own BFF handler
:::
