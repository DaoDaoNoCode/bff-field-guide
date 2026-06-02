# Debugging

> **When things go wrong** -- your handler returns a 500 and the logs say "nil pointer dereference". Now what?

In React, you'd open the browser DevTools, set a breakpoint, and step through the code. In Go, the same workflow exists -- it just lives in a different place. This chapter covers every debugging technique you'll actually use, from quick `console.log`-style logging to full VS Code breakpoints with variable inspection.

## Print Debugging with slog

The fastest way to figure out what's happening. You already do this in TypeScript:

```typescript
// TypeScript -- your old friend
console.log('hit the handler', { namespace, identity });
```

The Go equivalent uses structured logging:

```go
// Go -- same idea, structured key-value pairs
logger := helper.GetContextLoggerFromReq(r)          // Get the request-scoped logger
logger.Debug("hit the handler",                      // Message first
    "namespace", namespace,                          // Then key-value pairs
    "identity", identity,                            // As many as you need
)
```

The logger is attached to the request context by middleware, so every log line automatically includes the request ID and other metadata. No need to manually thread that through.

::: warning Debug Output is Hidden by Default
`logger.Debug()` lines won't appear unless you start the BFF with `--log-level=debug`. The default level is `info`, which swallows Debug-level output. If you add a debug log and see nothing, this is why.

```bash
# Start with debug logging enabled
go run ./cmd --dev-mode --mock-k8s-client --log-level=debug
```
:::

Use `logger.Info()` instead of `logger.Debug()` if you want output without changing the log level. Just remember to remove it before committing -- info-level logs ship to production.

## VS Code Debugging with Delve

Print debugging gets you far, but sometimes you need to pause execution and inspect the full state. VS Code + Delve gives you the exact same breakpoint experience you have with TypeScript.

### Step 1: Install Delve

Open the VS Code command palette (`Cmd+Shift+P`) and run:

```
Go: Install/Update Tools
```

Select `dlv` (Delve) from the list and install it. This is a one-time setup.

### Step 2: Create a Launch Configuration

Add this to `.vscode/launch.json` in your project root:

```json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "Debug BFF",
    "type": "go",
    "request": "launch",
    "mode": "auto",
    "program": "${workspaceFolder}/packages/automl/bff/cmd",
    "args": [
      "--dev-mode",
      "--mock-k8s-client",
      "--mock-pipeline-server-client",
      "--mock-s3-client"
    ],
    "env": {
      "PORT": "4003"
    }
  }]
}
```

Adjust `program` to point at the `cmd` directory of whichever BFF you're debugging. The `args` array mirrors what you'd pass on the command line -- mock flags keep the server running without a real cluster.

### Step 3: Set Breakpoints and Run

This part works identically to TypeScript debugging:

| Action | Shortcut | What It Does |
|---|---|---|
| Set breakpoint | Click the gutter | Red dot appears -- execution will pause here |
| Start debugging | `F5` | Launches the BFF with Delve attached |
| Step over | `F10` | Execute current line, move to next |
| Step into | `F11` | Jump into the function being called |
| Step out | `Shift+F11` | Finish current function, return to caller |
| Continue | `F5` | Resume execution until next breakpoint |

The Variables panel shows local variables and their current values. The Watch panel lets you add expressions -- same as in JS debugging. The Call Stack panel shows you exactly how you got to the current line.

::: tip Breakpoints in Middleware Too
You can set breakpoints in middleware functions, not just handlers. This is especially useful for debugging auth issues -- drop a breakpoint in `RequireAccess` to see exactly what user and permissions are being checked.
:::

## Debugging Common BFF Scenarios

These are the errors you'll hit most often, and what to do about each one.

### "nil pointer dereference"

The number one crash in Go BFFs. This almost always means a middleware didn't set a context value, and your handler tried to use it without checking.

```go
// This crashes if the middleware didn't set the identity:
identity := ctx.Value(constants.RequestIdentityKey).(*RequestIdentity)
// identity is nil --> calling identity.Username panics

// Defensive version that won't crash:
identity, ok := ctx.Value(constants.RequestIdentityKey).(*RequestIdentity)
if !ok || identity == nil {                          // Check BOTH the type assertion and nil
    app.serverErrorResponse(w, r,                    // Return a clean 500
        fmt.Errorf("request identity not found in context"))
    return                                           // Stop here -- don't continue
}
```

