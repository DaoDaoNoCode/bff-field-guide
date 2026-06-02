# HTTP Servers — Building the API

> **Go Concept:** Go has a production-quality HTTP server in its standard library. ODH Dashboard BFFs add `httprouter` on top for URL parameter support.

You've been calling APIs from React for years. `fetch('/api/users')`, `axios.get('/api/models')`, reading from `response.json()`. Now you're going to build the API that React calls. Same HTTP, different side of the wire.

The good news: if you've built anything with Express or Fastify, the concepts are identical. Routes, handlers, request parsing, response writing. The syntax is different, but your mental model transfers directly.

## Starting from What You Know

Here's an Express server you could write in your sleep:

```ts
// TypeScript -- Express
import express from 'express';                   // Import Express

const app = express();                           // Create an Express application
app.use(express.json());                         // Middleware to parse JSON request bodies

app.get('/api/users', (req, res) => {            // Define a GET route
  res.json([{ name: 'Alice' }]);                 // Send JSON response -- that's it
});                                              // Express handles Content-Type, status code

app.listen(8080, () => {                         // Start listening on port 8080
  console.log('Server running on :8080');         // Log when ready
});                                              // Server is now accepting requests
```

Five lines of actual code. Express hides a lot of complexity behind `res.json()` -- it sets the Content-Type header, serializes the data, writes the status code, sends the response. Let's see how Go makes each of those steps explicit.

## Your First Go HTTP Server

```go
package main                                     // Every Go program starts with a package

import (                                         // Import the packages we need
    "encoding/json"                              // For JSON encoding
    "net/http"                                   // Go's built-in HTTP server
)                                                // That's it -- no npm install needed

func healthCheck(                                // Define a handler function
    w http.ResponseWriter,                       // w = where you WRITE the response
    r *http.Request,                             // r = where you READ the request
) {                                              // These two params are EVERY handler's signature
    w.Header().Set("Content-Type",               // Set the Content-Type header
        "application/json")                      // We're sending JSON back
    json.NewEncoder(w).Encode(                   // Create a JSON encoder that writes to w
        map[string]string{"status": "healthy"},  // The data to encode
    )                                            // Encoder writes directly to the response
}                                                // Handler function complete

func main() {                                    // Program entry point
    http.HandleFunc("/healthcheck", healthCheck)  // Register the handler for this path
    http.ListenAndServe(":8080", nil)            // Start the server on port 8080
                                                 // This blocks forever (like app.listen)
}                                                // Program ends if the server crashes
```

**What just happened?** We created an HTTP server with zero external dependencies. `net/http` is part of Go's standard library -- it's production-quality, handles concurrent requests, and supports TLS out of the box. No `npm install express`, no `package.json`, no `node_modules`.

The handler function takes two parameters instead of Express's `(req, res)`:
- `w http.ResponseWriter` -- you write the response to this (like `res`)
- `r *http.Request` -- you read the request from this (like `req`)

The names are reversed from what you're used to -- response first, then request. This catches everyone the first time.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Identify the two parameters every Go HTTP handler receives: `w` (response writer) and `r` (request)
- Write a handler that returns a JSON response
- Start an HTTP server with `http.ListenAndServe`
- Understand that Go's HTTP server needs no external packages

</div>

## Reading Request Data

In Express, `req` gives you everything: `req.body`, `req.params`, `req.query`, `req.headers`. In Go, you read from the `*http.Request` struct, but each piece of data comes from a different place.

### Query parameters

The most common way to pass data in GET requests. In your React code, you've written `fetch('/api/models?namespace=default&limit=10')` many times.

::: code-group
```ts [TypeScript -- Express]
app.get('/api/models', (req, res) => {
  const namespace = req.query.namespace as string;  // Read ?namespace=...
  const limit = parseInt(req.query.limit as string) || 10;  // Parse limit with default
});
```

