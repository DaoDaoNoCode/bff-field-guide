# Testing — Built In, Not Bolted On

> **Go Concept:** Go has a built-in test framework. No npm install, no jest.config.js, no babel transforms. Create a file ending in `_test.go` and run `go test`.

Good news: Go's testing is the simplest part of the language to get started with. There's no test runner to install, no configuration file to create, no assertion library to choose between, no transpiler to set up. The `testing` package ships with Go, and `go test` discovers and runs your tests automatically.

If you've ever spent 30 minutes debugging a Jest configuration issue with module transforms or import paths, you're going to appreciate this.

## Starting from What You Know

Here's a Jest test you've written a hundred times:

```ts
// TypeScript -- Jest
import { formatName } from './utils';             // Import the function to test

describe('formatName', () => {                     // Group related tests
  it('should format first and last name', () => {  // Describe specific behavior
    expect(formatName('Alice', 'Smith'))            // Call the function
      .toBe('Alice Smith');                        // Assert the expected result
  });                                              // Test case complete

  it('should handle empty last name', () => {      // Another test case
    expect(formatName('Alice', ''))                 // Different input
      .toBe('Alice');                              // Different expected result
  });                                              // Another case complete
});                                                // Describe block complete
```

Three things happening: import the code, group tests with `describe`, assert with `expect().toBe()`. Let's see the Go version.

## The Simplest Test

```go
package utils                                    // Same package as the code being tested
                                                 // Test files live NEXT TO the source files

import "testing"                                 // The only import you need for basic tests
                                                 // Part of Go's standard library

func TestFormatName(t *testing.T) {              // Test function -- must start with "Test"
                                                 // Must take exactly one param: *testing.T
                                                 // t is your test context (like Jest's expect)

    result := formatName("Alice", "Smith")       // Call the function being tested
                                                 // Same as you'd call it in production code

    if result != "Alice Smith" {                 // Plain Go if-statement to check the result
                                                 // No .toBe(), no .toEqual() -- just ==
        t.Errorf(                                // Report the failure with a formatted message
            "formatName(Alice, Smith) = %q, want %q", // %q adds quotes around strings
            result,                              // What we actually got
            "Alice Smith",                       // What we expected
        )                                        // t.Errorf marks the test as failed
                                                 // but continues running the rest
    }                                            // If the condition is false, test passed!
}                                                // Test function complete
```

**What just happened?** That's a complete, runnable test. No imports beyond `"testing"`, no configuration file, no assertion library. The function name starts with `Test` (capital T), takes `*testing.T`, and uses plain Go `if` statements for assertions.

Wait -- where's `expect().toBe()`? Go doesn't have it. You use `if` and call `t.Errorf()` when something's wrong. This feels primitive at first, but it means you never need to learn an assertion API. It's just Go code.

### Test files live next to the code

```
internal/api/
  handlers.go              # The code
  handlers_test.go         # Tests for that code
  middleware.go            # More code
  middleware_test.go       # Tests for that code
```

The naming rule is simple: tests for `foo.go` go in `foo_test.go`. Same directory, same package. `go test` finds them automatically.

::: info
Three rules for test files:
1. File name **must** end with `_test.go`
2. Function name **must** start with `Test` (capital T)
3. Function **must** take exactly one parameter: `*testing.T`

Break any of these and Go silently ignores your test. It won't run and it won't tell you why.
:::

### Reporting failures

There are two ways to report a failure, and they behave differently:

```go
func TestExample(t *testing.T) {                 // A test with both failure styles

    // t.Errorf -- marks failed, keeps running
    result := add(2, 3)                          // Call the function
    if result != 5 {                             // Check the result
        t.Errorf("add(2, 3) = %d, want 5",      // Report failure with details
            result)                              // Test continues after this!
    }                                            // We can check more things

    // t.Fatalf -- marks failed, STOPS this test
    config, err := loadConfig()                  // Call a function that returns an error
    if err != nil {                              // Check for error
        t.Fatalf("loadConfig failed: %v", err)   // Report and STOP -- can't continue
                                                 // No point checking config if load failed
    }                                            // If we get past Fatal, config is valid

    if config.Port != 8080 {                     // Only runs if loadConfig succeeded
        t.Errorf("port = %d, want 8080",         // Report (keeps running)
            config.Port)                         // Check remaining assertions
    }                                            // Test continues
}
```

