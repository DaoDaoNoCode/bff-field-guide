# Interfaces — Structural Typing, Go Style

> **Go Concept:** Interfaces define behavior contracts — and they're satisfied implicitly. No `implements` keyword required.

You know how TypeScript has structural typing? If an object has the right shape, it satisfies the type — no `implements` keyword needed. You just... create an object with the right properties and it works.

Go interfaces work **exactly the same way.** But instead of matching on *properties* (like TypeScript), Go matches on *methods*. If a type has the right methods, it satisfies the interface. Automatically. Silently. No declaration required.

This is one of the few places where Go will feel instantly familiar rather than alien. Let's dig in.

## Start with What You Know

In TypeScript, structural typing means an object matches a type if it has the right shape. You don't need an `implements` keyword:

```ts
// TypeScript — structural typing for objects
interface Logger {                          // Define what a Logger looks like
  log(message: string): void;               // It must have a 'log' method
}

// This class NEVER says "implements Logger"
class ConsoleLogger {                       // Just a regular class
  log(message: string): void {              // But it has a 'log' method with the right signature
    console.log(message);                   // So it matches the Logger interface
  }
}

function useLogger(l: Logger) {             // Accepts anything with a 'log' method
  l.log("hello");                           // Calls log — doesn't care about the concrete type
}

useLogger(new ConsoleLogger());             // Works! ConsoleLogger has a 'log' method
                                            // No "implements Logger" anywhere
```

**What just happened?** `ConsoleLogger` never declares that it implements `Logger`. TypeScript just sees that it has a `log(message: string): void` method and says "close enough."

Go does the same thing, but for method sets on types:

```go
type Logger interface {                     // Define an interface with one method
    Log(message string)                     // Any type with a Log(string) method qualifies
}

type ConsoleLogger struct{}                 // A struct — no "implements Logger" anywhere

func (c *ConsoleLogger) Log(message string) { // Attach a Log method to ConsoleLogger
    fmt.Println(message)                       // Print the message
}                                              // ConsoleLogger now satisfies Logger

func useLogger(l Logger) {                  // Accept any Logger — doesn't matter which one
    l.Log("hello")                          // Call Log on whatever was passed in
}
```

```go
useLogger(&ConsoleLogger{})                 // Works! ConsoleLogger has Log(string)
                                            // Go checked automatically — no declaration needed
```

**What just happened?** We defined a `Logger` interface with one method. We created `ConsoleLogger` with a matching `Log` method. We never wrote `ConsoleLogger implements Logger`. Go's compiler figured it out on its own, just like TypeScript does for object shapes.

::: info Wait, Where's `implements`?
There isn't one. In Go, interface satisfaction is always implicit. If your type has the methods, it satisfies the interface. Period. This might feel unsettling at first — how do you know if your type *really* implements an interface? We'll cover a compile-time check pattern at the end of this chapter that puts your mind at ease.
:::

<div class="checkpoint">

#### Checkpoint
Go interfaces are satisfied implicitly. If a type has the right methods, it satisfies the interface — no `implements` keyword. This is structural typing for methods, just like TypeScript has structural typing for object shapes.
</div>

## Defining Interfaces

An interface is simply a list of method signatures. Nothing else — no properties, no constructors, no default implementations:

```go
// An interface with one method
type Reader interface {                     // Any type with a Read method matches
    Read(p []byte) (n int, err error)       // The method signature — name, params, returns
}

// An interface with two methods
type ReadWriter interface {                 // Must have BOTH Read and Write to match
    Read(p []byte) (n int, err error)       // First method
    Write(p []byte) (n int, err error)      // Second method
}
```

You can also **compose** interfaces by embedding one inside another, similar to TypeScript's `extends`:

```go
// Composing interfaces — like 'extends' in TypeScript
type ReadWriteCloser interface {            // This interface has three methods total
    Reader                                  // Embed Reader — pulls in Read()
    Writer                                  // Embed Writer — pulls in Write()
    Close() error                           // Add one more method
}
```

