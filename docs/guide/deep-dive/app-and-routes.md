# The App Struct & Routes

> **The application core** -- the `App` struct holds all dependencies and the `Routes()` method wires up every endpoint.

In Express, you create an app with `const app = express()`, attach middleware with `app.use()`, and define routes with `app.get()`. In the BFF, the `App` struct serves the same purpose. The difference is that every dependency is an explicit, visible field on the struct -- there's nothing hidden behind `require()` calls or module-level singletons.

When I first saw the `App` struct, I thought "this is just a class with extra steps." That's actually a pretty good mental model. It's a container for dependencies, and every handler method has access to it through the receiver.

## The Express Version

Let's start with what you already know. In Express, your app factory might look like this:

```typescript
import express from 'express';                     // Import Express
import cors from 'cors';                           // Import CORS middleware
import { createK8sClient } from './k8s';           // Import K8s client factory
import { createLlamaStackClient } from './llamastack'; // Import LlamaStack client factory

async function createApp(config: Config, logger: Logger) { // Factory function
  const app = express();                           // Create Express app

  // Wire up dependencies (hidden in closures)
  const k8sClient = config.mockK8s                 // Choose mock or real
    ? new MockK8sClient()                          // Mock client
    : await createK8sClient();                     // Real client

  // Attach middleware
  app.use(cors());                                 // CORS
  app.use(express.json());                         // Body parser
  app.use(authMiddleware(config));                  // Auth

  // Define routes (dependencies accessed via closure)
  app.get('/api/v1/secrets', async (req, res) => { // Route handler
    const secrets = await k8sClient.getSecrets(req.query.namespace);
    res.json({ data: secrets });                   // Send response
  });

  return app;                                      // Return configured app
}
```

Now let's see the Go version. Same concepts, different syntax.

## The App Struct -- Your Dependency Container

Every BFF has an `App` struct in `internal/api/app.go`. It holds everything the application needs:

```go
// packages/gen-ai/bff/internal/api/app.go (trimmed)
type App struct {                                  // The App struct -- like a class that holds all dependencies
    config                  config.EnvConfig       // Application configuration (port, auth method, etc.)
    logger                  *slog.Logger           // Structured logger (like pino)
    repositories            *repositories.Repositories          // Business logic layer
    openAPI                 *OpenAPIHandler        // Serves /openapi.json and Swagger UI
    kubernetesClientFactory k8s.KubernetesClientFactory         // Creates per-request K8s clients
    llamaStackClientFactory llamastack.LlamaStackClientFactory  // Creates LlamaStack clients
    mcpClientFactory        mcp.MCPClientFactory   // Creates MCP clients
    mlflowClientFactory     mlflowpkg.MLflowClientFactory       // Creates MLflow clients
    bffClientFactory        bffclient.BFFClientFactory          // Calls other BFFs (MaaS, MLflow)
    rootCAs                 *x509.CertPool         // TLS certificate pool for upstream HTTPS calls
    // ... nemoClientFactory, httpClient, memoryStore, dashboardNamespace, sandbox state ...
    cleanupFuncs            []func()               // Shutdown callbacks for mock processes
}
```

Every field is a dependency that handlers might need. There are no globals, no singletons hidden behind `require()` calls. If a handler needs a Kubernetes client, it gets it through `app.kubernetesClientFactory`. If it needs to log, it uses `app.logger`. Everything is explicit.

::: info Trimmed, and Different in Every BFF
The struct above is gen-ai's, with some fields omitted. Every BFF has a different set depending on the services it integrates with. automl and autorag look quite different: since moving their K8s, pipelines and S3 code into the shared `packages/autox-core/services` module, their `App` holds `k8sService kubernetes.Service`, a `mw *Middleware` (namespace extraction and RBAC), and per-domain handler groups (`pipelines *PipelinesHandler`, `k8s *K8sHandler`, `s3 *S3Handler`, `modelRegistry *ModelRegistryHandler`) instead of client factories. Always check the actual `internal/api/app.go` in the BFF you are working on.
:::

**TypeScript equivalent:**

