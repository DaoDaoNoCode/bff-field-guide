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
import { createPipelineClient } from './pipeline'; // Import pipeline client factory

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
type App struct {                                  // The App struct -- like a class that holds all dependencies
    config                        config.EnvConfig // Application configuration (port, auth method, etc.)
    logger                        *slog.Logger     // Structured logger (like pino)
    kubernetesClientFactory       kubernetes.KubernetesClientFactory  // Creates K8s clients
    pipelineServerClientFactory   pipelineserver.PipelineServerClientFactory // Creates pipeline clients
    s3ClientFactory               s3.S3ClientFactory                 // Creates S3 clients
    repositories                  *repositories.Repositories         // Business logic layer
    rootCAs                       *x509.CertPool   // TLS certificate pool for upstream HTTPS calls
}
```

**What just happened?** Every field is a dependency that handlers might need. There are no globals, no singletons hidden behind `require()` calls. If a handler needs a Kubernetes client, it gets it through `app.kubernetesClientFactory`. If it needs to log, it uses `app.logger`. Everything is explicit.

::: info Simplified Composite
The `App` struct shown above is a simplified composite that blends fields from the automl BFF (e.g., `pipelineServerClientFactory`, `s3ClientFactory`, `repositories`) with gen-ai fields. No single BFF has exactly this set of fields. Real BFFs have many more fields depending on the services they integrate with. For example, gen-ai has `llamaStackClientFactory`, `mcpClientFactory`, `mlflowClientFactory`, `bffClientFactory`, `memoryStore`, and others. Always check the actual `internal/api/app.go` in the BFF you are working on.
:::

**TypeScript equivalent:**

```typescript
class App {                                        // Same concept as a class
  constructor(
    private config: EnvConfig,                     // Configuration
    private logger: Logger,                        // Logger
    private k8sClientFactory: KubernetesClientFactory,     // K8s clients
    private pipelineClientFactory: PipelineServerClientFactory, // Pipeline clients
    private s3Factory: S3ClientFactory,            // S3 clients
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
    var k8sFactory kubernetes.KubernetesClientFactory // Declare the variable (nil initially)

    if cfg.MockK8sClient {                         // Check the --mock-k8s-client flag
        logger.Info("Using mocked Kubernetes client") // Log which mode we're in
        // envtest spins up a lightweight, in-memory K8s API server
        testEnv, clientset, err := k8smocks.SetupEnvTest(/* ... */) // Start mock K8s
        if err != nil {                            // Check for setup failure
            return nil, fmt.Errorf("failed to setup envtest: %w", err) // Return error
        }
        k8sFactory, err = k8smocks.NewMockedKubernetesClientFactory( // Create mock factory
            clientset, testEnv, cfg, logger,       // Pass mock K8s resources and config
        )
    } else {                                       // Real mode -- connect to actual cluster
        k8sFactory, err = kubernetes.NewKubernetesClientFactory(cfg, logger) // Real factory
    }
    if err != nil {                                // Check if either path failed
        return nil, fmt.Errorf("failed to create K8s client: %w", err) // Return error
    }
```

**What just happened?** The `--mock-k8s-client` flag flows from the entry point through config into `NewApp()`. If it's set, we spin up an in-memory Kubernetes API server using Go's `envtest` framework. If not, we connect to the real cluster. The handler code never knows or cares which one it got -- that's the power of the factory pattern.

The same pattern repeats for every other dependency:

```go
    // Same mock-or-real pattern for pipeline server clients
    var pipelineClientFactory pipelineserver.PipelineServerClientFactory // Declare
    if cfg.MockPipelineServerClient {              // Check the flag
        pipelineClientFactory = psmocks.NewMockClientFactory() // Use mock
    } else {                                       // Real mode
        pipelineClientFactory = pipelineserver.NewRealClientFactory() // Use real
    }
```

Finally, assemble and return the App:

```go
    return &App{                                   // Create and return the App struct
        config:                      cfg,          // Store the config
        logger:                      logger,       // Store the logger
        kubernetesClientFactory:     k8sFactory,   // Store the K8s factory (real or mock)
        pipelineServerClientFactory: pipelineClientFactory, // Store the pipeline factory
        repositories:                repositories.NewRepositories(logger), // Create the business logic layer
    }, nil                                         // nil means "no error"
}
```

**TypeScript equivalent:**

```typescript
async function createApp(config: EnvConfig, logger: Logger): Promise<App> {
  const k8sFactory = config.mockK8sClient          // Same mock-or-real pattern
    ? new MockK8sClientFactory()                   // Mock
    : await RealK8sClientFactory.create();         // Real

  const pipelineFactory = config.mockPipelineServer // Same pattern
    ? new MockPipelineFactory()                    // Mock
    : new RealPipelineFactory();                   // Real

  return new App(config, logger, k8sFactory, pipelineFactory); // Assemble
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

**What just happened?** The BFFs use [`julienschmidt/httprouter`](https://github.com/julienschmidt/httprouter), a fast HTTP router for Go. It's like a minimal Express Router. That `(app *App)` before `Routes` means this is a method on the `App` struct -- every handler can access `app.logger`, `app.config`, etc.

### Add an API Route

Now let's add a real API route:

```go
func (app *App) Routes() http.Handler {            // Same method, building up
    router := httprouter.New()                     // Create router
    router.GET("/healthcheck", app.HealthcheckHandler) // Health check (no auth needed)

    router.GET("/api/v1/user", app.UserHandler)    // Add user endpoint
    router.GET("/api/v1/namespaces",               // Add namespaces endpoint
        app.GetNamespacesHandler)                   // Direct handler, no middleware needed

    return router                                  // Return configured router
}
```

**TypeScript equivalent so far:**

```typescript
const router = express.Router();                   // Create router
router.get('/healthcheck', healthcheckHandler);    // Health check
router.get('/api/v1/user', userHandler);           // User endpoint
router.get('/api/v1/namespaces', getNamespacesHandler); // Namespaces
```

Almost identical syntax. URL parameters use `:paramName` just like Express. You read them with `ps.ByName("id")` in the handler.

### Add a Route with Middleware

Here's where it gets interesting. Some routes need middleware -- to extract the namespace, check permissions, or create a client:

```go
    router.GET("/api/v1/secrets",                  // GET /api/v1/secrets
        app.AttachNamespace(                       // Middleware: extract namespace from query params
            app.GetSecretsHandler))                // Handler: fetch and return secrets
```

**What just happened?** `AttachNamespace` is a middleware function that wraps `GetSecretsHandler`. It extracts the namespace from the query string, validates it, and puts it in the request context. Only then does it call the handler. If the namespace is missing, it returns a 400 error and the handler never runs.

Now let's see a route with the full middleware chain:

```go
    router.GET("/api/v1/pipeline-runs",            // GET /api/v1/pipeline-runs
        app.AttachNamespace(                       // 1st: extract and validate namespace
            app.RequireAccessToPipelineServers(    // 2nd: check RBAC permissions via SAR
                app.AttachPipelineServerClient(    // 3rd: discover service, create HTTP client
                    app.PipelineRunsHandler))))     // 4th: the actual handler
```

### The Inside-Out Reading Pattern

**Read it inside-out.** The innermost function is the actual handler. Each layer wrapping it is middleware that runs *before* the handler:

```
AttachNamespace → RequireAccess → AttachClient → Handler
       1st             2nd           3rd          4th
```

If any middleware fails (invalid namespace, permission denied, no pipeline server found), it writes an error response and **never calls the next function**.

**TypeScript equivalent (Express):**

```typescript
// Express middleware reads left-to-right
router.get('/api/v1/pipeline-runs',                // Same route
  attachNamespace,                                 // 1st middleware
  requireAccessToPipelines,                        // 2nd middleware
  attachPipelineClient,                            // 3rd middleware
  pipelineRunsHandler                              // handler
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

::: info Composite Example
The `Routes()` method below is a composite that combines patterns from multiple BFFs (primarily automl for pipeline routes, gen-ai for global middleware). No single BFF has exactly this set of routes. The structure and middleware patterns are the same across all BFFs -- only the specific routes and middleware names differ.
:::

Here's the complete picture with global and route-level middleware:

```go
func (app *App) Routes() http.Handler {            // Build the complete routing tree

    // API router -- handles all /api/v1/* routes
    apiRouter := httprouter.New()                   // Create the API router

    apiRouter.NotFound = http.HandlerFunc(          // Custom 404 handler
        app.notFoundResponse)                      // Returns JSON error, not HTML
    apiRouter.MethodNotAllowed = http.HandlerFunc(  // Custom 405 handler
        app.methodNotAllowedResponse)              // Returns JSON error, not HTML

    // Register routes with their middleware chains
    apiRouter.GET("/api/v1/user", app.UserHandler)  // No extra middleware needed
    apiRouter.GET("/api/v1/namespaces",             // Namespaces list
        app.GetNamespacesHandler)
    apiRouter.GET("/api/v1/secrets",                // Secrets (needs namespace)
        app.AttachNamespace(app.GetSecretsHandler))
    apiRouter.GET("/api/v1/pipeline-runs",          // Pipeline runs (full chain)
        app.AttachNamespace(
            app.RequireAccessToPipelineServers(
                app.AttachPipelineServerClient(
                    app.AttachDiscoveredPipeline(
                        app.PipelineRunsHandler)))))
    apiRouter.POST("/api/v1/pipeline-runs",         // Create pipeline run (same chain, different handler)
        app.AttachNamespace(
            app.RequireAccessToPipelineServers(
                app.AttachPipelineServerClient(
                    app.AttachDiscoveredPipeline(
                        app.CreatePipelineRunHandler)))))

    // Mount the API router under /api/v1/
    appMux := http.NewServeMux()                   // Standard library multiplexer
    appMux.Handle("/api/v1/", apiRouter)           // Delegate /api/v1/* to httprouter

    // Health check gets its own router (no auth required!)
    healthcheckRouter := httprouter.New()           // Separate router for health check
    healthcheckRouter.GET("/healthcheck",           // K8s probes hit this endpoint
        app.HealthcheckHandler)                    // No auth, no CORS needed

    // Combine everything with global middleware
    combinedMux := http.NewServeMux()              // Top-level multiplexer

    combinedMux.Handle("/healthcheck",             // Health check: minimal middleware
        app.RecoverPanic(                          // Only panic recovery...
            app.EnableTelemetry(                   // ...and telemetry
                healthcheckRouter)))               // No auth, no CORS

    combinedMux.Handle("/",                        // Everything else: full middleware stack
        app.RecoverPanic(                          // 1. Catch panics → 500
            app.EnableTelemetry(                   // 2. Add trace ID to logs
                app.EnableCORS(                    // 3. Handle CORS headers
                    app.InjectRequestIdentity(     // 4. Extract user identity
                        appMux)))))                // Routes live here

    return combinedMux                             // Return the fully-configured handler
}
```

**What just happened?** There's a lot going on, so let me highlight the key decisions:

1. **Two separate routers**: The health check has minimal middleware (no auth, no CORS) because Kubernetes probes need to hit it without authentication.

2. **Global middleware** wraps everything under `/`: `RecoverPanic` catches panics (like uncaught exceptions), `EnableTelemetry` adds trace IDs, `EnableCORS` handles CORS headers, and `InjectRequestIdentity` extracts the user.

3. **Route-level middleware** is applied per-route: `AttachNamespace`, `RequireAccess`, `AttachClient` only run on routes that need them.

**Express equivalent:**

```typescript
// Global middleware
app.use(recoverPanic);                             // Catch all uncaught exceptions
app.use(enableTelemetry);                          // Add trace ID
app.use(cors());                                   // CORS
app.use(injectRequestIdentity);                    // Auth

// Route-level middleware
app.get('/api/v1/secrets',                         // Secrets route
  attachNamespace,                                 // Only this route needs namespace
  getSecretsHandler);

// Health check -- no auth middleware
app.get('/healthcheck', healthcheckHandler);
```

::: warning Common Mistake
Don't confuse `http.NewServeMux()` with `httprouter.New()`. The standard library's `ServeMux` is used for top-level path routing (healthcheck vs API vs static files), while `httprouter` handles the detailed API routing with URL parameters. They compose together: the `ServeMux` delegates to the `httprouter` for `/api/v1/*` paths.
:::

## The Shutdown Method

The `App` also has a `Shutdown()` method for cleaning up resources:

```go
func (app *App) Shutdown() error {                 // Called during graceful shutdown
    app.logger.Info("shutting down app...")         // Log that we're cleaning up
    if app.testEnv != nil {                        // Check if we're running with envtest
        return app.testEnv.Stop()                  // Stop the in-memory K8s API server
    }
    return nil                                     // Nothing to clean up in production mode
}
```

**What just happened?** This is called by the graceful shutdown code in `main.go`. In mock mode, it tears down the in-memory Kubernetes API server. In production, it might close database connections or stop background workers.

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
