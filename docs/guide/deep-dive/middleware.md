# Middleware Chain

> **The gatekeepers** -- middleware functions wrap handlers to extract data, enforce security, and attach clients before the handler ever runs.

Middleware in Go is a function that wraps another function. That's it. If you understand higher-order functions in JavaScript -- `const enhanced = withAuth(handler)` -- you already understand Go middleware. The concept is identical to Express's `(req, res, next) => { ... }`, just expressed differently.

## Express Middleware, for Comparison

In Express, middleware modifies `req` and calls `next()`:

```typescript
function attachNamespace(                          // Middleware function
  req: Request,                                    // The request
  res: Response,                                   // The response
  next: NextFunction,                              // Call this to continue to the next handler
) {
  const namespace = req.query.namespace as string;  // Read from query string
  if (!namespace) {                                // Validate
    return res.status(400).json({ error: 'namespace is required' }); // Stop chain
  }
  req.namespace = namespace;                       // Attach data to request
  next();                                          // Continue to the next handler
}

// Usage:
app.get('/api/v1/secrets', attachNamespace, getSecretsHandler);
```

Three things happen: validate, attach data, call `next()`. Go middleware does the exact same three things.

## Go Middleware

Here's the Go version of that same middleware:

```go
func (app *App) AttachNamespace(                   // Middleware: takes a handler, returns a handler
    next httprouter.Handle,                        // The "next" handler to call if validation passes
) httprouter.Handle {                              // Returns a new handler (the wrapped version)
    return func(                                   // Return a new function that...
        w http.ResponseWriter,                     // ...takes the standard handler arguments
        r *http.Request,
        ps httprouter.Params,
    ) {
        namespace := r.URL.Query().Get("namespace")// Read from query string (same as Express)
        if namespace == "" {                       // Validate
            app.badRequestResponse(w, r,           // Send 400 error
                fmt.Errorf("namespace is required"))
            return                                 // Stop here -- don't call next
        }

        // Attach to request context (like req.namespace = ...)
        ctx := context.WithValue(                  // Create a new context with the namespace
            r.Context(),                           // Start from the existing context
            constants.NamespaceQueryParameterKey,  // The key (a constant)
            namespace,                             // The value
        )
        r = r.WithContext(ctx)                     // Create a new request with the updated context

        next(w, r, ps)                             // Continue to the next handler (like calling next())
    }
}
```

Here are the key pieces:

1. **Input**: takes `next` (the handler to wrap), type `httprouter.Handle`
2. **Output**: returns a new `httprouter.Handle`
3. **The inner function**: does some work, then either calls `next(w, r, ps)` or returns early with an error
4. **`context.WithValue`**: the Go way to attach data to a request (like `req.namespace = ...`)

The `httprouter.Handle` type is just a function signature:

```go
type Handle = func(http.ResponseWriter, *http.Request, httprouter.Params)
```

So middleware is really: "a function that takes a function and returns a function." This is the same concept as higher-order functions in JavaScript -- `const wrappedHandler = attachNamespace(secretsHandler)`.

::: tip If You Know React HOCs, You Already Know This
Go middleware is exactly a React Higher-Order Component. `withAuth(withTheme(MyComponent))` wraps a component with extra behavior; `AttachNamespace(RequireAccess(Handler))` wraps a handler with extra behavior. Both can short-circuit (HOC renders a login page instead, middleware returns a 403 instead). The only difference is reading direction: React reads outside-in, Go reads inside-out -- but execution order is the same.
:::

## `context.WithValue` -- Go's `req` Object

In Express, you attach data to the request object: `req.user = identity`. In Go, you use context values. This is the most important concept to understand about Go middleware.

**Setting a value (in middleware):**

```go
ctx := context.WithValue(                          // Create a NEW context with an added value
    r.Context(),                                   // Start from the existing context
    constants.NamespaceQueryParameterKey,          // The key (usually a constant)
    namespace,                                     // The value to store
)
r = r.WithContext(ctx)                             // Create a new request with the updated context
```

