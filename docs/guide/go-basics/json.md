# JSON — Your Daily Bread

> **Go Concept:** JSON encoding and decoding in Go uses struct tags and the `encoding/json` package. You tell Go the exact shape of the data, and it handles the rest.

Every BFF handler does two things: reads JSON from the request, and writes JSON to the response. This chapter is where your Go skills meet your actual job. You'll spend more time with `encoding/json` than almost any other package, so let's make sure you understand it deeply.

## Starting from What You Know

In TypeScript, JSON is two functions:

```ts
// TypeScript — two functions, no type safety at runtime
const text = '{"name": "Alice", "age": 30}';   // A JSON string
const obj = JSON.parse(text);                    // Parse it into an object
                                                 // obj is 'any' — no type checking
console.log(obj.name);                           // "Alice" — works fine
console.log(obj.oops);                           // undefined — no error, just silent failure

const back = JSON.stringify(obj);                // Convert back to a JSON string
                                                 // '{"name":"Alice","age":30}'
```

Simple. One function parses, one function serializes. But there's a catch you've probably hit before: `JSON.parse` returns `any`. You can access `.oops` or `.whatever` and TypeScript won't complain. The bug shows up at runtime, maybe in production, maybe three pages deep in a user flow.

Go's version is more explicit. Instead of magically figuring out the shape, you tell Go exactly what shape to expect. This is actually safer -- you'll never get `undefined is not a function` at runtime because Go catches shape mismatches at the decoding step.

## Struct Tags: The Key Concept

Before we touch `json.Marshal` or `json.Unmarshal`, we need to understand struct tags. This is the most important concept in this entire chapter, and honestly one of the most important concepts for BFF work in general.

### Without tags: the default behavior

Let's start with a plain struct and see what happens when we convert it to JSON:

```go
type User struct {                               // Define a struct type called User
    Name  string                                  // A field called Name (capitalized = exported)
    Email string                                  // A field called Email (also exported)
    Age   int                                     // A field called Age (also exported)
}                                                 // That's the whole type definition

user := User{                                     // Create an instance of User
    Name:  "Alice",                               // Set the Name field
    Email: "alice@example.com",                   // Set the Email field
    Age:   30,                                    // Set the Age field
}                                                 // Trailing comma is required in Go

data, err := json.Marshal(user)                   // Convert the struct to JSON bytes
                                                  // Returns two values: the bytes AND an error
if err != nil {                                   // If something went wrong...
    log.Fatal(err)                                // ...crash with the error message
}                                                 // If we get past this, data is safe to use
fmt.Println(string(data))                         // Print the JSON as a string
// Output: {"Name":"Alice","Email":"alice@example.com","Age":30}
```

Look at those field names -- `"Name"`, `"Email"`, `"Age"` with capital letters. That's because Go used the Go field names directly. Your frontend is expecting `"name"`, `"email"`, `"age"` (lowercase). Your API contract probably uses `snake_case`. This mismatch will break everything.

### Adding `json:"name"` tags

Struct tags fix this. They're metadata written in backticks after the field type:

```go
type User struct {                               // Same struct, now with JSON tags
    Name  string `json:"name"`                   // When converting to/from JSON, use "name"
    Email string `json:"email"`                  // When converting to/from JSON, use "email"
    Age   int    `json:"age"`                    // When converting to/from JSON, use "age"
}                                                // Tags don't change how the struct works in Go

user := User{                                    // Create the same user
    Name:  "Alice",                              // In Go code, you still use .Name (capitalized)
    Email: "alice@example.com",                  // Tags only affect JSON conversion
    Age:   30,                                   // Everything else stays the same
}                                                // Trailing comma required

data, err := json.Marshal(user)                  // Convert to JSON bytes
if err != nil {                                  // Check for errors (always)
    log.Fatal(err)                               // Crash if something went wrong
}                                                // Past this point, data is valid
fmt.Println(string(data))                        // Print the JSON string
// Output: {"name":"Alice","email":"alice@example.com","age":30}
```

The backtick tags are the key. Now the JSON output uses lowercase keys that match your API contract. The struct tag `` `json:"name"` `` tells the JSON encoder "when you see the `Name` field, write it as `"name"` in JSON." And it works in reverse too -- when decoding JSON with a `"name"` key, Go knows to put that value into the `Name` field.

