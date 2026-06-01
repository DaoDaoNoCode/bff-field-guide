# What is a BFF?

> The Backend-for-Frontend pattern gives your React app a dedicated backend that speaks its language -- translating between the browser and the complex world of Kubernetes.

## Your First Question: Where Does My Data Come From?

If you have ever wondered why your React component calls `/gen-ai/api/v1/models` instead of the Kubernetes API directly -- this chapter is the answer.

Picture this. You are building a page in the ODH Dashboard that shows AI models. In React, you would write something like:

```typescript
const response = await fetch('/gen-ai/api/v1/lsd/models?namespace=my-project'); // call the BFF endpoint for AI models
const data = await response.json(); // parse the JSON response into a JavaScript object
```

One line. Simple. But behind that URL is a Go service -- a Backend-for-Frontend -- that handles authentication, permission checks, Kubernetes API calls, and data shaping so your React code does not have to.

Let us start from the beginning: why can't the browser just talk to Kubernetes directly?

## The Three Problems

### Problem 1: Authentication Is Impossible from the Browser

Kubernetes uses service account tokens and mTLS certificates for authentication. These credentials live on the server side -- inside Pods, mounted as files in the container filesystem. Your browser does not have them, and you cannot safely ship them to the client.

Here is a concrete example. To list LlamaStack distributions in the `my-project` namespace, you would need to call:

```
GET https://kubernetes-api.cluster.local/apis/llamastack.io/v1/namespaces/my-project/distributions
```

That request requires a valid bearer token in the `Authorization` header. The token is either a ServiceAccount token (mounted at `/var/run/secrets/kubernetes.io/serviceaccount/token` inside a Pod) or an OpenShift OAuth token obtained during server-side login flow. Neither of these is available in browser JavaScript.

::: danger Security Implications
Even if you somehow got a Kubernetes token into the browser, it would be visible in browser DevTools, vulnerable to XSS attacks, and accessible to browser extensions. One compromised token could give an attacker full access to your cluster resources. Shipping cluster credentials to the browser is a security nightmare.
:::

**What this means for you:** Your React code cannot authenticate with Kubernetes. Period. You need something server-side to hold those credentials and make authenticated requests on your behalf.

### Problem 2: CORS Blocks Everything

Even if authentication were not an issue, the browser itself would stop you. The Kubernetes API server does not set `Access-Control-Allow-Origin` headers for your dashboard domain. When your React app running on `https://dashboard.apps.cluster.example.com` tries to make a cross-origin request to `https://kubernetes-api.cluster.local`, the browser's same-origin policy kicks in and blocks the request before it even leaves the network tab.

You might think: "Can't we just configure CORS on the Kubernetes API server?" Technically, you could, but the Kubernetes API server is shared infrastructure. Modifying its CORS configuration to allow browser-based access would weaken the security boundary for every service in the cluster, not just the dashboard.

**What this means for you:** The browser will not let you call the Kubernetes API directly, even if you had valid credentials. You need a same-origin backend to proxy those requests.

### Problem 3: The API Is Too Complex for the Frontend

Kubernetes APIs return deeply nested JSON with fields your UI does not need. A single "list models" operation in the Gen AI playground might require:

1. Calling the Kubernetes API to find the LlamaStack distribution Custom Resource in the namespace
2. Extracting the service URL from the distribution's `.status.serviceUrl` field
3. Calling the LlamaStack service at that URL to list available models
4. Calling the Kubernetes authorization API to run a SubjectAccessReview, checking whether the current user actually has permission to view these models
5. Filtering, transforming, and merging all that data into a clean JSON shape the UI can render

That is four separate API calls, three different services, RBAC logic, and data transformation -- all for one page load. Putting all of that in a React component would make it enormous, brittle, and impossible to test. It would also mean your frontend developers need to understand Kubernetes CRD schemas, SubjectAccessReview specs, and LlamaStack API contracts just to display a list of models.

