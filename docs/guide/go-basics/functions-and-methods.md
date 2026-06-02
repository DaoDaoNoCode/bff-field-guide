# Functions & Methods

> **Go Concept:** Functions are first-class values in Go. Methods are just functions with a receiver -- the Go way to attach behavior to structs.

You already know functions. You've written thousands of them in TypeScript -- arrow functions, regular functions, async functions, generator functions. Go simplifies all of this down to one kind of function: `func`. No arrows, no async/await keyword (Go uses goroutines instead), no generators. Just `func`.

The big new concept in this chapter is **methods** -- functions that belong to a type. In TypeScript, you define methods inside a class body. In Go, you define them outside the struct and "attach" them with a special syntax called a **receiver**. It sounds weird, but it's actually quite elegant once you see it.

Let's build up from the simplest possible function to real BFF handler methods.

## Your First Go Function

Let's start with a function that takes no arguments and returns nothing.

In TypeScript:

```ts
function sayHello(): void {
  console.log("Hello!");
}
```

In Go:

```go
func sayHello() {              // "func" keyword, then the function name, then parentheses
                               // No return type listed means it returns nothing (like TypeScript's void)
    fmt.Println("Hello!")      // Print "Hello!" followed by a newline
                               // fmt.Println is Go's console.log
}
```

We defined a function called `sayHello` that prints a message. The `func` keyword replaces TypeScript's `function`. There's no return type after the parentheses, which means the function doesn't return anything (Go doesn't have a `void` keyword -- you just omit the return type).

Now let's add a parameter:

```go
func greet(name string) {     // One parameter: "name" of type "string"
                               // Notice: the type comes AFTER the parameter name
                               // TypeScript: (name: string) -- Go: (name string) -- no colon!
    fmt.Println("Hello, " + name + "!")  // String concatenation with +
}
```

And now let's add a return value:

```go
func greet(name string) string {       // Returns a string
                                        // The return type goes AFTER the parameter list
                                        // TypeScript: function greet(name: string): string
                                        // Go:         func greet(name string) string
    return fmt.Sprintf("Hello, %s!", name)  // Sprintf formats a string (like template literals)
                                             // %s is a placeholder for a string value
                                             // This is like: `Hello, ${name}!` in TypeScript
}
```

We just built up a function from zero args/zero returns to one arg/one return. The key syntax difference from TypeScript: types come after parameter names and after the parameter list (for the return type), with no colons.

Let's compare the full syntax side by side:

```ts
// TypeScript
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

```go
// Go
func greet(name string) string {       // func, name, params, return type, body
    return fmt.Sprintf("Hello, %s!", name)  // fmt.Sprintf for string formatting
}
```

### Grouping parameters of the same type

When consecutive parameters share a type, Go lets you write the type only once:

```go
func add(a int, b int) int {  // Both a and b are int -- written out fully
    return a + b               // Add them and return the result
}
```

You can shorten this. When consecutive parameters share a type, list the names and put the type at the end:

```go
func add(a, b int) int {      // Same thing, but shorter -- a and b are both int
    return a + b               // Go lets you list names, then the shared type
}
```

The second version is just shorthand. When multiple consecutive parameters have the same type, you can list all the names separated by commas and put the type at the end. `a, b int` means "both `a` and `b` are `int`."

<div class="checkpoint">

#### Checkpoint

Go functions use `func name(params) returnType { body }`. Types come after parameter names, not before. No arrow functions, no `function` keyword -- just `func`. Consecutive parameters of the same type can share the type declaration.

</div>

## Multiple Return Values

This is Go's signature feature for functions, and it's the foundation of Go's error handling pattern. We touched on this in the Types chapter -- now let's go deeper.

In TypeScript, a function can only return one value. If you need to return more, you wrap them in an object or tuple:

```ts
// TypeScript -- you need a wrapper
function parsePort(s: string): { port: number; err: Error | null } {
  const n = parseInt(s, 10);
  if (isNaN(n)) {
    return { port: 0, err: new Error(`invalid port: ${s}`) };
  }
  return { port: n, err: null };
}

