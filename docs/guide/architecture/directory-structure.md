# Directory Structure

> A map of every directory and file in a BFF -- what goes where, why it is organized this way, and how each piece maps to concepts you already know from frontend development.

## Let Us Open a Real BFF in VS Code

Imagine you have just cloned the odh-dashboard repo and opened the gen-ai BFF in your editor. You see a list of directories and files. Some look familiar, some do not. Let us go through every single one, starting from the top level, and build up your understanding one directory at a time.

::: info Composite Directory Tree
This tree is a composite showing the most common directories across all BFFs. No single BFF has exactly this layout -- gen-ai has additional directories like `cache/`, `services/`, `types/`, while automl has a top-level `mocks/` directory. Always check your specific BFF.
:::

Here is the complete tree:

```
bff/                                     # root of the BFF -- everything lives here
├── cmd/                                 # entry point -- like your index.ts
│   ├── main.go                          #   server startup, flag parsing, wiring
│   └── helpers.go                       #   env var helpers (getEnvAsInt, etc.)
│
├── internal/                            # private application code (Go enforced!)
│   ├── api/                             #   HTTP layer -- like your Express routes
│   │   ├── app.go                       #     App struct, NewApp(), Routes()
│   │   ├── *_handler.go                 #     one file per endpoint group
│   │   ├── middleware.go                #     auth, CORS, namespace, client attach
│   │   ├── errors.go                    #     error response helpers
│   │   └── helpers.go                   #     shared handler utilities
│   │
│   ├── config/                          #   configuration -- like your env.ts
│   │   └── config.go                    #     EnvConfig struct with all settings
│   │
│   ├── constants/                       #   constants -- like your constants.ts
│   │   └── paths.go                     #     API path constants, header keys
│   │
│   ├── integrations/                    #   external clients -- like your api/ services
│   │   ├── http.go                      #     generic HTTP client helper (shared)
│   │   ├── kubernetes/                  #     K8s client, SAR/SSAR, CRD operations
│   │   │   ├── client.go                #       K8s client interface + implementation
│   │   │   ├── factory.go               #       client factory for per-request clients
│   │   │   ├── token_k8s_client.go      #       token-based K8s client
│   │   │   └── k8smocks/               #       mock K8s client (co-located with real code)
│   │   │
│   │   ├── llamastack/                  #     LlamaStack client
│   │   │   └── lsmocks/                 #       mock LlamaStack client (co-located)
│   │   │
│   │   ├── mcp/                         #     MCP server client
│   │   │   └── mcpmocks/                #       mock MCP client (co-located)
│   │   │
│   │   ├── mlflow/                      #     MLflow client
│   │   │   └── mlflowmocks/             #       mock MLflow client (co-located)
│   │   │
│   │   ├── maas/                        #     MaaS inter-BFF client
│   │   │   └── maasmocks/               #       mock MaaS client (co-located)
│   │   │
│   │   ├── nemo/                        #     NeMo Guardrails client
│   │   │   └── nemomocks/               #       mock NeMo client (co-located)
│   │   │
│   │   ├── bffclient/                   #     inter-BFF HTTP client
│   │   │   └── bffmocks/                #       mock BFF client (co-located)
│   │   │
│   │   ├── externalmodels/              #     external model client
│   │   └── types.go                     #     shared integration types
│   │
│   ├── models/                          #   data types -- like your TypeScript interfaces
│   │   ├── models.go                    #     request/response DTOs
│   │   └── kubernetes.go                #     K8s resource type definitions
│   │
│   ├── repositories/                    #   business logic -- like your data hooks
│   │   └── llamastack.go               #     domain logic, data transformation
│   │
│   ├── services/                        #   service orchestration layer
│   ├── helpers/                         #   shared helper functions
│   ├── cache/                           #   caching layer
│   ├── types/                           #   additional type definitions
│   └── testutil/                        #   shared test utilities
│
├── openapi/                             #   API spec -- like your OpenAPI/Swagger
│   └── src/
│       └── gen-ai.yaml                  #     OpenAPI 3.0 specification
│
├── go.mod                               #   module definition -- your package.json
├── go.sum                               #   dependency checksums -- your package-lock.json
└── Makefile                             #   build commands -- your npm scripts
```

That is a lot of directories. Let us go through each one in detail, starting from the top.

