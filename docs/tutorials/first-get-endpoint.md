# Tutorial 1: Your First GET Endpoint

You are about to write your first Go handler. By the end of this tutorial, you will have a brand new endpoint -- `/api/v1/healthcheck/detailed` -- that returns real system information as JSON. You will build it from scratch, file by file, line by line, and test it with `curl`.

No Go experience required. Just your editor, your terminal, and a willingness to type things you do not fully understand yet (you will understand them by the end).

**Time:** ~20 minutes

## What You Are Building

The existing `/healthcheck` endpoint returns a basic status. You are going to build a fancier version that returns detailed system information. When you hit it with `curl`, you will get this back:

```json
{
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "go_version": "go1.24.3",
    "uptime_seconds": 42
  }
}
```

This is a realistic task. You might need a detailed healthcheck for a monitoring dashboard, for debugging deployments, or for a status page.

## Step 1: Open the BFF in Your Editor

Open VS Code (or whatever editor you use). Navigate to this directory:

```
packages/automl/bff/
```

Take a quick look at the directory structure. You will be working in two directories:

```
packages/automl/bff/
├── cmd/                    # The entry point -- where main() lives
├── internal/
│   ├── api/                # Handlers and routing -- THIS IS WHERE YOUR CODE GOES
│   ├── config/             # Configuration structs
│   ├── constants/          # Path constants, header keys
│   ├── integrations/       # External service clients (Kubernetes, etc.)
│   ├── models/             # Data structures (DTOs) -- THIS IS WHERE YOUR CODE GOES
│   └── repositories/       # Business logic layer
├── go.mod                  # Like package.json for Go
└── go.sum                  # Like package-lock.json
```

You will create two new files: one in `internal/models/` and one in `internal/api/`. Then you will edit one existing file in `internal/api/`.

## Step 2: Define the Response Model

Every BFF endpoint starts with a model -- a struct that defines the shape of the JSON response.

In TypeScript, you would write this:

```typescript
interface DetailedHealth {       // Define the shape of the response
  status: string;                // "healthy" or "unhealthy"
  go_version: string;            // The Go runtime version
  version: string;               // The BFF application version
  uptime_seconds: number;        // How long the server has been running
}
```

Now let's write the Go equivalent. Create a new file at this exact path:

```
packages/automl/bff/internal/models/detailed_health.go
```

Type this into the file:

```go
package models                        // Every file declares its package -- must match the directory name

// DetailedHealth represents an extended healthcheck response
// with system information useful for debugging and monitoring.
type DetailedHealth struct {          // 'type X struct' is like 'interface X' in TypeScript
	Status        string `json:"status"`          // Backtick tags tell Go's JSON encoder the key name
	Version       string `json:"version"`         // Without the tag, this would serialize as "Version" (uppercase)
	GoVersion     string `json:"go_version"`      // The tag maps GoVersion (Go style) to go_version (JSON style)
	UptimeSeconds int64  `json:"uptime_seconds"`  // int64 is a 64-bit integer -- like 'number' in TypeScript
}
```

Let's break down what is happening on every line:

- **`package models`** -- This file belongs to the `models` package. In Go, every file must declare its package, and the package name must match the directory name. Think of it like `namespace` but enforced by the compiler.
- **`type DetailedHealth struct`** -- This defines a new type called `DetailedHealth` that is a struct (a collection of named fields). It starts with an uppercase letter, which means it is exported -- other packages can use it. If you wrote `type detailedHealth struct`, it would be private to this package.
- **`` `json:"status"` ``** -- These backtick annotations are called "struct tags." They tell Go's JSON encoder to use `"status"` as the key name instead of `"Status"`. Without the tag, your JSON would have uppercase keys, which is not what APIs typically want.

**What you should see:** Save the file. VS Code should show no errors -- no red squiggles, no problems in the terminal. If you see `package models` underlined in red, make sure your file is in the `internal/models/` directory.