// Caller must destructure the object
const { port, err } = parsePort("8080");
```

In Go, functions can natively return multiple values -- no wrapper needed:

```go
func parsePort(s string) (int, error) {    // Returns TWO values: an int and an error
                                            // The return types are listed in parentheses
                                            // This is Go's most important pattern

    n, err := strconv.Atoi(s)              // strconv.Atoi also returns (int, error)
                                            // n gets the integer, err gets the error

    if err != nil {                         // Check if the conversion failed
        return 0, fmt.Errorf("invalid port: %s", s)  // Return 0 for the value, and a formatted error
                                                       // fmt.Errorf creates an error with a formatted message
    }

    return n, nil                           // Return the parsed port, and nil (no error)
                                            // nil means "everything worked fine"
}
```

Calling it:

```go
port, err := parsePort("8080")  // Both return values land in separate variables
                                 // port gets the int, err gets the error

if err != nil {                  // ALWAYS check the error before using the value
    log.Fatal(err)               // If there's an error, log it and exit
}

fmt.Println(port)                // 8080 -- safe to use because we checked the error
```

This is the pattern you'll see more than any other in Go. `parsePort` returns two values: the parsed port number and an error. The caller receives both and checks the error before using the port. This `(value, error)` pattern is the backbone of Go error handling -- we'll dedicate the entire next chapter to it.

### Named return values

Go lets you name your return values, which turns them into pre-declared local variables:

```go
func divide(a, b float64) (result float64, err error) {
    // "result" and "err" are already declared as local variables
    // result starts as 0.0 (zero value for float64)
    // err starts as nil (zero value for error)

    if b == 0 {                            // Check for division by zero
        err = errors.New("division by zero")  // Assign to the named return variable
        return                              // "bare return" -- returns result (0.0) and err (the error)
                                            // Go knows to return the named variables
    }

    result = a / b                         // Assign the division result
    return                                 // Returns result (the answer) and err (nil)
}
```

Notice something unusual: there's no value after `return`. By naming the return values `result` and `err`, they become local variables initialized to their zero values. The bare `return` statement (with no values) returns whatever those variables currently hold.

::: warning Use named returns sparingly
Named return values can make short functions clearer, but bare returns in long functions become confusing -- readers have to track what each named variable holds at the return point. In BFF code, you'll mostly see explicit returns like `return result, nil`. Use named returns only for short functions where the names add documentation value.
:::

<div class="checkpoint">

#### Checkpoint

Go functions can natively return multiple values. The `(value, error)` pattern is Go's most important idiom. Named return values are possible but should be used sparingly. Always check errors before using values.

</div>

## Methods on Structs

Here's where Go diverges most from TypeScript. In TypeScript, methods live inside the class:

```ts
class App {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  start(): void {
    console.log(`Server starting on port ${this.port}`);
  }
}
```

In Go, methods are defined **outside** the struct, and they're attached to it with a special syntax called a **receiver**. Let's build this up.

First, the struct:

```go
type App struct {              // Define the App struct -- just data, no methods inside
    port int                   // The port number (lowercase = unexported/private)
}
```

Now, let's attach a method to it:

```go
func (app *App) Start() {     // This is a METHOD on App
                               // (app *App) is the "receiver" -- it's like "this" in TypeScript
                               // The receiver goes BETWEEN "func" and the method name
                               // *App means "pointer to App" (we'll explain pointers fully later)

    fmt.Printf("Server starting on port %d\n", app.port)
    // app.port is like this.port in TypeScript
    // fmt.Printf formats and prints (the \n adds a newline)
    // %d is a placeholder for an integer
}
```

This is where Go diverges from TypeScript. We defined a method called `Start` on the `App` type, but it lives *outside* the struct body. The `(app *App)` before the method name is the **receiver** -- it tells Go "this method belongs to the `App` type." Inside the method, `app` is the variable you use to access the struct's fields, just like `this` in TypeScript.

Let's add another method:

```go
func (app *App) GetPort() int {   // Another method on App
                                   // Returns an int (the port number)
    return app.port                // Access the struct's field through the receiver
                                   // Like: return this.port in TypeScript
}
```

Using the methods:

```go
app := &App{port: 8080}       // Create an App instance (& means "pointer to" -- explained in Pointers chapter)
app.Start()                    // Call the Start method -- prints "Server starting on port 8080"
port := app.GetPort()          // Call GetPort -- returns 8080
```

The key differences from TypeScript's `this`:

| Feature | TypeScript `this` | Go receiver |
|---|---|---|
| Name | Always `this` | You choose (convention: short, like `app` or `a`) |
| Implicit? | Yes (`this` is magical) | No (explicitly declared as a parameter) |
| Binding issues? | Yes (`this` context can be lost) | No (receiver is always explicit) |
| Value or reference? | Always reference | You choose (value or pointer receiver) |

::: tip Receiver naming convention
Go developers use very short receiver names -- often one or two letters. For an `App` struct, you'd use `app` or `a`. For a `Counter`, you'd use `c`. For an `HTTPHandler`, you'd use `h`. Never use `self` or `this` -- that's not idiomatic Go.
:::

<div class="checkpoint">

#### Checkpoint

Methods are functions with a receiver: `func (app *App) MethodName()`. The receiver is like `this` but explicit -- you choose its name and whether it's a value or pointer. Methods are defined outside the struct body.

</div>

## Value vs Pointer Receivers -- The Photocopy Analogy

This is a critical concept. The receiver determines whether the method gets a copy of the struct or a reference to the original.

Think of it this way: imagine you have a document with your information on it.

- **Value receiver** = someone makes a **photocopy** of your document, takes the photocopy to another room, and writes on it. Your original document is unchanged. They modified the copy.
- **Pointer receiver** = someone takes your **actual document** to another room and writes on it. Your original document is now changed.

Let's see this in code:

```go
type Counter struct {          // A simple counter struct
    count int                  // The current count (lowercase = private)
}
```

Now, a method with a **value receiver** (the photocopy):

```go
func (c Counter) Value() int { // VALUE receiver -- (c Counter), no asterisk
                                // c is a COPY of the Counter
                                // Anything we do to c won't affect the original
    return c.count              // Read from the copy -- this is fine
}
```

And a method with a **pointer receiver** (the original document):

```go
func (c *Counter) Increment() {  // POINTER receiver -- (c *Counter), with asterisk
                                   // c is a REFERENCE to the original Counter
                                   // Changes to c WILL affect the original
    c.count++                     // Modify the original counter's count
                                   // This change is visible to the caller
}
```

Let's see the difference in action:

```go
counter := Counter{count: 0}  // Create a Counter starting at 0

