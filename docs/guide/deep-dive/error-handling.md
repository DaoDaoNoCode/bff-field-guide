# Error Handling

> **Consistent error responses** -- the standard error envelope, helper functions, and patterns that ensure every BFF returns errors the frontend can parse.

Every error in the BFF becomes a JSON response your React code can understand. That's the contract. No matter what goes wrong -- bad input, permission denied, server crash -- the frontend always gets the same JSON shape. Let's see how that works.

::: info Error Types Vary in Go, Not in JSON
The Go struct names for errors differ between BFFs (some use `ErrorEnvelope` wrapping `integrations.HTTPError`, others use `HTTPError` with an `ErrorPayload` field). But the JSON output is always the same: `{ "error": { "code": "...", "message": "..." } }`. Your React code can rely on this shape regardless of which BFF it's talking to.
:::

## What Your React Code Sees

Before we look at the Go side, let's start from the consumer's perspective. When something goes wrong, your React code gets a response like this:

```json
{
    "error": {
        "code": "400",
        "message": "missing required query parameter: namespace"
    }
}
```

And your frontend parses it like this:

```typescript
async function fetchSecrets(namespace: string): Promise<SecretListItem[]> {
  const response = await fetch(                    // Make the API call
    `/api/v1/secrets?namespace=${namespace}`);

  if (!response.ok) {                              // Check for errors (status >= 400)
    const body = await response.json();            // Parse the error body
    const errorMessage = body?.error?.message || 'Unknown error'; // Extract the message

    if (response.status === 403) {                 // Handle specific status codes
      throw new ForbiddenError(errorMessage);      // "user does not have permission"
    }
    if (response.status === 404) {                 // Not found
      throw new NotFoundError(errorMessage);       // "the requested resource could not be found"
    }
    throw new ApiError(response.status, errorMessage); // Generic error
  }

  const { data } = await response.json();          // Parse successful response
  return data;                                     // Return the data
}
```

**What just happened?** The consistent error envelope means the frontend can always do `body.error.message` regardless of the error type. No guessing, no special cases. This is why the BFF standardizes on the same JSON shape for every error.

## The Error Envelope -- Three Structs Working Together

The error JSON comes from three Go types:

**First, the core error fields:**

```go
// internal/integrations/http.go -- shared across all BFFs

type ErrorResponse struct {                        // The fields that appear in JSON
    Code    string `json:"code"`                   // HTTP status code as a string (e.g., "400")
    Message string `json:"message"`                // Human-readable error message
}
```

**Next, the HTTP-aware error that adds a status code:**

```go
type HTTPError struct {                            // Extends ErrorResponse with HTTP info
    StatusCode int `json:"-"`                      // HTTP status code as int -- NOT in JSON (json:"-")
    ErrorResponse                                  // Embedded -- Code and Message are "promoted"
}

func (e *HTTPError) Error() string {               // Implements Go's error interface
    return fmt.Sprintf("HTTP %d: %s - %s",        // Format for logging
        e.StatusCode, e.Code, e.Message)           // e.g., "HTTP 400: 400 - missing namespace"
}
```

**Finally, the envelope that wraps it:**

```go
// internal/api/errors.go -- in each BFF

type ErrorEnvelope struct {                        // The outermost wrapper
    Error *integrations.HTTPError `json:"error"`   // Nests the error under an "error" key
}
```

Notice two important details:

1. `StatusCode` has `` `json:"-"` `` -- it drives the HTTP response status code but never appears in the JSON body. The status code lives in the HTTP header, the string version lives in the JSON.

2. `ErrorResponse` is **embedded** in `HTTPError` (no field name). This means `HTTPError` gets `Code` and `Message` as if they were its own fields. You can access `err.Code` directly -- they're promoted from the embedded struct.

::: info Checkpoint
You now know the three-struct pattern: `ErrorResponse` (JSON fields), `HTTPError` (adds status code), `ErrorEnvelope` (wraps it under `"error"` key). Let's see the helper functions that create these.
:::

## Error Helper Functions

Every BFF has a set of helper functions in `internal/api/errors.go`. Each one creates the right status code and message for a specific error type. Let's walk through them one at a time.

### badRequestResponse -- 400

The client sent something wrong. This is the most common error in handlers:

```go
func (app *App) badRequestResponse(                // 400 Bad Request -- invalid input from the client
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request (for logging)
    err error,                                     // The specific error (sent to client!)
) {
    httpError := &integrations.HTTPError{           // Create the error struct
        StatusCode: http.StatusBadRequest,          // 400
        ErrorResponse: integrations.ErrorResponse{  // The JSON fields
            Code:    strconv.Itoa(http.StatusBadRequest), // "400"
            Message: err.Error(),                  // The actual error message -- client needs to know
        },
    }
    app.errorResponse(w, r, httpError)             // Send it (see below)
}
```