**Reading a value (in handler or later middleware):**

```go
namespace, ok := r.Context().Value(                // Read a value from context
    constants.NamespaceQueryParameterKey,          // The key we stored it under
).(string)                                         // Type assertion: "I expect a string"
if !ok || namespace == "" {                        // Check if it existed and was a string
    // Value wasn't set or was wrong type          // Handle the failure
}
```

**TypeScript equivalent:**

```typescript
// Express: setting
req.namespace = namespace;                         // Just assign to the request object

// Express: reading
const namespace = req.namespace;                   // Just read from the request object
if (!namespace) { /* handle missing */ }
```

The `.(string)` part is a **type assertion** -- Go's way of saying "I expect this value to be a string." The `ok` return tells you if the assertion succeeded. This is like TypeScript's `as string` cast, but safer because you get a boolean to check.

::: warning Important
`context.WithValue` creates a **new** context. It doesn't mutate the existing one. That's why you always see `r = r.WithContext(ctx)` -- you're creating a new request with the updated context.

```go
// This does NOTHING -- the result is thrown away:
context.WithValue(r.Context(), key, value)         // New context created but never used!

// This is correct -- reassign r:
ctx := context.WithValue(r.Context(), key, value)  // Create new context
r = r.WithContext(ctx)                             // Create new request with that context
```
:::

::: info Checkpoint
You now know the two building blocks of Go middleware: wrapping handlers (higher-order functions) and passing data (context values). Let's walk through every middleware in the standard chain.
:::

## The Standard Middleware Chain

Here's the order middleware runs for a typical API request. I'll walk through each one and explain what it does, why it exists, and what data it adds to context.

### 1. RecoverPanic -- The Safety Net

Catches Go panics (like uncaught exceptions) and returns a 500 error instead of crashing:

```go
func (app *App) RecoverPanic(                      // Global middleware
    next http.Handler,                             // Wraps an http.Handler (not httprouter.Handle)
) http.Handler {                                   // Returns an http.Handler
    return http.HandlerFunc(func(                   // Wrap in http.HandlerFunc adapter
        w http.ResponseWriter,                     // Response writer
        r *http.Request,                           // Request
    ) {
        defer func() {                             // defer runs AFTER the function returns/panics
            if err := recover(); err != nil {      // recover() catches a panic if one occurred
                w.Header().Set("Connection", "close") // Tell client to close connection
                app.serverErrorResponse(w, r,      // Send 500 error response
                    fmt.Errorf("%s", err))          // Convert panic value to error
            }
        }()
        next.ServeHTTP(w, r)                       // Call the next handler (might panic)
    })
}
```

**What just happened?** `defer` and `recover` are Go's version of a global `try/catch`. If anything downstream panics (Go's equivalent of an uncaught throw), this middleware catches it, logs it, and returns a 500 JSON error instead of crashing the entire server. Every request is protected.

**What it adds to context:** Nothing -- it just catches panics.

### 2. EnableTelemetry -- Trace ID for Every Request

Adds a unique trace ID so you can correlate all log messages from a single request:

```go
func (app *App) EnableTelemetry(                   // Global middleware
    next http.Handler,                             // Wraps an http.Handler
) http.Handler {                                   // Returns an http.Handler
    return http.HandlerFunc(func(                   // Wrap in http.HandlerFunc adapter
        w http.ResponseWriter,                     // Response writer
        r *http.Request,                           // Request
    ) {
        traceId := uuid.NewString()                // Generate a unique ID (like crypto.randomUUID())
        ctx := context.WithValue(                  // Store trace ID in context
            r.Context(),                           // Start from existing context
            constants.TraceIdKey,                   // The key for trace ID
            traceId,                               // The UUID value
        )

        traceLogger := app.logger.With(            // Create a logger that includes the trace ID
            slog.String("trace_id", traceId),      // Every log message gets this field automatically
        )
        ctx = context.WithValue(ctx,               // Store the trace logger in context too
            constants.TraceLoggerKey, traceLogger)

        traceLogger.Debug("Incoming HTTP request",  // Log the incoming request
            "method", r.Method,                    // HTTP method
            "uri", r.URL.Path)                     // Request path
        next.ServeHTTP(w, r.WithContext(ctx))      // Continue with updated context
    })
}
```