counter.Increment()            // Pointer receiver -- modifies the ORIGINAL counter
fmt.Println(counter.Value())   // 1 -- the original was changed!

counter.Increment()            // Increment again
fmt.Println(counter.Value())   // 2 -- still modifying the original
```

Here's the key difference: `Increment` uses a pointer receiver (`*Counter`), so it modifies the original struct. `Value` uses a value receiver (`Counter`), so it works on a copy -- but since it only reads data, that's fine.

Now let's see what would go wrong with a value receiver on `Increment`:

```go
// WRONG -- this doesn't work as expected
func (c Counter) BrokenIncrement() {  // VALUE receiver -- c is a COPY
    c.count++                          // Increments the copy's count
                                       // The original counter is UNCHANGED
}

counter := Counter{count: 0}  // Create a counter
counter.BrokenIncrement()     // This modifies a copy, not the original!
fmt.Println(counter.Value())  // 0 -- still zero! The increment was lost.
```

What just happened? `BrokenIncrement` used a value receiver, so it got a copy of the counter. It incremented the copy's count to 1, but the original counter stayed at 0. The copy was thrown away when the method returned.

An important detail: the copy is made **at the moment of each call**, not once when the struct is created. Every method call with a value receiver takes a fresh snapshot:

```go
counter := Counter{count: 0}  // Original counter, count = 0
counter.count = 5              // Directly change count to 5

counter.Value()                // Go copies counter NOW (count = 5), returns 5 ✅
counter.BrokenIncrement()      // Go copies counter NOW (count = 5), copy becomes 6
                               // ...but the copy is thrown away