| Method | What it does | When to use |
|---|---|---|
| `t.Error(args...)` | Marks test as failed, **keeps running** | When you want to check multiple things |
| `t.Errorf(format, args...)` | Same, with format string | Most common -- includes the actual vs expected |
| `t.Fatal(args...)` | Marks test as failed, **stops this test** | When continuing makes no sense |
| `t.Fatalf(format, args...)` | Same, with format string | If setup failed, can't check results |

::: tip
Use `t.Fatal` for setup steps (loading config, creating test data). Use `t.Errorf` for assertions where you want to see all failures, not just the first one.
:::

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Create a test file with the `_test.go` suffix
- Write a test function with the `Test` prefix and `*testing.T` parameter
- Use `t.Errorf` to report failures (continues running)
- Use `t.Fatalf` to report fatal failures (stops the test)
- Understand that Go tests use plain `if` statements instead of assertion libraries

</div>

## Subtests with `t.Run`

`t.Run` creates subtests -- Go's equivalent of nested `describe`/`it` blocks in Jest:

::: code-group
```ts [TypeScript -- Jest]
describe('divide', () => {                          // Group: divide function
  it('should divide two numbers', () => {           // Happy path
    expect(divide(10, 2)).toBe(5);                  // Assert result
  });                                               // Test case

  it('should return error for zero divisor', () => { // Error path
    expect(() => divide(10, 0)).toThrow();           // Assert it throws
  });                                               // Test case
});                                                 // Describe block
```

```go [Go]
func TestDivide(t *testing.T) {                     // Top-level test function
                                                    // Like describe('divide', ...)

    t.Run("divides two numbers", func(t *testing.T) { // Subtest -- like it('should...')
                                                      // Gets its own *testing.T
        result, err := divide(10, 2)                  // Call the function
        if err != nil {                               // Check for unexpected error
            t.Fatal("unexpected error:", err)          // Fatal -- can't check result
        }                                             // Past here, no error
        if result != 5 {                              // Check the result
            t.Errorf("got %f, want 5", result)        // Report wrong result
        }                                             // Assert complete
    })                                                // End of first subtest

    t.Run("returns error for zero divisor",           // Second subtest
        func(t *testing.T) {                          // Its own *testing.T
        _, err := divide(10, 0)                       // Call with zero divisor
                                                      // _ ignores the result value
        if err == nil {                               // We EXPECT an error
            t.Fatal("expected error, got nil")        // If no error, test fails
        }                                             // Past here, error exists (good!)
    })                                                // End of second subtest
}                                                     // End of TestDivide
```
:::

**What just happened?** `t.Run("name", func(t *testing.T) { ... })` creates a named subtest, like `it('name', () => { ... })` in Jest. Each subtest gets its own `*testing.T`, so failures in one don't stop the others. You can even run a specific subtest from the command line with `-run TestDivide/divides`.

## Table-Driven Tests -- Go's Signature Pattern

This is the most important testing pattern in Go. Every BFF test file uses it. It's like `it.each` in Jest, but more idiomatic and more flexible.

The idea: define all your test cases as a slice of structs, then loop through them:

::: code-group
```ts [TypeScript -- Jest]
describe('add', () => {
  it.each([                                       // it.each runs the test for each case
    [1, 2, 3],                                   // Inputs and expected output
    [0, 0, 0],                                   // Another case
    [-1, 1, 0],                                  // Another case
    [100, 200, 300],                             // Another case
  ])('add(%i, %i) should return %i',              // Test name template
    (a, b, expected) => {                         // Destructured params
      expect(add(a, b)).toBe(expected);           // The actual assertion
    });                                           // End of it.each
});
```