::: code-group
```ts [TypeScript]
// TypeScript — extending interfaces
interface Reader {                          // Base interface
  read(buffer: Uint8Array): number;         // One method
}

interface Writer {                          // Another base interface
  write(buffer: Uint8Array): number;        // One method
}

interface ReadWriter extends Reader, Writer {} // Extends both — has read() and write()
```

```go [Go]
// Go — embedding interfaces
type Reader interface {                     // Base interface
    Read(p []byte) (int, error)             // One method
}

type Writer interface {                     // Another base interface
    Write(p []byte) (int, error)            // One method
}

type ReadWriter interface {                 // Embeds both — has Read() and Write()
    Reader                                  // Embed Reader
    Writer                                  // Embed Writer
}
```
:::

**What just happened?** Go's interface embedding is like TypeScript's `extends`. You pull in all the methods from the embedded interface. `ReadWriter` requires both `Read()` and `Write()`, even though it doesn't list them explicitly.

## Small Interfaces — Go's Philosophy

Here's a key cultural difference between TypeScript and Go. In TypeScript, interfaces can be large — 10, 20, 30 properties. That's normal. In Go, the community strongly favors **small interfaces** — usually one or two methods.

There's even a famous Go proverb: *"The bigger the interface, the weaker the abstraction."*

The Go standard library lives by this rule. Look at these interfaces that power the entire I/O system:

```go
// io.Reader — ONE method, used everywhere in Go
type Reader interface {                     // Any type that can produce bytes
    Read(p []byte) (n int, err error)       // Fill the buffer, return how many bytes
}

// io.Writer — ONE method, used everywhere in Go
type Writer interface {                     // Any type that can consume bytes
    Write(p []byte) (n int, err error)      // Write the bytes, return how many
}

// io.Closer — ONE method
type Closer interface {                     // Any type that can be closed/cleaned up
    Close() error                           // Close it, return any error
}
```

Files, network connections, HTTP response bodies, compressed streams, encryption wrappers — they all implement these tiny interfaces. A function that accepts an `io.Reader` can read from any of them without knowing or caring which concrete type it's dealing with.

```go
// This function works with files, HTTP bodies, strings, buffers — anything
func countBytes(r io.Reader) (int, error) { // Accepts any type with a Read method
    buf := make([]byte, 1024)               // Create a 1KB buffer
    total := 0                              // Running count of bytes read
    for {                                   // Loop until we're done
        n, err := r.Read(buf)               // Read up to 1024 bytes
        total += n                          // Add to the count (even on error, n may be > 0)
        if err != nil {                     // Check for errors
            if err == io.EOF {              // io.EOF signals end of data — not an error
                break                       // We've read everything successfully
            }
            return total, err               // Real error — return what we've counted so far
        }
    }
    return total, nil                       // All data read successfully
}
```

::: tip
When designing your own interfaces in BFF code, keep them small. One to three methods is ideal. If you find yourself with a 10-method interface, you probably need to split it into smaller, focused ones.
:::

<div class="checkpoint">

#### Checkpoint
Go favors small interfaces (1-3 methods). The standard library's most powerful interfaces (`io.Reader`, `io.Writer`, `error`) have just one method each. Small interfaces are easier to implement, easier to mock, and easier to compose.
</div>

## The Empty Interface: `any`

What happens if an interface has zero methods? Then *every* type satisfies it, because every type has at least zero methods. This is the **empty interface**, and it's Go's equivalent of TypeScript's `unknown`:

```go
// These two lines mean the same thing (any is an alias since Go 1.18)
var x interface{}                           // Old syntax — empty interface
var y any                                   // New syntax — same thing, easier to read
```

Since `any` has no methods, you can store anything in it:

```go
var x any                                   // x can hold any type
x = 42                                     // An int — OK
x = "hello"                                // A string — OK
x = true                                   // A bool — OK
x = User{Name: "Alice"}                    // A struct — OK
```

::: code-group
```ts [TypeScript]
// TypeScript — unknown can hold anything
let x: unknown;                             // Can hold any value
x = 42;                                    // OK
x = "hello";                               // OK

// But you can't USE it without narrowing
console.log(x.toUpperCase());              // ERROR — must check the type first

if (typeof x === "string") {               // Narrow the type with typeof
  console.log(x.toUpperCase());            // Now TypeScript knows it's a string
}
```