counter.Value()                // Go copies counter NOW (still count = 5), returns 5
```

So `Value()` always reflects the current state — it's not frozen from initialization. The problem with `BrokenIncrement()` isn't that it reads stale data, it's that its changes are written to a copy that gets discarded.

::: tip The practical rule for BFF code
**Use pointer receivers (`*App`) for everything in BFF code.** Your BFF's `App` struct holds a logger, configuration, service clients, and other state. You always want methods to access the same shared instance, not a copy. Value receivers are mainly for small, immutable types like coordinates or colors.

In the ODH Dashboard BFF codebase, every handler method uses a pointer receiver:

```go
func (app *App) HealthCheckHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    // app is a pointer -- all handlers share the same App instance
    // with the same logger, config, and service clients
    app.WriteJSON(w, http.StatusOK, map[string]string{"status": "healthy"}, nil)
}
```
:::

<div class="checkpoint">

#### Checkpoint

Value receivers (`c Counter`) get a copy -- they can't modify the original. Pointer receivers (`c *Counter`) get a reference -- they can modify the original. Use pointer receivers for BFF code, where you want all methods to share the same state.

</div>

## Closures

Good news -- closures in Go work almost exactly like closures in JavaScript. A closure is a function that captures variables from its surrounding scope.

In TypeScript:

```ts
function makeCounter(): () => number {
  let count = 0;                 // Variable in the outer scope
  return () => {                 // Return a function that captures 'count'
    count++;                     // The returned function can read AND modify 'count'
    return count;
  };
}

const counter = makeCounter();
console.log(counter());  // 1
console.log(counter());  // 2
```

In Go:

```go
func makeCounter() func() int {    // Returns a function that takes no args and returns an int
                                    // "func() int" is the type of the returned function
    count := 0                     // Variable in the outer scope
    return func() int {            // Return an anonymous function (like an arrow function)
        count++                    // Captures 'count' from the enclosing scope
                                   // The variable is shared, not copied -- changes persist
        return count               // Return the incremented count
    }
}
```

Using it:

```go
counter := makeCounter()           // Create a counter closure
fmt.Println(counter())             // 1 -- count was 0, incremented to 1
fmt.Println(counter())             // 2 -- count was 1, incremented to 2
fmt.Println(counter())             // 3 -- count persists between calls
```

If you've used closures in JavaScript, this should feel familiar. `makeCounter` creates a local variable `count` and returns an anonymous function that captures it. Every time we call `counter()`, it increments and returns the same shared `count` variable. This is identical to how JavaScript closures work.

### Closures in BFF middleware

Closures are used heavily in BFF middleware. A middleware function wraps another handler function, adding behavior before or after:

```go
// RequireAuth is a middleware that checks authentication before calling the next handler.
// It returns a new handler function (a closure) that captures 'app' and 'next'.
func (app *App) RequireAuth(next httprouter.Handle) httprouter.Handle {
    // next is the handler we're wrapping -- the "inner" function
    // httprouter.Handle is a function type for HTTP handlers
    // We return a NEW function that wraps next with auth checking

    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        // This anonymous function is a closure -- it captures 'app' and 'next'
        // 'app' comes from the method receiver (the outer scope)
        // 'next' comes from the parameter (the outer scope)

        identity := app.getIdentity(r)    // Use 'app' (captured from outer scope) to check auth
                                           // getIdentity reads the auth token from the request headers

        if identity == nil {               // If no valid identity was found
            app.unauthorizedResponse(w, r, "authentication required")
            // Send a 401 Unauthorized response and stop
            return                         // Don't call the next handler
        }

        next(w, r, ps)                    // Identity is valid -- call the wrapped handler
                                           // 'next' is captured from the outer scope
    }
}
```

Building on that pattern, `RequireAuth` takes a handler function (`next`) and returns a new handler function. The returned function is a closure that captures both `app` (from the method receiver) and `next` (from the parameter). When a request comes in, the closure checks authentication using `app`, and if it passes, calls `next` to proceed.

This is the same pattern as Express middleware in TypeScript:

```ts
// TypeScript equivalent
function requireAuth(next: Handler): Handler {
  return (req, res) => {
    const identity = getIdentity(req);  // captured from outer scope
    if (!identity) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    next(req, res);  // captured from outer scope
  };
}
```

<div class="checkpoint">

#### Checkpoint

Go closures work just like JavaScript closures -- inner functions capture variables from their enclosing scope. You'll see closures constantly in BFF middleware, where they wrap handlers with authentication, logging, or error handling.

</div>

## Functions as Values

Just like TypeScript, functions in Go are first-class values. You can assign them to variables, pass them as arguments, and store them in data structures.

In TypeScript:

```ts
type Transformer = (s: string) => string;

