# Tutorial 4: Creating Mock Clients

In Jest, you `jest.mock()` a module and the test framework magically replaces it at runtime. In Go, there is no magic. You write a second implementation of the same interface -- one for production, one for tests. It sounds like more work, but it is actually more predictable, more readable, and easier to debug than `jest.mock()` ever was.

This tutorial will show you exactly how, step by step.

**Time:** ~20 minutes

**Prerequisite:** Complete [Tutorial 3: Writing Handler Tests](./writing-tests).

## The Mental Shift: Jest Mocking vs Go Mocking

This is one of the biggest conceptual shifts coming from TypeScript. Let's put them side by side:

In TypeScript with Jest, you mock a module:

```typescript
import { fetchModels } from './api';          // Import the real module

jest.mock('./api', () => ({                    // Jest replaces the module at load time
  fetchModels: jest.fn()                       // Create a spy/stub
    .mockResolvedValue([                       // Tell it what to return
      { id: '1', name: 'model-a' },           // Return this fake data
    ]),
}));

// Now when your code calls fetchModels(), it gets the mock data.
// The replacement happens behind the scenes -- you never see how.
```

In Go, you define an interface and create two implementations:

```go
// Step 1: Define what the dependency looks like (the contract)
type ModelClient interface {                   // An interface is just a list of method signatures
    GetModels(ctx context.Context) ([]Model, error)  // "Any type with this method satisfies me"
}

// Step 2: The REAL implementation (used in production)
type httpClient struct {                       // Lowercase = unexported = private to this package
    baseURL string                             // Stores the API base URL
}
func (c *httpClient) GetModels(ctx context.Context) ([]Model, error) {  // Implements the interface
    // Makes an actual HTTP call to the upstream service
    resp, err := http.Get(c.baseURL + "/models")  // Real network request
    // ... parse response ...
    return models, nil                         // Return real data
}

// Step 3: The MOCK implementation (used in tests)
type mockClient struct {                       // Another struct, same interface
    models []Model                             // Pre-configured return value
    err    error                               // Pre-configured error (or nil)
}
func (m *mockClient) GetModels(ctx context.Context) ([]Model, error) {  // Same method signature
    return m.models, m.err                     // Just return whatever was configured
}
```

Here is the key insight: both `httpClient` and `mockClient` have a `GetModels` method with the exact same signature. That means they both satisfy the `ModelClient` interface. Your handler code accepts a `ModelClient`, and it does not care which implementation it gets. In production, it gets the real one. In tests, it gets the mock.

::: tip No Magic, Just Interfaces
The Go approach is more explicit, but it has a big advantage: you can see exactly what your mock does by reading its struct definition. There is no hidden `jest.mock()` behavior, no hoisting surprises, and no wondering "which module got mocked?" The mock is just a struct. The interface is just a list of methods. Everything is visible.
:::

## Step 1: Understanding the Pattern in the Codebase

Let's look at a real example. Open this file:

```
packages/automl/bff/internal/integrations/kubernetes/kubernetes.go
```

You will find an interface definition that looks something like this:

```go
// KubernetesClientInterface defines what a Kubernetes client can do.
// Any struct that has ALL of these methods automatically satisfies this interface.
// No "implements" keyword needed -- Go uses structural typing for interfaces.
type KubernetesClientInterface interface {
    GetNamespaces(ctx context.Context, identity *RequestIdentity) ([]corev1.Namespace, error)
    GetSecrets(ctx context.Context, namespace string, identity *RequestIdentity) ([]corev1.Secret, error)
    GetSecret(ctx context.Context, namespace, secretName string, identity *RequestIdentity) (*corev1.Secret, error)
    IsClusterAdmin(identity *RequestIdentity) (bool, error)
    GetUser(identity *RequestIdentity) (string, error)
    // ... more methods
}
```

And the factory interface:

```go
// KubernetesClientFactory creates Kubernetes clients.
// The App struct holds one of these -- not a concrete client.
// That's what makes the swap possible: tests provide a factory that returns mocks.
type KubernetesClientFactory interface {
    GetClient(ctx context.Context) (KubernetesClientInterface, error)
    ExtractRequestIdentity(httpHeader http.Header) (*RequestIdentity, error)
    ValidateRequestIdentity(identity *RequestIdentity) error
}
```