```go [Go]
// Go — any can hold anything
var x any                                  // Can hold any value
x = 42                                    // OK
x = "hello"                               // OK

// But you can't USE it without asserting
// fmt.Println(x + 1)                     // ERROR — can't add to 'any'

if s, ok := x.(string); ok {              // Assert the type with .(type)
    fmt.Println(strings.ToUpper(s))        // Now Go knows it's a string
}
```
:::

**What just happened?** Just like TypeScript's `unknown`, Go's `any` lets you store anything but forces you to check the type before you can actually *use* the value. The syntax is different (`typeof` vs `.(type)`), but the idea is identical: "I don't know what this is, let me check first."

You'll encounter `any` in two main places:
1. **JSON handling**: `map[string]any` is how Go represents arbitrary JSON objects
2. **Generic utility code**: functions that need to work with any type

But in general, **avoid `any` when you can use a specific type.** It loses all the safety benefits of Go's type system.

## Type Assertions — Like Type Narrowing

When you have an `any` value (or any interface value), you need to extract the concrete type. This is called a **type assertion**, and it's Go's version of TypeScript's type narrowing.

### The Dangerous Way (Don't Do This)

```go
var val any = "hello"                      // val holds a string, typed as any

s := val.(string)                          // Type assertion — PANICS if val isn't a string!
fmt.Println(s)                             // "hello" — works this time, but risky
```

If `val` were actually a number, that line would **crash your program**. Always use the safe form:

### The Safe Way (Comma-OK Pattern)

```go
var val any = "hello"                      // val holds a string, typed as any

s, ok := val.(string)                      // Safe assertion — returns (value, bool)
                                           // ok is true if val really is a string
if ok {                                    // Check before using
    fmt.Println(s)                         // "hello" — safe to use
} else {
    fmt.Println("not a string")            // Handle the wrong-type case
}
```

**What just happened?** The two-value form `s, ok := val.(string)` never panics. If `val` is a string, `ok` is `true` and `s` holds the value. If not, `ok` is `false` and `s` is the zero value for string (`""`). This is the comma-ok pattern you saw in [Types & Variables](./types-and-variables).

::: warning
A type assertion without the `ok` check will **panic** if the type is wrong:
```go
var val any = 42                           // val is an int
s := val.(string)                          // RUNTIME PANIC: interface conversion: int is not string
```
Always use the two-value form `s, ok := val.(string)` unless you're absolutely certain of the type.
:::

### Type Switches — Like `typeof` on Steroids

When you need to check multiple possible types, use a **type switch**:

```go
func describe(val any) {                   // Accept any type
    switch v := val.(type) {               // Switch on the concrete type of val
    case string:                           // If val is a string...
        fmt.Println("string:", v)          // v is automatically typed as string here
    case int:                              // If val is an int...
        fmt.Println("int:", v)             // v is automatically typed as int here
    case bool:                             // If val is a bool...
        fmt.Println("bool:", v)            // v is automatically typed as bool here
    default:                               // If none of the above...
        fmt.Println("unknown type")        // Handle the fallthrough case
    }
}
```

::: code-group
```ts [TypeScript]
// TypeScript — type narrowing with typeof
function describe(val: unknown): void {      // Accept unknown type
  if (typeof val === "string") {             // Check type
    console.log("string:", val.toUpperCase()); // val is narrowed to string
  } else if (typeof val === "number") {      // Check another type
    console.log("number:", val * 2);          // val is narrowed to number
  } else {
    console.log("unknown type");             // Fallthrough
  }
}
```

```go [Go]
// Go — type switch
func describe(val any) {                   // Accept any type
    switch v := val.(type) {               // The magic syntax: .(type)
    case string:                           // Match on string
        fmt.Println("string:", strings.ToUpper(v)) // v is string in this branch
    case int:                              // Match on int
        fmt.Println("int:", v*2)           // v is int in this branch
    default:                               // Fallthrough
        fmt.Println("unknown type")
    }
}
```
:::

**What just happened?** `val.(type)` is special syntax that only works inside a `switch`. It extracts the concrete type and creates a correctly-typed variable `v` in each `case` branch. The TypeScript equivalent is a chain of `typeof` checks, but Go's type switch is cleaner because `v` is automatically narrowed.

