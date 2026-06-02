# Error Handling

> **Go Concept:** Go has no try/catch/throw. Errors are values -- you return them, check them, and handle them explicitly.

This is the chapter. The one where everything you know about error handling gets turned upside down. If you take away one thing from this entire guide, let it be this chapter.

In TypeScript, errors are exceptional. They fly through the air, invisible, until something catches them -- or they crash your program. In Go, errors are just values. Regular, boring values that you pass around like strings and numbers. There's no `try`, no `catch`, no `throw`, no stack unwinding, no surprise crashes from unhandled exceptions.

It sounds tedious. You're going to write `if err != nil` more times than you've ever written `try/catch`. But after a while, something clicks: you can see every error path in your code, right there on the screen, without any mental gymnastics about what might throw and what might not.

Let's start with what you know and build toward what Go does.

## What You're Used To

In TypeScript, error handling looks like this:

```ts
// TypeScript -- the try/catch approach you know and love (and sometimes hate)
async function loadUserData(userId: string): Promise<UserData> {
  try {
    const response = await fetch(`/api/users/${userId}`);
    const data = await response.json();
    const validated = validateUserData(data);
    return validated;
  } catch (err) {
    console.error("Failed to load user data:", err);
    throw err;  // Re-throw for the caller to handle
  }
}
```

This works, but there are some hidden problems:

1. **Which line failed?** The `catch` block handles errors from `fetch`, `response.json()`, and `validateUserData` all the same way. If the JSON parsing fails, you log "Failed to load user data" -- which is misleading.

2. **What's the type of `err`?** In a `catch` block, `err` is `unknown`. You don't know if it's an `Error`, a string, a number, or a random object someone threw.

3. **What if you forget the try/catch?** The error flies up the call stack silently until something catches it -- or it crashes your server.

4. **What does `validateUserData` throw?** Nothing in the function signature tells you. You'd have to read the implementation or hope the docs mention it.

Go's approach eliminates all four of these problems. It's more verbose, but it's explicit about every failure point.

## Go Doesn't Have try/catch. At All.

Let that sink in for a moment.

There is no `try` keyword. There is no `catch` keyword. There is no `throw` keyword. There is no exception mechanism. There is no stack unwinding for errors.

If a function can fail, it tells you in its return type: it returns an error as one of its return values. If you call that function, you get the error back, and you decide what to do with it right there.

This is not a design oversight. This is a deliberate choice. The Go team looked at exception-based error handling and said: "What if errors were just regular values that you check like any other value?"

## The `error` Interface

In Go, `error` is a built-in interface. It's one of the simplest interfaces you'll ever see:

```go
type error interface {         // The built-in error interface
    Error() string             // One method: Error(), which returns a string
}                              // That's it. That's the whole interface.
                               // Any type with an Error() string method IS an error.
```

What just happened? We looked at the entire definition of Go's error type. It's an interface with a single method: `Error()`, which returns a string. Compare that to TypeScript's `Error` class with its `message`, `name`, `stack`, and `cause` properties. Go's approach is deliberately minimal.