::: info Why Separate Structs Instead of One Interface?
In TypeScript, you might define one `interface` and use `Pick` or `Omit` to create variations. In Go, the convention is to define separate structs for request and response shapes. They are cheap (no runtime cost, no class instantiation), they are self-documenting, and they avoid confusion about which shape goes where.
:::

## Step 3: Write the Handler

The handler is the function that runs when someone hits your endpoint. In Express, this is your route handler -- the `(req, res) => { ... }` function. In Go, it looks different but does the same thing.

Create a new file at:

```
packages/automl/bff/internal/api/detailed_health_handler.go
```

We will build this file piece by piece. Start with the package declaration and imports:

```go
package api                            // This file belongs to the 'api' package

import (                               // Go groups all imports in one block
	"net/http"                         // Standard library -- HTTP status codes and types
	"runtime"                          // Standard library -- runtime info like Go version
	"time"                             // Standard library -- time operations

	"github.com/julienschmidt/httprouter"                                    // The HTTP router all BFFs use
	"github.com/opendatahub-io/automl-library/bff/internal/models"           // Our models package with DetailedHealth
)
```

::: tip VS Code Auto-Imports
If you have the Go extension installed, VS Code will manage your imports automatically. When you save, it adds missing imports and removes unused ones. You can type the code without the `import` block and let VS Code fill it in. But for this tutorial, we will be explicit so you know exactly what is being imported.
:::

Now add the package-level variable that tracks when the server started:

```go
// serverStartTime records when the server started.
// This is a package-level variable -- it gets set once when the package is loaded,
// before any handler runs. Like 'const startTime = Date.now()' at module scope in TypeScript.
var serverStartTime = time.Now()       // time.Now() returns the current time
```

Next, define the response envelope type:

```go
// DetailedHealthEnvelope wraps the response in the standard { "data": ... } structure.
// Every BFF response uses an envelope. Envelope is a generic type defined elsewhere in the api package.
// The [*models.DetailedHealth, None] means: the data field is a pointer to DetailedHealth, and there's no metadata.
type DetailedHealthEnvelope Envelope[*models.DetailedHealth, None]
```

Finally, write the handler itself:

```go
// DetailedHealthcheckHandler returns extended system information.
// This is a method on the App struct -- the (app *App) part is the "receiver."
// Think of it like a class method: app is 'this', and you access shared resources through it.
func (app *App) DetailedHealthcheckHandler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	// w is the ResponseWriter -- like 'res' in Express. You write your response to it.
	// r is the Request -- like 'req' in Express. Contains headers, body, URL, etc.
	// _ is the route params (like req.params). We use _ because we don't need any params.

	// Build the response data by filling in each field of our struct
	health := &models.DetailedHealth{         // & means "create a pointer to this struct"
		Status:        "healthy",             // Hard-coded for now -- a real check might verify dependencies
		Version:       Version,               // Version is a constant defined in app.go (like a package version string)
		GoVersion:     runtime.Version(),     // runtime.Version() returns "go1.24.3" -- like process.version in Node
		UptimeSeconds: int64(time.Since(serverStartTime).Seconds()),
		// time.Since(serverStartTime) gives a Duration -- .Seconds() converts to float64
		// int64(...) truncates the float to a whole number
	}

	// Wrap the data in the standard envelope
	envelope := DetailedHealthEnvelope{       // Create the envelope with our health data
		Data: health,                         // This becomes { "data": { "status": "healthy", ... } }
	}

	// Write the JSON response
	// app.WriteJSON does: set Content-Type header, marshal to JSON, write to w
	// It's like res.status(200).json(data) in Express
	err := app.WriteJSON(w, http.StatusOK, envelope, nil)  // nil means no extra headers
	if err != nil {                           // If JSON serialization fails (very rare)
		app.serverErrorResponse(w, r, err)    // Write a 500 error response
	}
}
```

Let's map every key line to what you would write in Express:

| Go Line | Express Equivalent | What It Does |
|---------|-------------------|--------------|
| `var serverStartTime = time.Now()` | `const startTime = Date.now()` | Record when the server started, once, at module load |
| `func (app *App) DetailedHealthcheckHandler(...)` | `app.get('/path', (req, res) => { ... })` | Define a handler function -- `app` is like `this` |
| `_ httprouter.Params` | Ignoring `req.params` | The underscore means "I don't use this parameter" |
| `runtime.Version()` | `process.version` | Get the runtime's version string |
| `time.Since(serverStartTime).Seconds()` | `(Date.now() - startTime) / 1000` | Calculate uptime in seconds |
| `app.WriteJSON(w, http.StatusOK, envelope, nil)` | `res.status(200).json(data)` | Serialize and send the JSON response |
| `app.serverErrorResponse(w, r, err)` | Error middleware | Write a 500 error if something goes wrong |

**What you should see:** Save the file. No red squiggles. VS Code might rearrange your imports -- that is fine.

::: tip The Envelope Pattern
Notice the `Envelope[*models.DetailedHealth, None]` type. This wraps every response in a `{ "data": ... }` structure. The `None` means there is no metadata field. This pattern is used across all BFF handlers to keep API responses consistent. It is like having a standard response wrapper type in your Express middleware.
:::

## Step 4: Register the Route

You have a model and a handler, but the router does not know about them yet. You need to tell it: "when someone sends a GET request to `/api/v1/healthcheck/detailed`, call my handler."

Open the existing file:

```
packages/automl/bff/internal/api/app.go
```

Find the block of constants near the top. It will look something like this:

```go
const (
	Version                 = "1.0.0"              // Application version string
	PathPrefix              = "/automl"             // URL prefix for this BFF
	ApiPathPrefix           = "/api/v1"             // API version prefix
	HealthCheckPath         = "/healthcheck"        // Basic healthcheck endpoint
	UserPath                = ApiPathPrefix + "/user"  // User info endpoint
	// ... more constants
)
```

Add your new path constant. Put it right after `HealthCheckPath`:

```go
	DetailedHealthCheckPath = ApiPathPrefix + "/healthcheck/detailed"  // ADD THIS LINE
```

Now scroll down to the `Routes()` method. It looks something like this:

```go
func (app *App) Routes() http.Handler {                // Routes sets up all HTTP routes
	apiRouter := httprouter.New()                      // Create a new router instance

	apiRouter.NotFound = http.HandlerFunc(app.notFoundResponse)             // Handle 404s
	apiRouter.MethodNotAllowed = http.HandlerFunc(app.methodNotAllowedResponse)  // Handle 405s

	// ... existing route registrations
```

Add your route registration. Put it before the `UserPath` registration:

```go
	// Detailed healthcheck -- no auth required (monitoring systems need to reach it)
	apiRouter.GET(DetailedHealthCheckPath, app.DetailedHealthcheckHandler)  // ADD THIS LINE
```

::: info Why No Middleware?
Notice this route does not have `app.AttachNamespace(...)` or `app.RequireAccessToPipelineServers(...)` wrapping it. Healthcheck endpoints are intentionally unauthenticated -- monitoring systems need to reach them without credentials. Compare this to routes like `PipelineRunsPath` which have a full middleware chain for auth, namespace validation, and permission checks.
:::

**What you should see:** Save the file. No errors. The import list should not change since you are only using types that are already imported.

## Step 5: Make Sure It Compiles

Before running anything, let's make sure the whole BFF compiles without errors. Open your terminal:

```bash
cd packages/automl/bff    # Navigate to the BFF directory
go build ./...             # Compile everything
```

**What you should see:** No output at all. Silence is golden in Go -- no output means no errors. Your code compiled successfully.

If you see errors, check these common causes:
- Every file has the correct `package` declaration (`package models` for files in `models/`, `package api` for files in `api/`)
- All imports are present (VS Code usually handles this automatically)
- The struct field names in the handler match the field names in the model exactly
- You spelled `DetailedHealthcheckHandler` the same way in both the handler file and `app.go`

## Step 6: Run the BFF and Test It

This is the moment of truth. Start the BFF with mock clients so you do not need a real Kubernetes cluster:

```bash
cd packages/automl/bff
go run ./cmd --dev-mode --mock-k8s-client --mock-pipeline-server-client --mock-s3-client
```

