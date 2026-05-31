# Pointers — Scary Name, Familiar Concept

> **Go Concept:** Pointers let you share and mutate data by reference — something JavaScript does automatically for objects but Go requires you to do explicitly.

Pointers have a scary reputation. They conjure up images of C programmers debugging segfaults at 2 AM, of memory leaks and dangling references and undefined behavior. If you've only worked in JavaScript and TypeScript, you might feel like you're about to leave the safety of your cozy managed-memory apartment and step into a dark forest.

Here's the truth: **you already understand the concept. You just don't have syntax for it in JavaScript.**

Every time you pass an object to a function in JavaScript, you're using a pointer. You just don't see it. Go makes the invisible visible, and that's actually a good thing — because it means you get to *choose*.

## What You Already Know (But Never Think About)

In JavaScript, there's a hidden rule that governs how data moves through your program. Let's make it visible.

**Primitives are copied.** When you pass a number or string to a function, the function gets its own copy. Changing it inside the function doesn't affect the original:

```ts
// TypeScript — primitives are passed by VALUE
function doubleIt(n: number): void {  // 'n' is a COPY of whatever was passed in
  n = n * 2;                          // This only changes the local copy
}                                     // The copy is thrown away when the function ends

let score = 10;                       // score lives out here
doubleIt(score);                      // Pass score's VALUE (10) into the function
console.log(score);                   // 10 — unchanged! The function only touched its copy
```

**Objects are shared.** When you pass an object, the function can reach back and change the original:

```ts
// TypeScript — objects are passed by REFERENCE
function promote(user: { role: string }): void {  // 'user' points to the SAME object
  user.role = "admin";                              // This changes the ORIGINAL object
}                                                   // Because both 'user' variables point to the same place

const alice = { role: "viewer" };  // alice lives out here
promote(alice);                     // Pass a reference (pointer!) to alice
console.log(alice.role);            // "admin" — the original was modified!
```

**What just happened?** You never asked JavaScript to pass a reference. You never opted in. It just... did it. For objects, always. For primitives, never. You had no choice.

This is the thing Go changes. In Go, **you always have a choice**.

## Go's Default: Everything Is a Copy

Here's the rule that will rewire your brain: **in Go, everything is passed by value.** Structs, strings, numbers, booleans — all of them get copied when you pass them to a function.

```go
type User struct {       // Define a struct type called User
    Name string          // A Name field of type string
    Role string          // A Role field of type string
}                        // This is like a TypeScript 'type User = { name: string; role: string }'

func promote(u User) {   // 'u' is a COPY of the User that was passed in
    u.Role = "admin"     // This changes the COPY, not the original
}                        // The copy is thrown away when the function returns
```

Now let's use it:

```go
alice := User{             // Create a User value named alice
    Name: "Alice",         // Set Name to "Alice"
    Role: "viewer",        // Set Role to "viewer"
}                          // alice now holds {Name: "Alice", Role: "viewer"}

promote(alice)             // Go copies alice and passes the copy to promote
fmt.Println(alice.Role)    // "viewer" — the original was NOT modified!
```

**What just happened?** The `promote` function got a complete copy of `alice`. It changed the copy's `Role` field, but `alice` out here never heard about it. The copy lived and died inside `promote`.

If you're coming from JavaScript, this feels backwards. You just passed an *object* to a function and the function *couldn't change it*? That's correct. Go copied the entire struct.

::: info Why Copies?
Copies sound wasteful, but they're actually a safety feature. When a function gets a copy, you know with absolute certainty that it can't change your data behind your back. No "spooky action at a distance." No wondering "did some other function modify my object?" Copies make code easier to reason about.
:::

<div class="checkpoint">

#### Checkpoint
You understand that Go copies everything by default, including structs. This is the opposite of JavaScript's behavior with objects. A function receiving a struct value cannot modify the original.
</div>

## Introducing `&` — "Give Me the Address"

So how do you let a function modify the original? You give it a **pointer** — the address of the variable, not a copy.

