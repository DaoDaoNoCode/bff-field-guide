# Tutorial 3: Writing Handler Tests

If you have written Jest tests, Go tests will feel familiar but look different. The concepts are the same -- set up test data, call a function, check the result. The syntax just has a Go accent.

In this tutorial, you will write unit tests for the feedback handler from Tutorial 2. You will build them from scratch: create the file, write the simplest possible test, run it, then level up to table-driven tests (Go's equivalent of `it.each`).

**Time:** ~25 minutes

**Prerequisite:** Complete [Tutorial 2: POST with Validation](./post-with-validation).

## Go Testing vs Jest: A Quick Map

Before writing any code, let's map the concepts so nothing surprises you:

| Jest / TypeScript | Go Testing | Notes |
|---|---|---|
| `describe('handler', () => { ... })` | `func TestHandlerName(t *testing.T) { ... }` | Test function names MUST start with `Test` |
| `it('should do X', () => { ... })` | `t.Run("should do X", func(t *testing.T) { ... })` | Sub-tests -- like `it` blocks inside `describe` |
| `expect(result).toBe(expected)` | `assert.Equal(t, expected, actual)` | Note: expected comes FIRST in testify |
| `expect(str).toContain(sub)` | `assert.Contains(t, str, sub)` | Same idea, different argument order |
| `expect(fn).toThrow()` | `assert.Error(t, err)` | Go returns errors instead of throwing |
| `jest.fn()` / `jest.mock()` | Define a struct that implements an interface | More manual, but more explicit (Tutorial 4) |
| `beforeEach(() => { ... })` | Set up at the top of each `t.Run` | No lifecycle hooks -- just call a helper function |
| `*.spec.ts` or `*.test.ts` | `*_test.go` | File MUST end with `_test.go` or Go ignores it |
| `npx jest` | `go test ./...` | The `./...` means "all packages recursively" |
| `npx jest --verbose` | `go test -v ./...` | `-v` shows individual test names |
| `npx jest -t "pattern"` | `go test -run "Pattern" ./...` | `-run` filters by regex on test name |

::: info No Assertion Library Required (But We Use One Anyway)
Go's standard library has no `expect().toBe()`. You would write plain `if` statements:
```go
if result != expected {                  // Plain comparison -- no assertion library
    t.Errorf("got %v, want %v", result, expected)  // Report the failure
}
```
That works, but it is verbose. The ODH Dashboard BFFs use `github.com/stretchr/testify` for cleaner assertions like `assert.Equal(t, expected, actual)`. We will use testify since that is what the codebase uses.
:::

## Step 1: Create the Test File

Create a new file at:

```
packages/automl/bff/internal/api/feedback_handler_test.go
```

Start with the package declaration and imports:

```go
package api                            // Same package as the handler -- NOT api_test
                                       // This gives us access to unexported (lowercase) functions

import (                               // All imports in one block
	"encoding/json"                    // For parsing JSON responses in test assertions
	"io"                               // For io.Discard -- a writer that throws away output
	"log/slog"                         // Structured logger -- needed to build a test App
	"net/http"                         // HTTP status codes and request/response types
	"net/http/httptest"                // THE key package -- fake HTTP servers and recorders
	"strings"                          // For strings.NewReader -- turns a string into a reader
	"testing"                          // Go's built-in testing framework

	"github.com/julienschmidt/httprouter"                                      // Router types
	"github.com/opendatahub-io/automl-library/bff/internal/config"             // Config types
	"github.com/stretchr/testify/assert"                                       // Assertion helpers
)
```

::: warning Same Package, Not `_test` Package
Notice the package is `api`, not `api_test`. In Go, test files in the same package can access unexported (lowercase) functions. This means we can test `validateFeedback` directly even though it starts with a lowercase letter. If we used `api_test`, we could only test exported (uppercase) functions.
:::

## Step 2: Write a Test Helper

Before writing any test, let's create a helper function that builds a minimal `App` for testing. The feedback handler does not need Kubernetes clients or service connections -- it just needs a logger and config.

Add this to the bottom of your test file:

```go
// newTestFeedbackApp creates a minimal App instance for feedback handler tests.
// The feedback handler doesn't call any external services, so we only need
// a logger (that discards output) and a basic config.
//
// This is like creating a minimal Express app for testing:
//   const app = express();
//   app.use(express.json());
//   app.post('/feedback', feedbackHandler);
func newTestFeedbackApp() *App {       // Returns a pointer to an App
	logger := slog.New(                // Create a structured logger
		slog.NewTextHandler(           // That uses text format
			io.Discard,                // And throws away all output -- we don't want log noise in tests
			&slog.HandlerOptions{},    // Default options
		),
	)
	return &App{                       // Return a pointer to a new App with minimal config
		config: config.EnvConfig{      // Config struct with required fields
			AllowedOrigins: []string{"*"},              // Allow all origins for testing
			AuthMethod:     config.AuthMethodInternal,  // Use internal auth (no real tokens needed)
		},
		logger: logger,                // The silent logger we just created
	}
}
```

## Step 3: Write Your First Test

Now add the simplest possible test -- the happy path. A valid request that should return 201:

```go
func TestCreateFeedbackHandler_Success(t *testing.T) {  // Test functions MUST start with Test
	                                                     // and take *testing.T as the only parameter

	// ── Arrange: set up the request ──

	body := `{"category": "bug", "message": "Page is slow", "severity": 3}`  // Raw JSON string
	                                                                          // Backticks allow raw strings in Go

	req := httptest.NewRequest(            // Create a fake HTTP request -- no real server needed
		http.MethodPost,                   // POST method
		"/api/v1/feedback",                // The URL path (doesn't actually route -- just metadata)
		strings.NewReader(body),           // Turn the JSON string into an io.Reader
		                                   // Like: new ReadableStream(body)
	)
	req.Header.Set("Content-Type", "application/json")  // Set the content type header

	rr := httptest.NewRecorder()           // Create a ResponseRecorder -- it captures the response
	                                       // instead of sending it over the network.
	                                       // Think of it as a spy that records everything
	                                       // the handler writes: status code, headers, body.

	app := newTestFeedbackApp()            // Build our minimal test app

	// ── Act: call the handler directly ──

	app.CreateFeedbackHandler(             // Call the handler as a plain function -- no server!
		rr,                                // Pass the recorder as the ResponseWriter
		req,                               // Pass our fake request
		httprouter.Params{},               // Empty params -- our handler doesn't use route params
	)

	// ── Assert: check the response ──

	assert.Equal(t,                        // assert.Equal(t, expected, actual)
		http.StatusCreated,                // Expected: 201
		rr.Code,                           // Actual: the status code the handler wrote
	)

	var envelope FeedbackEnvelope          // Declare a variable to hold the parsed response
	err := json.Unmarshal(                 // Parse the JSON response body
		rr.Body.Bytes(),                   // rr.Body is a *bytes.Buffer -- .Bytes() gets the raw bytes
		&envelope,                         // &envelope = "put the parsed data here"
	)
	assert.NoError(t, err)                 // Make sure JSON parsing didn't fail

	// Check each field of the response
	assert.Equal(t, "bug", envelope.Data.Category)         // Category should match input
	assert.Equal(t, "Page is slow", envelope.Data.Message) // Message should match input
	assert.Equal(t, 3, envelope.Data.Severity)             // Severity should match input
	assert.Equal(t, "received", envelope.Data.Status)      // Status is always "received"
	assert.NotEmpty(t, envelope.Data.ID)                   // ID should be generated (non-empty)
}
```

Let's map each piece to what you would do in Jest:

| Go | Jest Equivalent | What It Does |
|----|----------------|-------------|
| `httptest.NewRequest(...)` | Creating a request with `supertest` | Build a fake HTTP request |
| `httptest.NewRecorder()` | The response object from `supertest` | Capture what the handler writes |
| `app.CreateFeedbackHandler(rr, req, ...)` | Calling the handler function directly | Execute the handler without a server |
| `rr.Code` | `response.status` | The HTTP status code |
| `rr.Body.Bytes()` | `response.body` (raw) | The response body as bytes |
| `json.Unmarshal(...)` | `JSON.parse(response.text)` | Parse JSON into a struct |
| `assert.Equal(t, expected, actual)` | `expect(actual).toBe(expected)` | Check equality |

::: tip httptest.NewRecorder Is the Key
This is what makes Go handler testing so elegant. You do not need to start a real server. `NewRecorder()` creates a fake `http.ResponseWriter` that captures everything the handler writes, and `NewRequest()` creates a real `*http.Request` from a string body. Together, they let you unit test handlers as plain function calls. No ports, no network, no cleanup.
:::

## Step 4: Run the Test

Cross your fingers. Open your terminal and type:

```bash
cd packages/automl/bff
go test ./internal/api/ -v -run TestCreateFeedbackHandler_Success
```

**What you should see:**

```
=== RUN   TestCreateFeedbackHandler_Success
--- PASS: TestCreateFeedbackHandler_Success (0.00s)
PASS
ok      github.com/opendatahub-io/automl-library/bff/internal/api
```

Your first Go test passes. The `-v` flag shows the test name and pass/fail. The `-run` flag filters by test name so you only run this one test.

If the test fails, read the error message carefully. The most common mistakes:
- Wrong import path for the config package
- Missing `Content-Type` header on the request
- Typo in the handler function name

## Step 5: Add Table-Driven Tests for Validation

One test is nice, but you have nine validation rules to test. Writing nine separate test functions would be tedious and repetitive. Go has a pattern for this: **table-driven tests**.

Table-driven tests are Go's equivalent of Jest's `it.each` or `describe.each`. You define your test cases as data (a slice of structs), then loop over them.

Here is the Jest version for comparison:

```typescript
describe.each([                                     // Define test cases as an array of objects
  {
    name: 'missing category',                       // Human-readable name
    body: { message: 'test', severity: 3 },         // The request body
    wantStatus: 400,                                // Expected status code
    wantMessage: 'category is required',            // Expected error message
  },
  {
    name: 'invalid category',                       // Another test case
    body: { category: 'nope', message: 't', severity: 3 },
    wantStatus: 400,
    wantMessage: 'must be one of',
  },
  // ... more test cases ...
])('$name', ({ body, wantStatus, wantMessage }) => {  // Loop over each case
  it(`returns ${wantStatus}`, async () => {            // Run the test
    const res = await request(app).post('/feedback').send(body);
    expect(res.status).toBe(wantStatus);               // Assert status
    expect(res.body.error.message).toContain(wantMessage);  // Assert message
  });
});
```

Now add the Go version to your test file:

```go
func TestCreateFeedbackHandler_Validation(t *testing.T) {  // One test function for all validation cases

	// Define the test cases as a slice of anonymous structs.
	// Each struct has the test name, request body, expected status, and expected error message.
	// This is exactly like the array of objects in Jest's describe.each.
	tests := []struct {                    // []struct means "a slice of structs with these fields"
		name           string              // Human-readable test case name
		body           string              // The JSON request body to send
		wantStatusCode int                 // The HTTP status code we expect back
		wantMessage    string              // A substring of the error message we expect
	}{
		{
			name:           "missing category",                                  // Test case 1
			body:           `{"message": "test", "severity": 3}`,               // No category field
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "category is required",                              // Expected error
		},
		{
			name:           "invalid category",                                  // Test case 2
			body:           `{"category": "complaint", "message": "test", "severity": 3}`,
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "category must be one of: bug, feature, general",    // Expected error
		},
		{
			name:           "empty message",                                     // Test case 3
			body:           `{"category": "bug", "message": "", "severity": 3}`, // Empty message
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "message is required",                               // Expected error
		},
		{
			name:           "message too long",                                  // Test case 4
			body:           `{"category": "bug", "message": "` + strings.Repeat("a", 1001) + `", "severity": 3}`,
			                                                                     // 1001 characters -- over the limit
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "message must not exceed 1000 characters",           // Expected error
		},
		{
			name:           "severity too low",                                  // Test case 5
			body:           `{"category": "bug", "message": "test", "severity": 0}`,  // 0 is below minimum 1
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "severity must be between 1 and 5",                  // Expected error
		},
		{
			name:           "severity too high",                                 // Test case 6
			body:           `{"category": "bug", "message": "test", "severity": 6}`,  // 6 is above maximum 5
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "severity must be between 1 and 5",                  // Expected error
		},
		{
			name:           "invalid JSON",                                      // Test case 7
			body:           `not json`,                                          // Garbage input
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "body contains badly-formed JSON",                   // ReadJSON catches this
		},
		{
			name:           "empty body",                                        // Test case 8
			body:           ``,                                                  // Completely empty
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "body must not be empty",                            // ReadJSON catches this
		},
		{
			name:           "unknown field",                                     // Test case 9
			body:           `{"category": "bug", "message": "test", "severity": 3, "extra": "nope"}`,
			wantStatusCode: http.StatusBadRequest,                               // 400
			wantMessage:    "body contains unknown key",                         // ReadJSON catches this
		},
	}

	// Loop over every test case and run it as a sub-test.
	// This is the Go equivalent of the forEach inside describe.each.
	for _, tt := range tests {             // for _, tt := range -- iterate over the slice
		                                   // _ is the index (we don't need it)
		                                   // tt is the current test case (short for "test table")
		t.Run(tt.name, func(t *testing.T) {  // t.Run creates a sub-test with the case's name
			                                  // This is like it('missing category', () => { ... })

			// Build the request
			req := httptest.NewRequest(    // Same pattern as the success test
				http.MethodPost,           // POST method
				"/api/v1/feedback",        // URL path
				strings.NewReader(tt.body),  // Use the body from this test case
			)
			req.Header.Set("Content-Type", "application/json")  // Set content type

			// Build the recorder and app
			rr := httptest.NewRecorder()   // Fresh recorder for each test case
			app := newTestFeedbackApp()    // Fresh app for each test case

			// Call the handler
			app.CreateFeedbackHandler(rr, req, httprouter.Params{})  // Execute

			// Assert status code
			assert.Equal(t,                // Check that the status code matches
				tt.wantStatusCode,         // Expected status (from the test case)
				rr.Code,                   // Actual status (from the recorder)
				"status code mismatch for: %s", tt.name,  // Extra context if the assertion fails
			)

			// Parse the error response
			var errEnvelope ErrorEnvelope   // ErrorEnvelope is the standard error wrapper
			err := json.Unmarshal(         // Parse the JSON error response
				rr.Body.Bytes(),           // Raw bytes from the recorder
				&errEnvelope,              // Parse into the error envelope struct
			)
			assert.NoError(t, err)         // JSON parsing should succeed

			// Assert the error message contains what we expect
			assert.Contains(t,             // Check that the actual message contains the expected substring
				errEnvelope.Error.Message,  // Actual error message from the response
				tt.wantMessage,            // Expected substring from the test case
				"error message mismatch for: %s", tt.name,  // Extra context on failure
			)
		})
	}
}
```

## Step 6: Run All the Tests

```bash
cd packages/automl/bff
go test ./internal/api/ -v -run TestCreateFeedback
```

The `-run TestCreateFeedback` pattern matches both `TestCreateFeedbackHandler_Success` and `TestCreateFeedbackHandler_Validation` since they both start with `TestCreateFeedback`.

**What you should see:**

```
=== RUN   TestCreateFeedbackHandler_Success
--- PASS: TestCreateFeedbackHandler_Success (0.00s)
=== RUN   TestCreateFeedbackHandler_Validation
=== RUN   TestCreateFeedbackHandler_Validation/missing_category
=== RUN   TestCreateFeedbackHandler_Validation/invalid_category
=== RUN   TestCreateFeedbackHandler_Validation/empty_message
=== RUN   TestCreateFeedbackHandler_Validation/message_too_long
=== RUN   TestCreateFeedbackHandler_Validation/severity_too_low
=== RUN   TestCreateFeedbackHandler_Validation/severity_too_high
=== RUN   TestCreateFeedbackHandler_Validation/invalid_JSON
=== RUN   TestCreateFeedbackHandler_Validation/empty_body
=== RUN   TestCreateFeedbackHandler_Validation/unknown_field
--- PASS: TestCreateFeedbackHandler_Validation (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/missing_category (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/invalid_category (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/empty_message (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/message_too_long (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/severity_too_low (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/severity_too_high (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/invalid_JSON (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/empty_body (0.00s)
    --- PASS: TestCreateFeedbackHandler_Validation/unknown_field (0.00s)
PASS
```

Ten tests, ten passes. Each sub-test appears with its name from the `name` field. Look how the spaces in `"missing category"` become underscores in `missing_category` -- Go does that automatically for sub-test names.

## Step 7: Test the Validation Function Directly

You can also test the `validateFeedback` function in complete isolation, since it is a standalone function that does not need an `App`, a request, or a recorder:

```go
func TestValidateFeedback(t *testing.T) {  // Test the validation function by itself

	// Test that valid input returns nil (no error)
	valid := &models.FeedbackRequest{      // Create a valid request struct
		Category: "bug",                   // Valid category
		Message:  "test",                  // Non-empty message
		Severity: 3,                       // In range 1-5
	}
	assert.NoError(t,                      // Assert there is no error
		validateFeedback(valid),           // Call the validation function
	)

	// Test that invalid input returns an error with the right message
	invalid := &models.FeedbackRequest{    // Create an invalid request
		Category: "unknown",               // Not in the allowed list
		Message:  "test",                  // Valid message
		Severity: 3,                       // Valid severity
	}
	assert.Error(t,                        // Assert that an error IS returned
		validateFeedback(invalid),         // Call the validation function
	)
	assert.Contains(t,                     // Check the error message content
		validateFeedback(invalid).Error(), // .Error() converts the error to a string
		"category must be one of",         // Expected substring
	)
}
```

You will need to add the models import to your import block:

```go
	"github.com/opendatahub-io/automl-library/bff/internal/models"  // Add this import
```

Run it:

```bash
go test ./internal/api/ -v -run TestValidateFeedback
```

**What you should see:**

```
=== RUN   TestValidateFeedback
--- PASS: TestValidateFeedback (0.00s)
PASS
```

## Quick Reference: Go Test Commands

Keep this table handy. You will use these constantly:

| Command | What It Does | npm Equivalent |
|---------|-------------|----------------|
| `go test ./...` | Run ALL tests in the module | `npx jest` |
| `go test ./internal/api/` | Run tests in one specific package | `npx jest src/api/` |
| `go test -v ./...` | Verbose -- show every test name | `npx jest --verbose` |
| `go test -run TestName ./...` | Run tests matching a regex pattern | `npx jest -t "TestName"` |
| `go test -run TestFoo/sub_test` | Run a specific sub-test | `npx jest -t "sub test"` |
| `go test -count=1 ./...` | Disable caching -- force re-run | `npx jest --no-cache` |
| `go test -cover ./internal/api/` | Show test coverage percentage | `npx jest --coverage` |

---

<div class="checkpoint">

#### Checkpoint

Before moving on, verify:

- [ ] All tests pass with `go test ./internal/api/ -v -run TestCreateFeedback`
- [ ] You understand the `httptest.NewRequest` + `httptest.NewRecorder` pattern
- [ ] You can read a table-driven test and add a new test case to the slice
- [ ] You know how `t.Run` maps to Jest's `it` blocks
- [ ] You can run a specific test by name with `-run`

</div>

::: info If You Get Stuck
- [Writing Handlers](../guide/deep-dive/handlers) -- the handler patterns you're testing
- [Go CLI Quick Reference](/reference/cli) -- test commands and flags
:::

## What's Next

The handler tests above work because the feedback handler does not call any external services. But most real handlers need a Kubernetes client, or a pipeline server client, or some other dependency. How do you test those? In Jest, you would reach for `jest.mock()`. In Go, there is no runtime module replacement. Instead, you write a second implementation of the same interface. It sounds more work than it is -- [Tutorial 4: Mock Clients](./mock-clients) will show you exactly how.
