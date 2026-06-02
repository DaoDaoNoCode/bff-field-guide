# Packages & Modules — Go's Module System

> **Go Concept:** Packages organize code into reusable units, and modules manage dependencies — like npm packages but with a few important twists.

You know `export default` and `import { X } from './file'`. You know `package.json` and `node_modules`. You know how to `npm install` a dependency and import it. Go's module system solves the same problems, but the mechanics look completely different.

The two biggest shocks for JavaScript developers:
1. **There's no `export` keyword.** Visibility is controlled by capitalization. Yes, really.
2. **There are no relative imports.** Every import uses the full module path. Always.

Let's work through these one at a time.

## The Package Declaration — Every File Has One

In JavaScript, every file is a module by default. You just start writing code. In Go, every file begins with a `package` declaration that says which package this file belongs to:

```go
package utils                                  // This file belongs to the "utils" package
                                               // Every file in this directory must say the same thing
```

::: code-group
```ts [TypeScript]
// utils.ts — no package declaration needed
// The file IS the module
export function formatDate(d: Date): string {  // Export makes it public
  return d.toISOString();                      // Return the formatted date
}
```

```go [Go]
// utils.go — must start with package declaration
package utils                                  // This file belongs to package "utils"

import "time"                                  // Import the standard library time package

func FormatDate(t time.Time) string {          // Capital F = exported (public)
    return t.Format(time.RFC3339)              // Return the formatted time
}
```
:::

**What just happened?** In TypeScript, the file name *is* the module. In Go, the `package` declaration groups files together. All `.go` files in the same directory must declare the same package name. Think of a Go package as a directory-level namespace.

::: warning
Every `.go` file in the same directory must have the same `package` declaration. You can't have `package api` and `package handlers` in the same folder. One directory = one package.
:::

### The Special `main` Package

There's one special package name: `main`. A package named `main` with a function named `main()` is an executable program's entry point:

```go
package main                                   // Special name — this is an executable program

import "fmt"                                   // Import the "fmt" package for printing

func main() {                                 // Special function — the entry point
    fmt.Println("Hello, World!")               // Print to stdout
}                                              // When main() returns, the program exits
```

::: code-group
```ts [TypeScript]
// index.ts — entry point by convention (configured in package.json)
console.log("Hello, World!");                  // No special function name needed
```

```go [Go]
// main.go — entry point by declaration
package main                                   // Must be "main"

func main() {                                 // Must be called "main"
    fmt.Println("Hello, World!")               // The program starts here
}
```
:::

In the BFF codebase, the entry point lives at `bff/cmd/main.go`:

```go
package main                                   // Executable entry point

import (                                       // Import block — groups all imports
    "flag"                                     // Standard library: command-line flag parsing
    "fmt"                                      // Standard library: formatted I/O
    "log/slog"                                 // Standard library: structured logging
    "os"                                       // Standard library: OS interaction
)

func main() {                                 // Entry point — sets up and starts the server
    port := flag.Int("port", 8080, "API port") // Define a -port flag with default 8080
    flag.Parse()                               // Parse all command-line flags

    logger := slog.New(                        // Create a structured JSON logger
        slog.NewJSONHandler(os.Stdout, nil),   // Output to stdout in JSON format
    )

    logger.Info("starting server",             // Log a startup message
        "port", *port,                         // Include the port in the log entry
    )

    // ... rest of server setup
}
```

<div class="checkpoint">

#### Checkpoint
Every Go file starts with `package name`. All files in the same directory share the same package name. The `main` package with a `main()` function is the program's entry point — like `index.ts` configured in `package.json`.
</div>

## Visibility — The Capitalization Rule

This is the single most surprising rule for TypeScript developers. Sit down for this one.

**In Go, there is no `export` keyword. There is no `private` keyword. There is no `public` keyword.**

Instead, Go uses the **first letter of the name** to determine visibility:

- **Uppercase first letter** = exported (public) — visible outside the package
- **Lowercase first letter** = unexported (private) — only visible within the package

That's it. That's the rule.

```go
package models                                 // All of this is in the "models" package

// EXPORTED — other packages can see and use these
type User struct {                             // Capital U = exported type
    ID    string                               // Capital I and D = exported field
    Name  string                               // Capital N = exported field
    Email string                               // Capital E = exported field
    age   int                                  // Lowercase a = UNEXPORTED field!
}                                              // age is private to the "models" package

// EXPORTED — other packages can call this function
func NewUser(id, name string) *User {          // Capital N = exported function
    return &User{                              // Create a new User
        ID:   id,                              // Set the exported ID field
        Name: name,                            // Set the exported Name field
        age:  0,                               // Set the unexported age field
    }                                          // Only code in "models" can set age
}

// UNEXPORTED — only callable from within the "models" package
func validate(u *User) error {                 // Lowercase v = unexported function
    if u.Name == "" {                          // Check if Name is empty
        return errors.New("name is required")  // Return an error
    }
    return nil                                 // Return nil = no error
}
```

Now look at the TypeScript equivalent to see how dramatically different the mechanism is:

::: code-group
```ts [TypeScript]
// models.ts — explicit export keywords
export interface User {                        // 'export' makes it public
  id: string;                                  // Public by default (no private on interfaces)
  name: string;
  email: string;
}

// Private — no export keyword
function validate(user: User): void {          // Not exported = private to this module
  if (!user.name) throw new Error("name required");
}

// Public — has export
export function createUser(id: string, name: string): User {
  return { id, name, email: "" };              // Exported function
}
```

```go [Go]
// models.go — capitalization controls visibility
package models                                 // Package declaration

type User struct {                             // Capital U → exported (like 'export')
    ID    string                               // Capital → exported field
    Name  string                               // Capital → exported field
    Email string                               // Capital → exported field
    age   int                                  // lowercase → unexported (like no 'export')
}

func validate(u *User) error {                 // lowercase → unexported
    if u.Name == "" {
        return errors.New("name required")
    }
    return nil
}

func NewUser(id, name string) *User {          // Capital N → exported (like 'export')
    return &User{ID: id, Name: name, age: 0}
}
```
:::

Here's the full visibility table:

| Go | TypeScript Equivalent | Visible To |
|---|---|---|
| `func Process()` | `export function process()` | Any package that imports this one |
| `func process()` | `function process()` (no export) | Only this package |
| `type Config struct` | `export type Config = {}` | Any package |
| `type config struct` | `type Config = {}` (no export) | Only this package |
| `Name string` (struct field) | `public name: string` | Any package |
| `name string` (struct field) | `private name: string` | Only this package |
| `const MaxRetries` | `export const MAX_RETRIES` | Any package |
| `const maxRetries` | `const maxRetries` (no export) | Only this package |

::: warning
This rule applies to **everything**: types, functions, methods, struct fields, constants, variables, and interface methods. If the first letter is uppercase, it's public. If it's lowercase, it's private. There are no exceptions and no escape hatches.
:::

::: tip
This means Go identifiers carry visibility information in their name. When you read Go code and see `app.WriteJSON(...)`, you instantly know `WriteJSON` is exported (public). When you see `app.serverErrorResponse(...)`, you know it's unexported (private). Once you're used to it, this is actually really nice — visibility is always visible.
:::

<div class="checkpoint">

#### Checkpoint
Go has no `export` keyword. Uppercase first letter = exported (public). Lowercase first letter = unexported (private to the package). This applies to types, functions, struct fields, constants — everything.
</div>

## Modules and `go.mod` — The `package.json` of Go

A Go **module** is a collection of packages versioned together, defined by a `go.mod` file. This is Go's equivalent of `package.json`:

### Creating a Module

```bash
# TypeScript — initialize a project
npm init -y                                    # Creates package.json

# Go — initialize a module
go mod init github.com/myorg/myproject         # Creates go.mod
```

