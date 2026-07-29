# Integrations

> **The outbound connections** -- how the BFF talks to Kubernetes, LlamaStack, Pipeline Servers, and other external services.

Integrations are how the BFF talks to the outside world. Your React components call `fetch()` to talk to the BFF. The BFF, in turn, calls out to other services -- Kubernetes for RBAC and resource management, LlamaStack for AI inference, MCP servers for tool access, MLflow for experiment tracking, NeMo Guardrails for content moderation, and other BFFs for cross-feature communication. The code that manages these outbound connections lives in `internal/integrations/`.

If you've ever written a service class in TypeScript that wraps `fetch()` calls to an external API, you already understand the concept. The BFF's integration clients do the exact same thing, with the addition of Kubernetes awareness (auth tokens, service discovery, CA certificates).

## Start with What You Know

Here's how you might call an external API in TypeScript:

```typescript
class PipelineClient {                             // A client for the Pipeline API
  constructor(                                     // Set up the client
    private baseURL: string,                       // The service URL
    private authToken: string,                     // Auth token to forward
  ) {}

  async listRuns(namespace: string): Promise<PipelineRun[]> { // Fetch pipeline runs
    const url = `${this.baseURL}/apis/v2beta1/runs?namespace=${namespace}`;
    const response = await fetch(url, {            // Make the HTTP request
      headers: {
        Authorization: `Bearer ${this.authToken}`, // Forward the user's token
      },
    });

    if (!response.ok) {                            // Check for errors
      throw new Error(`Pipeline server returned ${response.status}`);
    }

    const { runs } = await response.json();        // Parse the response
    return runs;                                   // Return the data
  }
}
```

The Go version does the same thing. Let's build up to it.

## What's in internal/integrations/

```
bff/internal/integrations/          (gen-ai BFF -- other BFFs differ)
├── http.go                    # HTTPClientInterface, HTTPError, ErrorResponse
├── types.go                   # RequestIdentity, BearerToken
├── kubernetes/                # Kubernetes API client
│   ├── client.go              # KubernetesClientInterface
│   ├── factory.go             # KubernetesClientFactory interface + TokenClientFactory
│   ├── token_k8s_client.go    # Uses user token (user_token auth)
│   ├── errors.go              # K8s-specific error helpers
│   ├── agent_profiles.go      # AgentProfile CRUD via K8s resources
│   ├── llamastack_config.go   # LlamaStack config read from K8s ConfigMaps
│   ├── nemo_guardrails.go     # NeMo Guardrails resource management
│   ├── otel_config_manager.go # OpenTelemetry collector configuration
│   ├── vector_stores_test.go  # Vector store tests
│   ├── k8smocks/              # Mock implementations (envtest-based)
│   ├── pgvector/              # PgVector provisioning (Deployments, PVCs)
│   └── testdata/              # Test fixtures
├── llamastack/                # LlamaStack AI service HTTP client
│   ├── llamastack_client.go   # Client implementation
│   ├── llamastack_client_factory.go
│   ├── llamastack_datatypes.go
│   ├── errors.go
│   └── lsmocks/               # Mock implementations
├── mcp/                       # Model Context Protocol client
│   ├── client.go              # MCPClientInterface
│   ├── simple_client.go       # HTTP-based MCP client
│   ├── factory.go             # Factory for creating MCP clients
│   ├── transport_factory.go   # MCP transport layer setup
│   ├── config.go              # MCP server configuration
│   ├── errors.go
│   └── mcpmocks/              # Mock implementations
├── mlflow/                    # MLflow experiment tracking client
│   ├── client.go              # Client interface
│   ├── factory.go             # Factory
│   ├── mlflow_cr.go           # MLflow CR discovery
│   └── mlflowmocks/           # Mock implementations
├── nemo/                      # NeMo Guardrails API client
│   ├── nemo_client.go         # NemoGuardrailsClient
│   ├── nemo_client_factory.go # Factory
│   ├── types.go               # Request/response types
│   └── nemomocks/             # Mock implementations
├── bffclient/                 # Inter-BFF communication client
│   ├── client.go              # BFFClientInterface (Call, IsAvailable)
│   ├── config.go              # BFF discovery configuration
│   ├── factory.go             # Factory
│   ├── errors.go
│   ├── middleware.go           # Middleware to attach BFF client to context
│   └── bffmocks/              # Mock implementations
└── externalmodels/            # External model providers (OpenAI-compatible)
    ├── client.go              # Chat completion & audio transcription
    └── errors.go
```

