# Tutorial 6: Inter-BFF Communication

Up to now every endpoint you built talked to Kubernetes or an upstream service. But sometimes one BFF needs to call *another BFF*. The Gen-AI BFF, for example, asks the MaaS BFF for an ephemeral token before it opens a Playground session. That is a BFF-to-BFF HTTP call, authenticated with the same user token the browser sent.

In this tutorial you will wire that call end to end using the `bffclient` package: flags, a client factory, middleware that forwards the user's token, a handler that makes the call, and the route that ties it together. Then you will run **two BFFs at once** on your laptop and watch one call the other.

**Time:** ~30 minutes

**Prerequisite:** You should be comfortable with [Writing Handlers](../guide/deep-dive/handlers) and [Middleware Chain](../guide/deep-dive/middleware). Read the concept page first if you want the big picture: [Inter-BFF Communication](../guide/deep-dive/inter-bff-communication).

## What You Are Building

A handler in the Gen-AI BFF that, when hit, reaches out to the MaaS BFF, forwards the caller's token, and returns MaaS's answer:

```
Browser ──▶ gen-ai BFF ──(user token)──▶ maas BFF ──▶ { "token": "..." }
```

You will build the calling side (gen-ai) and point it at a real, locally running MaaS BFF. No cluster required.

::: info The Frontend Analogy
This is the exact same thing your React app does when it calls `fetch('/gen-ai/api/v1/...')` -- except now *the BFF* is the client, and *another BFF* is the server. Same request/response, same auth header, just one layer deeper. If you have ever written a Next.js API route that calls another microservice, you already understand the shape.
:::

## Step 1: Copy the BFF Client Package

The `bffclient` package is not a shared Go module -- each BFF vendors its own copy. Copy it from gen-ai (the reference implementation) into the module you are wiring up. If you are working *in* gen-ai, it is already there; open it and look around.

```bash
# From the repo root -- copy the client into a module that needs it
cp -r packages/gen-ai/bff/internal/integrations/bffclient \
      packages/<your-module>/bff/internal/integrations/bffclient
```

The package has six pieces:

```
internal/integrations/bffclient/
├── client.go       # HTTP client with TLS and auth
├── config.go       # Service discovery configuration
├── factory.go      # Client factory (real & mock)
├── middleware.go   # Request context injection
├── errors.go       # Structured error types (BFFClientError)
└── bffmocks/       # Mock implementation for testing
```

::: tip Why Copy Instead of Import?
In TypeScript you would publish `@odh-dashboard/bff-client` to npm and `import` it everywhere. The BFFs deliberately do *not* do this -- each BFF owns its dependencies so it can be built and deployed independently, with no shared-version coupling. Copying is the intended pattern here, not a workaround.
:::

For this tutorial we work inside `packages/gen-ai/bff/`, which already has the package. Verify it compiles:

```bash
cd packages/gen-ai/bff
go build ./...
```

**What you should see:** Nothing. Silence means success.

## Step 2: Add the CLI Flags

The calling BFF needs to know *where* the target lives and *how* to talk to it. Those come from flags (which read env vars as defaults). Open `cmd/main.go` and add the flags for the MaaS target:

```go
// Enable mock BFF clients -- returns canned responses, makes no real HTTP calls.
flag.BoolVar(&cfg.MockBFFClients, "mock-bff-clients",
    getEnvAsBool("MOCK_BFF_CLIENTS", false), "Enable mock BFF clients")

// The Kubernetes Service name of the target BFF.
flag.StringVar(&cfg.BFFMaasServiceName, "bff-maas-service-name",
    getEnvAsString("BFF_MAAS_SERVICE_NAME", "odh-dashboard-maas-ui"), "MaaS service name")

// The target BFF's port.
flag.IntVar(&cfg.BFFMaasServicePort, "bff-maas-service-port",
    getEnvAsInt("BFF_MAAS_SERVICE_PORT", 8243), "MaaS service port")

// HTTPS on/off -- false locally, true in the cluster.
flag.BoolVar(&cfg.BFFMaasTLSEnabled, "bff-maas-tls-enabled",
    getEnvAsBool("BFF_MAAS_TLS_ENABLED", false), "Enable TLS for MaaS")

// Local dev override -- bypasses service discovery entirely.
flag.StringVar(&cfg.BFFMaasDevURL, "bff-maas-dev-url",
    getEnvAsString("BFF_MAAS_DEV_URL", ""), "Dev override URL for MaaS")
```

