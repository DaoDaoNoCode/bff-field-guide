# Entry Point (main.go)

> **The starting line** -- every BFF begins in `cmd/main.go`, where flags are parsed, dependencies are wired up, and the HTTP server starts listening.

Let's walk through `main.go` together, like a pair programming session. I'll show you every line and explain what it does. If you've written an Express server before, most of this will feel familiar -- just with Go's characteristic explicitness.

::: warning Variations Across BFFs
The code examples in this chapter are composites drawn from multiple BFFs (gen-ai, automl, maas). Real BFFs may differ in field names (e.g., `MockK8sClient` in gen-ai vs `MockK8Client` in automl), env var fallback patterns, and timeout values. Always check the specific BFF you're working on.
:::

## Your Express Server, for Comparison

Before we touch Go, here's what a typical Express server looks like. You've probably written something like this a hundred times:

```typescript
import express from 'express';                    // Import the framework
import { createApp } from './app';                 // Import the app factory
import { parseConfig } from './config';            // Import config parser

const config = parseConfig(process.argv);          // Parse CLI args
const logger = createLogger(config.logLevel);      // Create a logger

const app = await createApp(config, logger);       // Wire up all dependencies

app.listen(config.port, () => {                    // Start listening
  logger.info(`Server running on :${config.port}`);
});
```

Six lines. Framework, config, logger, app, listen. The Go entry point does exactly the same things -- parse config, build app, start server. It just shows you all the wiring that Express hides.

## Line 1: `package main`

Let's start at the very beginning:

```go
package main                                       // This tells Go: "this file is a program entry point"
                                                   // Every Go executable must have exactly one "package main"
```

**What just happened?** In Node.js, your entry point is whatever `package.json` points to. In Go, the entry point is always a file in `package main`. This isn't a choice -- it's how the Go compiler finds the start of your program.

## The Import Block

Next comes the import block. Go groups all imports at the top of the file:

```go
import (                                           // Import block -- like your import statements at the top of a .ts file
    "flag"                                         // CLI argument parser (built-in, like a minimal commander.js)
    "fmt"                                          // String formatting (think template literals)
    "log/slog"                                     // Structured logging (like pino or winston, but built-in)
    "net/http"                                     // HTTP server (built-in -- no Express needed!)
    "os"                                           // OS-level functions (process.exit, env vars)
    "time"                                         // Time durations for timeouts

    "github.com/opendatahub-io/your-module/internal/api"      // Our app's API package
    "github.com/opendatahub-io/your-module/internal/config"   // Our app's config package
)
```

**What just happened?** Two things stand out if you're coming from Node.js. First, Go's standard library includes an HTTP server -- no need for Express or Fastify. Second, Go separates standard library imports (no dots in the path) from external imports (URL-style paths) with a blank line. This is a convention enforced by the formatter.

## `func main()` -- Where It All Begins

```go
func main() {                                      // The entry point function -- Go starts executing here
                                                   // Like calling your top-level async function in index.ts
```

Every Go program needs a `main` package with a `main()` function. This is non-negotiable -- it's how the Go runtime knows where to start.

Now let's build up the contents of `main()` piece by piece.

## Flag Parsing -- Go's CLI Argument System

The first thing `main()` does is parse command-line flags. Let's start with just one:

```go
    var cfg config.EnvConfig                       // Declare a variable to hold all configuration
                                                   // config.EnvConfig is a struct defined in internal/config/

    flag.IntVar(&cfg.Port,                         // &cfg.Port is a pointer -- "write directly into this field"
        "port",                                    // The flag name: --port
        getEnvAsInt("PORT", 8080),                 // Default value: check PORT env var, fall back to 8080
        "API server port")                         // Help text (shown with --help)
```

**What just happened?** The `flag` package is Go's built-in CLI argument parser. That `&cfg.Port` syntax is a **pointer** -- it tells the `flag` package "write the parsed value directly into this field of the config struct." If you haven't read [Pointers](../go-basics/pointers) yet, just remember: `&` means "the address of this variable" and lets the function modify it.