::: info HTTP Client Location Varies
Not all 8 BFFs organize their HTTP client code the same way:
- Some BFFs (e.g., maas, agent-ops, eval-hub, model-registry) have a dedicated `httpclient/` package under `integrations/`
- Others (e.g., gen-ai) have `http.go` at the `integrations/` root level providing a shared `HTTPClientInterface`
- In gen-ai, each upstream service gets its own subdirectory (`llamastack/`, `mcp/`, `mlflow/`, `nemo/`, etc.) with its own client code
- The automl and autorag BFFs have `pipelineserver/` and `s3/` subdirectories for their specific upstream services

The principle is the same across all BFFs, but the exact directory layout may differ.
:::

The pattern is consistent: each external service gets its own subdirectory with an interface, a real implementation, a factory, and mock implementations.

## The Factory Pattern -- Why Not Just Create the Client Once?

This is a question I had when I first saw the code. In Express, you might create a database client once at startup and share it across all requests. Why does the BFF use factories that create clients on demand?

The answer: **each request may need a different client.** With user token auth, the BFF creates a Kubernetes client using *that specific user's token*. With internal auth, the BFF might need to discover a different service URL based on the namespace. The factory creates the right client for each request's context.

### The Interface

```go
// Factory creates clients -- the "what" (interface)
type KubernetesClientFactory interface {            // Defines what a factory must do
    GetClient(ctx context.Context) (               // Create or get a K8s client
        KubernetesClientInterface, error)          // Returns client or error
    ExtractRequestIdentity(                        // Extract user identity from headers
        httpHeader http.Header) (
        *RequestIdentity, error)                   // Returns identity or error
    ValidateRequestIdentity(                       // Validate the identity
        identity *RequestIdentity) error           // Returns error if invalid
}

// Client does the actual work -- the "how" (interface)
type KubernetesClientInterface interface {          // Defines what a client must do
    GetNamespaces(                                 // List namespaces the user can see
        ctx context.Context,
        identity *RequestIdentity) (
        []corev1.Namespace, error)                 // Returns K8s Namespace objects or error
    CanListNamespaces(                             // Check if user can list namespaces
        ctx context.Context,
        identity *RequestIdentity) (bool, error)   // SSAR check -- returns allowed or error
    IsClusterAdmin(                                // Check if user has cluster-admin power
        ctx context.Context,
        identity *RequestIdentity) (bool, error)   // SSAR with wildcard verb+resource
    GetOGXServers(...)                             // List OGXServer custom resources
    InstallOGXServer(...)                          // Create an OGXServer + dependencies
    // ... ~20 more methods (ConfigMaps, Secrets, external models, guardrails, agent profiles)
}
```

The TypeScript equivalent would be two interfaces: `KubernetesClientFactory` (creates clients) and `KubernetesClient` (calls K8s APIs). The pattern is identical.

### Real vs Mock -- The Factory Decision

In `NewApp()`, the factory is chosen based on config:

```go
var k8sFactory kubernetes.KubernetesClientFactory  // Declare the variable (nil initially)

if cfg.MockK8sClient {                             // Check the --mock-k8s-client flag
    // Mock: uses envtest (in-memory K8s API server)
    k8sFactory, err = k8smocks.NewMockedKubernetesClientFactory( // Create mock factory
        clientset, testEnv, cfg, logger)
} else {                                           // Real mode
    // Real: uses in-cluster or kubeconfig credentials
    k8sFactory, err = kubernetes.NewKubernetesClientFactory( // Create real factory
        cfg, logger, rootCAs)
}
```

The handler code never knows which one it's using. It just calls:

```go
client, err := app.kubernetesClientFactory.GetClient(ctx) // "Give me a client"
// Don't care if it's real or mock -- same interface    // It just works
```

This is dependency injection through interfaces. Same concept as injecting mock services in your React tests, but at the Go layer. The handler depends on the interface, not the implementation. Tests swap in mocks, production uses the real thing. No code changes needed.

