# Writing Handlers

> **Where the work happens** -- handlers are the functions that receive requests, do the business logic, and send responses.

A handler is just a function that reads a request and writes a response. Same as Express. Instead of `(req, res) => { ... }`, you write `func(w, r, ps)`. The logic -- read params, call services, write JSON -- is identical.

## The Simplest Possible Handler

Let's start with the absolute simplest handler, then build up from there.

**Express version first:**

```typescript
app.get('/healthcheck', (req, res) => {            // Define a GET handler
  res.json({ status: 'healthy' });                 // Send JSON response
});
```

**Go version:**

```go
func (app *App) HealthcheckHandler(                // Handler is a method on App
    w http.ResponseWriter,                         // w is "res" -- write the response here
    r *http.Request,                               // r is "req" -- read the request from here
    _ httprouter.Params,                           // _ means "I don't need URL params"
) {
    err := app.WriteJSON(w, http.StatusOK,         // Write JSON with 200 status
        map[string]string{"status": "healthy"},    // The response body
        nil)                                       // No extra headers
    if err != nil {                                // Check if writing failed
        app.serverErrorResponse(w, r, err)         // Send 500 if it did
    }
}
```

**What just happened?** That's a complete, working handler. It writes `{"status":"healthy"}` with a 200 status code. The `_` for the params argument means "I have this parameter but I don't use it" -- Go's way of saying "yes, I know it's there."

## The Handler Signature

Every BFF handler has this exact signature:

```go
func (app *App) HandlerName(                       // Method on the App struct
    w http.ResponseWriter,                         // The response writer (like Express's res)
    r *http.Request,                               // The request (like Express's req)
    ps httprouter.Params,                          // URL path parameters (like Express's req.params)
) {
    // Handle the request
}
```

Let me map each parameter to what you already know:

| Go Parameter | Express Equivalent | Purpose |
|---|---|---|
| `app *App` | `this` / closure scope | Access to dependencies (logger, clients, repos) |
| `w http.ResponseWriter` | `res` | Write the HTTP response |
| `r *http.Request` | `req` | Read the HTTP request |
| `ps httprouter.Params` | `req.params` | URL path parameters (`:id`, `:name`) |

When I first saw `func (app *App)` at the start of every handler, I thought it was boilerplate noise. It's not -- that `app` gives every handler access to the database, logger, and config without global variables. It's like every Express handler having `this` bound to your application instance.

::: info Handler Structs in automl and autorag
gen-ai, maas, mlflow and core-bff hang handlers directly off `*App`. automl and autorag split them into per-domain structs -- `*PipelinesHandler`, `*K8sHandler`, `*S3Handler`, `*ModelRegistryHandler` -- each holding only the logger and repository it needs. The signature after the receiver is the same, and the route registers `app.pipelines.PipelineRunHandler` instead of `app.PipelineRunHandler`. Their helpers are package-level functions that take the logger explicitly: `writeJSON(w, status, data, headers)` and `badRequestResponse(logger, w, r, message)`. The examples below come from automl, so you'll see both styles on this page.
:::

## Reading Request Data

Before we build a real handler, let's learn how to read the different parts of a request. In Express, everything hangs off `req`. In Go, it's spread across `r`, `ps`, and context values.

### URL Path Parameters

```typescript
// Express: route is /api/v1/models/:id
const id = req.params.id;                          // Read URL param
```

```go
// Go: route is /api/v1/models/:id
id := ps.ByName("id")                             // Read URL param -- returns "" if missing
```

### Query Parameters

```typescript
// Express: URL is /api/v1/secrets?namespace=my-ns&type=storage
const namespace = req.query.namespace;             // "my-ns"
const secretType = req.query.type;                 // "storage"
const missing = req.query.nonexistent;             // undefined
```

```go
// Go: same URL
namespace := r.URL.Query().Get("namespace")        // "my-ns"
secretType := r.URL.Query().Get("type")            // "storage"
missing := r.URL.Query().Get("nonexistent")        // "" (empty string, not nil)
```

### Request Body (JSON)

```typescript
// Express: body-parser middleware already parsed it
const body = req.body as CreateRequest;            // Already an object
```

