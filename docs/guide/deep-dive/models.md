# Models & DTOs

> **The data shapes** -- Go structs with JSON tags that define every request and response in the API contract.

Models are your TypeScript types, written in Go. If you can write `interface User { name: string; email: string }`, you can write a Go model. The syntax is different, but the purpose is identical: define the shape of data going in and out of the BFF.

## Start with What You Know

Here's a TypeScript interface you might write for a health check response:

```typescript
interface HealthCheckModel {                       // Define the shape
  status: string;                                  // A required string field
  system_info: SystemInfo;                         // A nested object
}

interface SystemInfo {                             // The nested type
  version: string;                                 // A required string field
}
```

Now here's the exact same thing in Go:

```go
type HealthCheckModel struct {                     // Define the shape (struct = interface in TS)
    Status     string     `json:"status"`          // A required string field -- tag controls JSON name
    SystemInfo SystemInfo `json:"system_info"`     // A nested struct -- Go field is PascalCase, JSON is snake_case
}

type SystemInfo struct {                           // The nested type
    Version string `json:"version"`                // A required string field
}
```

**What just happened?** The struct looks almost identical to the TypeScript interface. The big difference is the backtick-quoted `json:"..."` tags after each field. These tags tell the JSON encoder/decoder what the field's name should be in JSON. In TypeScript, the field name *is* the JSON key. In Go, the struct field name (`Status`) is PascalCase for export rules, but the JSON tag (`"status"`) controls the actual output.

This produces JSON like:

```json
{
    "status": "healthy",
    "system_info": {
        "version": "1.0.0"
    }
}
```

## Where Models Live

Models are in `internal/models/` within each BFF. Each file groups related types:

```
bff/internal/models/
├── health_check.go      # Health check response
├── namespace.go          # Namespace model
├── pipeline_runs.go      # Pipeline run request/response
├── secret.go             # Secret list items
├── user.go               # User model
└── ...
```

## Struct Tags -- The Key Concept

Let's explore every struct tag pattern you'll encounter. I'll show the Go version and what it means in TypeScript:

```go
type Model struct {                                // A model with different tag patterns
    // Required field -- always in JSON
    Name string `json:"name"`                      // TS: name: string

    // Optional field -- omitted from JSON if empty/zero
    Description string `json:"description,omitempty"` // TS: description?: string

    // Field ignored by JSON encoding entirely
    InternalState int `json:"-"`                   // TS: (no equivalent -- just don't include it)

    // Pointer field -- omitted if nil, present if non-nil
    DisplayName *string `json:"displayName,omitempty"` // TS: displayName?: string | null
}
```

Here's the cheat sheet:

