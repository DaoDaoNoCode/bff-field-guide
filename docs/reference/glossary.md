# Glossary

Terms and concepts you will encounter when working on Go BFFs. Each definition includes what it means, the TypeScript/JavaScript equivalent (if there is one), where you will see it in BFF code, and a code example.

## B

### BFF (Backend-for-Frontend)

A small backend service that exists solely to serve one specific frontend. In ODH Dashboard, each BFF is a Go HTTP server that sits between the React app and Kubernetes or upstream services. It handles authentication, RBAC checks, data transformation, and API orchestration so the frontend can make simple `fetch()` calls.

**TypeScript equivalent:** Like a dedicated Express server that only your React app talks to, instead of calling external APIs directly from the browser.

**Where you will see it:** The `bff/` directory inside each package (e.g., `packages/automl/bff/`, `packages/gen-ai/bff/`).

```go
// The BFF server starts in cmd/main.go
func main() {                          // Entry point of the BFF server
    app := api.NewApp(config, logger)  // Create the application with all its dependencies
    server := &http.Server{            // Configure the HTTP server
        Addr:    ":4003",              // Listen on port 4003
        Handler: app.Routes(),         // Use the app's router for all requests
    }
    server.ListenAndServe()            // Start accepting connections
}
```

---

### Blank Identifier (`_`)

The underscore character used to explicitly discard a value. Go requires all declared variables to be used -- `_` is the escape hatch for values you need to receive but do not need.

**TypeScript equivalent:** Destructuring with skipping: `const [, error] = useQuery()` or `const { data: _ , ...rest } = obj`.

**Where you will see it:** Everywhere. Ignoring the index in a `range` loop, ignoring one of two return values, satisfying the compiler when you do not need a parameter.

```go
_, err := someFunction()               // Ignore the first return value, keep the error
for _, item := range items { ... }     // Ignore the index, keep the value
func handler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) { ... }
                                        // Ignore the route params -- this handler doesn't use them
```

## C

### Channel

A typed conduit for sending values between goroutines. Channels are Go's primary concurrency primitive -- they let goroutines communicate without shared memory.

**TypeScript equivalent:** Conceptually like a `Promise` that can be resolved from one async context and awaited in another, but channels can carry multiple values over time (more like an `AsyncIterator` or an event emitter).

**Where you will see it:** Rarely in BFF handler code. More common in background workers, connection pools, and the Go runtime itself.

```go
ch := make(chan string)                // Create a channel that carries strings
go func() {                           // Launch a goroutine (runs concurrently)
    ch <- "hello"                     // Send a value into the channel
}()
msg := <-ch                           // Receive a value from the channel (blocks until available)
fmt.Println(msg)                      // Prints "hello"
```

---

### Context (`context.Context`)

A standard library type for carrying request-scoped data, deadlines, and cancellation signals through the call chain. Every HTTP handler receives a context via `r.Context()`.

**TypeScript equivalent:** Like React Context, but for server-side request handling. It carries data (user identity, namespace, deadlines) through the middleware chain without passing it as function parameters.

**Where you will see it:** In every handler and middleware. The BFF middleware attaches user identity and namespace to the context, and handlers extract them.

```go
ctx := r.Context()                     // Get the context from the HTTP request
identity := ctx.Value(                 // Extract a value from the context
    constants.RequestIdentityKey,      // Using a key constant
).(*kubernetes.RequestIdentity)        // Type-assert to the expected type
```

## D

### defer

A keyword that schedules a function call to run when the enclosing function returns. Used for cleanup -- closing files, releasing connections, unlocking mutexes.

**TypeScript equivalent:** Like a `finally` block, but you write it right after acquiring the resource instead of at the bottom of a try/catch. Also similar to the cleanup function returned from React's `useEffect`.

**Where you will see it:** After opening files, acquiring database connections, or any resource that needs cleanup.