```go
// Go: you parse it explicitly
var request models.CreateRequest                   // Declare a variable with the expected type
err := app.ReadJSON(w, r, &request)                // Parse JSON body into the struct
if err != nil {                                    // Check for parse errors
    app.badRequestResponse(w, r, err)              // Send 400 with error details
    return                                         // Stop processing
}
```

### Context Values (from Middleware)

```typescript
// Express: middleware attached data to req
const namespace = req.namespace;                   // Set by attachNamespace middleware
const user = req.user;                             // Set by auth middleware
```

```go
// Go: middleware attached data to context
namespace, ok := r.Context().Value(                // Read from request context
    constants.NamespaceQueryParameterKey,          // The key (a constant)
).(string)                                         // Type assertion: "I expect a string"
                                                   // ok is true if the value exists and is a string

identity, ok := r.Context().Value(                 // Read user identity from context
    constants.RequestIdentityKey,                   // Another constant key
).(*kubernetes.RequestIdentity)                    // gen-ai: *integrations.RequestIdentity
```

::: info Constant Names Vary by BFF
Exact constant names differ between BFFs. The namespace context key is `NamespaceQueryParameterKey` in gen-ai but `NamespaceHeaderParameterKey` in all other BFFs (automl, autorag, maas, eval-hub, agent-ops, core-bff). Always check `internal/constants/` in the specific BFF you are working on.
:::

### Request Headers

```typescript
// Express
const authHeader = req.headers.authorization;      // Read a header
```

```go
// Go
authHeader := r.Header.Get("Authorization")        // Read a header -- case-insensitive
contentType := r.Header.Get("Content-Type")        // Another header
```

::: info Checkpoint
You now know how to read every part of a request: URL params (`ps.ByName`), query params (`r.URL.Query().Get`), body (`app.ReadJSON`), context values (`r.Context().Value`), and headers (`r.Header.Get`). Let's put it all together in real handlers.
:::

## Example 1: GET List Handler (automl BFF)

Here's a real handler from the automl BFF that lists secrets in a namespace (`internal/api/k8s_handler.go`). I'll show the Express version first, then the Go version:

**Express version:**