Any type that has an `Error() string` method satisfies the `error` interface. This means you can create custom error types easily (we'll do this later in the chapter).

In practice, the most common way to create an error is with the `errors` package:

```go
import "errors"                // Import the errors package from Go's standard library

err := errors.New("something went wrong")  // Create a new error with a message
                                            // err is of type error (the interface)

fmt.Println(err.Error())       // "something went wrong" -- call the Error() method
fmt.Println(err)               // "something went wrong" -- fmt knows how to print errors
                               // It calls .Error() automatically
```

`errors.New` creates an error value with a message. That's it -- no stack trace, no error code, just a message. The error is a value, like a string or a number. You can store it, pass it around, compare it, and return it from functions.

<div class="checkpoint">

#### Checkpoint

Go has no try/catch/throw. The `error` interface has one method: `Error() string`. Create errors with `errors.New("message")`. Errors are regular values, not exceptions.

</div>

## The `if err != nil` Pattern

This is the pattern you'll write hundreds of times. Let's build it up step by step, starting from the simplest possible case.

### Step 1: Call a function that might fail

```go
data, err := os.ReadFile("config.yaml")  // Read a file from disk
                                          // Returns TWO values: the file contents and an error
                                          // data is []byte (the file contents)
                                          // err is error (nil if successful, non-nil if something went wrong)
```

What just happened? `os.ReadFile` returns two values: the file data and an error. If the file exists and is readable, `data` contains the contents and `err` is `nil`. If something went wrong (file not found, permission denied, etc.), `data` is empty and `err` contains an error value describing what went wrong.

### Step 2: Check if the error is not nil

```go
data, err := os.ReadFile("config.yaml")  // Read the file -- get data and error

if err != nil {                           // Check: did something go wrong?
                                          // nil means "no error" (like null in TypeScript)
                                          // If err is NOT nil, something went wrong
    fmt.Println("Failed to read file:", err)  // Print the error message
    return                                     // Stop here -- don't continue with bad data
}
```

We checked whether `err` is `nil` (Go's `null`). If it's not `nil`, something went wrong, so we handle the error and return early. The `return` is critical -- without it, the code would continue executing with bad data.

### Step 3: Use the value if no error

```go
data, err := os.ReadFile("config.yaml")  // Read the file

if err != nil {                           // Check for error
    fmt.Println("Failed:", err)           // Handle the error
    return                                // Stop execution
}

// If we reach this line, we KNOW the read succeeded
// data is guaranteed to contain valid file contents
fmt.Println("File contents:", string(data))  // Safe to use data
                                              // string(data) converts []byte to string
```

Here's the key insight: after the `if err != nil` check and the early `return`, any code below is guaranteed to have valid data. The `if err != nil { return }` pattern creates a "guard" that ensures you only proceed with good data.

### The complete pattern

Here's the full pattern you'll see thousands of times in Go code:

```go
// Step 1: Call the function
result, err := someFunction()  // Get the result and the error

// Step 2: Check the error
if err != nil {                 // If something went wrong...
    // Step 3a: Handle the error (log it, wrap it, return it)
    return fmt.Errorf("context about what we were doing: %w", err)
}

// Step 3b: Use the result (we only reach here if err was nil)
doSomethingWith(result)
```

::: info The TypeScript mental model
If it helps, think of `if err != nil` as a really focused `catch` block that only handles one specific operation:

```ts
// TypeScript equivalent (conceptual)
let result;
try {
  result = someFunction();
} catch (err) {
  return new Error(`context: ${err.message}`);
}
doSomethingWith(result);
```

Except in Go, there's no try/catch syntax -- just a regular `if` statement checking a regular value.
:::

<div class="checkpoint">

#### Checkpoint

The core pattern: call a function that returns `(value, error)`, check `if err != nil`, handle the error with an early return, then proceed with the value. This replaces try/catch entirely.

</div>

## Chaining Multiple Fallible Operations

In TypeScript, you'd wrap multiple operations in a single try/catch. In Go, you check each one individually:

In TypeScript:

```ts
// TypeScript -- one catch block for three operations
async function processConfig(): Promise<Config> {
  try {
    const raw = await readFile("config.yaml");
    const parsed = JSON.parse(raw);
    const validated = validateConfig(parsed);
    return validated;
  } catch (err) {
    // Which operation failed? readFile? JSON.parse? validateConfig?
    // We don't know without inspecting the error
    throw new Error(`failed to process config: ${err}`);
  }
}
```

In Go:

```go
func processConfig() (*Config, error) {    // Returns (*Config, error) -- the (value, error) pattern
                                            // *Config is a pointer to a Config struct

    // Operation 1: Read the file
    raw, err := os.ReadFile("config.yaml")  // Read file from disk
    if err != nil {                         // Did the file read fail?
        return nil, fmt.Errorf("reading config file: %w", err)
        // Return nil for the config (no valid data)
        // Wrap the error with context: "reading config file: <original error>"
        // The %w verb wraps the original error (explained later)
    }

    // Operation 2: Parse the YAML
    var parsed Config                       // Declare a Config variable (zero value)
    err = yaml.Unmarshal(raw, &parsed)      // Parse the YAML bytes into the Config struct
                                            // Note: err = (not :=) because err already exists
    if err != nil {                         // Did parsing fail?
        return nil, fmt.Errorf("parsing config YAML: %w", err)
        // Different error context: "parsing config YAML: <original error>"
        // The caller knows EXACTLY which step failed
    }

    // Operation 3: Validate the config
    err = validateConfig(&parsed)           // Run validation logic
    if err != nil {                         // Did validation fail?
        return nil, fmt.Errorf("validating config: %w", err)
        // "validating config: port must be between 1 and 65535"
    }

    return &parsed, nil                     // All three operations succeeded!
                                            // Return the config and nil (no error)
}
```

Each operation is checked individually. If the file read fails, the error message says "reading config file." If parsing fails, it says "parsing config YAML." If validation fails, it says "validating config." The caller gets a precise error message that tells them exactly what went wrong and where.

Compare the error messages:

| TypeScript (single catch) | Go (individual checks) |
|---|---|
| `"failed to process config: ENOENT"` | `"reading config file: open config.yaml: no such file"` |
| `"failed to process config: Unexpected token"` | `"parsing config YAML: line 3: invalid character"` |
| `"failed to process config: invalid port"` | `"validating config: port must be between 1 and 65535"` |

The Go version gives you the complete chain of what happened at each level. The TypeScript version gives you a generic wrapper around whatever error bubbled up.

::: tip Yes, it's more verbose
You're right -- the Go version is about 3x more code than the TypeScript version. That's the trade-off. You trade conciseness for precision. In a BFF serving production traffic, knowing that the error was "parsing config YAML: line 3: field 'port' has invalid type" vs "failed to process config" is the difference between a 5-minute fix and a 30-minute debugging session.
:::

<div class="checkpoint">

#### Checkpoint

In Go, you check errors after each operation individually, not all at once. Each error check adds specific context about what failed. This is more verbose but gives you precise error messages that make debugging much faster.

</div>

## Creating Errors

You have several ways to create errors in Go, depending on how much information you need to include.

### `errors.New()` -- simple error messages

The simplest way to create an error -- just a string message:

```go
import "errors"                            // Import the errors package

func validate(name string) error {         // Returns only an error (no other value)
                                           // This is for functions that either succeed or fail
                                           // with no meaningful return value

    if name == "" {                        // Check if the name is empty
        return errors.New("name cannot be empty")  // Return an error with a message
                                                    // The caller will get this exact string
    }

    if len(name) > 100 {                  // Check if the name is too long
                                           // len() returns the length of a string (like .length in TS)
        return errors.New("name must be 100 characters or fewer")
    }

    return nil                             // Return nil = "everything is fine, no error"
                                           // This is like returning null for the error
}
```

The function returns `nil` when validation passes (no error) and a non-nil error when it fails. The caller checks `if err != nil` to see if validation passed.

### `fmt.Errorf()` -- formatted error messages

When you need to include dynamic values in the error message, use `fmt.Errorf`:

```go
import "fmt"                               // Import fmt for formatted I/O

func validatePort(port int) error {
    if port < 1 || port > 65535 {          // Ports must be in the valid range
        return fmt.Errorf("invalid port %d: must be between 1 and 65535", port)
        // fmt.Errorf works like fmt.Sprintf but returns an error instead of a string
        // %d is a placeholder for an integer
        // If port is 99999, the error message will be:
        // "invalid port 99999: must be between 1 and 65535"
    }
    return nil                             // Port is valid -- no error
}
```

`fmt.Errorf` creates an error with a formatted message, similar to how `fmt.Sprintf` creates a formatted string. This is more useful than `errors.New` when you need to include variable values in the error message.

<div class="checkpoint">

#### Checkpoint

Create simple errors with `errors.New("message")`. Create formatted errors with `fmt.Errorf("message with %s", value)`. Return `nil` when there's no error.

</div>

## Error Wrapping with `%w`

Error wrapping is one of Go's most elegant features. It lets you add context to an error while preserving the original error for later inspection.

### The problem without wrapping

Imagine you're reading a config file, and the file doesn't exist. The raw error is `"open /etc/app/config.yaml: no such file or directory"`. That's technically accurate, but it doesn't tell the caller *why* you were opening this file. Were you loading config? Loading a template? Looking for credentials?

### The solution: wrap with `%w`

```go
func loadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)         // Try to read the config file
    if err != nil {                        // If reading fails...
        return nil, fmt.Errorf("loading config: %w", err)
        // %w is special -- it WRAPS the original error inside a new error
        // The resulting error message: "loading config: open /etc/app/config.yaml: no such file"
        // The original error is preserved inside, and can be inspected later
        // This is like: throw new Error("loading config", { cause: err }) in TypeScript
    }

    // ... parse the data ...
    return config, nil
}
```

What just happened? The `%w` verb in `fmt.Errorf` wraps the original error. The resulting error has a more descriptive message ("loading config: ...") but still contains the original error inside it. You can think of it as adding a label to a box without removing what's inside.

### Unwrapping: inspecting wrapped errors

The whole point of wrapping is that you can later inspect what's inside. Go provides two functions for this:

```go
import (
    "errors"                               // For errors.Is and errors.As
    "os"                                   // For os.ErrNotExist
)

err := loadConfig("/etc/app/config.yaml")  // Call our function -- might fail

if errors.Is(err, os.ErrNotExist) {        // Check: is the original error "file not found"?
    // errors.Is looks INSIDE wrapped errors
    // Even though err is "loading config: open ...: no such file"
    // errors.Is finds os.ErrNotExist inside the wrapping
    // This is like checking: if (err.cause instanceof FileNotFoundError) in TypeScript

    fmt.Println("Config file not found, using defaults")
    return defaultConfig(), nil
}

if err != nil {                            // Some other error (permission denied, disk failure, etc.)
    return nil, err                        // Pass it up to the caller
}
```

What just happened? `errors.Is` "unwraps" the error chain and checks whether any error in the chain matches a specific sentinel value (`os.ErrNotExist`). Even though our error is wrapped with "loading config: ...", `errors.Is` can see through the wrapping to find the original error.

### Multi-level wrapping

Wrapping composes beautifully across multiple layers:

```go
// Layer 1: Low-level file operation
func readYAML(path string) ([]byte, error) {
    data, err := os.ReadFile(path)         // Read the raw bytes
    if err != nil {
        return nil, fmt.Errorf("reading YAML file %s: %w", path, err)
        // Error: "reading YAML file /etc/app/config.yaml: no such file or directory"
    }
    return data, nil
}

// Layer 2: Config loading
func loadConfig() (*Config, error) {
    data, err := readYAML("/etc/app/config.yaml")  // Call the layer below
    if err != nil {
        return nil, fmt.Errorf("loading config: %w", err)
        // Error: "loading config: reading YAML file /etc/app/config.yaml: no such file or directory"
        // The full chain is preserved!
    }
    // ... parse data ...
    return config, nil
}

// Layer 3: Application startup
func startApp() error {
    config, err := loadConfig()            // Call the layer below
    if err != nil {
        return fmt.Errorf("starting app: %w", err)
        // Error: "starting app: loading config: reading YAML file /etc/app/config.yaml: no such file or directory"
        // Three levels of context in one error message!
    }
    // ... use config ...
    return nil
}
```

Each layer added its own context with `%w`. The final error message reads like a stack trace in reverse: "starting app: loading config: reading YAML file ...: no such file or directory." And because we used `%w` at every level, `errors.Is(err, os.ErrNotExist)` still works at the top level.

In TypeScript, the closest equivalent would be:

```ts
// TypeScript -- manual cause chaining (ES2022+)
throw new Error("starting app", {
  cause: new Error("loading config", {
    cause: new Error("reading YAML file: no such file"),
  }),
});
```

Go's `%w` does this in a single line.

<div class="checkpoint">

#### Checkpoint

Wrap errors with `fmt.Errorf("context: %w", err)` to add context while preserving the original error. Use `errors.Is(err, target)` to check if any error in the chain matches a specific value. Wrapping composes across multiple layers.

</div>

## Custom Error Types

Sometimes a string message isn't enough. You need structured information about what went wrong -- which field failed validation, what status code to return, what resource was not found.

### Defining a custom error type

Any type with an `Error() string` method is an error. Let's create a `ValidationError`:

```go
// ValidationError represents a validation failure on a specific field.
// It implements the error interface by having an Error() string method.
type ValidationError struct {
    Field   string             // Which field failed validation (e.g., "name", "port")
    Message string             // What went wrong (e.g., "must not be empty")
}

// Error implements the error interface.
// This method makes ValidationError satisfy the error interface.
// Any time someone prints this error or calls .Error(), they get this string.
func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on field %q: %s", e.Field, e.Message)
    // %q adds quotes around the field name
    // Result: `validation error on field "name": must not be empty`
}
```

Notice that we created a struct that holds structured error information (field name and message) and gave it an `Error() string` method. Because it has that method, Go considers it an `error` -- you can return it anywhere an `error` is expected.

### Using a custom error type

```go
func validateRequest(name string, port int) error {  // Returns error (the interface)
    if name == "" {
        return &ValidationError{           // Return a pointer to a ValidationError
            Field:   "name",              // The "name" field failed
            Message: "must not be empty", // Because it's empty
        }
        // The & creates a pointer -- we return *ValidationError
        // This satisfies the error interface because *ValidationError has Error()
    }

    if port < 1 || port > 65535 {
        return &ValidationError{           // Another validation error
            Field:   "port",              // The "port" field failed
            Message: fmt.Sprintf("must be between 1 and 65535, got %d", port),
        }
    }

    return nil                             // All validations passed -- no error
}
```

### Checking for a specific error type with `errors.As`

The caller can check whether the error is a `ValidationError` and extract the structured data:

```go
err := validateRequest("", 8080)           // This will fail because name is empty

var valErr *ValidationError                // Declare a variable of the specific error type
                                           // This will hold the error if it matches

if errors.As(err, &valErr) {               // Try to match the error to *ValidationError
    // errors.As looks INSIDE wrapped errors (just like errors.Is)
    // If it finds a *ValidationError, it stores it in valErr
    // &valErr means "the address of valErr" -- errors.As writes into it

    fmt.Println("Bad field:", valErr.Field)      // "name" -- structured data!
    fmt.Println("Problem:", valErr.Message)      // "must not be empty"

    // You can make decisions based on the structured data
    // e.g., return a 400 response with the specific field name
}
```

What just happened? `errors.As` is like a type assertion for errors. It checks whether the error (or any wrapped error in the chain) is of a specific type, and if so, extracts it into a variable you can inspect. This is Go's equivalent of TypeScript's `if (err instanceof ValidationError)`.

### `errors.Is` vs `errors.As`

These two functions do different things:

| Function | Purpose | TypeScript equivalent |
|---|---|---|
| `errors.Is(err, target)` | Does this error chain contain this specific **value**? | `err === specificError` (checking identity) |
| `errors.As(err, &target)` | Does this error chain contain this specific **type**? | `err instanceof ErrorType` (checking type) |

```go
// errors.Is -- checking for a specific error VALUE
if errors.Is(err, os.ErrNotExist) {        // Is this a "file not found" error?
    // os.ErrNotExist is a specific error value defined in the os package
}

// errors.As -- checking for a specific error TYPE
var valErr *ValidationError
if errors.As(err, &valErr) {               // Is this a ValidationError (or wrapped one)?
    fmt.Println(valErr.Field)              // Access the structured data
}
```

<div class="checkpoint">

#### Checkpoint

Custom error types are structs with an `Error() string` method. Use `errors.As(err, &target)` to check for and extract specific error types. Use `errors.Is(err, target)` to check for specific error values. Both work through wrapped error chains.

</div>

## When to `panic` (Almost Never)

Go does have one thing that looks like `throw` -- it's called `panic`. It immediately stops the current function, unwinds the stack, and crashes the program unless something `recover`s it.

**Do not use panic for normal error handling.** This is critical. `panic` is for genuinely unrecoverable situations -- programmer bugs, impossible states, configuration errors during startup where the program literally cannot work.

```go
// ACCEPTABLE: A startup configuration that must be valid for the program to work
func MustParseTemplate(s string) *template.Template {
    // "Must" prefix is a convention that means "this panics on error"
    t, err := template.New("").Parse(s)    // Try to parse the template
    if err != nil {
        panic(fmt.Sprintf("invalid template: %s", err))
        // panic crashes the program immediately
        // This is acceptable here because:
        // 1. It's called during startup, not during a request
        // 2. If the template is invalid, the program can't serve any requests
        // 3. The developer made a programming mistake (hardcoded bad template)
    }
    return t
}
```

```go
// NOT ACCEPTABLE: User input, network errors, file I/O
func loadFile(path string) []byte {
    data, err := os.ReadFile(path)         // Try to read a file
    if err != nil {
        panic(err)                         // DON'T DO THIS!
        // This crashes the entire server because one file couldn't be read
        // What if the file is missing? What if permissions are wrong?
        // These are normal errors, not programmer bugs
        // RETURN the error instead:
        // return nil, fmt.Errorf("reading file: %w", err)
    }
    return data
}
```

::: danger The rule: return errors, don't panic
If the error could happen during normal operation (network failure, file not found, invalid user input, API timeout), return it as an error value. Only `panic` for programming mistakes that should have been caught during development and testing.

You'll see `Must` functions in Go's standard library: `template.Must()`, `regexp.MustCompile()`. These are for initialization code where failure means the program can't work at all. In BFF request handlers, never panic.
:::

<div class="checkpoint">

#### Checkpoint

`panic` is Go's `throw`, but it should almost never be used. It's for programmer bugs and startup failures, not for runtime errors. Functions prefixed with `Must` conventionally panic on error. In BFF handlers, always return errors -- never panic.

</div>

## A Real BFF Handler -- The Complete Error Flow

Let's put everything together with a real handler from a BFF service. This example uses every error handling concept from this chapter. We'll build it up step by step.

### The TypeScript version (for comparison)

First, here's how you'd write this handler in Express/TypeScript:

```ts
// Express handler -- TypeScript
async function createModelHandler(req: Request, res: Response) {
  try {
    const { name, namespace } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const model = await modelService.create(name, namespace);
    res.status(201).json(model);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
    } else {
      console.error("unexpected error:", err);
      res.status(500).json({ error: "internal server error" });
    }
  }
}
```

### The Go version (annotated line by line)

Now the Go equivalent, with every error path explicit:

```go
// CreateModelHandler handles POST requests to create a new model.
// It's a method on *App -- the receiver gives us access to services, logger, etc.
func (app *App) CreateModelHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    // w = http.ResponseWriter -- where we write the response (like Express's res)
    // r = *http.Request -- the incoming request (like Express's req)
    // ps = httprouter.Params -- URL parameters (like req.params in Express)

    // Step 1: Decode the JSON request body into a struct
    var input struct {                     // Declare an anonymous struct for the request body
        Name      string `json:"name"`    // The model name from the JSON body
        Namespace string `json:"namespace"`  // The namespace from the JSON body
    }

    err := json.NewDecoder(r.Body).Decode(&input)  // Decode the JSON body into input
    // json.NewDecoder creates a decoder that reads from r.Body (the request body)
    // .Decode(&input) fills the input struct from the JSON
    // &input means "the address of input" -- Decode writes into it
    // This returns an error if the JSON is malformed

    if err != nil {                        // ERROR CHECK 1: Was the JSON valid?
        app.badRequestResponse(w, r, fmt.Errorf("invalid JSON body"))
        // Send a 400 Bad Request with a clear error message
        // The caller sent us garbage JSON -- that's their problem
        return                             // IMPORTANT: stop here, don't continue
    }

    // Step 2: Validate the input
    if input.Name == "" {                  // Check if name is missing or empty
        app.badRequestResponse(w, r, fmt.Errorf("name is required"))
        // Another 400 -- the JSON was valid but the data is incomplete
        return                             // Stop here
    }

    // Step 3: Call the service layer to create the model
    model, err := app.modelService.Create(r.Context(), input.Name, input.Namespace)
    // app.modelService is accessed through the pointer receiver
    // r.Context() passes the request context (carries deadlines, cancellation, auth info)
    // Returns (model, error) -- the standard Go pattern

    if err != nil {                        // ERROR CHECK 2: Did the service call fail?
        // Check if it's a specific error type we know how to handle
        var notFoundErr *NotFoundError     // Declare a variable for the specific type
        if errors.As(err, &notFoundErr) {  // Is the error (or a wrapped error) a NotFoundError?
            app.notFoundResponse(w, r)     // Send a 404 Not Found response
            return                         // Stop here
        }

        // If it's not a NotFoundError, it's an unexpected error
        app.serverErrorResponse(w, r, err) // Send a 500 Internal Server Error
        // serverErrorResponse also logs the error for debugging:
        // app.logger.Error("internal server error", "error", err, "method", r.Method)
        return                             // Stop here
    }

    // Step 4: Success! Write the response
    err = app.WriteJSON(w, http.StatusCreated, model, nil)
    // Write the model as JSON with a 201 Created status code
    // http.StatusCreated is the constant 201
    // nil means no extra headers

    if err != nil {                        // ERROR CHECK 3: Did writing the response fail?
        app.serverErrorResponse(w, r, err) // This can happen if JSON marshaling fails
                                           // or the client disconnected mid-response
        // Note: no return needed here -- it's the last statement in the function
    }
}
```

Let's count the error checks:

1. **JSON decoding failed** -- bad request (400)
2. **Name is empty** -- bad request (400)
3. **Service returned a NotFoundError** -- not found (404)
4. **Service returned any other error** -- server error (500)
5. **Writing the response failed** -- server error (500)

Every single failure point is visible in the code. There's no hidden exception path. You can read the handler top to bottom and see exactly what happens for every possible outcome.

### The error helper methods

The handler calls several helper methods like `app.badRequestResponse` and `app.serverErrorResponse`. Here's what they look like:

```go
// badRequestResponse sends a 400 Bad Request with a custom message.
// Used for client errors -- invalid input, missing fields, malformed data.
func (app *App) badRequestResponse(w http.ResponseWriter, r *http.Request, message string) {
    app.WriteJSON(w, http.StatusBadRequest, ErrorEnvelope{
        // http.StatusBadRequest is the constant 400
        Error: &HTTPError{                 // Create the error response struct
            StatusCode: http.StatusBadRequest,  // 400 -- used for logging, not in JSON (json:"-")
            ErrorResponse: ErrorResponse{
                Code:    "bad_request",    // Machine-readable error code
                Message: message,          // Human-readable message from the caller
            },
        },
    }, nil)
}

// serverErrorResponse sends a 500 Internal Server Error.
// Used for unexpected errors -- logs the actual error for debugging.
func (app *App) serverErrorResponse(w http.ResponseWriter, r *http.Request, err error) {
    // Log the real error for the ops team (never send internal errors to clients!)
    app.logger.Error("internal server error",
        "error", err,                      // The actual error (might contain stack info, queries, etc.)
        "method", r.Method,                // GET, POST, etc.
        "url", r.URL.String(),             // The requested URL
    )

    // Send a generic error to the client (don't leak internals!)
    app.WriteJSON(w, http.StatusInternalServerError, ErrorEnvelope{
        Error: &HTTPError{
            StatusCode: http.StatusInternalServerError,  // 500
            ErrorResponse: ErrorResponse{
                Code:    "internal_error",              // Generic code
                Message: "an internal error occurred",  // Generic message -- don't expose err!
            },
        },
    }, nil)
}
```

These helpers standardize error responses across all handlers. Every 400 error looks the same, every 500 error looks the same. The client always gets a consistent JSON structure. And critically, `serverErrorResponse` logs the real error for debugging but sends a generic message to the client -- never leaking internal details.

<div class="checkpoint">

#### Checkpoint

A real BFF handler checks errors after every fallible operation: JSON decoding, input validation, service calls, and response writing. Each error gets appropriate handling (400, 404, 500). Error helper methods standardize the response format. Internal errors are logged but never exposed to clients.

</div>

## Why Is This Actually Better Than try/catch?

You've made it this far, and you're probably thinking: "This is so verbose. How is this better?"

Here are five concrete advantages of Go's error handling:

### 1. Every error path is visible

In the BFF handler above, you can see all five error paths just by scanning the code. In the TypeScript version, the `catch` block hides which operation failed.

### 2. Errors have context at every level

Each `fmt.Errorf("context: %w", err)` adds a layer of context. When you see "starting app: loading config: reading YAML file: permission denied," you know exactly what happened at every level. Try/catch often loses this context.

### 3. You can't accidentally ignore errors

If you declare a variable to capture an error but never use it, the Go compiler rejects your code. However, you CAN call a function and simply ignore its return values entirely -- the compiler won't stop you (though linters will warn you). In TypeScript, you can forget to `await` a promise, forget to add a `catch`, or let an exception fly through without any warning.

```go
err := os.Remove("temp.txt")  // COMPILE ERROR if you never use err
                               // Go requires every declared variable to be used

_ = os.Remove("temp.txt")     // OK -- you explicitly chose to ignore the error
                               // The _ says "I know this can fail, I don't care"

os.Remove("temp.txt")          // Also compiles -- ignoring ALL return values is legal
                               // But linters (like golangci-lint) will flag this
```

### 4. Error types are checkable at compile time

The `(value, error)` return type tells you at a glance that a function can fail. In TypeScript, any function can throw -- there's nothing in the signature to warn you.

### 5. No surprise stack unwinding

In TypeScript, an unhandled exception can unwind through any number of stack frames and crash in a completely unexpected place. In Go, errors are values that flow through explicit `return` statements. They can't teleport across function boundaries.

::: tip The honest trade-off
Go's error handling is more verbose and more repetitive. You will write `if err != nil` many, many times. But every error is handled at the point where it occurs, with specific context, and you can't accidentally forget to handle one. For a BFF service handling production traffic, this explicitness is worth the extra lines of code.
:::

## Quick Reference

| TypeScript | Go | Notes |
|---|---|---|
| `throw new Error("msg")` | `return errors.New("msg")` | Errors are returned, not thrown |
| `try { ... } catch (e) { ... }` | `if err != nil { ... }` | Check after each call |
| `new Error("msg", { cause })` | `fmt.Errorf("msg: %w", err)` | Wrap with context |
| `err instanceof Type` | `errors.As(err, &target)` | Check error type |
| `err === specific` | `errors.Is(err, target)` | Check error value |
| `throw` (unrecoverable) | `panic()` | Almost never use panic |
| No equivalent | Return `nil` | Means "no error" |

::: tip Key Takeaway
Go errors are values, not exceptions. Functions return `(result, error)`, and you check `if err != nil` after every call. Use `fmt.Errorf("context: %w", err)` to wrap errors with context. Use `errors.Is` and `errors.As` to inspect wrapped errors. Reserve `panic` for programmer bugs, never for runtime errors. It's more verbose than try/catch, but every error path is visible and explicit.
:::

::: info Up Next
- [HTTP Servers](./http) -- building HTTP handlers with proper error responses
- [JSON](./json) -- decoding request bodies and encoding responses (where many errors originate)
- [Testing](./testing) -- testing error cases and verifying error behavior
:::
