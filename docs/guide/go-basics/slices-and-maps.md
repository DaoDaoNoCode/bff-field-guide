# Slices & Maps — Collections Without the Convenience Methods

> **Go Concept:** Slices are Go's dynamic arrays (like JavaScript arrays), and maps are Go's key-value stores (like TypeScript's `Record` or JavaScript's `Map`).

You know `const arr = [1, 2, 3]`. You know `.push()`, `.filter()`, `.map()`, `.reduce()`, `.find()`, `.some()`, `.every()`. You can chain them. You can compose them. They're beautiful.

Go has... none of that.

Let's rip the bandaid off: Go gives you a dynamic array (called a "slice"), a built-in `append()` function, a `for range` loop, and says "you've got everything you need." No `.filter()`, no `.map()`, no `.reduce()`. You write loops.

This feels like going backwards. It might even feel offensive. But stick with me — the code ends up being clear, predictable, and surprisingly readable once you get used to it.

## Arrays — You'll Almost Never Use Them

Go has fixed-size arrays, but you'll almost never touch them directly. They exist mostly as the machinery behind slices:

```go
var scores [3]int                          // An array of 3 ints — fixed size, always 3
                                           // All values start at zero: [0, 0, 0]
scores[0] = 98                             // Set the first element to 98
scores[1] = 85                             // Set the second element to 85
fmt.Println(scores)                        // [98 85 0] — third element is still 0

names := [2]string{"Alice", "Bob"}         // Array literal — exactly 2 strings
                                           // The size [2] is part of the TYPE
```

The important thing to know: `[3]int` and `[5]int` are **different types**. You can't pass a `[3]int` to a function that expects `[5]int`. This is why nobody uses arrays directly. What you actually want is a **slice**.

## Slices — Your Go-To Collection

A slice is a dynamic-length, flexible view over an underlying array. This is what you'll use everywhere. Think of it as Go's version of a JavaScript array.

### Creating Slices

Let's start simple:

```go
names := []string{"Alice", "Bob", "Charlie"} // A slice literal — notice NO number in the brackets
                                              // []string (no size) = slice, [3]string = array
fmt.Println(names)                            // [Alice Bob Charlie]
fmt.Println(len(names))                       // 3 — len() gives you the length
```

::: code-group
```ts [TypeScript]
// TypeScript — creating arrays
const names: string[] = ["Alice", "Bob", "Charlie"]; // An array of strings
const empty: string[] = [];                           // An empty array
console.log(names.length);                            // 3
```

```go [Go]
// Go — creating slices
names := []string{"Alice", "Bob", "Charlie"} // A slice of strings — no fixed size
empty := []string{}                           // An empty slice
fmt.Println(len(names))                       // 3 — use len(), not .length
```
:::

There are several ways to create slices, and each has its use:

```go
// Method 1: Literal — you know the values upfront
names := []string{"Alice", "Bob"}              // Create with initial values

// Method 2: Empty slice — you'll add values later
items := []string{}                            // Empty but not nil — length 0, ready to go

// Method 3: nil slice — declared but not initialized
var things []string                            // nil — no underlying array yet
                                               // Still safe to use with append!
fmt.Println(things == nil)                     // true

// Method 4: make() — when you know the capacity ahead of time
results := make([]string, 0, 100)              // Empty (length 0) but pre-allocates space for 100
                                               // Avoids repeated memory allocations as you append
```

**What just happened?** Methods 1 and 2 are what you'll use 90% of the time. Method 3 (nil slice) is fine too — Go handles nil slices gracefully. Method 4 (`make`) is a performance optimization for when you know roughly how many items you'll add.

::: info nil slice vs empty slice
A nil slice (`var s []string`) and an empty slice (`s := []string{}`) behave almost identically — both have length 0, and both work with `append()`. However, they differ in JSON: a nil slice encodes to `null`, while an empty slice (`[]string{}`) encodes to `[]`. This matters in BFF responses — if your API contract expects an empty array, always initialize with `[]string{}`, never leave it nil.
:::