**What you should see:**

```
time=2024-01-01T10:00:00.000Z level=INFO msg="Using mock Pipeline Server client factory"
time=2024-01-01T10:00:00.000Z level=INFO msg="Using mock S3 client factory"
time=2024-01-01T10:00:00.000Z level=INFO msg="Server starting" port=4003
```

The server is running on port 4003. Leave that terminal running and open a **new terminal window**. Now hit your endpoint:

```bash
curl -s http://localhost:4003/api/v1/healthcheck/detailed | jq .
```

Cross your fingers. You should see:

```json
{
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "go_version": "go1.24.3",
    "uptime_seconds": 5
  }
}
```

**You just built a working BFF endpoint from scratch.** The `go_version` will match whatever version you have installed. The `uptime_seconds` will be a small number that increases every time you call the endpoint.

::: tip jq Is Optional
The `| jq .` part just pretty-prints the JSON. If you do not have `jq` installed, plain `curl` will show the raw JSON on one line. It works either way.
:::

Run it again a few seconds later:

```bash
curl -s http://localhost:4003/api/v1/healthcheck/detailed | jq .uptime_seconds
```

**What you should see:** A larger number than before. The uptime counter works.

## Step 7: Verify the Error Path

Let's make sure the BFF handles bad requests correctly. Try hitting a URL that does not exist:

```bash
curl -s http://localhost:4003/api/v1/healthcheck/nonexistent | jq .
```

**What you should see:**

```json
{
  "error": {
    "code": "404",
    "message": "the requested resource could not be found"
  }
}
```

This is the standard error envelope. Every BFF uses this exact structure for errors -- `{ "error": { "code": "...", "message": "..." } }`. You did not have to write this -- it comes from the `notFoundResponse` handler that the router calls automatically for unknown paths.

Also verify the original healthcheck still works:

```bash
curl -s http://localhost:4003/healthcheck | jq .
```

Good -- you did not break anything that was already there.

Press `Ctrl+C` in the terminal running the server to stop it.

## What You Built

Let's recap the three files you touched:

| File | What You Did | Express Equivalent |
|------|-------------|-------------------|
| `internal/models/detailed_health.go` | Defined the response shape (new file) | Defining a TypeScript interface for the response |
| `internal/api/detailed_health_handler.go` | Wrote the handler function (new file) | Writing the `(req, res) => { ... }` function |
| `internal/api/app.go` | Added path constant + registered the route | Adding `app.get('/path', handler)` |

This is the standard workflow for adding **any** GET endpoint to a BFF:

1. **Model** -- Define the response struct in `internal/models/`
2. **Handler** -- Write the handler function in `internal/api/`
3. **Route** -- Register it in `Routes()` inside `app.go`
4. **Test** -- Run and verify (we will automate this with Go tests in [Tutorial 3](./writing-tests))

Every endpoint in every BFF follows this same three-step pattern. Once you have done it once, you can do it in your sleep.

---

<div class="checkpoint">

#### Checkpoint

Before moving on, verify all of these:

- [ ] `go build ./...` completes with zero output (no errors)
- [ ] `curl http://localhost:4003/api/v1/healthcheck/detailed` returns JSON with `status`, `version`, `go_version`, and `uptime_seconds`
- [ ] The `uptime_seconds` value increases on repeated calls
- [ ] Hitting a non-existent path returns the error envelope with a 404
- [ ] The original `/healthcheck` endpoint still works

If any of these fail, go back and re-read the step where you created that file. The most common mistake is a typo in a function name or a missing import.

</div>

## Congratulations

You just wrote your first BFF endpoint. It was not that scary, was it? A struct, a function, a route registration, and some `curl`. You now know the fundamental pattern that every BFF endpoint in the entire repo follows.

## What's Next

You have added a read-only endpoint. But most real features involve the frontend sending data *to* the BFF -- form submissions, configuration updates, resource creation. In the next tutorial, [POST with Validation](./post-with-validation), you will handle incoming data: reading a JSON request body, validating fields, and returning meaningful error messages when the input is wrong.
