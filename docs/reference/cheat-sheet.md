# Go <-> TypeScript Cheat Sheet

A side-by-side reference for TypeScript developers writing Go. Keep this tab open while you code. Every row has a one-line explanation so you never have to guess.

## Variables and Constants

| TypeScript | Go | What the Go version does |
|---|---|---|
| `let name = "alice"` | `name := "alice"` | Short declaration -- infers the type as `string` |
| `const name = "alice"` | `const name = "alice"` | Compile-time constant -- must be a literal, not a function call |
| `let name: string` | `var name string` | Declares with explicit type -- value is `""` (zero value) |
| `let count: number = 0` | `count := 0` | Short declaration -- infers type as `int` |
| `const MAX = 100` | `const MAX = 100` | Same syntax, same semantics |

::: info := vs var
`:=` is short variable declaration -- it infers the type and can **only** be used inside functions. `var` works everywhere (including package level) and lets you specify the type explicitly. Use `:=` inside functions, `var` for package-level variables.
:::

## Primitive Types

| TypeScript | Go | Zero Value | When the zero value bites you |
|---|---|---|---|
| `string` | `string` | `""` | An uninitialized string is empty, not `undefined` |
| `number` (integer) | `int`, `int64`, `int32` | `0` | An uninitialized int is 0, not `NaN` |
| `number` (float) | `float64`, `float32` | `0.0` | Same -- 0.0, not `NaN` |
| `boolean` | `bool` | `false` | Uninitialized bool is `false`, not `undefined` |
| `null` / `undefined` | `nil` | -- | `nil` only works for pointers, slices, maps, interfaces |
| `any` | `any` or `interface{}` | `nil` | Avoid -- you lose all type safety |

## Strings

| TypeScript | Go | What the Go version does |
|---|---|---|
| `` `Hello ${name}` `` | `fmt.Sprintf("Hello %s", name)` | Format string with `%s` for strings, `%d` for ints |
| `str.length` | `len(str)` | Returns byte count (use `utf8.RuneCountInString` for rune count) |
| `str.includes("sub")` | `strings.Contains(str, "sub")` | Returns bool -- need to `import "strings"` |
| `str.startsWith("pre")` | `strings.HasPrefix(str, "pre")` | Returns bool |
| `str.endsWith("suf")` | `strings.HasSuffix(str, "suf")` | Returns bool |
| `str.trim()` | `strings.TrimSpace(str)` | Trims whitespace from both ends |
| `str.split(",")` | `strings.Split(str, ",")` | Returns `[]string` (a slice of strings) |
| `arr.join(",")` | `strings.Join(arr, ",")` | Joins a `[]string` with the separator |
| `str.toUpperCase()` | `strings.ToUpper(str)` | Returns a new string (strings are immutable) |
| `str.replace("a", "b")` | `strings.Replace(str, "a", "b", 1)` | The `1` means "replace first occurrence only" |
| `str.replaceAll("a", "b")` | `strings.ReplaceAll(str, "a", "b")` | Replaces all occurrences |

## Data Structures

### Arrays / Slices