## `cmd/` -- The Entry Point

**What goes here:** The `main` function that starts the server. Flag parsing, environment variable loading, dependency wiring, and the `http.ListenAndServe` call.

**Frontend equivalent:** Think of this as your `src/index.ts` or `src/bootstrap.tsx` -- the file that initializes everything and starts the app.

Let us look at the key file:

### `cmd/main.go` -- Starting the Server

```go
package main                               // every Go executable starts with package main

import (                                    // import block -- like your import statements
    "flag"                                  // standard library: command-line flag parsing
    "fmt"                                   // standard library: string formatting
    "net/http"                              // standard library: HTTP server

    "github.com/opendatahub-io/gen-ai/internal/api"    // our app's HTTP layer
    "github.com/opendatahub-io/gen-ai/internal/config"  // our app's configuration
)

func main() {                              // the entry point -- Go runs this function first
    cfg := config.EnvConfig{}              // create an empty config struct

    flag.IntVar(&cfg.Port, "port", 8080, "API server port")          // --port flag, default 8080
    flag.StringVar(&cfg.AuthMethod, "auth-method", "internal", "Auth method") // --auth-method flag
    flag.BoolVar(&cfg.MockK8sClient, "mock-k8s-client", false, "Use mock K8s") // --mock-k8s-client flag
    flag.Parse()                           // parse all the flags from the command line

    app, err := api.NewApp(cfg, logger)    // create the application with all dependencies wired up
    if err != nil {                        // if initialization failed (e.g., can't connect to K8s)
        log.Fatalf("failed to create app: %v", err) // log the error and exit
    }

    addr := fmt.Sprintf(":%d", cfg.Port)  // format the listen address (e.g., ":8080")
    http.ListenAndServe(addr, app.Routes()) // start the HTTP server -- blocks until shutdown
}
```

**What just happened?** This is the entire startup sequence. Parse flags, create the app, start the server. Everything else is in `internal/`. If you have used Express, this is like:

```typescript
// The Express equivalent of main.go
const app = express();                      // create the app
const port = process.env.PORT || 8080;      // read the port
app.listen(port);                           // start listening
```

### `cmd/helpers.go` -- Environment Variable Readers

```go
package main                               // same package as main.go

import (                                    
    "os"                                    // standard library: operating system functions
    "strconv"                               // standard library: string conversion
)

func getEnvAsInt(key string, defaultVal int) int {  // read an env var as an integer
    if val, ok := os.LookupEnv(key); ok {           // check if the env var exists
        if intVal, err := strconv.Atoi(val); err == nil { // try to convert to int
            return intVal                               // return the converted value
        }                                               // if conversion fails, fall through
    }
    return defaultVal                                    // return the default if not set or invalid
}

func getEnvAsString(key string, defaultVal string) string { // read an env var as a string
    if val, ok := os.LookupEnv(key); ok {                   // check if the env var exists
        return val                                          // return it if so
    }
    return defaultVal                                       // otherwise return the default
}
```

**What just happened?** These are typed environment variable readers -- like a simple version of a `config.ts` file that reads from `process.env`. Go does not have a built-in way to read env vars with defaults and type conversion, so these helpers fill that gap.

::: tip Why `cmd/`?
The `cmd/` directory is a Go convention. It signals "this is where the executable lives." If a project had multiple executables (like a server and a CLI tool), each would get its own subdirectory: `cmd/server/main.go`, `cmd/cli/main.go`. Our BFFs have just one: `cmd/main.go`.
:::

<div class="checkpoint">

#### Checkpoint

You now understand the `cmd/` directory:
- `main.go` is the entry point that parses flags and starts the server
- `helpers.go` provides typed environment variable readers
- This is the equivalent of your `index.ts` / `bootstrap.tsx`

</div>

## `internal/` -- Private Application Code

**What goes here:** Everything that makes up the application logic. In Go, `internal/` has a special meaning enforced by the compiler.

**Frontend equivalent:** Like your `src/` directory, but with a hard guarantee -- no other Go module can import from `internal/`. It is truly private to this BFF.

::: warning The `internal/` Rule
Go enforces a strict rule: code inside an `internal/` directory can only be imported by code in the parent of `internal/`. This means no other package in the monorepo can accidentally import your BFF's internal types or functions. It is Go's way of enforcing encapsulation without access modifiers (there is no `private` keyword in Go for packages). If you put code in `internal/`, it stays private -- the compiler guarantees it.
:::