```go [Go]
func handler(w http.ResponseWriter, r *http.Request) { // Standard handler signature
    namespace := r.URL.Query().Get("namespace")        // Read the "namespace" query param
                                                       // Returns "" if not present
                                                       // r.URL.Query() parses the query string
                                                       // .Get() returns a single value

    limitStr := r.URL.Query().Get("limit")             // Query params are always strings
                                                       // You need to convert manually

    limit := 10                                        // Set a default value
    if limitStr != "" {                                // If the param was provided...
        parsed, err := strconv.Atoi(limitStr)          // ...convert string to int
                                                       // Atoi = "ASCII to integer"
        if err == nil {                                // If conversion succeeded...
            limit = parsed                             // ...use the parsed value
        }                                              // If it failed, keep the default
    }                                                  // Now limit is either parsed or default 10

    fmt.Fprintf(w, "namespace=%s, limit=%d",           // Write a response
        namespace, limit)                              // Using the parsed values
}
```
:::

**What just happened?** In Express, query params come pre-parsed as strings. In Go, it's the same -- `r.URL.Query().Get("name")` returns a string, and you convert it yourself. The extra work is the type conversion (`strconv.Atoi` for integers), which Express also requires (you just might forget to do it and get bugs).

### Reading headers

Headers are important in BFF code because authentication tokens and user identity come through them.

::: code-group
```ts [TypeScript -- Express]
const token = req.headers['authorization'];       // Read the Authorization header
const userID = req.headers['kubeflow-userid'];    // Custom header for user identity
```

```go [Go]
func handler(w http.ResponseWriter, r *http.Request) { // Standard handler signature
    token := r.Header.Get("Authorization")              // Read the Authorization header
                                                        // Note: Go canonicalizes header names
                                                        // "authorization" -> "Authorization"

    userID := r.Header.Get("kubeflow-userid")           // Custom header for user identity
                                                        // Returns "" if not present
                                                        // Go is case-insensitive for header lookups
}
```
:::

::: info
Go automatically canonicalizes HTTP header names. `r.Header.Get("content-type")` and `r.Header.Get("Content-Type")` return the same value. You don't need to worry about case.
:::

### Reading the request body (JSON)

This is where the [JSON chapter](./json) connects to real handlers:

::: code-group
```ts [TypeScript -- Express]
// Express with express.json() middleware -- body is pre-parsed
app.post('/api/models', (req, res) => {
  const { name, namespace } = req.body;           // Already an object
  // Use name and namespace directly
});
```

```go [Go]
func handler(w http.ResponseWriter, r *http.Request) { // Standard handler signature
    var body struct {                                   // Anonymous struct for the body shape
        Name      string `json:"name"`                 // Expected field: "name"
        Namespace string `json:"namespace"`             // Expected field: "namespace"
    }                                                   // This struct is only used here

    err := json.NewDecoder(r.Body).Decode(&body)       // Read and parse the JSON body
                                                       // &body = pointer so Decode can fill it
    if err != nil {                                    // If the JSON is malformed...
        http.Error(w,                                  // ...send a plain text error response
            "invalid JSON body",                       // Error message
            http.StatusBadRequest)                     // 400 status code
        return                                         // Stop processing this request
    }                                                  // Past here, body is valid

    fmt.Println(body.Name, body.Namespace)             // Use the parsed values
}
```
:::

**What just happened?** In Express, `express.json()` middleware parses the body for you before the handler runs. In Go, you parse it yourself inside the handler. This is more explicit -- you choose the struct shape, you handle parse errors, you control exactly what happens when the body is malformed.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Read query parameters with `r.URL.Query().Get("name")`
- Read headers with `r.Header.Get("Header-Name")`
- Parse a JSON request body with `json.NewDecoder(r.Body).Decode(&target)`
- Convert query parameter strings to integers with `strconv.Atoi`

</div>

## Writing Responses

### Setting status codes and headers

::: code-group
```ts [TypeScript -- Express]
res.status(201)                            // Set status code
   .set('X-Custom', 'value')              // Set a header
   .json({ id: 'new-id' });               // Send JSON response
```