**When the React code sees this:**

```typescript
// response.status === 400
// body.error.code === "400"
// body.error.message === "missing required query parameter: namespace"
// The message tells the user exactly what they did wrong
```

### unauthorizedResponse -- 401

Missing or invalid credentials:

```go
func (app *App) unauthorizedResponse(              // 401 Unauthorized -- missing/invalid credentials
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    err error,                                     // The auth error
) {
    httpError := &integrations.HTTPError{           // Create the error struct
        StatusCode: http.StatusUnauthorized,        // 401
        ErrorResponse: integrations.ErrorResponse{
            Code:    strconv.Itoa(http.StatusUnauthorized), // "401"
            Message: err.Error(),                  // Message from the auth error
        },
    }
    app.errorResponse(w, r, httpError)             // Send it
}
```

**When the React code sees this:**

```typescript
// response.status === 401
// body.error.message === "missing authorization header" (or similar auth error)
```

### forbiddenResponse -- 403

Authenticated but not allowed:

```go
func (app *App) forbiddenResponse(                 // 403 Forbidden -- authenticated but not authorized
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    message string,                                // The specific reason
) {
    httpError := &integrations.HTTPError{           // Create the error struct
        StatusCode: http.StatusForbidden,           // 403
        ErrorResponse: integrations.ErrorResponse{
            Code:    strconv.Itoa(http.StatusForbidden), // "403"
            Message: message,                      // The reason -- "user does not have permission"
        },
    }
    app.errorResponse(w, r, httpError)             // Send it
}
```

**When the React code sees this:**

```typescript
// response.status === 403
// body.error.message === "user does not have permission in this namespace"
// The frontend can show this message to the user
```

### notFoundResponse -- 404

Resource doesn't exist:

```go
func (app *App) notFoundResponse(                  // 404 Not Found -- resource doesn't exist
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
) {
    httpError := &integrations.HTTPError{           // Create the error struct
        StatusCode: http.StatusNotFound,            // 404
        ErrorResponse: integrations.ErrorResponse{
            Code:    strconv.Itoa(http.StatusNotFound), // "404"
            Message: "the requested resource could not be found", // Generic message
        },
    }
    app.errorResponse(w, r, httpError)             // Send it
}
```

### serverErrorResponse -- 500

Something went wrong on our side. This one is special -- it logs the real error but sends a generic message:

```go
func (app *App) serverErrorResponse(               // 500 Internal Server Error -- our fault
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    err error,                                     // The REAL error (logged, NOT sent to client)
) {
    app.LogError(r, err)                           // Log the actual error for debugging

    httpError := &integrations.HTTPError{           // Create the error struct
        StatusCode: http.StatusInternalServerError, // 500
        ErrorResponse: integrations.ErrorResponse{
            Code:    strconv.Itoa(http.StatusInternalServerError), // "500"
            Message: "the server encountered a problem and could not process your request",
            // NOTE: NOT err.Error() -- never leak internal details to the client!
        },
    }
    app.errorResponse(w, r, httpError)             // Send it
}
```

**When the React code sees this:**

```typescript
// response.status === 500
// body.error.message === "the server encountered a problem..."
// The REAL error ("failed to connect to K8s cluster: connection refused")
// is in the server logs, not in the response
```

### serviceUnavailableResponse -- 503

An upstream service is down:

```go
func (app *App) serviceUnavailableResponse(        // 503 Service Unavailable -- upstream is down
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    err error,                                     // The real error (logged, not sent)
) {
    app.LogError(r, err)                           // Log the actual error

    httpError := &integrations.HTTPError{           // Create the error struct
        StatusCode: http.StatusServiceUnavailable,  // 503
        ErrorResponse: integrations.ErrorResponse{
            Code:    strconv.Itoa(http.StatusServiceUnavailable), // "503"
            Message: "service temporarily unavailable", // Generic message
        },
    }
    app.errorResponse(w, r, httpError)             // Send it
}
```

## The Core: errorResponse

All the helpers above call `errorResponse`, which does the actual JSON writing:

```go
func (app *App) errorResponse(                     // The single exit point for ALL error responses
    w http.ResponseWriter,                         // Response writer
    r *http.Request,                               // Request
    error *integrations.HTTPError,                 // The error to send
) {
    env := ErrorEnvelope{Error: error}             // Wrap in the envelope: { "error": {...} }

    err := app.WriteJSON(w, error.StatusCode, env, nil) // Write JSON with the right status code
    if err != nil {                                // If we can't even write the error response...
        app.LogError(r, err)                       // Log the failure
        w.WriteHeader(error.StatusCode)            // At least send the status code
    }
}
```