The `App` struct holds a `KubernetesClientFactory`, not a concrete Kubernetes client. This is the dependency injection pattern. In tests, you provide a factory that returns mock clients. In production, you provide a factory that returns real clients. The handler code is identical either way.

## Step 2: Build a Mock Client

Now let's build one ourselves. Create a new file:

```
packages/automl/bff/internal/api/feedback_mocks_test.go
```

::: info The `_test.go` Suffix
Files ending in `_test.go` are only compiled when running tests. They are invisible to production code. This is perfect for mocks -- they live next to the code they mock but never get included in the production binary.
:::

```go
package api                            // Same package as the code being tested

import (                               // Imports needed for mock types
	"context"                          // For context.Context in method signatures
	"net/http"                         // For http.Header in method signatures

	"github.com/opendatahub-io/automl-library/bff/internal/integrations/kubernetes"  // Interface types
	corev1 "k8s.io/api/core/v1"        // Kubernetes core types (Namespace, Secret, etc.)
	"k8s.io/client-go/rest"            // Kubernetes REST client config
)

// ──────────────────────────────────────────────────────────────
// mockK8sClient -- the mock Kubernetes client
// ──────────────────────────────────────────────────────────────

// mockK8sClient implements KubernetesClientInterface with configurable responses.
//
// In Jest, you'd write:
//   const mockK8s = {
//     getUser: jest.fn().mockReturnValue('test-user'),
//     isClusterAdmin: jest.fn().mockReturnValue(true),
//   };
//
// In Go, you define a struct with fields for the return values:
type mockK8sClient struct {            // This struct satisfies KubernetesClientInterface
	userID        string               // What GetUser will return
	isAdmin       bool                 // What IsClusterAdmin will return
	adminErr      error                // Error that IsClusterAdmin will return (or nil)
	namespaces    []corev1.Namespace   // What GetNamespaces will return
	namespacesErr error                // Error that GetNamespaces will return (or nil)
}

// Each method below returns the pre-configured values from the struct fields.
// This is exactly like jest.fn().mockReturnValue(value) -- but explicit.

func (m *mockK8sClient) GetUser(identity *kubernetes.RequestIdentity) (string, error) {
	return m.userID, nil               // Return the pre-configured user ID, no error
}

func (m *mockK8sClient) IsClusterAdmin(identity *kubernetes.RequestIdentity) (bool, error) {
	return m.isAdmin, m.adminErr       // Return pre-configured admin status and optional error
}

func (m *mockK8sClient) GetNamespaces(ctx context.Context, identity *kubernetes.RequestIdentity) ([]corev1.Namespace, error) {
	return m.namespaces, m.namespacesErr  // Return pre-configured namespace list
}

// Methods we don't care about in these tests -- return zero values.
// You MUST implement ALL methods in the interface, even the ones you don't use.
// Just return nil/zero values for methods that aren't relevant to your test.

func (m *mockK8sClient) GetSecrets(ctx context.Context, namespace string, identity *kubernetes.RequestIdentity) ([]corev1.Secret, error) {
	return nil, nil                    // Not used in our tests -- return nothing
}

func (m *mockK8sClient) GetSecret(ctx context.Context, namespace, secretName string, identity *kubernetes.RequestIdentity) (*corev1.Secret, error) {
	return nil, nil                    // Not used in our tests -- return nothing
}

func (m *mockK8sClient) GetClientset() interface{} {
	return nil                         // Not used in our tests
}

func (m *mockK8sClient) GetRestConfig() *rest.Config {
	return nil                         // Not used in our tests
}
```

::: warning Method Signatures May Change
The specific method signatures shown here (e.g., `GetClientset() interface{}`, `GetRestConfig() *rest.Config`) are illustrative. Always check the actual interface definition in your BFF's `internal/integrations/kubernetes/` directory -- the interface may have changed since this guide was written.
:::