```go [Go]
func TestAdd(t *testing.T) {                     // Top-level test function

    tests := []struct {                          // Define a slice of anonymous structs
                                                 // Each struct is one test case
        name     string                          // Human-readable name for the subtest
        a, b     int                             // Input values
        expected int                             // What we expect
    }{                                           // Now the test case data:
        {name: "positive numbers",               // First case
            a: 1, b: 2, expected: 3},            // 1 + 2 = 3
        {name: "zeros",                          // Second case
            a: 0, b: 0, expected: 0},            // 0 + 0 = 0
        {name: "negative and positive",          // Third case
            a: -1, b: 1, expected: 0},           // -1 + 1 = 0
        {name: "large numbers",                  // Fourth case
            a: 100, b: 200, expected: 300},      // 100 + 200 = 300
    }                                            // All test cases defined

    for _, tt := range tests {                   // Loop over each test case
                                                 // tt is the current test case
                                                 // _ is the index (unused)
        t.Run(tt.name, func(t *testing.T) {      // Run as a named subtest
            result := add(tt.a, tt.b)            // Call the function with this case's inputs
            if result != tt.expected {           // Check the result
                t.Errorf("add(%d, %d) = %d, want %d", // Report with all the details
                    tt.a, tt.b,                  // What we passed in
                    result,                      // What we got
                    tt.expected)                 // What we wanted
            }                                    // Assertion complete
        })                                       // Subtest complete
    }                                            // Next test case
}                                                // All cases run
```
:::

**What just happened?** We defined four test cases as data, then looped over them. Adding a new test case is just adding one more line to the slice -- no copy-pasting test functions. The `t.Run(tt.name, ...)` call creates a named subtest for each case, so when one fails, you see exactly which case failed.

This pattern is used extensively in the BFF codebase. You'll see tables with `name`, `input`, `wantErr`, `wantStatus`, `wantBody` fields.

### Table-driven test for error cases

Here's a more realistic example testing a validation function:

```go
func TestValidatePort(t *testing.T) {            // Test the port validation function

    tests := []struct {                          // Slice of test case structs
        name    string                           // Human-readable description
        port    int                              // Input port number
        wantErr bool                             // Do we expect an error?
    }{                                           // The test cases:
        {name: "valid port",                     // Normal case
            port: 8080, wantErr: false},         // 8080 is valid
        {name: "minimum valid",                  // Boundary: lowest valid
            port: 1, wantErr: false},            // 1 is the minimum
        {name: "maximum valid",                  // Boundary: highest valid
            port: 65535, wantErr: false},         // 65535 is the maximum
        {name: "zero is invalid",                // Below minimum
            port: 0, wantErr: true},             // 0 is not a valid port
        {name: "negative is invalid",            // Way below minimum
            port: -1, wantErr: true},            // Negative ports don't exist
        {name: "too high",                       // Above maximum
            port: 65536, wantErr: true},         // One more than max
    }                                            // Six cases covering the boundaries

    for _, tt := range tests {                   // Loop over each case
        t.Run(tt.name, func(t *testing.T) {      // Named subtest
            err := validatePort(tt.port)         // Call the function
            if (err != nil) != tt.wantErr {      // Did we get an error when we shouldn't?
                                                 // Or NOT get one when we should?
                t.Errorf("validatePort(%d) error = %v, wantErr %v",
                    tt.port,                     // The input
                    err,                         // The actual error (or nil)
                    tt.wantErr)                  // Whether we expected one
            }                                    // Assertion complete
        })                                       // Subtest complete
    }                                            // All cases run
}
```

Notice the assertion pattern `(err != nil) != tt.wantErr`. This clever one-liner checks: "did the presence or absence of an error match what we expected?" If `wantErr` is `true` and `err` is `nil`, the test fails. If `wantErr` is `false` and `err` is not `nil`, the test also fails. You'll see this exact pattern in every BFF test file.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Use `t.Run` to create named subtests
- Write table-driven tests with a slice of struct test cases
- Use the `(err != nil) != tt.wantErr` pattern for error checking
- Add boundary test cases (minimum, maximum, zero, negative)
- Know that adding a new test case means adding one line of data

</div>

## Testing HTTP Handlers

This is the BFF-specific part. Go's `net/http/httptest` package lets you test handlers without starting a real server. It's like `supertest` in Node.js, but simpler.

The core tools:

- `httptest.NewRecorder()` -- creates a fake `ResponseWriter` that captures the response
- `httptest.NewRequest()` -- creates a test request (returns `*http.Request` directly, no error)
- Call the handler directly -- no server needed

### Your first handler test