<div class="checkpoint">

#### Checkpoint
- Use `val.(Type)` for type assertions — always use the comma-ok form (`s, ok := val.(string)`) to avoid panics.
- Use `switch v := val.(type)` for type switches when checking multiple types.
- `any` (empty interface) accepts all types but requires assertion before use.
</div>

## Why Interfaces Matter in BFF Code

This is the payoff section. Interfaces in Go aren't just an academic concept — they're the foundation of testable, maintainable BFF code. Here's why.

### The Problem: You Need to Test Without Real Services

Your BFF handler calls a Kubernetes API. In tests, you don't have a Kubernetes cluster. How do you test?

In TypeScript, you'd reach for Jest mocks, dependency injection, or mock libraries:

```ts
// TypeScript — mocking with Jest
interface ModelService {                    // Define the service contract
  listModels(namespace: string): Promise<Model[]>; // What the handler needs
}

class App {                                 // The app holds the service
  constructor(private modelService: ModelService) {} // Injected via constructor
}

// In tests — swap in a mock
const mockService: ModelService = {         // Create an object matching the shape
  listModels: jest.fn().mockResolvedValue(testModels), // Return fake data
};
const app = new App(mockService);           // The app uses the mock — can't tell the difference
```

In Go, you don't need a mocking framework. Interfaces give you the same thing for free:

### Step 1: Define What You Need as an Interface

```go
// The interface — what the handler actually needs from the service
type ModelService interface {               // Just the methods the handler calls
    ListModels(                             // List models in a namespace
        ctx context.Context,               // Context for cancellation/timeout
        namespace string,                  // Which namespace to list from
    ) ([]Model, error)                     // Returns models or an error

    GetModel(                              // Get a single model by ID
        ctx context.Context,               // Context
        namespace string,                  // Namespace
        id string,                         // Model ID
    ) (*Model, error)                      // Returns a model pointer or error
}
```

### Step 2: Create the Real Implementation

```go
// The REAL implementation — calls the actual API
type llamaStackService struct {             // Concrete type, unexported (lowercase)
    client  *http.Client                   // HTTP client for making requests
    baseURL string                         // Base URL of the LlamaStack API
}

func (s *llamaStackService) ListModels(    // Satisfies ModelService.ListModels
    ctx context.Context,                   // Context from the request
    namespace string,                      // Which namespace
) ([]Model, error) {                       // Returns models or error
    // ... real HTTP call to LlamaStack API
    resp, err := s.client.Get(             // Make the actual HTTP request
        s.baseURL + "/models",             // To the real API endpoint
    )
    // ... parse response, return models
    return models, nil                     // Return the real data
}
```

### Step 3: Create a Mock for Testing

```go
// The MOCK implementation — returns canned data
type mockModelService struct {              // Another concrete type
    models []Model                         // What to return when ListModels is called
    err    error                           // What error to return (if any)
}

func (m *mockModelService) ListModels(     // Satisfies ModelService.ListModels
    ctx context.Context,                   // Same signature as the interface requires
    namespace string,                      // Same parameters
) ([]Model, error) {                       // Same return types
    return m.models, m.err                 // Just return the canned data
}

func (m *mockModelService) GetModel(       // Satisfies ModelService.GetModel
    ctx context.Context,                   // Same signature
    namespace string,                      // Same parameters
    id string,                             // Same parameters
) (*Model, error) {                        // Same return types
    for _, model := range m.models {       // Search through the mock data
        if model.ID == id {                // Find matching ID
            return &model, nil             // Return a pointer to it
        }
    }
    return nil, fmt.Errorf("not found")    // Not found — return an error
}
```

### Step 4: Inject the Interface Into Your App

```go
type App struct {                           // The app struct holds dependencies
    logger       *slog.Logger              // Structured logger
    modelService ModelService              // Interface! Not a concrete type!
}                                          // This is the key — App depends on behavior, not implementation
```

Now the magic: the same `App` code works with both real and mock implementations:

```go
// In PRODUCTION — use the real service
app := &App{                               // Create the app
    logger:       logger,                  // Real logger
    modelService: &llamaStackService{      // Real service — calls actual API
        client:  httpClient,               // Real HTTP client
        baseURL: apiURL,                   // Real API URL
    },
}

// In TESTS — use the mock service
app := &App{                               // Create the app for testing
    logger: logger,                        // Test logger (or slog.Default())
    modelService: &mockModelService{       // Mock service — returns canned data
        models: []Model{                   // Predefined test data
            {ID: "1", Name: "llama-3"},    // First test model
            {ID: "2", Name: "mistral"},    // Second test model
        },
    },
}
```

::: code-group
```ts [TypeScript]
// TypeScript — same pattern with dependency injection
interface ModelService {                    // The contract
  listModels(ns: string): Promise<Model[]>; // What we need
}

class App {
  constructor(private modelService: ModelService) {} // Interface in constructor
}

// Production
const app = new App(new LlamaStackService(httpClient)); // Real

// Tests
const app = new App({                       // Mock object matching the shape
  listModels: jest.fn().mockResolvedValue(testModels),
});
```

```go [Go]
// Go — no framework needed, just interfaces
type ModelService interface {               // The contract
    ListModels(ctx context.Context, ns string) ([]Model, error) // What we need
}

type App struct {
    modelService ModelService               // Interface in struct field
}

// Production
app := &App{modelService: &llamaStackService{...}} // Real

// Tests
app := &App{modelService: &mockModelService{       // Mock struct with same methods
    models: testModels,
}}
```
:::

