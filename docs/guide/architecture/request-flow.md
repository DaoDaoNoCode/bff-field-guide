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
  2.   |                      |-- validate auth --->|                      |
       |                      |   (check token)     |                      |
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
  6.   |                      |                     |-- find LlamaStack -->|
       |                      |                     |   distribution       |
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

**What just happened?** The `fetch()` call goes to a **relative URL**. The browser resolves this against the current page origin. In development, that is `https://localhost:4010`. In production, that is `https://dashboard.apps.cluster.example.com`. The React code does not know or care which one -- it works identically in both environments.

::: info Why Relative URLs?
Using relative URLs like `/gen-ai/api/...` instead of absolute URLs like `http://localhost:8080/api/...` means the same React code works in development, production, and testing without any configuration changes. The browser always sends the request to whatever origin served the page.
:::

## Layer 2: Frontend Dev Server Proxies the Request (Dev Only)

In development, the request first hits the Webpack dev server on `:4010`. The dev server's proxy configuration matches the path and forwards the request to the Fastify backend:

```
What the browser sends:                                          
  GET https://localhost:4010/gen-ai/api/v1/lsd/models?namespace=my-proj

What the dev server does:                                        
  Matches /gen-ai/api/* against its proxy rules                  
  Forwards to -> http://localhost:8080/gen-ai/api/v1/lsd/models?namespace=my-proj

What changes:                                                    
  Only the host changes (4010 -> 8080). The path stays the same.
```

The dev server is a transparent proxy. It does not modify the request path or body -- it just forwards the request to the backend on `:8080`. In production, this layer does not exist; the browser talks directly to the backend.

## Layer 3: Backend Validates Auth and Proxies to BFF

The Fastify backend receives the request and does three things. Let us walk through each one:

### 3a. Authenticate the User

The backend checks the request for a valid OpenShift OAuth token. This token was set during the user's login flow (OpenShift OAuth proxy) and is sent as a cookie or `Authorization` header:

```
The backend reads:
  Cookie: _oauth_proxy=<encrypted-session-cookie>      <- set by OpenShift OAuth proxy during login
  -- or --
  Authorization: Bearer <user's-openshift-token>       <- raw OAuth token

The backend validates:
  Calls OpenShift API to verify the token is valid     <- server-side token validation
  Extracts the user's identity (username, groups)      <- who is this user?
  
If invalid:
  Returns HTTP 401 Unauthorized                        <- browser redirects to login page
```

### 3b. Match the BFF Route

The backend's Module Federation proxy matches the path `/gen-ai/api/*` against the registered proxy rules. It knows from the gen-ai package's `package.json` configuration that:

```json
{
  "proxy": [{                          
    "path": "/gen-ai/api",             // match requests starting with this path
    "pathRewrite": "/api"              // replace /gen-ai/api with /api
  }]
}
```

### 3c. Forward to the BFF

The backend proxies the request to the BFF, rewriting the path and forwarding critical headers:

```
Incoming path:     GET /gen-ai/api/v1/lsd/models?namespace=my-proj    <- what the backend received
Rewritten path:    GET /api/v1/lsd/models?namespace=my-proj           <- /gen-ai/api stripped to /api

Forwarded to:      http://gen-ai-bff:8080/api/v1/lsd/models?namespace=my-proj

Headers forwarded:                                                     
  Authorization: Bearer <user's OpenShift token>                       <- raw token for upstream calls
  kubeflow-userid: user@example.com                                    <- extracted username (when using internal auth)
  kubeflow-groups: system:authenticated,my-team                        <- extracted groups (when using internal auth)
```

Three things happened at the backend layer. It validated the user's identity, rewrote the URL path (stripping the `/gen-ai/api` prefix to just `/api`), and forwarded the request to the Go BFF with auth headers the BFF can read.

::: warning The Path Rewrite Matters
The path the browser sees (`/gen-ai/api/v1/models`) is different from the path the BFF receives (`/api/v1/models`). When you write BFF route handlers, register paths starting with `/api/...`, not `/gen-ai/api/...`. This is a common source of confusion for newcomers.
:::

<div class="checkpoint">

#### Checkpoint

