# Setting Up Go

Alright, let's get you a working Go environment. By the end of this page, you'll have Go installed, your editor configured with IntelliSense, and you'll have written and run your first Go program -- including an HTTP server with a JSON endpoint. We're going to take it step by step, building up from the absolute simplest program to something that actually looks like a BFF.

This is the "plant the flag" chapter. Once you've seen `Hello from Go!` in your terminal, the psychological barrier is broken. Everything after that is just learning syntax.

## Installing Go

### macOS (Homebrew)

If you're on macOS and have Homebrew, this is one command:

```bash
brew install go
```

That's it. No build-from-source, no downloading tarballs, no configuring paths. Homebrew handles everything.

::: tip Already have Go installed?
If you installed Go a while ago, make sure you're on version 1.24 or later. The ODH Dashboard BFFs require it. Run `brew upgrade go` to get the latest version.
:::

### Linux

On Linux, you'll download the official binary from Go's website. Here's the process:

```bash
# Download the Go binary archive
# (check go.dev/dl for the latest version -- 1.24.3 is current as of writing)
wget https://go.dev/dl/go1.24.3.linux-amd64.tar.gz
```

That command downloads a compressed archive containing the entire Go toolchain. Think of it like downloading a `.zip` of Node.js, except it includes everything -- compiler, formatter, test runner, the works.

```bash
# Remove any previous Go installation to avoid conflicts
sudo rm -rf /usr/local/go
```

This cleans out any old version. If you've never installed Go before, this command will do nothing (and that's fine).

```bash
# Extract the archive to /usr/local
sudo tar -C /usr/local -xzf go1.24.3.linux-amd64.tar.gz
```

This unpacks Go into `/usr/local/go/`, which is where Linux conventions say it should live.

Now you need to tell your shell where to find Go. Add these lines to your `~/.bashrc` or `~/.zshrc`:

```bash
export PATH=$PATH:/usr/local/go/bin      # So your shell can find the "go" command
export PATH=$PATH:$(go env GOPATH)/bin   # So your shell can find tools you install with "go install"
```

After saving the file, reload your shell:

```bash
source ~/.bashrc   # or source ~/.zshrc if you use zsh
```

### Verifying the Installation

This is the moment of truth. Run this command:

```bash
go version
```

You should see something like:

```
go1.24.3 darwin/arm64
```

If you're on an Intel Mac, it'll say `darwin/amd64`. On Linux, `linux/amd64`. The important part is that the version starts with `1.24` or later.

::: danger If you see "go: command not found"
This means your shell can't find the `go` binary. Here's how to fix it:

**macOS:** Make sure `/opt/homebrew/bin` (Apple Silicon) or `/usr/local/bin` (Intel) is in your `PATH`. Run `echo $PATH` to check. If it's missing, add it to your `~/.zshrc`:
```bash
export PATH="/opt/homebrew/bin:$PATH"
```
Then run `source ~/.zshrc` and try `go version` again.

**Linux:** Make sure `/usr/local/go/bin` is in your `PATH`. Check with `echo $PATH`. If it's missing, you need to add the `export` line shown above to your shell config file.

**Both:** After editing your shell config, you must either restart your terminal or run `source ~/.zshrc` (or `~/.bashrc`). The changes don't take effect until you do.
:::

Let's also check where Go put things:

```bash
go env GOROOT
```

This prints where Go itself is installed:

```
/opt/homebrew/Cellar/go/1.24.3/libexec    # macOS with Homebrew
# or
/usr/local/go                              # Linux
```

You don't need to memorize this -- but it's useful for troubleshooting.

```bash
go env GOPATH
```

This prints where Go stores downloaded modules and compiled binaries:

```
/Users/yourname/go     # macOS
# or
/home/yourname/go      # Linux
```

Think of `GOPATH` like a global `node_modules`. When you download a dependency, it gets cached here, and every Go project on your machine shares that cache. No more 847 copies of `lodash` across different projects.

<div class="checkpoint">

#### Checkpoint: Go is installed
Run `go version` in your terminal. If you see `go1.24` or later, you're good. If not, revisit the installation steps above before continuing.

</div>

## What Got Installed?

Let's take a moment to appreciate what just happened. With that single install command, you got:

| What | Where | Purpose |
|------|-------|---------|
| `go` CLI | `/opt/homebrew/bin/go` (macOS) or `/usr/local/go/bin/go` (Linux) | The compiler, build tool, test runner, formatter -- **everything** |
| Standard library | Ships as source with the Go toolchain | HTTP servers, JSON, crypto, testing, file I/O -- batteries included |
| `GOPATH` | `~/go` by default | Where downloaded modules and compiled binaries live |

In the JavaScript world, you'd need Node.js, npm, Prettier, ESLint, Jest, webpack, and probably a handful of other tools before you could be productive. In Go, the `go` command _is_ all of those tools combined. There's one formatter (`go fmt`), one test runner (`go test`), one linter (`go vet`), and one build tool (`go build`). They all come pre-installed. They all work with zero configuration.

::: info No node_modules Equivalent
Go downloads dependencies to a global module cache at `~/go/pkg/mod/`, not per-project. There's no `node_modules` directory in your project. This means `go mod download` (Go's equivalent of `npm install`) is fast because it reuses cached versions across all your projects. Your project directory stays clean -- just your code, `go.mod`, and `go.sum`.
:::

## Setting Up VS Code

You _can_ write Go in any text editor, but VS Code with the Go extension gives you IntelliSense, auto-formatting, error highlighting, and go-to-definition. It's the difference between writing TypeScript with and without `tsconfig.json` -- technically possible either way, but one is dramatically better.

### Install the Go Extension

1. Open VS Code
2. Open the Extensions panel (`Cmd+Shift+X` on macOS, `Ctrl+Shift+X` on Linux)
3. Search for **"Go"** -- look for the one by the Go team at Google (publisher ID: `golang.go`)
4. Click **Install**