::: info Flags AND Env Vars
Every flag reads an env var as its default (`getEnvAsString("BFF_MAAS_SERVICE_NAME", ...)`). That is deliberate: locally you pass `--bff-maas-dev-url=...` or export `BFF_MAAS_DEV_URL=...`; in the cluster the operator injects the env vars. Same code path, two ways to configure it. This is like reading `process.env.X ?? defaultValue` in Node, but wired to a `--flag` too.
:::

## Step 3: Initialize the Client Factory

The factory decides, once at startup, whether to build *real* HTTP clients or *mock* ones. Open `internal/api/app.go` and add this where the App is being constructed:

```go
// Build the base config and layer in the MaaS-specific settings.
bffConfig := bffclient.NewDefaultBFFClientConfig()
bffConfig.MockBFFClients = cfg.MockBFFClients
bffConfig.PodNamespace = namespace                       // from POD_NAMESPACE (downward API)

// Apply the target-specific config we read from flags in Step 2.
if maasCfg := bffConfig.GetServiceConfig(bffclient.BFFTargetMaaS); maasCfg != nil {
    maasCfg.ServiceName    = cfg.BFFMaasServiceName
    maasCfg.Port           = cfg.BFFMaasServicePort
    maasCfg.TLSEnabled     = cfg.BFFMaasTLSEnabled
    maasCfg.DevOverrideURL = cfg.BFFMaasDevURL           // wins over service discovery when set
}

// Choose the factory: mock for isolated dev, real otherwise.
var bffFactory bffclient.BFFClientFactory
if cfg.MockBFFClients {
    bffFactory = bffmocks.NewMockClientFactory(logger)   // canned responses
} else {
    bffFactory = bffclient.NewRealClientFactory(bffConfig, rootCAs, cfg.InsecureSkipVerify, logger)
}

app.bffClientFactory = bffFactory                        // store on the App (your DI container)
```

::: tip This Is Dependency Injection
Picking the factory *once* at startup and storing it on `App` is the same pattern as choosing a real vs. mock Kubernetes client. Handlers never know which one they got -- they just ask the factory for a client. That is what makes [Mock Clients](./mock-clients) possible without changing handler code.
:::

**What you should see:** `go build ./...` still passes. If `bffmocks` is unused, VS Code will flag the import -- it becomes used once the factory branch is in.

## Step 4: Write the Middleware That Forwards the Token

This is the heart of inter-BFF auth. The middleware pulls the user's token out of the request identity (put there earlier in the chain by the auth middleware) and builds a client that will forward that token to MaaS.

Open `internal/api/middleware.go`:

```go
// AttachBFFTargetClient builds a MaaS client carrying the caller's token
// and stashes it on the request context for the handler to use.
func (app *App) AttachBFFTargetClient(next httprouter.Handle) httprouter.Handle {
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        ctx := r.Context()

        // Pull the user's token from the identity the auth middleware attached upstream.
        var authToken string
        if identity, ok := ctx.Value(constants.RequestIdentityKey).(*integrations.RequestIdentity); ok {
            authToken = identity.Token          // the same token the browser sent
        }

        // Create a client bound to this user's token, attach it to the context.
        client := app.bffClientFactory.CreateClient(bffclient.BFFTargetMaaS, authToken)
        ctx = context.WithValue(ctx, constants.BFFClientKey("maas"), client)

        next(w, r.WithContext(ctx), ps)         // hand off to the next handler in the chain
    }
}
```