<div class="checkpoint">

#### Checkpoint
Slices are Go's dynamic arrays. Create them with `[]Type{values}` or `[]Type{}`. Use `len(s)` for length. There's no `.length` property — `len()` is a built-in function.
</div>

### Adding Elements — `append()` Returns a New Slice

JavaScript has `.push()` that modifies the array in place. Go has `append()`, which returns a new slice — and you **must** reassign it:

```go
items := []string{}                            // Start with an empty slice
items = append(items, "one")                   // Append "one" — MUST reassign to items
items = append(items, "two", "three")          // Append multiple values at once
fmt.Println(items)                             // [one two three]
```

::: code-group
```ts [TypeScript]
// TypeScript — push mutates in place
const items: string[] = [];                    // Empty array
items.push("one");                             // Adds to the array — no reassignment needed
items.push("two", "three");                    // Push multiple
console.log(items);                            // ["one", "two", "three"]
```

```go [Go]
// Go — append returns a new slice
items := []string{}                            // Empty slice
items = append(items, "one")                   // append() returns new slice — must reassign!
items = append(items, "two", "three")          // Append multiple at once
fmt.Println(items)                             // [one two three]
```
:::

::: warning
`append()` returns a new slice — you MUST reassign it. This is the most common mistake new Go developers make:
```go
items := []string{"a"}                         // Start with ["a"]
append(items, "b")                             // WRONG — result is thrown away!
items = append(items, "b")                     // CORRECT — reassign to items
```
The compiler won't catch this because `append` does return a value — you're just not using it. Some linters will warn you, but the compiler won't.
:::

### Iterating — `for range`

The `for range` loop is how you iterate over slices. It gives you both the index and the value — similar to JavaScript's `Array.entries()`:

```go
names := []string{"Alice", "Bob", "Charlie"}   // A slice with three names

// Get both index AND value
for i, name := range names {                   // i = index (0, 1, 2), name = value
    fmt.Printf("%d: %s\n", i, name)           // Print "0: Alice", "1: Bob", "2: Charlie"
}
```

::: code-group
```ts [TypeScript]
// TypeScript — several iteration options
const names = ["Alice", "Bob", "Charlie"];

// forEach — index and value
names.forEach((name, i) => {                   // Callback with value first, then index
  console.log(`${i}: ${name}`);                // "0: Alice", "1: Bob", "2: Charlie"
});

// for...of — value only (like range with _)
for (const name of names) {                    // No index
  console.log(name);                           // "Alice", "Bob", "Charlie"
}

// entries() — both index and value
for (const [i, name] of names.entries()) {     // Destructure [index, value]
  console.log(`${i}: ${name}`);
}
```

```go [Go]
// Go — for range with index and value
names := []string{"Alice", "Bob", "Charlie"}

for i, name := range names {                   // i = index, name = value (OPPOSITE order from TS forEach!)
    fmt.Printf("%d: %s\n", i, name)           // "0: Alice", "1: Bob", "2: Charlie"
}

// Ignore the index with _
for _, name := range names {                   // _ discards the index
    fmt.Println(name)                          // Just "Alice", "Bob", "Charlie"
}

// Index only (like Object.keys)
for i := range names {                         // Only the index
    fmt.Println(i)                             // 0, 1, 2
}
```
:::

**What just happened?** `for range` always gives you index first, then value. This is the opposite of JavaScript's `.forEach(value, index)`. Use `_` to discard whichever one you don't need. If you omit the second variable entirely (`for i := range`), you get only the index.

<div class="checkpoint">

#### Checkpoint
`for range` gives you **index first, value second** — opposite of JavaScript's `forEach(value, index)`. Use `_` to discard the index: `for _, item := range items`. Use `for i := range items` for index only.
</div>

### Where's filter? Where's map? Where's reduce?

