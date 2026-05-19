# Types & Variables

> **Go Concept:** Variables, constants, type inference, and zero values -- the foundation of every Go program.

You write TypeScript every day. You know `let`, `const`, type annotations, and the constant companion of `undefined`. Go has equivalents for all of these, but with differences that will genuinely surprise you -- some delightful, some maddening, and all of them deliberate. Let's walk through everything from scratch, building up one concept at a time.

## Your First Go Variable

Let's start with the absolute simplest thing you can do -- create a variable that holds a number.

In TypeScript, you'd write:

```ts
let x = 5;  // TypeScript infers this as type 'number'
```

In Go, the equivalent is:

```go
x := 5  // Go infers this as type 'int'
        // The := operator declares x AND assigns 5 to it in one step
```

What just happened? We created a variable called `x` that holds the integer `5`. The `:=` operator is Go's shorthand for "create a new variable and figure out its type from what I'm assigning to it." You'll use `:=` constantly -- it's by far the most common way to declare variables in Go.

Notice two things right away: no semicolons at the end of the line (Go doesn't use them), and no `let` or `const` keyword. The `:=` does all the work.

Let's try a few more:

```go
name := "Alice"   // Go infers this as type 'string'
                   // Double quotes only -- single quotes mean something different in Go

age := 30          // Go infers this as type 'int'
                   // Not 'number' like TypeScript -- Go distinguishes integers from floats

active := true     // Go infers this as type 'bool'
                   // Same concept as TypeScript's boolean
```

What just happened? We created three variables. Go looked at each value on the right side of `:=` and figured out the type automatically. `"Alice"` is a string, `30` is an integer, and `true` is a boolean. This is called **type inference**, and it works almost exactly like TypeScript's `let x = 5` inference -- except Go has more specific numeric types (we'll get to that).

<div class="checkpoint">

#### Checkpoint

You now know that `:=` declares a variable and infers its type. It's Go's equivalent of TypeScript's `let x = 5`. You'll use it in 90% of your code.

</div>

## `:=` vs `var` -- Two Ways to Declare

OK, so `:=` is the shortcut. But Go also has a `var` keyword. Why two ways?

In TypeScript, you might write:

```ts
let count: number;         // Declare with explicit type, value is undefined
let message: string = "hi"; // Declare with explicit type AND a value
```

In Go, the `var` keyword is the equivalent:

```go
var count int              // Declare with explicit type, value is 0 (not undefined!)
                           // We'll talk about why it's 0 instead of undefined soon

var message string = "hi"  // Declare with explicit type AND a value
                           // The type 'string' is written AFTER the variable name
```

What just happened? We declared two variables using `var`. The first one, `count`, gets a type but no explicit value -- Go automatically gives it the value `0` (the "zero value" for integers). The second one, `message`, gets both a type and a value.

So when do you use `var` vs `:=`? Here's the rule:

```go
package main               // Every Go file starts with a package declaration

var globalCount int         // var works here -- at the "package level" (outside any function)
                            // This is like a module-level variable in TypeScript

// globalCount := 0         // THIS WOULD NOT COMPILE!
                            // := can ONLY be used inside a function

func main() {              // The entry point of the program
    localCount := 0         // := works here -- inside a function
                            // This is the preferred way inside functions

    var explicitCount int = 0  // var also works inside functions
                               // But := is shorter, so most Go developers prefer it
}
```

::: warning := is function-only
The `:=` operator can only appear inside a function body. At the package level (outside any function), you must use `var`. If you try to use `:=` outside a function, the Go compiler will reject your code with: `non-declaration statement outside function body`.
:::

Here's a quick decision guide:

| Situation | Use | Example |
|---|---|---|
| Inside a function, with an initial value | `:=` | `name := "Alice"` |
| Inside a function, explicit type needed | `var` | `var count int64 = 0` |
| Outside any function (package level) | `var` | `var maxRetries = 3` |
| Need a specific numeric type | `var` | `var port int16 = 8080` |

::: tip The 90/10 Rule
You'll use `:=` about 90% of the time. Use `var` when you need a variable outside a function or when you want to be explicit about the type (like choosing `int64` instead of letting Go pick `int`).
:::