| TypeScript | Go | What the Go version does |
|---|---|---|
| `const arr: string[] = []` | `arr := []string{}` | Creates an empty slice (Go's dynamic array) |
| `const arr = ["a", "b"]` | `arr := []string{"a", "b"}` | Creates a slice with initial values |
| `arr.push("c")` | `arr = append(arr, "c")` | `append` returns a new slice -- must reassign |
| `arr.length` | `len(arr)` | Returns the number of elements |
| `arr[0]` | `arr[0]` | Access by index -- panics if out of bounds |
| `arr.slice(1, 3)` | `arr[1:3]` | Slice syntax -- creates a sub-slice (no copy) |
| `arr.map(x => x * 2)` | `for` loop | No built-in map -- write a loop |
| `arr.filter(x => x > 0)` | `for` loop | No built-in filter -- write a loop |
| `arr.find(x => x.id === "1")` | `for` loop | No built-in find -- write a loop |
| `arr.forEach(fn)` | `for _, item := range arr { ... }` | Range-based for loop |

### Objects / Structs

| TypeScript | Go | What the Go version does |
|---|---|---|
| `interface User { name: string }` | `type User struct { Name string }` | Defines a data structure with named fields |
| `const u: User = { name: "a" }` | `u := User{Name: "a"}` | Creates an instance with field values |
| `u.name` | `u.Name` | Access a field (uppercase = exported) |
| `{ ...user, age: 26 }` | No spread operator | Copy and modify manually -- no shorthand |
| `user?.name` | No optional chaining | Check for nil explicitly with `if user != nil` |

### Maps

| TypeScript | Go | What the Go version does |
|---|---|---|
| `new Map<string, number>()` | `m := make(map[string]int)` | `make` initializes the map -- REQUIRED before writing |
| `{ a: 1, b: 2 }` | `map[string]int{"a": 1, "b": 2}` | Map literal with types declared |
| `m.set("key", val)` | `m["key"] = val` | Bracket assignment |
| `m.get("key")` | `val, ok := m["key"]` | Two-value return: value + "was it there?" bool |
| `m.has("key")` | `_, ok := m["key"]` | Discard the value, keep the existence check |
| `m.delete("key")` | `delete(m, "key")` | Built-in `delete` function |
| `Object.keys(m)` | `for k := range m { ... }` | Iterate keys -- order is random |

## Functions

| TypeScript | Go | What the Go version does |
|---|---|---|
| `function add(a: number, b: number): number` | `func add(a int, b int) int` | Function with typed params and return |
| `(a, b) => a + b` | `func(a, b int) int { return a + b }` | Anonymous function (must use `return`) |
| `async function f(): Promise<Data>` | `func f() (Data, error)` | Go returns `(result, error)` instead of Promise |
| Default params: `function f(x = 10)` | No default params | Use variadic args or option structs instead |
| Rest params: `function f(...args)` | `func f(args ...int)` | Variadic -- `args` is a `[]int` slice |

### Multiple Return Values

```go
// Go functions commonly return (result, error) -- like a tuple
func divide(a, b float64) (float64, error) {  // Two return types in parentheses
    if b == 0 {                                // Check for error condition
        return 0, fmt.Errorf("division by zero")  // Return zero value + error
    }
    return a / b, nil                          // Return result + nil (no error)
}

// The caller MUST handle both return values
result, err := divide(10, 3)                   // Destructure into two variables
if err != nil {                                // Always check the error
    log.Fatal(err)                             // Handle the error
}
fmt.Println(result)                            // Use the result only if no error
```

## Error Handling

<div class="code-compare">
<div>

**TypeScript**

```typescript
try {                              // Wrap risky code in try
  const data = await fetchData();  // Might throw
  return data;                     // Return on success
} catch (err) {                    // Catch any thrown error
  console.error('Failed:', err);   // Log it
  throw new Error('fetch failed'); // Re-throw
}
```

</div>
<div>

**Go**

```go
data, err := fetchData()              // Returns (data, error)
if err != nil {                       // Check if error is non-nil
    log.Printf("Failed: %v", err)     // Log it (%v = default format)
    return nil, fmt.Errorf(           // Return a wrapped error
        "fetch failed: %w", err,      // %w wraps the original error
    )
}
return data, nil                      // Return data + nil (no error)
```

</div>
</div>

| TypeScript | Go | What the Go version does |
|---|---|---|
| `throw new Error("msg")` | `return fmt.Errorf("msg")` | Creates and returns an error value |
| `try { } catch(e) { }` | `if err != nil { }` | Explicit error check after every call |
| `err === specificError` | `errors.Is(err, specificError)` | Checks if err wraps a specific error value |
| `err instanceof TypeError` | `errors.As(err, &target)` | Checks if err wraps a specific error type |
| `err.message` | `err.Error()` | Get the error message as a string |
| `new Error("outer", { cause: inner })` | `fmt.Errorf("outer: %w", inner)` | Wrap an error to preserve the chain |

## Modules and Imports

| TypeScript | Go | What the Go version does |
|---|---|---|
| `import { Foo } from './foo'` | `import "mymod/internal/foo"` | Import by package path, not file path |
| `export function Bar()` | `func Bar()` | Uppercase first letter = exported (public) |
| `export default class` | No default exports | Just use uppercase names |
| `package.json` | `go.mod` | Module name, Go version, and dependencies |
| `package-lock.json` | `go.sum` | Checksums for all dependencies |
| `npm install` | `go mod download` | Download all dependencies |
| `npm install pkg` | `go get pkg@latest` | Add a dependency |

::: tip Uppercase = Public
Go has no `export` keyword. A function, type, or variable starting with an uppercase letter is exported (visible to other packages). Lowercase = unexported (package-private). That is the entire visibility system. No `public`, no `private`, no `protected` -- just capitalization.
:::

## Control Flow

### If / Else

| TypeScript | Go | What the Go version does |
|---|---|---|
| `if (x > 0) { ... }` | `if x > 0 { ... }` | No parentheses around the condition |
| `if (x) { ... }` (truthy) | `if x != nil { ... }` | No truthy/falsy -- must be explicit |
| `x ? a : b` | No ternary | Use full `if/else` -- Go has no ternary operator |

### Loops

| TypeScript | Go | What the Go version does |
|---|---|---|
| `for (let i = 0; i < n; i++)` | `for i := 0; i < n; i++` | Classic C-style for loop |
| `for (const item of arr)` | `for _, item := range arr` | Range loop -- `_` is the index (discarded) |
| `for (const [k, v] of map)` | `for k, v := range m` | Range over map keys and values |
| `while (condition)` | `for condition { ... }` | Go only has `for` -- no `while` keyword |
| `while (true)` | `for { ... }` | Infinite loop |

### Switch

| TypeScript | Go | What the Go version does |
|---|---|---|
| `switch(x) { case "a": ...; break; }` | `switch x { case "a": ... }` | No `break` needed -- cases don't fall through |
| Fall-through (rare) | `fallthrough` keyword | Explicitly opt in to fall-through behavior |

## JSON

| TypeScript | Go | What the Go version does |
|---|---|---|
| `JSON.stringify(obj)` | `json.Marshal(obj)` | Returns `([]byte, error)` -- bytes and possible error |
| `JSON.stringify(obj, null, 2)` | `json.MarshalIndent(obj, "", "  ")` | Pretty-printed with 2-space indent |
| `JSON.parse(str)` | `json.Unmarshal([]byte(str), &obj)` | Parses into a struct via pointer |
| `interface { name: string }` | `type T struct { Name string \`json:"name"\` }` | Struct tag controls the JSON key name |
| `name?: string` | `Name string \`json:"name,omitempty"\`` | `omitempty` skips the field if it is the zero value |

```go
// Struct with JSON tags -- every field has a backtick annotation
type User struct {                             // The Go type
    ID    string `json:"id"`                   // JSON key: "id" (lowercase)
    Name  string `json:"name"`                 // JSON key: "name" (lowercase)
    Email string `json:"email,omitempty"`      // Omitted from JSON if Email is ""
}

// Encoding: struct -> JSON bytes
bytes, err := json.Marshal(user)               // Returns []byte and error

// Decoding: JSON bytes -> struct
var user User                                  // Declare the target variable
err := json.Unmarshal(data, &user)             // & passes the address so Unmarshal can fill it in
```

## HTTP

### Server (Handling Requests)

| TypeScript (Express) | Go (httprouter) | What the Go version does |
|---|---|---|
| `app.get('/path', handler)` | `router.GET("/path", handler)` | Register a GET route |
| `app.post('/path', handler)` | `router.POST("/path", handler)` | Register a POST route |
| `(req, res) => { ... }` | `func(w, r, ps)` | Handler signature: writer, request, params |
| `req.params.id` | `ps.ByName("id")` | Get a route parameter by name |
| `req.query.name` | `r.URL.Query().Get("name")` | Get a query string parameter |
| `req.body` | `json.NewDecoder(r.Body).Decode(&input)` | Parse JSON body into a struct |
| `res.status(200).json(data)` | `app.WriteJSON(w, 200, data, nil)` | Write JSON response with status |
| `res.status(404).json({...})` | `app.notFoundResponse(w, r)` | Write standard error response |

### Client (Making Requests)

| TypeScript | Go | What the Go version does |
|---|---|---|
| `await fetch(url)` | `resp, err := http.Get(url)` | Send a GET request (returns response + error) |
| `response.json()` | `json.NewDecoder(resp.Body).Decode(&result)` | Parse response body as JSON |
| `response.status` | `resp.StatusCode` | HTTP status code as integer |

## Testing

| Jest | Go Testing | What the Go version does |
|---|---|---|
| `describe('name', () => { ... })` | `func TestName(t *testing.T) { ... }` | Top-level test function (MUST start with `Test`) |
| `it('should ...', () => { ... })` | `t.Run("should ...", func(t *testing.T) { ... })` | Sub-test (like a nested `it`) |
| `expect(x).toBe(y)` | `assert.Equal(t, y, x)` | Equality check (expected first in testify) |
| `expect(x).toContain(y)` | `assert.Contains(t, x, y)` | Substring or element check |
| `expect(fn).toThrow()` | `assert.Error(t, err)` | Check that an error was returned |
| `expect(x).toBeNull()` | `assert.Nil(t, x)` | Check that a value is nil |
| `expect(x).not.toBeNull()` | `assert.NotNil(t, x)` | Check that a value is NOT nil |
| `expect(x).toBeTruthy()` | `assert.True(t, x)` | Check that a bool is true |
| `beforeEach(() => { ... })` | Helper function called in each `t.Run` | No lifecycle hooks -- just call a setup function |
| `jest.fn()` / `jest.mock()` | Struct implementing interface | Define a mock struct with configurable fields |
| `*.test.ts` / `*.spec.ts` | `*_test.go` | Test file naming convention |
| `npx jest` | `go test ./...` | Run all tests |
| `npx jest --verbose` | `go test -v ./...` | Show individual test names |
| `npx jest --watch` | No built-in watch | Use `gow` ([github.com/mitranim/gow](https://github.com/mitranim/gow)) or `gotestsum --watch` |
| `npx jest --coverage` | `go test -cover ./...` | Show test coverage percentage |

## CLI Commands

| npm / Node | Go | What the Go command does |
|---|---|---|
| `npx tsx src/index.ts` | `go run .` | Compile and run in one step |
| `npm run build` | `go build -o app .` | Compile to a standalone binary |
| `tsc --noEmit` | `go build ./...` | Check for compilation errors without producing output |
| `npx jest` | `go test ./...` | Run all tests recursively |
| `npx prettier --write .` | `go fmt ./...` | Format all Go files (no config needed) |
| `npx eslint .` | `go vet ./...` | Static analysis -- catch common bugs |
| `npm init -y` | `go mod init module-name` | Create a new module (creates `go.mod`) |
| `npm install` | `go mod download` | Download all dependencies |
| `npm install pkg` | `go get pkg@latest` | Add or update a dependency |
| `npm prune` | `go mod tidy` | Remove unused deps, add missing ones |

## Operator Patterns (controller-runtime)

These show up once you're in the `dashboard-operator` (Parts 4–6). There's no direct TypeScript equivalent for most — the closest mental model is React's render loop: you declare desired state, and something keeps reality in sync.

| Concept | Go | What it does |
|---|---|---|
| Reconcile signature | `func (r *R) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error)` | The one method every controller implements |
| Requeue after delay | `return ctrl.Result{RequeueAfter: 30 * time.Second}, nil` | Ask to be called again later (not an error) |
| Requeue on error | `return ctrl.Result{}, err` | Non-nil error → automatic exponential backoff requeue |
| Done, no requeue | `return ctrl.Result{}, nil` | Success — don't requeue until something changes |
| Fetch the CR | `r.Get(ctx, req.NamespacedName, &dashboard)` | Read current state (from the cache) |
| Ignore not-found | `client.IgnoreNotFound(err)` | The CR was deleted — nothing to do |
| Watch owned resources | `.Owns(&appsv1.Deployment{})` | Re-reconcile when a child Deployment changes |
| Server-Side Apply | `r.Patch(ctx, obj, client.Apply, client.FieldOwner("dashboard-operator"))` | Declare desired fields; server merges by owner |

### Struct embedding (composition, not inheritance)

```go
type DashboardReconciler struct {
    client.Client                       // Embedded — r.Get/List/Create/Patch are promoted
    Scheme *runtime.Scheme              // Named field
}
// Now: r.Get(ctx, key, &obj) works directly — no r.Client.Get needed
```

### Named-type "enums"

```go
type DeploymentMode string             // A named string type used like a TS string-literal union

const (                                 // The allowed values (like: type Mode = 'sidecar' | 'standalone')
    DeploymentModeSidecar    DeploymentMode = "sidecar"
    DeploymentModeStandalone DeploymentMode = "standalone"
)
```

### Generics (the response Envelope)

```go
type Envelope[D any, M any] struct {    // Like TS: type Envelope<D, M> = { data: D; meta?: M }
    Data D `json:"data"`
    Meta M `json:"meta,omitempty"`
}
```