We have traced the request from the browser through the dev server and backend. At this point:
- The browser made a simple `fetch()` call to a relative URL
- The dev server proxied it to the backend (dev only)
- The backend validated the OAuth token and extracted the user's identity
- The backend rewrote the path and forwarded to the BFF with auth headers

Now the request enters the Go BFF. This is where things get interesting.

</div>

## Layer 4: BFF Global Middleware -- InjectRequestIdentity

The request arrives at the Gen AI BFF (a Go HTTP server). Before it reaches the handler function, it passes through middleware. The first middleware is **global** -- it runs on every single request, including healthchecks.

The global middleware chain wraps the entire router:

```go
// From internal/api/app.go -- the Routes() method
// Read from inside out: router is wrapped by InjectRequestIdentity,
// then EnableCORS, then EnableTelemetry, then RecoverPanic.
return app.RecoverPanic(           // outermost: catches panics so the server doesn't crash
    app.EnableTelemetry(           // adds request logging and metrics
        app.EnableCORS(            // adds CORS headers for cross-origin requests
            app.InjectRequestIdentity( // innermost global: extracts user identity
                router))))         // the actual router with all registered routes
```

The middleware chain runs outermost-first: `RecoverPanic` -> `EnableTelemetry` -> `EnableCORS` -> `InjectRequestIdentity` -> router. Each middleware wraps the next one.

::: warning RequestIdentity Differs Between BFFs
The `RequestIdentity` struct differs between BFFs. The automl/maas BFFs store `UserID`, `Groups`, and `Token`. The gen-ai BFF only stores `Token` and `MCPToken`. The example below uses the automl/maas pattern -- check your specific BFF's `internal/integrations/kubernetes/types.go` for the actual fields.
:::

Now let us look at `InjectRequestIdentity`, the middleware that extracts who the user is:

```go
// Simplified from internal/api/middleware.go (automl/maas pattern -- gen-ai BFF differs)
func (app *App) InjectRequestIdentity(next http.Handler) http.Handler {  // wraps the entire router
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { // returns a new handler
        userID := r.Header.Get("kubeflow-userid")      // read the username header set by the backend
        groups := r.Header.Get("kubeflow-groups")      // read the groups header set by the backend
        token := r.Header.Get("Authorization")         // read the raw OAuth token

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
`InjectRequestIdentity` is a **global middleware** that wraps the entire router as an `http.Handler`. It runs on every request. This is different from per-route middleware like `AttachNamespace` and `RequireAccessToService`, which wrap individual `httprouter.Handle` functions and are composed per-endpoint. We will see those next.
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
            app.forbiddenResponse(w, r)             // return 403 Forbidden
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
2. **Backend** validated auth, rewrote the path, forwarded to the BFF
3. **BFF middleware** extracted identity, validated namespace, checked RBAC, and created the service client
4. **BFF handler** called the upstream service and returned JSON

</div>

## The Authentication Flow in Detail

Now let us zoom in on how authentication works at each layer. This is one of the trickiest parts to understand because the user's identity is transformed multiple times as it passes through the system.

```
+-- User's Browser -----------------------------------------------+
|                                                                  |
|  1. User visits dashboard URL                                    |
|  2. OpenShift OAuth Proxy intercepts (no valid session)          |
|  3. Redirects to OpenShift login page                            |
|  4. User enters credentials                                     |
|  5. OpenShift issues OAuth token                                 |
|  6. OAuth Proxy sets session cookie + forwards token             |
|                                                                  |
+------------------------------------------------------------------+
                              |
                    Token in Authorization header         <- browser sends this on every request
                    or session cookie
                              |
                              v
+-- Fastify Backend -------------------------------------------+
|                                                              |
|  7. Extracts token from cookie or Authorization header       |
|  8. Validates token against OpenShift API                    |
|  9. Extracts user identity (username, groups)                |
| 10. Sets identity headers (kubeflow-userid, kubeflow-groups) |
| 11. Forwards request + all headers to BFF                    |
|                                                              |
+--------------------------------------------------------------+
                              |
                    Authorization: Bearer <token>           <- raw token for upstream calls
                    kubeflow-userid: user@example.com       <- extracted username (internal auth)
                    kubeflow-groups: system:authenticated    <- extracted groups (internal auth)
                              |
                              v
