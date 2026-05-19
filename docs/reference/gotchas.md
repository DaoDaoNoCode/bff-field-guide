# Common Gotchas

Things that **will** trip you up when coming from TypeScript. For each one: the wrong code, what happens, the fix, and why Go works this way.

## 1. Unused Variables Are a Compiler Error

In TypeScript, unused variables get a yellow squiggle warning. In Go, they are a **compiler error** -- your program will not build.

**The wrong code:**

```go
func process() {                   // This function will NOT compile
    name := "alice"                // Declared but never used anywhere
    result := compute()            // 'name' is never read -- Go won't allow it
    fmt.Println(result)            // Only 'result' is used
}
```

**What happens:** The compiler prints `name declared but not used` and refuses to build. Not a warning. An error.

**The fix:**

```go
func process() {                   // Remove the unused variable entirely
    result := compute()            // Only declare what you actually use
    fmt.Println(result)            // Now it compiles
}

// If you need to ignore a return value, use the blank identifier:
value, _ := someFunction()         // _ explicitly discards the second return value
                                   // Only do this with errors when you are SURE it is safe
```

**Why:** Go is opinionated about clean code. The designers believe that unused variables are always a mistake (leftover from refactoring, copy-paste errors). The compiler catches them before they become dead code.

## 2. Unused Imports Are a Compiler Error

Same rule as variables. Import a package you do not use, and the compiler refuses to build.

**The wrong code:**

```go
import (                           // This file will NOT compile
    "fmt"                          // Used -- fmt.Println below
    "strings"                      // NOT used anywhere in this file
)

func greet() {                     // The strings package is never called
    fmt.Println("hello")           // Only fmt is used
}
```

**What happens:** The compiler prints `"strings" imported and not used` and stops.

**The fix:**

```go
import (                           // Remove the unused import
    "fmt"                          // Only import what you actually use
)

func greet() {
    fmt.Println("hello")          // Now it compiles
}
```

**Why:** Same philosophy as unused variables. VS Code with the Go extension removes unused imports automatically on save. If you are editing without an IDE, run `goimports` to clean them up.

## 3. Uppercase = Public, Lowercase = Private

There is no `export` keyword. Visibility is determined entirely by the first letter of the name.

**The wrong code:**

```go
package models                     // In package 'models'

type User struct {                 // User is EXPORTED (uppercase) -- other packages can use it
    Name string                    // Name is EXPORTED -- accessible from anywhere
    age  int                       // age is UNEXPORTED (lowercase) -- only this package
}

func GetUser() User { return User{} }  // GetUser is EXPORTED
func helper() {}                       // helper is UNEXPORTED -- private to this package
```

**What happens:** You try to access `user.age` from another package and get `user.age undefined (cannot refer to unexported field or method age)`. Or you try to call `models.helper()` and get `cannot refer to unexported name models.helper`.

**The fix:** If you need something accessible from other packages, capitalize the first letter. If you intentionally want it private, keep it lowercase and access it only within the same package.

**Why:** Go wanted a visibility system that requires zero keywords and is instantly visible by scanning the code. Uppercase = public, lowercase = private. Simple, but you have to remember it.

## 4. := Only Works Inside Functions

**The wrong code:**

```go
package main                       // Package-level code

name := "alice"                    // WON'T COMPILE -- := can't be used at package level

func main() {                      // Inside a function
    name := "alice"                // This is fine -- := works inside functions
    fmt.Println(name)
}
```

**What happens:** The compiler prints `syntax error: non-declaration statement outside function body`.

**The fix:**

```go
var name = "alice"                 // Use 'var' at package level -- it works everywhere
const maxRetries = 3               // Use 'const' for compile-time constants

func main() {
    name := "bob"                  // := is fine inside functions
    fmt.Println(name)
}
```

**Why:** `:=` is shorthand for "declare and infer the type." At package level, Go requires the explicit `var` keyword for clarity, since package-level variables are initialized before `main()` runs and the order matters.

## 5. nil Slice Is Fine, nil Map Panics on Write

**The wrong code:**

```go
// Slices: nil is safe for reads AND appends
var names []string                 // nil slice -- not initialized
len(names)                         // Returns 0 -- safe
names = append(names, "alice")     // Works! append handles nil slices

// Maps: nil is safe for reads but NOT for writes
var scores map[string]int          // nil map -- not initialized
_ = scores["alice"]                // Returns 0 -- safe (returns zero value for missing keys)
scores["alice"] = 100              // PANIC: assignment to entry in nil map
```

**What happens:** The program compiles fine. Then at runtime, writing to a nil map causes `panic: assignment to entry in nil map`. Your server crashes.

**The fix:**

```go
scores := make(map[string]int)     // Initialize with make() -- now it's safe to write
scores["alice"] = 100              // Works!

// Or use a map literal
scores := map[string]int{          // Initialize with values
    "alice": 100,                  // Pre-populated
}
```