Let us drill into each subdirectory.

## `internal/api/` -- HTTP Handlers and Routing

**What goes here:** The HTTP layer. Route registration, request handlers, middleware, and response helpers. This is the largest directory and where you will spend most of your time.

**Frontend equivalent:** Like your Express/Fastify route handlers, or the API route files in Next.js.

### `app.go` -- The Application Struct and Route Registration

This is the nerve center of the BFF. The `App` struct holds all dependencies, and the `Routes()` method registers every endpoint:

```go
type App struct {                                    // the App struct holds all dependencies
    config                  config.EnvConfig         // parsed configuration (ports, flags, etc.)
    logger                  *slog.Logger             // structured logger for request/error logging
    kubernetesClientFactory k8s.KubernetesClientFactory // creates K8s clients per request
    llamaStackClientFactory llamastack.LlamaStackClientFactory // creates LlamaStack clients per request
    mcpClientFactory        mcp.MCPClientFactory     // creates MCP clients per request
    mlflowClientFactory     mlflowpkg.MLflowClientFactory // creates MLflow clients per request
    // ... more client factories ...                 // one factory per external service
}

func (app *App) Routes() http.Handler {              // returns the complete HTTP handler
    router := httprouter.New()                       // create a new router (like Express Router)

    router.GET("/healthcheck", app.HealthcheckHandler) // health check -- no auth needed

    router.GET("/api/v1/lsd/models",                 // register the models list endpoint
        app.AttachNamespace(                          // middleware: extract namespace
            app.RequireAccessToService(               // middleware: check RBAC
                app.AttachOGXClient(                  // middleware: create LlamaStack client
                    app.LlamaStackModelsHandler))))   // handler: list models

    // Global middleware wraps the entire router
    return app.RecoverPanic(                          // catch panics so server doesn't crash
        app.EnableTelemetry(                          // add request logging and metrics
            app.EnableCORS(                           // add CORS headers
                app.InjectRequestIdentity(            // extract user identity from headers
                    router))))                        // the router with all routes registered
}
```

**What just happened?** The `App` struct is Go's version of dependency injection. Instead of importing singletons or using a dependency injection framework, you pass all dependencies through the `App` struct. The `Routes()` method is like your Express `app.use()` and `app.get()` calls, all in one place.

### `*_handler.go` -- One File Per Endpoint Group

Each feature area gets its own handler file. This keeps the code organized:

```go
// lsd_models_handler.go -- handles model-related endpoints
func (app *App) LlamaStackModelsHandler(             // method on App -- has access to all dependencies
    w http.ResponseWriter,                            // response writer (like Express res)
    r *http.Request,                                  // request object (like Express req)
    ps httprouter.Params,                             // URL path parameters (like req.params)
) {
    client := getLlamaStackClient(r.Context())        // get service client from context
    models, err := client.ListModels(r.Context())     // call the upstream service
    if err != nil {                                   // if the call failed
        app.serverErrorResponse(w, r, err)            // return 500 with error details
        return                                        // stop processing
    }
    app.WriteJSON(w, http.StatusOK, models, nil)      // return 200 with JSON response
}
```

### `middleware.go` -- Auth, CORS, Namespace, Client Attachment

Contains all middleware functions:

- **Global middleware** wraps the entire router: `RecoverPanic`, `EnableTelemetry`, `EnableCORS`, `InjectRequestIdentity`
- **Per-route middleware** wraps individual handlers: `AttachNamespace`, `RequireAccessToService`, `AttachOGXClient`, etc.

### `errors.go` -- Standardized Error Responses

```go
func (app *App) badRequestResponse(                   // handles 400 errors
    w http.ResponseWriter,                             // response writer
    r *http.Request,                                   // request (for logging context)
    err error,                                         // the actual error
) {
    app.WriteJSON(w, http.StatusBadRequest, ErrorEnvelope{  // write error as JSON
        Error: &HTTPError{                             // standard error envelope
            StatusCode: 400,                           // HTTP status code
            ErrorResponse: ErrorResponse{              // error details
                Code:    "bad_request",                // machine-readable code
                Message: err.Error(),                  // human-readable message
            },
        },
    }, nil)
}
```