```typescript
app.get('/api/v1/secrets', async (req, res) => {   // GET handler for secrets
  // 1. Namespace from auth/namespace middleware
  const namespace = req.namespace;                 // Set by attachNamespace
  if (!namespace) {                                // Check it exists
    return res.status(400).json({ error: 'Missing namespace' });
  }

  // 2. Optional filter
  const secretType = req.query.type as string;     // Read optional param
  if (secretType && secretType !== 'storage') {    // Validate if present
    return res.status(400).json({ error: "type must be 'storage' or omitted" });
  }

  try {
    // 3. Fetch data as the user
    const secrets = await secretService.getFilteredSecrets(namespace, secretType);
    // 4. Send response
    res.json({ data: secrets });                   // Wrap in envelope
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: 'Forbidden' });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Go version:**

```go
// packages/automl/bff/internal/api/k8s_handler.go
func (h *K8sHandler) GetSecretsHandler(            // Handler method on K8sHandler
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    _ httprouter.Params,                           // No URL params needed (using _ to ignore)
) {
    ctx := r.Context()                             // The request context (holds middleware data)

    // 1. Get namespace from context (set by AttachNamespace middleware)
    namespace, ok := ctx.Value(constants.NamespaceHeaderParameterKey).(string)
    if !ok || namespace == "" {                    // Check if it was set
        badRequestResponse(h.logger, w, r,         // Send 400 error
            "missing namespace in context - ensure AttachNamespace middleware is used first")
        return                                     // MUST return after sending an error
    }

    // 2. Read and validate optional query parameter
    secretType := r.URL.Query().Get("type")        // Read "type" from query string
    if secretType != "" && secretType != "storage" { // Validate if present
        badRequestResponse(h.logger, w, r,
            "query parameter 'type' must be 'storage' or omitted")
        return
    }

    // 3. Call the repository; the K8s service reads the user's identity from ctx
    secrets, err := h.repo.GetFilteredSecrets(h.k8sService, ctx, namespace, secretType)
    if err != nil {                                // Map typed errors to HTTP codes
        switch {
        case errors.Is(err, kubernetes.ErrNotFound):
            notFoundResponseWithMessage(h.logger, w, r,
                fmt.Sprintf("namespace '%s' does not exist or is not accessible", namespace))
        case errors.Is(err, kubernetes.ErrForbidden):
            forbiddenResponse(h.logger, w, r, "insufficient permissions to access secrets in this namespace")
        case errors.Is(err, kubernetes.ErrUnauthorized):
            unauthorizedResponse(h.logger, w, r, "access unauthorized")
        default:
            serverErrorResponse(h.logger, w, r, err)
        }
        return
    }

    // 4. Write the JSON response
    err = writeJSON(w, http.StatusOK, SecretsEnvelope{Data: secrets}, nil)
    if err != nil {                                // Check if response writing failed
        serverErrorResponse(h.logger, w, r, err)   // Send 500 if it did
    }
}
```

The structure is nearly identical to Express. The biggest difference is error handling: Express uses `try/catch`, while Go checks each error explicitly with `if err != nil`. Every error branch sends a response and returns immediately. There's no exception unwinding -- you handle each failure at the point it occurs. The `errors.Is(err, kubernetes.ErrForbidden)` switch is the autox-core convention: the shared K8s service returns typed sentinel errors, and the handler turns them into status codes.

## Example 2: GET by ID Handler (automl BFF)

Handlers that read URL parameters use `ps.ByName()` (automl names the argument `params`):

**Express version:**

```typescript
app.get('/api/v1/pipeline-runs/:runId',            // Route with URL parameter
  async (req, res) => {
    const runId = req.params.runId;                // Read the URL param
    const run = await pipelinesRepo.getManagedRun(req.namespace, runId); // Fetch it
    res.json({ data: run });                       // Send response
  }
);
```

**Go version:**

```go
// packages/automl/bff/internal/api/pipelines_handler.go
func (h *PipelinesHandler) PipelineRunHandler(     // Handler for GET /api/v1/pipeline-runs/:runId
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    params httprouter.Params,                      // URL params -- this time we need them!
) {
    namespace, ok := r.Context().Value(constants.NamespaceHeaderParameterKey).(string)
    if !ok || namespace == "" {
        badRequestResponse(h.logger, w, r, "missing namespace in context - ensure AttachNamespace middleware is used first")
        return
    }

    runID := params.ByName("runId")                // Like req.params.runId in Express
    if runID == "" {                               // Check if it's empty
        badRequestResponse(h.logger, w, r, "missing runId parameter")
        return                                     // Stop
    }

    // The repository discovers the pipeline server and calls it as the user
    run, err := h.repo.GetManagedRun(r.Context(), namespace, runID)
    if err != nil {                                // Check for errors
        h.mapPipelineError(w, r, err)              // Typed errors → 400/403/404/503...
        return                                     // Stop
    }

    // Write the response
    if err := writeJSON(w, http.StatusOK, PipelineRunEnvelope{Data: run}, nil); err != nil {
        serverErrorResponse(h.logger, w, r, err)   // Send 500
    }
}
```

`PipelineRunEnvelope` is a named alias declared at the top of the file: `type PipelineRunEnvelope Envelope[*models.PipelineRun, None]`.

The route was registered as:

```go
// packages/automl/bff/internal/api/app.go
apiRouter.GET(PipelineRunsPath+"/:runId",          // :runId becomes a URL parameter
    app.mw.AttachNamespace(                        // Namespace from ?namespace=
        app.mw.RequireAccessToService(             // SSAR on DSPipelineApplications
            app.pipelines.PipelineRunHandler)))    // This handler