::: code-group
```ts [TypeScript -- supertest]
import request from 'supertest';                  // Import supertest
import app from './app';                          // Import the Express app

describe('GET /healthcheck', () => {              // Test the health check
  it('should return 200', async () => {            // It should return 200
    const res = await request(app)                 // Send a request to the app
      .get('/healthcheck')                        // GET /healthcheck
      .expect(200);                               // Assert status code

    expect(res.body).toEqual({                     // Assert response body
      status: 'healthy'                           // Expected JSON
    });                                           // Body check complete
  });                                             // Test complete
});
```

```go [Go -- httptest]
func TestHealthCheck(t *testing.T) {              // Test function for health check

    app := NewApp(slog.Default(), &EnvConfig{})   // Create a fresh App instance
                                                  // With a default logger and empty config
                                                  // Each test gets its own App (isolation!)

    req := httptest.NewRequest(                   // Create a fake HTTP request
        "GET",                                    // HTTP method
        "/healthcheck",                           // URL path
        nil,                                      // Request body (nil for GET)
    )                                             // Returns *http.Request directly
                                                  // Note: NO error return! Unlike http.NewRequest

    rr := httptest.NewRecorder()                  // Create a fake ResponseWriter
                                                  // rr captures everything written to it:
                                                  // status code, headers, body

    app.HealthCheckHandler(rr, req, nil)          // Call the handler DIRECTLY
                                                  // Pass the recorder as the ResponseWriter
                                                  // Pass nil for httprouter.Params (not needed)
                                                  // No server, no network, no ports

    // Check the status code
    if rr.Code != http.StatusOK {                 // rr.Code is the recorded status code
        t.Errorf("status = %d, want %d",          // Report if wrong
            rr.Code, http.StatusOK)               // Show actual vs expected
    }                                             // Status check complete

    // Check the response body
    var body map[string]string                    // Declare a map to hold the parsed response
    json.NewDecoder(rr.Body).Decode(&body)        // Parse the recorded body as JSON
                                                  // rr.Body is a *bytes.Buffer with the response

    if body["status"] != "healthy" {              // Check the parsed JSON
        t.Errorf("body status = %q, want %q",     // Report if wrong
            body["status"], "healthy")            // %q adds quotes around strings
    }                                             // Body check complete
}                                                 // Test complete
```
:::

**What just happened?** We tested an HTTP handler without starting a server. `httptest.NewRecorder()` acts as a fake browser/client, capturing everything the handler writes. `httptest.NewRequest()` creates a fake request. We call the handler directly, passing these fakes, and then inspect what was "sent" by reading from the recorder.

This is elegant: no server ports, no network calls, no race conditions. The test runs in microseconds.

### Testing a POST handler with JSON body

```go
func TestCreateModel(t *testing.T) {             // Test a POST handler

    app := NewApp(slog.Default(), &EnvConfig{})  // Fresh App instance

    body := strings.NewReader(                   // Create a reader with JSON body
        `{"name":"test-model",` +                // JSON as a raw string
        `"namespace":"default"}`,                // strings.NewReader wraps it as io.Reader
    )                                            // This is what the handler will read

    req := httptest.NewRequest(                  // Create the request
        "POST",                                  // POST method
        "/api/models",                           // URL path
        body,                                    // The JSON body (not nil this time!)
    )                                            // Request created
    req.Header.Set("Content-Type",               // Set the Content-Type header
        "application/json")                      // So the handler knows it's JSON

    rr := httptest.NewRecorder()                 // Create the response recorder

    app.CreateModelHandler(rr, req,              // Call the handler directly
        httprouter.Params{                       // Provide URL parameters
            {Key: "namespace",                   // httprouter.Param has Key and Value
             Value: "default"},                  // Set :namespace to "default"
        },                                       // Params are a slice of Param structs
    )                                            // Handler executes and writes to rr

    if rr.Code != http.StatusCreated {           // Check for 201 Created
        t.Errorf("status = %d, want %d",         // Report if wrong
            rr.Code, http.StatusCreated)         // Expected 201
    }                                            // Status check complete
}                                                // Test complete
```

**What just happened?** For POST requests, we create a `strings.NewReader` with the JSON body and pass it as the third argument to `httptest.NewRequest`. We also pass `httprouter.Params` to simulate URL parameters. The handler doesn't know it's in a test -- it processes the request exactly as it would in production.