Now let's add a few more flags:

```go
    flag.StringVar(&cfg.AuthMethod,                // Same pattern, but for a string flag
        "auth-method",                             // The flag name: --auth-method
        getEnvAsString("AUTH_METHOD", "user_token"),// Default varies by BFF: "user_token" (gen-ai, eval-hub)
                                                   // or "internal" (automl, maas, autorag)
        "Authentication method")                   // Help text

    flag.BoolVar(&cfg.MockK8sClient,               // Boolean flag: --mock-k8s-client
        "mock-k8s-client",                         // The flag name (no value needed -- presence = true)
        getEnvAsBool("MOCK_K8S_CLIENT", false),    // Default: check env var, fall back to false
        "Use mock Kubernetes client")              // Help text

    flag.Parse()                                   // Actually parse os.Args and populate cfg fields
                                                   // Must be called after all flags are defined
```

**What just happened?** After `flag.Parse()`, running `go run ./cmd --port 9090 --mock-k8s-client` sets `cfg.Port` to `9090` and `cfg.MockK8sClient` to `true`. The env var fallback creates a priority chain: **CLI flag > environment variable > hardcoded default**.

Here's a comparison table so you can see the mapping:

| Go | TypeScript (yargs) |
|---|---|
| `flag.IntVar(&cfg.Port, "port", 8080, "help text")` | `.option('port', { type: 'number', default: 8080, describe: 'help text' })` |
| `flag.StringVar(&cfg.AuthMethod, "auth-method", "user_token", "...")` | `.option('auth-method', { type: 'string', default: 'user_token' })` |
| `flag.BoolVar(&cfg.MockK8sClient, "mock-k8s-client", false, "...")` | `.option('mock-k8s-client', { type: 'boolean', default: false })` |
| `flag.Parse()` | `.parse()` |

### The Env Var Fallback Helpers

Those `getEnvAsInt`, `getEnvAsString`, and `getEnvAsBool` functions in the default values? They're small helpers defined in `cmd/helpers.go`. Let's look at one:

```go
func getEnvAsInt(name string, defaultVal int) int { // Takes an env var name and a fallback value
    if value, exists := os.LookupEnv(name); exists {// Check if the env var is set
        if intValue, err := strconv.Atoi(value); err == nil { // Try to convert string to int
            return intValue                        // Env var was set and is a valid integer
        }                                          // If conversion fails, fall through to default
    }                                              // If env var is not set, fall through to default
    return defaultVal                              // Return the default value
}
```

**TypeScript equivalent:**

```typescript
function getEnvAsInt(name: string, defaultVal: number): number { // Same thing, TypeScript style
  const value = process.env[name];                               // Check the env var
  if (value !== undefined) {                                     // If it exists...
    const parsed = parseInt(value, 10);                          // Try to parse it
    if (!isNaN(parsed)) return parsed;                           // Return if valid
  }
  return defaultVal;                                             // Otherwise return default
}
```

The other two helpers (`getEnvAsString`, `getEnvAsBool`) follow the same pattern. They live in `cmd/helpers.go` alongside `main.go`.

::: info Checkpoint
At this point we have: `package main`, imports, flag parsing with env var defaults. Our `cfg` struct is fully populated with port, auth method, and mock flags. Next up: logging and app creation.
:::

## The Logger

```go
    logger := slog.New(                            // Create a new structured logger
        slog.NewTextHandler(                       // Use text format (key=value pairs)
            os.Stdout,                             // Write to standard output
            &slog.HandlerOptions{                  // Logger options
                Level: cfg.LogLevel,               // Log level from config (DEBUG, INFO, WARN, ERROR)
            },                                     // Close the HandlerOptions struct
        ),                                         // Close the NewTextHandler call
    )                                              // Close the slog.New call
```

**What just happened?** `slog` is Go's built-in structured logging package (added in Go 1.21). It's similar to `pino` or `winston` in Node.js, but it ships with the standard library -- no `npm install` needed.

A log call like this:

```go
    logger.Info("starting server", "addr", srv.Addr) // Structured log: key-value pairs after the message
```

Produces output like this:

```
time=2024-01-15T10:30:00.000Z level=INFO msg="starting server" addr=:8080
```

**TypeScript equivalent:**

```typescript
import pino from 'pino';                           // Import pino logger
const logger = pino({ level: config.logLevel });   // Create logger with config level
logger.info({ addr: `:${port}` }, 'starting server'); // Structured log call
```

## Building the Application

Now comes the most important line in the whole file:

```go
    app, err := api.NewApp(cfg, logger)            // Create the App with all dependencies wired up
                                                   // NewApp decides real vs mock clients based on cfg
    if err != nil {                                // Check if app creation failed
        logger.Error(err.Error())                  // Log the error
        os.Exit(1)                                 // Exit with failure code (like process.exit(1))
    }                                              // If we get past this, app is ready to use
```

**What just happened?** `api.NewApp()` is a factory function that creates the `App` struct with all its dependencies wired up. This is where the BFF decides whether to use real or mock Kubernetes clients, initializes HTTP clients for upstream services, and sets up the internal state. We'll explore `NewApp()` in detail in [The App Struct & Routes](./app-and-routes).

Notice the `if err != nil` pattern -- you'll see this hundreds of times in Go. There's no `try/catch`. The function returns `(*App, error)` and you check the error immediately. When I first saw this, I thought it was tedious. After working with it for a while, I appreciated how it makes every failure point visible. We'll cover this in detail in the [Error Handling (Go Basics)](../go-basics/error-handling) chapter.

**TypeScript equivalent:**

```typescript
const app = await createApp(config, logger);       // Express/Fastify equivalent
// In TS you'd wrap this in try/catch              // Go makes the error check explicit instead
```

## The HTTP Server

Now we create and start the HTTP server:

```go
    srv := &http.Server{                           // Create a standard library HTTP server
        Addr:         fmt.Sprintf(":%d", cfg.Port),// Listen address -- ":8080" means all interfaces, port 8080
        Handler:      app.Routes(),                // The fully-configured router (like your Express app)
        IdleTimeout:  time.Minute,                 // Close idle connections after 1 minute
        ReadTimeout:  30 * time.Second,            // Max time to read the full request (headers + body)
        WriteTimeout: 30 * time.Second,            // Max time to write the full response
    }                                              // Server is configured but not yet started
```

**What just happened?** This creates a standard library `http.Server`. The key field is `Handler: app.Routes()` -- this returns an `http.Handler` with all the routes registered. Think of it as the fully-configured Express app being passed to `http.createServer()`. The timeout fields are explicit here -- Express leaves these to defaults or requires manual configuration.

Now start it:

```go
    logger.Info("starting server", "addr", srv.Addr) // Log that we're about to start
    if err := srv.ListenAndServe(); err != nil {     // Start listening -- this BLOCKS until server stops
        logger.Error("server failed", "error", err)  // Log the failure
        os.Exit(1)                                   // Exit with failure code
    }                                                // We only get here if the server crashes
```

**TypeScript equivalent:**

```typescript
const server = app.listen(config.port, () => {     // Start listening
  logger.info(`Server running on :${config.port}`);// Log on success
});

// The Go version is more explicit about timeouts:
server.keepAliveTimeout = 60000;                   // Go: IdleTimeout
server.headersTimeout = 30000;                     // Go: ReadTimeout
```

::: warning Common Gotcha
In Go, `http.ListenAndServe()` blocks the current goroutine. If you need to do things after the server starts (like graceful shutdown), you need to run it in a goroutine with `go func() { ... }()`. The real gen-ai BFF does exactly this for graceful shutdown support.
:::

::: info Checkpoint
We now have the complete simple version of `main.go`: parse flags, create logger, build app, start server. That's the whole story for a basic BFF. But the real BFFs in the repo are more sophisticated -- they handle graceful shutdown. Let's look at that next.
:::

## The Real Thing: Graceful Shutdown