**What just happened?** Every BFF uses the same error envelope format. This is like having a shared error handler in Express that always returns `{ error: { code, message } }`.

<div class="checkpoint">

#### Checkpoint

You now understand `internal/api/`:
- `app.go` is the central struct that holds dependencies and registers routes
- `*_handler.go` files contain endpoint logic, one file per feature area
- `middleware.go` contains all middleware functions
- `errors.go` provides standardized error responses

</div>

## `internal/config/` -- Configuration

**What goes here:** The `EnvConfig` struct that defines all configuration options.

**Frontend equivalent:** Like a centralized `env.ts` or `config.ts` that reads from `process.env` and provides typed configuration.

```go
type EnvConfig struct {                               // all configuration in one struct
    Port               int                            // server listen port (--port flag)
    AuthMethod         string                         // "internal", "user_token", or "disabled"
    AllowedOrigins     string                         // CORS allowed origins
    MockK8sClient      bool                           // use mock K8s client (--mock-k8s-client)
    MockLSClient       bool                           // use mock LlamaStack client
    MockMCPClient      bool                           // use mock MCP client
    MockMLflowClient   bool                           // use mock MLflow client
    MockMaaSClient     bool                           // use mock MaaS client
    LogLevel           string                         // log level (debug, info, warn, error)
    InsecureSkipVerify bool                           // skip TLS verification (local dev ONLY)
}
```

**What just happened?** Every configuration option lives in one struct. Each field corresponds to a command-line flag (parsed in `cmd/main.go`). The mock flags are what let you run the BFF locally without a real cluster.

## `internal/constants/` -- Path Constants and Keys

**What goes here:** String constants for API paths, header names, and context keys.

**Frontend equivalent:** Like your `constants.ts` file where you define route paths and API endpoints.

```go
package constants                                     // package declaration

const (                                               // const block -- like export const in TypeScript
    ModelsListPath     = "/api/v1/lsd/models"         // path for listing models
    ModelsDetailPath   = "/api/v1/lsd/models/:id"     // path for getting a single model
    HealthcheckPath    = "/healthcheck"                // path for health checks

    AuthorizationHeader = "Authorization"              // standard HTTP auth header
    UserIDHeader        = "kubeflow-userid"            // header for username (set by backend)
    GroupsHeader        = "kubeflow-groups"            // header for groups (set by backend)
)
```

## `internal/integrations/` -- External Service Clients

**What goes here:** Clients for communicating with external services. Each subdirectory handles one integration target.

**Frontend equivalent:** Like your `src/api/` or `src/services/` directory where you define functions for calling backend APIs.

This directory is where the BFF earns its name. Each subdirectory talks to a different service:

| Subdirectory | Service | What It Does |
|---|---|---|
| `kubernetes/` | Kubernetes API | RBAC checks, CRD operations, resource management |
| `llamastack/` | LlamaStack | Model listing, inference, tool use, vector stores |
| `mcp/` | MCP Servers | Tool server connections and tool execution |
| `mlflow/` | MLflow | Experiment tracking, prompt management |
| `maas/` | MaaS BFF | Inter-BFF calls for model subscriptions and API keys |
| `nemo/` | NeMo Guardrails | Guardrail configuration and enforcement |
| `bffclient/` | Other BFFs | Generic inter-BFF HTTP client |
| `externalmodels/` | External Models | External model provider integration |

### The Kubernetes Client

```go
// kubernetes/client.go -- interface + implementation
type KubernetesClientInterface interface {            // interface defines what the client can do
    CanListOGXServers(identity, ns string) (bool, error) // RBAC check for a specific resource type
    GetLlamaStackDistribution(ns string) (*LSD, error) // find LlamaStack CRD in namespace
    CreateResource(ns string, resource interface{}) error // create a K8s resource
}
```

### Co-located Mocks

Each service subdirectory contains its own mock implementation in a `*mocks/` sub-subdirectory:

```
integrations/
├── kubernetes/              # real K8s client
│   └── k8smocks/           # mock K8s client -- right next to the real one
├── llamastack/              # real LlamaStack client
│   └── lsmocks/            # mock LlamaStack client
├── mcp/                     # real MCP client
│   └── mcpmocks/           # mock MCP client
└── ...
```