+-- BFF (Go) --------------------------------------------------+
|                                                              |
| 12. InjectRequestIdentity middleware reads headers           |
| 13. Auth method determines which headers to trust:           |
|     - "internal": reads kubeflow-userid + kubeflow-groups    |
|     - "user_token": reads Authorization bearer token         |
|     - "disabled": no auth (mock/testing only)                |
| 14. Identity stored in request context                       |
| 15. SAR/SSAR uses the token for K8s permission checks        |
|                                                              |
+--------------------------------------------------------------+
```

**What just happened?** The user's identity starts as login credentials, becomes an OAuth token, gets validated by the backend, is decomposed into username/groups headers, and finally gets reassembled by the BFF into a `RequestIdentity` struct. The raw token also travels through so the BFF can use it for Kubernetes API calls and upstream service authentication.

::: tip Auth Methods Vary by BFF
BFFs support up to three authentication methods, configured by the `--auth-method` flag. Not every BFF supports all three:

- **`internal`** -- reads identity from `kubeflow-userid` and `kubeflow-groups` headers (automl, maas, autorag, model-registry)
- **`user_token`** -- reads the raw `Authorization: Bearer` token (gen-ai, eval-hub, mlflow, and most others)
- **`disabled`** -- skips auth entirely (automl, autorag, eval-hub, gen-ai -- useful for local dev with mocks)

The default also varies: gen-ai defaults to `user_token`, while automl/autorag default to `internal`. Always check the specific BFF's `cmd/main.go` for the supported methods and default.
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

// The full chain for this request, including global middleware:
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
Backend:  Validates auth token (OK), proxies to BFF                <- auth passes, but RBAC might not
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

Let us trace a write operation to see how POST requests differ. A user creates a new MCP server connection in the Gen AI playground:

```
Browser sends:
  POST /gen-ai/api/v1/mcps?namespace=my-proj           <- POST instead of GET
  Content-Type: application/json                        <- sending JSON in the request body
  {
    "name": "my-mcp-server",                            <- the MCP server name
    "url": "https://mcp.example.com",                   <- the MCP server URL
    "tools": ["search", "calculate"]                    <- tools this server provides
  }
```

The request flows through the same layers: dev server proxy, backend auth and path rewrite, BFF global middleware, per-route middleware. The handler is slightly different because it reads a request body:

```go
// Simplified from a POST handler
func (app *App) CreateMCPServerHandler(
    w http.ResponseWriter,             // response writer
    r *http.Request,                   // incoming request (has a body this time)
    ps httprouter.Params,              // URL path parameters
) {
    var input CreateMCPRequest                          // declare a struct to hold the request body
    err := json.NewDecoder(r.Body).Decode(&input)       // parse JSON body into the struct
    if err != nil {                                     // if the JSON is malformed
        app.badRequestResponse(w, r, err)               // return 400 Bad Request
        return                                          // stop processing
    }

    if input.Name == "" {                               // validate required fields
        app.badRequestResponse(w, r,                    // return 400 if name is missing
            errors.New("name is required"))
        return                                          // stop processing
    }

    namespace := getNamespace(r.Context())              // get namespace from context (set by middleware)
    result, err := app.kubeClient.CreateMCPServer(      // create the K8s resource
        namespace, input)
    if err != nil {                                     // if the K8s create call failed
        app.serverErrorResponse(w, r, err)              // return 500 Internal Server Error
        return                                          // stop processing
    }

    app.WriteJSON(w, http.StatusCreated, result, nil)   // return 201 Created with the new resource
}
```

The pattern is the same as GET requests: middleware handles auth and permissions, the handler handles business logic. The only differences for POST are: (1) the handler reads and validates a request body, and (2) it returns 201 Created instead of 200 OK.

The response:

```json
{
  "name": "my-mcp-server",            // the name the user provided
  "url": "https://mcp.example.com",   // the URL the user provided
  "status": "pending"                  // initial status set by the BFF
}
```

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
| 3 | **Backend** | Validates OAuth token, rewrites path, proxies to BFF |
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