```go
f, err := os.Open("data.csv")         // Open a file
if err != nil { return err }           // Handle the error
defer f.Close()                        // Schedule Close() to run when this function exits
                                       // Even if the function panics, defer still runs
// ... use f for the rest of the function ...
// f.Close() is called automatically when the function returns
```

---

### DTO (Data Transfer Object)

A struct whose sole purpose is to define the shape of data transferred over an API. In the BFF, DTOs live in `internal/models/` and correspond to JSON request and response bodies.

**TypeScript equivalent:** A TypeScript `interface` or `type` that defines an API payload shape.

**Where you will see it:** `internal/models/` in every BFF. One file per feature area, each containing request and response structs.

```go
type FeedbackRequest struct {          // DTO for incoming feedback
    Category string `json:"category"`  // JSON key mapping
    Message  string `json:"message"`   // JSON key mapping
    Severity int    `json:"severity"`  // JSON key mapping
}
```

## E

### Envelope

The standard response wrapper used by all BFF endpoints. Every success response is wrapped in `{ "data": ... }` and every error response in `{ "error": { "code": "...", "message": "..." } }`.

**TypeScript equivalent:** Like a generic response type: `type ApiResponse<T> = { data: T }`.

**Where you will see it:** Every handler creates an envelope before calling `app.WriteJSON()`.

```go
type Envelope[T any, M any] struct {   // Generic envelope type
    Data T `json:"data"`               // The payload -- could be any type
    Meta M `json:"meta,omitempty"`     // Optional metadata
}
```

---

### Exported / Unexported

Go's visibility system. Exported names start with an uppercase letter and are accessible from other packages. Unexported names start with a lowercase letter and are package-private. There is no `export` keyword.

**TypeScript equivalent:** `export` vs not exporting.

**Where you will see it:** Every function, type, and variable in every Go file. If you cannot access something from another package, check whether the first letter is uppercase.

```go
func GetUser() User { ... }            // Exported -- other packages can call this
func helper() { ... }                  // Unexported -- only callable within this package
type User struct { Name string }       // Exported type with exported field
type config struct { port int }        // Unexported type with unexported field
```

## G

### `go.mod`

The module definition file. Declares the module path, required Go version, and all dependencies. Every BFF has one at its root.

**TypeScript equivalent:** `package.json` -- but only the `name`, `version`, and `dependencies` fields. No `scripts`, no `devDependencies` distinction.

**Where you will see it:** `packages/automl/bff/go.mod`, `packages/gen-ai/bff/go.mod`, etc.

```go
module github.com/opendatahub-io/automl-library/bff  // Module path (like "name" in package.json)

go 1.26                                              // Required Go version

require (                                            // Dependencies (like "dependencies" in package.json)
    github.com/julienschmidt/httprouter v1.3.0       // The HTTP router
    github.com/stretchr/testify v1.11.1              // Assertion library for tests
)
```

---

### Goroutine

A lightweight concurrent function execution managed by the Go runtime. Goroutines are much cheaper than OS threads -- you can spawn thousands without performance concerns.

**TypeScript equivalent:** Like calling an `async` function without `await` -- it runs concurrently. But goroutines are true concurrency (can run in parallel on multiple CPU cores), not just async I/O scheduling.

**Where you will see it:** Background tasks, concurrent API calls, and the HTTP server itself (each incoming request runs in its own goroutine).

```go
go func() {                            // The 'go' keyword launches a goroutine
    result := expensiveComputation()   // Runs concurrently -- doesn't block the caller
    ch <- result                       // Send the result back via a channel
}()
// Code here continues immediately without waiting
```

## H

### Handler

A function that processes an HTTP request and writes a response. In ODH Dashboard BFFs, handlers are methods on the `App` struct.

**TypeScript equivalent:** An Express route handler: `(req: Request, res: Response) => void`.

**Where you will see it:** `internal/api/*_handler.go` -- one file per feature area.