| Tag | Behavior | TypeScript equivalent |
|---|---|---|
| `` `json:"name"` `` | Always present in JSON as `"name"` | `name: string` |
| `` `json:"desc,omitempty"` `` | Omitted if zero value (`""`, `0`, `false`, `nil`) | `desc?: string` |
| `` `json:"-"` `` | Never in JSON output | (no equivalent -- just don't include it) |
| `` `json:"display_name,omitempty"` `` with `*string` | Omitted if `nil`, present if pointer is set | `display_name?: string \| null` |

::: info Checkpoint
You now know the three tag patterns: `json:"name"` (required), `json:"name,omitempty"` (optional), and `json:"-"` (hidden). Let's see them in real models.
:::

## Building Up Real Models

### Simple Response Model

Let's start simple -- a secret list item from the automl BFF:

```go
type SecretListItem struct {                       // A secret returned by the list endpoint
    UUID        string            `json:"uuid"`    // Always present -- the unique ID
    Name        string            `json:"name"`    // Always present -- the secret name
    Type        string            `json:"type,omitempty"` // Optional -- omitted if empty string
    Data        map[string]string `json:"data"`    // Always present -- key/value pairs
    DisplayName string            `json:"displayName,omitempty"` // Optional -- human-readable name
    Description string            `json:"description,omitempty"` // Optional -- description
}
```

**TypeScript equivalent:**

```typescript
interface SecretListItem {                         // Same shape in TypeScript
  uuid: string;                                    // Required
  name: string;                                    // Required
  type?: string;                                   // omitempty = optional
  data: Record<string, string>;                    // map[string]string = Record<string, string>
  displayName?: string;                            // Optional
  description?: string;                            // Optional
}
```

### Model with Pointer for Nullable Fields

Sometimes a field needs to distinguish between "not set" and "set to empty." That's where pointers come in:

```go
type NamespaceModel struct {                       // A namespace returned by the list endpoint
    Name        string  `json:"name"`              // Always present -- the namespace name
    DisplayName *string `json:"displayName,omitempty"` // Pointer to string -- can be nil
}
```

The `*string` (pointer to string) means `DisplayName` can be `nil`, not just empty. In JSON:

- `nil` pointer + `omitempty` = field is omitted entirely from JSON
- Non-nil pointer = field is present with the string value (even if the string is `""`)

**TypeScript equivalent:**

```typescript
interface NamespaceModel {                         // Same shape
  name: string;                                    // Required
  displayName?: string;                            // undefined = omitted from JSON
}
```

### Factory Functions for Models

Many models have factory functions that handle construction logic. When I first saw these, I thought "why not just create the struct directly?" The answer: factory functions encapsulate transformation logic (like reading annotations, applying defaults) so handlers stay clean.

```go
func NewNamespaceModelFromNamespace(               // Factory function -- creates a model from raw data
    name string,                                   // The namespace name
    annotations map[string]string,                 // K8s annotations (metadata)
) NamespaceModel {                                 // Returns the model (not a pointer -- it's small)
    displayName := name                            // Default display name is the namespace name
    if dn := strings.TrimSpace(                    // Check the annotation for a custom display name
        annotations["openshift.io/display-name"],  // OpenShift stores display names here
    ); dn != "" {                                  // If the annotation exists and isn't blank
        displayName = dn                           // Use the custom display name
    }
    return NamespaceModel{                         // Return the constructed model
        Name:        name,                         // Set the name
        DisplayName: &displayName,                 // Set the display name (& makes it a pointer)
    }
}
```

**TypeScript equivalent:**

```typescript
function createNamespaceModel(                     // Same factory pattern
  name: string,                                    // Namespace name
  annotations: Record<string, string>,             // K8s annotations
): NamespaceModel {                                // Returns the model
  const displayName = annotations['openshift.io/display-name']?.trim() || name;
  return { name, displayName };                    // Construct and return
}
```

## The Error Structs

Every BFF uses a standard error shape built from three Go structs: `ErrorResponse` (the JSON fields `code` and `message`), `HTTPError` (adds the HTTP status code, uses Go's embedding to "inherit" `ErrorResponse`), and an envelope struct (wraps everything under an `"error"` key). The exact struct names vary between BFFs, but the JSON output is always the same.

`HTTPError` uses two important model patterns worth highlighting:

- `` `json:"-"` `` on `StatusCode` -- the field drives the HTTP response status code but is excluded from the JSON body
- **Embedding** -- `ErrorResponse` is embedded in `HTTPError` (no field name), so `Code` and `Message` are "promoted" and accessible directly as `err.Code` and `err.Message`

For the full struct definitions and all error helper functions, see [Error Handling](./error-handling#the-error-envelope----three-structs-working-together).

An error response looks like:

```json
{
    "error": {
        "code": "400",
        "message": "missing required query parameter: namespace"
    }
}
```

**TypeScript equivalent:**

```typescript
interface ErrorResponse {                          // What your React code sees
  error: {                                         // Nested under "error" key
    code: string;                                  // HTTP status code as string
    message: string;                               // Human-readable message
  };
}
```

::: info Checkpoint
We've covered simple models, optional fields, pointers, factory functions, and error structs. Now let's look at the envelope pattern that wraps all responses.
:::

## The Envelope Pattern

BFF responses are wrapped in a consistent envelope for uniformity:

```go
type Envelope[D any, M any] struct {               // Generic envelope -- D is data type, M is metadata type
    Data     D `json:"data"`                       // The main response data
    Metadata M `json:"metadata,omitempty"`         // Optional metadata (pagination, etc.)
}

type None *struct{}                                // A type alias meaning "no metadata"
```

Usage in handlers:

```go
// Simple response with data only: { "data": [...] }
type SecretsEnvelope Envelope[[]models.SecretListItem, None] // Type alias for secrets
envelope := SecretsEnvelope{Data: secrets}         // Create the envelope
app.WriteJSON(w, http.StatusOK, envelope, nil)     // Send it

// Response with metadata: { "data": [...], "metadata": { "total": 42 } }
type RunsEnvelope Envelope[[]models.PipelineRun, *models.Pagination] // Type alias with pagination
envelope := RunsEnvelope{                          // Create with both fields
    Data:     runs,                                // The list of runs
    Metadata: &models.Pagination{                  // Pagination info
        Total: total, Page: page},
}
```

**TypeScript equivalent:**

```typescript
interface ApiResponse<D, M = undefined> {          // Same generic pattern
  data: D;                                         // Main data
  metadata?: M;                                    // Optional metadata
}

// Usage
const response: ApiResponse<SecretListItem[]> = { data: secrets };
const pagedResponse: ApiResponse<PipelineRun[], Pagination> = {
  data: runs,                                      // The list
  metadata: { total, page },                       // Pagination
};
```

## How Models Connect to the Frontend

The models in the BFF directly correspond to TypeScript types on the frontend. When the frontend calls `fetch('/api/v1/secrets?namespace=my-ns')`, it expects the JSON shape defined by the BFF's model structs.

```go
// BFF model (Go)
type SecretListItem struct {                       // Define the API response shape
    UUID        string            `json:"uuid"`    // Must match the frontend type
    Name        string            `json:"name"`    // Must match the frontend type
    Type        string            `json:"type,omitempty"` // Must match the frontend type
    Data        map[string]string `json:"data"`    // Must match the frontend type
}
```

```typescript
// Frontend type (TypeScript) -- same shape!
interface SecretListItem {                         // Must match the BFF model
  uuid: string;                                    // Matches json:"uuid"
  name: string;                                    // Matches json:"name"
  type?: string;                                   // Matches json:"type,omitempty"
  data: Record<string, string>;                    // Matches json:"data" with map[string]string
}
```

The OpenAPI spec in `bff/openapi/src/*.yaml` is the source of truth that connects both sides. Contract tests validate that the BFF's actual responses match the OpenAPI spec.

## Adding a New Model

When you need to add a new model, here's the step-by-step:

**Step 1: Create the struct** in `internal/models/`:

```go
// internal/models/widget.go
package models                                     // All models are in the models package

type Widget struct {                               // The response model
    ID          string `json:"id"`                 // Unique identifier
    Name        string `json:"name"`               // Widget name
    Description string `json:"description,omitempty"` // Optional description
    Status      string `json:"status"`             // Current status
    CreatedAt   string `json:"createdAt"`          // Creation timestamp
}

type CreateWidgetRequest struct {                   // The request model (what the client sends)
    Name        string `json:"name"`               // Required name
    Description string `json:"description,omitempty"` // Optional description
}
```

**Step 2: Use it in your handler:**

```go
// Reading a request body
var request models.CreateWidgetRequest             // Declare variable with expected type
err := app.ReadJSON(w, r, &request)                // Parse JSON body into it

// Writing a response
widget := models.Widget{                           // Create the response model
    ID:     "abc-123",                             // Set the ID
    Name:   request.Name,                          // Use the name from the request
    Status: "active",                              // Set initial status
}
app.WriteJSON(w, http.StatusCreated,               // Send 201 Created
    Envelope[*models.Widget, None]{Data: &widget}, // Wrap in envelope
    nil)                                           // No extra headers
```

**Step 3: Add to the OpenAPI spec** in `bff/openapi/src/*.yaml` to keep the contract tests happy.

::: warning Common Gotcha -- Unexported Fields
Go only includes **exported** (capitalized) fields in JSON encoding. Lowercase fields are invisible to `json.Marshal`:

```go
type Model struct {                                // A struct with mixed export visibility
    Name   string `json:"name"`                    // Exported (capital N) -- INCLUDED in JSON
    secret string `json:"secret"`                  // Unexported (lowercase s) -- SILENTLY IGNORED
}

m := Model{Name: "test", secret: "hidden"}         // Create with both fields set
json.Marshal(m)                                    // Produces: {"name":"test"}
                                                   // "secret" is completely missing from output!
```

If your JSON output is missing fields, check the capitalization first. This is the most common cause.
:::

::: danger Keeping Frontend and BFF Models in Sync
When you change a model in the BFF, you must also update:
1. The corresponding TypeScript type on the frontend
2. The OpenAPI spec in `bff/openapi/src/*.yaml`
3. Any contract tests that validate the response shape

The OpenAPI spec is the shared contract. If the BFF's output doesn't match the spec, contract tests will fail. If the frontend's type doesn't match the spec, you'll get runtime errors. Keep all three in sync.
:::

::: tip Key Takeaway
Go models are structs with JSON tags that define API request and response shapes. The `json:"fieldName"` tag controls the JSON property name, `omitempty` makes fields optional, and `json:"-"` hides fields from output. The models in `internal/models/` map directly to the TypeScript types your frontend code uses. Keep them in sync, and use the OpenAPI spec as the shared contract.
:::

::: info See Also
- [JSON (Go Basics)](../go-basics/json) -- marshaling, unmarshaling, and struct tags in depth
- [Writing Handlers](./handlers) -- how models are used in request/response handling
- [Error Handling](./error-handling) -- the error envelope struct in detail
:::