**What this means for you:** Even if the browser could reach Kubernetes, the API orchestration logic does not belong in React components. You need a server-side layer that does the heavy lifting and returns simple, UI-ready JSON.

### But Wait -- It Is Not Just Kubernetes

The three problems above focus on Kubernetes, but the BFF also sits in front of **third-party services** like MLflow, LlamaStack, and KF Pipelines. These services have their own API contracts, authentication requirements, and quirks.

Now, some of these services *are* reachable from the browser. If a service like MLflow is exposed through a gateway (like the Data Science Gateway), the browser can technically call it directly -- CORS can be configured, TLS is handled by the gateway, and the user's token is already in the browser (since the UI passes it to the BFF anyway).

So why still use a BFF? Because network reachability is only one of the three problems. Even when a service is exposed, the BFF still provides:

**A unified API surface.** Without a BFF, your React code talks to multiple services directly -- each with its own URL, its own request format, its own pagination scheme, and its own error codes. Your frontend becomes a patchwork of service-specific API calls:

```typescript
// Without a BFF -- the frontend juggles multiple APIs
const models = await fetch('https://llamastack.gateway.example.com/v1/models',
  { headers: { 'Authorization': `Bearer ${token}` } });

const prompts = await fetch('https://mlflow.gateway.example.com/ajax-api/2.0/mlflow/registered-prompts/list',
  { headers: { 'Authorization': `Bearer ${token}`, 'X-MLFLOW-WORKSPACE': namespace } });

// Different URLs, different paths, different headers, different response shapes
```

```typescript
// With a BFF -- one consistent API
const models = await fetch('/gen-ai/api/v1/models');
const prompts = await fetch('/gen-ai/api/v1/mlflow/prompts');

// Same origin, same auth flow, same response envelope, same error format
```

**Input validation and error translation.** The BFF validates requests before they reach the upstream service (checking required fields, sanitizing input, enforcing naming rules) and converts service-specific errors into consistent HTTP responses. Without it, each React component handles its own validation and error parsing for each service's API.

**A single place to change.** When an upstream API changes (a new version, a renamed endpoint, a different auth header), you update one Go file in the BFF. Without it, you hunt through React components to find every place that calls that service.

::: tip When is the BFF strictly necessary vs. nice to have?
For **Kubernetes**, the BFF is required -- the browser cannot hold service account tokens or reach the API server. For **gateway-exposed services** like MLflow, the BFF is an architectural choice that keeps your frontend simple and your API surface consistent. The more services your frontend talks to, the more valuable that consistency becomes.
:::

<div class="checkpoint">

#### Checkpoint

You should now understand the three fundamental reasons the browser cannot talk to Kubernetes directly:
1. **Authentication** -- the browser cannot hold cluster credentials safely
2. **CORS** -- the browser blocks cross-origin requests to the K8s API server
3. **Complexity** -- multi-service orchestration logic does not belong in React components

For gateway-exposed services (MLflow, Pipelines), the BFF is not strictly required but provides a unified API surface, input validation, error translation, and a single place to absorb upstream API changes.

</div>

## Enter the BFF: Your Personal Translator

A **Backend-for-Frontend (BFF)** is a small backend service that exists solely to serve one specific frontend. It sits between your React app and the backend services (Kubernetes, LlamaStack, Model Registry, etc.), acting as a translator and gatekeeper.

Think of it this way:

```
Without a BFF:                        With a BFF:
                                      
Browser (React)                        Browser (React)
  |                                      |
  |  Can't reach!                        | Simple fetch() calls
  |  - No auth credentials               |
  |  - CORS blocked                     BFF (Go)
  |  - Too complex                       |  - Has K8s credentials
  |                                      |  - Validates user auth
  X----- Kubernetes API                  |  - Shapes data for UI
                                         |
                                        Kubernetes API / External Services
```