```go
func (app *App) MyHandler(            // Method on App -- app is like 'this'
    w http.ResponseWriter,            // The response writer -- like 'res' in Express
    r *http.Request,                  // The request -- like 'req' in Express
    ps httprouter.Params,             // Route parameters -- like 'req.params'
) {
    // Read request, validate, process, write response
}
```

---

### httprouter

The HTTP router library used by all ODH Dashboard BFFs (`github.com/julienschmidt/httprouter`). It matches incoming requests to handlers by method and path pattern.

**TypeScript equivalent:** Express's `app.get()`, `app.post()` routing, but as a standalone, lightweight library.

**Where you will see it:** `internal/api/app.go` in the `Routes()` method.

```go
router := httprouter.New()                     // Create a new router
router.GET("/api/v1/users", app.UsersHandler)  // Register a GET route
router.POST("/api/v1/users", app.CreateUserHandler)  // Register a POST route
```

## I

### `internal/`

A special directory name enforced by the Go compiler. Packages inside `internal/` can only be imported by code within the parent module. External packages cannot import them.

**TypeScript equivalent:** No direct equivalent. It is like having a lint rule that prevents external imports from certain directories, but enforced by the compiler itself.

**Where you will see it:** Every BFF has this structure: `bff/internal/api/`, `bff/internal/models/`, `bff/internal/integrations/`.

```
bff/
├── cmd/              # Can import internal/*
├── internal/         # Everything here is private to this module
│   ├── api/          # Handlers, routing, middleware
│   ├── models/       # DTOs -- request/response structs
│   └── integrations/ # External service clients
```

---

### Interface

A set of method signatures. Any type that has all the methods automatically satisfies the interface -- no `implements` keyword needed. This is called "structural typing" or "duck typing."

**TypeScript equivalent:** TypeScript's structural typing for object shapes. If a TypeScript object has the right properties, it satisfies the interface. Same idea in Go, but with methods instead of properties.

**Where you will see it:** `KubernetesClientInterface`, `KubernetesClientFactory`, and every mock in the test files.

```go
type Writer interface {                // Define an interface -- just method signatures
    Write(p []byte) (n int, err error) // Any type with this method satisfies Writer
}
// No "implements Writer" needed -- if a type has Write(), it IS a Writer
```

## M

### Middleware

A function that wraps a handler to add cross-cutting behavior -- authentication, logging, CORS, namespace validation. Middleware takes a handler and returns a new handler.

**TypeScript equivalent:** Express middleware: `app.use((req, res, next) => { ...; next(); })`.

**Where you will see it:** `internal/api/middleware.go` -- middleware functions like `AttachNamespace`, `RequireAccessToService`, `InjectRequestIdentity`.

```go
func (app *App) AttachNamespace(       // Middleware function
    next httprouter.Handle,            // The handler to wrap
) httprouter.Handle {                  // Returns a new handler
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        namespace := ps.ByName("namespace")  // Extract namespace from URL
        // ... validate namespace ...
        next(w, r, ps)                // Call the wrapped handler
    }
}
```

## P

### `panic` / `recover`

Go's mechanism for unrecoverable errors. `panic` stops the current function and unwinds the stack. `recover` can catch a panic inside a deferred function.

**TypeScript equivalent:** `throw` / `catch`, but `panic` is reserved for truly exceptional situations (programmer bugs, impossible states). Normal errors use the `(result, error)` return value pattern. Think of `panic` like an uncaught `throw` -- it terminates the goroutine unless caught by `recover` in a deferred function.

**Where you will see it:** You should almost never use `panic` in handler code. The `RecoverPanic` middleware catches accidental panics and converts them to 500 responses.

```go
panic("impossible state")             // Crashes the current goroutine
// Use this ONLY for genuinely impossible conditions
// Normal errors should be returned, not panicked
```

---

### Pointer (`*` and `&`)

A value that holds the memory address of another value. `&x` gets the address of `x`. `*p` dereferences a pointer to access the underlying value.

**TypeScript equivalent:** No direct equivalent. In JavaScript, objects are always passed by reference. In Go, structs are copied by default -- pointers give you reference semantics when you need them.