### Reading a `go.mod` File

Let's look at a real `go.mod` from the BFF codebase and compare it to `package.json`:

::: code-group
```json [package.json]
{
  "name": "@odh-dashboard/gen-ai",
  "version": "0.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "@kubernetes/client-node": "^0.21.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

```text [go.mod]
module github.com/opendatahub-io/gen-ai
// ↑ Module path — like "name" in package.json, but it's the full import path

go 1.24
// ↑ Minimum Go version — like "engines" in package.json (check bff/go.mod for current version)

require (
// ↑ Dependencies — like "dependencies" in package.json
    github.com/julienschmidt/httprouter v1.3.0
//  ↑ Module path                      ↑ Exact version (no ^ or ~)
    k8s.io/client-go v0.32.3
    sigs.k8s.io/controller-runtime v0.20.4
)
```
:::

Let's walk through each line:

```text
module github.com/opendatahub-io/gen-ai
```
The **module path** is the canonical import path for this module. It's usually a URL (like a GitHub path), but Go doesn't actually download from this URL — it uses the Go module proxy. Think of it as the module's globally unique name.

```text
go 1.24.0
```
The minimum **Go version** required. Like the `engines` field in `package.json`, but the Go toolchain actually enforces it.

```text
require (
    github.com/julienschmidt/httprouter v1.3.0
    k8s.io/client-go v0.32.3
)
```
**Dependencies** — each one lists the module path and an exact version. Key differences from `package.json`:

- **No `^` or `~` ranges** — versions are exact
- **No `devDependencies`** — Go doesn't distinguish between dev and production deps

### `go.sum` — The Lockfile (and Why You Need It)

You might wonder: if `go.mod` already pins exact versions, why do you need a lockfile? Because **a version tag is just a label** — it doesn't guarantee the code behind it is the same code you downloaded yesterday.

`go.sum` records cryptographic hashes of every dependency's content. When Go downloads a dependency, it computes a hash of what it got and compares it against `go.sum`. If they don't match, the build fails:

```text
# go.sum — each line is a module + version + hash
github.com/julienschmidt/httprouter v1.3.0 h1:U0609e9tgbseu3rBINet9P48AI/D3oJs4dN7jwJOQ1U=
github.com/julienschmidt/httprouter v1.3.0/go.mod h1:JR6WtHb+2LUe8TCKY3cZOxFyyO8IZAc4RVcycCCAKdM=
```

This is similar to the `integrity` hashes in `package-lock.json`. The difference is that Go has multiple layers of protection for public modules:

1. **Module proxy** (`proxy.golang.org`) — caches the first version it sees. Once `v1.3.0` is cached, even the author can't replace it by force-pushing a tag
2. **Checksum database** (`sum.golang.org`) — a public, append-only log of hashes. Go verifies your download against this global record
3. **`go.sum`** — your local record, the last line of defense if anything slips past the above

For public modules, layers 1 and 2 already make tampering nearly impossible. `go.sum` is the insurance policy on top. If it ever complains in a real project, that's genuinely suspicious — don't just blindly re-generate it.

::: tip What about packages in the same repo?
`go.sum` only tracks **external dependencies** — things Go fetches from the network. Your own packages (like `internal/utils` or `cmd/server`) are just local folders. Go compiles them directly from source, no downloading or hashing involved. That's why they don't appear in `go.mod`'s `require` block either — they're part of the module itself, not dependencies.
:::

**You never manually edit `go.sum`.** It's auto-generated. When you add, remove, or update dependencies (via `go mod tidy` or `go get`), `go.sum` updates automatically. Both `go.mod` and `go.sum` get committed to git.

<div class="checkpoint">

#### Checkpoint
`go.mod` is Go's `package.json`. It declares the module path (the import path), the Go version, and dependencies. Versions are exact — no `^` or `~`. `go.sum` records cryptographic hashes of every external dependency, ensuring the code you download is identical to what was originally published. You never edit `go.sum` by hand — it updates automatically.
</div>

## Import Paths — No Relative Imports

This is another big shift from TypeScript. Go imports always use the **full module path**. There are no relative imports:

```go
import (
    // === Standard library — no URL prefix ===
    "encoding/json"                            // JSON encoding/decoding
    "fmt"                                      // Formatted I/O (printing)
    "net/http"                                 // HTTP client and server
    "log/slog"                                 // Structured logging
    "context"                                  // Request-scoped values, cancellation

    // === Third-party packages — full URL ===
    "github.com/julienschmidt/httprouter"      // HTTP router (third-party)

    // === Internal packages — full module path ===
    "github.com/opendatahub-io/gen-ai/internal/api"
    //                                                                    ↑ Package name
    "github.com/opendatahub-io/gen-ai/internal/config"
    "github.com/opendatahub-io/gen-ai/internal/models"
)
```

::: code-group
```ts [TypeScript]
// TypeScript — mix of relative and package imports
import { User } from './models/user';          // Relative import — ./
import { validate } from '../utils/validation'; // Relative import — ../
import express from 'express';                  // Package import — node_modules
```

```go [Go]
// Go — always full paths, never relative
import "fmt"                                   // Standard library (no URL)
import "github.com/julienschmidt/httprouter"   // Third-party (full URL)
import "github.com/myorg/myproject/internal/models" // Internal package (full path)