### Table-driven handler tests

The real power: combine table-driven tests with HTTP testing. This is the BFF pattern:

```go
func TestGetModelHandler(t *testing.T) {         // Table-driven HTTP handler test

    tests := []struct {                          // Define test cases
        name       string                        // Test case description
        namespace  string                        // URL parameter: namespace
        modelID    string                        // URL parameter: id
        mockModels []Model                       // What the mock service returns
        mockErr    error                         // What error the mock returns
        wantStatus int                           // Expected HTTP status code
    }{                                           // Test case data:
        {                                        // Happy path
            name:       "returns model",         // Description
            namespace:  "default",               // Namespace param
            modelID:    "abc",                   // Model ID param
            mockModels: []Model{                 // Mock returns this model
                {ID: "abc", Name: "Test"},       // One model in the list
            },                                   // Mock data complete
            wantStatus: http.StatusOK,           // Expect 200
        },                                       // End of first case
        {                                        // Error case
            name:       "service error returns 500", // Description
            namespace:  "default",               // Same namespace
            modelID:    "abc",                   // Same ID
            mockErr:    errors.New("db down"),   // Mock returns an error
            wantStatus: http.StatusInternalServerError, // Expect 500
        },                                       // End of second case
    }                                            // All cases defined

    for _, tt := range tests {                   // Loop over cases
        t.Run(tt.name, func(t *testing.T) {      // Named subtest

            mock := &mockModelService{           // Create a mock service
                models: tt.mockModels,           // With this case's mock data
                err:    tt.mockErr,              // With this case's mock error
            }                                    // Mock is ready

            app := &App{                         // Create the App with the mock
                logger:       slog.Default(),    // Real logger (logs go to test output)
                modelService: mock,              // Injected mock service
            }                                    // App is ready

            req := httptest.NewRequest("GET",    // Create the request
                "/api/models/"+tt.namespace+     // Build the URL from test data
                "/"+tt.modelID, nil)             // No body for GET

            rr := httptest.NewRecorder()         // Create the recorder

            app.GetModelHandler(rr, req,         // Call the handler
                httprouter.Params{               // With URL params
                    {Key: "namespace",           // :namespace param
                     Value: tt.namespace},       // From the test case
                    {Key: "id",                  // :id param
                     Value: tt.modelID},         // From the test case
                },                               // Params complete
            )                                    // Handler runs

            if rr.Code != tt.wantStatus {        // Check the status code
                t.Errorf("status = %d, want %d", // Report if wrong
                    rr.Code, tt.wantStatus)      // Actual vs expected
            }                                    // Assertion complete
        })                                       // Subtest complete
    }                                            // Next case
}                                                // All cases tested
```

**What just happened?** We tested the same handler with different scenarios -- a happy path and an error case -- using one test function. The mock service returns different data for each case, and we check that the handler produces the right status code. Adding more test cases (empty response, invalid namespace, etc.) is just adding more entries to the `tests` slice.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Use `httptest.NewRecorder()` to capture handler responses
- Use `httptest.NewRequest()` to create fake requests (note: no error return!)
- Test handlers directly without starting a server
- Build POST requests with JSON bodies using `strings.NewReader`
- Provide `httprouter.Params` for URL parameter testing
- Combine table-driven tests with HTTP handler tests

</div>

## Mocking with Interfaces

In Jest, you'd mock a module with `jest.mock('./module')`. Go doesn't have that. Instead, you use **interfaces** and **dependency injection**. You define what your dependency does (the interface), write a tiny mock struct that implements it, and inject the mock during tests.

This sounds like more work, but it's actually cleaner. The dependency is explicit -- you can see exactly what's being mocked by looking at the struct.

### Step 1: Define the interface

```go
// This is your contract -- what the service MUST be able to do
type ModelService interface {                    // An interface with two methods
    List(ctx context.Context,                    // List models in a namespace
        ns string) ([]Model, error)             // Returns models and possible error
    GetByID(ctx context.Context,                 // Get one model by ID
        ns, id string) (*Model, error)          // Returns pointer (nil = not found)
}                                                // Any type with these methods satisfies it
```

### Step 2: Create a mock implementation