Let me just say it: **Go doesn't have them.** No `.filter()`, no `.map()`, no `.reduce()`, no `.find()`, no `.some()`, no `.every()`. You write loops.

This is the part where JavaScript developers go through the five stages of grief. Let me walk you through each equivalent:

**Filter — picking items that match a condition:**

```ts
// TypeScript — one clean line
const numbers = [1, 2, 3, 4, 5];
const evens = numbers.filter(n => n % 2 === 0);  // [2, 4] — declarative, beautiful
```

```go
numbers := []int{1, 2, 3, 4, 5}               // Start with a slice of ints

var evens []int                                // Declare a nil slice for results
                                               // (nil is fine — append handles it)
for _, n := range numbers {                    // Loop through each number
    if n%2 == 0 {                              // Check if it's even
        evens = append(evens, n)               // If so, add it to the result
    }
}
// evens is now [2, 4]                         // Same result, more lines
```

**Map — transforming each element:**

```ts
// TypeScript — clean transformation
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);       // [2, 4, 6, 8, 10]
```

```go
numbers := []int{1, 2, 3, 4, 5}               // Start with a slice of ints

doubled := make([]int, len(numbers))           // Pre-allocate the result slice
                                               // We know exactly how many items we'll have
for i, n := range numbers {                    // Loop with index and value
    doubled[i] = n * 2                         // Transform each element in place
}
// doubled is now [2, 4, 6, 8, 10]
```

**Reduce — accumulating a result:**

```ts
// TypeScript — fold everything into one value
const numbers = [1, 2, 3, 4, 5];
const sum = numbers.reduce((acc, n) => acc + n, 0);  // 15
```

```go
numbers := []int{1, 2, 3, 4, 5}               // Start with a slice of ints

sum := 0                                       // Initialize the accumulator
for _, n := range numbers {                    // Loop through each number
    sum += n                                   // Add to the accumulator
}
// sum is now 15
```

**Find — getting the first match:**

```ts
// TypeScript
const users = [{ name: "Alice" }, { name: "Bob" }];
const alice = users.find(u => u.name === "Alice");  // { name: "Alice" }
```

```go
type User struct {                             // A simple User struct
    Name string                                // With a Name field
}

users := []User{                               // A slice of Users
    {Name: "Alice"},                           // First user
    {Name: "Bob"},                             // Second user
}

var found *User                                // Pointer to User — nil means "not found"
for i := range users {                         // Loop through users (index only)
    if users[i].Name == "Alice" {              // Check the condition
        found = &users[i]                      // Take a pointer to the found element
        break                                  // Stop looking — we found it
    }
}
// found points to Alice, or is nil if not found
```

**What just happened?** Yes, it's more lines. I know. I know it feels like going backwards. But here's the thing: there's no ambiguity about what's happening. No closure scoping questions, no method chain gotchas, no "wait, does `.filter()` modify in place or return a new array?" (it returns new, but `.sort()` modifies in place — remember that inconsistency?). Go's loops are boring, predictable, and clear.

::: info Why No Functional Methods?
Go's philosophy is "one way to do things, and that way should be obvious." The Go team considered adding generic functional utilities when generics were added in Go 1.18, but decided against it. The community prefers explicit loops because they're easier to debug, easier to profile, and always have predictable performance.
:::

<div class="checkpoint">

#### Checkpoint
Go has no `.filter()`, `.map()`, or `.reduce()`. You write `for` loops instead. It's more verbose but unambiguous. Use `var result []Type` + `append()` for filter-like operations. Use `make([]Type, len(source))` + index assignment for map-like operations.
</div>

### Slicing a Slice

You can create a sub-slice using `[low:high]` syntax, where `low` is inclusive and `high` is exclusive:

```go
s := []int{10, 20, 30, 40, 50}                // A slice with five elements

sub := s[1:3]                                  // Elements at index 1 and 2 (not 3!)
fmt.Println(sub)                               // [20 30] — low inclusive, high exclusive

first3 := s[:3]                                // From start to index 2
fmt.Println(first3)                            // [10 20 30]

last3 := s[2:]                                 // From index 2 to end
fmt.Println(last3)                             // [30 40 50]

all := s[:]                                    // The whole thing — same underlying array!
fmt.Println(all)                               // [10 20 30 40 50]
```

::: code-group
```ts [TypeScript]
// TypeScript — slice()
const s = [10, 20, 30, 40, 50];
s.slice(1, 3);    // [20, 30] — start inclusive, end exclusive
s.slice(0, 3);    // [10, 20, 30]
s.slice(2);       // [30, 40, 50]
```

```go [Go]
// Go — bracket syntax
s := []int{10, 20, 30, 40, 50}
s[1:3]            // [20 30] — low inclusive, high exclusive
s[:3]             // [10 20 30]
s[2:]             // [30 40 50]
```
:::

::: warning
Unlike JavaScript's `.slice()` which creates a copy, Go's `s[1:3]` shares the same underlying array as `s`. Modifying the sub-slice modifies the original. If you need an independent copy, use `slices.Clone(s[1:3])` (from the standard library `slices` package, Go 1.21+) or copy manually with `copy()`.
:::

## Maps — Key-Value Stores

Maps in Go are like TypeScript's `Record<K, V>` or JavaScript's `Map<K, V>`. They store key-value pairs:

### Creating Maps

```go
// Map literal — most common way
scores := map[string]int{                      // map[KeyType]ValueType
    "alice":   95,                             // Key "alice", value 95
    "bob":     87,                             // Key "bob", value 87
    "charlie": 92,                             // Key "charlie", value 92
}                                              // The trailing comma is required!

fmt.Println(scores["alice"])                   // 95 — access by key
```

::: code-group
```ts [TypeScript]
// TypeScript — Record or Map
const scores: Record<string, number> = {       // Record<KeyType, ValueType>
  alice: 95,
  bob: 87,
  charlie: 92,
};

console.log(scores["alice"]);                  // 95

// Or using Map
const scoreMap = new Map<string, number>();
scoreMap.set("alice", 95);
console.log(scoreMap.get("alice"));            // 95
```

```go [Go]
// Go — map literal
scores := map[string]int{                      // map[KeyType]ValueType
    "alice":   95,                             // Key-value pair
    "bob":     87,                             // Another pair
    "charlie": 92,                             // Trailing comma required
}

fmt.Println(scores["alice"])                   // 95 — bracket access, like TS

// Creating an empty map
empty := map[string]int{}                      // Empty but initialized — safe to write
also := make(map[string]int)                   // Same thing, different syntax
```
:::

### Adding, Updating, and Deleting

```go
scores := map[string]int{}                     // Start with an empty map

scores["alice"] = 95                           // Add a key-value pair
scores["bob"] = 87                             // Add another
scores["alice"] = 98                           // Update — same key, new value

delete(scores, "bob")                          // Remove "bob" from the map
                                               // delete() is a built-in function

fmt.Println(scores)                            // map[alice:98]
```

::: code-group
```ts [TypeScript]
const scores: Record<string, number> = {};
scores["alice"] = 95;                          // Add
scores["bob"] = 87;                            // Add
scores["alice"] = 98;                          // Update
delete scores["bob"];                          // Delete
```

```go [Go]
scores := map[string]int{}                     // Empty map
scores["alice"] = 95                           // Add
scores["bob"] = 87                             // Add
scores["alice"] = 98                           // Update
delete(scores, "bob")                          // Delete — note: function call, not keyword
```
:::

### The Comma-OK Idiom — The Most Important Map Pattern

Here's a sneaky gotcha. When you access a key that doesn't exist in a Go map, you get the **zero value** for that type — not `undefined`, not an error, not `null`. Just the zero value:

```go
scores := map[string]int{                      // A map with one entry
    "alice": 0,                                // Alice has a score of 0
}

val1 := scores["alice"]                        // 0 — Alice exists, her score is 0
val2 := scores["bob"]                          // 0 — Bob does NOT exist, but 0 is the zero value!
                                               // How do you tell these apart?!
```

**The problem**: `scores["alice"]` returns `0` because Alice has a score of 0. `scores["bob"]` also returns `0` because Bob doesn't exist and `0` is the zero value for `int`. You can't tell the difference!

**The solution**: the comma-ok pattern:

```go
scores := map[string]int{                      // Map with Alice scoring 0
    "alice": 0,
}

val, ok := scores["alice"]                     // Two-value form: value + existence flag
                                               // ok is true — "alice" exists in the map
if ok {                                        // Check the flag
    fmt.Println("Alice:", val)                 // "Alice: 0" — she exists with value 0
}

val, ok = scores["bob"]                        // Two-value form again
                                               // ok is false — "bob" is NOT in the map
if !ok {                                       // Check the flag
    fmt.Println("Bob not found")               // "Bob not found" — clear distinction
}
```

::: code-group
```ts [TypeScript]
// TypeScript — different tools for different collection types
const record: Record<string, number> = { alice: 0 };
if ("alice" in record) {                       // 'in' operator checks existence
  console.log(record["alice"]);                // 0
}

const map = new Map<string, number>();
map.set("alice", 0);
if (map.has("alice")) {                        // .has() checks existence
  console.log(map.get("alice"));               // 0
}
const bob = map.get("bob");                    // undefined — clearly not found
```

```go [Go]
// Go — comma-ok pattern (one consistent way)
scores := map[string]int{"alice": 0}

val, ok := scores["alice"]                     // ok is true — exists
if ok {
    fmt.Println("Alice:", val)                 // "Alice: 0"
}

val, ok = scores["bob"]                        // ok is false — doesn't exist
if !ok {
    fmt.Println("Bob not found")               // "Bob not found"
}

// Common shorthand: declare and check in one line
if val, ok := scores["alice"]; ok {            // Declare + check in if statement
    fmt.Println("Found:", val)                 // Only runs if alice exists
}
```
:::

**What just happened?** The two-value form `val, ok := m[key]` gives you the value AND a boolean indicating whether the key exists. This pattern shows up throughout Go — in type assertions, channel receives, and map lookups. Get comfortable with it.

::: tip
The shorthand `if val, ok := m[key]; ok { ... }` is idiomatic Go. The `val` and `ok` variables are scoped to the `if` block, keeping the outer scope clean. You'll see this pattern everywhere.
:::

<div class="checkpoint">

#### Checkpoint
Use the comma-ok pattern (`val, ok := m[key]`) to check if a map key exists. Without it, you can't distinguish "key exists with zero value" from "key doesn't exist." This pattern is fundamental Go.
</div>

### Iterating Over Maps

```go
scores := map[string]int{                      // A map of name → score
    "alice":   95,                             // First entry
    "bob":     87,                             // Second entry
    "charlie": 92,                             // Third entry
}

for key, value := range scores {               // for range works on maps too
    fmt.Printf("%s: %d\n", key, value)        // Print each key-value pair
}

// Keys only
for key := range scores {                      // Omit the second variable
    fmt.Println(key)                           // Just the keys
}
```

::: warning
Map iteration order is **not guaranteed** in Go. If you `range` over a map twice, you might get different orders each time. Go intentionally randomizes the order to prevent code from accidentally depending on it. If you need sorted output, collect the keys into a slice and sort first.
:::

## Nil Slices vs Nil Maps — The Critical Gotcha

Here's something that will absolutely bite you if you're not ready for it. Nil slices and nil maps behave **differently**, and the difference matters.

### Nil slices are safe