```go

func (m *mockK8sClient) CanListDSPipelineApplications(ctx context.Context, identity *kubernetes.RequestIdentity, namespace string) (bool, error) {
	return true, nil                   // Default to allowing access in tests
}

// ──────────────────────────────────────────────────────────────
// mockK8sFactory -- the factory that returns our mock client
// ──────────────────────────────────────────────────────────────

// mockK8sFactory implements KubernetesClientFactory.
// It returns our mock client whenever GetClient is called.
type mockK8sFactory struct {           // The factory holds a reference to the mock client
	client *mockK8sClient              // Pre-configured mock client to return
}

func (f *mockK8sFactory) GetClient(ctx context.Context) (kubernetes.KubernetesClientInterface, error) {
	return f.client, nil               // Always return the pre-configured mock client
}

func (f *mockK8sFactory) ExtractRequestIdentity(httpHeader http.Header) (*kubernetes.RequestIdentity, error) {
	return &kubernetes.RequestIdentity{ // Return a fake identity -- always "test-user"
		UserID: "test-user",           // Hard-coded for testing
	}, nil                             // No error
}

func (f *mockK8sFactory) ValidateRequestIdentity(identity *kubernetes.RequestIdentity) error {
	return nil                         // Always valid in tests
}

// ──────────────────────────────────────────────────────────────
// mockK8sFailingFactory -- a factory that always errors
// ──────────────────────────────────────────────────────────────

// mockK8sFailingFactory always returns an error from GetClient.
// Use this to test what happens when Kubernetes is unreachable.
type mockK8sFailingFactory struct {     // Simulates a broken K8s connection
	err error                          // The error to return
}

func (f *mockK8sFailingFactory) GetClient(ctx context.Context) (kubernetes.KubernetesClientInterface, error) {
	return nil, f.err                  // Return nil client and the error
}

func (f *mockK8sFailingFactory) ExtractRequestIdentity(httpHeader http.Header) (*kubernetes.RequestIdentity, error) {
	return &kubernetes.RequestIdentity{ // Still returns an identity -- the failure is in GetClient
		UserID: "test-user",
	}, nil
}

func (f *mockK8sFailingFactory) ValidateRequestIdentity(identity *kubernetes.RequestIdentity) error {
	return nil                         // Identity validation still passes
}
```

## Step 3: Using the Mock in a Test

Here is the payoff. You can now test any handler that needs a Kubernetes client by swapping in your mock. Add this test to your `feedback_handler_test.go`:

```go
func TestUserHandler_WithMockClient(t *testing.T) {  // Test the existing UserHandler with our mock

	// ── Configure the mock ──
	// Want a specific user? Set userID.
	// Want an admin? Set isAdmin to true.
	// Want an error? Set adminErr to fmt.Errorf("something broke").
	client := &mockK8sClient{          // Create a mock with specific return values
		userID:  "alice@example.com",  // GetUser() will return this
		isAdmin: false,                // IsClusterAdmin() will return false
	}
	factory := &mockK8sFactory{        // Wrap the client in a factory
		client: client,                // GetClient() will return our mock
	}

	// ── Build a test App with the mock factory ──
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{}))  // Silent logger
	app := &App{                       // Construct the App with our mock factory injected
		config: config.EnvConfig{      // Minimal config
			AllowedOrigins: []string{"*"},
			AuthMethod:     config.AuthMethodInternal,
		},
		logger:                  logger,     // Silent logger
		kubernetesClientFactory: factory,    // HERE -- our mock factory instead of a real one
		repositories:            repositories.NewRepositories(logger),  // Real repos are fine
	}

	// ── Build the request with identity in the context ──
	// Normally the middleware sets the identity, but in tests we set it manually.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/user", nil)  // GET request, no body
	identity := &kubernetes.RequestIdentity{   // Create a fake user identity
		UserID: "alice@example.com",           // Must match what the mock returns
	}
	ctx := context.WithValue(                  // Attach the identity to the request context
		req.Context(),                         // Get the existing context
		constants.RequestIdentityKey,          // Use the same key the middleware uses
		identity,                              // The identity value
	)
	req = req.WithContext(ctx)                 // Replace the request's context

	// ── Call the handler ──
	rr := httptest.NewRecorder()               // Fresh recorder
	app.UserHandler(rr, req, httprouter.Params{})  // Call the handler

	// ── Assert ──
	assert.Equal(t, http.StatusOK, rr.Code)    // Should return 200

	var envelope UserEnvelope                  // Parse the response
	err := json.Unmarshal(rr.Body.Bytes(), &envelope)  // JSON -> struct
	assert.NoError(t, err)                     // Parsing should succeed
	assert.Equal(t,                            // Check the user ID
		"alice@example.com",                   // Expected
		envelope.Data.UserID,                  // Actual
	)
}
```

You will need these additional imports in your test file:

```go
	"context"                                                                     // For context.WithValue
	"github.com/opendatahub-io/automl-library/bff/internal/constants"             // For RequestIdentityKey
	"github.com/opendatahub-io/automl-library/bff/internal/integrations/kubernetes" // For RequestIdentity
	"github.com/opendatahub-io/automl-library/bff/internal/repositories"          // For NewRepositories
```