```go
// A mock that lets you control what it returns
type mockModelService struct {                   // A struct that will satisfy ModelService
    models []Model                               // What List() should return
    model  *Model                                // What GetByID() should return
    err    error                                 // What error to return (if any)
}                                                // You set these fields in each test case

func (m *mockModelService) List(                 // Implement the List method
    ctx context.Context,                         // Same signature as the interface
    ns string,                                   // Same parameters
) ([]Model, error) {                             // Same return types
    return m.models, m.err                       // Return whatever we configured
}                                                // That's the entire implementation

func (m *mockModelService) GetByID(              // Implement the GetByID method
    ctx context.Context,                         // Same signature
    ns, id string,                               // Same parameters
) (*Model, error) {                              // Same return types
    return m.model, m.err                        // Return whatever we configured
}                                                // Mock complete
```

### Step 3: Use the mock in tests

::: code-group
```ts [TypeScript -- Jest]
// Jest -- mock the module
jest.mock('./modelService');                       // Replace the real module
const mockList = jest.mocked(modelService.list);   // Get the typed mock function

describe('handler', () => {
  it('should return models', async () => {
    mockList.mockResolvedValue([                    // Configure what mock returns
      { id: '1', name: 'Model 1' }
    ]);
    // ... test the handler ...
  });
});
```

```go [Go -- interface mocking]
func TestListModelsHandler(t *testing.T) {        // Test with injected mock

    mock := &mockModelService{                    // Create the mock
        models: []Model{                          // Configure it to return these models
            {ID: "1", Name: "Model 1"},           // One model in the list
        },                                        // Mock is configured
    }                                             // mock.err is nil (zero value = no error)

    app := &App{                                  // Create App with the mock injected
        logger:       slog.Default(),             // Real logger
        modelService: mock,                       // MOCK service, not the real one
    }                                             // The handler will call mock.List()

    req := httptest.NewRequest("GET",             // Create test request
        "/api/models/default", nil)               // GET request, no body
    rr := httptest.NewRecorder()                  // Create response recorder

    app.ListModelsHandler(rr, req,                // Call the handler
        httprouter.Params{                        // With URL params
            {Key: "namespace", Value: "default"}, // :namespace = "default"
        },                                        // Params complete
    )                                             // Handler runs against the mock

    if rr.Code != http.StatusOK {                 // Check status code
        t.Errorf("status = %d, want 200",         // Report if wrong
            rr.Code)                              // Show actual
    }                                             // Status check complete
}                                                 // Test complete
```
:::

**What just happened?** We created a mock service, injected it into the App, and tested the handler. The handler doesn't know it's using a mock -- it calls `app.modelService.List()` which hits our mock instead of a real database. No `jest.mock()` magic, no module replacement. The dependency is passed in explicitly.

### Testing error cases with mocks

Change one field on the mock and you're testing the error path:

```go
func TestListModelsHandler_ServiceError(t *testing.T) { // Test error handling

    mock := &mockModelService{                    // Create the mock
        err: errors.New("database is down"),      // This time, configure it to fail
                                                  // models is nil (zero value for slices)
    }                                             // Mock will return (nil, error)

    app := &App{                                  // Create App with failing mock
        logger:       slog.Default(),             // Real logger (will log the error)
        modelService: mock,                       // Failing mock
    }                                             // App is ready

    req := httptest.NewRequest("GET",             // Same request as the success test
        "/api/models/default", nil)               // Same endpoint
    rr := httptest.NewRecorder()                  // Same recorder

    app.ListModelsHandler(rr, req,                // Same handler call
        httprouter.Params{                        // Same params
            {Key: "namespace", Value: "default"}, // Same namespace
        },                                        // Everything identical except the mock
    )                                             // Handler runs, hits the error

    if rr.Code != http.StatusInternalServerError { // Should get 500 this time
        t.Errorf("status = %d, want 500",          // Report if wrong
            rr.Code)                               // Show actual
    }                                              // We verified error handling works
}
```

**What just happened?** The only difference from the success test is `err: errors.New("database is down")` on the mock. Same handler, same request, different mock behavior, different expected status code. This is why interface-based mocking is powerful -- you control exactly what each test scenario does.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
- Define an interface for a dependency
- Create a mock struct that implements the interface
- Inject the mock into the App struct for testing
- Test both success and error cases by configuring the mock differently
- Explain why Go uses interfaces for mocking instead of `jest.mock()`