**Where you will see it:** Every handler signature (`*App`), every struct pointer (`*models.User`), every `ReadJSON` call (`&input`).

```go
x := 42                               // x is an int with value 42
p := &x                               // p is a *int (pointer to int) -- holds x's memory address
*p = 100                              // Dereference p to change x's value through the pointer
fmt.Println(x)                        // Prints 100 -- x was modified through the pointer
```

## R

### Receiver

The `(app *App)` part of a method declaration. It attaches a function to a type, making it a method. The receiver is like `this` in a JavaScript class.

**TypeScript equivalent:** The implicit `this` in a class method: `class App { handler() { this.logger... } }`.

**Where you will see it:** Every handler function declaration.

```go
func (app *App) HealthcheckHandler(    // (app *App) is the receiver
    w http.ResponseWriter,             // app is like 'this' in the method body
    r *http.Request,
    ps httprouter.Params,
) {
    app.logger.Info("healthcheck")     // Access fields via app (like this.logger)
}
```

## S

### SAR / SSAR (SubjectAccessReview / SelfSubjectAccessReview)

Kubernetes API resources used for RBAC permission checks. The BFF creates a SAR to ask the K8s API server: "Can this user perform this action on this resource in this namespace?"

**TypeScript equivalent:** Like calling an authorization service: `if (!user.can('list', 'pipelines', namespace)) { return res.status(403).json(...); }`.

**Where you will see it:** Middleware functions like `RequireAccessToService` and `RequireAccessToPipelineServers`.

```go
canAccess, err := client.CanListDSPipelineApplications(  // Ask K8s: "Can this user do this?"
    ctx,                               // Request context
    identity,                          // The user's identity
    namespace,                         // The namespace to check
)
if !canAccess {                        // If the user lacks permission
    app.forbiddenResponse(w, r)        // Return 403 Forbidden
    return                             // Stop processing
}
```

---

### Struct

Go's primary mechanism for defining data structures. A struct groups named, typed fields into a single type.

**TypeScript equivalent:** An `interface` or `type` for shape, but structs can have methods attached (via receivers), making them more like a class without inheritance.

**Where you will see it:** Models (`internal/models/`), configuration (`internal/config/`), the App struct itself (`internal/api/app.go`).

```go
type User struct {                     // Define a new type called User
    ID    string `json:"id"`           // Field with a JSON tag
    Name  string `json:"name"`         // Fields are typed -- not optional by default
    Admin bool   `json:"admin"`        // bool, not boolean
}

u := User{                            // Create an instance (like { id: "1", name: "alice" })
    ID:   "1",                        // Set each field by name
    Name: "alice",
}
```

## Z

### Zero Value

The default value Go assigns to any variable that has not been explicitly initialized. Every type has exactly one zero value. There is no `undefined` in Go.

**TypeScript equivalent:** Like `undefined`, but typed and predictable. In TypeScript, an uninitialized `let x: number` is `undefined`. In Go, an uninitialized `var x int` is `0`. There is no ambiguity.

**Where you will see it:** Every time you declare a variable without assigning it, every time you create a struct without setting all fields, and every time you check for zero values in validation logic.

| Type | Zero Value | Surprise Factor |
|------|-----------|-----------------|
| `int`, `float64` | `0` | None -- same as most languages |
| `string` | `""` (empty string) | Not `nil` or `undefined` -- it is a real empty string |
| `bool` | `false` | Not `nil` or `undefined` -- it is a real `false` |
| `*T` (pointer) | `nil` | Like `null` in JS |
| `[]T` (slice) | `nil` | Safe to read (`len` returns 0) and `append` works on nil slices |
| `map[K]V` | `nil` | Safe to read, but PANICS on write -- always initialize with `make` |
| `struct` | All fields set to their zero values | An uninitialized struct has all fields zeroed, not `nil` |

