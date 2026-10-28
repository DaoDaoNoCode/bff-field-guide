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
- automl's `internal/integrations/` is now small (`http.go`, `kubernetes/`, `modelregistry/`); autorag's has `certificates/`, `http.go`, `kubernetes/`, `maas/` and `vectordb/`. Their pipelines and S3 clients moved out of the BFF entirely (see below)

The principle is the same across all BFFs, but the exact directory layout may differ.
:::

::: info Shared Services: autox-core
automl and autorag share their Kubernetes, Pipelines and S3 code through a separate Go module, `packages/autox-core/services` (subpackages `kubernetes/`, `pipelines/`, `s3/`). Each BFF's `go.mod` pulls it in with a `replace` directive pointing at the local path, so a change there affects both BFFs at once. The shape is slightly different from gen-ai's per-request factories: autox-core exposes a `Client` (raw HTTP or K8s calls) wrapped by a `Service` (business logic), both built once in `NewApp`, and the user's token travels in the request context instead of being baked into each client. This is the second way the repo shares Go code, next to copying a package such as `bffclient/` into each BFF.
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

The gen-ai BFF currently supports one auth method in its K8s factory: **user token auth** via `TokenClientFactory`. Both internal/service-account auth and `disabled` are still TODOs in `NewKubernetesClientFactory` (`internal/integrations/kubernetes/factory.go`) -- any other value returns `invalid auth method`. (`--auth-method=disabled` still works for the middleware, which skips identity extraction before the factory is ever asked.)

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

Let's build up a typical integration client, starting simple. Two real examples cover the two shapes you'll meet: the shared **autox-core pipelines client** (plain `net/http`, used by automl and autorag) and gen-ai's **LlamaStack client** (a per-request client from a factory).

**Step 1: The client and its HTTP transport (autox-core pipelines):**

```go
// packages/autox-core/services/pipelines/client.go (trimmed)
type client struct {                               // Unexported -- callers only see the Client interface
    HTTPClient HTTPClient                          // Anything with Do(*http.Request)
}

func NewDefaultClient(cfg ClientConfig) Client {   // Built once in NewApp
    transport := http.DefaultTransport.(*http.Transport).Clone()
    transport.ResponseHeaderTimeout = 20 * time.Second

    if cfg.InsecureSkipVerify || cfg.RootCAs != nil {
        tlsCfg := &tls.Config{MinVersion: tls.VersionTLS13}
        tlsCfg.InsecureSkipVerify = cfg.InsecureSkipVerify // Dev only!
        tlsCfg.RootCAs = cfg.RootCAs              // Trust the cluster CA bundle
        transport.TLSClientConfig = tlsCfg
    }

    hc := &http.Client{
        // Reads the user's token from the request context on every call
        Transport: k8s.NewBearerTokenRoundTripper(transport),
        Timeout:   maxRequestTimeout,              // 60s
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
            return http.ErrUseLastResponse         // Never follow redirects with a token
        },
    }
    return &client{HTTPClient: hc}
}
```

**Step 2: A method that makes an HTTP call:**

```go
// packages/autox-core/services/pipelines/client.go
func (c *client) GetPipelineRun(                   // Fetch one run from the Pipeline Server
    ctx context.Context,                           // Request context (carries the user's identity)
    baseURL string,                                // Discovered per namespace by the service layer
    runID string,
) (*PipelineRun, error) {
    ctx, cancel := context.WithTimeout(ctx, 10*time.Second) // Per-call timeout
    defer cancel()

    if runID == "" {
        return nil, fmt.Errorf("%w: runID is required", ErrInvalidInput)
    }

    apiURL := fmt.Sprintf("%s/apis/v2beta1/runs/%s", baseURL, url.PathEscape(runID))
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
    if err != nil {                                // Check for URL parsing errors
        return nil, fmt.Errorf("failed to create request: %w", err)
    }

    resp, err := c.HTTPClient.Do(req)              // The RoundTripper adds "Authorization: Bearer <token>"
    if err != nil {                                // Network errors
        return nil, fmt.Errorf("failed to execute request: %w", err)
    }
    defer resp.Body.Close()                        // MUST close the body when done (prevents leaks)

    if resp.StatusCode != http.StatusOK {          // Non-200 → typed error from the body
        return nil, readhttpError(resp)
    }

    var run PipelineRun
    if err := json.NewDecoder(io.LimitReader(resp.Body, maxSuccessBodySize)).Decode(&run); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    return &run, nil                               // Return the data
}
```

Compare this to the TypeScript version at the top of this chapter. The structure is almost identical: build URL, set headers, make request, check status, parse response. The main difference is Go's explicit error handling at every step, where TypeScript lets the promise chain handle failures. The other difference is where the token comes from: instead of storing it on the client, a `RoundTripper` (Go's equivalent of a `fetch` interceptor) reads it from `ctx` and sets the header. That's why one client can be shared by every request.

### The Factory

gen-ai goes the other way: it creates a fresh client per request, already carrying the user's token. The factory is the seam that lets tests swap in mocks:

```go
// packages/gen-ai/bff/internal/integrations/llamastack/llamastack_client_factory.go
type LlamaStackClientFactory interface {           // Factory interface
    CreateClient(
        baseURL string,                            // Where the OGX server is
        authToken string,                          // User's token to forward
        insecureSkipVerify bool,                   // Skip TLS verification (dev only!)
        rootCAs *x509.CertPool,                    // CA certificates for TLS
        apiPath string,                            // "/v1" for llama-stack v0.4.0+
    ) LlamaStackClientInterface                    // Returns the client interface
}

type RealClientFactory struct{}                    // Real implementation (no fields needed)

func NewRealClientFactory() LlamaStackClientFactory {
    return &RealClientFactory{}
}

func (f *RealClientFactory) CreateClient(baseURL string, authToken string,
    insecureSkipVerify bool, rootCAs *x509.CertPool, apiPath string) LlamaStackClientInterface {
    return NewLlamaStackClient(baseURL, authToken, insecureSkipVerify, rootCAs, apiPath)
}
```