The actual BFFs in the repo don't just call `ListenAndServe()` and hope for the best. They handle shutdown signals so in-flight requests can finish gracefully. Here's the pattern from the gen-ai BFF:

```go
    // Start the server in a goroutine so main() can continue
    go func() {                                    // go func() launches a background goroutine
        logger.Info("starting server", "addr", srv.Addr) // Log from inside the goroutine
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            // ListenAndServe returns ErrServerClosed on graceful shutdown -- that's expected
            logger.Error("server failed", "error", err) // Only log unexpected errors
        }
    }()                                            // () at the end immediately calls the function

    // Main goroutine: wait for interrupt signal (Ctrl+C)
    shutdownCh := make(chan os.Signal, 1)           // Create a channel to receive OS signals
    signal.Notify(shutdownCh,                       // Tell Go to send these signals to our channel
        os.Interrupt,                               // Ctrl+C
        syscall.SIGINT,                             // Same as Ctrl+C but explicit
        syscall.SIGTERM,                            // "please stop" (sent by Kubernetes)
        syscall.SIGHUP)                             // Terminal closed

    <-shutdownCh                                   // Block here until a signal arrives
                                                   // This is like await on a promise that resolves on Ctrl+C
    logger.Info("shutting down gracefully...")      // We received the signal -- time to shut down
```

**What just happened?** The server runs in a background goroutine (think of it as a lightweight thread), while the main goroutine sits and waits for Ctrl+C. The `<-shutdownCh` line blocks until a signal arrives -- it's conceptually similar to `await` on a promise that resolves when someone hits Ctrl+C.

Now the graceful shutdown itself:

```go
    // Give in-flight requests time to complete
    ctx, cancel := context.WithTimeout(            // Create a context that expires after 30 seconds
        context.Background(),                      // Start from an empty context
        30*time.Second)                            // 30-second deadline
    defer cancel()                                 // Clean up the context when we're done

    if err := srv.Shutdown(ctx); err != nil {      // Tell the server to stop accepting new connections
                                                   // and wait for existing ones to finish (up to 30s)
        logger.Error("server shutdown failed", "error", err) // Log if shutdown didn't complete in time
    }

    // Clean up application resources (mock servers, K8s watches, etc.)
    if err := app.Shutdown(); err != nil {          // The App also needs to clean up
        logger.Error("app shutdown failed", "error", err) // This stops envtest, closes connections, etc.
    }

    logger.Info("server stopped")                  // All done
```

**What just happened?** Don't worry about goroutines and channels yet. The important thing to understand is:
1. The server runs in the background (`go func()`)
2. The main goroutine waits for Ctrl+C
3. On shutdown, it gives in-flight requests 30 seconds to finish
4. Then it cleans up resources (like mock K8s environments)

## The Mock Flags

The most important flags for day-to-day development are the `--mock-*` flags:

```go
    flag.BoolVar(&cfg.MockK8sClient,               // Boolean flag for mocking Kubernetes
        "mock-k8s-client",                         // Usage: --mock-k8s-client
        false,                                     // Default: use real K8s (or check env var)
        "Use mock K8s client")                     // Help text

    flag.BoolVar(&cfg.MockLSClient,                // Boolean flag for mocking LlamaStack
        "mock-ls-client",                          // Usage: --mock-ls-client
        false,                                     // Default: use real LlamaStack
        "Use mock LlamaStack client")              // Help text

    flag.BoolVar(&cfg.MockMCPClient,               // Boolean flag for mocking MCP
        "mock-mcp-client",                         // Usage: --mock-mcp-client
        false,                                     // Default: use real MCP
        "Use mock MCP client")                     // Help text
```

**What just happened?** These let you run the BFF **without a real Kubernetes cluster or upstream services**. When `--mock-k8s-client` is set, the BFF uses Go's `envtest` framework to spin up a lightweight, in-memory Kubernetes API server. This is how Cypress tests and local development work without a cluster.

Running a BFF locally:

```bash
# With all mocks (no cluster needed)
go run ./cmd --mock-k8s-client --mock-ls-client --port 8080

# Against a real cluster (need kubeconfig)
go run ./cmd --port 8080
```

