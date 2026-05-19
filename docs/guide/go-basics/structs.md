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

What just happened? We created a type called `User` that holds two pieces of data: a `Name` and an `Age`. This is Go's version of a TypeScript `interface` or `type`, but with a crucial difference: this isn't just a compile-time shape. It's a real type that exists at runtime, and you can create instances of it.

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

<div class="checkpoint">

#### Checkpoint

A Go `struct` is like a TypeScript `interface` that you can actually create instances of. Fields with capital first letters are public; lowercase first letters are private to the package. No commas or semicolons between fields.

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

What just happened? We created a `User` with `Name` set to `"Alice"` and `Age` set to `30`. The syntax is very similar to TypeScript object literals -- field name, colon, value. The one surprise is that **Go requires a trailing comma** on the last field when you write the struct on multiple lines. If you forget it, you'll get a compile error.

### Method 2: Partial initialization (unset fields get zero values)

```go
user := User{                  // Create a new User
    Name: "Alice",             // Only set the Name field
                               // Age is not mentioned -- it gets its zero value (0)
}

fmt.Println(user.Age)          // 0 -- not undefined, not nil, just 0
                               // Zero values in action! (from the previous chapter)
```

What just happened? We only set `Name`, and Go automatically gave `Age` its zero value of `0`. Remember from the previous chapter: every type has a zero value in Go. This means you can create a struct with only the fields you care about, and everything else gets a safe default.

### Method 3: Zero value instance (all defaults)

```go
var user User                  // Declare a User variable with var (no initial values)
                               // ALL fields get their zero values:
                               // Name = "" (empty string)
                               // Age = 0

fmt.Println(user.Name)         // "" -- empty string, not undefined
fmt.Println(user.Age)          // 0 -- zero, not undefined
```

What just happened? We created a `User` without setting any fields. Every field got its zero value. This is perfectly valid and sometimes useful -- for example, when you want to build up a struct field by field.

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

What just happened? We read and modified struct fields using dot notation, exactly like JavaScript objects. No getters, no setters, no special syntax. If the field is exported (capital letter), any package can access it. If it's unexported (lowercase), only code in the same package can.

<div class="checkpoint">

#### Checkpoint

Access and modify struct fields with dot notation: `user.Name`, `user.Age = 31`. Same as TypeScript objects.

</div>

## Struct Tags -- Critical for BFF Work

This is where structs go from "like TypeScript interfaces" to "actually more powerful for API work." Struct tags are metadata annotations that tell libraries how to handle each field. They're written in backticks after the field type, and they're the reason Go is so good for JSON APIs.

Let's build this up step by step.

### What happens WITHOUT struct tags

First, let's see what Go does by default when you convert a struct to JSON:

```go
type Model struct {            // A struct with no JSON tags
    ID          string         // Field name: ID
    DisplayName string         // Field name: DisplayName
    CreatedAt   string         // Field name: CreatedAt
}
```