`NewLlamaStackClient` (`llamastack_client.go`) builds an `http.Client` with the TLS config (wrapped in `otelhttp.NewTransport` for tracing), then hands it to the `openai-go` SDK with `option.WithAPIKey(authToken)` -- LlamaStack speaks the OpenAI API, so gen-ai doesn't hand-write those HTTP calls.

### How Middleware Attaches Clients

Remember from [Middleware](./middleware), `AttachOGXClient` finds the namespace's OGX server URL, calls the factory, and puts the client in context:

```go
// packages/gen-ai/bff/internal/api/middleware.go (trimmed)
llamaStackClient = app.llamaStackClientFactory.CreateClient(
    serviceURL, identity.Token,                    // Discovered URL + the user's token
    app.config.InsecureSkipVerify, app.rootCAs, "/v1")

ctx = context.WithValue(ctx, constants.LlamaStackClientKey, llamaStackClient)
next(w, r.WithContext(ctx), ps)                    // Continue to handler
```

The handler never touches the factory. `LlamaStackModelsHandler` passes `ctx` to the repository, and the repository reads the client back out:

```go
// packages/gen-ai/bff/internal/api/lsd_models_handler.go (trimmed)
func (app *App) LlamaStackModelsHandler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
    ctx := r.Context()
    // ...
    ogxModels, err := app.repositories.Models.ListModels(ctx, providerData) // Uses the client in ctx
    if err != nil {
        app.handleLlamaStackClientError(w, r, err)
        return
    }
    // ... filter and app.WriteJSON(w, http.StatusOK, ModelsResponse{Data: ogxModels}, nil)
}
```

The handler does not know or care how the client was created, what URL it points to, or whether it's real or mock. It just calls methods on the interface. This separation of concerns is what makes the BFF testable and flexible.

## Mock Clients

Every integration has a mock implementation that returns hardcoded or configurable data. gen-ai's mock factory ignores every argument:

```go
// packages/gen-ai/bff/internal/integrations/llamastack/lsmocks/llamastack_client_factory_mock.go
type MockClientFactory struct{}                    // Mock factory -- creates mock clients

func NewMockClientFactory() llamastack.LlamaStackClientFactory {
    return &MockClientFactory{}
}

func (f *MockClientFactory) CreateClient(_ string, _ string, _ bool, _ *x509.CertPool, _ string,
) llamastack.LlamaStackClientInterface {
    if client := TryCreateTestClient(); client != nil { // TEST_LLAMA_STACK_PORT set (make test)?
        return client                              // → talk to a real local server
    }
    return NewMockLlamaStackClient()               // Otherwise → in-memory fake data
}
```

And the mock client returns fixed data:

```go
// packages/gen-ai/bff/internal/integrations/llamastack/lsmocks/llamastack_client_mock.go (trimmed)
func (m *MockLlamaStackClient) ListModels(ctx context.Context) ([]openai.Model, error) {
    // One namespace deliberately returns nothing, to test empty states in Cypress
    if ns, ok := ctx.Value(constants.NamespaceQueryParameterKey).(string); ok && ns == "mock-test-namespace-3" {
        return []openai.Model{}, nil
    }
    return []openai.Model{
        {ID: "ollama/llama3.2:3b", Object: "model", Created: 1755721063, OwnedBy: "ogx"},
        {ID: "ollama/all-minilm:l6-v2", Object: "model", Created: 1755721063, OwnedBy: "ogx"},
        // ...
    }, nil
}
```

automl does the same with `fake.NewPipelinesClient()` and `fake.NewS3Client()` in `internal/fake/`, which satisfy the autox-core `pipelines.Client` and `s3.Client` interfaces.

Since both implement the same interface, the handler works identically with either. This is the power of Go interfaces -- they're satisfied implicitly. If your mock struct has all the right methods, it automatically implements the interface. No `implements` keyword needed.

In TypeScript, you would write `class MockLlamaStackClient implements LlamaStackClient`. In Go, there is no `implements` keyword -- if the struct has all the required methods, it satisfies the interface automatically.

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
// CORRECT: forward the user's token from the request identity
req2 := req.Clone(ctx)                             // (autox-core tokenRoundTripper)
req2.Header.Set("Authorization", "Bearer "+identity.Token)

// NEVER do this:
req.Header.Set("Authorization",                    // Hardcoded token!
    "Bearer hardcoded-admin-token")                // Security vulnerability!
```
:::

::: tip Key Takeaway
The `internal/integrations/` directory contains clients for every external service the BFF talks to. Each integration follows the factory pattern: an interface defines the contract, a real implementation makes HTTP calls, and a mock implementation returns hardcoded data. Middleware creates the client per-request and attaches it to context (gen-ai), or a shared client reads the token from context (autox-core), so handlers never need to know whether they're talking to a real service or a mock. This is the same dependency injection pattern you use with service mocks on the frontend.
:::

::: info See Also
- [Middleware Chain](./middleware) -- how `AttachClient` middleware creates and injects clients
- [Authentication & RBAC](./auth) -- the Kubernetes client's role in SelfSubjectAccessReview
- [The App Struct & Routes](./app-and-routes) -- where factories are initialized in `NewApp()`
- [Advanced Patterns](./advanced-patterns) -- inter-BFF communication and concurrent service calls
:::