This is the single exit point for all error responses. It ensures:
1. The response is always valid JSON (wrapped in `ErrorEnvelope`)
2. The HTTP status code matches the error
3. The content type is `application/json`
4. If JSON writing itself fails, we at least send the status code

### LogError

Errors are logged with request context for debugging:

```go
func (app *App) LogError(                          // Log an error with request context
    r *http.Request,                               // Request (for method and URI)
    err error,                                     // The error to log
) {
    var (
        method = r.Method                          // GET, POST, etc.
        uri    = r.URL.Path                        // /api/v1/secrets
    )
    app.logger.Error(err.Error(),                  // Log the error message
        "method", method, "uri", uri)              // With request context
}
```

The log output:

```
time=2024-01-15T10:30:00.000Z level=ERROR msg="failed to get Kubernetes client: connection refused" method=GET uri=/api/v1/secrets
```

::: info Checkpoint
You now know every error helper: 400 (bad input), 401 (no credentials), 403 (no permission), 404 (not found), 500 (server error), 503 (upstream down). They all flow through `errorResponse` which writes consistent JSON. Let's see how these are used in a real handler.
:::

## The 500 Error Security Pattern

Let me call special attention to the difference between 400 and 500 errors, because it's an important security pattern.

**400 errors send the real message** -- the client needs to know what they did wrong:

```go
func (app *App) badRequestResponse(                // Client-caused error
    w http.ResponseWriter, r *http.Request, err error,
) {
    // ...
    Message: err.Error(),                          // "namespace is required" -- client needs this!
}
```

**500 errors send a generic message** -- internal details must stay internal:

```go
func (app *App) serverErrorResponse(               // Server-caused error
    w http.ResponseWriter, r *http.Request, err error,
) {
    app.LogError(r, err)                           // Real error goes to server logs
    // ...
    Message: "the server encountered a problem...",// Generic message to client
    // NOT err.Error() -- never leak "connection to postgres refused" or stack traces
}
```

This is intentional security: internal error details (stack traces, database connection strings, K8s API errors) should never be sent to the client. The actual error is logged server-side where developers can see it.

## How Errors Flow Through a Handler

Let's trace the complete error flow through a real handler. Each error gets handled at the exact point it occurs:

```go
func (app *App) GetSecretsHandler(                 // A handler with multiple error paths
    w http.ResponseWriter,
    r *http.Request,
    _ httprouter.Params,
) {
    ctx := r.Context()                             // Get context

    // ERROR PATH 1: Missing middleware data → 400
    identity, ok := ctx.Value(                     // Read identity from context
        constants.RequestIdentityKey,
    ).(*kubernetes.RequestIdentity)
    if !ok || identity == nil {                    // Middleware didn't set it
        app.badRequestResponse(w, r,               // → 400: {"error":{"code":"400","message":"missing RequestIdentity"}}
            fmt.Errorf("missing RequestIdentity in context"))
        return                                     // MUST return after error
    }

    namespace, ok := ctx.Value(                    // Read namespace from context
        constants.NamespaceQueryParameterKey,
    ).(string)
    if !ok || namespace == "" {                    // Middleware didn't set it
        app.badRequestResponse(w, r,               // → 400: {"error":{"code":"400","message":"missing namespace"}}
            fmt.Errorf("missing namespace in context"))
        return                                     // MUST return after error
    }

    // ERROR PATH 2: Invalid query parameter → 400
    secretType := r.URL.Query().Get("type")        // Read optional query param
    if secretType != "" && secretType != "storage" { // Validate if present
        app.badRequestResponse(w, r,               // → 400: {"error":{"code":"400","message":"type must be 'storage'"}}
            fmt.Errorf("query parameter 'type' must be 'storage' or omitted"))
        return                                     // MUST return after error
    }

    // ERROR PATH 3: Infrastructure failure → 500
    client, err := app.kubernetesClientFactory.GetClient(ctx) // Try to get K8s client
    if err != nil {                                // Client creation failed
        app.serverErrorResponse(w, r,              // → 500: {"error":{"code":"500","message":"the server encountered..."}}
            fmt.Errorf("failed to get Kubernetes client: %w", err)) // Real error logged
        return                                     // MUST return after error
    }

    // ERROR PATH 4: K8s API errors → mapped to appropriate HTTP status
    secrets, err := app.repositories.Secret.GetFilteredSecrets(
        client, ctx, namespace, identity, secretType,
    )
    if err != nil {                                // K8s API call failed
        var statusErr *apierrors.StatusError        // Try to extract K8s status error
        if errors.As(err, &statusErr) {            // Is it a typed K8s error?
            if apierrors.IsNotFound(statusErr) {    // 404 from K8s
                app.notFoundResponseWithMessage(w, r, // → 404: {"error":{"code":"404","message":"namespace not found"}}
                    fmt.Sprintf("namespace '%s' not found", namespace))
                return                             // MUST return
            }
            if apierrors.IsForbidden(statusErr) {   // 403 from K8s
                app.forbiddenResponse(w, r,        // → 403: {"error":{"code":"403","message":"insufficient permissions"}}
                    "insufficient permissions")
                return                             // MUST return
            }
        }
        app.serverErrorResponse(w, r, err)         // → 500: generic server error for anything else
        return                                     // MUST return
    }

    // SUCCESS PATH: Write the response
    err = app.WriteJSON(w, http.StatusOK,          // → 200: {"data":[...]}
        SecretsEnvelope{Data: secrets}, nil)
    if err != nil {                                // Even writing the response can fail
        app.serverErrorResponse(w, r, err)         // → 500 if serialization fails
    }
}
```