function apply(s: string, fn: Transformer): string {
  return fn(s);
}

const upper: Transformer = (s) => s.toUpperCase();
console.log(apply("hello", upper));  // "HELLO"
```

In Go:

```go
type Transformer func(string) string   // Define a function type
                                        // A Transformer takes a string and returns a string
                                        // This is like TypeScript's type alias for a function

func apply(s string, fn Transformer) string {  // Accept a function as a parameter
    return fn(s)                                // Call the function with s
}
```

Using it:

```go
upper := func(s string) string {       // Assign an anonymous function to a variable
    return strings.ToUpper(s)          // strings.ToUpper converts to uppercase
}                                      // No arrow syntax -- just func(...) { ... }

result := apply("hello", upper)        // Pass the function as an argument
fmt.Println(result)                    // "HELLO"
```

Same concept, different syntax. We defined a function type `Transformer`, wrote a function `apply` that accepts a `Transformer` as a parameter, created an anonymous function and assigned it to `upper`, and passed `upper` to `apply`. Functions are values, just like strings or numbers.

### The httprouter.Handle type

In BFF code, the most common function type you'll encounter is `httprouter.Handle`:

```go
// This is the type definition from the httprouter library
type Handle func(http.ResponseWriter, *http.Request, Params)
// A Handle is any function that takes:
//   - http.ResponseWriter: where you write the response (like res in Express)
//   - *http.Request: the incoming request (like req in Express)
//   - Params: URL parameters (like req.params in Express)
```

Every handler in the BFF is a function that matches this signature. Middleware functions accept and return this type, creating chains of handlers.

<div class="checkpoint">

#### Checkpoint

Functions are first-class values in Go. You can define function types, pass functions as arguments, and assign anonymous functions to variables. The `httprouter.Handle` function type is the foundation of BFF routing.

</div>

## Variadic Functions -- Rest Parameters

Go has its own version of TypeScript's rest parameters (`...args`):

In TypeScript:

```ts
function sum(...numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0);
}

sum(1, 2, 3);  // 6
```

In Go:

```go
func sum(numbers ...int) int {     // ...int means "zero or more int arguments"
                                    // Inside the function, numbers is a []int (a slice of ints)
    total := 0                     // Start with zero
    for _, n := range numbers {    // Loop over each number
                                   // _ ignores the index, n is the value
        total += n                 // Add each number to the total
    }
    return total                   // Return the sum
}
```

Calling it:

```go
result := sum(1, 2, 3)            // Pass individual arguments -- result is 6
fmt.Println(result)                // 6
```

You can also spread a slice (like JavaScript's spread operator):

```go
nums := []int{1, 2, 3}            // A slice of ints (like an array in TypeScript)
result := sum(nums...)             // The ... after the slice "spreads" it into individual arguments
                                   // Like: sum(...nums) in TypeScript