Every request gets a UUID. All log messages from that request include the trace ID. When debugging, you search logs by trace ID to see everything that happened for one request. This is the same concept as correlation IDs in Express.

**What it adds to context:** `TraceIdKey` (string UUID) and `TraceLoggerKey` (logger with trace ID baked in).

### 3. EnableCORS -- Cross-Origin Resource Sharing

Handles CORS headers using the `rs/cors` library:

```go
func (app *App) EnableCORS(                        // Global middleware
    next http.Handler,                             // Wraps an http.Handler
) http.Handler {                                   // Returns an http.Handler
    if len(app.config.AllowedOrigins) == 0 {       // If no origins configured...
        return next                                // ...skip CORS entirely (pass through)
    }

    c := cors.New(cors.Options{                    // Create CORS handler (like npm cors package)
        AllowedOrigins:   app.config.AllowedOrigins, // e.g., ["http://localhost:3000"]
        AllowCredentials: true,                    // Allow cookies/auth headers
        AllowedMethods:   []string{                // Allowed HTTP methods
            "GET", "PUT", "POST", "PATCH", "DELETE"},
        AllowedHeaders:   []string{},              // gen-ai: empty list (varies by BFF, see below)
    })
    return c.Handler(next)                         // Wrap the next handler with CORS
}
```

Same concept as the `cors` npm package. If `AllowedOrigins` is empty, CORS is disabled and the middleware is a no-op.

`AllowedHeaders` is where BFFs differ: gen-ai passes an empty list; maas allows the `kubeflow-userid`/`kubeflow-groups` pair; automl allows `Content-Type`, its configured auth token header, and the kubeflow pair.

**What it adds to context:** Nothing -- it only adds response headers.

### 4. InjectRequestIdentity -- Who Is This User?

Extracts the user's identity from HTTP headers. This is the authentication layer. Here is gen-ai's:

```go
// packages/gen-ai/bff/internal/api/middleware.go
func (app *App) InjectRequestIdentity(             // Global middleware -- runs on every request
    next http.Handler,                             // Wraps an http.Handler
) http.Handler {                                   // Returns an http.Handler
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Skip auth for non-API routes (static files, health check).
        // Both /api/v1 and /gen-ai/api/v1 count as API paths.
        isAPIPath := strings.HasPrefix(r.URL.Path, app.config.APIPathPrefix) ||
            strings.HasPrefix(r.URL.Path, constants.PathPrefix+app.config.APIPathPrefix)
        if !isAPIPath {
            next.ServeHTTP(w, r)                   // Pass through without auth
            return
        }

        if app.config.AuthMethod == config.AuthMethodDisabled { // Dev mode
            next.ServeHTTP(w, r)                   // No identity at all in gen-ai
            return
        }

        identity, err := app.kubernetesClientFactory.ExtractRequestIdentity(r.Header)
        if err != nil {                            // Missing or malformed token header
            app.unauthorizedResponse(w, r, err)    // 401
            return                                 // Stop! No identity = no access
        }

        ctx := context.WithValue(                  // Store identity in context
            r.Context(),
            constants.RequestIdentityKey,          // The key constant
            identity,                              // *integrations.RequestIdentity
        )
        next.ServeHTTP(w, r.WithContext(ctx))      // Continue with identity in context
    })
}
```

