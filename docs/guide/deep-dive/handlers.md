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
).(*kubernetes.RequestIdentity)                    // Type assertion: "I expect a *RequestIdentity"
```

::: info Constant Names Vary by BFF
Exact constant names may differ between BFFs. For example, the namespace context key may be called `NamespaceQueryParameterKey` in the gen-ai BFF but use a different name in other BFFs. Always check `internal/constants/` in the specific BFF you are working on.
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

## Example 1: GET List Handler

Here's a real handler from the automl BFF that lists secrets in a namespace. I'll show the Express version first, then the Go version:

**Express version:**

```typescript
app.get('/api/v1/secrets', async (req, res) => {   // GET handler for secrets
  // 1. Identity comes from auth middleware
  const identity = req.user;                       // Set by auth middleware
  if (!identity) {                                 // Check it exists
    return res.status(400).json({ error: 'Missing identity' });
  }

  // 2. Namespace from query string
  const namespace = req.query.namespace as string;  // Read query param
  if (!namespace) {                                // Validate
    return res.status(400).json({ error: 'Missing namespace' });
  }

  // 3. Optional filter
  const secretType = req.query.type as string;     // Read optional param
  if (secretType && secretType !== 'storage') {    // Validate if present
    return res.status(400).json({ error: "type must be 'storage' or omitted" });
  }

  try {
    // 4-5. Get client and fetch data
    const secrets = await secretService.getFilteredSecrets(
      namespace, identity, secretType              // Call the service layer
    );
    // 6. Send response
    res.json({ data: secrets });                   // Wrap in envelope
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Go version:**

```go
func (app *App) GetSecretsHandler(                 // Handler method on App
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    _ httprouter.Params,                           // No URL params needed (using _ to ignore)
) {
    ctx := r.Context()                             // Get the request context (holds middleware data)

    // 1. Get user identity from context (set by InjectRequestIdentity middleware)
    identity, ok := ctx.Value(                     // Read from context
        constants.RequestIdentityKey,              // The key constant
    ).(*kubernetes.RequestIdentity)                 // Type assertion: expect *RequestIdentity
    if !ok || identity == nil {                    // Check if it was set and is the right type
        app.badRequestResponse(w, r,               // Send 400 error
            fmt.Errorf("missing RequestIdentity in context"))
        return                                     // MUST return after sending an error
    }

    // 2. Get namespace from context (set by AttachNamespace middleware)
    namespace, ok := ctx.Value(                    // Read from context
        constants.NamespaceQueryParameterKey,      // The key constant
    ).(string)                                     // Type assertion: expect string
    if !ok || namespace == "" {                    // Check if it was set
        app.badRequestResponse(w, r,               // Send 400 error
            fmt.Errorf("missing namespace in context"))
        return                                     // Stop processing
    }

    // 3. Read and validate optional query parameter
    secretType := r.URL.Query().Get("type")        // Read "type" from query string
    if secretType != "" && secretType != "storage" { // Validate if present
        app.badRequestResponse(w, r,               // Send 400 error
            fmt.Errorf("query parameter 'type' must be 'storage' or omitted"))
        return                                     // Stop processing
    }

    // 4. Get a Kubernetes client
    client, err := app.kubernetesClientFactory.GetClient(ctx) // Create/get a K8s client
    if err != nil {                                // Check for client creation failure
        app.serverErrorResponse(w, r,              // Send 500 error
            fmt.Errorf("failed to get Kubernetes client: %w", err))
        return                                     // Stop processing
    }

    // 5. Call the repository to get data
    secrets, err := app.repositories.Secret.GetFilteredSecrets( // Business logic layer
        client, ctx, namespace, identity, secretType, // Pass everything it needs
    )
    if err != nil {                                // Check for data fetch failure
        app.serverErrorResponse(w, r, err)         // Send 500 error
        return                                     // Stop processing
    }

    // 6. Write the JSON response
    err = app.WriteJSON(w, http.StatusOK,          // Write 200 OK with JSON body
        SecretsEnvelope{Data: secrets}, nil)        // Wrap data in envelope
    if err != nil {                                // Check if response writing failed
        app.serverErrorResponse(w, r, err)         // Send 500 if it did
    }
}
```

**What just happened?** The structure is nearly identical to Express. The biggest difference is error handling: Express uses `try/catch`, while Go checks each error explicitly with `if err != nil`. Every error branch sends a response and returns immediately. There's no exception unwinding -- you handle each failure at the point it occurs.

## Example 2: GET by ID Handler (automl BFF)

Handlers that read URL parameters use `ps.ByName()`:

**Express version:**

```typescript
app.get('/api/v1/pipeline-runs/:runId',            // Route with URL parameter
  async (req, res) => {
    const runId = req.params.runId;                // Read the URL param
    const run = await pipelineClient.getPipelineRun(runId); // Fetch it
    res.json({ data: run });                       // Send response
  }
);
```

**Go version:**

```go
func (app *App) PipelineRunHandler(                // Handler for GET /api/v1/pipeline-runs/:runId
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    ps httprouter.Params,                          // URL params -- this time we need them!
) {
    ctx := r.Context()                             // Get the request context

    // Read :runId from the URL path
    runID := ps.ByName("runId")                    // Like req.params.runId in Express
    if runID == "" {                               // Check if it's empty
        app.badRequestResponse(w, r,               // Send 400
            fmt.Errorf("missing run ID"))
        return                                     // Stop
    }

    // Get the pipeline server client from context (set by AttachPipelineServerClient middleware)
    pipelineClient, ok := ctx.Value(               // Read from context
        constants.PipelineServerClientKey,          // The key set by middleware
    ).(pipelineserver.PipelineServerClientInterface) // Type assertion
    if !ok || pipelineClient == nil {              // Check if middleware set it
        app.badRequestResponse(w, r,               // Send 400 if missing
            fmt.Errorf("missing pipeline server client in context"))
        return                                     // Stop
    }

    // Fetch the pipeline run
    run, err := pipelineClient.GetPipelineRun(ctx, runID) // Call the upstream service
    if err != nil {                                // Check for errors
        app.serverErrorResponse(w, r, err)         // Send 500
        return                                     // Stop
    }

    // Write the response
    err = app.WriteJSON(w, http.StatusOK,          // 200 OK
        Envelope[*models.PipelineRun, None]{Data: run}, // Wrap in envelope
        nil)                                       // No extra headers
    if err != nil {                                // Check if writing failed
        app.serverErrorResponse(w, r, err)         // Send 500
    }
}
```

The route was registered as:

```go
apiRouter.GET("/api/v1/pipeline-runs/:runId",      // :runId becomes a URL parameter
    /* middleware chain */                          // AttachNamespace, RequireAccess, etc.
    app.PipelineRunHandler)                        // This handler
```

## Example 3: POST Handler (automl BFF)

POST handlers need to read and parse the request body. This is where Go's explicit parsing shines:

**Express version:**

```typescript
app.post('/api/v1/pipeline-runs',                  // POST handler
  async (req, res) => {
    const request = req.body as CreatePipelineRunRequest; // Body already parsed by middleware

    if (!request.pipelineType) {                   // Validate
      return res.status(400).json({ error: 'pipelineType is required' });
    }

    const run = await pipelineRunService.create(request); // Create the resource
    res.status(201).json({ data: run });           // 201 Created
  }
);
```

**Go version:**

```go
func (app *App) CreatePipelineRunHandler(          // POST handler for creating pipeline runs
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request (body is in here)
    ps httprouter.Params,                          // URL params
) {
    ctx := r.Context()                             // Get request context

    // Read and parse the JSON request body
    var request models.CreatePipelineRunRequest     // Declare a variable with the expected type
    err := app.ReadJSON(w, r, &request)            // Parse JSON body into the struct
    if err != nil {                                // Check for parse errors
        app.badRequestResponse(w, r, err)          // Send 400 with descriptive error
        return                                     // Stop processing
    }

    // Validate required fields
    if request.PipelineType == "" {                // Check for required field
        app.badRequestResponse(w, r,               // Send 400
            fmt.Errorf("pipelineType is required"))
        return                                     // Stop
    }

    // Get clients from context (set by middleware)
    pipelineClient, ok := ctx.Value(               // Read pipeline client from context
        constants.PipelineServerClientKey,
    ).(pipelineserver.PipelineServerClientInterface)
    if !ok || pipelineClient == nil {              // Check if middleware set it
        app.badRequestResponse(w, r,               // Send 400
            fmt.Errorf("missing pipeline server client"))
        return                                     // Stop
    }

    // Create the resource through the business logic layer
    run, err := app.repositories.PipelineRun.Create( // Call repository
        pipelineClient, ctx, &request,             // Pass client, context, and request
    )
    if err != nil {                                // Check for creation failure
        app.serverErrorResponse(w, r, err)         // Send 500
        return                                     // Stop
    }

    // Return 201 Created with the new resource
    err = app.WriteJSON(w, http.StatusCreated,     // 201 Created (not 200 OK!)
        Envelope[*models.PipelineRun, None]{Data: run}, // Wrap in envelope
        nil)                                       // No extra headers
    if err != nil {                                // Check if writing failed
        app.serverErrorResponse(w, r, err)         // Send 500
    }
}
```

**What just happened?** The critical difference from Express is this line:

```go
var request models.CreatePipelineRunRequest        // Declare a variable with the expected struct type
err := app.ReadJSON(w, r, &request)                // Parse JSON body into it (like JSON.parse + validation)
```

In Express, `body-parser` middleware parses the body for you and it appears on `req.body`. In Go, you parse it explicitly with `ReadJSON`. The advantage: `ReadJSON` rejects unknown fields, checks for malformed JSON, limits body size, and returns descriptive errors. It's like having a strict body parser built into every handler.

## Writing Responses

### The WriteJSON Helper

Every BFF has a `WriteJSON` helper in `internal/api/helpers.go`:

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

**What just happened?** This is the Go equivalent of Express's `express.json()` middleware with strict validation. In Express, malformed JSON gives you a generic parse error. Here, you get specific, user-friendly error messages. The `DisallowUnknownFields()` call is especially nice -- it catches typos in request bodies.

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
:::