Think of it this way. Right now, when you call `promote(alice)`, you're photocopying alice's resume and handing the photocopy to the function. The function can scribble all over the photocopy, but your original resume is safe at home.

A pointer is like writing your home address on a piece of paper and handing *that* to the function. Now the function can come to your house and change the real thing.

The `&` operator is how you write down that address:

```go
alice := User{             // Create a User value
    Name: "Alice",         // Set the Name field
    Role: "viewer",        // Set the Role field
}                          // alice lives at some memory address, say 0xc0000b4000

ptr := &alice              // & means "address of" — ptr now holds 0xc0000b4000
                           // ptr is of type *User (read: "pointer to User")
fmt.Println(ptr)           // &{Alice viewer} — Go shows the value, prefixed with &
```

**What just happened?** The `&` operator looked at `alice` and said, "I won't copy you. I'll just note down where you live." The variable `ptr` now holds alice's memory address. It's a `*User` — a pointer to a User.

Here's a simpler example with a plain variable:

```go
score := 42                // Create an int variable with value 42
p := &score                // p is a *int — it holds the ADDRESS of score
                           // & means "give me the address of score"
fmt.Println(score)         // 42 — the value
fmt.Println(p)             // 0xc0000b4008 — the memory address (yours will differ)
```

## Introducing `*` — "Follow the Address"

Now you have a pointer — an address. How do you use it? You **dereference** it with `*`. This means "go to the address and give me what's there."

```go
score := 42                // A regular int variable
p := &score                // p holds the ADDRESS of score — type *int

fmt.Println(*p)            // 42 — * means "follow the pointer, get the value"
                           // *p goes to the address p holds and reads what's there

*p = 100                   // * also lets you WRITE to the address
                           // "go to where p points, and set the value to 100"

fmt.Println(score)         // 100 — score changed! We modified it through the pointer
```

**What just happened?** We created a pointer `p` to `score`. Then we used `*p` to reach through the pointer and change `score`'s value. The pointer is like a remote control for the original variable.

::: tip The Physical Analogy
- `&` is like writing your house address on a piece of paper. It doesn't move your house — it just creates a reference to where your house is.
- `*` is like reading that piece of paper, driving to the address, and walking into the house. You're now interacting with the real thing.
:::

Let's see both operators together in one flow:

```go
name := "Alice"            // A string variable — name holds "Alice"
ptr := &name               // ptr holds the address of name — type *string
                           // Think: ptr = "the address where name lives"

fmt.Println(name)          // "Alice" — reading the variable directly
fmt.Println(*ptr)          // "Alice" — reading through the pointer (same value!)

*ptr = "Bob"               // Write through the pointer — changes the original
fmt.Println(name)          // "Bob" — name was changed via the pointer!
fmt.Println(*ptr)          // "Bob" — the pointer still sees the same address, new value
```

<div class="checkpoint">

#### Checkpoint
- `&variable` gives you a pointer (the address of the variable).
- `*pointer` follows the pointer to read or write the value at that address.
- `*Type` (in a type position) means "pointer to Type" — it's a type, not an operation.
</div>

## The Confusing Part: `*` Has Two Meanings

Here's where people get tripped up. The `*` symbol means different things depending on where you use it:

| Context | Syntax | Meaning | Example |
|---|---|---|---|
| In a **type** | `*string` | "pointer to string" — this is a type | `var p *string` |
| In a **type** | `*User` | "pointer to User" — this is a type | `func f(u *User)` |
| In an **expression** | `*ptr` | "follow this pointer" — dereference | `fmt.Println(*ptr)` |
| In an **expression** | `*ptr = 5` | "write to what this pointer points at" | `*ptr = 5` |

And `&` always means one thing:

| Context | Syntax | Meaning | Example |
|---|---|---|---|
| In an **expression** | `&variable` | "give me the address" | `p := &score` |

```go
var p *int                 // Declare p as type *int (pointer to int) — currently nil
                           // The * here means "pointer to"

x := 42                   // A regular int
p = &x                    // & gives us the address of x, now p points to x

fmt.Println(*p)            // 42 — the * here means "follow the pointer"
                           // Different meaning of * than in the type declaration!
```