**What just happened?** The BFF inserted itself as a bridge between the browser and Kubernetes. It runs on the server side, so it can hold credentials, bypass CORS (because it is not subject to browser security restrictions), and handle complex API orchestration. Your React code just sees a simple JSON API.

The BFF handles all the hard parts:

| What the BFF does | Why the frontend cannot |
|---|---|
| Authenticates with Kubernetes using service account tokens | Browser cannot hold cluster credentials safely |
| Validates the user's identity from OpenShift auth headers | Token validation requires server-side crypto |
| Checks RBAC permissions via SubjectAccessReview (SAR) | Permission checks require cluster-level API access |
| Calls upstream services (LlamaStack, MLflow, Model Registry) | These services are internal to the cluster network |
| Shapes and filters API responses for the UI | Reduces payload size and hides internal details |
| Handles retries, timeouts, and error translation | Keeps the frontend code simple and focused |

::: tip Think of It Like a Personal Assistant
An API Gateway is like a company receptionist -- it routes calls but does not know your specific needs. A BFF is like a personal assistant who knows exactly what information you need, in what format, and goes and gets it for you.
:::

## BFF vs Traditional Backend vs API Gateway

You might wonder how a BFF differs from other backend patterns you have seen before. Here is the breakdown:

| Pattern | What it is | When to use it |
|---|---|---|
| **Traditional backend** | One big server (Express, Django, Rails) that serves the UI, handles business logic, manages the database, and does everything | Monolithic apps where one team owns everything |
| **API Gateway** | A shared proxy that sits in front of all microservices and handles routing, auth, and rate limiting | When multiple frontends share the same backend services |
| **BFF** | A small, focused backend that serves exactly one frontend's needs | When your frontend has specific data-shaping needs that do not belong in a generic API |

The key insight: a BFF is **owned by the frontend team**. You do not file a ticket with the backend team and wait for them to add an endpoint. You add it yourself, in Go code that lives right next to your React code in the same package directory.

In the ODH Dashboard monorepo, the gen-ai BFF lives at `packages/gen-ai/bff/` and the gen-ai React code lives at `packages/gen-ai/frontend/`. Same package, same team, same Pull Request when you need a new endpoint.

## Why Go Specifically?

You already know TypeScript. Wouldn't it make more sense to write the BFF in Node.js? Here is why Go is the better choice for this specific job, explained with "what this means for you" follow-ups:

### Reason 1: Kubernetes Is Written in Go

The official Kubernetes client library (`client-go`) is the same code that Kubernetes itself uses. It is not a third-party wrapper -- it is the canonical implementation. When you need to create a SubjectAccessReview, watch a Custom Resource for changes, or interact with the OpenShift API, Go gives you first-class access to the exact same types and functions that the Kubernetes control plane uses.

The Node.js Kubernetes client exists, but it is a community-maintained wrapper that is always a step behind. When a new CRD field is added or an API changes, the Go client gets it first because it is part of the same project.

**What this means for you:** When you write `k8s.io/api/authorization/v1` in your Go code, you are importing the exact same types that the Kubernetes API server uses. There is no translation layer, no version mismatch, no "the Node.js client doesn't support this feature yet."

### Reason 2: Compiled Binary Equals Fast Startup

A Go BFF compiles to a single static binary that starts in milliseconds. No `node_modules`, no runtime installation, no `npm install` in your Docker build. The resulting container image is typically 20-30MB, compared to 200MB or more for a Node.js application with its dependencies.

**What this means for you:** When Kubernetes scales your BFF from zero to ten replicas during a traffic spike, each replica starts in under a second. The smaller image also means faster deployments and less storage in the container registry.

### Reason 3: Goroutines Handle Concurrency Naturally

When your BFF needs to call three different services in parallel -- LlamaStack for models, Kubernetes for permissions, MaaS for tokens -- Go's goroutines make this trivial. Each goroutine uses about 2KB of stack memory (compared to about 1MB for an OS thread), so you can run thousands of concurrent requests without breaking a sweat.