The `ok` check on the type assertion is like optional chaining in TypeScript. Without it, a missing context value causes a panic (Go's version of an unhandled exception) instead of a graceful error.

**Debugging steps:** Set a breakpoint at the line that panics. Check the Variables panel -- is the context value `nil`? If so, trace backwards through the middleware chain. Is the route registered with the right middleware wrappers in `app.go`?

### "handler never gets called"

You added a handler, registered the route, but hitting the endpoint returns 404.

**Check these in order:**

1. **Route registration in `app.go`** -- Is the path constant spelled correctly? Does it match what the frontend is calling?
2. **HTTP method** -- Did you register a `GET` but the frontend sends a `POST`?
3. **Path parameter syntax** -- httprouter uses `:id`, not `{id}` or `[id]`. A mismatch means the route simply doesn't exist.
4. **Middleware wrapping** -- Some middleware patterns return a new handler. If you forgot to wrap your handler, the route exists but points at the wrong function.

Drop a breakpoint at the top of your handler. If it never hits, the problem is in route registration, not in the handler itself.

### "403 but I should have access"

The SAR (SubjectAccessReview) or SSAR check is rejecting the request. The BFF asks Kubernetes "can this user do X?" and Kubernetes said no.

**Debugging steps:**

1. Add debug logging in the `RequireAccess` middleware to see exactly what's being checked:

```go
logger.Debug("checking access",
    "user", identity.Username,                       // Who is making the request?
    "namespace", namespace,                          // In which namespace?
    "resource", resource,                            // What resource type?
    "verb", verb,                                    // What action? (get, list, create, delete)
)
```

2. Compare those values against what you expect. Common mistakes: wrong namespace (empty string vs actual namespace), wrong resource name (plural vs singular), wrong API group.

3. In mock mode, SAR checks might be stubbed. If you're only seeing the 403 on a real cluster, the issue is likely a missing `RoleBinding` -- not a code bug.

### "empty response body"

The request succeeds (200 status) but the response body is empty or `null`.

Two causes, both easy to miss:

```go
// Cause 1: forgot to call WriteJSON
func (app *App) MyHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    data := fetchData()                              // Got the data...
    // ...but never wrote it to the response!         // Oops -- handler returns with empty body
}

// Cause 2: forgot to return after an error
func (app *App) MyHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    data, err := fetchData()
    if err != nil {
        app.serverErrorResponse(w, r, err)           // Wrote the error...
        // Missing return!                            // Handler keeps going and overwrites
    }
    app.WriteJSON(w, http.StatusOK, data, nil)       // This runs even after the error
}
```

In Express, `res.json()` ends the response implicitly. In Go, writing to `w` doesn't stop execution. You must `return` explicitly after every error response.

## Debugging Tests

Go tests run in VS Code just like Jest tests. Above every `func Test...` function, VS Code shows two clickable links: **run test** and **debug test**.

Click **debug test** to launch that single test with Delve attached. Your breakpoints work, the Variables panel works, everything works exactly like debugging the server -- except the test runner is the entry point instead of `main.go`.

For more control, add a test configuration to `.vscode/launch.json`:

```json
{
  "name": "Debug Specific Test",
  "type": "go",
  "request": "launch",
  "mode": "test",
  "program": "${workspaceFolder}/packages/automl/bff/internal/api",
  "args": ["-run", "TestCreatePipeline"]
}
```

Set `program` to the package directory containing the test, and `-run` to the test function name (or a regex matching multiple tests). This is equivalent to running `jest --testNamePattern "TestCreatePipeline"`.

## Quick Reference: JS Debugging to Go Debugging

| Task | JavaScript / TypeScript | Go |
|---|---|---|
| Print debug | `console.log(value)` | `logger.Debug("msg", "key", value)` |
| Breakpoints | Click gutter in VS Code | Click gutter in VS Code (identical) |
| Start debugger | F5 (Node.js launch config) | F5 (Go launch config with Delve) |
| Step over / into | F10 / F11 | F10 / F11 (identical) |
| Inspect variable | Hover or Variables panel | Hover or Variables panel (identical) |
| Debug one test | Jest: click "Debug" above test | Go: click "debug test" above test |
| Conditional log | `if (debug) console.log(...)` | Use `logger.Debug()` + `--log-level=debug` flag |
| Stack trace on crash | Automatic in DevTools | Automatic in terminal (goroutine stack printed) |
| Watch expression | Watch panel | Watch panel (identical) |

::: tip Key Takeaway
Go debugging in VS Code is almost identical to TypeScript debugging. The same shortcuts, the same panels, the same workflow. The only real difference is the launch configuration -- point it at your BFF's `cmd` directory with the right mock flags, and everything else works the way you already know. For quick investigations, `logger.Debug()` with `--log-level=debug` is your `console.log`.
:::

::: info See Also
- [Entry Point (main.go)](./entry-point) -- the flags that control logging and mock mode
- [Writing Handlers](./handlers) -- the handler patterns you'll be debugging
- [Common Gotchas](/reference/gotchas) -- the mistakes that cause most bugs
:::