```go [Go]
func handler(w http.ResponseWriter, r *http.Request) { // Standard handler signature
    w.Header().Set("X-Custom", "value")                // Set a custom header
                                                       // MUST be before WriteHeader and Write

    w.Header().Set("Content-Type",                     // Set Content-Type
        "application/json")                            // We're sending JSON

    w.WriteHeader(http.StatusCreated)                  // Send the 201 status code
                                                       // MUST be before writing the body
                                                       // Can only be called ONCE

    json.NewEncoder(w).Encode(                         // Write the JSON body
        map[string]string{"id": "new-id"},             // The data
    )                                                  // Streams directly to the response
}
```
:::

::: warning
**Order matters in Go.** You must set headers before calling `WriteHeader()`, and call `WriteHeader()` before writing the body. Once you call `w.Write()` or `Encode()`, Go implicitly sends a 200 status code and locks the headers. You can't change them after that. This is the single most common HTTP mistake in Go.
:::

### Status code constants

Go uses named constants instead of magic numbers. This makes your code more readable:

```go
http.StatusOK                  // 200 -- standard success
http.StatusCreated             // 201 -- resource created
http.StatusNoContent           // 204 -- success, no body
http.StatusBadRequest          // 400 -- client sent bad data
http.StatusUnauthorized        // 401 -- not authenticated
http.StatusForbidden           // 403 -- authenticated but not allowed
http.StatusNotFound            // 404 -- resource doesn't exist
http.StatusInternalServerError // 500 -- something broke on our side
http.StatusServiceUnavailable  // 503 -- service is down
```

You'll use these everywhere. `http.StatusOK` is clearer than `200` and your IDE will autocomplete them.

## But Wait -- We Don't Use `net/http` Directly

Everything above works, but the ODH Dashboard BFFs don't use `net/http`'s built-in router directly. Go 1.22 added path parameters to the standard library, but the BFF codebase was written before that and uses `httprouter` instead. The convention stuck -- and `httprouter` remains faster and more explicit.

When you write `GET /api/models/:namespace/:id`, you want `:namespace` and `:id` to be extracted as variables. Express does this automatically. Go's standard library didn't support it until recently, so the BFF codebase uses `httprouter` -- a lightweight router package.

## `httprouter` -- What You'll Actually Use