// You CANNOT write:
// import "./models"     ← COMPILE ERROR — no relative imports in Go
// import "../utils"     ← COMPILE ERROR
```
:::

**What just happened?** Go imports are absolute paths — always the full module path. This feels verbose, but it eliminates ambiguity. You always know exactly where a package comes from, no matter which file you're reading.

### Import Organization Convention

Go developers organize imports into groups separated by blank lines. The convention is: standard library first, then third-party, then internal:

```go
import (
    // Standard library
    "encoding/json"                            // Built-in JSON handling
    "fmt"                                      // Built-in printing
    "net/http"                                 // Built-in HTTP

    // Third-party packages
    "github.com/julienschmidt/httprouter"      // HTTP router

    // Internal packages (your own code)
    "github.com/opendatahub-io/gen-ai/internal/api"
    "github.com/opendatahub-io/gen-ai/internal/models"
)
```

::: tip
`goimports` (or `go fmt`) automatically organizes your imports into these groups and removes unused imports. You don't need to manually maintain this order — your editor handles it.
:::

::: warning
Go has no relative imports. You can't write `import "./models"`. Always use the full module path. This feels verbose, but IDE auto-complete handles it, and it makes every import unambiguous — you always know exactly where a package comes from.
:::

<div class="checkpoint">

#### Checkpoint
Go imports always use full module paths — no `./` or `../` relative paths. Group imports as: standard library, third-party, internal. Your editor's Go tooling auto-organizes them.
</div>

## The Standard Library — Your Built-In Toolkit

Go's standard library is extensive and high-quality. You'll use it heavily in BFF development — much more than you might use Node.js built-in modules. Here are the packages you'll encounter daily:

| Package | Purpose | TypeScript/Node Equivalent |
|---|---|---|
| `fmt` | Formatted I/O, printing, string formatting | `console.log`, template literals |
| `net/http` | HTTP client and server — yes, built-in! | `express`, `fetch` — you need npm packages |
| `encoding/json` | JSON marshal/unmarshal | `JSON.stringify()`, `JSON.parse()` |
| `os` | Environment variables, file I/O, process info | `process.env`, `fs` module |
| `log/slog` | Structured logging with levels | `pino`, `winston` — you need npm packages |
| `context` | Request-scoped values, cancellation, timeouts | `AbortController` (partial equivalent) |
| `errors` | Error creation and wrapping | `Error` class |
| `strconv` | String/number conversions | `parseInt()`, `Number()`, `String()` |
| `strings` | String manipulation (split, join, contains, etc.) | `String.prototype` methods |
| `time` | Time, duration, formatting, timers | `Date`, `setTimeout` |
| `testing` | Built-in test framework | `jest` — you need npm packages |
| `net/http/httptest` | HTTP test utilities | `supertest` — you need npm packages |

```go
import (
    "encoding/json"                            // No npm install needed!
    "fmt"                                      // No npm install needed!
    "log/slog"                                 // No npm install needed!
    "net/http"                                 // No npm install needed!
    "os"                                       // No npm install needed!
    "strings"                                  // No npm install needed!
    "testing"                                  // No npm install needed!
)
```

**What just happened?** All of these are built into Go. No `npm install`, no `node_modules`, no version conflicts. Go's standard library covers HTTP servers, JSON handling, testing, logging, and more — all without third-party dependencies.

::: info Coming from Node
In Node.js, you need `express` (or `fastify`) for HTTP, `jest` for testing, `pino` for logging, etc. In Go, `net/http`, `testing`, and `log/slog` are all built-in. This dramatically reduces your dependency tree and simplifies security auditing.
:::

## The `internal/` Convention — Compiler-Enforced Privacy

Go has a special rule that JavaScript developers find pleasantly surprising: packages inside an `internal/` directory can **only** be imported by code in the parent tree. This isn't just a convention — the **compiler enforces it**.

```text
bff/
├── cmd/
│   └── main.go            # package main — CAN import internal/
├── internal/
│   ├── api/               # package api
│   │   ├── app.go         # App struct, NewApp, Routes
│   │   └── handlers.go    # Handler methods
│   ├── config/            # package config
│   │   └── config.go      # EnvConfig struct
│   ├── models/            # package models
│   │   └── models.go      # DTOs
│   └── integrations/      # package integrations
│       └── kubernetes/    # package kubernetes
│           └── client.go  # K8s client
└── go.mod
```

```go
// bff/cmd/main.go
package main                                   // Inside bff/ — parent of internal/

