# Structs -- The Go "Class"

> **Go Concept:** Structs are Go's primary way to group related data -- like TypeScript interfaces, but they're concrete values you can instantiate.

If you're coming from TypeScript, you're used to classes with constructors, inheritance hierarchies, and methods defined inside the class body. Go takes all of that, rips it apart, and gives you something simpler: **structs** for data and **methods** attached separately. No `class` keyword, no `constructor`, no `extends`, no `implements` (well, sort of -- we'll get to interfaces later).

This sounds like a step backward. It isn't. Once you see how structs work, you'll appreciate the simplicity. Let's build up from what you already know.

## Starting from TypeScript

You know how to define the shape of an object in TypeScript. You've done it a thousand times:

```ts
interface User {
  name: string;
  age: number;
}
```

This says: "A `User` is an object with a `name` (string) and an `age` (number)." Simple. Now let's see the Go equivalent.

## Your First Go Struct

Here's the same idea in Go:

```go
type User struct {             // Define a new type called "User"
                               // "type" is the keyword, "User" is the name, "struct" means "data container"
    Name string                // A field called Name, of type string
                               // Capital N means it's exported (public) -- accessible from other packages
    Age  int                   // A field called Age, of type int
                               // Capital A means it's also exported (public)
}                              // No commas between fields, no semicolons
```

We created a type called `User` that holds two pieces of data: a `Name` and an `Age`. This is Go's version of a TypeScript `interface` or `type`, but with a crucial difference: this isn't just a compile-time shape. It's a real type that exists at runtime, and you can create instances of it.

Let's compare them side by side:

| Feature | TypeScript `interface` | Go `struct` |
|---|---|---|
| Exists at runtime? | No (erased by compiler) | Yes (concrete type) |
| Can create instances? | No (just describes a shape) | Yes |
| Field order matters? | No | No (when using named fields) |
| Types after names? | Yes (`name: string`) | Yes (`Name string`) |
| Separators? | Semicolons or commas | Nothing (just newlines) |
| Visibility? | No built-in visibility | Capitalized = public, lowercase = private |

That last row is important. In Go, the case of the first letter determines visibility:

```go
type User struct {
    Name  string               // Exported (public) -- other packages CAN access this
                               // Capital "N" makes it visible outside this package

    Email string               // Exported (public) -- other packages CAN access this

    age   int                  // Unexported (private) -- only THIS package can access this
                               // Lowercase "a" hides it from other packages
                               // Like TypeScript's "private" keyword, but enforced by naming convention
}
```

::: warning Capitalization is not a style choice
In Go, whether a name starts with a capital letter determines whether it's accessible from other packages. `Name` is public, `name` is private. This applies to struct fields, functions, types -- everything. It's enforced by the compiler, not just a convention.
:::

You might wonder: what does "private" actually mean here? Can other packages create a `User` with `age` set? Can they read `user.age`? Let's see exactly what happens when another package imports this `User` type:

```go
// In another package that imports the "users" package:

u := users.User{                // ✅ Can create a User (the type name "User" is uppercase = public)
    Name:  "Alice",             // ✅ Can set Name (uppercase = public)
    Email: "alice@example.com", // ✅ Can set Email (uppercase = public)
    age:   30,                  // ❌ COMPILE ERROR: cannot refer to unexported field 'age'
}

fmt.Println(u.Name)             // ✅ Can read Name
fmt.Println(u.age)              // ❌ COMPILE ERROR: u.age undefined (cannot refer to unexported field)
u.age = 25                      // ❌ COMPILE ERROR: same reason
```

The bottom line: **other packages can't set `age` during initialization AND can't read or write `age` afterward.** The field is completely invisible to code outside the package — as if it doesn't exist.

This means if you want outsiders to read `age`, you provide a method:

```go
// Inside the "users" package — same package as User, so 'age' is accessible
func (u User) Age() int {       // Method name "Age" is uppercase = public
    return u.age                // We can access 'age' because we're in the same package
}

// Now other packages can do:
fmt.Println(u.Age())            // ✅ Calls the public method, which reads the private field
```

This is exactly like TypeScript's `private` + getter pattern:

```ts
class User {
  public name: string;
  private age: number;           // Can't be accessed from outside

  get userAge(): number {        // Public getter for the private field
    return this.age;
  }
}
```

The difference: TypeScript's `private` is a compiler hint that disappears at runtime (you can still access `obj['age']` in JavaScript). Go's lowercase visibility is enforced at compile time AND there's no workaround — `age` truly does not exist from outside the package.

::: tip When to use private fields
Private fields show up constantly in BFF code. Here are the most common reasons:

- **Internal state** — the `App` struct has private fields like `config`, `logger`, `k8sClient` that handlers use internally but no outside package should touch or replace
- **Read-only access** — a field is set once at creation (like an `id`) and exposed via a public getter method, preventing anyone from changing it
- **Validation** — instead of letting consumers assign any value, you force them through a `SetAge(n int) error` method that rejects invalid input
- **JSON safety** — unexported fields are automatically excluded from `json.Marshal`, so sensitive data like tokens or internal IDs never leaks into API responses

You'll see the `App` struct pattern in every BFF — all its fields are private:

```go
type App struct {
    config    *config.EnvConfig    // lowercase = only handlers in this package can access
    logger    *slog.Logger         // the App controls its own dependencies
    k8sClient kubernetes.Client    // outside code interacts through public methods, not fields
}
```
:::

<div class="checkpoint">

#### Checkpoint

A Go `struct` is like a TypeScript `interface` that you can actually create instances of. Fields with capital first letters are public; lowercase first letters are private to the package — invisible to outside code for both reading and writing. No commas or semicolons between fields.

</div>

## Creating Instances

OK, we've defined a `User` struct. Now let's actually create one.

In TypeScript, you create an object that matches an interface:

```ts
const user: User = {
  name: "Alice",
  age: 30,
};
```

In Go, there are several ways to create a struct instance. Let's start with the best way and work through the alternatives.

### Method 1: Named fields (use this one)

```go
user := User{                  // Create a new User instance using := (short declaration)
    Name: "Alice",             // Set the Name field to "Alice"
                               // Notice: field name, then colon, then value -- like TypeScript!
    Age:  30,                  // Set the Age field to 30
                               // IMPORTANT: the trailing comma is required on the last field!
}                              // Go requires trailing commas in multi-line struct literals
```

The syntax is very similar to TypeScript object literals -- field name, colon, value. The one surprise is that **Go requires a trailing comma** on the last field when you write the struct on multiple lines. If you forget it, you'll get a compile error.

### Method 2: Partial initialization (unset fields get zero values)

```go
user := User{                  // Create a new User
    Name: "Alice",             // Only set the Name field
                               // Age is not mentioned -- it gets its zero value (0)
}

fmt.Println(user.Age)          // 0 -- not undefined, not nil, just 0
                               // Zero values in action! (from the previous chapter)
```

Notice that we only set `Name`, and Go automatically gave `Age` its zero value of `0`. Remember from the previous chapter: every type has a zero value in Go. This means you can create a struct with only the fields you care about, and everything else gets a safe default.

### Method 3: Zero value instance (all defaults)

```go
var user User                  // Declare a User variable with var (no initial values)
                               // ALL fields get their zero values:
                               // Name = "" (empty string)
                               // Age = 0

fmt.Println(user.Name)         // "" -- empty string, not undefined
fmt.Println(user.Age)          // 0 -- zero, not undefined
```

Same principle, taken further -- we created a `User` without setting any fields, and every field got its zero value. This is perfectly valid and sometimes useful -- for example, when you want to build up a struct field by field.

### Method 4: Positional initialization (avoid this)

```go
user := User{"Alice", 30}     // Positional -- fields are set by order, not by name
                               // "Alice" goes to Name (first field), 30 goes to Age (second field)
                               // DO NOT use this in production code!
```

::: danger Don't use positional initialization
Positional initialization is fragile and dangerous. If someone adds a new field to the `User` struct between `Name` and `Age`, your code will either break or -- worse -- silently assign values to the wrong fields. Always use named fields.

```go
// If someone adds Email between Name and Age:
type User struct {
    Name  string
    Email string   // New field added here!
    Age   int
}

user := User{"Alice", 30}     // COMPILE ERROR: too few values
                               // Or worse, if they add a string field:
user := User{"Alice", "30", 0}  // Compiles but 30 ends up in Email, not Age!
```

Always use named fields. Always.
:::

<div class="checkpoint">

#### Checkpoint

Create structs with named fields: `User{Name: "Alice", Age: 30}`. Unmentioned fields get zero values. Never use positional initialization. Always include a trailing comma on the last field.

</div>

## Accessing Fields

Good news -- this works exactly like TypeScript. Dot notation.

In TypeScript:

```ts
console.log(user.name);  // "Alice"
user.age = 31;            // Modify the age
```

In Go:

```go
fmt.Println(user.Name)    // "Alice" -- dot notation, same as TypeScript
                          // fmt.Println is like console.log

user.Age = 31             // Modify the Age field directly
                          // No setter methods needed -- just assign to the field

fmt.Println(user.Age)     // 31 -- the field was modified
```

No surprises here -- dot notation works exactly like JavaScript objects. No getters, no setters, no special syntax. If the field is exported (capital letter), any package can access it. If it's unexported (lowercase), only code in the same package can.

<div class="checkpoint">

#### Checkpoint

Access and modify struct fields with dot notation: `user.Name`, `user.Age = 31`. Same as TypeScript objects.

</div>

## Struct Tags -- A Quick Preview

You'll notice backtick annotations after field types in most Go structs. These are called **struct tags**, and they control how the field behaves in JSON:

```go
type Model struct {
    ID          string `json:"id"`              // In JSON, this field becomes "id" (lowercase)
                                                 // Without the tag, it would be "ID" (matching Go's name)
    DisplayName string `json:"display_name"`     // In JSON, becomes "display_name" (snake_case)
    CreatedAt   string `json:"created_at"`       // In JSON, becomes "created_at"
}
```

Without tags, Go uses the field name as-is for JSON keys — which means `PascalCase` in your API responses. Tags let you bridge Go's naming convention (PascalCase) with your API's convention (usually `snake_case` or `camelCase`).

This is just a preview. Struct tags are so important for BFF work that they get [their own dedicated chapter](./json) covering `omitempty`, `json:"-"`, pointer fields for optional values, and the complete handler pattern. For now, just know that the backtick part after the type controls JSON serialization.

<div class="checkpoint">

#### Checkpoint

Struct tags (backtick annotations after the field type) control JSON field naming. You'll see them on virtually every struct in BFF code. We'll cover them in depth in [the JSON chapter](./json).

</div>

## The `NewXxx` Factory Pattern -- Why Go Doesn't Have Constructors

In TypeScript, you create objects with constructors:

```ts
class App {
  private logger: Logger;
  private config: Config;

  constructor(logger: Logger, config: Config) {
    this.logger = logger;
    this.config = config;
  }
}

const app = new App(logger, config);
```

Go has no `class`, no `constructor`, and no `new ClassName()`. Instead, you write a regular function that creates and returns a struct. By convention, this function is named `NewXxx` (where `Xxx` is the type name):

Let's build this up. First, the struct:

```go
type App struct {              // Define the App struct -- holds the BFF's dependencies
    logger *slog.Logger        // A pointer to a structured logger (lowercase = unexported/private)
    config *EnvConfig          // A pointer to the configuration (lowercase = unexported/private)
}
```

Both fields are lowercase -- the same visibility rule from earlier. They're private to this package, so other packages can't directly access `app.logger` or `app.config`.

Now, the factory function:

```go
// NewApp creates a fully configured App instance.
// This is Go's "constructor" -- a plain function that returns a struct.
func NewApp(logger *slog.Logger, config *EnvConfig) *App {
    // logger and config are parameters, just like a TypeScript constructor
    // *slog.Logger means "a pointer to a slog.Logger" (more on pointers later)

    return &App{               // Create a new App and return a pointer to it
                               // The & means "give me the memory address of this struct"
        logger: logger,        // Set the logger field to the passed-in logger
        config: config,        // Set the config field to the passed-in config
    }
}
```

And you use it like this:

```go
app := NewApp(logger, config)  // Call the factory function
                               // app is now a fully configured *App (pointer to App)
                               // This is like: const app = new App(logger, config) in TypeScript
```

The key insight: `NewApp` is just a plain function. It takes the same parameters a TypeScript constructor would, creates a struct instance, and returns a pointer to it. The `&` operator takes the address of the struct (we'll cover pointers properly in the Pointers chapter -- for now, just know that `&App{...}` means "create an App and give me a reference to it").

The `NewXxx` naming convention is so universal in Go that you should always follow it. When you see `NewHTTPClient`, `NewRouter`, or `NewEnvConfig`, you immediately know it's a factory function that creates and returns a new instance.

::: tip Why not just create the struct directly?
You can! `app := &App{logger: logger, config: config}` works fine. The `NewXxx` function adds value when there's validation, default values, or setup logic that should happen at creation time. It also provides a clean public API -- users don't need to know the struct's internal fields.
:::

<div class="checkpoint">

#### Checkpoint

Go has no constructors. Use the `NewXxx` naming convention for factory functions that create struct instances. `NewApp(logger, config)` is Go's equivalent of `new App(logger, config)`.

</div>

## Nested Structs

Structs can contain other structs, just like TypeScript types can contain nested objects. Let's build up a realistic BFF model step by step.

First, a simple address struct:

```go
type Address struct {          // A standalone struct for postal addresses
    Street string `json:"street"`   // Street name and number
    City   string `json:"city"`     // City name
    State  string `json:"state"`    // State or province
}
```

Now, a user struct that contains an address:

```go
type User struct {
    Name    string  `json:"name"`     // The user's display name
    Email   string  `json:"email"`    // The user's email address
    Address Address `json:"address"`  // A nested struct -- the user's postal address
                                       // The type is "Address" (the struct we defined above)
}
```

Creating an instance with nested structs:

```go
user := User{                          // Create a User with a nested Address
    Name:  "Alice",                    // Set the user's name
    Email: "alice@example.com",        // Set the email
    Address: Address{                  // Create the nested Address inline
        Street: "123 Main St",        // Set the street
        City:   "Portland",           // Set the city
        State:  "OR",                 // Set the state
    },                                 // Trailing comma required
}
```

Accessing nested fields uses chained dot notation -- same as TypeScript:

```go
fmt.Println(user.Name)             // "Alice" -- direct field access
fmt.Println(user.Address.City)     // "Portland" -- nested field access
                                   // Just like user.address.city in TypeScript
```

If you've nested objects in TypeScript, this is identical. The `User` struct contains an `Address` struct as one of its fields, and accessing nested fields works with chained dots. The JSON output would look like:

```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "address": {
    "street": "123 Main St",
    "city": "Portland",
    "state": "OR"
  }
}
```

### Embedded structs (struct "inheritance")

Go has a feature called **embedding** that lets you include one struct's fields directly in another. It's the closest Go gets to inheritance:

```go
type Address struct {
    Street string `json:"street"`  // Street name
    City   string `json:"city"`    // City name
}

type User struct {
    Name    string `json:"name"`   // The user's name
    Address                        // Embedded! Notice: no field name, just the type
                                   // This "promotes" all of Address's fields into User
}
```

Let's be upfront: embedding has **inconsistent behavior** across different contexts, and it will feel confusing at first. Here's the full picture in one table so you can see the pattern:

| Context | How it works | Example |
|---|---|---|
| **Defining the struct** | Write just the type name, no field name | `Address` (not `Address Address`) |
| **Initializing** | Must use the wrapper — fields are NOT flattened | `Address: Address{Street: "123 Main St"}` |
| **Reading fields** | Fields ARE flattened — access directly | `user.City` (shortcut for `user.Address.City`) |
| **JSON output** | Fields ARE flattened — no wrapper key | `{"name":"Alice","street":"123 Main St","city":"Portland"}` |

Yeah, it's inconsistent. Initialization uses the wrapper, but reading and JSON don't. That's just how Go works. Let's see each one:

**Initialization — you must use the `Address{}` wrapper:**

```go
user := User{                      // Create a User with an embedded Address
    Name: "Alice",                 // Set the name directly on User
    Address: Address{              // You MUST use Address{} here -- can't flatten it
        Street: "123 Main St",    // Set the embedded street
        City:   "Portland",       // Set the embedded city
    },
}

// ❌ This does NOT compile -- you can't skip the wrapper:
// user := User{
//     Name:   "Alice",
//     Street: "123 Main St",     // COMPILE ERROR: unknown field 'Street' in User
//     City:   "Portland",        // COMPILE ERROR: unknown field 'City' in User
// }
```

**Reading fields — flattened, both paths work:**

```go
fmt.Println(user.City)             // "Portland" -- shortcut! Access directly
fmt.Println(user.Address.City)     // "Portland" -- explicit path also works
```

**JSON output — flattened, no `"address"` wrapper:**

```go
data, _ := json.Marshal(user)     // Convert to JSON
fmt.Println(string(data))
// Output: {"name":"Alice","street":"123 Main St","city":"Portland"}
//
// The fields are flattened -- no "address" key wrapping them.
// Compare to a NAMED field (Address Address `json:"address"`),
// which WOULD produce nested JSON:
// {"name":"Alice","address":{"street":"123 Main St","city":"Portland"}}
```

The mental model: embedding makes the inner struct's fields **feel like** they belong to the outer struct — for reading and serialization. But Go still knows `Address` is a separate struct internally, which is why initialization requires the wrapper.

::: info When you'll see this in BFF code
Embedding is used sparingly in BFF code. The most common pattern is embedding an error response struct inside an HTTP error struct, so the error fields get promoted to the top level in the JSON response. You'll see this pattern in the example at the end of this chapter.
:::

<div class="checkpoint">

#### Checkpoint

Structs can contain other structs (nesting) or embed them (field promotion). Nested fields use chained dot notation. Embedded fields can be accessed directly on the parent struct.

</div>

## A Complete BFF Model Example

Let's put everything together with a real-world example. We'll build the request and response models for a BFF API endpoint, step by step.

### The error response models

Every BFF needs a standard way to send error responses. Here's how the ODH Dashboard BFF does it:

```go
package models                     // This file belongs to the "models" package
                                   // Models are the data structures (DTOs) for the API

// ErrorResponse holds the error details sent back to clients.
// This will be the JSON body when something goes wrong.
type ErrorResponse struct {
    Code    string `json:"code"`    // A machine-readable error code, like "bad_request"
                                    // Clients can switch on this to determine the error type
    Message string `json:"message"` // A human-readable error message
                                    // "name is required", "model not found", etc.
}
```

Now, a wrapper that adds the HTTP status code (but hides it from JSON):

```go
// HTTPError wraps ErrorResponse with an HTTP status code.
// The status code is used for the HTTP response, not included in the JSON body.
type HTTPError struct {
    StatusCode int `json:"-"`      // The HTTP status code (400, 404, 500, etc.)
                                   // json:"-" means this field NEVER appears in JSON output
                                   // It's only used internally to set the HTTP response code
    ErrorResponse                  // Embedded! All ErrorResponse fields are promoted
                                   // This means the JSON output has "code" and "message" at the top level
                                   // Not nested inside an "error_response" object
}
```

What just happened? We used embedding (`ErrorResponse` without a field name) so that when `HTTPError` is serialized to JSON, you get:

```json
{
  "code": "bad_request",
  "message": "name is required"
}
```

Not:

```json
{
  "error_response": {
    "code": "bad_request",
    "message": "name is required"
  }
}
```

The `StatusCode` field has `json:"-"`, so it never appears in the JSON. It's only used in the Go code to set the HTTP response status.

### An API resource model

Now let's build a model for an actual API resource -- a model from the LlamaStack API:

```go
// LlamaStackModel represents a model from the LlamaStack API.
// This struct is used both for receiving data from the upstream API
// and for sending data back to the frontend client.
type LlamaStackModel struct {
    Identifier string            `json:"identifier"`            // The model's unique identifier
                                                                 // Like "meta-llama/Llama-3.1-8B"

    ProviderID string            `json:"provider_id"`            // Which provider hosts this model
                                                                 // Like "remote::ollama"

    Type       string            `json:"type"`                   // The model type
                                                                 // "llm", "embedding", etc.

    Metadata   map[string]string `json:"metadata,omitempty"`     // Optional key-value metadata
                                                                 // map[string]string is like Record<string, string> in TS
                                                                 // omitempty: if the map is nil or empty, skip it in JSON
}
```

Here's where it gets practical. This struct maps directly to a JSON object from an upstream API. Each field has a `json` tag that defines exactly how it appears in JSON. The `Metadata` field uses `map[string]string` (Go's equivalent of TypeScript's `Record<string, string>`) with `omitempty` so it's excluded from the JSON when there's no metadata.

### An error envelope

BFF APIs typically wrap errors in an envelope:

```go
// ErrorEnvelope is the standard wrapper for all error responses.
// Every error response from the BFF follows this shape:
// { "error": { "code": "...", "message": "..." } }
type ErrorEnvelope struct {
    Error *HTTPError `json:"error"`   // A pointer to the HTTPError
                                       // The * means this can be nil (no error)
                                       // When serialized, the JSON has an "error" key at the top level
}
```

Now all error responses have a consistent shape that the frontend can rely on:

```json
{
  "error": {
    "code": "not_found",
    "message": "model not found"
  }
}
```

::: info The TypeScript equivalent
Here's what these models would look like in TypeScript, for comparison:

```ts
interface ErrorResponse {
  code: string;
  message: string;
}

interface HTTPError extends ErrorResponse {
  // statusCode is not in the JSON -- you'd handle it separately
}

interface ErrorEnvelope {
  error: HTTPError;
}

interface LlamaStackModel {
  identifier: string;
  provider_id: string;
  type: string;
  metadata?: Record<string, string>;
}
```

Notice how Go's struct tags handle the field renaming (`provider_id`), the field hiding (`StatusCode` with `json:"-"`), and the optional fields (`omitempty`) that would require separate logic in TypeScript.
:::

<div class="checkpoint">

#### Checkpoint

You've seen a complete set of BFF models using struct tags for JSON mapping, embedding for field promotion, `json:"-"` to hide internal fields, and `omitempty` for optional data. These patterns appear in every BFF service in the ODH Dashboard codebase.

</div>

## Try It Yourself

Create a file called `models.go` and define the following structs:

1. A `HealthResponse` struct with a `Status` field (string, JSON: `"status"`) and a `Timestamp` field (int64, JSON: `"timestamp"`).
2. A `ModelListResponse` struct with a `Models` field (slice of `LlamaStackModel`, JSON: `"models"`) and a `Total` field (int, JSON: `"total"`).
3. Use `omitempty` on any field that might be empty.

Don't worry about making it compile yet -- just practice the syntax. We'll cover running Go programs in the next section.

## Quick Reference

| TypeScript | Go | Notes |
|---|---|---|
| `interface User { ... }` | `type User struct { ... }` | Struct is a concrete type, not just a shape |
| `new App(...)` | `NewApp(...)` | Factory function, not a constructor |
| `user.name` | `user.Name` | Dot notation (same!) |
| `private field` | `field` (lowercase) | Lowercase first letter = unexported |
| `public field` | `Field` (uppercase) | Uppercase first letter = exported |
| No built-in equivalent | `` `json:"x"` `` | Struct tag controls JSON field name (TS uses the field name directly) |
| `extends Base` | `Base` (embedded) | Embedding promotes fields, not true inheritance |

::: tip Key Takeaway
Structs are Go's replacement for classes -- they hold data, and you attach behavior through methods (covered in [Functions & Methods](./functions-and-methods)). There's no inheritance; use embedding for field promotion. Struct tags (the backtick annotations) are essential for JSON serialization in BFF code. Use the `NewXxx` factory function pattern instead of constructors.
:::

::: info Up Next
- [Functions & Methods](./functions-and-methods) -- attaching methods to structs
- [JSON](./json) -- struct tags for JSON serialization and deserialization in depth
- [Pointers](./pointers) -- why factory functions return `*App` (a pointer to App)
- [Interfaces](./interfaces) -- defining behavior contracts for structs
:::