```go
var count int                          // count is 0 -- not undefined, not NaN
var name string                        // name is "" -- not undefined, not null
var ok bool                            // ok is false -- not undefined
var ptr *User                          // ptr is nil -- like null

// This matters for validation:
if name == "" {                        // Check for zero value of string
    return fmt.Errorf("name is required")  // Not if name == nil or name == undefined
}
```

## Operator & Kubernetes Terms

These terms come up in Parts 4–6 when you move from the BFFs into the `dashboard-operator` and the modular architecture. They're grouped here because they only matter once you're reading operator code.

### Conditions

Structured entries in a resource's `.status.conditions` array describing _why_ it's in its current state (`type`, `status`, `reason`, `message`). The operator rolls per-module conditions up into a top-level `Ready` condition.

**TypeScript equivalent:** Like a discriminated-union status object: `{ type: 'Ready', status: 'False', reason: 'ImagePullBackOff', message: '...' }`.

**Where you will see it:** `dashboard-operator/internal/controller/` status updates; `oc get dashboard -o yaml` output.

---

### controller-runtime

The Go framework (`sigs.k8s.io/controller-runtime`) every Kubernetes operator is built on. It provides the Manager, the client cache, and the plumbing that calls your Reconciler.

**TypeScript equivalent:** Like a backend framework (NestJS) that owns the lifecycle and calls _your_ handlers — you write the business logic, it runs the loop.

**Where you will see it:** Imports across `dashboard-operator/`; see [Part 5: controller-runtime](/guide/operator/controller-runtime).

---

### CRD (Custom Resource Definition)

A schema that teaches the Kubernetes API server about a new resource kind. Once installed, `kubectl get <kind>` works as if the type were built in. The `Dashboard` CRD defines the resource the operator watches.

**TypeScript equivalent:** Like registering a new typed REST resource with a JSON Schema the server validates against.

**Where you will see it:** `dashboard-operator/api/v1alpha1/*_types.go` (the Go source) and `config/crd/bases/*.yaml` (the generated schema). See [Resources & CRDs](/guide/kubernetes/resources-and-crds).

---

### DSC (DataScienceCluster)

The top-level custom resource the ODH/RHOAI platform operator reconciles. Its `spec.components` toggle which platform features are enabled — and those toggles _gate_ which dashboard modules the operator deploys.

**Where you will see it:** [The ODH Operator Connection](/guide/operator/odh-operator-connection); the `RequiredDSCComponents` field on module registry entries.

---

### Deployment Mode (Sidecar vs Standalone)

How the operator lays out module pods. **Sidecar** (legacy) runs every BFF as a container in one pod. **Standalone** (current) gives each enabled module its own Deployment, ServiceAccount, and NetworkPolicy. Controlled by `spec.deploymentMode`.

**Where you will see it:** [The Reconciler](/guide/operator/reconciler).

---

### Embedding

Go's composition mechanism — putting a type inside a struct with no field name promotes its fields and methods to the outer struct. The `DashboardReconciler` embeds `client.Client` so it can call `r.Get(...)` directly.

**TypeScript equivalent:** Closest to mixins or `extends` for behavior, but it's composition, not inheritance.

```go
type DashboardReconciler struct {
    client.Client                       // Embedded — promotes Get/List/Create/Update/Patch
    Scheme *runtime.Scheme
}
```

---

### envtest

A controller-runtime test harness that spins up a **real** `kube-apiserver` and `etcd` in-process, so reconciler tests run against a genuine API server instead of a fake.

**TypeScript equivalent:** Like an integration test against a real (ephemeral) database instead of a mocked repository.

**Where you will see it:** `dashboard-operator/internal/controller/*_test.go`; see [Testing the Operator](/guide/operator/testing).

---

### Federation ConfigMap

A ConfigMap the operator generates listing each enabled module's remote entry and proxy routes. The frontend host reads it to know which modules to load and where to proxy their API calls. A SHA-256 hash of its content is stamped on the main Deployment so a config change triggers a rolling restart.