[`julienschmidt/httprouter`](https://github.com/julienschmidt/httprouter) adds URL parameters and faster routing. It's not a framework -- it's a single-purpose router that adds one extra parameter to handler functions.

### The handler signature difference

This is the key change. Compare the two signatures:

```go
// Standard net/http handler -- no URL params
func handler(                                    // A standard HTTP handler
    w http.ResponseWriter,                       // Response writer
    r *http.Request,                             // Request
) {                                              // Only two parameters
    // No way to get :id from /api/models/:id
    // (unless you use Go 1.22+ path patterns)
}

// httprouter handler -- adds URL params
func handler(                                    // An httprouter handler
    w http.ResponseWriter,                       // Same response writer
    r *http.Request,                             // Same request
    ps httprouter.Params,                        // NEW: URL parameters!
) {                                              // Three parameters now
    id := ps.ByName("id")                        // Extract :id from the URL path
    namespace := ps.ByName("namespace")          // Extract :namespace from the URL path
}                                                // ps gives you access to URL params
```

**What just happened?** The only difference is the third parameter: `ps httprouter.Params`. This gives you access to URL path parameters using `ps.ByName("paramName")`. Everything else -- `w` and `r` -- works exactly the same as standard `net/http`.

### Defining routes

::: code-group
```ts [TypeScript -- Express]
app.get('/api/models/:namespace', listModels);        // GET with one param
app.get('/api/models/:namespace/:id', getModel);      // GET with two params
app.post('/api/models/:namespace', createModel);      // POST
app.delete('/api/models/:namespace/:id', deleteModel); // DELETE
```

```go [Go -- httprouter]
router := httprouter.New()                            // Create a new router instance
                                                      // Like express() but for routing only

router.GET("/api/models/:namespace",                  // Register a GET route
    app.ListModelsHandler)                            // Handler is a method on App
router.GET("/api/models/:namespace/:id",              // GET with two URL params
    app.GetModelHandler)                              // :namespace and :id
router.POST("/api/models/:namespace",                 // Register a POST route
    app.CreateModelHandler)                           // Same path, different HTTP method
router.DELETE("/api/models/:namespace/:id",           // Register a DELETE route
    app.DeleteModelHandler)                           // Methods are UPPERCASE in httprouter
```
:::

Notice: Express uses `app.get()` (lowercase), httprouter uses `router.GET()` (uppercase). The URL parameter syntax is the same: `:paramName`.

### A complete handler, line by line

Let's build a real handler that extracts URL params, calls a service, handles errors, and returns JSON. This is the pattern you'll write over and over:

```go
func (app *App) GetModelHandler(                 // Method on the App struct
    w http.ResponseWriter,                       // Response writer -- send data here
    r *http.Request,                             // Request -- read data from here
    ps httprouter.Params,                        // URL path parameters
) {                                              // No return value -- write directly to w

    // Step 1: Extract URL parameters
    namespace := ps.ByName("namespace")          // Get :namespace from the URL
                                                 // e.g., /api/models/default/abc -> "default"
    id := ps.ByName("id")                        // Get :id from the URL
                                                 // e.g., /api/models/default/abc -> "abc"

    // Step 2: Call the service layer
    model, err := app.modelService.GetModel(     // Delegate to business logic
        r.Context(),                             // Pass the request context
                                                 // (carries deadlines, cancellation signals)
        namespace,                               // The namespace from the URL
        id,                                      // The model ID from the URL
    )                                            // Returns (model, error)
    if err != nil {                              // If the service returned an error...
        app.serverErrorResponse(w, r, err)       // ...send a 500 response
        return                                   // ...and stop processing
    }                                            // Past here, model might be valid

    // Step 3: Handle "not found"
    if model == nil {                            // Service returned nil = not found
        app.notFoundResponse(w, r)               // Send a 404 response
        return                                   // Stop processing
    }                                            // Past here, model exists

    // Step 4: Write the success response
    app.WriteJSON(w, http.StatusOK, model, nil)  // 200 OK with the model as JSON
                                                 // WriteJSON handles Content-Type and encoding
}                                                // Handler complete
```

**What just happened?** This is the standard handler pattern in BFF code:

1. **Extract** URL parameters with `ps.ByName()`
2. **Call** the service layer with those parameters
3. **Handle** errors (500) and not-found (404)
4. **Respond** with the data (200)

Every handler follows this extract -> call -> handle errors -> respond pattern. Once you've seen it a few times, writing new handlers becomes mechanical.

### Handling 404 and 405 globally

`httprouter` lets you set custom handlers for "route not found" (404) and "method not allowed" (405):

```go
router := httprouter.New()                       // Create the router

router.NotFound = http.HandlerFunc(              // When no route matches the path
    app.notFoundResponse,                        // Use our custom 404 handler
)                                                // Sends a JSON error, not HTML

router.MethodNotAllowed = http.HandlerFunc(      // When path matches but method doesn't
    app.methodNotAllowedResponse,                // Use our custom 405 handler
)                                                // e.g., POST to a GET-only endpoint
```

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Explain why BFF code uses `httprouter` instead of raw `net/http`
- Read URL path parameters with `ps.ByName("paramName")`
- Define routes with `router.GET()`, `router.POST()`, etc.
- Write a handler that follows the extract -> call -> handle -> respond pattern
- Set up custom 404/405 handlers on the router

</div>

## Building a Mini API

Let's put it all together with a small but complete API server. This has three endpoints: health check, list models, and get a model by ID.

### Step 1: The route definitions

```go
func (app *App) Routes() http.Handler {          // Returns an http.Handler (the router)
                                                 // Called once at startup

    router := httprouter.New()                   // Create a new router

    router.NotFound = http.HandlerFunc(          // Custom 404 handler
        app.notFoundResponse)                    // Returns JSON, not HTML
    router.MethodNotAllowed = http.HandlerFunc(  // Custom 405 handler
        app.methodNotAllowedResponse)            // Returns JSON, not HTML

    // Health check -- no auth needed
    router.GET("/healthcheck",                   // Simple GET endpoint
        app.HealthCheckHandler)                  // Returns {"status": "healthy"}

    // API routes
    router.GET("/api/v1/models/:namespace",      // List models in a namespace
        app.ListModelsHandler)                   // URL param: :namespace

    router.GET("/api/v1/models/:namespace/:id",  // Get a specific model
        app.GetModelHandler)                     // URL params: :namespace and :id

    return router                                // Return the configured router
                                                 // It implements http.Handler
}
```

### Step 2: The handlers

```go
// Health check -- the simplest possible handler
func (app *App) HealthCheckHandler(              // Method on App
    w http.ResponseWriter,                       // Response writer
    r *http.Request,                             // Request (unused but required)
    ps httprouter.Params,                        // Params (unused but required)
) {                                              // Every BFF needs this endpoint
    app.WriteJSON(w, http.StatusOK,              // 200 OK
        map[string]string{"status": "healthy"},  // Simple map for the response
        nil)                                     // No extra headers
}                                                // That's the whole handler

// List models -- reads query params and returns a list
func (app *App) ListModelsHandler(               // Method on App
    w http.ResponseWriter,                       // Response writer
    r *http.Request,                             // Request -- needed for query params
    ps httprouter.Params,                        // URL params -- has :namespace
) {                                              // Handler that returns a list
    namespace := ps.ByName("namespace")          // Extract :namespace from URL path

    models, err := app.modelService.List(        // Call service to get models
        r.Context(),                             // Pass request context
        namespace,                               // For this namespace
    )                                            // Returns ([]Model, error)
    if err != nil {                              // If service failed...
        app.serverErrorResponse(w, r, err)       // ...500 Internal Server Error
        return                                   // ...stop here
    }                                            // Past here, models is valid

    app.WriteJSON(w, http.StatusOK,              // 200 OK
        map[string]any{                          // Response with models and count
            "models": models,                    // The list of models
            "total":  len(models),               // How many there are
        }, nil)                                  // No extra headers
}                                                // Handler complete

// Get model by ID -- reads URL params and returns one model
func (app *App) GetModelHandler(                 // Method on App
    w http.ResponseWriter,                       // Response writer
    r *http.Request,                             // Request
    ps httprouter.Params,                        // URL params -- has :namespace and :id
) {                                              // Handler that returns a single model
    namespace := ps.ByName("namespace")          // Extract :namespace
    id := ps.ByName("id")                        // Extract :id

    model, err := app.modelService.GetModel(     // Call service to get one model
        r.Context(),                             // Pass request context
        namespace,                               // In this namespace
        id,                                      // With this ID
    )                                            // Returns (*Model, error)
    if err != nil {                              // If service failed...
        app.serverErrorResponse(w, r, err)       // ...500
        return                                   // ...stop
    }                                            // Past here, no service error

    if model == nil {                            // If the model doesn't exist...
        app.notFoundResponse(w, r)               // ...404
        return                                   // ...stop
    }                                            // Past here, model exists

    app.WriteJSON(w, http.StatusOK, model, nil)  // 200 with the model
}                                                // Handler complete
```

### Step 3: Starting the server

```go
func main() {                                   // Program entry point
    logger := slog.Default()                     // Create a structured logger
    config := loadConfig()                       // Load configuration from env/flags

    app := api.NewApp(logger, config)            // Create the App with dependencies
                                                 // NewApp is the factory function pattern

    router := app.Routes()                       // Build all the routes

    addr := fmt.Sprintf(":%d", config.Port)      // Format the address string
                                                 // e.g., ":8080"
    logger.Info("starting server", "addr", addr)  // Log the startup
                                                 // Structured logging with key-value pairs

    err := http.ListenAndServe(addr, router)     // Start the HTTP server
                                                 // This BLOCKS -- runs forever
                                                 // Only returns if there's an error
    if err != nil {                              // If the server crashed...
        logger.Error("server failed",            // ...log the error
            "error", err)                        // ...with structured key-value
    }                                            // Program exits
}
```

**What just happened?** We built a complete API server with three endpoints. The `main` function creates the app, builds the routes, and starts the server. The `Routes` method defines all endpoints in one place. Each handler follows the same pattern: extract params, call service, handle errors, respond.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Set up a complete `Routes()` method with multiple endpoints
- Write a health check handler (the simplest handler)
- Write list and get-by-ID handlers
- Start the server with `http.ListenAndServe`
- Follow the standard handler pattern: extract -> call -> handle -> respond

</div>

## Reading Auth Headers

Authentication in the ODH Dashboard BFF works through HTTP headers. The backend sets `kubeflow-userid` and `kubeflow-groups` headers (or uses an `Authorization: Bearer` token). Your handlers read these to identify the user:

```go
func (app *App) SomeProtectedHandler(            // A handler that needs auth
    w http.ResponseWriter,                        // Response writer
    r *http.Request,                              // Request -- has the auth headers
    ps httprouter.Params,                         // URL params
) {                                               // Handler body starts
    userID := r.Header.Get("kubeflow-userid")     // Read the user identity header
                                                  // Set by the auth proxy or middleware
    groups := r.Header.Get("kubeflow-groups")     // Read the user's groups
                                                  // Used for RBAC checks
    token := r.Header.Get("Authorization")        // Read the Bearer token
                                                  // For RHOAI deployments

    if userID == "" && token == "" {              // If neither auth method is present...
        app.unauthorizedResponse(w, r,            // ...send a 401
            fmt.Errorf("missing credentials"))    // with an error message
        return                                    // ...stop processing
    }                                             // Past here, user is identified

    // Use userID, groups, or token for authorization checks
    app.logger.Info("request from user",          // Log who made the request
        "userID", userID,                         // Structured logging
        "groups", groups)                         // Key-value pairs for searchability
}
```

In practice, you won't write auth checking in every handler. The BFF uses middleware to extract and validate the identity before the handler runs. But understanding that auth comes from headers is important for debugging and testing.

## Side-by-Side Reference

| What you want | Express/Fastify | Go (httprouter) |
|---|---|---|
| Define a route | `app.get('/path', handler)` | `router.GET("/path", handler)` |
| URL params | `req.params.id` | `ps.ByName("id")` |
| Query params | `req.query.name` | `r.URL.Query().Get("name")` |
| Headers | `req.headers['x-token']` | `r.Header.Get("X-Token")` |
| Read JSON body | `req.body` (with middleware) | `json.NewDecoder(r.Body).Decode(&v)` |
| Send JSON | `res.json(data)` | `json.NewEncoder(w).Encode(data)` |
| Set status code | `res.status(201)` | `w.WriteHeader(http.StatusCreated)` |
| Set header | `res.set('key', 'val')` | `w.Header().Set("key", "val")` |
| URL param syntax | `:name` | `:name` (same!) |
| Handler signature | `(req, res) => {}` | `(w, r, ps) => {}` |

Notice that URL parameter syntax is identical (`:name`). The main differences are:
- **Response first, then request** in Go's handler signature (opposite of Express)
- **No automatic body parsing** -- you decode JSON explicitly
- **Headers before body** -- must set headers and status before writing

::: tip Key Takeaway
Go's `net/http` gives you `http.ResponseWriter` (for writing responses) and `*http.Request` (for reading requests). ODH Dashboard BFFs use `httprouter` on top for URL parameter support with `ps.ByName()`. Handlers follow the pattern: extract params, decode body, call service, handle errors, write response. Set headers and status code before writing the body -- this order is mandatory.
:::

::: info See Also
- [JSON](./json) -- encoding and decoding JSON in handlers
- [Error Handling](./error-handling) -- the error pattern in HTTP handlers
- [Functions & Methods](./functions-and-methods) -- handler methods on the App struct
- [Testing](./testing) -- testing handlers with `httptest`
:::