<div class="checkpoint">

#### Checkpoint

You know both ways to declare variables: `:=` (short, inside functions, type inferred) and `var` (explicit, works everywhere). Use `:=` unless you have a reason not to.

</div>

## Constants with `const`

Go has `const`, and it works similarly to TypeScript's -- but stricter.

In TypeScript:

```ts
const maxRetries = 3;          // Can't reassign, but the value can be anything
const apiPath = "/api/v1";     // Including function return values
const now = Date.now();        // This is fine in TypeScript
```

In Go:

```go
const maxRetries = 3           // Compile-time constant -- the value must be known at compile time
                               // This is fine because 3 is a literal

const apiPath = "/api/v1"      // String literals work too
                               // These are truly immutable -- the compiler bakes them in

// const now = time.Now()      // THIS WOULD NOT COMPILE!
                               // time.Now() is a function call -- its value isn't known at compile time
                               // Go const values must be literals or expressions of literals
```

Go's `const` is stricter than TypeScript's because the value must be computable at compile time. You can't assign a function return value to a `const`. If you need a value that's computed at runtime but shouldn't change, use `var`:

```go
var startTime = time.Now()     // Computed at program startup, but not reassignable by convention
                               // Go trusts you not to reassign it -- there's no 'readonly' keyword
```

You can also group constants together, which is handy for related values:

```go
const (                        // Parentheses group related constants
    defaultPort    = 8080      // These are all compile-time constants
    defaultTimeout = 30        // No commas between them
    defaultLogLevel = "info"   // Each gets its own line
)
```

What just happened? We grouped three related constants into a single `const` block. This is purely for readability -- it's exactly the same as writing three separate `const` statements. You'll see this pattern everywhere in Go code, especially for configuration defaults in BFF services.

::: info Why this matters for BFF work
In the ODH Dashboard BFF codebase, you'll see `const` blocks at the top of files defining default configuration values, API paths, and HTTP header names. These are values that never change at runtime and are baked into the compiled binary.
:::

<div class="checkpoint">

#### Checkpoint

Go's `const` is like TypeScript's, but stricter: values must be known at compile time. Group related constants with `const ( ... )`.

</div>

## Basic Types -- Go vs TypeScript

Here's where things start to diverge from TypeScript in an important way. TypeScript has one numeric type: `number`. Go has many. Let's map them out.

In TypeScript, you'd write:

```ts
const count = 42;        // number (64-bit floating point internally)
const price = 19.99;     // number (same type as count!)
const name = "gopher";   // string
const done = false;       // boolean
```

In Go, the same values look like this:

```go
count := 42              // int -- an integer, NOT a floating-point number
                          // On most systems, int is 64 bits (can hold huge numbers)

price := 19.99            // float64 -- a 64-bit floating-point number
                          // Go sees the decimal point and infers float64

name := "gopher"          // string -- same concept as TypeScript
                          // Always double quotes. Single quotes are for individual characters (runes).

done := false             // bool -- same concept as TypeScript's boolean
```

What just happened? Go looked at `42` and decided it's an `int` (no decimal point = integer). It looked at `19.99` and decided it's a `float64` (decimal point = floating-point). This distinction doesn't exist in TypeScript, where `42` and `19.99` are both `number`.

Here's the full mapping:

| TypeScript | Go | Notes |
|---|---|---|
| `string` | `string` | Same concept. Always use double quotes in Go. |
| `number` | `int` | For whole numbers. Go's default integer type. |
| `number` | `float64` | For decimal numbers. Go's default float type. |
| `boolean` | `bool` | Same concept, shorter name. |
| `undefined` | *(does not exist)* | Go has no undefined. At all. |
| `null` | `nil` | Only for pointers, slices, maps, channels, interfaces, and functions. |

### Why separate int and float?

You might be wondering: "Why does Go bother splitting integers and floats? TypeScript's `number` works fine."