**What just happened?** Neither `llamaStackService` nor `mockModelService` ever declares that they implement `ModelService`. They just have the right methods. Go figures it out. Your handler code calls `app.modelService.ListModels(...)` and has no idea (and doesn't care) whether it's talking to a real API or a mock. That's the power of interfaces.

<div class="checkpoint">

#### Checkpoint
Interfaces enable dependency injection without frameworks. Define an interface for what your code needs, create a real implementation for production and a mock for tests, and inject either one into your App struct. No `implements` keyword, no mocking library.
</div>

## A Real BFF Interface: The Kubernetes Client

Here's a simplified version of an actual interface from the BFF codebase. This is the pattern you'll work with daily:

```go
// KubernetesClientInterface — what the BFF needs from Kubernetes
type KubernetesClientInterface interface {  // The behavior contract

    GetServiceURL(                         // Find a service's URL
        ctx context.Context,               // Context for timeout/cancellation
        namespace string,                  // Which namespace
        serviceName string,                // Which service
    ) (string, error)                      // Returns the URL or an error

    CanAccess(                             // Check if a user can access a namespace
        ctx context.Context,               // Context
        identity *RequestIdentity,         // Who is the user
        namespace string,                  // What namespace
    ) (bool, error)                        // Returns allowed (true/false) or error
}
```

Any type with `GetServiceURL` and `CanAccess` methods satisfies this interface. The real implementation calls the Kubernetes API. The mock implementation returns test data. Your handler code works with either:

```go
func (app *App) ModelsHandler(             // A handler that lists models
    w http.ResponseWriter,                 // Response writer
    r *http.Request,                       // Incoming request
    ps httprouter.Params,                  // URL parameters
) {
    namespace := ps.ByName("namespace")    // Get namespace from URL params

    // This works with EITHER the real or mock K8s client
    canAccess, err := app.k8sClient.CanAccess( // Call the interface method
        r.Context(),                           // Pass the request context
        getIdentity(r),                        // Get user identity from request
        namespace,                             // The namespace to check
    )
    if err != nil {                        // Handle error
        app.serverErrorResponse(w, r, err) // Return 500
        return
    }
    if !canAccess {                        // Check authorization
        app.forbiddenResponse(w, r)        // Return 403
        return
    }
    // ... proceed to list models
}
```

## Compile-Time Interface Checks

Since Go interfaces are implicit, there's a real risk: you *think* your type implements an interface, but you misspelled a method name or got the signature wrong. You won't find out until you try to pass it somewhere.

There's a clever trick to catch this at compile time:

```go
// This line ENSURES that ConsoleLogger satisfies Logger at COMPILE TIME
var _ Logger = (*ConsoleLogger)(nil)        // If ConsoleLogger is missing Log(),
                                           // this line causes a COMPILE ERROR
```

Let's break down this strange-looking line:

```go
var _ Logger = (*ConsoleLogger)(nil)
//  ^   ^         ^              ^
//  |   |         |              |
//  |   |         |              nil value (doesn't create a real instance)
//  |   |         Convert nil to *ConsoleLogger type
//  |   The interface it must satisfy
//  Blank identifier — we don't need the variable
```

**What just happened?** This line says "create a nil `*ConsoleLogger` and assign it to a `Logger` variable." We throw away the result (using `_`), so it costs nothing at runtime. But if `*ConsoleLogger` doesn't satisfy `Logger`, the compiler refuses to build. It's a free safety check.

You'll see this in BFF code to verify that mock types actually implement the interfaces they're supposed to:

```go
// Verify our mock satisfies the interface — fail at compile time, not test time
var _ ModelService = (*mockModelService)(nil)     // Catches missing methods early
var _ KubernetesClientInterface = (*mockK8sClient)(nil) // Same check for K8s mock
```

::: tip
Always add these compile-time checks when you create a mock or a new implementation of an interface. They cost nothing and save you from confusing errors later.
:::

<div class="checkpoint">

#### Checkpoint
Use `var _ Interface = (*Struct)(nil)` to verify at compile time that a struct satisfies an interface. This catches missing or misspelled methods before you even run the code.
</div>

## Interfaces vs TypeScript: The Key Differences

Let's summarize the differences in one table:

| Aspect | TypeScript | Go |
|---|---|---|
| **What's matched** | Object properties (shape) | Methods (behavior) |
| **Declaration** | `implements` optional | No `implements` at all |
| **Size convention** | Large interfaces are common | Small interfaces (1-3 methods) |
| **Generic "any"** | `unknown` | `any` (alias for `interface{}`) |
| **Type checking** | `typeof`, `instanceof` | Type assertions, type switches |
| **Composition** | `extends` keyword | Embedding (just list the interface name) |
| **Compile-time check** | `implements` keyword | `var _ I = (*T)(nil)` pattern |

## Quick Reference

```go
// === Defining interfaces ===
type Reader interface {                     // An interface with one method
    Read(p []byte) (int, error)            // Method signature
}

type ReadWriter interface {                 // Composing interfaces
    Reader                                 // Embed Reader (pulls in Read)
    Write(p []byte) (int, error)           // Add another method
}

// === Satisfying interfaces (implicit!) ===
type MyReader struct{}                      // A struct

func (r *MyReader) Read(p []byte) (int, error) { // Has Read method
    return 0, nil                                  // MyReader satisfies Reader
}

// === Compile-time check ===
var _ Reader = (*MyReader)(nil)             // Verify at compile time

// === The empty interface ===
var x any                                  // Can hold anything
x = 42                                    // Store an int
x = "hello"                               // Store a string

// === Type assertions ===
s, ok := x.(string)                        // Safe assertion — check ok!
if ok {
    fmt.Println(s)                         // Use the string
}

// === Type switches ===
switch v := x.(type) {                     // Switch on concrete type
case string:                               // v is string in this branch
    fmt.Println("string:", v)
case int:                                  // v is int in this branch
    fmt.Println("int:", v)
}

// === Dependency injection ===
type App struct {
    service MyInterface                    // Store an interface, not a concrete type
}
```

::: tip Key Takeaway
Go interfaces are implicit — if a type has the right methods, it satisfies the interface. No `implements` keyword needed. This makes interfaces lightweight and enables easy mocking without frameworks. Define small interfaces (one to three methods), accept interfaces in function parameters, and return concrete types. Use `any` (the empty interface) sparingly. Use the comma-ok pattern for safe type assertions. Add `var _ Interface = (*Struct)(nil)` for compile-time verification.
:::

::: info See Also
- [Structs](./structs) — the types that implement interfaces
- [Functions & Methods](./functions-and-methods) — methods that satisfy interfaces
- [Error Handling](./error-handling) — the `error` interface
- [Testing](./testing) — using interfaces for mocks
- [Pointers](./pointers) — pointer vs value receivers and interfaces
:::