import (
    "github.com/.../bff/internal/api"          // ✅ ALLOWED — main.go is inside bff/
    "github.com/.../bff/internal/config"       // ✅ ALLOWED — same parent tree
)
```

```go
// some-other-module/main.go
package main                                   // Outside bff/ entirely

import (
    "github.com/.../bff/internal/api"          // ❌ COMPILE ERROR — not in the parent tree!
)                                              // The compiler blocks this import
```

::: code-group
```ts [TypeScript]
// TypeScript — no compiler enforcement of package boundaries
// You'd use ESLint rules or barrel files, but nothing stops a rogue import
// Any file can import from any other file
import { App } from '../../other-package/src/internal/app';
// ↑ This works — TypeScript won't stop you
```

```go [Go]
// Go — the compiler ENFORCES internal/ privacy
import "github.com/.../bff/internal/api"
// ↑ This FAILS TO COMPILE if you're not in the parent tree
// No configuration needed — the compiler just knows
```
:::

**What just happened?** The `internal/` directory is Go's way of saying "this code is truly private — not just by convention, but enforced by the build tool." In TypeScript, you might use ESLint import restrictions or barrel files to achieve similar boundaries, but they're all opt-in and bypassable. Go's `internal/` is enforced at compile time.

::: tip
The BFF codebase puts almost everything in `internal/`. This means the BFF's API handlers, models, config, and integrations are all private to the BFF module. No other module in the monorepo can import them. This is intentional — it keeps the BFF's internal implementation details locked down.
:::

<div class="checkpoint">

#### Checkpoint
Code inside an `internal/` directory can only be imported by code in the parent directory tree. The compiler enforces this — no configuration needed. The BFF codebase uses `internal/` to keep its implementation details truly private.
</div>

## `go mod tidy` — npm prune + npm install in One Command

After adding or removing imports, you run `go mod tidy` to clean up your `go.mod` and `go.sum`:

```bash
go mod tidy                                    # Does three things at once:
                                               # 1. Adds missing dependencies
                                               # 2. Removes unused dependencies
                                               # 3. Updates go.sum with correct hashes