## Step 4: Testing Error Scenarios

The real power of mocks is testing error paths. With a real Kubernetes client, you cannot easily trigger a "connection refused" error. With a mock, it is one struct field:

```go
func TestUserHandler_K8sError(t *testing.T) {  // Test what happens when K8s is down

	// Create a factory that FAILS when GetClient is called
	failingFactory := &mockK8sFailingFactory{  // Use our failing factory
		err: fmt.Errorf("connection refused"),  // Simulate K8s being unreachable
	}

	// Build the app with the failing factory
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{}))
	app := &App{                               // Same setup as before, but with failingFactory
		config: config.EnvConfig{
			AllowedOrigins: []string{"*"},
			AuthMethod:     config.AuthMethodInternal,
		},
		logger:                  logger,
		kubernetesClientFactory: failingFactory,   // THIS factory always returns an error
		repositories:            repositories.NewRepositories(logger),
	}

	// Build the request (same as before)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/user", nil)
	identity := &kubernetes.RequestIdentity{UserID: "alice@example.com"}
	ctx := context.WithValue(req.Context(), constants.RequestIdentityKey, identity)
	req = req.WithContext(ctx)

	// Call the handler
	rr := httptest.NewRecorder()
	app.UserHandler(rr, req, httprouter.Params{})

	// When K8s is unreachable, the handler should return 500
	assert.Equal(t, http.StatusInternalServerError, rr.Code)  // 500 Internal Server Error
}
```

Add `"fmt"` to the imports in the test file for `fmt.Errorf`.

## Step 5: Run the Tests

```bash
cd packages/automl/bff
go test ./internal/api/ -v -run "TestUserHandler_WithMock|TestUserHandler_K8s"
```

**What you should see:**

```
=== RUN   TestUserHandler_WithMockClient
--- PASS: TestUserHandler_WithMockClient (0.00s)
=== RUN   TestUserHandler_K8sError
--- PASS: TestUserHandler_K8sError (0.00s)
PASS
```

## The Pattern Summary

Here is how the two approaches compare, step by step:

| Step | Jest (TypeScript) | Go |
|------|------|-----|
| 1. Define the contract | TypeScript `interface` (often implicit) | Go `interface` with method signatures |
| 2. Create the mock | `jest.mock('./module')` or `jest.fn()` | Struct with fields for return values |
| 3. Configure responses | `.mockReturnValue(x)` or `.mockResolvedValue(x)` | Set struct fields: `mock.result = x` |
| 4. Inject the mock | Module replacement (automatic, invisible) | Pass mock as a constructor argument (explicit, visible) |
| 5. Assert calls | `expect(mock).toHaveBeenCalledWith(...)` | Check struct fields or use a call-tracking slice |

::: tip Want to Track What Was Called?
If you need to verify that a method was called with specific arguments (like `expect(mock).toHaveBeenCalledWith(...)`), add a field to track calls:

```go
type mockClient struct {               // The mock struct
    getModelsCalled bool               // Track if GetModels was called
    getModelsArgs   []string           // Track what arguments were passed
}

func (m *mockClient) GetModels(ctx context.Context, namespace string) ([]Model, error) {
    m.getModelsCalled = true           // Record that we were called
    m.getModelsArgs = append(m.getModelsArgs, namespace)  // Record the argument
    return m.models, m.err             // Return configured values
}

// In your test:
assert.True(t, mock.getModelsCalled)                    // Verify it was called
assert.Equal(t, []string{"my-namespace"}, mock.getModelsArgs)  // Verify the arguments
```
:::

---

<div class="checkpoint">

#### Checkpoint

Before moving on:

- [ ] You understand that Go mocks are structs that implement interfaces
- [ ] You can create a mock with configurable return values by setting struct fields
- [ ] You can inject a mock into the `App` struct for testing
- [ ] You know how to test error paths by making the mock return errors
- [ ] You understand why Go's approach is more explicit (but also more debuggable) than `jest.mock()`

</div>

## What's Next

You have tested Go code with Go tests. In [Tutorial 5: Contract Tests](./contract-tests), you will write a TypeScript test (yes, TypeScript!) that validates your BFF's API against its OpenAPI specification. This is where the frontend and backend testing worlds meet -- and you get to work in your home language again.