```

## Example 3: POST Handler (automl BFF)

POST handlers need to read and parse the request body. This is where Go's explicit parsing shines:

**Express version:**

```typescript
app.post('/api/v1/pipeline-runs',                  // POST handler
  async (req, res) => {
    const request = req.body as CreateAutoMLRunRequest; // Body already parsed by middleware
    const run = await pipelinesRepo.createRun(req.namespace, request); // Create the resource
    res.status(200).json({ data: run });
  }
);
```

**Go version:**

```go
// packages/automl/bff/internal/api/pipelines_handler.go (trimmed)
func (h *PipelinesHandler) CreatePipelineRunHandler(
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request (body is in here)
    _ httprouter.Params,                           // URL params (unused)
) {
    namespace, ok := r.Context().Value(constants.NamespaceHeaderParameterKey).(string)
    if !ok || namespace == "" {
        badRequestResponse(h.logger, w, r, "missing namespace in context - ensure AttachNamespace middleware is used first")
        return
    }

    // Read and parse the JSON request body -- strictly
    r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes) // 10 MiB cap
    var req models.CreateAutoMLRunRequest          // Declare a variable with the expected type
    decoder := json.NewDecoder(r.Body)
    decoder.DisallowUnknownFields()                // Reject typos in field names
    if err := decoder.Decode(&req); err != nil {
        var maxBytesErr *http.MaxBytesError
        if errors.As(err, &maxBytesErr) {          // Body too big → 413
            payloadTooLargeResponse(h.logger, w, r, "request body exceeds maximum size")
            return
        }
        badRequestResponse(h.logger, w, r, fmt.Sprintf("invalid request body: %s", err))
        return
    }

    // (trimmed: extra validation for time-series runs, which reads the CSV schema from S3)

    // Create the resource through the business logic layer
    run, err := h.repo.CreateRun(r.Context(), namespace, req)
    if err != nil {                                // Validation and upstream errors
        h.mapPipelineError(w, r, err)
        return
    }

    if err := writeJSON(w, http.StatusOK, CreatePipelineRunEnvelope{Data: run}, nil); err != nil {
        serverErrorResponse(h.logger, w, r, err)   // Send 500
    }
}
```

The critical difference from Express is the decode block:

```go
var req models.CreateAutoMLRunRequest              // Declare a variable with the expected struct type
decoder := json.NewDecoder(r.Body)                 // Like JSON.parse...
decoder.DisallowUnknownFields()                    // ...plus strict schema checking
err := decoder.Decode(&req)                        // Parse JSON body into it
```

In Express, `body-parser` middleware parses the body for you and it appears on `req.body`. In Go, you parse it explicitly. gen-ai and core-bff wrap this in an `app.ReadJSON(w, r, &req)` helper (see below) that also limits body size and returns descriptive errors; automl writes it inline with its own 10 MiB limit. Note that this endpoint answers `200 OK`, not `201 Created` -- REST conventions are not uniform across BFFs, so check the OpenAPI spec.

## Beyond POST: PUT, PATCH, and DELETE

You have seen GET (read) and POST (create). The other HTTP methods follow the same middleware + handler pattern -- only the response codes and body handling differ.

### DELETE -- Remove a Resource

DELETE handlers are the simplest write operation. No request body needed -- the resource ID comes from the URL:

```go
// packages/automl/bff/internal/api/pipelines_handler.go
func (h *PipelinesHandler) DeletePipelineRunHandler(
    w http.ResponseWriter,
    r *http.Request,
    params httprouter.Params,                      // URL params -- this time we use them
) {
    namespace, ok := r.Context().Value(constants.NamespaceHeaderParameterKey).(string)
    if !ok || namespace == "" {
        badRequestResponse(h.logger, w, r, "missing namespace in context - ensure AttachNamespace middleware is used first")
        return
    }
    runID := params.ByName("runId")                // read :runId from the URL path
    if runID == "" {
        badRequestResponse(h.logger, w, r, "missing runId parameter")
        return
    }

    if err := h.repo.DeleteRun(r.Context(), namespace, runID); err != nil {
        h.mapPipelineError(w, r, err)
        return
    }

    w.WriteHeader(http.StatusOK)                   // 200 with an empty body (some APIs use 204)
}
```

The route registration uses `apiRouter.DELETE`:

```go
apiRouter.DELETE(PipelineRunsPath+"/:runId",
    app.mw.AttachNamespace(
        app.mw.RequireAccessToService(
            app.pipelines.DeletePipelineRunHandler)))