## The Complete File

Let's put it all together. Here's the simplified `main.go` with every line commented:

```go
package main                                       // Entry point package -- required for Go executables

import (                                           // All imports grouped at the top
    "context"                                      // Context for timeout management
    "flag"                                         // CLI flag parsing
    "fmt"                                          // String formatting
    "log/slog"                                     // Structured logging
    "net/http"                                     // HTTP server
    "os"                                           // OS-level operations
    "os/signal"                                    // Signal handling for graceful shutdown
    "syscall"                                      // System call constants (SIGTERM, SIGINT)
    "time"                                         // Time durations

    "github.com/opendatahub-io/your-module/internal/api"    // Our App and Routes
    "github.com/opendatahub-io/your-module/internal/config" // Our config struct
)

func main() {                                      // Program entry point
    var cfg config.EnvConfig                       // Declare config struct (all fields zero-valued)

    // Parse CLI flags with env var fallbacks
    flag.IntVar(&cfg.Port, "port",                 // --port flag
        getEnvAsInt("PORT", 8080), "API server port")
    flag.StringVar(&cfg.AuthMethod, "auth-method", // --auth-method flag
        getEnvAsString("AUTH_METHOD", "user_token"), "Authentication method")
    flag.BoolVar(&cfg.MockK8sClient, "mock-k8s-client", // --mock-k8s-client flag
        getEnvAsBool("MOCK_K8S_CLIENT", false), "Use mock Kubernetes client")
    flag.Parse()                                   // Parse os.Args and populate cfg

    // Create a structured logger
    logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
        Level: cfg.LogLevel,                       // Log level from config
    }))

    // Build the application (wire up all dependencies)
    app, err := api.NewApp(cfg, logger)            // Factory function creates the App
    if err != nil {                                // Check for initialization errors
        logger.Error(err.Error())                  // Log the error
        os.Exit(1)                                 // Exit immediately
    }

    // Configure the HTTP server
    srv := &http.Server{                           // Standard library HTTP server
        Addr:         fmt.Sprintf(":%d", cfg.Port),// Listen address
        Handler:      app.Routes(),                // All routes and middleware
        IdleTimeout:  time.Minute,                 // Keep-alive timeout
        ReadTimeout:  30 * time.Second,            // Request read timeout
        WriteTimeout: 30 * time.Second,            // Response write timeout
    }

    // Start the server in a background goroutine
    go func() {                                    // Launch background goroutine
        logger.Info("starting server", "addr", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            logger.Error("server failed", "error", err)
        }
    }()

    // Wait for shutdown signal
    shutdownCh := make(chan os.Signal, 1)           // Channel for OS signals
    signal.Notify(shutdownCh, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)
    <-shutdownCh                                   // Block until signal received

    // Graceful shutdown
    logger.Info("shutting down gracefully...")
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()                                 // Clean up timeout context

    if err := srv.Shutdown(ctx); err != nil {      // Stop accepting, drain in-flight
        logger.Error("server shutdown failed", "error", err)
    }
    if err := app.Shutdown(); err != nil {          // Clean up app resources
        logger.Error("app shutdown failed", "error", err)
    }
    logger.Info("server stopped")                  // Done
}
```

::: tip Key Takeaway
The entry point (`cmd/main.go`) follows a predictable pattern across all BFFs: parse flags with env var fallbacks, create a logger, build the `App` with `NewApp()`, and start the HTTP server. The mock flags (`--mock-k8s-client`, etc.) are your best friend for local development -- they let you run the BFF without any external dependencies. The graceful shutdown pattern with goroutines and signal handling is standard across production Go services.
:::

::: info See Also
- [The App Struct & Routes](./app-and-routes) -- what happens inside `api.NewApp()` and `app.Routes()`
- [Error Handling (Go Basics)](../go-basics/error-handling) -- the `if err != nil` pattern explained
- [Pointers](../go-basics/pointers) -- why flag parsing uses `&cfg.Port`
:::