## The Kubernetes Client

The K8s client is the most important integration. It handles SelfSubjectAccessReview (SSAR) for RBAC checks (see [Auth](./auth)), listing namespaces, reading resources (ConfigMaps, Secrets, custom resources), managing OGXServer installations, external model providers, NeMo Guardrails, agent profiles, and more.

### The Token Client

The gen-ai BFF currently supports one auth method: **user token auth** via `TokenClientFactory`. (Internal/service-account auth is planned but not yet implemented -- there is a TODO in `factory.go`.)

| Type | Factory | When Used |
|---|---|---|
| `TokenClientFactory` | `NewTokenClientFactory()` | User token auth -- BFF uses the user's token |

With user token auth, the BFF checks permissions through **SelfSubjectAccessReview** (SSAR). Unlike a regular SubjectAccessReview (SAR), an SSAR asks "can **I** do X?" -- the "I" is whoever's token is on the request. No `User` or `Groups` fields are needed because the API server infers them from the bearer token:

```go
// SSAR: the user's own token asks K8s "can I list OGXServers in my-project?"
sar := &authv1.SelfSubjectAccessReview{            // Build the SSAR request
    Spec: authv1.SelfSubjectAccessReviewSpec{      // What to check
        ResourceAttributes: &authv1.ResourceAttributes{ // The action
            Verb:      "list",                     // What action
            Group:     "ogx.io",                   // API group
            Resource:  "ogxservers",               // What resource
            Namespace: namespace,                  // Where
        },
    },
}
// No User/Groups fields -- the bearer token on the request tells K8s who is asking
```

The BFF creates a K8s client using the user's Bearer token, so all API calls are naturally scoped to the user's permissions:

```go
func (f *TokenClientFactory) GetClient(            // Create a K8s client for a specific user
    ctx context.Context,                           // Request context (has user identity)
) (KubernetesClientInterface, error) {             // Returns the client or error
    identityVal := ctx.Value(                      // Get the user's identity from context
        constants.RequestIdentityKey)

    identity, ok := identityVal.(*integrations.RequestIdentity)
    if !ok || identity.Token == "" {               // Validate the identity
        return nil, fmt.Errorf("invalid or missing identity token")
    }

    // Create a K8s client using the user's token
    // This client operates AS the user -- all API calls have the user's permissions
    return newTokenKubernetesClient(               // Wrap in our client interface
        identity.Token, f.Logger, f.Config,
        f.SAClient, f.OTelConfigManager)
}
```

With token auth, the BFF never has more power than the user. Every K8s call goes through the user's own credentials. This is the more secure model.

## HTTP Clients for Upstream Services

Beyond Kubernetes, BFFs call upstream services like LlamaStack, MCP servers, MLflow, NeMo Guardrails, Pipeline Server, etc. These use standard HTTP clients. The gen-ai BFF also has a `bffclient/` package for inter-BFF communication and an `externalmodels/` package for OpenAI-compatible model providers.

Let's build up a typical integration client, starting simple. The following examples are from the **automl BFF's** `PipelineServer` client, but the pattern is identical across all BFFs:

**Step 1: The struct that holds the client's state:**

```go
// From the automl BFF -- other BFFs follow the same pattern with different service clients
type PipelineServerClient struct {                 // Client for calling the Pipeline Server
    baseURL    string                              // The service's URL (discovered from K8s)
    httpClient *http.Client                        // Go's built-in HTTP client
    authToken  string                              // User's auth token to forward
    logger     *slog.Logger                        // Logger for debugging
}
```

**Step 2: A method that makes an HTTP call:**