**What just happened?** Mocks live right next to the code they mock. This is a deliberate choice in the gen-ai BFF. When you start the BFF with `--mock-k8s-client`, the `NewApp` function in `app.go` swaps the real `KubernetesClientFactory` for `k8smocks.NewMockedKubernetesClientFactory()`. Same interface, different implementation.

::: warning Mock Location Varies by BFF
Not all BFFs organize mocks the same way. The gen-ai BFF co-locates mocks within each integration subdirectory (e.g., `kubernetes/k8smocks/`). Other BFFs like automl and maas have a top-level `internal/mocks/` directory instead. Always check the specific BFF you are working in to find where mocks live.
:::

::: tip Mocks Enable Local Development
Running `make dev-bff` or passing `--mock-k8s-client --mock-ls-client` starts the BFF with all external calls mocked out. You can develop and test BFF endpoints without a Kubernetes cluster, without LlamaStack running, without any real services. The mocks return realistic data that matches the OpenAPI spec.
:::

## `internal/models/` -- Data Transfer Objects

**What goes here:** Struct definitions for request bodies, response bodies, and internal data shapes. These are your DTOs (Data Transfer Objects).

**Frontend equivalent:** Like your TypeScript `types.ts` or `interfaces.ts` files. The mapping is almost 1:1:

<div class="code-compare">
<div>

**TypeScript**

```typescript
interface Model {                         // define a model type
  id: string;                             // the model identifier
  name: string;                           // display name
  provider: string;                       // who provides this model
  createdAt: string;                      // when it was created
}

interface ModelsResponse {                // the API response shape
  models: Model[];                        // array of models
  total: number;                          // total count
}
```

</div>
<div>

**Go**

```go
type Model struct {                       // define a model type
    ID        string `json:"id"`          // the model identifier -- json tag maps to lowercase
    Name      string `json:"name"`        // display name
    Provider  string `json:"provider"`    // who provides this model
    CreatedAt string `json:"createdAt"`   // when it was created
}

type ModelsResponse struct {              // the API response shape
    Models []Model `json:"models"`        // slice (array) of models
    Total  int     `json:"total"`         // total count
}
```

</div>
</div>

**What just happened?** Go structs are like TypeScript interfaces, but with `json:"..."` tags that tell Go's JSON encoder/decoder what field names to use. Without these tags, Go would serialize field names with their uppercase Go names (`ID`, `Name`), which is not what your frontend expects. The tags map Go's `PascalCase` to the `camelCase` your React code uses.

## `internal/repositories/` -- Business Logic

**What goes here:** Higher-level business logic that orchestrates between multiple integrations. Data transformation, validation, and domain rules.

**Frontend equivalent:** Like your custom React hooks that combine multiple API calls and transform data (e.g., `useModelsWithPermissions`).

```go
type ModelRepository struct {                          // holds the clients it needs
    kubeClient    integrations.KubernetesClientInterface // K8s client for CRD lookups
    llamaClient   *httpclient.HTTPClient               // LlamaStack client for model data
}

func (r *ModelRepository) ListModelsWithStatus(        // a business logic method
    namespace string,                                  // which namespace to query
) ([]ModelWithStatus, error) {                         // returns enriched models or an error
    models, err := r.llamaClient.ListModels()          // step 1: get models from LlamaStack
    if err != nil {                                    // check for errors
        return nil, err                                // return early if LlamaStack failed
    }
    deployments, err := r.kubeClient.ListDeployments(namespace) // step 2: get deployments from K8s
    if err != nil {                                    // check for errors
        return nil, err                                // return early if K8s failed
    }
    return mergeModelsWithDeployments(models, deployments), nil // step 3: merge and return
}
```

**What just happened?** Repositories combine data from multiple sources. Not all BFFs use this pattern -- some put orchestration logic directly in handlers. But for complex operations that touch multiple services, repositories keep handlers clean and testable.

## `openapi/` -- API Specification

**What goes here:** The OpenAPI (Swagger) specification that defines the BFF's API contract.

**Frontend equivalent:** Like an OpenAPI spec you would use to generate TypeScript types or validate API responses.