**Where you will see it:** [Modules & Federation](/guide/operator/modules-and-federation).

---

### Finalizer

A string on a resource's `metadata.finalizers` that blocks deletion until the operator does cleanup and removes it. This is how the operator tears down cross-namespace resources before the CR disappears.

**TypeScript equivalent:** Like an `onBeforeDelete` hook that must complete before the record is actually removed.

**Where you will see it:** [Controller Concepts](/guide/kubernetes/controller-concepts); [The Reconciler](/guide/operator/reconciler).

---

### GVK (Group / Version / Kind)

The three-part identity of every Kubernetes type — e.g. `components.platform.opendatahub.io` / `v1alpha1` / `Dashboard`. The Scheme maps GVKs to Go types.

**Where you will see it:** `api/v1alpha1/groupversion_info.go`; Scheme registration.

---

### Manager

The controller-runtime object that owns shared infrastructure — the client cache, leader election, metrics, health checks — and starts all registered controllers with `mgr.Start(ctx)`.

**Where you will see it:** `dashboard-operator/cmd/manager/`; [controller-runtime](/guide/operator/controller-runtime).

---

### Module Federation

The runtime mechanism (via `OdhFederationPlugin`) that lets the host dashboard load each module's UI as a separate remote bundle at runtime. `DEPLOYMENT_MODE==='standalone'` decides whether a package builds as a host or a remote.

**TypeScript equivalent:** Webpack/rspack Module Federation — dynamically importing a remote's `remoteEntry.js`.

**Where you will see it:** `packages/<name>/frontend/config/moduleFederation.js`; [Onboard a New Module](/tutorials/onboard-a-module).

---

### ModuleHandler

The interface (`NewHandler` / `IsEnabled` / `BuildModuleCR`) the ODH platform operator implements to project DSC config into the `Dashboard` CR. It's the seam between the two operator levels.

**Where you will see it:** [The ODH Operator Connection](/guide/operator/odh-operator-connection).

---

### Owner Reference

A pointer in a child resource's metadata back to its parent. Kubernetes garbage-collects the child automatically when the parent is deleted. The operator sets these on the resources it creates.

**TypeScript equivalent:** Like an `ON DELETE CASCADE` foreign key.

**Where you will see it:** [Controller Concepts](/guide/kubernetes/controller-concepts).

---

### Reconciler

The heart of an operator: a function `Reconcile(ctx, req) (ctrl.Result, error)` that reads the current state, compares it to the desired spec, and makes changes to close the gap. It must be **idempotent** — running it twice must be safe.

**TypeScript equivalent:** Like React's render loop — you describe the desired UI (spec), and the reconciler makes the DOM (cluster) match, over and over.

**Where you will see it:** `dashboard-operator/internal/controller/dashboard_controller.go`; [The Reconciler](/guide/operator/reconciler).

---

### `RELATED_IMAGE_*`

The Konflux/OLM contract for digest-pinned images. The operator resolves each module's image from a `RELATED_IMAGE_ODH_MOD_ARCH_<NAME>_IMAGE` env var, which the platform operator overrides with a pinned digest at install time.

**Where you will see it:** `dashboard-operator/charts/dashboard/values.yaml`; [Register a Module in the Operator](/tutorials/register-module-in-operator).

---

### Scheme

A registry mapping GVKs to Go types so controller-runtime can (de)serialize resources. Types register themselves via `init()` + `AddToScheme`.

**Where you will see it:** `api/v1alpha1/groupversion_info.go`; manager setup.

---

### Server-Side Apply (SSA)

A Kubernetes apply strategy where each actor declares **field ownership**. The operator applies its desired state with a field manager (`dashboard-operator`) and the API server merges it, so it never clobbers fields another controller owns.

**TypeScript equivalent:** Like a `PATCH` with a merge strategy, but the server tracks who owns which field.

**Where you will see it:** `deploy.NewDeployer` usage; [Controller Concepts](/guide/kubernetes/controller-concepts).