Every single operation that can fail has its own error handling. There's no `try/catch` wrapping the whole function. Each error is handled at the point it occurs with the right status code and message. This is Go's explicit error handling philosophy -- verbose but clear.

In Express, you would wrap this in a single `try/catch` block. Go checks each error inline with `if err != nil`. The structure is the same -- validate inputs, call services, handle errors -- just expressed differently.

## Error Wrapping with `fmt.Errorf`

Go uses `fmt.Errorf` with `%w` to **wrap** errors, adding context while preserving the original:

```go
client, err := app.kubernetesClientFactory.GetClient(ctx) // Try to get a client
if err != nil {                                    // It failed
    app.serverErrorResponse(w, r,                  // Send 500
        fmt.Errorf("failed to get Kubernetes client: %w", err)) // Wrap with context
    return                                         // Stop
}
```

The `%w` verb wraps the error so you can later unwrap it with `errors.Is()` or `errors.As()`:

```go
// The wrapped error message: "failed to get K8s client: connection refused"
// You can check for specific underlying errors:
if errors.Is(err, ErrConnectionRefused) { ... }    // Check by value

// Or extract typed errors:
var statusErr *apierrors.StatusError                // Declare the type to extract
if errors.As(err, &statusErr) {                    // Try to extract
    // statusErr now holds the K8s API error details
    // You can check statusErr.Status().Code, etc.
}
```

**TypeScript equivalent:**

```typescript
try {
  const client = await getK8sClient();             // Try to get a client
} catch (err) {
  throw new Error(                                 // Wrap with context
    `Failed to get K8s client: ${err.message}`,    // Add context
    { cause: err }                                 // Preserve the original (ES2022)
  );
}
```

::: warning Never Forget to Return
After calling an error helper, you **must** `return`. Otherwise the handler continues executing and may try to write a second response, which panics:

```go
// BUG: Missing return after error
if err != nil {                                    // Error occurred
    app.badRequestResponse(w, r, err)              // Send 400 response
    // Execution continues! No return!
}
app.WriteJSON(w, http.StatusOK, data, nil)         // PANIC: headers already sent!

// CORRECT: Return after error
if err != nil {                                    // Error occurred
    app.badRequestResponse(w, r, err)              // Send 400 response
    return                                         // Stop execution
}
app.WriteJSON(w, http.StatusOK, data, nil)         // Only runs if no error
```

This is the most common bug in Go HTTP handlers. The compiler won't catch it -- you have to remember to return.
:::

## Quick Reference: Which Helper for Which Situation

| Situation | Helper | Status | Message to Client |
|---|---|---|---|
| Client sent bad input | `badRequestResponse` | 400 | The actual error (client needs to know) |
| No credentials / invalid token | `unauthorizedResponse` | 401 | Auth error message (varies by BFF) |
| Authenticated but not allowed | `forbiddenResponse` | 403 | Specific reason |
| Resource doesn't exist | `notFoundResponse` | 404 | Generic "not found" |
| Server-side failure | `serverErrorResponse` | 500 | Generic message (real error logged) |
| Upstream service down | `serviceUnavailableResponse` | 503 | Generic "temporarily unavailable" |

::: tip Key Takeaway
Every BFF error response follows the same JSON structure: `{ "error": { "code": "...", "message": "..." } }`. Error helpers (`badRequestResponse`, `serverErrorResponse`, etc.) create the right HTTP status code and JSON body. Client-caused errors (400, 403) include descriptive messages; server-caused errors (500) use a generic message and log the details server-side. Always `return` after calling an error helper, and use `fmt.Errorf("context: %w", err)` to wrap errors with additional context.
:::

::: info See Also
- [Writing Handlers](./handlers) -- how handlers use error helpers in practice
- [Models & DTOs](./models) -- the `ErrorEnvelope` and `HTTPError` structs
- [Error Handling (Go Basics)](../go-basics/error-handling) -- the `if err != nil` pattern and `errors.Is`/`errors.As`
:::