**What this means for you:** Node.js handles async I/O well, but CPU-bound work (like JSON parsing, data transformation, or certificate validation) blocks the event loop. Go handles both I/O-bound and CPU-bound work naturally through goroutines. You do not need to think about the event loop.

### Reason 4: Simplicity

Go has 25 keywords. There is one way to format code (`gofmt`), one way to handle errors (`if err != nil`), one way to define types (structs). Coming from TypeScript's ecosystem of choices -- Prettier vs ESLint formatting, interface vs type, classes vs functions, Axios vs fetch -- Go's simplicity is refreshing.

**What this means for you:** You spend less time on tooling decisions and more time writing code. Every Go file in every BFF looks the same. Once you learn one, you can read them all.

<div class="checkpoint">

#### Checkpoint

You should now understand why Go is the language of choice for BFFs:
1. **First-class Kubernetes support** via the official `client-go` library
2. **Fast startup** from compiled static binaries
3. **Natural concurrency** through goroutines
4. **Simplicity** with minimal syntax and conventions

</div>

## The Seven BFFs in ODH Dashboard

Seven packages in the ODH Dashboard monorepo have their own Go BFF. Each one serves a distinct domain:

| Package | BFF Location | What It Does |
|---|---|---|
| **gen-ai** | `packages/gen-ai/bff/` | The largest BFF. Powers the AI playground, LlamaStack integration (model listing, inference, streaming), MCP server connections, guardrails configuration, vector store management, prompt management via MLflow, and code export. Also handles inter-BFF communication with the MaaS BFF for external model access. |
| **model-registry** | `packages/model-registry/upstream/bff/` | Manages model registration, versioning, and artifact tracking. This BFF is a git subtree synced from the kubeflow/model-registry upstream repo, which is why it lives in `upstream/bff/` instead of just `bff/`. Provides model catalog CRUD operations. |
| **maas** | `packages/maas/bff/` | Models-as-a-Service: manages model subscriptions, API key lifecycle, and auth policies. Other BFFs (like gen-ai) call the MaaS BFF over HTTP for token management -- it is the only BFF that acts as a service for other BFFs. |
| **automl** | `packages/automl/bff/` | AutoML pipeline management for tabular and timeseries data. Integrates with S3 for datasets and Model Registry for output models. Manages pipeline runs and experiment tracking. |
| **autorag** | `packages/autorag/bff/` | RAG (Retrieval-Augmented Generation) pipeline management. Integrates with LlamaStack for vector store indexing and S3 for document storage. Manages RAG pipeline configurations and runs. |
| **eval-hub** | `packages/eval-hub/bff/` | LM-Eval job management for model evaluation. Discovers EvalHub service CRDs in the cluster and proxies evaluation job CRUD operations. Manages evaluation configurations and results. |
| **mlflow** | `packages/mlflow/bff/` | MLflow experiment tracking integration. Auto-discovers MLflow Custom Resources in the cluster, proxies experiment and run APIs, and provides CR lifecycle management. |

::: info Not Every Package Needs a BFF
Packages like `model-serving`, `notebooks`, `kserve`, and `observability` do not have BFFs. They get their data through the main dashboard backend (Fastify), which proxies requests directly to the Kubernetes API. A package only needs its own BFF when it talks to services beyond what the main backend provides -- like LlamaStack, MLflow, or S3.
:::

## What the BFF Does NOT Do

To be clear about boundaries, here is what a BFF is **not** responsible for:

- **Serve HTML/CSS/JS.** The frontend dev server (Webpack) or a static file server handles that. The BFF only serves JSON API responses.
- **Manage frontend state.** No Redux, no React context, no session storage. The BFF is stateless -- every request carries its own auth context.
- **Run a database.** BFFs do not persist data. They translate and proxy between the frontend and existing backend services. The data lives in Kubernetes resources (CRDs), external services (LlamaStack, MLflow), or object storage (S3).
- **Handle routing or navigation.** That is React Router's job. The BFF only has API routes like `/api/v1/models`, not page routes like `/models/list`.
- **Authenticate users.** The OpenShift OAuth proxy handles login. The BFF receives the already-authenticated user's identity in HTTP headers and validates it, but it does not manage login flows.