This is the authentication gate. In ODH/RHOAI every BFF reads the user's token from `x-forwarded-access-token` (deployed with `--auth-method=user_token`). With auth disabled, gen-ai simply passes the request through; automl/autorag use a fake extractor that returns `fake-user@example.com`; maas has no disabled mode. automl and autorag don't write this method at all -- they use the generic `kubernetes.InjectRequestIdentity` from `packages/autox-core/services` and wrap only the API routes with it. See [Authentication & RBAC](./auth) for the full story.

**What it adds to context:** `RequestIdentityKey`. The type varies by BFF: gen-ai stores `*integrations.RequestIdentity` (`Token`, `MCPToken`); autox-core and maas store a `RequestIdentity` with `UserID`, `Groups`, and `Token`.

### 5. AttachNamespace -- Extract and Validate Namespace (Route-Level)

Extracts the namespace from query parameters and validates it:

```go
func (app *App) AttachNamespace(                   // Route-level middleware
    next func(http.ResponseWriter, *http.Request, httprouter.Params), // Takes httprouter handler
) httprouter.Handle {                              // Returns httprouter handler
    return func(                                   // The wrapper function
        w http.ResponseWriter,                     // Response writer
        r *http.Request,                           // Request
        ps httprouter.Params,                      // URL params
    ) {
        namespace := r.URL.Query().Get("namespace")// Read namespace from query string
        if namespace == "" {                       // Check if it's present
            app.badRequestResponse(w, r,           // Send 400 if missing
                fmt.Errorf("missing required query parameter: namespace"))
            return                                 // Stop the chain
        }

        // automl/autorag also call kubernetes.ValidateNamespaceName here (DNS-1123).
        // gen-ai only checks for empty. Check your specific BFF.

        ctx := context.WithValue(                  // Store namespace in context
            r.Context(),                           // Start from existing context
            constants.NamespaceQueryParameterKey,  // The key constant
            namespace,                             // The validated namespace string
        )
        r = r.WithContext(ctx)                     // Create new request with updated context

        next(w, r, ps)                             // Continue to next handler
    }
}
```

**What just happened?** The namespace is extracted from the query string and stored in context. Some BFFs (automl, autorag) also validate against DNS-1123 rules to catch invalid names early. Either way, the handler never has to parse query parameters itself.

**What it adds to context:** `NamespaceQueryParameterKey` (string -- the validated namespace). The exact constant name varies by BFF -- always check `internal/constants/` in the BFF you are working on.

### 6. RequireAccessToService -- Can This User Do This? (Route-Level)

Performs a SelfSubjectAccessReview with the user's token to check if the user has permission. gen-ai's version:

```go
// packages/gen-ai/bff/internal/api/middleware.go (trimmed)
func (app *App) RequireAccessToService(            // Route-level middleware
    next func(http.ResponseWriter, *http.Request, httprouter.Params),
) httprouter.Handle {                              // Returns httprouter handler
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        if app.config.AuthMethod == config.AuthMethodDisabled { // Skip in dev mode
            next(w, r, ps)
            return
        }

        ctx := r.Context()                         // Has namespace and identity
        identity, ok := ctx.Value(constants.RequestIdentityKey).(*integrations.RequestIdentity)
        if !ok || identity == nil {
            app.badRequestResponse(w, r, fmt.Errorf("missing RequestIdentity in context"))
            return
        }
        if err := app.kubernetesClientFactory.ValidateRequestIdentity(identity); err != nil {
            app.badRequestResponse(w, r, err)
            return
        }

        if namespace, ok := ctx.Value(constants.NamespaceQueryParameterKey).(string); ok && namespace != "" {
            k8sClient, err := app.kubernetesClientFactory.GetClient(ctx)
            if err != nil {
                app.serverErrorResponse(w, r, fmt.Errorf("failed to get Kubernetes client: %w", err))
                return
            }

            // SSAR: can this token list OGXServer resources in the namespace?
            allowed, err := k8sClient.CanListOGXServers(ctx, identity, namespace)
            if err != nil {
                app.handleK8sClientError(w, r, err)
                return
            }
            if !allowed {                          // User is NOT authorized
                app.forbiddenResponse(w, r,        // Send 403 Forbidden
                    "user does not have permission to access services in this namespace")
                return                             // Handler never runs
            }
        }

        next(w, r, ps)                             // User IS authorized -- continue
    }
}
```