```

::: code-group
```bash [TypeScript / npm]
npm install                                    # Install missing dependencies
npm prune                                      # Remove unused dependencies
# Two commands to do what Go does in one
```

```bash [Go]
go mod tidy                                    # Does both at once
# One command to rule them all
```
:::

**When to run `go mod tidy`:**
- After adding a new `import` statement in your code
- After removing imports you no longer use
- After changing your `go.mod` manually
- When CI complains about `go.sum` being out of sync

::: info
Unlike `npm install`, you don't need to explicitly `go get` packages before importing them. Just write the `import` statement, run `go mod tidy`, and Go downloads and adds the dependency automatically. However, `go get` is still available for explicitly adding or upgrading specific packages.
:::

## Other Useful Go Commands

Here's a command comparison table for your reference:

| Go Command | What It Does | npm Equivalent |
|---|---|---|
| `go mod init <path>` | Create a new module (generates `go.mod`) | `npm init` |
| `go mod tidy` | Sync dependencies (add missing, remove unused) | `npm install` + `npm prune` |
| `go get <package>` | Add or upgrade a specific dependency | `npm install <package>` |
| `go build ./...` | Compile all packages (catch errors) | `npm run build` |
| `go run ./cmd` | Compile and run the program | `npx ts-node index.ts` |
| `go test ./...` | Run all tests recursively | `npm test` |
| `go vet ./...` | Static analysis (catches common mistakes) | `eslint` (partial) |
| `go fmt ./...` | Format all code (opinionated, no config) | `prettier --write` |
| `go doc <package>` | View package documentation | N/A (use website or IDE) |

```bash
# Common development workflow
go build ./...                                 # Check if everything compiles
go test ./...                                  # Run all tests
go vet ./...                                   # Run static analysis
go fmt ./...                                   # Format all code
go mod tidy                                    # Clean up dependencies
```

::: tip
`go fmt` is opinionated and configurationless — there's no `.prettierrc` equivalent. All Go code worldwide is formatted the same way. This eliminates formatting debates and makes all Go code instantly readable.
:::

## Package Organization in the BFF

Here's how the BFF codebase organizes its packages. Each directory is a package, and each package has a single responsibility:

```text
bff/
├── cmd/                       # package main — the executable entry point
│   ├── main.go                # Flag parsing, logger setup, server start
│   └── helpers.go             # Helper functions (getEnvAsInt, etc.)
├── internal/                  # Everything below is PRIVATE to this module
│   ├── api/                   # package api — HTTP handlers and routing
│   │   ├── app.go             # App struct, NewApp(), Routes()
│   │   ├── models_handler.go  # Handler for /models endpoints
│   │   ├── health_handler.go  # Handler for /healthcheck
│   │   ├── middleware.go      # Auth, CORS, logging middleware
│   │   └── errors.go          # Error response helpers
│   ├── config/                # package config — configuration
│   │   └── config.go          # EnvConfig struct and loading
│   ├── constants/             # package constants — path constants
│   │   └── paths.go           # API path constants
│   ├── integrations/          # package integrations — external service clients
│   │   ├── kubernetes/        # package kubernetes — K8s API client
│   │   │   └── client.go      # Real and mock K8s clients
│   │   └── httpclient/        # package httpclient — HTTP client wrapper
│   │       └── client.go      # HTTP client for upstream APIs
│   ├── models/                # package models — data transfer objects
│   │   └── models.go          # Request/response DTOs
│   ├── repositories/          # package repositories — business logic
│   │   └── models.go          # Model fetching and transformation
│   └── mocks/                 # package mocks — test mocks
│       └── mocks.go           # Mock implementations for testing
├── go.mod                     # Module definition
├── go.sum                     # Dependency checksums (lockfile)
└── Makefile                   # Build and run commands
```

**What just happened?** This is the standard Go project layout for a service. Notice how:
- `cmd/` contains the executable entry point
- `internal/` contains all implementation details
- Each subdirectory of `internal/` is a focused package
- The naming follows Go conventions: short, lowercase, descriptive

Let's see how these packages import each other:

```go
// bff/cmd/main.go
package main                                   // The entry point