::: warning The Token Is the User's, Not the Service's
Inter-BFF calls forward the **caller's** token (`x-forwarded-access-token`) so the target BFF makes Kubernetes calls *as that user*, with that user's RBAC. This is why a limited-access user stays limited across BFF boundaries. Do not "simplify" this by giving the target a service-account token -- that would silently escalate every request. See the [security note](../guide/deep-dive/inter-bff-communication#authentication) on `internal` auth before touching auth methods.
:::

## Step 5: Write the Handler

Now the easy part -- the handler just asks the context for its client and makes the call:

```go
func (app *App) MaasTokensHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
    ctx := r.Context()

    // Get the client the middleware attached. It already carries the user's token.
    client := bffclient.GetClient(ctx, bffclient.BFFTargetMaaS)
    if client == nil {                                   // middleware missing or misordered
        app.serverError(w, r, errors.New("MaaS BFF client not available"))
        return
    }

    // Make the inter-BFF call. client.Call marshals the body, sets auth + TLS,
    // sends the request, and unmarshals the response into &resp.
    var resp models.MaasTokenResponse
    err := client.Call(ctx, http.MethodPost, "/tokens", nil, &resp)
    if err != nil {
        app.handleBFFClientError(w, r, err)             // maps BFFClientError codes to HTTP statuses
        return
    }

    app.writeJSON(w, http.StatusOK, resp)               // return MaaS's answer to our caller
}
```

`client.Call(ctx, method, path, body, &resp)` is the whole API surface. It is `fetch(path, { method, body })` followed by `await res.json()` -- but with the auth header, TLS config, and a 30-second timeout already handled for you.

## Step 6: Wire Up the Route

Compose the middleware chain, inside-out, exactly like every other authenticated route:

```go
router.POST("/gen-ai/api/v1/maas/tokens",
    app.AttachNamespace(                 // resolve + validate the namespace
        app.RequireAccessToService(      // check the caller may reach this feature
            app.AttachBFFTargetClient(   // build the MaaS client with the user's token (Step 4)
                app.MaasTokensHandler)))) // finally, our handler (Step 5)
```

Read it outside-in: namespace → access check → attach client → handler. Each wrapper runs, then calls the next. If any layer rejects the request, the inner ones never run.

**What you should see:** `go build ./...` passes with all six pieces in place.

## Step 7: Run Two BFFs and Watch Them Talk

This is the payoff. Start MaaS in one terminal, then start gen-ai pointing at it.

**Terminal 1 -- the target (MaaS):**

```bash
cd packages/maas/bff
go run cmd/main.go --port=4000
```

**What you should see:**

```
time=2024-01-01T10:00:00.000Z level=INFO msg="Server starting" port=4000
```

**Terminal 2 -- the caller (gen-ai), pointed at local MaaS:**

```bash
cd packages/gen-ai/bff
BFF_MAAS_DEV_URL=http://localhost:4000/api/v1 go run cmd/main.go --port=8080
```

`BFF_MAAS_DEV_URL` overrides service discovery -- instead of resolving `odh-dashboard-maas-ui.<ns>.svc.cluster.local`, the client calls `http://localhost:4000/api/v1`.

**What you should see:**

```
time=2024-01-01T10:00:01.000Z level=INFO msg="Server starting" port=8080
```

**Terminal 3 -- hit the gen-ai endpoint, which calls MaaS under the hood:**

```bash
curl -s -X POST http://localhost:8080/gen-ai/api/v1/maas/tokens \
  -H "x-forwarded-access-token: fake-dev-token" | jq .
```

**What you should see** (from the MaaS stub, relayed by gen-ai):

```json
{
  "token": "maas-ephemeral-token-abc123",
  "expiresIn": 3600
}
```

You just made a BFF call another BFF, forwarding a user token across the boundary. Look at Terminal 1 -- MaaS logged the incoming request. The two processes are talking.

## Step 8: Try Mock Mode

You do not always want to run a second BFF. `MOCK_BFF_CLIENTS=true` swaps in canned responses so you can develop the caller in isolation -- great for frontend work and CI.

Stop gen-ai (Ctrl+C in Terminal 2) and restart it in mock mode -- **no MaaS needed**:

```bash
cd packages/gen-ai/bff
MOCK_BFF_CLIENTS=true go run cmd/main.go --port=8080
```

**What you should see:**

```
time=2024-01-01T10:05:00.000Z level=INFO msg="Using mock BFF clients"
time=2024-01-01T10:05:00.000Z level=INFO msg="Server starting" port=8080
```

Hit the same endpoint (you can shut down MaaS in Terminal 1 first to prove it is not being used):

```bash
curl -s -X POST http://localhost:8080/gen-ai/api/v1/maas/tokens \
  -H "x-forwarded-access-token: fake-dev-token" | jq .
```

**What you should see:** A predefined mock response -- served entirely by gen-ai, with zero network calls to MaaS.

## Bonus: Calling core-bff

`core-bff` is the one exception to the "each BFF is its own pod" rule -- it runs inside the **main dashboard pod** on **port 8943**. Calling it is the same pattern with different coordinates:

```bash
# Terminal 1 — core-bff locally, auth disabled for dev
cd distributions/core-bff/bff
go run cmd/main.go --port=8943 --auth-method=disabled

# Terminal 2 — gen-ai pointed at local core-bff
cd packages/gen-ai/bff
BFF_CORE_BFF_DEV_URL=http://localhost:8943/api go run cmd/main.go --port=8080
```

::: warning core-bff Needs a Fastify Proxy Entry
In the cluster, the browser reaches core-bff through the Fastify `/core-bff/api/*` proxy route, which only exists if the `coreBff` `proxyService` entry is present in the `federation-config` ConfigMap. Without it, requests 404. That is a deployment detail, not something you hit in this local flow -- but remember it when your cluster calls to core-bff mysteriously 404.
:::

## Step 9: Handle Errors Like the Codebase Does

`client.Call` returns a structured `*bffclient.BFFClientError` you can switch on -- much richer than a bare `fetch` rejection:

```go
err := client.Call(ctx, http.MethodPost, "/tokens", req, &resp)
if err != nil {
    if bffErr, ok := err.(*bffclient.BFFClientError); ok {
        switch bffErr.Code {
        case bffclient.ErrCodeUnauthorized:      // 401 from the target
            // token was missing/expired
        case bffclient.ErrCodeServerUnavailable: // 5xx or unhealthy target
            // target is down -- degrade gracefully
        }
    }
}
```

| Code | Meaning |
|------|---------|
| `CONNECTION_FAILED` | Could not reach the target (DNS/network) |
| `TIMEOUT` | No response within 30s (default) |
| `UNAUTHORIZED` / `FORBIDDEN` | 401 / 403 from the target |
| `NOT_FOUND` / `BAD_REQUEST` | 404 / 400 from the target |
| `SERVER_UNAVAILABLE` | 5xx or unhealthy target |

---

<div class="checkpoint">

#### Checkpoint

Before moving on, verify:

- [ ] `go build ./...` passes with the flags, factory, middleware, handler, and route in place
- [ ] With MaaS on `:4000` and `BFF_MAAS_DEV_URL` set, `curl` to the gen-ai endpoint returns MaaS's response
- [ ] Terminal 1 shows MaaS receiving the request (proving the two processes actually talk)
- [ ] `MOCK_BFF_CLIENTS=true` returns a canned response with MaaS shut down
- [ ] You can explain why the call forwards the **user's** token, not a service token

</div>

::: info If You Get Stuck
- [Inter-BFF Communication (concept)](../guide/deep-dive/inter-bff-communication) -- the architecture and auth model
- [Middleware Chain](../guide/deep-dive/middleware) -- how the inside-out composition works
- [Mock Clients](./mock-clients) -- the interface/factory pattern mock mode relies on
:::

## What's Next

You have made BFFs talk to each other. But how does a *new* BFF come into existence in the first place -- the package, the ports, the frontend registration? In the next tutorial, [Onboard a New Module](./onboard-a-module), you will scaffold a brand-new federated module from scratch with the module-onboarding workflow and `mod-arch-installer`.