The first time I saw `` `json:"name"` `` with those backticks and escaped quotes, I thought it was a typo. It's not -- it's Go's way of adding metadata to struct fields. The backticks create a "raw string" so you don't need to escape the quotes inside.

::: tip
Struct tags are just strings that other packages can read. The `json` package reads tags starting with `json:`, but other packages use their own prefixes. You might see `yaml:"name"` or `db:"column_name"` in other Go projects.
:::

### `omitempty`: skip fields that are empty

Sometimes you don't want to include a field in the JSON if it has no value. Add `omitempty` after the field name:

```go
type ApiResponse struct {                        // A response that may or may not have an error
    Data  string `json:"data"`                   // Always include the data field
    Error string `json:"error,omitempty"`         // Only include if Error is not empty ("")
    Count int    `json:"count,omitempty"`         // Only include if Count is not zero (0)
}                                                 // Note: comma between name and omitempty, NO space

// When everything is fine:
good := ApiResponse{Data: "hello"}                // Error is "" (zero value), Count is 0
data, _ := json.Marshal(good)                     // Convert to JSON (ignoring error for brevity)
fmt.Println(string(data))                         // {"data":"hello"}
                                                  // "error" and "count" are omitted entirely!

// When there's an error:
bad := ApiResponse{                               // Create a response with an error
    Data:  "",                                    // Data is empty but NOT omitempty, so it stays
    Error: "something broke",                     // Error has a value, so it's included
}                                                 // Count is still 0
data, _ = json.Marshal(bad)                       // Convert to JSON
fmt.Println(string(data))                         // {"data":"","error":"something broke"}
                                                  // "count" omitted (zero), "data" stays (no omitempty)
```

The `omitempty` option tells the encoder "skip this field if it's the zero value for its type." Each type has a different zero value:

| Type | Zero value (omitted by `omitempty`) |
|---|---|
| `string` | `""` (empty string) |
| `int` | `0` |
| `bool` | `false` |
| pointer (`*string`, `*int`, etc.) | `nil` |
| slice (`[]string`) | `nil` (but NOT an empty slice `[]string{}`) |
| map (`map[string]string`) | `nil` (but NOT an empty map `map[string]string{}`) |

::: warning
A common gotcha: `omitempty` on a `bool` field will omit it when `false`. If `false` is a meaningful value in your API (not just "absent"), don't use `omitempty` on booleans. Use a pointer `*bool` instead -- `nil` means absent, `false` means explicitly false.
:::

### `json:"-"`: hide sensitive fields entirely

Use `"-"` to completely exclude a field from JSON. It won't be written during encoding, and it won't be read during decoding:

```go
type User struct {                               // A user with sensitive data
    ID       string `json:"id"`                  // Include in JSON as "id"
    Name     string `json:"name"`                // Include in JSON as "name"
    Password string `json:"-"`                   // NEVER include in JSON -- not in, not out
    Token    string `json:"-"`                   // Same here -- excluded from all JSON operations
}                                                // Security by design, not by accident

user := User{                                    // Create a user with all fields populated
    ID:       "user-123",                        // Public info
    Name:     "Alice",                           // Public info
    Password: "super-secret-hash",               // Sensitive! Must never leak
    Token:    "jwt-token-abc",                   // Sensitive! Must never leak
}                                                // All four fields have values in Go

data, _ := json.Marshal(user)                    // Convert to JSON
fmt.Println(string(data))                        // {"id":"user-123","name":"Alice"}
                                                 // Password and Token are completely gone
```

**What just happened?** `json:"-"` is your security safety net. Even if a developer accidentally passes a full `User` struct to a response writer, the password and token will never appear in the JSON output. This is critical for BFF work where your handlers sit between the frontend and sensitive backend data.

::: info Why not just use a lowercase field name?
You might wonder: if `Password` should be hidden from JSON, why not just make it lowercase (`password`) so it's private? That would also hide it from JSON (unexported fields are always excluded).

The difference is **who needs access**:

- **Lowercase `password`** — hidden from JSON AND hidden from other files. Only code in the exact same `.go` file's package can access it. Use this when the field is truly internal to one package.
- **Uppercase `Password` with `json:"-"`** — hidden from JSON BUT accessible from other packages. Use this when other packages need to read or set the field in Go code, but it should never appear in API responses.