The answer is performance and precision. Integers are exact -- `42` is always `42`, never `41.99999999`. Floating-point numbers have rounding issues (just like JavaScript's `0.1 + 0.2 === 0.30000000000000004`). By separating them, Go makes you think about which one you actually need.

::: info Why this matters for BFF work
In BFF code, you'll use `int` for HTTP status codes, port numbers, counts, and array indices. You'll use `float64` for things like percentages or metrics. You'll use `string` for basically everything that comes from or goes to JSON. Getting the type right matters because Go won't let you mix them without explicit conversion.
:::

### The full numeric type menu

Go gives you fine-grained control over integer sizes. You probably won't need most of these, but you should know they exist:

```go
var tiny int8 = 127            // 8-bit signed: -128 to 127
                               // Rarely used directly

var small int16 = 32767        // 16-bit signed: -32,768 to 32,767
                               // Occasionally useful for compact data

var medium int32 = 2147483647  // 32-bit signed: about +/- 2 billion
                               // Used when you need to match a specific wire format

var big int64 = 9223372036854775807  // 64-bit signed: astronomically large
                                     // Used for timestamps, file sizes, etc.

var auto int = 42              // Platform-dependent: 64-bit on modern systems
                               // This is what := gives you by default -- use this most of the time

var positive uint = 42         // Unsigned integer: 0 to very large
                               // Can't be negative. Used for things that are never negative (like array lengths)
```

What just happened? We declared integers of various sizes. In practice, you'll almost always use plain `int` (which `:=` gives you automatically). The sized variants (`int8`, `int32`, `int64`) show up when you're interfacing with specific APIs or wire formats -- for example, Kubernetes API fields often use `int32` or `int64`.

::: tip The practical rule
Just use `int` unless something specific requires a sized type. Let `:=` infer it for you. If you see `int32` or `int64` in BFF code, it's because the upstream API (like Kubernetes) requires that specific size.
:::

<div class="checkpoint">

#### Checkpoint

Go has separate types for integers (`int`) and floating-point numbers (`float64`), unlike TypeScript's single `number`. Use `int` for whole numbers, `float64` for decimals. The `:=` operator picks the right one automatically based on whether the value has a decimal point.

</div>

## Zero Values -- No More `undefined`

This is one of Go's best features, and it's going to change how you think about uninitialized variables.

In TypeScript, an uninitialized variable is `undefined`:

```ts
let name: string;       // undefined -- accessing this is a runtime footgun
let count: number;       // undefined -- adding 1 to this gives NaN
let active: boolean;     // undefined -- not false, not true, just... undefined

console.log(name);       // undefined
console.log(count + 1);  // NaN -- silent bug!
```

In Go, every variable has a well-defined default value called its **zero value**. There is no `undefined`:

```go
var name string          // "" (empty string) -- not undefined, not null, just empty
                         // You can safely call len(name) and get 0

var count int            // 0 -- not undefined, not NaN, just zero
                         // You can safely do count + 1 and get 1

var price float64        // 0.0 -- a real, usable number
                         // No NaN surprises

var active bool          // false -- not undefined, just false
                         // You can use it in an if statement immediately
```

What just happened? We declared four variables without giving them values. In TypeScript, they'd all be `undefined` and potentially cause runtime errors. In Go, they each got a predictable default: empty string, zero, zero, and false. You can use these variables immediately without any initialization.

Here's the complete zero value table:

| Type | Zero Value | TypeScript equivalent situation |
|---|---|---|
| `string` | `""` (empty string) | `undefined` -- but Go gives you a usable empty string instead |
| `int` | `0` | `undefined` -- but Go gives you a usable zero instead |
| `float64` | `0.0` | `undefined` -- but Go gives you a usable zero instead |
| `bool` | `false` | `undefined` -- but Go gives you a usable false instead |
| pointer | `nil` | `null` / `undefined` |
| slice | `nil` | `undefined` -- but you can still append to a nil slice! |
| map | `nil` | `undefined` -- but reading from a nil map returns zero values |

Let's verify this works exactly as advertised:

```go
package main                   // Package declaration -- every Go file needs one

import "fmt"                   // Import the fmt package for printing
                               // Like: import { console } from 'node:console'

func main() {                  // Program entry point
    var s string               // Declare a string with no value assigned
    var n int                  // Declare an int with no value assigned
    var f float64              // Declare a float64 with no value assigned
    var b bool                 // Declare a bool with no value assigned

    fmt.Println(s == "")       // true -- it's an empty string, ready to use
    fmt.Println(n == 0)        // true -- it's zero, ready to use
    fmt.Println(f == 0.0)      // true -- it's zero, ready to use
    fmt.Println(b == false)    // true -- it's false, ready to use

    fmt.Println(n + 1)         // 1 -- no NaN, no undefined errors, just math
    fmt.Println(s + "hello")   // "hello" -- string concatenation works fine
}
```

What just happened? We declared four variables without values and used them immediately. Every single operation worked correctly because Go guaranteed us a usable default value. No `undefined` checks, no null guards, no NaN surprises.

::: info Why this matters for BFF work
Zero values are a game-changer for BFF code. When you decode a JSON request body into a Go struct, any fields missing from the JSON get their zero values instead of `undefined`. This means you can check `if input.Name == ""` instead of `if input.Name === undefined || input.Name === null || input.Name === ""`. Much simpler.
:::

::: warning The flip side
Zero values can be a gotcha too. If someone sends `{"count": 0}` in a JSON body, you can't tell whether they explicitly sent `0` or whether the field was missing. Both look like `0` to your Go code. We'll cover how to handle this with pointers in the [Pointers chapter](./pointers).
:::

<div class="checkpoint">

#### Checkpoint

Every Go variable has a zero value -- no `undefined` exists. Strings default to `""`, numbers to `0`, booleans to `false`. This eliminates an entire class of bugs, but means you can't distinguish "missing" from "zero" without extra effort.

</div>

## Type Conversions -- Explicit Only

If you come from JavaScript, you've been burned by type coercion at least once. The classic example:

```ts
// JavaScript's "helpful" type coercion
console.log("5" + 3);      // "53" -- string concatenation, not addition!
console.log("5" - 3);      // 2 -- now it's subtraction?!
console.log(true + 1);     // 2 -- true becomes 1 somehow
console.log("" == false);  // true -- ...what?
```

Go's response to all of this is simple: **no implicit conversions, ever.** If you want to convert between types, you write the conversion explicitly. If you don't, the compiler refuses to compile your code.

Let's start with the simplest conversion -- between numeric types:

```go
count := 42                // count is an int
price := float64(count)    // Explicitly convert int to float64
                           // You MUST write float64(...) -- Go won't do it for you

fmt.Println(price)         // 42 (as a float64 now)
```

What just happened? We had an `int` and needed a `float64`. In JavaScript, this would happen silently. In Go, we wrote `float64(count)` to make the conversion explicit. If we tried to use `count` where a `float64` was expected without converting it, the compiler would stop us.

Now let's try the reverse -- converting a float to an integer:

```go
pi := 3.14159              // pi is a float64
whole := int(pi)           // Explicitly convert float64 to int
                           // This TRUNCATES -- it chops off the decimal, it doesn't round

fmt.Println(whole)         // 3 -- not 3.14159, not 3.0, just 3
                           // The .14159 is gone forever. No warning, no rounding.
```

What just happened? We converted `3.14159` to an `int` and got `3`. Go truncates (cuts off the decimal part) rather than rounding. This is important to know -- `int(3.99)` gives you `3`, not `4`.

### String conversions -- the `strconv` package

Converting between strings and numbers requires a special package called `strconv`. This is different from what you might expect:

```go
import "strconv"           // Import the string conversion package
                           // This handles converting strings to numbers and back

// Number to string
s := strconv.Itoa(42)      // "42" -- Itoa means "Integer to ASCII"
                           // Itoa is a weird name, but you'll memorize it fast

// String to number
n, err := strconv.Atoi("42")  // n = 42, err = nil
                               // Atoi means "ASCII to Integer"
                               // It returns TWO values: the number AND an error
                               // The error is nil if the conversion succeeded

// What if the string isn't a valid number?
bad, err := strconv.Atoi("hello")  // bad = 0, err = an error value
                                    // "hello" can't be converted to a number
                                    // Go doesn't give you NaN -- it gives you an error
```

What just happened? We used `strconv.Itoa` to turn an integer into a string, and `strconv.Atoi` to turn a string into an integer. Notice that `Atoi` returns two values -- the number and an error. If the string isn't a valid number, you get an error instead of a silent `NaN`. This is a preview of Go's error handling pattern, which we'll cover extensively in [Error Handling](./error-handling).

::: danger A common trap
`string(65)` in Go does **NOT** give you `"65"`. It gives you `"A"` -- the character with Unicode code point 65. This trips up every TypeScript developer at least once.

```go
wrong := string(65)            // "A" -- this converts a code point to a character!
                               // NOT what you want if you're trying to get "65"

right := strconv.Itoa(65)      // "65" -- this converts a number to its string representation
                               // Always use strconv.Itoa for number-to-string conversion
```

Always use `strconv.Itoa()` to convert numbers to their string representation.
:::

### You can't mix types in operations

This one catches TypeScript developers off guard. In Go, you can't even add an `int` to a `float64` without converting first:

```go
count := 42                // int
rate := 1.5                // float64

// result := count * rate  // THIS WOULD NOT COMPILE!
                           // Go refuses to multiply an int by a float64

result := float64(count) * rate  // This works -- we explicitly convert count to float64 first
                                  // result is 63.0 (a float64)
```

What just happened? Go refused to multiply an `int` and a `float64` together. You have to convert one of them first. This might feel annoying coming from TypeScript, but it prevents an entire category of bugs where implicit type conversion produces unexpected results.

::: info Why this matters for BFF work
When working with Kubernetes API responses, you'll often get numeric values as `int32` or `int64` (because that's what the Kubernetes Go client uses). If your function expects a plain `int`, you'll need to convert explicitly: `int(pod.Spec.Containers[0].Ports[0].ContainerPort)`. The compiler will tell you exactly where conversions are needed.
:::

