# Tutorial 5: Writing Contract Tests

Contract tests make sure your frontend and BFF agree on the API shape. They are Jest tests that hit a real (mock-mode) BFF server and check that the responses match what the OpenAPI schema promises. If the Go handler returns a field the schema does not mention, the test fails. If the schema requires a field the handler does not return, the test fails. No more "the API changed and the frontend broke."

The best part? You are writing TypeScript again.

**Time:** ~15 minutes

**Prerequisite:** Complete [Tutorial 2: POST with Validation](./post-with-validation).

## What Are Contract Tests?

They sit between Go unit tests and Cypress E2E tests:

| Test Type | What It Checks | Speed | Needs Cluster? |
|-----------|---------------|-------|----------------|
| Go unit tests | Handler logic in isolation (validation, error paths) | Very fast | No |
| **Contract tests** | **API responses match the OpenAPI schema** | **Fast** | **No** |
| Cypress E2E | Full user flows against a live cluster | Slow | Yes |

The contract test framework (`@odh-dashboard/contract-tests`) does the heavy lifting for you:

1. Compiles the Go BFF from source
2. Starts it with mock flags (so it does not need Kubernetes)
3. Waits for the `/healthcheck` endpoint to return 200
4. Runs your Jest tests against the live BFF
5. Kills the BFF process when tests finish

You only write the test file. The framework handles everything else.

## Step 1: Understand the Setup

Look at the automl package's contract test structure:

```
packages/automl/
├── contract-tests/
│   └── __tests__/
│       └── testAutomlContract.test.ts   # <-- You will add tests here
├── api/
│   └── openapi/
│       └── automl.yaml                  # <-- The OpenAPI specification
├── bff/                                 # <-- The Go BFF (compiled and started automatically)
└── package.json                         # <-- Has the "test:contract" script
```

The `package.json` already has the script that ties everything together:

```json
{
  "scripts": {
    "test:contract": "BFF_MOCK_FLAGS='--dev-mode --mock-k8s-client --mock-http-client --mock-s3-client --mock-pipeline-server-client --deployment-mode=standalone --auth-method=internal' odh-ct-bff-consumer --bff-dir bff"
  }
}
```

Let's break down what that script does:

```bash
BFF_MOCK_FLAGS='...'         # Environment variable -- tells the framework which flags to pass to the BFF
                              # These flags enable mock clients so no real K8s cluster is needed:
                              #   --dev-mode                     = development mode
                              #   --mock-k8s-client              = fake Kubernetes client
                              #   --mock-http-client             = fake HTTP client for upstream services
                              #   --mock-s3-client               = fake S3 client
                              #   --mock-pipeline-server-client  = fake pipeline server client
                              #   --deployment-mode=standalone   = run without cluster dependencies
                              #   --auth-method=internal         = use internal auth headers
odh-ct-bff-consumer          # The contract test runner from @odh-dashboard/contract-tests
--bff-dir bff                # Tells the runner where to find the Go BFF source code
```

::: info Mock Flags Vary by BFF
The exact mock flags differ between BFFs. The automl example above includes flags like `--dev-mode` and `--mock-pipeline-server-client` that other BFFs do not need. The gen-ai BFF might have `--mock-ls-client` and `--mock-mcp-client`. Always check the actual `package.json` in the module you are working on for the correct flags.
:::

## Step 2: Examine an Existing Contract Test

Open the existing test file:

```
packages/automl/contract-tests/__tests__/testAutomlContract.test.ts
```

Here is the structure you will see:

```typescript
/**
 * @jest-environment node                     // REQUIRED: run in Node.js, not jsdom
 *                                            // Without this, HTTP calls would fail
 */
import {
  ContractApiClient,                          // HTTP client that sends requests to the BFF
  loadOpenAPISchema,                          // Loads the OpenAPI YAML for schema validation
} from '@odh-dashboard/contract-tests';       // The shared contract test framework

describe('AutoML API Contract Tests', () => { // Top-level describe block -- like any Jest test
  const baseUrl =                             // Where the BFF is running
    process.env.CONTRACT_MOCK_BFF_URL         // The framework sets this env var automatically
    || 'http://localhost:8080';               // Fallback for manual testing

  const apiClient = new ContractApiClient({   // Create the HTTP client
    baseUrl,                                  // Point it at the BFF
    defaultHeaders: {                         // These headers simulate an authenticated user
      'kubeflow-userid': 'dev-user@example.com',  // User identity (BFF auth header)
      'kubeflow-groups': 'system:masters',         // User groups (admin access)
    },
  });

  const apiSchema = loadOpenAPISchema(        // Load the OpenAPI spec
    'api/openapi/automl.yaml',                // Path relative to the package root
  );

  describe('Health Check Endpoint', () => {   // Test group for healthcheck
    it('should return health status', async () => {  // Individual test
      const result = await apiClient.get(     // Send a GET request to the BFF
        '/healthcheck',                       // The endpoint path
      );
      expect(result.success).toBe(true);      // Request should succeed (2xx status)
    });
  });

  // ... more tests
});
```

Here are the key elements:

| Element | What It Does | Why It Matters |
|---------|-------------|----------------|
| `@jest-environment node` | Runs tests in Node.js instead of jsdom | HTTP calls require a real Node.js environment |
| `ContractApiClient` | Sends HTTP requests to the BFF with auth headers | You do not need to manage `fetch` or headers yourself |
| `loadOpenAPISchema` | Loads the OpenAPI YAML for schema validation | The schema is the source of truth that both sides agree on |
| `defaultHeaders` | Simulates an authenticated user | The BFF expects identity headers on every request |
| `toMatchContract()` | Custom Jest matcher that validates responses against the schema | This is the magic -- it checks every field, type, and required property |

## Step 3: Add Contract Tests for Your Endpoints

::: warning Schema Must Exist First
Contract tests with `toMatchContract` validate responses against an OpenAPI schema. In a real workflow, you would first add your endpoint's schema to the OpenAPI YAML file. For this tutorial, we will write structural tests that check the response shape without full schema validation, since modifying the OpenAPI spec is beyond scope.
:::

Open the existing test file and add these new `describe` blocks inside the main `describe`:

```typescript
  describe('Detailed Health Check Endpoint', () => {  // Tests for our Tutorial 1 endpoint

    it('should return detailed health information', async () => {  // Happy path test
      const result = await apiClient.get(     // GET request to our endpoint
        '/api/v1/healthcheck/detailed',       // The path we registered in app.go
      );
      expect(result.success).toBe(true);      // Should succeed (2xx)

      if (result.success) {                   // TypeScript narrowing -- inside this block,
                                              // result has the success shape
        const data = result.response.data as {  // Type assertion for the response shape
          data: {                             // The envelope wraps everything in "data"
            status: string;                   // "healthy"
            version: string;                  // "1.0.0"
            go_version: string;               // "go1.24.3"
            uptime_seconds: number;           // seconds since start
          };
        };

        // Verify each field has the right type and value
        expect(data.data.status).toBe('healthy');            // Status is always "healthy"
        expect(data.data.version).toBe('1.0.0');             // Version matches the constant
        expect(typeof data.data.go_version).toBe('string');  // go_version is a string
        expect(data.data.go_version).toMatch(/^go\d+\.\d+/); // Starts with "go" + version number
        expect(typeof data.data.uptime_seconds).toBe('number');  // uptime is a number
        expect(data.data.uptime_seconds).toBeGreaterThanOrEqual(0);  // uptime is non-negative
      }
    });
  });

  describe('Feedback Endpoint', () => {       // Tests for our Tutorial 2 endpoint

    it('should accept valid feedback', async () => {  // Happy path
      const result = await apiClient.post(    // POST request
        '/api/v1/feedback',                   // The feedback endpoint
        {                                     // Request body -- valid feedback
          category: 'bug',                    // Valid category
          message: 'Test feedback from contract test',  // Valid message
          severity: 3,                        // Valid severity
        },
      );
      expect(result.success).toBe(true);      // Should succeed

      if (result.success) {                   // Narrow the type
        expect(result.response.status).toBe(201);  // POST returns 201 Created

        const data = result.response.data as {  // Type the response
          data: {                             // Envelope wrapper
            id: string;                       // Generated ID
            category: string;                 // Echoed back
            message: string;                  // Echoed back
            severity: number;                 // Echoed back
            status: string;                   // "received"
          };
        };

        expect(data.data.category).toBe('bug');  // Category matches input
        expect(data.data.message).toBe(          // Message matches input
          'Test feedback from contract test',
        );
        expect(data.data.severity).toBe(3);      // Severity matches input
        expect(data.data.status).toBe('received');  // Status is always "received"
        expect(typeof data.data.id).toBe('string');  // ID is a string
        expect(data.data.id).toMatch(/^fb-\d+$/);   // ID matches "fb-" + digits
      }
    });

    it('should reject feedback with missing category', async () => {  // Validation test
      const result = await apiClient.post(    // POST with bad data
        '/api/v1/feedback',                   // Same endpoint
        {                                     // Missing the 'category' field
          message: 'Missing category',        // Has a message
          severity: 3,                        // Has severity
        },                                    // But no category!
      );
      expect(result.success).toBe(false);     // Should fail (4xx)
      if (!result.success) {                  // Narrow to error shape
        expect(result.error.status).toBe(400);  // 400 Bad Request
      }
    });

    it('should reject feedback with invalid severity', async () => {  // Another validation test
      const result = await apiClient.post(    // POST with bad severity
        '/api/v1/feedback',
        {
          category: 'bug',                    // Valid
          message: 'Invalid severity',        // Valid
          severity: 10,                       // INVALID -- max is 5
        },
      );
      expect(result.success).toBe(false);     // Should fail
      if (!result.success) {                  // Narrow
        expect(result.error.status).toBe(400);  // 400 Bad Request
      }
    });

    it('should reject empty request body', async () => {  // Empty body test
      const result = await apiClient.post(    // POST with empty object
        '/api/v1/feedback',
        {},                                   // Empty body -- every field is missing
      );
      expect(result.success).toBe(false);     // Should fail
      if (!result.success) {
        expect(result.error.status).toBe(400);  // 400 Bad Request
      }
    });
  });
```

::: tip This Is Just Jest
If you have written Jest tests before, this should feel completely familiar. `ContractApiClient` is just a wrapper around `fetch` that handles headers and response parsing. The tests are plain Jest with `describe`/`it`/`expect`. Nothing new to learn -- you are back in your element.
:::

## Step 4: Run the Contract Tests

From the automl package root:

```bash
cd packages/automl
npm run test:contract
```

**What happens behind the scenes:**

1. The `odh-ct-bff-consumer` script runs `go build` on the BFF source code
2. It starts the compiled BFF binary with all the mock flags
3. It polls `/healthcheck` every second until it returns 200 (up to 30 seconds)
4. It runs Jest against your test file
5. When Jest finishes (pass or fail), it kills the BFF process

**What you should see:**

```
Starting BFF server...
BFF server ready at http://localhost:8108
Running contract tests...

  AutoML API Contract Tests
    Health Check Endpoint
      ✓ should return health status (25 ms)
    Detailed Health Check Endpoint
      ✓ should return detailed health information (18 ms)
    Feedback Endpoint
      ✓ should accept valid feedback (15 ms)
      ✓ should reject feedback with missing category (12 ms)
      ✓ should reject feedback with invalid severity (10 ms)
      ✓ should reject empty request body (9 ms)
    ...existing tests...

Tests: XX passed, XX total
```

## Step 5: Understanding toMatchContract

When you have an OpenAPI schema for your endpoint, you can use the `toMatchContract` matcher for full schema validation. This is the real power of contract tests:

```typescript
it('should match the OpenAPI schema', async () => {       // Full schema validation test
  const result = await apiClient.get('/api/v1/user');     // Call an endpoint that has a schema
  expect(result).toMatchContract(apiSchema, {             // Validate against the OpenAPI spec
    ref: '#/components/responses/ConfigResponse/content/application~1json/schema',
    // ref is a JSON Pointer -- it tells the matcher where in the OpenAPI file
    // to find the expected response schema.
    //   # = root of the document
    //   /components/responses/ConfigResponse = the named response definition
    //   /content/application~1json/schema = the JSON response schema
    //   In JSON Pointer syntax, / is escaped as ~1 and ~ as ~0.
    //   So application/json becomes application~1json.
    status: 200,                                          // Expected HTTP status code
  });
});
```

The `toMatchContract` matcher checks four things:

| Check | What It Validates | What Fails |
|-------|-------------------|------------|
| Status code | Response status matches `status` param | Handler returns wrong status code |
| Required fields | Every `required` field in the schema is present | Handler forgot to include a field |
| Field types | Every field's type matches the schema definition | Handler returns string instead of number |
| Extra fields | No unexpected fields (if `additionalProperties: false`) | Handler returns fields not in the schema |

::: info Adding Your Endpoint to the OpenAPI Spec
In a real workflow, before writing contract tests with `toMatchContract`, you would add your endpoint's request/response schemas to `api/openapi/automl.yaml`. The OpenAPI spec is the single source of truth that both the Go BFF and the TypeScript contract tests validate against.
:::

## The Full Picture

Here is how all the test types work together to keep things in sync:

```
                    ┌──────────────────────────┐
                    │    OpenAPI Spec (.yaml)   │
                    │  Single source of truth   │
                    └─────────┬────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
     │  Go Handler   │ │  Contract  │ │  Frontend   │
     │  Unit Tests   │ │   Tests    │ │  TypeScript │
     │  (go test)    │ │  (Jest)    │ │   Types     │
     └───────────────┘ └────────────┘ └─────────────┘
     Tests handler     Tests that       Generated from
     logic in          BFF responses    or validated
     isolation         match the spec   against spec
```

- **Go unit tests** verify handler logic (validation, error handling, business rules)
- **Contract tests** verify the API contract (response shapes, status codes, field types)
- **Frontend types** are generated from or checked against the same OpenAPI spec

If all three agree, you know the frontend can safely call the BFF and get what it expects. If any one of them drifts, a test catches it before it reaches production.

---

<div class="checkpoint">

#### Checkpoint

Before finishing:

- [ ] `npm run test:contract` runs and all tests pass
- [ ] You understand that contract tests hit a real (mock-mode) BFF server -- not mocked interceptors
- [ ] You can write contract tests using `apiClient.get()` and `apiClient.post()`
- [ ] You understand what `toMatchContract` validates and when to use it
- [ ] You understand the three-layer testing strategy (Go unit tests + contract tests + frontend types)

</div>

## Congratulations -- You Have Completed All Five Tutorials

Let's look at what you built:

| Tutorial | What You Did | Skills Gained |
|----------|-------------|---------------|
| 1. GET Endpoint | Added a model, handler, and route | Struct definitions, handler functions, route registration |
| 2. POST Endpoint | Handled request bodies with validation | JSON decoding, error handling, the `return`-after-error pattern |
| 3. Handler Tests | Wrote Go unit tests | `httptest`, table-driven tests, `assert` |
| 4. Mock Clients | Created mock interface implementations | Interfaces, dependency injection, error path testing |
| 5. Contract Tests | Wrote TypeScript tests validating BFF responses | Contract testing, OpenAPI schemas, full-stack validation |

You now have the skills to contribute BFF code to any package in the ODH Dashboard. When you are writing real code, keep the [Cheat Sheet](/reference/cheat-sheet) open in a tab for quick lookups, and check the [Gotchas](/reference/gotchas) page when something does not behave the way you expect.

Welcome to Go. You are going to be fine.