```go
func (c *PipelineServerClient) ListPipelineRuns(   // Fetch pipeline runs from the upstream service
    ctx context.Context,                           // Request context (for cancellation/timeouts)
    namespace string,                              // The namespace to list runs for
) ([]models.PipelineRun, error) {                  // Returns runs or error
    url := fmt.Sprintf(                            // Build the URL
        "%s/apis/v2beta1/runs?namespace=%s",       // URL template
        c.baseURL, namespace)                      // Fill in base URL and namespace

    req, err := http.NewRequestWithContext(         // Create an HTTP request with context
        ctx, "GET", url, nil)                      // GET request, no body
    if err != nil {                                // Check for URL parsing errors
        return nil, fmt.Errorf(                    // Wrap error with context
            "failed to create request: %w", err)
    }

    // Forward the user's auth token to the upstream service
    if c.authToken != "" {                         // Only add if we have a token
        req.Header.Set("Authorization",            // Set the Authorization header
            "Bearer "+c.authToken)                 // With the user's token
    }

    resp, err := c.httpClient.Do(req)              // Execute the HTTP request
    if err != nil {                                // Check for network errors
        return nil, fmt.Errorf(                    // Wrap error with context
            "failed to call pipeline server: %w", err)
    }
    defer resp.Body.Close()                        // MUST close the body when done (prevents leaks)

    if resp.StatusCode != http.StatusOK {           // Check the response status
        return nil, fmt.Errorf(                    // Return error for non-200 responses
            "pipeline server returned %d", resp.StatusCode)
    }

    var result struct {                            // Anonymous struct to decode the response
        Runs []models.PipelineRun `json:"runs"`    // Just the field we need
    }
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil { // Decode JSON
        return nil, fmt.Errorf(                    // Wrap error with context
            "failed to decode response: %w", err)
    }

    return result.Runs, nil                        // Return the data
}
```

Compare this to the TypeScript version at the top of this chapter. The structure is almost identical: build URL, set headers, make request, check status, parse response. The main difference is Go's explicit error handling at every step, where TypeScript lets the promise chain handle failures.

### The Factory

The factory creates clients with the right base URL and credentials:

```go
type PipelineServerClientFactory interface {        // Factory interface
    CreateClient(                                  // Create a client for a specific request
        baseURL string,                            // Where the service is
        authToken string,                          // User's token to forward
        insecureSkipVerify bool,                   // Skip TLS verification (dev only!)
        rootCAs *x509.CertPool,                    // CA certificates for TLS
    ) PipelineServerClientInterface                // Returns the client interface
}

type RealClientFactory struct{}                     // Real implementation (no fields needed)

func (f *RealClientFactory) CreateClient(          // Create a real HTTP client
    baseURL string,                                // Service URL
    authToken string,                              // User token
    insecureSkipVerify bool,                       // TLS skip flag
    rootCAs *x509.CertPool,                        // CA certs
) PipelineServerClientInterface {                  // Returns the interface
    transport := &http.Transport{                  // Configure TLS settings
        TLSClientConfig: &tls.Config{              // TLS configuration
            RootCAs:            rootCAs,            // Trust these CA certificates
            InsecureSkipVerify: insecureSkipVerify, // Skip cert verification (dev only!)
        },
    }
    return &PipelineServerClient{                  // Create and return the client
        baseURL:    baseURL,                       // Set the URL
        httpClient: &http.Client{Transport: transport}, // Create HTTP client with TLS config
        authToken:  authToken,                     // Set the token
    }
}
```

### How Middleware Attaches Clients

Remember from [Middleware](./middleware), the `AttachClient` middleware creates the client and puts it in context:

```go
func (app *App) AttachPipelineServerClient(        // Middleware that creates a client per request
    next httprouter.Handle,                        // The handler to wrap
) httprouter.Handle {                              // Returns the wrapped handler
    return func(                                   // The wrapper
        w http.ResponseWriter,
        r *http.Request,
        ps httprouter.Params,
    ) {
        // ... discover the service URL from K8s ...

        client := app.pipelineServerFactory.CreateClient( // Create the client
            baseURL, authToken, false, app.rootCAs) // With discovered URL and user's token

        ctx := context.WithValue(                  // Store client in context
            r.Context(),
            constants.PipelineServerClientKey,      // The key constant
            client)                                // The client
        r = r.WithContext(ctx)                     // Update the request

        next(w, r, ps)                             // Continue to handler
    }
}
```

The handler retrieves it:

```go
func (app *App) PipelineRunsHandler(               // The actual handler
    w http.ResponseWriter,
    r *http.Request,
    ps httprouter.Params,
) {
    client, ok := r.Context().Value(               // Read client from context
        constants.PipelineServerClientKey,
    ).(pipelineserver.PipelineServerClientInterface) // Type assertion
    if !ok {                                       // Check if middleware set it
        app.badRequestResponse(w, r,               // Send 400 if missing
            fmt.Errorf("missing pipeline client"))
        return                                     // Stop
    }

    runs, err := client.ListPipelineRuns(          // Use the client to fetch data
        r.Context(), namespace)                    // Pass context for cancellation
    // ...
}
```