```typescript
class App {                                        // Same concept as a class
  constructor(
    private config: EnvConfig,                     // Configuration
    private logger: Logger,                        // Logger
    private k8sClientFactory: KubernetesClientFactory,     // K8s clients
    private llamaStackClientFactory: LlamaStackClientFactory, // LlamaStack clients
    private bffClientFactory: BFFClientFactory,    // Other BFFs
    private repositories: Repositories,            // Business logic
  ) {}
}
```

The key difference: Go doesn't have classes, so `App` is a **struct** with methods attached to it. The fields are lowercase (unexported), meaning only code within the `api` package can access them directly. Handlers are methods on `App`, so they naturally have access -- just like private fields in a TypeScript class.

## NewApp() -- The Factory Function

`NewApp()` creates and initializes the `App`. This is where mock-vs-real decisions happen. Let's build it up piece by piece.

First, the function signature:

```go
func NewApp(cfg config.EnvConfig, logger *slog.Logger) (*App, error) {
    // NewApp takes config and a logger, returns a pointer to an App (or an error)
    // The (*App, error) return type is Go's way of saying "this might fail"
```

Now the Kubernetes client factory -- the most important dependency:

```go
    var k8sFactory k8s.KubernetesClientFactory     // Declare the variable (nil initially)

    if cfg.MockK8sClient {                         // Check the --mock-k8s-client flag
        logger.Info("Using mocked Kubernetes client") // Log which mode we're in
        ctx, cancel := context.WithCancel(context.Background())
        // envtest spins up a real kube-apiserver + etcd locally, seeded with test users
        testEnvState, ctrlClient, err := k8smocks.SetupEnvTest(k8smocks.TestEnvInput{
            Users:  k8smocks.DefaultTestUsers,
            Logger: logger,
            Ctx:    ctx,
            Cancel: cancel,
        })
        if err != nil {
            cancel()
            return nil, fmt.Errorf("failed to setup envtest: %w", err)
        }
        cleanupFuncs = append(cleanupFuncs, func() { // Register teardown for Shutdown()
            k8smocks.CleanupTestEnvState(testEnvState, /* error and info loggers */)
        })
        k8sFactory, err = k8smocks.NewMockedKubernetesClientFactory( // Create mock factory
            ctrlClient, testEnvState, cfg, logger)
        // ... (error handling trimmed)
    } else {                                       // Real mode -- connect to actual cluster
        k8sFactory, err = k8s.NewKubernetesClientFactory(cfg, logger, rootCAs) // Real factory
    }
    if err != nil {                                // Check if either path failed
        return nil, fmt.Errorf("failed to create Kubernetes client factory: %w", err)
    }
```

The mock-or-real decision flows from the config flag. If `--mock-k8s-client` is set, we spin up a local Kubernetes API server using Go's `envtest` framework. If not, we connect to the real cluster. The handler code never knows or cares which one it got -- that's the power of the factory pattern.

The same pattern repeats for every other dependency:

```go
    // Same mock-or-real pattern for LlamaStack clients
    var llamaStackClientFactory llamastack.LlamaStackClientFactory // Declare
    if cfg.MockLSClient {                          // Check the --mock-ls-client flag
        llamaStackClientFactory = lsmocks.NewMockClientFactory() // Use mock
    } else {                                       // Real mode
        llamaStackClientFactory = llamastack.NewRealClientFactory() // Use real
    }
```

Finally, assemble and return the App:

```go
    app := &App{                                   // Create the App struct
        config:                  cfg,              // Store the config
        logger:                  logger,           // Store the logger
        repositories:            repositories.NewRepositoriesWithMCP(mcpFactory, logger),
        kubernetesClientFactory: k8sFactory,       // Store the K8s factory (real or mock)
        llamaStackClientFactory: llamaStackClientFactory,
        bffClientFactory:        bffFactory,
        rootCAs:                 rootCAs,
        cleanupFuncs:            cleanupFuncs,     // Teardown callbacks collected above
        // ... other fields ...
    }
    return app, nil                                // nil means "no error"
}
```

**TypeScript equivalent:**