After installing, open any `.go` file (we'll create one in a minute). VS Code will show a notification in the bottom-right corner asking you to install additional Go tools. **Click "Install All."** This installs `gopls` (the Go language server), `dlv` (the debugger), and a few other utilities that power IntelliSense.

::: warning "Install All" is important
If you skip this step or dismiss the notification, you'll miss out on autocomplete, error highlighting, and auto-imports. If the notification doesn't appear, you can trigger it manually: press `Cmd+Shift+P` (or `Ctrl+Shift+P`), type "Go: Install/Update Tools", and select all the tools in the list.
:::

### Recommended Settings

Open your VS Code settings as JSON (`Cmd+Shift+P` > "Preferences: Open User Settings (JSON)") and add these Go-specific settings:

```json
{
  "[go]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "golang.go",
    "editor.codeActionsOnSave": {
      "source.organizeImports": "explicit"
    }
  },
  "go.lintTool": "golangci-lint",
  "go.lintOnSave": "package",
  "go.testOnSave": false,
  "go.useLanguageServer": true
}
```

Here's what each setting does, mapped to the TypeScript tools you already know:

| Setting | What It Does | TypeScript Equivalent |
|---------|-------------|----------------------|
| `formatOnSave` | Runs `gofmt` every time you save. No Prettier config needed. | Prettier with format-on-save |
| `organizeImports` | Adds missing imports and removes unused ones automatically. On save, if you type `fmt.Println` without importing `fmt`, it adds the import for you. | ESLint's `import/order` rule, but fully automatic |
| `lintTool: golangci-lint` | Uses the standard Go linter for code quality analysis. | ESLint |
| `useLanguageServer` | Enables `gopls` for autocomplete, type info, hover docs, and go-to-definition. | `tsserver` (the TypeScript language server) |

::: tip Format On Save Is Non-Negotiable
In Go, `gofmt` is _the_ code formatter. There's only one. It has no configuration options. No tabs vs. spaces debates (Go uses tabs). No print width settings. No `.prettierrc` file. The first time you save a Go file and watch it auto-format, you'll either love it or hate it for about five minutes. Then you'll love it, because you'll never have a formatting argument on a PR again.
:::

### Verifying VS Code is Working

Let's make sure everything is connected properly. Create a temporary file:

1. Open VS Code
2. Create a new file and save it as `test.go` anywhere on your machine
3. Type this:

```go
package main

import "fmt"

func main() {
    fmt.Println("hello")
}
```

**What you should see:**
- Syntax highlighting (keywords in one color, strings in another, function names in a third)
- If you hover over `fmt.Println`, a tooltip should appear showing the function signature and documentation
- If you delete the `import "fmt"` line and save, VS Code should add it back automatically (that's the `organizeImports` setting)
- If you type `fmt.` you should see autocomplete suggestions like `Println`, `Printf`, `Sprintf`, etc.

If all of that works, your editor is properly configured. Delete the test file -- we're about to create a real project.

::: danger If autocomplete doesn't work
The most common cause is that `gopls` didn't install properly. Try this:
1. Press `Cmd+Shift+P` (or `Ctrl+Shift+P`)
2. Type "Go: Install/Update Tools"
3. Check **all** the tools in the list
4. Click OK and wait for them to install
5. Restart VS Code

If it still doesn't work, check the Output panel (`Cmd+Shift+U`) and select "Go" from the dropdown to see error messages from the language server.
:::

### Useful VS Code Shortcuts for Go

These will save you time once you're writing Go regularly:

| Shortcut | What It Does |
|----------|-------------|
| `F12` | Go to definition -- jump to where a function or type is defined |
| `Shift+F12` | Find all references -- see everywhere a function is used |
| `Cmd+.` (or `Ctrl+.`) | Quick fix -- auto-import, generate interface implementations, extract variables |
| `Ctrl+Space` | Trigger autocomplete manually |
| `Cmd+Shift+P` > "Go: Test Function at Cursor" | Run just the test your cursor is sitting in |
| `Cmd+Shift+P` > "Go: Generate Tests for Function" | Auto-generate test boilerplate for the function under your cursor |

<div class="checkpoint">

#### Checkpoint: Editor is ready
Open a `.go` file in VS Code. You should see syntax highlighting and autocomplete (type `fmt.` and see suggestions). If auto-imports work when you save, you're golden. If not, run "Go: Install/Update Tools" from the command palette.

</div>

## Your First Go Program

Time to write real code. We're going to build up progressively -- starting with the absolute smallest valid Go program and adding features one at a time. No big code dumps. Each step introduces one new concept.

### Step 1: The Minimum Viable Go Program

Create a project directory and initialize it:

```bash
mkdir ~/hello-go && cd ~/hello-go
```

That creates a new directory and moves into it. Nothing surprising.

```bash
go mod init hello-go
```

This creates a `go.mod` file -- Go's equivalent of `package.json`. Let's look at what it generated:

```bash
cat go.mod
```

You should see:

```
module hello-go

go 1.24
```

That's it. Two lines. Compare that to a `package.json` with its name, version, description, scripts, dependencies, devDependencies, engines... Go's philosophy is "less is more."

::: info go mod init vs npm init
`go mod init <module-name>` creates a `go.mod` file that tracks your module name and Go version. Think of it as `npm init -y` but even simpler. Dependencies get added automatically when you import them in code -- no need to manually `go get` packages before using them. When you build your code, Go reads the imports, resolves them, downloads what's missing, and updates `go.mod` for you.
:::

Now create a file called `main.go`. Open it in VS Code (or your editor of choice):

```go
package main       // Declare that this file belongs to the "main" package
                   // "main" is a special package name -- it tells Go
                   // "this is an executable program, not a library"

func main() {     // Define the main function -- the program's entry point
                  // When you run this program, Go calls this function first
                  // It's like: if (__name__ == '__main__') in Python
                  // or: the code that runs when Node.js executes your file
}                 // End of main -- the program exits here
```

Let's run it:

```bash
go run main.go
```

You should see... nothing. No output. No errors. The program started, ran `main()`, found nothing to do, and exited. That's correct! A boring program, but a valid one.

**What just happened?** `go run` compiled your `.go` file into a temporary binary and executed it. Behind the scenes, Go turned your source code into machine code, ran it, and then cleaned up the temporary binary. It's like `ts-node` or `npx tsx` -- it _feels_ interpreted, but Go is actually compiling your code every time.

### Step 2: Print Something

Let's make it do something visible. Update `main.go`:

```go
package main       // Still the main package -- this is a runnable program

import "fmt"       // Import the "fmt" package from Go's standard library
                   // "fmt" stands for "format" -- it handles text formatting and printing
                   // This is like: import { console } from 'node:console'
                   // except fmt can do much more (sprintf, scanning, etc.)

func main() {                          // Entry point
    fmt.Println("Hello from Go!")      // Print "Hello from Go!" followed by a newline
                                       // fmt.Println is like console.log() in JavaScript
                                       // The capital P in Println matters -- more on that in a second
}
```

Run it:

```bash
go run main.go
```

You should see:

```
Hello from Go!
```

There it is. Your first output from a Go program.

Let me call out something important: **the capital P in `Println`.** In Go, if a function name starts with an uppercase letter, it's _exported_ -- meaning it's public, available to other packages. If it started with a lowercase `p`, it would be private to the `fmt` package and you couldn't call it. There's no `export` keyword, no `public` modifier. Just capitalization. This rule applies to everything: functions, types, variables, constants. You'll internalize it within a day.

In TypeScript terms:

```typescript
// In TypeScript, you'd write:
export function Println(a: string): void { ... }  // public
function println(a: string): void { ... }          // private (no export)

// In Go, it's just:
func Println(a string) { ... }   // public (uppercase P)
func println(a string) { ... }   // private (lowercase p)
```

<div class="checkpoint">

#### Checkpoint: Hello World works
Run `go run main.go` and see `Hello from Go!` in your terminal. If you see an error instead, check that:
1. Your file is named `main.go` (not `Main.go` or `hello.go`)
2. The first line says `package main` (not `package hello`)
3. The function is called `main()` (not `Main()` or `start()`)
4. You saved the file before running the command

</div>

### Step 3: Variables

Let's add a variable. In TypeScript, you'd write:

```typescript
const name: string = 'Alice';     // Explicit type annotation
const age = 30;                    // Type inferred as number
let greeting = `Hello, ${name}!`; // Template literal
```

In Go, here's how you do the same thing:

```go
package main       // Executable program

import "fmt"       // For printing

func main() {
    var name string = "Alice"      // Explicit type: declare name as a string, set to "Alice"
                                    // var = "I'm declaring a variable"
                                    // string = the type (comes AFTER the name, not before)
                                    // In TS: const name: string = 'Alice'

    age := 30                       // Short declaration: Go infers the type as int
                                    // := means "declare AND assign" -- it's like let with type inference
                                    // In TS: const age = 30 (type inferred as number)
                                    // You can ONLY use := inside functions, not at package level

    greeting := fmt.Sprintf("Hello, %s! You are %d years old.", name, age)
    // fmt.Sprintf formats a string (like template literals, but with placeholders)
    // %s = string placeholder (inserts "Alice")
    // %d = integer placeholder (inserts 30)
    // In TS: `Hello, ${name}! You are ${age} years old.`
    // Go doesn't have template literals, so you use Sprintf instead

    fmt.Println(greeting)           // Print the greeting
}
```

Run it:

```bash
go run main.go
```

```
Hello, Alice! You are 30 years old.
```

**What just happened?** You declared variables two ways. `var name string = "Alice"` is the explicit way -- you spell out the type. `age := 30` is the short way -- Go figures out the type from the value. Most Go code uses `:=` because it's less typing, but `var` is useful when you want to declare a variable without assigning it immediately (it gets a "zero value" -- `""` for strings, `0` for numbers, `false` for booleans, `nil` for pointers).

The `:=` operator is probably the first thing you'll notice when reading Go code. It's everywhere. Think of it as Go's version of `const` with type inference:

```typescript
// TypeScript
const name = 'Alice';    // type inferred as string

// Go
name := "Alice"          // type inferred as string
```

::: warning := Only Works Inside Functions
You can only use `:=` inside a function body. At the package level (outside any function), you must use `var`. This trips people up exactly once:

```go
package main

name := "Alice"        // COMPILE ERROR: := not allowed at package level

var name = "Alice"     // This works fine at package level

func main() {
    age := 30          // := works fine inside functions
}
```
:::

### Step 4: A Function That Returns a Value

In TypeScript, a function that returns a string looks like this:

```typescript
function greet(name: string): string {
    return `Hello, ${name}!`;
}
```

In Go:

```go
package main       // Executable program

import "fmt"       // For printing and string formatting

// greet takes a string parameter and returns a string
// Notice: the type comes AFTER the parameter name, not before
// In TS: function greet(name: string): string
// In Go: func greet(name string) string
func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)   // Format and return a greeting string
                                              // Sprintf returns the string instead of printing it
                                              // (Println prints, Sprintf returns)
}

func main() {
    message := greet("Alice")   // Call greet, store the result
                                 // := infers that message is a string
    fmt.Println(message)         // Print: Hello, Alice!

    // Or you can inline it:
    fmt.Println(greet("Bob"))    // Print: Hello, Bob!
}
```

Run it:

```bash
go run main.go
```

```
Hello, Alice!
Hello, Bob!
```

**What just happened?** You wrote a function with a parameter and a return type. The biggest syntax difference from TypeScript: types come _after_ the name. It's `name string` not `name: string`. And the return type comes after the parameter list, not before the function body. No colon before the return type either.

```
TypeScript:  function greet(name: string): string { ... }
Go:          func     greet(name string)   string { ... }
```

It reads differently, but the information is the same: function name, parameter name, parameter type, return type.

### Step 5: Your First HTTP Server

Now let's build something real. This is where it starts to feel like BFF code. We'll create an HTTP server with a JSON endpoint -- the exact same pattern every BFF handler uses.

Replace the contents of `main.go` with the following. I'll build it up in sections:

**First, the package declaration and imports:**

```go
package main                  // This is a runnable program

import (                      // Import block for multiple packages
    "encoding/json"           // JSON encoding and decoding (like JSON.stringify/parse)
    "fmt"                     // Formatted I/O (like console.log)
    "log"                     // Logging with timestamps (like console.error but better)
    "net/http"                // HTTP server and client (like Express, but built-in!)
)                             // All four packages are from Go's standard library
                              // No "go get" or "go install" needed
```

In Express, you'd `npm install express` and then import it. In Go, HTTP servers are part of the standard library. You just import `net/http` and you're ready to go. This is one of Go's biggest selling points -- the standard library is so comprehensive that many Go projects have zero external dependencies.

**Next, the response type:**

```go
// HealthResponse defines the shape of our JSON response
// This is like a TypeScript interface, but it's a struct
// The `json:"status"` part is called a "struct tag" -- it tells the JSON encoder
// to use "status" (lowercase) as the key name instead of "Status" (uppercase)
type HealthResponse struct {
    Status string `json:"status"`   // A field named Status, type string
                                     // In the JSON output, it becomes "status" (lowercase)
                                     // In TS: { status: string }
}
```

In TypeScript, you'd write `interface HealthResponse { status: string }`. In Go, you write a `struct` with a `json` tag. The backtick-enclosed `` `json:"status"` `` part controls how the field appears in JSON. Without it, the JSON key would be `"Status"` (capital S, matching the Go field name). We'll cover struct tags in detail in [the JSON chapter](./go-basics/json), but for now just know: the tag controls the JSON key name.

**Now, the handler function:**

```go
// healthHandler handles HTTP requests to /healthcheck
// This is like an Express route handler, but the signature is different:
// Instead of (req, res), it's (w, r) where:
//   w = http.ResponseWriter (how you write the response -- like Express's "res")
//   r = *http.Request (the incoming request -- like Express's "req")
// Note: response comes FIRST, request comes SECOND (opposite of Express)
func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    // Set the Content-Type header so the client knows it's getting JSON
    // In Express, res.json() does this automatically
    // In Go, you set it explicitly -- no magic

    json.NewEncoder(w).Encode(HealthResponse{
        // json.NewEncoder(w) creates a JSON encoder that writes to the response
        // .Encode(...) converts the struct to JSON and writes it
        // HealthResponse{Status: "healthy"} creates a HealthResponse with Status = "healthy"
        // Together, this writes {"status":"healthy"} to the response body
        // In Express: res.json({ status: 'healthy' })
        Status: "healthy",
    })
}
```

This is the pattern you'll see in every BFF handler. The handler function takes a `ResponseWriter` and a `*Request`. You write your response to the `ResponseWriter` (headers, status code, body) and read information from the `*Request` (URL, headers, body, query parameters). That `*` before `http.Request` means "pointer to" -- we'll explain pointers in detail in [the pointers chapter](./go-basics/pointers), but for now just know it means "a reference to the request, not a copy of it."

**Finally, the main function that starts the server:**

```go
func main() {
    http.HandleFunc("/healthcheck", healthHandler)
    // Register the healthHandler function for the /healthcheck path
    // Any HTTP request to /healthcheck will be handled by healthHandler
    // This is like: app.get('/healthcheck', healthHandler) in Express
    // Note: http.HandleFunc registers for ALL HTTP methods (GET, POST, etc.)

    port := ":8080"                                // The port to listen on
                                                    // The colon prefix is required -- it means "listen on all interfaces"
    fmt.Printf("Server starting on %s\n", port)   // Print a startup message
                                                    // Printf is like console.log with placeholders
                                                    // %s inserts the port string
    log.Fatal(http.ListenAndServe(port, nil))
    // Start the HTTP server!
    // http.ListenAndServe(port, nil) starts listening and blocks the calling
    // goroutine until the server shuts down (unlike Express's app.listen,
    // which returns immediately)
    //   - port = ":8080" -- listen on port 8080
    //   - nil = use the default request multiplexer (router)
    //     (the one we registered handlers on with http.HandleFunc)
    //
    // log.Fatal wraps the call: if ListenAndServe returns an error
    // (like "port already in use"), log.Fatal prints the error and exits
    // If the server runs successfully, ListenAndServe never returns
}
```

**Here's the complete file all together:**

```go
package main                  // This is a runnable program

import (                      // Import multiple packages from the standard library
    "encoding/json"           // JSON encoding (like JSON.stringify)
    "fmt"                     // Formatted printing (like console.log)
    "log"                     // Error logging (like console.error)
    "net/http"                // HTTP server (like Express, but built-in)
)

// HealthResponse is the JSON response shape for /healthcheck
// In TypeScript: interface HealthResponse { status: string }
type HealthResponse struct {
    Status string `json:"status"`   // Field: Status, Type: string, JSON key: "status"
}

// healthHandler responds to HTTP requests at /healthcheck
// w = response writer (like Express res), r = request (like Express req)
func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")    // Set the response content type
    json.NewEncoder(w).Encode(HealthResponse{             // Encode struct as JSON and write it
        Status: "healthy",                                 // Set the Status field to "healthy"
    })                                                     // Response body: {"status":"healthy"}
}

func main() {                                              // Program entry point
    http.HandleFunc("/healthcheck", healthHandler)         // Register route handler
    port := ":8080"                                        // Port to listen on
    fmt.Printf("Server starting on %s\n", port)           // Log startup message
    log.Fatal(http.ListenAndServe(port, nil))              // Start server (blocks forever)
}
```

### Running the Server

Save the file and run it:

```bash
go run main.go
```

You should see:

```
Server starting on :8080
```

The server is now running and waiting for requests. Notice that the terminal is "stuck" -- the program is blocking, waiting for HTTP connections. That's normal. Don't close this terminal.

Open a **new terminal window** (or a new tab), and make a request to your server:

```bash
curl http://localhost:8080/healthcheck
```

You should see:

```json
{"status":"healthy"}
```

Congratulations -- you just wrote a Go HTTP server with a JSON endpoint. No external dependencies. No `npm install express`. The `net/http` and `encoding/json` packages are part of Go's standard library. Every BFF in the ODH Dashboard starts from exactly this pattern.

Go back to the first terminal and press `Ctrl+C` to stop the server.

::: tip Look familiar?
This `/healthcheck` endpoint is the same one that every ODH Dashboard BFF is required to expose. The contract test framework uses it to check that the BFF is running and ready to accept requests. You just wrote the real thing.
:::

<div class="checkpoint">

#### Checkpoint: HTTP Server Works
In one terminal, run `go run main.go`. You should see "Server starting on :8080". In another terminal, run `curl http://localhost:8080/healthcheck`. You should see `{"status":"healthy"}`. If you got this far, you have a fully working Go HTTP server. Press `Ctrl+C` to stop the server.

If you see an error like "address already in use", another process is using port 8080. Either stop that process or change the port in your code to `:8081`.

</div>

## Building a Binary

So far we've been using `go run`, which compiles and executes in one step (and throws away the binary afterward). Let's build a permanent binary:

```bash
go build -o hello .
```

Here's what each part means:
- `go build` -- compile the Go code in the current directory
- `-o hello` -- name the output binary `hello` (without this, it would be named after your module)
- `.` -- build the current directory (all `.go` files in the `main` package)

Now run it:

```bash
./hello
```

```
Server starting on :8080
```

That's a **standalone executable**. No Go installation needed to run it. No runtime. No dependencies. You could copy that single file to any machine with the same operating system and architecture, and it would run.

Let's see how big it is:

```bash
ls -lh hello
```

```
-rwxr-xr-x  1 you  staff   6.5M May 19 10:00 hello
```

About 6.5 megabytes for a complete HTTP server with JSON support. A Node.js `node_modules` directory for an Express app is typically 30-50MB, plus you need the Node.js runtime (another 30-80MB).

```bash
file hello
```

```
hello: Mach-O 64-bit executable arm64
```

That confirms it's a native executable for your platform. This is how BFFs get deployed in production -- the Dockerfile compiles the Go code in a build stage, then copies just the binary into a tiny runtime image. No Node.js runtime, no `node_modules`, just the binary.

::: info The Binary Advantage in Practice
In ODH Dashboard, the BFF Dockerfiles follow a two-stage build:
1. **Build stage:** Start with a Go image, copy the source code, run `go build` to produce a binary
2. **Runtime stage:** Start with a minimal base image (like `ubi-micro`), copy just the binary

The result is a Docker image around 20-30MB. Compare that to a Node.js Dockerfile that needs to install the full Node.js runtime, copy `package.json` and `node_modules`, and ends up at 200-400MB. Smaller images mean faster pulls, faster deployments, and less attack surface.
:::

## The Go Toolchain: Your New Best Friends

Remember how in JavaScript you need Prettier, ESLint, Jest, and a build tool? In Go, the `go` command handles all of it. Let me introduce you to each tool:

### go fmt -- The One Formatter to Rule Them All

```bash
go fmt ./...
```

This formats every Go file in your project. There are no configuration options. None. Zero. No `.prettierrc`, no `printWidth: 100`, no `singleQuote: true`. Go uses tabs for indentation, and that's final. Everyone's Go code looks exactly the same.

The `./...` pattern means "this directory and all subdirectories recursively." You'll see it with many Go commands. It's like a recursive glob.

You know those PR review comments about formatting? Those don't exist in Go. `gofmt` formats all code identically. The debate is over. It's glorious.

### go vet -- The Lightweight Linter

```bash
go vet ./...
```

This catches common mistakes the compiler doesn't flag: suspicious `Printf` format strings, unreachable code, struct tags that don't match field names, passing locks by value, and more. Think of it as a focused ESLint that only flags things that are almost certainly bugs -- not style preferences.

### go test -- The Test Runner

```bash
go test ./...
```

This runs every test in your project. No Jest config, no test runner setup. The convention is simple:

- Test files end in `_test.go`
- Test functions start with `Test`
- That's it

Here's what a Go test looks like compared to Jest:

**Jest (TypeScript):**

```typescript
describe('add', () => {
    it('should add two numbers', () => {
        expect(add(2, 3)).toBe(5);
    });
});
```

**Go:**

```go
// math_test.go                          // Test files end in _test.go
package math                             // Same package as the code being tested

import "testing"                         // Import the testing package from the standard library

func TestAdd(t *testing.T) {             // Test functions start with Test
                                          // t is the test runner -- like Jest's expect/it
    result := Add(2, 3)                  // Call the function being tested
    if result != 5 {                     // Check the result manually (no expect().toBe())
        t.Errorf("Add(2, 3) = %d, want 5", result)
        // t.Errorf logs a failure message but continues running the test
        // %d is a placeholder for an integer
        // The test runner will print this message if the assertion fails
    }
}
```

Yeah, there's no `describe`/`it`/`expect`. Go's philosophy is that the standard library's `testing` package is enough, and adding a framework on top would just be extra complexity. It feels bare-bones at first, but you get used to it fast. We'll cover testing patterns in depth later, including table-driven tests (Go's answer to parameterized tests).

::: tip No Framework Needed (Really)
Go's standard library `testing` package is what the Go team uses to test Go itself. It's what the Kubernetes project uses. It's what almost every Go project uses. There _are_ assertion libraries like `testify` if you want `assert.Equal(t, expected, actual)` syntax, but they're entirely optional. The ODH Dashboard BFFs use the standard library approach.
:::

### go mod tidy -- Clean Up Dependencies

```bash
go mod tidy
```

This adds missing dependencies and removes unused ones from your `go.mod` and `go.sum` files. Run this whenever you add or remove imports. It's like running `npm prune` and `npm install` at the same time -- it ensures your dependency list matches what your code actually uses.

### Quick Reference

Here's your cheat sheet for Go commands mapped to JavaScript equivalents:

| Go Command | What It Does | JavaScript Equivalent |
|-----------|-------------|----------------------|
| `go run .` | Compile and execute | `npx tsx src/index.ts` |
| `go build -o app .` | Compile to binary | `tsc && pkg .` (roughly) |
| `go fmt ./...` | Format all code | `npx prettier --write .` |
| `go vet ./...` | Static analysis | `npx eslint .` (focused on bugs only) |
| `go test ./...` | Run all tests | `npx jest` |
| `go mod init` | Initialize module | `npm init -y` |
| `go mod tidy` | Sync dependencies | `npm prune` + auto-install |
| `go mod download` | Download dependencies | `npm ci` |
| `go get pkg@version` | Add a dependency | `npm install pkg@version` |

## Understanding Go Modules

If you search for Go tutorials online, you might encounter references to `GOPATH` -- an older workspace model where all Go code had to live in a single directory tree. **Ignore it completely.** It's been superseded by Go modules since Go 1.16, and the ODH Dashboard BFFs all use modules.

Go modules work like this, and the parallel to npm is almost exact:

1. **`go mod init <module-name>`** creates a `go.mod` file. This is your `package.json`.
2. **You `import` packages** in your code. When you build, Go reads the imports and resolves them.
3. **`go mod tidy`** downloads any new dependencies to the global cache (`~/go/pkg/mod/`) and updates `go.mod`.
4. **`go.sum`** records checksums of every dependency. This is your `package-lock.json` -- it ensures reproducible builds.

That's the entire system. Your project directory contains your code, `go.mod`, and `go.sum`. Clean, simple, and no `node_modules` folder taking up 500MB of disk space.

::: info Real-World Example
In the ODH Dashboard, each BFF has its own `go.mod` file. For example, `packages/gen-ai/bff/go.mod` declares the module name and its dependencies -- the Kubernetes client library, `httprouter`, and a few others. When you `cd` into that directory and run `go build ./...`, Go reads `go.mod` to resolve all the imports. If a dependency is missing, it downloads it automatically.
:::

## Project Structure So Far

Your project should look like this:

```text
hello-go/
├── go.mod       # Module definition (like package.json) -- 2 lines
├── main.go      # Your program -- the HTTP server
└── hello        # The compiled binary (if you ran go build)
```

No config files. No `tsconfig.json`, no `.eslintrc`, no `jest.config.ts`, no `webpack.config.js`, no `babel.config.js`, no `.prettierrc`. Just your code and the module file. This minimalism is by design -- Go provides sensible defaults for everything, and the toolchain handles the rest.

It's almost suspiciously simple. If you're thinking "where's the rest of the config?" -- there isn't any. Welcome to Go.

---

<div class="checkpoint">

#### Checkpoint: You're Ready

You're ready for the next chapter if you can answer "yes" to all of these:

- [ ] `go version` prints **1.24** or later
- [ ] `go run main.go` starts your HTTP server and you can curl it
- [ ] VS Code shows syntax highlighting and autocomplete in `.go` files
- [ ] You understand that `go.mod` is your `package.json`
- [ ] You understand that `go build` produces a standalone binary with no runtime dependency

**Common issues and fixes:**

- **`go: command not found`** -- Your shell can't find Go. Make sure the Go bin directory is in your `PATH`. Restart your terminal after editing shell config files.

- **VS Code not showing autocomplete** -- The Go language server (`gopls`) probably didn't install. Press `Cmd+Shift+P` > "Go: Install/Update Tools" and install everything. Restart VS Code.

- **Go version too old** -- Run `brew upgrade go` (macOS) or download the latest from [go.dev/dl](https://go.dev/dl/).

- **"address already in use" when running the server** -- Another process is on port 8080. Run `lsof -i :8080` to find it, or change the port in your code.

If you got this far, you have a working Go installation, a configured editor, and you've written a real HTTP server. That's not nothing -- that's the foundation everything else builds on. The hard part was starting. You've started.

</div>

## What's Next

You have a working Go environment and you've written your first program. In the next section, **[Types & Variables](./go-basics/types-and-variables)**, we'll start learning the Go language for real -- beginning with the type system and how it compares to TypeScript.

You'll learn about Go's primitive types (spoiler: there's no `undefined`), the zero value system (every type has a default value -- no more `null` vs `undefined` debates), and the difference between `var` and `:=`. If you know TypeScript's type system, Go's will feel like a stripped-down version -- less powerful, but also less room for things to go wrong.

See you there.