```go
var s []string                                 // nil slice — not initialized
fmt.Println(s)                                 // [] — prints as empty (no panic)
fmt.Println(len(s))                            // 0 — length is 0 (no panic)
fmt.Println(s == nil)                          // true — it IS nil

s = append(s, "hello")                         // append handles nil! No panic!
fmt.Println(s)                                 // [hello] — now it's a real slice
```

### Nil maps are NOT safe for writing

```go
var m map[string]int                           // nil map — not initialized
fmt.Println(m)                                 // map[] — prints as empty (no panic)
fmt.Println(len(m))                            // 0 — length is 0 (no panic)

val := m["key"]                                // 0 — READING is safe (returns zero value)

m["key"] = 1                                   // RUNTIME PANIC! 💥
                                               // "assignment to entry in nil map"
                                               // WRITING to a nil map crashes the program!
```

::: danger
A nil map **panics** when you try to write to it. Always initialize maps before writing:
```go
// SAFE — these are all initialized and ready for writing
m := map[string]int{}                          // Empty map literal
m := make(map[string]int)                      // make() creates an initialized map
m := make(map[string]int, 100)                 // make() with size hint (optimization)
```
Remember: **nil slice = safe to append. Nil map = panics on write.** This is one of Go's most common gotchas.
:::

<div class="checkpoint">

#### Checkpoint
- **Nil slices** are safe: `append()` handles them, `len()` returns 0.
- **Nil maps** panic on write: always initialize with `map[K]V{}` or `make(map[K]V)` before writing.
- This asymmetry is a common source of bugs. When in doubt, initialize.
</div>

## Real BFF Patterns

Let's see how slices and maps are actually used in BFF code. These are patterns you'll write every day.

### Transforming API Responses to DTOs

The most common pattern: you get a list of objects from an API (Kubernetes, LlamaStack, etc.) and need to transform them into your response format:

```go
// apiModel is what the upstream API returns
type apiModel struct {                         // The raw API model — has fields you don't need
    Identifier  string                         // API uses "Identifier"
    DisplayName string                         // API uses "DisplayName"
    InternalRef string                         // Internal field — don't expose this
}

// ModelResponse is what your BFF returns to the frontend
type ModelResponse struct {                    // Your clean DTO
    ID   string `json:"id"`                    // Frontend-friendly "id"
    Name string `json:"name"`                  // Frontend-friendly "name"
}

func toModelResponses(models []apiModel) []ModelResponse { // Transform a list
    result := make([]ModelResponse, len(models))           // Pre-allocate — we know the size
                                                            // make(type, length) creates a ready slice
    for i, m := range models {                             // Loop with index and value
        result[i] = ModelResponse{                         // Set each element by index
            ID:   m.Identifier,                            // Map "Identifier" to "id"
            Name: m.DisplayName,                           // Map "DisplayName" to "name"
        }                                                  // InternalRef is simply not included
    }
    return result                                          // Return the transformed slice
}
```

**What just happened?** We used `make([]ModelResponse, len(models))` to pre-allocate a slice of the exact right size. Then we filled it in by index. This is the Go equivalent of `.map()` — more verbose, but you can see exactly what's happening.

### Building a Lookup Map

When you need fast access by ID (like when joining data from two API calls):

```go
func indexByID(models []Model) map[string]Model { // Build a lookup map from a slice
    result := make(map[string]Model, len(models)) // Pre-allocate with size hint
                                                   // len(models) = expected number of entries
    for _, m := range models {                     // Loop through all models
        result[m.ID] = m                           // Key = model ID, value = the model
    }
    return result                                  // Return the lookup map
}
```

```go
// Usage — O(1) lookup instead of O(n) search
models := fetchModels()                            // Get models from API
lookup := indexByID(models)                        // Build the lookup map

model, ok := lookup["model-123"]                   // Find by ID — instant, not a loop
if ok {                                            // Check if it exists
    fmt.Println(model.Name)                        // Use it
}
```