<div class="checkpoint">

#### Checkpoint

Go never converts types implicitly. Use `Type(value)` for numeric conversions and the `strconv` package for string/number conversions. `string(65)` gives you `"A"`, not `"65"` -- use `strconv.Itoa(65)` instead.

</div>

## Multiple Return Values

This is one of Go's superpowers, and you'll use it constantly in BFF code. Functions in Go can return more than one value. TypeScript can't do this natively -- you'd use an object or a tuple type.

Let's build up to the pattern step by step.

In TypeScript, if you want a function to return both a value and a possible error, you'd do something like this:

```ts
// TypeScript -- return an object with both pieces
function divide(a: number, b: number): { result: number; error: Error | null } {
  if (b === 0) {
    return { result: 0, error: new Error("division by zero") };
  }
  return { result: a / b, error: null };
}

const { result, error } = divide(10, 3);
if (error) {
  console.error(error);
}
```

In Go, you don't need the object wrapper. The function just returns two values:

```go
func divide(a, b float64) (float64, error) {  // Returns two values: a float64 and an error
                                                // The return types are listed in parentheses
    if b == 0 {                                // Check for division by zero
        return 0, errors.New("division by zero")  // Return 0 for the value, and an error
                                                   // errors.New creates a simple error with a message
    }
    return a / b, nil                          // Return the result, and nil for "no error"
                                               // nil means "nothing went wrong"
}
```