**What just happened?** Same symbol, two jobs. In `*int`, the `*` is part of the type name — it says "this is a pointer." In `*p`, the `*` is an operation — it says "follow this pointer." Context tells you which is which: if `*` is next to a type name, it's declaring a pointer type. If it's next to a variable, it's dereferencing.

## Fixing Our Original Problem

Now we can fix the `promote` function. Instead of receiving a copy, it receives a pointer:

```go
func promote(u *User) {    // u is a *User — a pointer to a User
    u.Role = "admin"       // Go auto-dereferences: this actually means (*u).Role = "admin"
}                          // But you NEVER need to write (*u) — Go handles it
```

```go
alice := User{             // Create a User value
    Name: "Alice",         // Set Name
    Role: "viewer",        // Set Role
}                          // alice is a User (not a pointer)

promote(&alice)            // & gives the function alice's ADDRESS, not a copy
fmt.Println(alice.Role)    // "admin" — the original was modified!
```

**What just happened?** We passed `&alice` — the address of alice — to `promote`. The function received a pointer (`*User`) and was able to modify the original. This is how Go gives you what JavaScript does automatically for objects, but only when you explicitly ask for it.

::: info Auto-Dereference Magic
You probably noticed that inside `promote`, we wrote `u.Role` and not `(*u).Role`. Go automatically dereferences pointers when you access struct fields. This is a huge convenience — you almost never need to explicitly write `*` when working with struct pointers. `u.Role` and `(*u).Role` are identical; everyone writes the short form.
:::

Now let's compare the two approaches side by side:

```go
// VALUE receiver — gets a copy, can't modify the original
func getName(u User) string {  // u is a User value — a full copy
    return u.Name              // Reads from the copy (fine for reading!)
}                              // The copy is discarded

// POINTER receiver — gets an address, CAN modify the original
func promote(u *User) {        // u is a *User — a pointer to the original
    u.Role = "admin"           // Modifies the original User
}                              // The original is changed
```

::: code-group
```ts [TypeScript]
// TypeScript — objects are ALWAYS references
function getName(user: User): string {  // This is a reference to the original
  return user.name;                      // Reading is fine
}

function promote(user: User): void {    // This is ALSO a reference to the original
  user.role = "admin";                   // This ALWAYS mutates — you can't prevent it
}
```

```go [Go]
// Go — you CHOOSE value or pointer
func getName(u User) string {  // Copy — safe, can't mutate
    return u.Name              // Read from the copy
}

func promote(u *User) {       // Pointer — can mutate the original
    u.Role = "admin"           // Modifies the original
}
```
:::

<div class="checkpoint">

#### Checkpoint
You can pass `&variable` to give a function a pointer, allowing it to modify the original value. Go auto-dereferences struct pointers, so `ptr.Field` works without writing `(*ptr).Field`.
</div>

## `nil` Pointers — The Equivalent of `null`

A pointer that doesn't point to anything has the value `nil`. This is Go's version of JavaScript's `null`:

```go
var ptr *User              // Declared but not assigned — ptr is nil
fmt.Println(ptr)           // <nil> — it points to nothing
fmt.Println(ptr == nil)    // true — you can check for nil
```

Here's the dangerous part:

```go
var ptr *User              // nil pointer — points to nothing
fmt.Println(ptr.Name)      // RUNTIME PANIC! 💥
                           // "nil pointer dereference" — Go's version of
                           // "Cannot read properties of null"
```

This should feel familiar. In JavaScript:

```ts
// TypeScript/JavaScript equivalent
const user: User | null = null;  // user is null
console.log(user.name);          // TypeError: Cannot read properties of null
```

Same idea, same consequences. The fix is the same too — check before you use:

```go
func printUser(u *User) {     // u might be nil — we need to check
    if u == nil {              // Guard against nil pointer
        fmt.Println("no user") // Handle the nil case gracefully
        return                 // Return early — don't try to use u
    }                          // If we get past here, u is safe to use
    fmt.Println(u.Name)        // Now we know u is not nil
}
```