### Filtering With a Loop

```go
func filterByType(                                 // Filter models by their type
    models []Model,                                // Input slice
    modelType string,                              // The type to filter for
) []Model {                                        // Returns filtered slice
    var result []Model                             // nil slice — append will initialize it
    for _, m := range models {                     // Loop through all models
        if m.Type == modelType {                   // Check the condition
            result = append(result, m)             // Add matching models to the result
        }
    }
    return result                                  // Return filtered results (may be nil if none match)
}
```

### Combining Filter + Transform (A Real Handler Pattern)

Here's what a real BFF handler often does — filter, transform, and return:

```go
func (app *App) ListActiveModels(              // Handler method on the App struct
    w http.ResponseWriter,                     // HTTP response writer
    r *http.Request,                           // HTTP request (pointer)
    ps httprouter.Params,                      // URL parameters
) {
    namespace := ps.ByName("namespace")        // Get namespace from URL: /api/v1/:namespace/models

    allModels, err := app.modelService.ListModels( // Fetch all models from upstream service
        r.Context(),                               // Pass the request context
        namespace,                                 // For this namespace
    )
    if err != nil {                            // Handle errors
        app.serverErrorResponse(w, r, err)     // Return 500
        return                                 // Stop processing
    }

    // Filter to only active models
    var active []Model                         // Result slice for active models
    for _, m := range allModels {              // Loop through all models
        if m.Status == "active" {              // Check status
            active = append(active, m)         // Keep only active ones
        }
    }

    // Transform to response DTOs
    response := make([]ModelResponse, len(active)) // Pre-allocate response slice
    for i, m := range active {                     // Loop with index
        response[i] = ModelResponse{               // Transform each model
            ID:     m.ID,                          // Map fields
            Name:   m.Name,                        // Map fields
            Status: m.Status,                      // Map fields
        }
    }

    app.WriteJSON(w, http.StatusOK, response, nil) // Send JSON response
}
```

**What just happened?** This handler fetches a list, filters it, transforms it, and returns it as JSON. In TypeScript, the filter + transform would be two chained calls (`.filter().map()`). In Go, it's two loops. More lines, but each step is crystal clear.

## Quick Reference

```go
// === Slices ===
s := []int{1, 2, 3}                           // Literal
s = append(s, 4)                               // Append (must reassign!)
len(s)                                         // Length
s[0]                                           // Access by index
s[1:3]                                         // Sub-slice [2, 3]

// === Iteration ===
for i, v := range s { ... }                    // Index + value
for _, v := range s { ... }                    // Value only
for i := range s { ... }                       // Index only

// === Maps ===
m := map[string]int{"a": 1}                   // Literal
m["b"] = 2                                    // Add/update
delete(m, "a")                                // Delete
val, ok := m["key"]                           // Comma-ok lookup

// === Map iteration ===
for k, v := range m { ... }                   // Key + value (random order!)
for k := range m { ... }                      // Keys only

// === Nil safety ===
var s []int                                    // nil slice — safe to append
var m map[string]int                           // nil map — PANICS on write!
m = make(map[string]int)                       // Initialize before writing
```

::: tip Key Takeaway
Slices (`[]Type`) are Go's dynamic arrays — use `append()` to add elements and `for range` to iterate. Maps (`map[K]V`) are key-value stores — always initialize before writing, and use the comma-ok pattern (`val, ok := m[key]`) to check existence. There's no built-in `filter`, `map`, or `reduce` — you write loops instead. It's more verbose but unambiguous. The critical gotcha: nil slices are safe to `append()` to, but nil maps panic on write.
:::

::: info See Also
- [Types & Variables](./types-and-variables) — zero values for slices and maps
- [JSON](./json) — slices and maps in JSON encoding/decoding
- [Functions & Methods](./functions-and-methods) — variadic functions use slices
- [Pointers](./pointers) — slices of pointers vs slices of values
:::