And you call it like this:

```go
result, err := divide(10, 3)   // Both return values land in separate variables
                                // result gets the float64, err gets the error

if err != nil {                 // Check if the error is not nil (not null)
    log.Fatal(err)              // If there's an error, log it and exit
                                // log.Fatal prints the error and calls os.Exit(1)
}

fmt.Println(result)             // 3.3333333333333335 -- we only reach here if no error
```

What just happened? We called `divide` and got back two separate values -- the result and an error. We checked if the error was `nil` (Go's equivalent of `null`), and only used the result if there was no error. This `(value, error)` pattern is the most important pattern in all of Go programming. You'll see it everywhere, and we'll explore it deeply in [Error Handling](./error-handling).

::: tip The (value, error) convention
By convention, the error is always the **last** return value. When a function succeeds, it returns the value and `nil` for the error. When it fails, it returns a zero value and a non-nil error. Every Go developer knows this pattern.
:::

<div class="checkpoint">

#### Checkpoint

Go functions can return multiple values natively. The `(value, error)` return pattern is Go's most important idiom -- functions return their result AND an error, and callers check the error before using the result.

</div>

## The Blank Identifier `_`

Sometimes you call a function that returns multiple values, but you don't need all of them. In TypeScript, you might just ignore a destructured value. In Go, there's a catch: **you must use every declared variable.** If you declare a variable and never use it, the compiler rejects your code.

Here's the problem:

```go
result, err := divide(10, 3)   // Declare both result and err
fmt.Println(result)             // Use result...
                                // But we never use err!
                                // COMPILE ERROR: err declared and not used
```

The compiler is telling you: "You declared `err` but never checked it. That's probably a bug." And honestly, it usually is -- ignoring errors is a common source of bugs.

But sometimes you genuinely don't need a return value. That's where the blank identifier `_` comes in:

```go
result, _ := divide(10, 3)    // The _ tells Go: "I know I'm ignoring this value"
                               // The compiler accepts this -- you're being explicit about it

fmt.Println(result)            // Use result normally
```

What just happened? The `_` (underscore) is a special identifier in Go that means "discard this value." It tells the compiler, "I intentionally don't need this return value." The compiler accepts it because you're being deliberate rather than accidentally forgetting.

Here's another common use -- ignoring the index in a loop:

```go
items := []string{"a", "b", "c"}  // A slice (like a JS array) of strings

// In TypeScript: items.forEach((item, index) => { ... })
// But what if you don't need the index?

for _, item := range items {       // range gives you (index, value) for each element
                                    // We use _ to ignore the index
    fmt.Println(item)              // Just print the item
}
```

And explicitly discarding a function's return value entirely:

```go
_ = someFunction()                 // Call the function, explicitly discard its return value
                                   // This is like calling a void function, but the function
                                   // actually returns something -- you're saying "I don't need it"
```

::: warning Don't silence errors
While `result, _ := divide(10, 0)` compiles, it's almost always a bad idea to discard errors. The `_` should be used for values you genuinely don't need (like a loop index), not for errors you're too lazy to handle.

```go
// BAD -- silencing an error
data, _ := os.ReadFile("config.yaml")  // If the file doesn't exist, data is empty
                                        // and you'll get mysterious bugs downstream

// GOOD -- handling the error
data, err := os.ReadFile("config.yaml")  // Get both values
if err != nil {                          // Check the error
    return fmt.Errorf("reading config: %w", err)  // Handle it properly
}
```
:::

<div class="checkpoint">

#### Checkpoint

Go requires every declared variable to be used. The blank identifier `_` lets you explicitly discard values you don't need. Use it for unwanted loop indices and unused return values -- but never use it to silence errors.

</div>

## Putting It Together -- A BFF Configuration Example

Let's see all of these concepts working together in a real snippet from an ODH Dashboard BFF service. We'll build it up piece by piece.

First, the constants -- default values for the server configuration:

```go
package config                 // This file belongs to the "config" package
                               // Other files can import it as: import "myapp/internal/config"

const (                        // Group related constants together
    defaultPort      = 8080    // Default HTTP port for the BFF server
    defaultLogLevel  = "info"  // Default log verbosity
    defaultAuthMethod = "internal"  // Default authentication method
)                              // All values are compile-time constants (literals)
```

What just happened? We defined three constants that represent the default configuration for our BFF server. These are compile-time values -- the Go compiler bakes them directly into the binary.

Next, a struct to hold the configuration (we'll cover structs fully in the next chapter, but the idea is simple -- it's like a TypeScript `type`):

```go
// EnvConfig holds all configuration for the BFF server.
// Think of it like a TypeScript type: type EnvConfig = { port: number; logLevel: string; ... }
type EnvConfig struct {
    Port       int             // The port the server listens on (zero value: 0)
    LogLevel   string          // Log verbosity level (zero value: "")
    AuthMethod string          // How to authenticate requests (zero value: "")
}
```

Now, a factory function that creates a configured instance by reading environment variables:

```go
import (                       // Import multiple packages at once using parentheses
    "os"                       // For reading environment variables
    "strconv"                  // For converting strings to numbers
)

// NewEnvConfig creates an EnvConfig with defaults,
// overridden by environment variables when present.
func NewEnvConfig() *EnvConfig {   // Returns a pointer to EnvConfig (more on pointers later)

    port := defaultPort            // Start with the default port (8080)
                                   // := declares port as an int (inferred from defaultPort)

    if envPort, err := strconv.Atoi(os.Getenv("PORT")); err == nil {
        // os.Getenv("PORT") reads the PORT environment variable (returns "" if not set)
        // strconv.Atoi converts the string to an int -- returns (int, error)
        // We declare envPort and err with := inside the if statement
        // err == nil means the conversion succeeded (the string was a valid number)
        port = envPort             // Override the default with the environment variable value
    }
    // If PORT wasn't set or wasn't a valid number, port stays as defaultPort (8080)

    logLevel := defaultLogLevel    // Start with the default log level ("info")

    if envLevel := os.Getenv("LOG_LEVEL"); envLevel != "" {
        // Read LOG_LEVEL env var -- if it's not empty, use it
        // envLevel != "" checks that the variable was actually set
        // Remember: os.Getenv returns "" for unset variables (Go's string zero value)
        logLevel = envLevel        // Override with the environment variable value
    }

    return &EnvConfig{             // Return a pointer to a new EnvConfig struct
        Port:       port,          // Use the port we determined above
        LogLevel:   logLevel,      // Use the log level we determined above
        AuthMethod: defaultAuthMethod,  // Always use the default auth method
    }
}
```

What just happened? This function combines everything we learned:

- **`const`** for compile-time defaults that never change.
- **`:=`** for declaring local variables inside the function.
- **`strconv.Atoi`** for explicit string-to-int conversion (no implicit coercion).
- **Multiple return values** from `strconv.Atoi` -- we get both the number and an error.
- **Zero value awareness** -- `os.Getenv` returns `""` (empty string) for unset variables, and we check for that instead of checking for `undefined`.
- **The blank identifier** is not needed here because we use both return values from `strconv.Atoi` (though we declare them inside the `if` statement's scope).

::: info Why this matters for BFF work
This exact pattern -- reading environment variables with defaults -- appears in every BFF service in the ODH Dashboard codebase. The server port, authentication method, log level, CORS origins, and TLS settings all follow this same flow: start with a constant default, try to read an environment variable, convert it to the right type, and use it if the conversion succeeds.
:::

<div class="checkpoint">

#### Checkpoint

You've seen a complete real-world example combining constants, short declarations, type conversions, multiple return values, and zero value checks. This pattern of reading configuration from environment variables with defaults is foundational to BFF development.

</div>

## Quick Reference

Here's a cheat sheet you can come back to:

| TypeScript | Go | Notes |
|---|---|---|
| `let x = 5` | `x := 5` | Short declaration, type inferred |
| `let x: number = 5` | `var x int = 5` | Explicit type |
| `const X = 5` | `const X = 5` | Must be compile-time constant in Go |
| `undefined` | *(doesn't exist)* | Go variables always have a value |
| `null` | `nil` | Only for pointers, slices, maps, channels, interfaces |
| `Number("42")` | `strconv.Atoi("42")` | Returns `(int, error)` -- no silent NaN |
| `String(42)` | `strconv.Itoa(42)` | `Itoa` = Integer to ASCII |
| `const [a, b] = fn()` | `a, b := fn()` | Multiple return values are native |
| `const [a] = fn()` | `a, _ := fn()` | Discard unwanted values with `_` |

::: tip Key Takeaway
Go variables always have a value (zero values eliminate `undefined`), type conversions are always explicit (no silent coercion), and functions can return multiple values natively (the `value, error` pattern is everywhere). Use `:=` inside functions for concise declarations.
:::

::: info Up Next
- [Structs](./structs) -- defining your own types (Go's replacement for classes and interfaces)
- [Functions & Methods](./functions-and-methods) -- multiple return values, methods, and closures
- [Error Handling](./error-handling) -- the `(value, error)` return pattern in depth
:::