**What just happened?** This is the security enforcer. It asks the Kubernetes API: "Can the owner of this token perform action Y in namespace Z?" If the answer is no, the handler never runs. This is what makes the BFF the real security boundary -- even if someone bypasses the frontend UI, the BFF blocks unauthorized requests.

automl/autorag have the same middleware on their `Middleware` struct (`app.mw.RequireAccessToService`), calling the shared `k8sService.CanAccessResource(ctx, ns, "list", "datasciencepipelinesapplications.opendatahub.io", "datasciencepipelinesapplications", "")` from autox-core.

**What it adds to context:** Nothing -- it's a gate. Either you pass (and `next` is called) or you don't (and you get a 403).

### 7. AttachClient -- Create the Service Client (Route-Level)

Creates a service client and puts it in context for the handler. gen-ai's `AttachOGXClient` (`internal/api/middleware.go`) is the example -- other BFFs have `AttachMLflowClient`, `AttachBFFMaaSClient`, and so on:

```go
// packages/gen-ai/bff/internal/api/middleware.go (trimmed)
func (app *App) AttachOGXClient(                   // Route-level middleware
    next func(http.ResponseWriter, *http.Request, httprouter.Params),
) httprouter.Handle {
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        ctx := r.Context()
        namespace, ok := ctx.Value(constants.NamespaceQueryParameterKey).(string)
        if !ok || namespace == "" {
            app.badRequestResponse(w, r, fmt.Errorf("missing namespace in context - ensure AttachNamespace middleware is used first"))
            return
        }

        var llamaStackClient llamastack.LlamaStackClientInterface

        if app.config.MockLSClient {               // Mock mode: the mock factory ignores the URL
            llamaStackClient = app.llamaStackClientFactory.CreateClient(
                "", "", app.config.InsecureSkipVerify, app.rootCAs, "/v1")
        } else {
            serviceURL := app.config.LlamaStackURL // Developer override, if set
            if serviceURL == "" {
                // ... list OGXServers in the namespace (as the user) and
                //     take Items[0].Status.ServiceURL; 500 if none ...
            }
            identity, _ := ctx.Value(constants.RequestIdentityKey).(*integrations.RequestIdentity)
            llamaStackClient = app.llamaStackClientFactory.CreateClient( // Real client,
                serviceURL, identity.Token,        // carrying the user's token
                app.config.InsecureSkipVerify, app.rootCAs, "/v1")
        }

        ctx = context.WithValue(ctx, constants.LlamaStackClientKey, llamaStackClient)
        next(w, r.WithContext(ctx), ps)            // Continue to handler
    }
}
```

Notice that the handler does not create its own client -- middleware does. The handler just reads the client from context. This is dependency injection at the request level: each request gets its own client with the right credentials and service URL.

**What it adds to context:** `LlamaStackClientKey` (the `LlamaStackClientInterface` -- real or mock).

::: info automl/autorag don't attach clients per request
After the move to `packages/autox-core/services`, automl and autorag build their pipelines, S3 and K8s services once in `NewApp` and inject them into handler structs (`PipelinesHandler`, `S3Handler`...). Their route chains stop at `app.mw.AttachNamespace(app.mw.RequireAccessToService(handler))`; the pipeline server is discovered inside the service on each call.
:::

## How the Chain Looks When Assembled

Here's the full picture. Global middleware wraps everything:

```
RecoverPanic → EnableTelemetry → EnableCORS → InjectIdentity → Routes
    1st              2nd            3rd           4th
```