**Why:** Slices have a built-in `append` function that handles nil (it allocates a new backing array). Maps have no such helper -- you must initialize them before writing. This is a deliberate design choice: reading from a nil map returns zero values (safe), but writing requires explicit initialization.

## 6. Maps Are Not Ordered

In modern JavaScript (ES2015+), objects and Maps preserve insertion order. Go maps do **not** -- iterating a map gives a random order every time.

**The wrong code:**

```go
m := map[string]int{               // Create a map with three entries
    "c": 3,                        // Inserted third? Doesn't matter
    "a": 1,                        // Inserted first? Doesn't matter
    "b": 2,                        // Go randomizes iteration order
}

for k, v := range m {              // Iterate over the map
    fmt.Printf("%s: %d\n", k, v)  // Order is RANDOM every time you run this
}
// Could print: a:1, c:3, b:2  or  b:2, a:1, c:3  or any permutation
```

**What happens:** Your tests pass sometimes and fail sometimes because the output order changes between runs. Or your API returns JSON fields in a different order than you expected.

**The fix:**

```go
import "sort"                      // Import the sort package

keys := make([]string, 0, len(m))  // Create a slice to hold the keys
for k := range m {                 // Iterate over the map to collect keys
    keys = append(keys, k)         // Add each key to the slice
}
sort.Strings(keys)                 // Sort the keys alphabetically

for _, k := range keys {           // Iterate in sorted order
    fmt.Printf("%s: %d\n", k, m[k])  // Now guaranteed: a:1, b:2, c:3
}
```

**Why:** Go intentionally randomizes map iteration order to prevent code from accidentally depending on a specific order. If you need order, use a sorted slice of keys.

## 7. Range Gives Copies, Not References

When you `range` over a slice of structs, you get a **copy** of each element, not a reference.

**The wrong code:**

```go
type User struct {                 // A struct with two fields
    Name string
    Age  int
}

users := []User{                   // A slice of User structs
    {Name: "alice", Age: 25},
    {Name: "bob", Age: 30},
}

for _, u := range users {          // u is a COPY of each element
    u.Age += 1                     // Modifies the copy, NOT the original
}
// users[0].Age is still 25! The increment was lost.
```

**What happens:** Your modifications silently disappear. No error, no warning. The original slice is unchanged.

**The fix:**

```go
for i := range users {             // Use the index instead of the value
    users[i].Age += 1              // Modify the original element directly
}
// users[0].Age is now 26 -- it actually changed
```

**Why:** Go passes structs by value (copying all fields). The `range` variable `u` is a fresh copy each iteration. If you want to modify the original, use the index to access the slice element directly.

## 8. defer Runs at Function Exit, Not Block Exit

**The wrong code:**

```go
func process() {                   // This function has a subtle bug
    if true {
        f, _ := os.Open("file.txt")  // Open a file inside an if-block
        defer f.Close()            // f.Close() runs when process() returns
                                   // NOT when the if-block ends!
    }
    // f.Close() has NOT been called here yet
    // ... 100 more lines of code run with the file still open ...
}   // NOW f.Close() finally runs -- when the function returns
```

**What happens:** The file stays open much longer than you intended. If this is in a loop, you could exhaust file descriptors.

**The fix:**

```go
func process() {
    if true {
        processFile("file.txt")    // Extract to a separate function
    }
    // file is already closed here
}

func processFile(name string) {    // Separate function for the file work
    f, _ := os.Open(name)         // Open the file
    defer f.Close()                // defer runs when processFile() returns
    // ... work with f ...
}   // f.Close() runs here -- exactly when you want it
```

**Why:** `defer` is scoped to the enclosing **function**, not the enclosing **block**. This is by design -- Go does not have block-scoped cleanup. If you need cleanup at block boundaries, extract the block into its own function.

## 9. Struct Assignment Copies Everything

Assigning one struct to another creates a complete copy of all fields. Changes to the copy do not affect the original.

**The wrong code:**

```go
type Config struct {               // A config struct
    Port    int                    // Server port
    Verbose bool                   // Logging verbosity
}

original := Config{Port: 8080, Verbose: true}  // Create a config
copied := original                 // FULL COPY -- a completely independent value
copied.Port = 9090                 // Only changes the copy

fmt.Println(original.Port)        // Still 8080 -- the original is unchanged
fmt.Println(copied.Port)          // 9090 -- the copy has its own values
```

**What happens:** You think you are sharing a config between two parts of your code, but each one has its own independent copy. Changes in one are invisible to the other.

**The fix (if you want to share):**

```go
original := &Config{Port: 8080, Verbose: true}  // & creates a pointer
shared := original                               // Both variables point to the SAME Config
shared.Port = 9090                               // Changes the original too!

fmt.Println(original.Port)        // 9090 -- because shared and original point to the same memory
```

**Why:** Go copies by value by default. If you want reference semantics (like JavaScript objects), use pointers. This is why handlers use `*App` -- if `App` were passed by value, every handler would get a copy and no handler could see changes made by another.

::: tip This Is Why Handlers Use *App
The `App` struct is always passed as a pointer (`*App`). If it were passed by value, every handler would get a copy, and no handler could see changes made by another. The `*` means "this is a reference, not a copy."
:::