In BFF code, you'll see `json:"-"` when a struct is shared across packages (e.g., a `RequestIdentity` that handlers need to read but should never be serialized to JSON). You'll see lowercase fields when the struct is entirely internal to one package (like the `App` struct's `config` and `logger` fields).
:::

### Pointer fields for optional values: `*string`

This is a crucial pattern for PATCH/update endpoints. The problem: in JSON, there are three states for a field:

1. **Present with a value**: `{"name": "Alice"}` -- the user wants to set the name
2. **Present but empty**: `{"name": ""}` -- the user wants to clear the name
3. **Absent**: `{}` -- the user didn't send this field, don't touch it

A regular `string` can only represent states 1 and 2. When JSON decoding fills in a struct, a missing field stays at its zero value (`""`), which looks identical to "the user sent an empty string." You can't tell the difference.

A pointer `*string` can be `nil` (absent), point to `""` (empty), or point to `"Alice"` (has a value). That gives you all three states:

```go
type UpdateUserRequest struct {                  // Request body for PATCH /api/users/:id
    Name  *string `json:"name,omitempty"`        // Pointer to string -- can be nil, "", or "Alice"
    Email *string `json:"email,omitempty"`       // Same pattern -- nil means "not sent"
}                                                // Regular string can't distinguish "" from "not sent"

// JSON: {"name": "Alice"}
// Result: Name points to "Alice", Email is nil (not sent)

// JSON: {"name": ""}
// Result: Name points to "" (clear it!), Email is nil (not sent)

// JSON: {}
// Result: Name is nil (not sent), Email is nil (not sent)
```

Here's how you use it in a handler:

```go
func handleUpdate(req UpdateUserRequest, user *User) {  // Takes the parsed request and existing user
    if req.Name != nil {                                 // Was the name field sent in the JSON?
        user.Name = *req.Name                            // Yes -- dereference the pointer to get the string
                                                         // Could be "" (clear) or "Alice" (update)
    }                                                    // If nil, we skip -- don't touch the name
    if req.Email != nil {                                // Same pattern for email
        user.Email = *req.Email                          // Dereference to get the actual string value
    }                                                    // If nil, leave email unchanged
}                                                        // Only modified fields get updated
```

This is the part that catches TypeScript developers off guard. The `*` in `*string` makes the field a pointer. When JSON has `"name": "Alice"`, Go creates a string `"Alice"` and sets the pointer to its address. When JSON doesn't include `"name"` at all, the pointer stays `nil`. This three-way distinction is essential for partial update APIs.

::: code-group
```ts [TypeScript]
// TypeScript -- optional fields with ?
interface UpdateUserRequest {
  name?: string;        // undefined = not sent, "" = clear it
}

function handleUpdate(req: UpdateUserRequest, user: User) {
  if (req.name !== undefined) {  // Was name sent?
    user.name = req.name;        // Could be "" or "Alice"
  }
}
```

```go [Go]
// Go -- pointer fields for optional values
type UpdateUserRequest struct {                  // Define the request shape
    Name *string `json:"name,omitempty"`         // *string = can be nil (not sent)
}                                                // Without *, can't tell "" from absent

func handleUpdate(req UpdateUserRequest, user *User) { // Handle the update
    if req.Name != nil {                               // nil means the field wasn't in the JSON
        user.Name = *req.Name                          // Dereference: *req.Name gets the actual string
    }                                                  // Skip if nil -- don't overwrite
}
```
:::

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Add `json:"field_name"` tags to control JSON key names
- Use `omitempty` to skip zero-value fields
- Use `json:"-"` to exclude sensitive fields from JSON entirely
- Use `*string` (pointer) fields to distinguish "absent" from "empty" in JSON
- Explain why a regular `string` field can't distinguish `""` from a missing field

</div>

## `json.Marshal` and `json.Unmarshal`

Now that you understand struct tags, let's look at the two core functions. These work with byte slices (`[]byte`), which is Go's way of saying "raw bytes of data."

### Marshal: struct to JSON bytes

`json.Marshal` is Go's `JSON.stringify()`. It takes any Go value and returns JSON bytes:

```go
type Model struct {                              // Define the data shape
    ID   string `json:"id"`                      // Maps to "id" in JSON
    Name string `json:"name"`                    // Maps to "name" in JSON
}                                                // Tags control the JSON keys

model := Model{                                  // Create an instance
    ID:   "model-abc",                           // Set the ID
    Name: "My Model",                            // Set the Name
}                                                // This is a Go struct, not JSON yet

data, err := json.Marshal(model)                 // Convert struct -> JSON bytes
                                                 // data is []byte, not a string
                                                 // Like JSON.stringify() but returns bytes + error
if err != nil {                                  // Marshal can fail (rare, but check anyway)
    log.Fatal("failed to marshal:", err)          // If it fails, crash with a message
}                                                // Past here, data is valid JSON bytes

fmt.Println(string(data))                        // Convert bytes to string for printing
// Output: {"id":"model-abc","name":"My Model"}  // The JSON output with lowercase keys
```

`json.Marshal` walked through the struct, looked at each field's `json` tag, and built a JSON byte slice. The `string(data)` conversion at the end is just for printing -- in a real handler, you'd write the bytes directly to the HTTP response.

::: info
`json.Marshal` returns `[]byte`, not `string`. This is actually efficient -- when you write to an HTTP response, you're writing bytes anyway. No extra string conversion needed.
:::

### Unmarshal: JSON bytes to struct

`json.Unmarshal` is Go's `JSON.parse()`. It takes JSON bytes and fills in a struct:

```go
raw := []byte(`{"id":"model-abc","name":"My Model"}`) // JSON as bytes
                                                       // Backtick strings in Go are "raw" --
                                                       // no need to escape the quotes inside

var model Model                                        // Declare a variable of type Model
                                                       // All fields start at zero values
                                                       // (ID = "", Name = "")

err := json.Unmarshal(raw, &model)                     // Parse the JSON into the struct
                                                       // &model = "pointer to model" --
                                                       // Unmarshal needs to modify model's fields
                                                       // Returns only an error (model is filled via pointer)
if err != nil {                                        // If the JSON was invalid or didn't match...
    log.Fatal("failed to unmarshal:", err)              // ...crash with the error
}                                                      // Past here, model is populated

fmt.Println(model.ID)                                  // "model-abc" -- the value from JSON
fmt.Println(model.Name)                                // "My Model" -- the value from JSON
```

**What just happened?** We gave `json.Unmarshal` two things: the raw JSON bytes, and a pointer to an empty struct. It matched the JSON keys (`"id"`, `"name"`) to the struct tags, and filled in the corresponding fields. The `&model` (pointer) is crucial -- without it, Unmarshal would fill in a copy and our variable would stay empty.

Notice something important: if the JSON has a key that doesn't match any struct tag, it's silently ignored. If the struct has a field that isn't in the JSON, it stays at its zero value. No errors either way. This is different from TypeScript's strict mode where you might get type errors for missing fields.

::: code-group
```ts [TypeScript]
// TypeScript -- JSON.parse returns 'any', no validation
const raw = '{"id":"model-abc","name":"My Model"}';
const model = JSON.parse(raw) as Model;  // Trust me bro, it's a Model
console.log(model.id);                   // "model-abc"
```

```go [Go]
// Go -- Unmarshal validates structure against your struct
raw := []byte(`{"id":"model-abc","name":"My Model"}`) // Raw JSON bytes
var model Model                                        // Empty struct, ready to be filled
err := json.Unmarshal(raw, &model)                     // Fill the struct from JSON
if err != nil {                                        // Catches malformed JSON, type mismatches
    log.Fatal(err)                                     // (e.g., string where int expected)
}                                                      // model is now populated and type-safe
fmt.Println(model.ID)                                  // "model-abc"
```
:::

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Use `json.Marshal(value)` to convert a struct to JSON bytes
- Use `json.Unmarshal(bytes, &target)` to parse JSON bytes into a struct
- Explain why `&model` (a pointer) is needed for Unmarshal
- Know that unknown JSON keys are silently ignored during Unmarshal

</div>

## `json.NewEncoder` and `json.NewDecoder` -- The HTTP Versions

`Marshal`/`Unmarshal` work with byte slices in memory. But in an HTTP handler, you're reading from a request body (an `io.Reader`) and writing to a response (an `io.Writer`). That's where `NewEncoder` and `NewDecoder` come in.

These are what you'll actually use in handlers. They read/write directly from HTTP streams instead of intermediate byte slices.

### Writing JSON to an HTTP response

```go
// The encoder writes directly to the ResponseWriter
func writeExample(w http.ResponseWriter) {       // w is where the HTTP response goes
    model := Model{                              // Create the data to send back
        ID:   "model-abc",                       // Set ID
        Name: "My Model",                        // Set Name
    }                                            // This struct will become JSON

    w.Header().Set("Content-Type",               // Tell the client we're sending JSON
        "application/json")                      // This header MUST be set before writing the body
    w.WriteHeader(http.StatusOK)                 // Send the 200 status code
                                                 // MUST come before the body too

    err := json.NewEncoder(w).Encode(model)      // Create an encoder that writes to w
                                                 // .Encode(model) converts and writes in one step
                                                 // No intermediate []byte -- streams directly
    if err != nil {                              // Encoding can fail (rare, but possible)
        log.Println("failed to write response:", err) // Log it (can't send error to client --
    }                                                  // headers already sent)
}
```

Here's the difference from `Marshal`. `json.NewEncoder(w)` creates an encoder that streams JSON directly to the HTTP response writer. When you call `.Encode(model)`, it converts the struct to JSON and writes it to the response in one step. No intermediate byte slice, no `string(data)` conversion. This is more efficient than `Marshal` + `w.Write()`.

### Reading JSON from an HTTP request

```go
// The decoder reads directly from the request body
func readExample(r *http.Request) {              // r is the incoming HTTP request
    var input struct {                           // Anonymous struct -- only used here
        Name      string `json:"name"`           // Expected field in the JSON body
        Namespace string `json:"namespace"`       // Another expected field
    }                                            // No need to define a named type for one-off use

    err := json.NewDecoder(r.Body).Decode(&input) // Create a decoder that reads from r.Body
                                                   // .Decode(&input) parses and fills the struct
                                                   // &input = pointer so Decode can modify it
    if err != nil {                                // If the body isn't valid JSON...
        log.Println("bad request body:", err)      // ...log the error
        return                                     // ...and bail out
    }                                              // Past here, input is populated

    fmt.Println(input.Name)                        // Use the parsed values
    fmt.Println(input.Namespace)                   // These came from the request body
}
```

Same idea in reverse. `json.NewDecoder(r.Body)` creates a decoder that reads from the request body stream. Calling `.Decode(&input)` reads the JSON and fills in the struct. The anonymous struct (`var input struct { ... }`) is a common Go pattern for request bodies that are only used in one handler -- no need to define a named type just for this.

### Side by side with Express

::: code-group
```ts [TypeScript -- Express]
// Express handler -- middleware already parsed the body
app.post('/api/models', (req, res) => {
  const { name, namespace } = req.body;   // Body already parsed by express.json()
  // ... do something ...
  res.status(201).json({ id: "new-id", name });  // Send JSON response
});
```

```go [Go -- httprouter handler]
func (app *App) CreateModelHandler(                   // Method on the App struct
    w http.ResponseWriter,                            // Response writer (like Express 'res')
    r *http.Request,                                  // Request (like Express 'req')
    ps httprouter.Params,                             // URL params (like req.params)
) {                                                   // Opening brace on same line (Go style)
    var input struct {                                // Anonymous struct for the request body
        Name      string `json:"name"`                // Read "name" from JSON
        Namespace string `json:"namespace"`            // Read "namespace" from JSON
    }                                                 // Only used in this handler

    err := json.NewDecoder(r.Body).Decode(&input)     // Read + parse the request body
    if err != nil {                                   // If JSON is malformed or wrong types...
        app.badRequestResponse(w, r, "invalid JSON")  // ...send a 400 error response
        return                                        // ...and stop processing
    }                                                 // Past here, input is valid

    // ... create the model using input.Name, input.Namespace ...

    w.Header().Set("Content-Type", "application/json") // Set response content type
    w.WriteHeader(http.StatusCreated)                  // 201 Created
    json.NewEncoder(w).Encode(map[string]string{       // Write JSON response directly
        "id":   "new-id",                              // The created model's ID
        "name": input.Name,                            // Echo back the name
    })                                                 // Encoder streams directly to w
}
```
:::

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Use `json.NewEncoder(w).Encode(data)` to write JSON to an HTTP response
- Use `json.NewDecoder(r.Body).Decode(&target)` to read JSON from an HTTP request
- Explain the difference between `Marshal`/`Unmarshal` (byte slices) and `Encoder`/`Decoder` (streams)
- Use anonymous structs for one-off request body shapes

</div>

## The `WriteJSON` Helper

In the actual BFF codebase, you won't call `json.NewEncoder` directly in most handlers. There's a helper method on the `App` struct that standardizes JSON response writing. Let's walk through it line by line:

```go
func (app *App) WriteJSON(                       // Method on App -- available to all handlers
    w http.ResponseWriter,                       // The response writer to write to
    status int,                                  // HTTP status code (200, 201, 400, etc.)
    data any,                                    // The data to encode -- 'any' accepts any type
    headers http.Header,                         // Optional extra headers (can be nil)
) error {                                        // Returns an error if encoding fails
    js, err := json.MarshalIndent(data, "", "\t") // Convert to pretty-printed JSON bytes
    if err != nil {                              // If encoding fails
        return err                               // Return the error to the caller
    }
    js = append(js, '\n')                        // Add a trailing newline for readability

    for key, value := range headers {            // Loop over any extra headers provided
        w.Header()[key] = value                  // Set each header directly
    }

    w.Header().Set("Content-Type",               // Always set Content-Type to JSON
        "application/json")                      // This is why handlers don't need to set it
    w.WriteHeader(status)                        // Write the HTTP status code
    _, err = w.Write(js)                         // Write the JSON bytes to the response
    return err                                   // Return any write error to the caller
}
```

This helper does four things every JSON response needs: marshals the data to pretty-printed JSON, sets any extra headers, sets the Content-Type to `application/json`, writes the status code, and sends the JSON body. Having this as a method means every handler writes JSON the same way:

```go
// In a handler -- clean and consistent
app.WriteJSON(w, http.StatusOK, model, nil)      // 200 with model data, no extra headers
app.WriteJSON(w, http.StatusCreated, result, nil) // 201 with created resource
app.WriteJSON(w, http.StatusBadRequest,           // 400 with error envelope
    ErrorEnvelope{Error: &ErrorResponse{          // Structured error response
        Code:    "bad_request",                   // Machine-readable error code
        Message: "name is required",              // Human-readable message
    }}, nil)                                      // No extra headers
```

## A Complete Handler: Reading and Writing JSON

Let's put everything together. Here's a complete BFF handler that reads a JSON request body, validates it, calls a service, and writes a JSON response. Every line is commented:

```go
// Request DTO -- defines what the client sends
type CreateModelRequest struct {                 // Data Transfer Object for the request body
    Name      string `json:"name"`               // Required: the model's display name
    Namespace string `json:"namespace"`           // Required: the K8s namespace
    Type      string `json:"type"`               // Required: the model type (e.g., "llm")
}                                                // Used only for JSON deserialization

// Response DTO -- defines what the client receives
type ModelResponse struct {                      // Data Transfer Object for the response body
    ID        string `json:"id"`                 // The created model's unique ID
    Name      string `json:"name"`               // The model's display name
    Type      string `json:"type"`               // The model type
    CreatedAt string `json:"created_at"`          // When it was created (ISO 8601)
    Status    string `json:"status,omitempty"`    // Optional: omit if empty
}                                                // This is what the frontend receives

// Error envelope -- consistent error format across all endpoints
type ErrorEnvelope struct {                      // Wrapper for error responses
    Error *ErrorResponse `json:"error"`          // Pointer so we can check nil
}                                                // Every error response uses this shape

type ErrorResponse struct {                      // The actual error details
    Code    string `json:"code"`                 // Machine-readable: "bad_request", "not_found"
    Message string `json:"message"`              // Human-readable: "name is required"
}                                                // Consistent across all BFF endpoints

// The handler -- ties everything together
func (app *App) CreateModelHandler(              // Method on App struct
    w http.ResponseWriter,                       // Write the response here
    r *http.Request,                             // Read the request from here
    ps httprouter.Params,                        // URL parameters (unused in this handler)
) {                                              // No return value -- writes directly to w

    // Step 1: Decode the request body
    var req CreateModelRequest                   // Declare a variable to hold the parsed body
    err := json.NewDecoder(r.Body).Decode(&req)  // Read the body and parse JSON into req
    if err != nil {                              // If the JSON was malformed...
        app.WriteJSON(w, http.StatusBadRequest,  // ...send a 400 Bad Request
            ErrorEnvelope{Error: &ErrorResponse{ // ...with a structured error
                Code:    "bad_request",          // Machine-readable code
                Message: "invalid JSON body",    // Human-readable message
            }}, nil)                             // No extra headers
        return                                   // Stop processing -- don't continue!
    }                                            // Past here, req is populated with valid data

    // Step 2: Validate required fields
    if req.Name == "" {                          // Check that name was provided
        app.WriteJSON(w, http.StatusBadRequest,  // If not, send a 400
            ErrorEnvelope{Error: &ErrorResponse{ // Structured error
                Code:    "validation_error",     // Different code from parse error
                Message: "name is required",     // Tell the client what's missing
            }}, nil)                             // No extra headers
        return                                   // Stop processing
    }                                            // Past here, name is valid

    // Step 3: Call the service layer
    model, err := app.service.CreateModel(       // Delegate to the business logic layer
        r.Context(),                             // Pass the request context (for cancellation)
        req.Name,                                // The validated name
        req.Namespace,                           // The namespace
        req.Type,                                // The model type
    )                                            // Returns the created model and/or an error
    if err != nil {                              // If the service layer failed...
        app.WriteJSON(w, http.StatusInternalServerError, // ...send a 500
            ErrorEnvelope{Error: &ErrorResponse{  // Structured error
                Code:    "internal_error",        // Don't leak internal details
                Message: "failed to create model", // Generic message for clients
            }}, nil)                              // No extra headers
        return                                    // Stop processing
    }                                             // Past here, model was created successfully

    // Step 4: Return the success response
    app.WriteJSON(w, http.StatusCreated,          // 201 Created -- resource was made
        ModelResponse{                            // Build the response DTO
            ID:        model.ID,                  // From the service layer result
            Name:      model.Name,                // Echo back the name
            Type:      model.Type,                // Echo back the type
            CreatedAt: model.CreatedAt,            // When it was created
        }, nil)                                   // No extra headers
}                                                 // Handler complete
```

Now you can see the complete lifecycle of a BFF handler:

1. **Decode** -- read the request body and parse it into a typed struct
2. **Validate** -- check that required fields are present and valid
3. **Service call** -- delegate to the business logic layer
4. **Response** -- send back a typed response or a structured error

Every step has explicit error handling. There's no try/catch wrapping everything. If decoding fails, you know it's a JSON parse error. If validation fails, you know which field is wrong. If the service call fails, you send a 500 without leaking internal details.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Build a complete handler that reads JSON input and writes JSON output
- Use the `WriteJSON` helper for consistent response formatting
- Structure request and response DTOs with appropriate JSON tags
- Follow the decode -> validate -> service -> response pattern
- Handle errors at each step with appropriate HTTP status codes

</div>

## Common Gotchas

These are the mistakes that will bite you. I've made all of them.

### 1. Unexported fields are invisible to JSON

Go fields that start with a lowercase letter are unexported (private). The JSON package can't see them:

```go
type Config struct {                             // A config struct with mixed visibility
    Port     int    `json:"port"`                // Exported (capital P) -- JSON can see this
    host     string `json:"host"`                // Unexported (lowercase h) -- INVISIBLE to JSON!
    LogLevel string `json:"log_level"`           // Exported -- JSON can see this
}                                                // The 'host' field will vanish from JSON

config := Config{                                // Create with all fields set
    Port:     8080,                              // This will appear in JSON
    host:     "localhost",                        // THIS WON'T -- it's unexported
    LogLevel: "info",                            // This will appear in JSON
}                                                // host is set in Go, but invisible to JSON

data, _ := json.Marshal(config)                  // Convert to JSON
fmt.Println(string(data))                        // {"port":8080,"log_level":"info"}
                                                 // Where's "host"? Gone. Silently.
```

**This fails silently.** No error, no warning. The field just doesn't appear. If you're wondering why a field isn't showing up in your API response, check if it starts with a capital letter.

### 2. Wrong tag syntax

The tag format is unforgiving. Small mistakes cause the tag to be silently ignored:

```go
type Bad struct {                                // Examples of WRONG tag syntax
    A string `json: "name"`                      // WRONG -- space after the colon
    B string `json:"name" `                      // WRONG -- trailing space in backticks
    C string `Json:"name"`                       // WRONG -- capital J (must be lowercase "json")
    D string  json:"name"                        // WRONG -- not in backticks at all (won't compile)
}                                                // All of these will silently use default behavior

type Good struct {                               // The CORRECT format
    A string `json:"name"`                       // No space after colon, backtick-delimited
    B string `json:"name,omitempty"`             // Comma between name and options, no spaces
    C string `json:"-"`                          // Dash to exclude
}                                                // Tags must be exact
```

::: danger
There's no compiler warning for malformed struct tags. If your tag has a space after the colon (`` `json: "name"` ``), Go silently ignores it and uses the default field name. Use `go vet` to catch these -- it has a struct tag checker.
:::

### 3. Forgetting to close the request body

In production BFF code, you should close the request body when you're done reading it:

```go
func handler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    defer r.Body.Close()                         // Close the body when this function returns
                                                 // 'defer' runs this at the end, no matter what
                                                 // Prevents resource leaks

    var input CreateModelRequest                 // Declare the request struct
    err := json.NewDecoder(r.Body).Decode(&input) // Decode the body
    if err != nil {                              // Handle errors
        // ...                                   // The body still gets closed (defer!)
        return                                   // Even if we return early
    }                                            // defer ensures cleanup happens
    // ... rest of handler ...
}
```

::: info
In practice, the Go HTTP server closes the body for you after the handler returns. But it's good practice to be explicit with `defer r.Body.Close()`, especially if you're doing anything more complex with the request.
:::

### 4. Type mismatches during Unmarshal

If the JSON has a string where the struct expects an int, `Unmarshal` returns an error:

```go
type Config struct {                             // Expects port as an integer
    Port int `json:"port"`                       // int type
}                                                // What if JSON sends "8080" (a string)?

raw := []byte(`{"port": "8080"}`)                // JSON has port as a STRING, not a number
var config Config                                // Empty struct
err := json.Unmarshal(raw, &config)              // Try to parse
fmt.Println(err)                                 // json: cannot unmarshal string into Go struct
                                                 // field Config.Port of type int
                                                 // Unmarshal catches the type mismatch!
```

Notice the contrast with TypeScript. Unlike `JSON.parse`, which happily gives you whatever shape the JSON has, Go's Unmarshal validates that the JSON types match the struct field types. A string value can't go into an `int` field. This catches bugs that TypeScript would let slip through to runtime.

## Quick Reference

| What you want to do | TypeScript | Go |
|---|---|---|
| Parse JSON string | `JSON.parse(text)` | `json.Unmarshal([]byte(text), &target)` |
| Create JSON string | `JSON.stringify(obj)` | `json.Marshal(obj)` (returns `[]byte`) |
| Read JSON from HTTP body | `req.body` (with middleware) | `json.NewDecoder(r.Body).Decode(&target)` |
| Write JSON to HTTP response | `res.json(data)` | `json.NewEncoder(w).Encode(data)` |
| Rename field in JSON | manual mapping or library | `` `json:"field_name"` `` struct tag |
| Skip empty fields | filter manually | `` `json:"name,omitempty"` `` |
| Hide field from JSON | don't include it | `` `json:"-"` `` |
| Optional field (nullable) | `field?: string` | `Field *string` (pointer) |

::: tip Key Takeaway
Go uses struct tags (`` `json:"field_name"` ``) to map between Go struct fields and JSON keys. Use `json.NewDecoder(r.Body).Decode(&target)` to read request bodies and `json.NewEncoder(w).Encode(data)` to write responses. Use `omitempty` to skip zero values, `json:"-"` to exclude fields, and pointer types (`*string`) for optional fields that need to distinguish "absent" from "empty." The complete handler pattern is: decode -> validate -> service call -> respond.
:::

::: info See Also
- [Structs](./structs) -- defining the types with JSON tags
- [Pointers](./pointers) -- `*string` for optional fields
- [Error Handling](./error-handling) -- handling decode errors
- [HTTP Servers](./http) -- the full request/response lifecycle
:::