```yaml
# openapi/src/gen-ai.yaml
openapi: 3.0.0                            # OpenAPI version
info:
  title: Gen AI BFF API                    # API title
  version: 1.0.0                           # API version

paths:
  /api/v1/lsd/models:                      # endpoint path (as the BFF sees it, not the browser)
    get:
      summary: List available AI models    # human-readable description
      parameters:
        - name: namespace                  # query parameter
          in: query                        # parameter location
          required: true                   # must be provided
          schema:
            type: string                   # parameter type
      responses:
        '200':                             # success response
          description: List of models
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ModelsResponse'  # reference to schema definition
        '403':                             # forbidden response
          description: Access denied
```

This spec is used by the contract testing framework (`@odh-dashboard/contract-tests`) to validate that the BFF's actual responses match the documented contract. When you add a new endpoint, you update the OpenAPI spec first, then write the handler.

## `go.mod` and `go.sum` -- Dependency Management

**`go.mod`** is Go's `package.json`. It declares the module name and its dependencies:

```
module github.com/opendatahub-io/gen-ai          # module path -- like "name" in package.json

go 1.24                                           # minimum Go version -- like "engines" in package.json

require (                                          # dependencies -- like "dependencies" in package.json
    github.com/julienschmidt/httprouter v1.3.0    # HTTP router (like Express)
    k8s.io/client-go v0.30.0                      # official Kubernetes client library
    k8s.io/api v0.30.0                            # Kubernetes API types
)
```

**`go.sum`** is Go's `package-lock.json`. It contains checksums for every dependency to ensure reproducible builds. You never edit this file manually -- `go mod tidy` manages it.

## `Makefile` -- Build and Run Commands

**Frontend equivalent:** Like the `scripts` section of your `package.json`, but using Make syntax.

```makefile
run:                                      # start the BFF server
	go run ./cmd --port 8080              # compile and run in one step

dev-bff:                                  # start with all mocks (no cluster needed)
	go run ./cmd \                        # compile and run
	    --mock-k8s-client \               # use mock Kubernetes client
	    --mock-ls-client \                # use mock LlamaStack client
	    --mock-mcp-client \               # use mock MCP client
	    --port 8080                       # listen on port 8080

test:                                     # run all tests
	go test ./...                         # ./... means "all packages recursively"

lint:                                     # run the linter
	golangci-lint run                     # Go's equivalent of ESLint

build:                                    # compile to a binary
	go build -o bin/bff ./cmd             # output to bin/bff
```

<div class="checkpoint">

#### Checkpoint

You have now seen every directory in a BFF. Here is the quick mental map:
- `cmd/` = entry point (index.ts)
- `internal/api/` = HTTP handlers and middleware (routes/)
- `internal/config/` = configuration (env.ts)
- `internal/constants/` = string constants (constants.ts)
- `internal/integrations/` = service clients (api/ or services/)
- `internal/models/` = data types (types.ts)
- `internal/repositories/` = business logic (hooks/)
- `openapi/` = API specification
- `go.mod` = package.json
- `Makefile` = npm scripts

</div>

## Comparing to a React Feature Folder

If you are used to organizing React code by feature, here is how the BFF structure maps:

```
React feature folder:              Go BFF structure:
src/                               bff/
├── index.ts          →            ├── cmd/main.go               # entry point
├── api/                           ├── internal/
│   ├── types.ts      →            │   ├── models/               # data types
│   └── services.ts   →            │   ├── integrations/         # service clients
├── hooks/                         │   ├── repositories/
│   └── useModels.ts  →            │   │   └── models.go         # business logic
├── components/                    │   ├── api/
│   └── ModelList.tsx  →           │   │   └── models_handler.go # HTTP handler
├── constants.ts      →            │   ├── constants/             # string constants
├── __mocks__/        →            │   └── integrations/*/mocks/ # mock implementations
└── __tests__/        →            │       (tests are co-located: *_test.go)
```

The biggest difference: in Go, test files live **next to** the code they test, not in a separate `__tests__/` directory. A handler file `models_handler.go` has its test file `models_handler_test.go` right next to it in the same directory and the same package. This is a Go convention that might feel odd at first but becomes natural quickly.

## Which Directories Vary Between BFFs?

Most of the structure is consistent across all seven BFFs, but there are differences:

| Directory | Always Present | What Varies |
|---|---|---|
| `cmd/` | Yes | Flag names differ per package |
| `internal/api/` | Yes | Handler files differ (one per feature area) |
| `internal/config/` | Yes | Config fields differ per package |
| `internal/constants/` | Yes | Path constants differ |
| `internal/integrations/kubernetes/` | Yes | SAR resource types differ |
| `internal/integrations/{service}/` | Yes | Service subdirectories differ (llamastack/, mcp/, mlflow/, etc.) |
| `internal/models/` | Yes | DTOs differ per domain |
| `internal/repositories/` | Sometimes | Some BFFs put logic directly in handlers |
| `internal/helpers/` | Sometimes | Shared utility functions |
| `internal/services/` | Sometimes | Service orchestration layer |
| `internal/cache/` | Sometimes | Caching layer |
| `internal/types/` | Sometimes | Additional type definitions |
| `internal/testutil/` | Sometimes | Shared test utilities |
| `openapi/` | Yes | One spec per BFF |

::: info The model-registry Exception
The model-registry BFF lives at `packages/model-registry/upstream/bff/` instead of `packages/model-registry/bff/`. This is because model-registry is a git subtree synced from the kubeflow/model-registry upstream repository. The `upstream/` prefix reflects this origin. The internal structure is the same as other BFFs.
:::

## Quick Reference: "If I Need to Add X, Where Do I Put It?"

| I need to... | Put it in... |
|---|---|
| Add a new API endpoint | `internal/api/` -- create a new `*_handler.go` file and register the route in `app.go` |
| Add request/response types | `internal/models/` -- add new structs with `json:"..."` tags |
| Add a new external service client | `internal/integrations/` -- create a new subdirectory with client and mock |
| Add a command-line flag | `cmd/main.go` -- add a `flag.*Var()` call and a field to `EnvConfig` |
| Add a constant (path, header name) | `internal/constants/` -- add a `const` declaration |
| Add business logic spanning multiple services | `internal/repositories/` -- create a new repository struct |
| Add a mock for testing | Co-locate in `internal/integrations/{service}/{svc}mocks/` (check existing pattern in your BFF) |
| Document the API | `openapi/src/*.yaml` -- add paths and schemas |
| Add or run a test | Same directory as the code, in a `*_test.go` file |
| Add a caching layer | `internal/cache/` -- if it exists; create it if needed |
| Add shared helper functions | `internal/helpers/` -- utility functions used across the BFF |

<div class="checkpoint">

#### Checkpoint

You should now be able to:
1. Navigate the directory structure of any BFF in the monorepo
2. Know exactly where to put new code based on what you are building
3. Understand the `internal/` privacy guarantee
4. Map BFF directories to their React equivalents
5. Know that test files live next to the code they test as `*_test.go`

</div>

## Putting It All Together

Here is the mental model: when a request arrives at the BFF, the code it touches flows through the directory structure in a specific order:

```
cmd/main.go                     # started the server (happened at boot time)
  |
internal/api/middleware.go       # global middleware runs (identity, CORS, telemetry)
  |
internal/api/app.go              # router dispatches to the matching route
  |
internal/api/middleware.go       # per-route middleware runs (namespace, RBAC, client)
  |
internal/api/*_handler.go        # handler executes
  |
internal/integrations/*/         # handler calls external service via client
  |
internal/models/                 # request/response shaped by DTOs
  |
internal/api/errors.go           # if something went wrong, error response sent
```

Every request touches `api/`, may touch `integrations/` and `models/`, and returns through `api/` again. The `config/`, `constants/`, and `repositories/` directories provide supporting infrastructure. Once you understand this flow, you can read any BFF in the monorepo.

::: tip Key Takeaway
Every BFF follows the same layout: `cmd/` for the entry point, `internal/api/` for HTTP handlers and middleware, `internal/models/` for data types, and `internal/integrations/` for external service clients (with per-service subdirectories and co-located mocks). The `internal/` directory is enforced private by the Go compiler. Tests live next to the code they test as `*_test.go` files. Once you know one BFF's structure, you know them all.
:::

::: info See Also
- [Entry Point (main.go)](../deep-dive/entry-point) -- Deep dive into what `cmd/main.go` does
- [The App Struct & Routes](../deep-dive/app-and-routes) -- How `internal/api/app.go` wires everything together
- [Writing Handlers](../deep-dive/handlers) -- How to add a new handler file to `internal/api/`
- [Models & DTOs](../deep-dive/models) -- How to define types in `internal/models/`
:::