```typescript
async function createApp(config: EnvConfig, logger: Logger): Promise<App> {
  const k8sFactory = config.mockK8sClient          // Same mock-or-real pattern
    ? new MockK8sClientFactory()                   // Mock
    : await RealK8sClientFactory.create();         // Real

  const llamaStackFactory = config.mockLSClient    // Same pattern
    ? new MockLlamaStackFactory()                  // Mock
    : new RealLlamaStackFactory();                 // Real

  return new App(config, logger, k8sFactory, llamaStackFactory); // Assemble
}
```

::: info Checkpoint
We now understand the `App` struct (dependency container) and `NewApp()` (factory that wires real or mock dependencies). Next: how routes are defined.
:::

## The Routes() Method -- Wiring Up Endpoints

The `Routes()` method is where all HTTP routes are registered. It returns an `http.Handler` -- Go's standard interface for anything that can handle HTTP requests. Let's build it up from the simplest possible route.

### Start with Just a Health Check

```go
func (app *App) Routes() http.Handler {            // Method on App that returns an HTTP handler
                                                   // This is like building your Express router
    router := httprouter.New()                     // Create a new router (like express.Router())
    router.GET("/healthcheck",                     // Register GET /healthcheck
        app.HealthcheckHandler)                    // Point it to the handler method

    return router                                  // Return as an http.Handler
}
```