fmt.Println(result)                // 6
```

The syntax is nearly the same as TypeScript, just rearranged. The `...int` in the parameter list means "accept any number of int arguments." Inside the function, they arrive as a slice (`[]int`). When calling the function, you can pass individual values or spread a slice with `...`.

The most common variadic function you'll use is `fmt.Sprintf`:

```go
msg := fmt.Sprintf("user %s has %d items", username, count)
// fmt.Sprintf takes a format string and any number of values
// %s = string placeholder, %d = integer placeholder
// Like: `user ${username} has ${count} items` in TypeScript
```

<div class="checkpoint">

#### Checkpoint

Variadic functions use `...Type` for rest parameters. Inside the function, the arguments are a slice. Spread a slice into a variadic call with `slice...`. The `fmt.Sprintf` variadic function is Go's template literal.

</div>

## A Real BFF Handler -- Putting It All Together

Let's see all these concepts combined in a real BFF handler method. We'll annotate every line:

```go
// ModelsHandler handles GET requests to list models for a namespace.
// This is a method on *App (pointer receiver) -- it uses the shared app instance.
func (app *App) ModelsHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    // w = the response writer (like Express's res)
    // r = the incoming request (like Express's req)
    // ps = URL parameters (like Express's req.params)

    namespace := ps.ByName("namespace")   // Extract the "namespace" URL parameter
                                           // Like: req.params.namespace in Express

    // Call the service to list models -- returns (value, error)
    models, err := app.modelService.ListModels(r.Context(), namespace)
    // app.modelService is accessed through the pointer receiver
    // r.Context() passes the request context (for cancellation, deadlines, etc.)
    // models gets the list of models, err gets any error

    if err != nil {                       // Check if the service call failed
        app.serverErrorResponse(w, r, err)  // Send a 500 error response
                                             // This is a helper method on *App
        return                             // IMPORTANT: return after handling the error
                                           // Without return, the code below would execute too
    }

    // Write the successful JSON response
    err = app.WriteJSON(w, http.StatusOK, models, nil)
    // WriteJSON is another method on *App
    // http.StatusOK is the constant 200
    // models is the data to serialize as JSON
    // nil means no extra headers

    if err != nil {                       // Check if writing the response failed
        app.serverErrorResponse(w, r, err)  // This can happen if JSON marshaling fails
                                             // or if the connection was closed
    }
}
```

What just happened? This single handler method uses every concept from this chapter:

- **Pointer receiver** (`app *App`) -- all handlers share the same `App` instance
- **Multiple parameters** with Go's type-after-name syntax
- **Multiple return values** from `ListModels` -- `(models, err)`
- **Error checking** with `if err != nil` (covered fully in the next chapter)
- **Method calls** on the receiver -- `app.serverErrorResponse`, `app.WriteJSON`
- **Early return** after error handling -- a critical Go pattern

Compare this to the TypeScript/Express equivalent:

```ts
// Express handler equivalent
async function modelsHandler(req: Request, res: Response) {
  try {
    const namespace = req.params.namespace;
    const models = await modelService.listModels(namespace);
    res.json(models);
  } catch (err) {
    console.error("error listing models:", err);
    res.status(500).json({ error: "internal server error" });
  }
}
```

The Go version is more verbose, but every error path is visible. You can see exactly which operation failed and how each failure is handled. The TypeScript version hides all errors behind a single `catch` block.

## Quick Reference

| TypeScript | Go | Notes |
|---|---|---|
| `function f(x: number): string` | `func f(x int) string` | Type after name, no colon |
| `(x: number) => x * 2` | `func(x int) int { return x * 2 }` | No arrow syntax |
| `class.method()` | `func (r *Type) method()` | Receiver instead of class body |
| `this.field` | `receiver.field` | Explicit receiver name |
| `...args: number[]` | `args ...int` | Variadic / rest params |
| `fn(...array)` | `fn(slice...)` | Spread into variadic call |
| `return { a, b }` | `return a, b` | Native multiple returns |

::: tip Key Takeaway
Go functions are straightforward: `func name(params) returnType`. Methods are functions with a receiver -- use pointer receivers (`*App`) when the method needs to access or modify struct state (which is almost always in BFF code). Multiple return values are native and power the `(value, error)` pattern. Closures work just like JavaScript. There are no arrow functions, no function overloading, and no default parameter values.
:::

::: info Up Next
- [Error Handling](./error-handling) -- the `(value, error)` pattern in depth -- Go's most important chapter
- [Pointers](./pointers) -- why receivers use `*App` instead of `App`
- [Interfaces](./interfaces) -- defining method contracts (like TypeScript interfaces for behavior)
:::