::: warning
A nil pointer dereference in Go is a **runtime panic** — your program crashes immediately. Unlike JavaScript where `undefined.something` throws a catchable error, Go panics are harder to recover from. Always guard pointer parameters from external sources against nil.
:::

<div class="checkpoint">

#### Checkpoint
A pointer can be `nil` (pointing to nothing). Accessing a field on a nil pointer causes a runtime panic. Always check `if ptr == nil` before using pointers that come from function parameters, struct fields, or map lookups.
</div>

## When to Use Pointers — The Practical Guide

Here's the good news: in BFF code, you don't need to agonize about pointers. There are only a handful of situations where they come up, and the patterns are predictable.

### 1. Method Receivers — Almost Always Pointers

When you define methods on a struct, use a pointer receiver (`*App`) so the method can access the struct's state without copying it:

```go
type App struct {                  // App holds shared state: logger, config, clients
    logger *slog.Logger            // A pointer to the logger (shared, never copied)
    config *EnvConfig              // A pointer to the config (shared, never copied)
}

// Pointer receiver — app is shared, not copied
func (app *App) HealthCheck(       // (app *App) means "this method belongs to *App"
    w http.ResponseWriter,         // w is where we write the HTTP response
    r *http.Request,               // r is the incoming HTTP request (already a pointer!)
    ps httprouter.Params,          // ps holds URL parameters
) {
    app.logger.Info("health check") // Access the shared logger through the pointer
    app.WriteJSON(w, 200, map[string]string{"status": "ok"}, nil)
}                                   // app was never copied — fast, memory-efficient
```

**What just happened?** The `(app *App)` receiver means this method gets a pointer to the `App`, not a copy. Since `App` holds loggers, config, and clients, you never want to copy it.

::: tip The Rule
If a struct has any method with a pointer receiver, **all** methods on that struct should use pointer receivers. This is a Go convention that prevents subtle bugs (mixing pointer and value receivers can cause unexpected behavior).
:::

### 2. Large Structs — Avoid Expensive Copies

When a struct is large, copying it on every function call wastes memory and CPU:

```go
type Config struct {               // Imagine this has 20+ fields
    Port          int              // Each field gets copied in a value pass
    Host          string           // String copying is cheap, but...
    AllowedOrigins []string        // Slices are reference types anyway, but the header copies
    TLSCert       string           // Large strings get copied
    // ... 15 more fields ...
}

// BAD — copies the ENTIRE Config struct every call
func processConfig(c Config) {     // c is a copy — all 20+ fields duplicated
    fmt.Println(c.Port)            // Works, but wasteful
}

// GOOD — passes just an 8-byte pointer, regardless of struct size
func processConfig(c *Config) {    // c is a pointer — only 8 bytes
    fmt.Println(c.Port)            // Same access syntax, way cheaper
}
```

### 3. Optional JSON Fields — Pointer Means "Nullable"

This is where pointers really shine in BFF code. In TypeScript, you use `?` to make a field optional. In Go, you use a pointer:

```ts
// TypeScript — optional fields
interface UpdateRequest {
  name?: string;          // undefined means "not provided"
  description?: string;   // undefined means "not provided"
}

// Is name "" (empty string) or not provided?
// With ?, it's clear: undefined = not provided, "" = intentionally empty
```

```go
type UpdateRequest struct {                            // Go equivalent of the TS interface
    Name        *string `json:"name,omitempty"`        // *string can be nil (not provided)
                                                       // or point to "" (intentionally empty)
    Description *string `json:"description,omitempty"` // Same — nil vs empty are different
}
```

Why does this matter? Because a regular `string` in Go can only be `""` — there's no `undefined`. So you can't tell the difference between "the user sent an empty string" and "the user didn't send this field at all." A `*string` gives you three states.

One gotcha: Go can't take the address of a string literal directly. You can't write `&"John"` — it's a compile error. You need an intermediate variable:

```go
// Setting a *string field — you need a variable first
name := "John"                         // Create a regular string variable
req := UpdateRequest{
    Name: &name,                       // &name gives you a *string
}
// Name: &"John" would NOT compile — Go can't take the address of a literal
```

Now you can check whether the field was provided:

```go
// Using the optional field
func handleUpdate(req UpdateRequest) {  // req has pointer fields
    if req.Name != nil {                // nil means "not provided"
        fmt.Println("Name:", *req.Name) // *req.Name dereferences to get the string
                                        // Could be "" (intentionally empty)
    } else {
        fmt.Println("Name not provided") // nil — the field wasn't in the JSON
    }
}
```

::: code-group
```ts [TypeScript]
// TypeScript optional field handling
function handleUpdate(req: UpdateRequest) {
  if (req.name !== undefined) {   // undefined means "not sent"
    console.log("Name:", req.name); // could be "" (empty string)
  } else {
    console.log("Name not provided");
  }
}
```

```go [Go]
// Go pointer field handling
func handleUpdate(req UpdateRequest) {  // req has *string fields
    if req.Name != nil {                // nil means "not sent"
        fmt.Println("Name:", *req.Name) // dereference to get the actual string
    } else {                            // nil — this field wasn't in the JSON
        fmt.Println("Name not provided")
    }
}
```
:::

### 4. Factory Functions — Return Pointers by Convention

Go has no constructors, but the convention is to write `NewXxx` functions that return pointers:

```go
func NewApp(                       // NewApp is a factory function — like a constructor
    config *EnvConfig,             // Accepts a pointer to config (shared, not copied)
    logger *slog.Logger,           // Accepts a pointer to the logger (shared)
) *App {                           // Returns a *App — a pointer to the new App
    return &App{                   // & creates the struct AND returns its address
        config: config,            // Store the config pointer
        logger: logger,            // Store the logger pointer
    }                              // &App{...} = "create this, give me its address"
}
```

**What just happened?** `&App{...}` is a Go shortcut: create a struct literal and immediately take its address. You'll see this pattern everywhere — it's the standard way to create and return struct pointers.

```go
// Using the factory
app := NewApp(cfg, logger)         // app is a *App — pointer to the new App
app.HealthCheck(w, r, ps)          // Call methods on it — Go auto-dereferences
```

<div class="checkpoint">

#### Checkpoint
The four main uses of pointers in BFF code:
1. **Method receivers** (`func (app *App)`) — avoid copying, enable mutation
2. **Large structs** — pass `*Config` instead of `Config` to avoid copying
3. **Optional JSON fields** — `*string` distinguishes nil (absent) from `""` (empty)
4. **Factory functions** — `NewApp()` returns `*App`, using `&App{...}` syntax
</div>

## Pointer Receivers on Methods — The Full Picture

You saw method receivers in [Functions & Methods](./functions-and-methods). Let's see the pointer vs value distinction clearly:

```go
type Counter struct {              // A simple struct with a count field
    count int                      // count is unexported (lowercase)
}

// POINTER receiver — can modify the struct
func (c *Counter) Increment() {    // c is a *Counter — a pointer to the original
    c.count++                      // Modifies the ORIGINAL counter
}                                  // The change persists after the method returns

// VALUE receiver — works on a copy
func (c Counter) Value() int {     // c is a Counter — a COPY of the original
    return c.count                 // Reads from the copy (fine — we're just reading)
}                                  // The copy is discarded
```

```go
counter := Counter{count: 0}      // Create a Counter with count = 0
counter.Increment()                // Go automatically takes &counter for pointer receiver
counter.Increment()                // Increment again — the original changes each time
fmt.Println(counter.Value())       // 2 — Value reads the current count
```

**What just happened?** Notice that we called `counter.Increment()` on a *value*, not a pointer. Go is smart enough to automatically take the address when you call a pointer receiver method on a value. You don't need to write `(&counter).Increment()`. This is another convenience that makes pointers less scary in practice.

But the reverse doesn't work as cleanly:

```go
counter := Counter{count: 0}      // A value, not a pointer
counter.Increment()                // Go auto-takes address — works!

ptr := &Counter{count: 0}         // A pointer
ptr.Value()                        // Go auto-dereferences — works!
ptr.Increment()                    // Pointer calling pointer method — works!
```

::: tip
Go handles the `&` and `*` automatically when calling methods. You almost never need to manually convert between a value and a pointer for method calls. Just define the right receiver type and Go does the rest.
:::

## A Simple Mental Model

If you're feeling overwhelmed, here's everything you need to remember, boiled down:

1. **Declaring a pointer type**: `*Type` means "pointer to Type."
   - `*User` = "I hold the address of a User"
   - `*string` = "I hold the address of a string"

2. **Creating a pointer**: `&value` gives you a pointer to that value.
   - `&alice` = "the address where alice lives"
   - `&App{...}` = "create this struct and give me its address"

3. **Using a pointer**: `*ptr` follows the pointer to the value.
   - `*ptr` = "go to the address and get what's there"
   - But for struct fields, Go auto-dereferences: `ptr.Name` just works

4. **Nil**: A pointer can be `nil` (points to nothing). Check before using.

```go
user := &User{Name: "Alice"}      // Create a User, take its address
                                   // user is *User — a pointer

fmt.Println(user.Name)             // "Alice" — auto-dereference (no * needed!)

var other *User                    // Declared but not assigned — other is nil
if other == nil {                  // Always check before using
    fmt.Println("no user")
}
```

## The 80/20 Rule

Here's the most reassuring thing I can tell you: **in BFF code, pointers show up in only a few predictable places:**

```go
// 1. Method receivers — you'll see this on every handler
func (app *App) MyHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    // app is always *App                                                              // ← pointer
}

// 2. Factory functions — creating your App and services
func NewApp(config *EnvConfig, logger *slog.Logger) *App {                             // ← pointers
    return &App{config: config, logger: logger}                                        // ← & to create
}

// 3. Optional JSON fields — in your request/response DTOs
type UpdateRequest struct {
    Name *string `json:"name,omitempty"`                                               // ← *string
}

// 4. http.Request is always a pointer
func handler(w http.ResponseWriter, r *http.Request) {                                 // ← *http.Request
    // r is a pointer to the request — standard Go pattern
}
```

That's it. That covers about 80% of the pointers you'll encounter. You don't need to deeply understand memory layout or pointer arithmetic (Go doesn't even have pointer arithmetic). You just need to recognize these four patterns and know why they exist.

## Quick Reference

```go
// === Creating ===
x := 42                            // x is an int with value 42
p := &x                            // p is *int — points to x
user := &User{Name: "Alice"}       // Create struct + take address in one step

// === Reading ===
fmt.Println(*p)                    // 42 — follow the pointer to read the value
fmt.Println(user.Name)             // "Alice" — auto-dereference for struct fields

// === Writing ===
*p = 100                           // Write through the pointer — x is now 100
user.Name = "Bob"                  // Auto-dereference for struct fields — writes to original

// === Checking ===
var ptr *User                      // nil — doesn't point to anything
if ptr == nil {                    // Always check before using
    fmt.Println("no user")         // Handle the nil case
}

// === In function signatures ===
func read(u User) string           // Value — receives a copy
func write(u *User)                // Pointer — receives the original
func create() *User                // Returns a pointer — common factory pattern
```

::: tip Key Takeaway
Pointers let you share data by reference in a language where everything defaults to copying. Use `&` to create a pointer ("give me the address") and `*` to dereference ("follow the address"). In BFF code, you'll primarily use pointers for method receivers (`func (app *App)`), factory return values (`func NewApp() *App`), optional JSON fields (`*string`), and `*http.Request`. Go auto-dereferences struct field access, so `ptr.Field` just works. Always check for `nil` before using a pointer from external input.
:::

::: info See Also
- [Structs](./structs) — the types you'll most often use with pointers
- [Functions & Methods](./functions-and-methods) — pointer vs value receivers
- [JSON](./json) — using `*string` for optional JSON fields
- [Interfaces](./interfaces) — interfaces can hold both values and pointers
:::