Then route-level middleware wraps specific handlers:

```
AttachNamespace → RequireAccess → AttachClient → Handler
      5th             6th            7th          8th
```

**Complete execution order for a gen-ai LlamaStack route, e.g. `GET /api/v1/lsd/models?namespace=my-project`:**

```
1. RecoverPanic     → wraps everything in panic recovery
2. EnableTelemetry  → generates trace ID, creates trace logger
3. EnableCORS       → adds CORS headers
4. InjectIdentity   → reads the token from x-forwarded-access-token
5. AttachNamespace  → validates "my-project" query param
6. RequireAccess    → SelfSubjectAccessReview: can this token list OGXServers in "my-project"?
7. AttachClient     → finds the OGXServer URL, creates the LlamaStack client
8. Handler          → calls LlamaStack and returns the result
```

If step 5 fails (no namespace), steps 6-8 never execute. If step 6 fails (access denied), steps 7-8 never execute. Each middleware is a gate -- pass or stop.

## Writing Your Own Middleware

Now that you've seen the pattern, here's the template for writing your own:

```go
func (app *App) MyMiddleware(                      // Your custom middleware
    next httprouter.Handle,                        // The handler to wrap
) httprouter.Handle {                              // Returns a wrapped handler
    return func(                                   // The wrapper function
        w http.ResponseWriter,                     // Response writer
        r *http.Request,                           // Request
        ps httprouter.Params,                      // URL params
    ) {
        // 1. Do your work (validate, extract, compute)
        value := r.URL.Query().Get("my-param")     // Read something from the request
        if value == "" {                           // Validate
            app.badRequestResponse(w, r,           // Send error
                fmt.Errorf("my-param is required"))
            return                                 // Stop the chain
        }

        // 2. Add to context if needed
        ctx := context.WithValue(                  // Store the value for the handler
            r.Context(), myContextKey, value)
        r = r.WithContext(ctx)                     // Update the request

        // 3. Call the next handler
        next(w, r, ps)                             // Continue the chain
    }
}
```

Then use it in a route:

```go
apiRouter.GET("/api/v1/something",                 // Register the route
    app.AttachNamespace(                           // First middleware
        app.MyMiddleware(                          // Your new middleware
            app.SomethingHandler)))                // The handler
```

::: warning Two Types of Middleware Signature
Global middleware wraps `http.Handler` (the standard library interface), while route-level middleware wraps `httprouter.Handle` (which adds the `Params` argument). They look slightly different:

```go
// Global (wraps http.Handler -- used for RecoverPanic, CORS, etc.)
func (app *App) RecoverPanic(                      // Takes http.Handler
    next http.Handler,                             // Standard library interface
) http.Handler { ... }                             // Returns http.Handler

// Route-level (wraps httprouter.Handle -- used for AttachNamespace, etc.)
func (app *App) AttachNamespace(                   // Takes a function with Params
    next func(http.ResponseWriter, *http.Request, httprouter.Params),
) httprouter.Handle { ... }                        // Returns httprouter.Handle
```

The distinction matters because `httprouter` passes URL parameters (`ps`) that the standard library `http.Handler` doesn't have.
:::

::: tip Key Takeaway
Middleware in Go wraps handlers instead of calling `next()`. The chain reads inside-out: `AttachNamespace(RequireAccess(AttachClient(handler)))` means namespace runs first, then access check, then client attachment, then the handler. Data passes between middleware via `context.WithValue` (Go's equivalent of attaching properties to the Express `req` object). If any middleware returns early without calling `next`, the chain stops.
:::

::: info See Also
- [Authentication & RBAC](./auth) -- deep dive into `InjectRequestIdentity` and `RequireAccess`
- [The App Struct & Routes](./app-and-routes) -- where middleware is wired into routes
- [Writing Handlers](./handlers) -- how handlers read context values set by middleware
:::