import (
    "log/slog"                                 // Standard library
    "os"                                       // Standard library

    // Internal packages — note the full paths
    "github.com/opendatahub-io/gen-ai/internal/api"
    "github.com/opendatahub-io/gen-ai/internal/config"
)

func main() {                                 // Entry point
    cfg := config.NewEnvConfig()               // Use the config package
    logger := slog.New(                        // Standard library logger
        slog.NewJSONHandler(os.Stdout, nil),   // JSON output
    )
    app := api.NewApp(cfg, logger)             // Use the api package
    // ... start server
}
```

```go
// bff/internal/api/app.go
package api                                    // The api package

import (
    "log/slog"                                 // Standard library

    "github.com/julienschmidt/httprouter"      // Third-party router

    // Sibling internal packages
    "github.com/opendatahub-io/gen-ai/internal/config"
    "github.com/opendatahub-io/gen-ai/internal/models"
)

type App struct {                              // The core application struct
    config *config.EnvConfig                   // Config from the config package
    logger *slog.Logger                        // Logger from the standard library
    router *httprouter.Router                  // Router from third-party package
}

func NewApp(                                   // Factory function
    cfg *config.EnvConfig,                     // Accepts config from the config package
    logger *slog.Logger,                       // Accepts a standard library logger
) *App {                                       // Returns a pointer to App
    return &App{                               // Create and return
        config: cfg,                           // Store the config
        logger: logger,                        // Store the logger
        router: httprouter.New(),              // Create a new router
    }
}
```

<div class="checkpoint">

#### Checkpoint
The BFF follows Go's standard project layout: `cmd/` for entry points, `internal/` for private code, and focused packages for each responsibility (api, config, models, integrations). Packages import each other using full module paths.
</div>

## Quick Reference

```go
// === Package declaration ===
package main                                   // Entry point package
package api                                    // A regular package

// === Visibility ===
func Process() {}                              // Uppercase = exported (public)
func process() {}                              // Lowercase = unexported (private)
type User struct {}                            // Exported type
type user struct {}                            // Unexported type
const MaxRetries = 3                           // Exported constant
const maxRetries = 3                           // Unexported constant

// === Imports ===
import "fmt"                                   // Standard library
import "github.com/pkg/errors"                 // Third-party
import "mymodule/internal/api"                 // Internal package

// === Grouped imports (conventional ordering) ===
import (
    "fmt"                                      // stdlib first
    "net/http"

    "github.com/julienschmidt/httprouter"      // third-party second

    "mymodule/internal/api"                    // internal last
)

// === Module commands ===
// go mod init github.com/myorg/project        Create a module
// go mod tidy                                  Sync dependencies
// go get github.com/some/package              Add a dependency
// go build ./...                               Compile everything
// go test ./...                                Test everything
// go fmt ./...                                 Format everything
```

::: tip Key Takeaway
Every Go file starts with `package name`. Uppercase names are exported (public), lowercase are unexported (private) — no `export` keyword needed. Modules are defined by `go.mod` (like `package.json`), with exact version dependencies. Imports always use full module paths — no relative `./` or `../` imports. The `internal/` directory provides compiler-enforced encapsulation. Run `go mod tidy` to keep dependencies in sync. The standard library covers HTTP, JSON, testing, and logging without any `npm install`.
:::

::: info See Also
- [Structs](./structs) — exported vs unexported struct fields
- [Interfaces](./interfaces) — exported interfaces define your public API
- [Testing](./testing) — test files use the same package (or `_test` suffix)
- [HTTP Servers](./http) — importing `net/http` and third-party routers
:::