</div>

## Running Tests

Here's the command reference. If you remember one command, make it `go test -v ./...`:

```bash
# Run ALL tests in all packages (most common)
go test ./...                                    # ./... means "this directory and all subdirectories"
                                                 # Like 'npx jest' with no arguments

# Run tests in one specific package
go test ./internal/api/                          # Only tests in the api package
                                                 # Like 'npx jest --testPathPattern=api'

# Verbose output -- shows each test name and result
go test -v ./...                                 # -v = verbose
                                                 # Like 'npx jest --verbose'
                                                 # Shows PASS/FAIL for each test

# Run tests matching a name pattern
go test -run TestHealth ./...                    # Only tests whose name matches "TestHealth"
                                                 # Like 'npx jest -t "health"'

# Run a specific subtest
go test -run TestHealth/GET ./...                # Run the "GET" subtest inside TestHealth
                                                 # The / separates parent from subtest name

# Disable test caching
go test -count=1 ./...                           # Go caches passing tests by default
                                                 # -count=1 forces a fresh run
                                                 # Like 'npx jest --no-cache'

# Show code coverage
go test -cover ./...                             # Shows coverage percentage per package
                                                 # Like 'npx jest --coverage'
                                                 # No extra tools needed!

# Generate coverage report
go test -coverprofile=coverage.out ./...         # Write coverage data to a file
go tool cover -html=coverage.out                 # Open an HTML report in your browser
                                                 # Shows exactly which lines are covered
```

The most common workflow during development:

```bash
# Working on handler tests
go test -v ./internal/api/                       # Run tests in the api package
                                                 # See names and results

# Run just the test you're working on
go test -v -run TestCreateModel ./internal/api/  # One specific test

# Before committing -- run everything
go test ./...                                    # Quick pass/fail for all packages
```

::: info
Go caches test results. If you run `go test ./...` twice and nothing changed, the second run is instant -- it uses cached results. Use `-count=1` to force a fresh run if you need it. This is different from Jest, which always runs everything.
:::

## Quick Reference: Jest to Go

| Jest | Go | Notes |
|---|---|---|
| `describe('name', () => {})` | `func TestName(t *testing.T) {}` | Top-level test grouping |
| `it('should...', () => {})` | `t.Run("should...", func(t *testing.T) {})` | Individual test cases |
| `expect(x).toBe(y)` | `if x != y { t.Errorf(...) }` | Plain Go conditionals |
| `expect(x).toEqual(y)` | `if !reflect.DeepEqual(x, y) { ... }` | Deep comparison |
| `it.each(cases)(...)` | Table-driven test pattern | Slice of structs + loop |
| `jest.mock('./module')` | Interface + mock struct | Dependency injection |
| `beforeEach(() => {})` | Setup at top of each `t.Run` | No built-in beforeEach |
| `afterEach(() => {})` | `t.Cleanup(func() { ... })` | Runs when test finishes |
| `npx jest` | `go test ./...` | Run all tests |
| `npx jest --verbose` | `go test -v ./...` | Verbose output |
| `npx jest -t "name"` | `go test -run TestName ./...` | Run specific test |
| `npx jest --coverage` | `go test -cover ./...` | Coverage report |
| `jest.config.js` | *(none needed)* | Zero configuration |
| `npm install jest @types/jest ts-jest` | *(built in)* | No packages to install |

::: tip Key Takeaway
Go testing requires no setup -- just write `_test.go` files and run `go test`. Use table-driven tests (slice of struct test cases) for comprehensive coverage -- it's Go's most important testing pattern. Use `httptest.NewRecorder()` to test HTTP handlers without a server. Mock dependencies through interfaces and injection, not framework magic: define the interface, create a mock struct, inject it in the test. Run tests with `go test ./...` and add `-v` for verbose output.
:::

::: info See Also
- [Interfaces](./interfaces) -- how interfaces enable mocking
- [HTTP Servers](./http) -- the handlers you'll be testing
- [Error Handling](./error-handling) -- testing error cases
- [Structs](./structs) -- mock struct definitions
:::