```

### Quick Reference: Methods at a Glance

| Method | What It Does | Reads Body? | Typical Status | Example |
|---|---|---|---|---|
| `GET` | Read data | No | 200 OK | List models, get a secret |
| `POST` | Create a resource | Yes | 201 Created | Submit feedback, create a pipeline run |
| `DELETE` | Remove a resource | No | 200 OK or 204 | Delete a pipeline run, revoke a token |
| `PUT` | Replace a resource entirely | Yes | 200 OK | Update a full configuration |
| `PATCH` | Update specific fields | Yes | 200 OK | Change a resource's name or status |

::: tip PUT vs PATCH in Practice
Most BFF endpoints use POST for creation and DELETE for removal. PUT and PATCH are less common -- when they appear, PUT replaces the entire resource (send all fields) while PATCH updates specific fields (send only what changed). Check the OpenAPI spec for the exact contract.
:::

## Your Most Common Task: Modifying an Existing Handler

The tutorials teach you to create new handlers from scratch. In practice, your most common task will be modifying an existing one -- adding a query parameter, changing the response shape, or fixing a bug.

Here is the workflow:

**1. Find the handler.** Look in `internal/api/` for a file named after the feature. Model endpoints are in `lsd_models_handler.go`, MCP endpoints are split across `mcp_tools_handler.go` and `mcp_status_handler.go`. If you are not sure, grep for the URL path constant in `internal/constants/`.

**2. Find the route registration.** Open `app.go` and search for the handler function name. This tells you which middleware wraps it -- and therefore what data is already in the request context.

**3. Make your change.** Common modifications:

- **Adding a query parameter:** Read it with `r.URL.Query().Get("param")` in the handler. No middleware change needed.
- **Adding a field to the response:** Update the struct in `internal/models/`, then set the new field in the handler. Update the OpenAPI spec too.
- **Adding a new middleware to the chain:** Wrap the handler in `app.go` with the additional middleware. For example, adding `app.AttachNamespace(...)` to an endpoint that didn't previously require a namespace.
- **Changing error handling:** Find the `if err != nil` block and change the error helper or message.

**4. Update tests.** Find the `*_test.go` file next to the handler. Add or modify test cases in the table-driven test slice.

**5. Update the OpenAPI spec** in `openapi/src/*.yaml` if you changed the request or response shape.

::: tip Find It Fast
```bash
# Find which file handles a specific endpoint
grep -r "ModelsListPath\|/lsd/models" packages/gen-ai/bff/internal/

# Find where a handler is registered
grep -r "LlamaStackModelsHandler" packages/gen-ai/bff/internal/api/app.go
```
:::

## Writing Responses

### The WriteJSON Helper

Every BFF has a JSON-writing helper in `internal/api/helpers.go`. In gen-ai, maas and core-bff it is a method, `app.WriteJSON`; in automl and autorag it is the package-level `writeJSON` with the same body:

```go
func (app *App) WriteJSON(                         // Helper to send JSON responses
    w http.ResponseWriter,                         // The response writer
    status int,                                    // HTTP status code (200, 201, 400, etc.)
    data any,                                      // The data to serialize (any type)
    headers http.Header,                           // Extra headers (usually nil)
) error {                                          // Returns error if serialization fails
    js, err := json.MarshalIndent(data, "", "\t")  // Convert data to formatted JSON bytes
    if err != nil {                                // Check for serialization failure
        return err                                 // Return the error (caller handles it)
    }
    js = append(js, '\n')                          // Add trailing newline for readability

    for key, value := range headers {              // Add any extra headers
        w.Header()[key] = value                    // Set each header
    }

    w.Header().Set("Content-Type", "application/json") // Set content type
    w.WriteHeader(status)                          // Write the status code
    _, err = w.Write(js)                           // Write the JSON body
    return err                                     // Return any write error
}
```

This is the equivalent of `res.status(200).json(data)` in Express. One function that handles serialization, headers, status code, and writing.

::: info WriteJSON Marshaling Varies
Most BFFs use `json.MarshalIndent` (pretty-printed JSON with tabs). However, [core-bff](/guide/core-bff/) and mlflow use `json.Marshal` (compact JSON, no indentation). The function signature and behavior are otherwise identical.
:::

### The ReadJSON Helper

`ReadJSON` does much more than just decoding JSON. It validates the body and returns descriptive errors:

```go
func (app *App) ReadJSON(                          // Helper to parse JSON request bodies
    w http.ResponseWriter,                         // Response writer (for MaxBytesReader)
    r *http.Request,                               // The request (body is here)
    dst any,                                       // Destination: pointer to struct to fill
) error {                                          // Returns descriptive error on failure
    maxBytes := 1_048_576                          // Limit body to 1MB
    r.Body = http.MaxBytesReader(w, r.Body, int64(maxBytes)) // Enforce the limit

    dec := json.NewDecoder(r.Body)                 // Create a JSON decoder for the body
    dec.DisallowUnknownFields()                    // Reject JSON with extra fields

    err := dec.Decode(dst)                         // Decode JSON into the destination struct
    if err != nil {                                // Handle specific error types:
        // Returns user-friendly messages like:
        // - "body contains badly-formed JSON (at character 42)"
        // - "body contains incorrect JSON type for field 'name'"
        // - "body must not be empty"
        // - "body must not be larger than 1048576 bytes"
        // - "body contains unknown key 'foo'"
        return err                                 // Return the descriptive error
    }

    // Reject bodies with multiple JSON values
    err = dec.Decode(&struct{}{})                   // Try to decode a second value
    if !errors.Is(err, io.EOF) {                   // If there IS more data...
        return errors.New("body must only contain a single JSON value") // Reject it
    }

    return nil                                     // Success -- dst is now populated
}
```

This is the Go equivalent of Express's `express.json()` middleware with strict validation. In Express, malformed JSON gives you a generic parse error. Here, you get specific, user-friendly error messages. The `DisallowUnknownFields()` call is especially nice -- it catches typos in request bodies.

### The Envelope Pattern

Responses are wrapped in an envelope struct for consistency:

```go
type Envelope[D any, M any] struct {               // Generic envelope with data and metadata
    Data     D `json:"data"`                       // The main data
    Metadata M `json:"metadata,omitempty"`         // Optional metadata (pagination, etc.)
}

type None *struct{}                                // "No metadata" marker type
```

Usage in handlers:

```go
// Simple response: { "data": [...] }
app.WriteJSON(w, http.StatusOK,                    // 200 OK
    Envelope[[]models.Secret, None]{Data: secrets}, // Data only, no metadata
    nil)

// Response with pagination: { "data": [...], "metadata": { "total": 42 } }
app.WriteJSON(w, http.StatusOK,                    // 200 OK
    Envelope[[]models.Run, *models.Pagination]{    // Data + metadata
        Data:     runs,                            // The list of runs
        Metadata: &models.Pagination{Total: total, Page: page}, // Pagination info
    }, nil)
```

## The Handler Pattern -- Step by Step

Most handlers follow this exact pattern. Once you've seen it a few times, you can write one from memory:

```go
func (app *App) SomeHandler(                       // 1. Method on App
    w http.ResponseWriter,                         // 2. Response writer
    r *http.Request,                               // 3. Request
    ps httprouter.Params,                          // 4. URL params
) {
    // Step 1: Extract context values from middleware
    // Step 2: Read URL params, query params, or request body
    // Step 3: Validate inputs
    // Step 4: Get the right client (K8s, pipeline server, etc.)
    // Step 5: Call the repository/service layer
    // Step 6: Handle errors
    // Step 7: Write the JSON response
}
```

::: warning Common Mistake -- Forgetting to Return
In Go, `return` does NOT automatically send a response. You must call `app.WriteJSON()` or an error helper before returning. And you must `return` after sending an error response, or the handler keeps running:

```go
// BUG: returns without sending a response
if namespace == "" {                               // Check failed
    return                                         // Client gets empty 200! No error message!
}

// BUG: sends error but forgets to return
if namespace == "" {                               // Check failed
    app.badRequestResponse(w, r, fmt.Errorf("namespace is required")) // Send 400
    // MISSING RETURN -- execution continues to WriteJSON below!
    // This panics because headers were already sent
}
app.WriteJSON(w, http.StatusOK, data, nil)         // This runs even after the error!

// CORRECT: send error response THEN return
if namespace == "" {                               // Check failed
    app.badRequestResponse(w, r,                   // Send 400 error
        fmt.Errorf("namespace is required"))
    return                                         // Stop execution here
}
app.WriteJSON(w, http.StatusOK, data, nil)         // Only runs if namespace is valid
```
:::

::: tip Key Takeaway
BFF handlers follow a consistent pattern: extract context values from middleware, read request data (params, query, body), validate inputs, call the service layer, and write a JSON response. The `WriteJSON` helper is your `res.json()` and the `ReadJSON` helper is your body parser. Every error branch must either call an error helper or write a response before returning.
:::

::: info See Also
- [Middleware Chain](./middleware) -- how context values get set before your handler runs
- [Models & DTOs](./models) -- the structs that define request/response shapes
- [Error Handling](./error-handling) -- the error helper functions in detail
- [Debugging](./debugging) -- when your handler does not work as expected
- [Advanced Patterns](./advanced-patterns) -- SSE streaming and goroutines beyond standard request-response
:::