The BFFs use [`julienschmidt/httprouter`](https://github.com/julienschmidt/httprouter), a fast HTTP router for Go. It's like a minimal Express Router. That `(app *App)` before `Routes` means this is a method on the `App` struct -- every handler can access `app.logger`, `app.config`, etc.

### Add an API Route

Now let's add a real API route:

```go
func (app *App) Routes() http.Handler {            // Same method, building up
    router := httprouter.New()                     // Create router
    router.GET("/healthcheck", app.HealthcheckHandler) // Health check (no auth needed)

    router.GET("/api/v1/user", app.GetCurrentUserHandler) // Add user endpoint
    router.GET("/api/v1/namespaces",               // Add namespaces endpoint
        app.GetNamespaceHandler)                   // Direct handler, no middleware needed

    return router                                  // Return configured router
}
```

**TypeScript equivalent so far:**

```typescript
const router = express.Router();                   // Create router
router.get('/healthcheck', healthcheckHandler);    // Health check
router.get('/api/v1/user', userHandler);           // User endpoint
router.get('/api/v1/namespaces', getNamespaceHandler); // Namespaces
```

Almost identical syntax. URL parameters use `:paramName` just like Express. You read them with `ps.ByName("id")` in the handler.

### Add a Route with Middleware

Here's where it gets interesting. Some routes need middleware -- to extract the namespace, check permissions, or create a client:

```go
    router.GET("/api/v1/lsd/status",               // GET /api/v1/lsd/status (constants.OGXServerStatusPath)
        app.AttachNamespace(                       // Middleware: extract namespace from query params
            app.LlamaStackDistributionStatusHandler)) // Handler: report the OGX server status
```

`AttachNamespace` is a middleware function that wraps the handler. It extracts the namespace from the query string, validates it, and puts it in the request context. Only then does it call the handler. If the namespace is missing, it returns a 400 error and the handler never runs.

Now let's see a route with the full middleware chain:

```go
    // packages/gen-ai/bff/internal/api/app.go
    apiRouter.GET(constants.ModelsListPath,        // GET /api/v1/lsd/models
        app.AttachNamespace(                       // 1st: extract the namespace
            app.RequireAccessToService(            // 2nd: check RBAC permissions via SSAR
                app.AttachOGXClient(               // 3rd: find the OGX server, create the client
                    app.LlamaStackModelsHandler)))) // 4th: the actual handler
```

### The Inside-Out Reading Pattern

**Read it inside-out.** The innermost function is the actual handler. Each layer wrapping it is middleware that runs *before* the handler:

```
AttachNamespace → RequireAccess → AttachClient → Handler
       1st             2nd           3rd          4th
```

If any middleware fails (missing namespace, permission denied, no OGX server found), it writes an error response and **never calls the next function**.

**TypeScript equivalent (Express):**

```typescript
// Express middleware reads left-to-right
router.get('/api/v1/lsd/models',                   // Same route
  attachNamespace,                                 // 1st middleware
  requireAccessToService,                          // 2nd middleware
  attachOGXClient,                                 // 3rd middleware
  llamaStackModelsHandler                          // handler
);
```

The execution order is the same -- namespace first, then access check, then client, then handler. Only the direction of reading is reversed: Express reads left-to-right, Go reads inside-out.

::: tip Visual Aid -- The Middleware Wrapping
Think of it like nesting function calls:
```
AttachNamespace(
  RequireAccess(
    AttachClient(
      Handler  <-- this runs last
    )          <-- this runs 3rd
  )            <-- this runs 2nd
)              <-- this runs 1st
```
Each outer function decides whether to call the inner one. If it doesn't, the chain stops.
:::

### The Full Routes() Method

::: info Trimmed from gen-ai
The `Routes()` method below is gen-ai's (`packages/gen-ai/bff/internal/api/app.go`) with most routes removed. The structure is the same across BFFs -- only the specific routes, middleware names and the extras (OpenAPI, OpenTelemetry) differ.
:::

Here's the complete picture. Before diving into the code, look at how the routing tree is structured -- which requests go where and what middleware applies at each level:

```
                        combinedMux (top-level splitter)
                ┌──────────────┬──────────────────────────┐
                │              │                          │
       /healthcheck    /openapi*, /swagger-ui        / (everything else)
                │       (no auth, no CORS,                │
      RecoverPanic      served directly)            otelhttp (OpenTelemetry span)
      EnableTelemetry                               RecoverPanic
      (no auth, no CORS)                            EnableTelemetry
                │                                   EnableCORS
                │                                   InjectRequestIdentity
      healthcheckRouter                                   │
      GET /healthcheck                                 appMux
                                    ┌─────────────────────┼──────────────┐
                           /gen-ai/api/v1/*          /api/v1/*      /* (catch-all)
                           MaxBodySize               MaxBodySize    (static files +
                           StripPrefix("/gen-ai")        │           index.html SPA)
                                    └──────────┬─────────┘
                                           apiRouter
                                 ┌─────────────┼──────────────────┐
                                 │             │                  │
                          /api/v1/user  /api/v1/lsd/status  /api/v1/lsd/models
                          (no extra     AttachNamespace     AttachNamespace
                           middleware)                      RequireAccessToService
                                                            AttachOGXClient
```

Three key things to notice: (1) healthcheck gets minimal middleware (no auth) because K8s probes need to reach it without credentials, (2) OpenAPI spec and Swagger UI routes are also public (no auth) so tooling can discover the API schema without credentials, and (3) API routes get the full stack, then each individual route adds its own middleware on top.

Now the code that builds this tree:

```go
func (app *App) Routes() http.Handler {            // Build the complete routing tree

    // API router -- handles all /api/v1/* routes
    apiRouter := httprouter.New()                   // Create the API router

    apiRouter.NotFound = http.HandlerFunc(          // Custom 404 handler
        app.notFoundResponse)                      // Returns JSON error, not HTML
    apiRouter.MethodNotAllowed = http.HandlerFunc(  // Custom 405 handler
        app.methodNotAllowedResponse)              // Returns JSON error, not HTML

    // Register routes with their middleware chains (a handful of many)
    apiRouter.GET(constants.UserPath,               // /api/v1/user -- no extra middleware
        app.GetCurrentUserHandler)
    apiRouter.GET(constants.NamespacesPath,         // /api/v1/namespaces
        app.GetNamespaceHandler)
    apiRouter.GET(constants.OGXServerStatusPath,    // /api/v1/lsd/status (needs namespace)
        app.AttachNamespace(app.LlamaStackDistributionStatusHandler))
    apiRouter.GET(constants.ModelsListPath,         // /api/v1/lsd/models (full chain)
        app.AttachNamespace(
            app.RequireAccessToService(
                app.AttachOGXClient(
                    app.LlamaStackModelsHandler))))

    // Mount the API router and static file server under appMux
    appMux := http.NewServeMux()                   // Standard library multiplexer

    // /gen-ai/api/v1/* → strip "/gen-ai", then the same apiRouter
    appMux.Handle(constants.PathPrefix+constants.ApiPathPrefix+"/",
        app.MaxBodySize(http.StripPrefix(constants.PathPrefix, apiRouter)))
    // /api/v1/* → apiRouter directly
    appMux.Handle(constants.ApiPathPrefix+"/", app.MaxBodySize(apiRouter))

    staticDir := http.Dir(app.config.StaticAssetsDir)
    fileServer := http.FileServer(staticDir)
    appMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        // (trimmed: API-looking paths that got here return 404)
        cleanPath := path.Clean(r.URL.Path)
        if f, err := staticDir.Open(cleanPath); err == nil { // A real file (JS, CSS, images)?
            f.Close()
            w.Header().Set("Cache-Control", cacheControlForStaticFile(cleanPath))
            fileServer.ServeHTTP(w, r)             // Serve it
            return
        }
        // Not a file → serve index.html so React Router can handle the path
        w.Header().Set("Cache-Control", "no-cache")
        http.ServeFile(w, r, path.Join(app.config.StaticAssetsDir, "index.html"))
    })
    // Without this fallback, GET / or GET /gen-ai-studio/playground would 404
    // because apiRouter only knows about /api/v1/* routes

    // Health check gets its own router (no auth required!)
    healthcheckMux := http.NewServeMux()
    healthcheckRouter := httprouter.New()           // Separate router for health check
    healthcheckRouter.GET(constants.HealthCheckPath, // K8s probes hit this endpoint
        app.HealthcheckHandler)
    healthcheckMux.Handle(constants.HealthCheckPath, // Minimal middleware: panic recovery
        app.RecoverPanic(app.EnableTelemetry(healthcheckRouter))) // and telemetry only

    // Combine everything with global middleware
    combinedMux := http.NewServeMux()              // Top-level multiplexer
    combinedMux.Handle(constants.HealthCheckPath, healthcheckMux)

    // OpenAPI routes (public -- no auth required)
    combinedMux.HandleFunc(constants.OpenAPIPath, app.openAPI.HandleOpenAPIRedirectWrapper)
    combinedMux.HandleFunc(constants.OpenAPIJSONPath, app.openAPI.HandleOpenAPIJSONWrapper)
    combinedMux.HandleFunc(constants.OpenAPIYAMLPath, app.openAPI.HandleOpenAPIYAMLWrapper)
    combinedMux.HandleFunc(constants.SwaggerUIPath, app.openAPI.HandleSwaggerUIWrapper)

    combinedMux.Handle("/", otelhttp.NewHandler(   // 0. OpenTelemetry span per request
        app.RecoverPanic(                          // 1. Catch panics → 500
            app.EnableTelemetry(                   // 2. Add trace ID to logs
                app.EnableCORS(                    // 3. Handle CORS headers
                    app.InjectRequestIdentity(     // 4. Extract user identity
                        appMux)))),                // Routes live here
        "gen-ai-bff",
        otelhttp.WithFilter(shouldTraceRequest),
        otelhttp.WithSpanNameFormatter(bffSpanName),
    ))

    return combinedMux                             // Return the fully-configured handler
}
```

There is a lot going on, so let me highlight the key decisions:

1. **Two separate routers**: The health check has minimal middleware (no auth, no CORS) because Kubernetes probes need to hit it without authentication.

2. **Public OpenAPI routes**: The `/openapi.*` and `/swagger-ui` paths are registered directly on `combinedMux` with no auth middleware. This lets API tooling discover the schema without credentials. (The [Core BFF](/guide/core-bff/architecture) registers its Swagger UI and redirect routes only in dev mode.)

3. **The double mount**: the same `apiRouter` is reachable as `/api/v1/*` (standalone, or when the [core-bff front door](/guide/core-bff/architecture) proxies to the pod) and as `/gen-ai/api/v1/*` (federated, behind the module's path prefix). `http.StripPrefix` removes `/gen-ai` first, so route patterns are always written as `/api/v1/...`. `MaxBodySize` caps request bodies (`http.MaxBytesHandler` with `constants.DefaultMaxBodySize`).

4. **Global middleware** wraps everything under `/`: `otelhttp.NewHandler` opens an OpenTelemetry span, `RecoverPanic` catches panics (like uncaught exceptions), `EnableTelemetry` adds trace IDs, `EnableCORS` handles CORS headers, and `InjectRequestIdentity` extracts the user.

5. **Route-level middleware** is applied per-route: `AttachNamespace`, `RequireAccessToService`, `AttachOGXClient` only run on routes that need them.

automl and autorag follow the same skeleton with two differences: route middleware hangs off `app.mw` (`app.mw.AttachNamespace(app.mw.RequireAccessToService(app.pipelines.PipelineRunsHandler))`), and `InjectRequestIdentity` wraps only the API mounts rather than the whole `/` chain.

The Express equivalent uses `app.use()` for global middleware and per-route middleware arrays for route-level middleware. The execution order is the same; only the reading direction differs (left-to-right in Express vs. inside-out in Go).

::: warning Common Mistake
Don't confuse `http.NewServeMux()` with `httprouter.New()`. The standard library's `ServeMux` is used for top-level path routing (healthcheck vs API vs static files), while `httprouter` handles the detailed API routing with URL parameters. They compose together: the `ServeMux` delegates to the `httprouter` for `/api/v1/*` and `/gen-ai/api/v1/*` paths.

One subtle `ServeMux` rule: a **trailing slash** changes the matching behavior. `"/healthcheck"` matches only that exact path. `"/api/"` (with trailing slash) matches anything starting with `/api/` -- like a prefix. `"/"` catches everything else as a fallback.
:::

## The Shutdown Method

The `App` also has a `Shutdown()` method for cleaning up resources. The gen-ai BFF uses a `cleanupFuncs` pattern -- during `NewApp()`, each mock process (envtest, MLflow, LlamaStack) registers a cleanup callback, and `Shutdown()` runs them in reverse order (LIFO):

```go
func (app *App) Shutdown() error {                 // Called during graceful shutdown
    app.logger.Info("shutting down app...")         // Log that we're cleaning up
    // (trimmed: also stops the sandbox watcher goroutine)
    for i := len(app.cleanupFuncs) - 1; i >= 0; i-- { // Walk callbacks in reverse (LIFO)
        app.cleanupFuncs[i]()                      // Run each cleanup (stop envtest, MLflow, etc.)
    }
    return nil
}
```

This is called by the graceful shutdown code in `main.go`. In mock mode, the cleanup callbacks tear down in-memory services like the envtest Kubernetes API server and the MLflow mock server. In production, the slice is empty so the loop is a no-op.

::: info Core-BFF Variant
The core-bff uses a simpler approach -- it checks `app.testEnv` directly and also stops its WebSocket connection tracker (`app.wsTracker.Stop()`). The `cleanupFuncs` pattern is specific to gen-ai, which has more mock processes to manage. See [Core BFF architecture](/guide/core-bff/architecture) for what else lives in that App.
:::

::: info Checkpoint
The complete picture: `NewApp()` creates the dependency container with real or mock clients. `Routes()` wires up all endpoints with middleware chains. The health check bypasses auth. API routes get the full middleware stack. `Shutdown()` cleans up when the server stops.
:::

::: tip Key Takeaway
The `App` struct is your dependency container -- every client, factory, and service is an explicit field. `NewApp()` decides mock vs real based on config flags. `Routes()` wires up all endpoints with middleware chains that read inside-out: the innermost function is the handler, and each wrapper adds a layer of validation, auth, or client attachment. If any middleware fails, the chain stops and an error response is sent.
:::

::: info See Also
- [Writing Handlers](./handlers) -- what happens inside those handler functions
- [Middleware Chain](./middleware) -- deep dive into how each middleware works
- [Entry Point (main.go)](./entry-point) -- how `NewApp()` and `Routes()` get called
:::