## 10. The init() Function Runs Before main()

**The wrong code:**

```go
package main                       // In the main package

import "fmt"

func init() {                      // This function runs AUTOMATICALLY
    fmt.Println("init runs first!")  // Before main() -- no explicit call needed
}

func main() {
    fmt.Println("main runs second")  // This runs after init()
}
// Output:
// init runs first!
// main runs second
```

**What happens:** Side effects in `init()` happen silently during package import. If a test is failing in a confusing way, check if there is an `init()` function doing something unexpected -- initializing global state, registering handlers, or starting background goroutines.

**The fix:** Prefer explicit initialization functions that you call from `main()` instead of relying on `init()`. The BFFs in ODH Dashboard use `init()` sparingly -- mostly for registering flags or setting up default values.

**Why:** Go supports `init()` for package-level setup that must happen before any code in the package runs. Every package can have one (or more), and they run in dependency order during program startup.

## 11. Short Declaration in if Creates New Scope

**The wrong code:**

```go
x := 10                            // x is 10 in the outer scope

if x := 20; x > 15 {              // This x is a NEW variable, scoped to the if-block
    fmt.Println(x)                 // Prints 20 -- the inner x
}

fmt.Println(x)                     // Prints 10 -- the outer x was never changed!
```

**What happens:** You think you are modifying `x`, but the `:=` in the `if` statement creates a brand new `x` that shadows the outer one. The outer `x` is untouched.

**The fix:**

```go
x := 10                            // x is 10

if x = 20; x > 15 {               // Use = (assign) instead of := (declare)
    fmt.Println(x)                 // Prints 20
}

fmt.Println(x)                     // Prints 20 -- the original x was modified
```

**Why:** `:=` always creates a new variable. `=` assigns to an existing one. In an `if` statement, `:=` creates a variable scoped to the `if` block plus its `else` branches. This is intentional but confusing when you expect to modify an outer variable.

## 12. err Shadowing in Nested Blocks

The most dangerous form of variable shadowing. This one causes silent bugs that are incredibly hard to find.

**The wrong code:**

```go
func doStuff() error {             // Returns an error
    var err error                  // Declare err in the outer scope -- it's nil

    if condition {
        result, err := someFunction()  // DANGER: := creates a NEW err in this scope!
        if err != nil {            // Checks the INNER err (correct here)
            return err             // Returns the inner err (correct here)
        }
        process(result)            // Uses result
    }

    return err                     // Returns the OUTER err -- which is still nil!
                                   // Even if someFunction() failed, you lost the error
}
```

**What happens:** The error from `someFunction()` is caught correctly inside the `if` block, but if execution reaches the `return err` at the bottom, it returns the **outer** `err` which was never assigned. The error is silently swallowed.

**The fix:**

```go
func doStuff() error {             // Returns an error
    var err error                  // Declare err in the outer scope

    if condition {
        var result SomeType        // Declare result separately
        result, err = someFunction()  // Use = not := to assign to the OUTER err
        if err != nil {
            return err             // Returns the outer err (now correctly set)
        }
        process(result)
    }

    return err                     // Now correctly reflects any error from someFunction
}
```

**Why:** `:=` creates a new variable even if one with the same name already exists in an outer scope. This is called "variable shadowing." The `go vet` tool and the `shadow` linter can catch this. If you configure VS Code with the Go extension, it will warn you.

::: danger This Is the #1 Source of Subtle Bugs
Variable shadowing with `:=` in nested blocks is the most common mistake in Go code. The error compiles fine, passes basic testing, and then fails silently in production when the error path is hit. Always be suspicious of `:=` inside `if` or `for` blocks when there is a variable with the same name in an outer scope.
:::

## 13. The Loop Variable Closure Gotcha

::: info Fixed in Go 1.22+
Go 1.22 changed loop variable semantics so each iteration gets its own variable. If you are using Go 1.22+ (which you are for ODH Dashboard), this gotcha **no longer applies**. But you will see the old workaround in legacy code, so it is worth understanding.
:::

In Go versions before 1.22, loop variables were shared across iterations:

**The old buggy code:**

```go
for _, name := range names {       // In pre-1.22: 'name' is the SAME variable each iteration
    go func() {                    // Launch a goroutine
        fmt.Println(name)          // All goroutines print the LAST name in the list
    }()
}
```

**The old fix (no longer needed with Go 1.22+):**

```go
for _, name := range names {       // In Go 1.22+: each iteration gets its own 'name'
    go func() {
        fmt.Println(name)          // Each goroutine prints its own name -- correct
    }()
}

// Old workaround (still works, just not needed anymore):
for _, name := range names {
    go func(n string) {            // Capture via function parameter
        fmt.Println(n)             // Uses the parameter, not the loop variable
    }(name)                        // Pass the current value
}
```

**Why:** The Go team recognized this was a pervasive footgun and fixed it in 1.22 by giving each loop iteration its own copy of the variable.