The handler does not know or care how the client was created, what URL it points to, or whether it's real or mock. It just calls methods on the interface. This separation of concerns is what makes the BFF testable and flexible.

## Mock Clients

Every integration has a mock implementation that returns hardcoded or configurable data:

```go
type MockPipelineServerClient struct {              // Mock implementation -- same interface, fake data
    logger *slog.Logger                            // Logger (for debug output)
}

func (c *MockPipelineServerClient) ListPipelineRuns( // Mock version of ListPipelineRuns
    ctx context.Context,                           // Context (ignored in mock)
    namespace string,                              // Namespace (ignored in mock)
) ([]models.PipelineRun, error) {                  // Returns mock data
    return []models.PipelineRun{                   // Return hardcoded mock runs
        {                                          // First mock run
            ID:     "run-001",                     // Fake ID
            Name:   "mock-pipeline-run",           // Fake name
            Status: "Succeeded",                   // Fake status
        },
    }, nil                                         // No error
}
```

The mock factory:

```go
type MockClientFactory struct{}                     // Mock factory -- creates mock clients

func (f *MockClientFactory) CreateClient(          // Create a mock client (ignores all params)
    baseURL string,                                // Ignored
    authToken string,                              // Ignored
    insecureSkipVerify bool,                       // Ignored
    rootCAs *x509.CertPool,                        // Ignored
) PipelineServerClientInterface {                  // Returns the same interface
    return &MockPipelineServerClient{}             // Return the mock
}
```

Since both implement the same interface, the handler works identically with either. This is the power of Go interfaces -- they're satisfied implicitly. If your mock struct has all the right methods, it automatically implements the interface. No `implements` keyword needed.

In TypeScript, you would write `class MockPipelineClient implements PipelineServerClient`. In Go, there is no `implements` keyword -- if the struct has all the required methods, it satisfies the interface automatically.

## Comparing to Frontend API Services

The BFF's integration clients are conceptually identical to the API service functions you write on the frontend:

| Frontend (React) | BFF (Go) |
|---|---|
| `fetch('/api/v1/runs')` | `http.NewRequestWithContext(ctx, "GET", url, nil)` |
| `response.json()` | `json.NewDecoder(resp.Body).Decode(&result)` |
| `if (!response.ok) throw` | `if resp.StatusCode != 200 { return nil, err }` |
| Custom fetch wrapper | Integration client struct |
| Mock service worker (MSW) | Mock client struct |

The BFF layer adds Kubernetes awareness (auth tokens, service discovery, CA certificates) on top of the same HTTP client pattern you already know.

::: warning Token Forwarding
When the BFF calls an upstream service, it forwards the user's auth token. This ensures the upstream service also enforces RBAC for the calling user. Never hardcode tokens in integration clients.

```go
// CORRECT: forward user token
if c.authToken != "" {                             // Only add if we have a token
    req.Header.Set("Authorization",                // Set the header
        "Bearer "+c.authToken)                     // With the user's token
}

// NEVER do this:
req.Header.Set("Authorization",                    // Hardcoded token!
    "Bearer hardcoded-admin-token")                // Security vulnerability!
```
:::

::: tip Key Takeaway
The `internal/integrations/` directory contains clients for every external service the BFF talks to. Each integration follows the factory pattern: an interface defines the contract, a real implementation makes HTTP calls, and a mock implementation returns hardcoded data. Middleware creates the client per-request and attaches it to context, so handlers never need to know whether they're talking to a real service or a mock. This is the same dependency injection pattern you use with service mocks on the frontend.
:::

::: info See Also
- [Middleware Chain](./middleware) -- how `AttachClient` middleware creates and injects clients
- [Authentication & RBAC](./auth) -- the Kubernetes client's role in SelfSubjectAccessReview
- [The App Struct & Routes](./app-and-routes) -- where factories are initialized in `NewApp()`
- [Advanced Patterns](./advanced-patterns) -- inter-BFF communication and concurrent service calls
:::