## What BFF Code Looks Like at a Glance

Before we dive deeper in later chapters, let us peek at what a real BFF handler looks like. This is the kind of Go code you will be writing:

```go
// LlamaStackModelsHandler handles GET /api/v1/lsd/models requests.   // this function is a method on the App struct
// It returns a list of AI models from the LlamaStack service.        // all handlers follow this same signature pattern
func (app *App) LlamaStackModelsHandler(
    w http.ResponseWriter,           // w is the response writer -- like Express's res object
    r *http.Request,                 // r is the incoming request -- like Express's req object
    ps httprouter.Params,            // ps holds URL path parameters like :id
) {
    client := getLlamaStackClient(r.Context()) // get the service client from the request context (set by middleware)

    models, err := client.ListModels(r.Context()) // call the LlamaStack service to list models
    if err != nil {                                // check if the call failed
        app.serverErrorResponse(w, r, err)         // if it failed, return a 500 error response
        return                                     // stop processing -- do not continue to the JSON write
    }

    app.WriteJSON(w, http.StatusOK, models, nil)   // write the models as a JSON response with a 200 status
}
```

**What just happened?** That is a complete BFF handler. It is short because all the hard work -- authentication, permission checking, creating the LlamaStack client -- was already handled by middleware that wraps this handler. The handler itself just calls the service and returns the result.

Compare this to the same operation without a BFF, where your React component would need to:

1. Obtain a Kubernetes auth token (impossible from the browser)
2. Call the K8s API to find the LlamaStack distribution CRD
3. Extract the service URL from the CRD status
4. Call LlamaStack at that URL with the auth token
5. Run a SubjectAccessReview to check permissions
6. Filter and transform the response for the UI

With the BFF, your React code does this instead:

```typescript
const response = await fetch(`/gen-ai/api/v1/lsd/models?namespace=${namespace}`); // one line of actual logic
const data = await response.json();                                                // parse the JSON response
```

That is it. One fetch call. The BFF handles everything else.

<div class="checkpoint">

#### Checkpoint

You should now be able to:
1. Explain why browsers cannot talk to Kubernetes directly (auth, CORS, complexity)
2. Describe what a BFF does and does not do
3. Name all seven BFFs and what domain each one covers
4. Read a simple BFF handler and understand the basic pattern

</div>

## The Mental Model Shift

Here is the most important mindset change for this guide:

**As a frontend developer, you consume APIs.** You call `fetch()`, get JSON back, and render it. Someone else wrote the backend.

**As a BFF developer, you BUILD the API that your own React code consumes.** You are now on both sides of the fetch call. When your React component calls `/gen-ai/api/v1/lsd/models`, you wrote the Go handler that receives that request, calls Kubernetes, calls LlamaStack, and returns the JSON that your React component renders.

This is not a backend pivot. You are still a frontend developer. You are just extending your reach one layer deeper to control the exact shape of the data your UI needs. You design the API contract, implement it in Go, and consume it in React -- all in the same Pull Request, all in the same package directory.

::: tip Key Takeaway
A BFF is a small Go server that acts as a dedicated backend for your React frontend. It solves three fundamental problems: the browser cannot authenticate with Kubernetes, cannot bypass CORS, and should not contain complex API orchestration logic. Each BFF package in ODH Dashboard lives alongside its React code and is owned by the same team. As a BFF developer, you are both the API producer and the API consumer.
:::

::: info See Also
- [The Big Picture](./big-picture) -- How the BFF fits into the full ODH Dashboard architecture
- [Request Flow](./request-flow) -- Trace a real API request through every layer
- [Directory Structure](./directory-structure) -- What is inside a BFF and what each file does
:::