If you convert this to JSON (we'll cover how in the JSON chapter), you get:

```json
{
  "ID": "abc-123",
  "DisplayName": "My Model",
  "CreatedAt": "2024-01-15T10:30:00Z"
}
```

The JSON field names match the Go field names exactly -- capital letters and all. That's not great for an API. Most APIs use `snake_case` or `camelCase` for JSON field names, not `PascalCase`.

### What happens WITH struct tags

Now let's add struct tags:

```go
type Model struct {
    ID          string `json:"id"`              // This tag says: "In JSON, call this field 'id'"
                                                 // The backtick string after the type is the struct tag
    DisplayName string `json:"display_name"`     // In JSON, call this "display_name" (snake_case)
    CreatedAt   string `json:"created_at"`       // In JSON, call this "created_at"
}
```

Now the JSON output becomes:

```json
{
  "id": "abc-123",
  "display_name": "My Model",
  "created_at": "2024-01-15T10:30:00Z"
}
```

What just happened? The struct tags told Go's JSON library to use different names when converting to and from JSON. The Go code uses `DisplayName` (PascalCase, Go convention), but the JSON uses `display_name` (snake_case, API convention). The tag bridges the gap.

In TypeScript, you'd need a mapping function or a library like `class-transformer` to do this. In Go, it's built into the struct definition.

### The `omitempty` option

Sometimes you want to leave a field out of the JSON entirely if it has no value. That's what `omitempty` does:

```go
type Model struct {
    ID          string `json:"id"`                       // Always included in JSON
    DisplayName string `json:"display_name"`             // Always included in JSON
    Description string `json:"description,omitempty"`    // Only included if not empty string
                                                          // The comma separates the name from the option
                                                          // "omitempty" means: skip this field if it's a zero value
}
```

Let's see what happens:

```go
model := Model{                // Create a model with no description
    ID:          "abc-123",    // Set the ID
    DisplayName: "My Model",   // Set the display name
                               // Description is not set -- it's "" (zero value for string)
}
```

The JSON output:

```json
{
  "id": "abc-123",
  "display_name": "My Model"
}
```

The `description` field is completely absent from the JSON because its value was `""` (the zero value for strings), and we used `omitempty`. Without `omitempty`, it would appear as `"description": ""`.

### The `json:"-"` option -- hide a field

Sometimes you have a field that should never appear in JSON output. Maybe it's an internal ID, a cached value, or sensitive data:

```go
type Model struct {
    ID          string `json:"id"`             // Appears in JSON as "id"
    DisplayName string `json:"display_name"`   // Appears in JSON as "display_name"
    InternalKey string `json:"-"`              // NEVER appears in JSON output
                                               // The dash means "skip this field completely"
                                               // Useful for internal tracking, secrets, etc.
}
```

With `json:"-"`, the `InternalKey` field is completely invisible to the JSON encoder and decoder. It exists in your Go code, but it's never sent to or read from clients.

### Struct tags -- the complete picture

Here's a summary of the tag options you'll use most:

| Tag | JSON behavior | Example |
|---|---|---|
| `` `json:"name"` `` | Use "name" as the JSON key | `json:"display_name"` |
| `` `json:"name,omitempty"` `` | Use "name", omit if zero value | `json:"description,omitempty"` |
| `` `json:"-"` `` | Never include in JSON | `json:"-"` |
| `` `json:",omitempty"` `` | Use the Go field name, omit if zero | `json:",omitempty"` |

::: tip Comparing to TypeScript
In TypeScript, you'd handle JSON field mapping one of these ways:

```ts
// Option 1: Match the API naming in your type (ugly camelCase/snake_case mix)
interface Model {
  display_name: string;  // snake_case in TS feels wrong
}

// Option 2: Map manually (tedious)
function toApi(model: Model): ApiModel {
  return { display_name: model.displayName };
}

// Option 3: Use a library like class-transformer (dependency)
class Model {
  @Expose({ name: 'display_name' })
  displayName: string;
}
```

Go's struct tags handle this natively with no libraries, no mapping functions, and no compromises on naming conventions.
:::

::: info Why this matters for BFF work
Struct tags are the foundation of every BFF model. When your BFF receives a JSON request, the struct tags tell Go how to parse the incoming JSON fields into Go struct fields. When your BFF sends a JSON response, the tags tell Go how to format the field names. You'll use `json:"field_name"` on virtually every struct field in your BFF code.
:::

<div class="checkpoint">

#### Checkpoint

Struct tags (backtick annotations after the field type) control JSON serialization. `json:"name"` sets the JSON key, `omitempty` skips zero-value fields, and `json:"-"` hides fields entirely. This is one of Go's biggest advantages for API work.

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

What just happened? We defined an `App` struct with two fields. Both are lowercase, which means they're private to this package -- other packages can't directly access `app.logger` or `app.config`. This is Go's version of TypeScript's `private` keyword.

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

What just happened? We wrote a plain function called `NewApp` that takes the same parameters a TypeScript constructor would, creates a struct instance, and returns a pointer to it. The `&` operator takes the address of the struct (we'll cover pointers properly in the Pointers chapter -- for now, just know that `&App{...}` means "create an App and give me a reference to it").

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

What just happened? We created a `User` struct that contains an `Address` struct as one of its fields. Accessing nested fields works with chained dots, exactly like JavaScript objects. The JSON output would look like:

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

With embedding, you can access the nested fields directly:

```go
user := User{                      // Create a User with an embedded Address
    Name: "Alice",                 // Set the name directly on User
    Address: Address{              // Still need to use Address{} to initialize it
        Street: "123 Main St",    // Set the embedded street
        City:   "Portland",       // Set the embedded city
    },
}

// Both of these work:
fmt.Println(user.City)             // "Portland" -- field promoted from Address!
                                   // You can access it as if it were a direct field of User

fmt.Println(user.Address.City)     // "Portland" -- you can also access it through Address explicitly
                                   // Both paths reach the same value
```

What just happened? By writing `Address` without a field name in the `User` struct, we "embedded" it. This promotes all of `Address`'s fields into `User`, so you can access `user.City` directly instead of `user.Address.City`. Both paths work.

::: info When you'll see this in BFF code
Embedding is used sparingly in BFF code. The most common pattern is embedding an error response struct inside an HTTP error struct, so the JSON fields get promoted to the top level. You'll see this pattern in the example at the end of this chapter.
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

What just happened? This struct maps directly to a JSON object from an upstream API. Each field has a `json` tag that defines exactly how it appears in JSON. The `Metadata` field uses `map[string]string` (Go's equivalent of TypeScript's `Record<string, string>`) with `omitempty` so it's excluded from the JSON when there's no metadata.

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
| `@JsonProperty("x")` | `` `json:"x"` `` | Struct tag instead of decorator |
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
