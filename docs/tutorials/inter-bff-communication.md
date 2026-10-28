# Tutorial 6: Inter-BFF Communication

Up to now every endpoint you built talked to Kubernetes or an upstream service. But sometimes one BFF needs to call *another BFF*. The Gen-AI BFF, for example, asks the MaaS BFF for an ephemeral API key before it opens a Playground session. That is a BFF-to-BFF HTTP call, authenticated with the same user token the browser sent.

In this tutorial you will walk the **real** call in gen-ai end to end -- flags, client factory, the middleware that forwards the user's token, the handler that makes the call, and the route that ties it together -- and then run **two BFFs at once** on your laptop and watch one call the other. Every snippet is trimmed from `packages/gen-ai/bff/`; nothing here is invented, so you can open each file alongside.

**Time:** ~30 minutes

**Prerequisite:** You should be comfortable with [Writing Handlers](../guide/deep-dive/handlers) and [Middleware Chain](../guide/deep-dive/middleware). Read the concept page first if you want the big picture: [Inter-BFF Communication](../guide/deep-dive/inter-bff-communication).

## What You Are Building

A request to the Gen-AI BFF that reaches out to the MaaS BFF, forwards the caller's token, and returns MaaS's answer:

```
curl ──▶ gen-ai BFF                      ──(user token)──▶ maas BFF
         POST /gen-ai/api/v1/maas/tokens                   POST /api/v1/api-keys
◀── { "data": { "key": "...", "expiresAt": "..." } } ◀──── { "data": { "key": ..., "id": ..., ... } }
```

You will run both sides locally with mock Kubernetes, so no cluster is required.

::: info The Frontend Analogy
This is the exact same thing your React app does when it calls `fetch('/gen-ai/api/v1/...')` -- except now *the BFF* is the client, and *another BFF* is the server. Same request/response, same auth header, just one layer deeper. If you have ever written a Next.js API route that calls another microservice, you already understand the shape.
:::

## Step 1: Find (or Copy) the BFF Client Package

The `bffclient` package is not a shared Go module -- each BFF that needs it carries its own copy. gen-ai is the reference implementation. If you are wiring up another module, copy it in:

```bash
# From the repo root -- copy the client into a module that needs it
cp -r packages/gen-ai/bff/internal/integrations/bffclient \
      packages/<your-module>/bff/internal/integrations/bffclient
```

The package has these pieces:

```
internal/integrations/bffclient/
├── client.go             # HTTP client with TLS and auth
├── config.go             # BFFTarget constants + service discovery
├── factory.go            # Client factory (real)
├── composite_factory.go  # Real for some targets, mock for others
├── middleware.go         # GetClient + generic AttachBFFClient middleware
├── errors.go             # Structured error types (BFFClientError)
└── bffmocks/             # Mock implementation for testing
```

::: tip Why Copy Instead of Import?
In TypeScript you would publish `@odh-dashboard/bff-client` to npm and `import` it everywhere. For `bffclient` the BFFs deliberately do *not* do this -- each owns its copy so it can be built and deployed independently. (The repo does share other Go code as modules via `replace` directives -- `pkg/tls` and `packages/autox-core/services` -- so this is a per-package choice, not a rule.)
:::

For this tutorial we work inside `packages/gen-ai/bff/`, which already has the package. Verify it compiles:

```bash
cd packages/gen-ai/bff
go build ./...
```

**What you should see:** Nothing. Silence means success.

## Step 2: The CLI Flags

The calling BFF needs to know *where* the target lives and *how* to talk to it. Those come from flags (which read env vars as defaults) in `cmd/main.go`:

```go
// packages/gen-ai/bff/cmd/main.go (trimmed)
flag.BoolVar(&cfg.MockBFFClients, "mock-bff-clients",
    getEnvAsBool("MOCK_BFF_CLIENTS", false), "Use mock BFF clients for inter-BFF communication")
flag.StringVar(&cfg.BFFMaaSServiceName, "bff-maas-service-name",
    getEnvAsString("BFF_MAAS_SERVICE_NAME", "odh-dashboard"), "Kubernetes service name for MaaS BFF")
flag.IntVar(&cfg.BFFMaaSServicePort, "bff-maas-service-port",
    getEnvAsInt("BFF_MAAS_SERVICE_PORT", 8243), "Port for MaaS BFF service")
flag.BoolVar(&cfg.BFFMaaSTLSEnabled, "bff-maas-tls-enabled",
    getEnvAsBool("BFF_MAAS_TLS_ENABLED", false), "Enable TLS for MaaS BFF communication")
flag.StringVar(&cfg.BFFMaaSDevURL, "bff-maas-dev-url",
    getEnvAsString("BFF_MAAS_DEV_URL", ""), "Developer override URL for MaaS BFF")
flag.StringVar(&cfg.BFFMaaSAuthMethod, "bff-maas-auth-method",
    getEnvAsString("BFF_MAAS_AUTH_METHOD", "user_token"), "Auth method for MaaS BFF")
flag.StringVar(&cfg.BFFMaaSAuthTokenHeader, "bff-maas-auth-token-header",
    getEnvAsString("BFF_MAAS_AUTH_TOKEN_HEADER", "x-forwarded-access-token"), "Header to send auth token to MaaS BFF")
// ... and the same set for BFF_MLFLOW_*
```

::: info Flags AND Env Vars
Every flag reads an env var as its default. Locally you pass `--bff-maas-dev-url=...` or export `BFF_MAAS_DEV_URL=...`; in the cluster, `manifests/modules/gen-ai/deployment.yaml` sets the env vars (`BFF_MAAS_SERVICE_NAME=odh-dashboard-maas-ui`, `BFF_MAAS_TLS_ENABLED=true`, ...). The binary default `odh-dashboard` is only a fallback. This is like reading `process.env.X ?? defaultValue` in Node, but wired to a `--flag` too.
:::

## Step 3: The Client Factory

The factory decides, once at startup, whether to build *real* HTTP clients or *mock* ones. In `internal/api/app.go`, `NewApp` does:

```go
// packages/gen-ai/bff/internal/api/app.go (trimmed)
bffConfig := bffclient.NewDefaultBFFClientConfig()
bffConfig.MockBFFClients = cfg.MockBFFClients
bffConfig.InsecureSkipVerify = cfg.InsecureSkipVerify
bffConfig.PodNamespace = dashboardNamespace              // detected at startup

if maasConfig := bffConfig.GetServiceConfig(bffclient.BFFTargetMaaS); maasConfig != nil {
    if cfg.BFFMaaSServiceName != "" {
        maasConfig.ServiceName = cfg.BFFMaaSServiceName
    }
    if cfg.BFFMaaSServicePort > 0 {
        maasConfig.Port = cfg.BFFMaaSServicePort
    }
    maasConfig.TLSEnabled = cfg.BFFMaaSTLSEnabled
    maasConfig.DevOverrideURL = cfg.BFFMaaSDevURL        // wins over service discovery when set
    // ... AuthMethod, AuthTokenHeader, AuthTokenPrefix from the flags
}

var bffFactory bffclient.BFFClientFactory
if cfg.MockBFFClients {
    mockFactory := bffmocks.NewMockClientFactory(logger)
    if cfg.BFFMLflowDevURL != "" {                       // real MLflow, mocks for the rest
        realFactory := bffclient.NewRealClientFactory(bffConfig, rootCAs, false, logger)
        bffFactory = bffclient.NewCompositeClientFactory(
            realFactory, mockFactory, []bffclient.BFFTarget{bffclient.BFFTargetMLflow}, logger)
    } else {
        bffFactory = mockFactory                         // canned responses
    }
} else {
    bffFactory = bffclient.NewRealClientFactory(bffConfig, rootCAs, cfg.InsecureSkipVerify, logger)
}
// ... stored on the App as bffClientFactory
```

`GetURL` builds `<scheme>://<ServiceName>.<namespace>.svc.cluster.local:<Port>/api/v1` -- unless `DevOverrideURL` is set, in which case it returns that verbatim. The namespace comes from `PodNamespace`, falling back to `POD_NAMESPACE`.

::: tip This Is Dependency Injection
Picking the factory *once* at startup and storing it on `App` is the same pattern as choosing a real vs. mock Kubernetes client. Handlers never know which one they got -- they just ask the context for a client. That is what makes [Mock Clients](./mock-clients) possible without changing handler code.
:::

## Step 4: The Middleware That Forwards the Token

This is the heart of inter-BFF auth. `AttachBFFMaaSClient` pulls the user's token out of the request identity (put there by `InjectRequestIdentity`) and builds a client that will forward that token to MaaS:

```go
// packages/gen-ai/bff/internal/api/middleware.go (trimmed)
func (app *App) AttachBFFMaaSClient(next func(http.ResponseWriter, *http.Request, httprouter.Params)) httprouter.Handle {
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        ctx := r.Context()

        if app.bffClientFactory == nil {                 // inter-BFF not wired at all → 503
            app.errorResponse(w, r, &integrations.HTTPError{ /* 503 service_unavailable */ })
            return
        }

        // Target not configured → attach a nil client and let the handler degrade gracefully
        if !app.bffClientFactory.IsTargetConfigured(bffclient.BFFTargetMaaS) {
            ctx = context.WithValue(ctx, constants.BFFClientKey(constants.BFFTarget(bffclient.BFFTargetMaaS)), nil)
            next(w, r.WithContext(ctx), ps)
            return
        }

        // The user's token, from the identity the auth middleware attached upstream
        var authToken string
        if identity, ok := ctx.Value(constants.RequestIdentityKey).(*integrations.RequestIdentity); ok && identity != nil {
            authToken = identity.Token
        }

        forwardHeaders := map[string]string{}
        // (trimmed: kubeflow-userid/groups forwarding, only when BOTH BFFs use internal auth;
        //  a user_token caller talking to an internal target is rejected with 503)
        forwardHeaders[constants.MaaSReturnAllModelsHeader] = "true"

        client := app.bffClientFactory.CreateClientWithHeaders(bffclient.BFFTargetMaaS, authToken, forwardHeaders)
        // (trimmed: nil-client check)
        ctx = context.WithValue(ctx, constants.BFFClientKey(constants.BFFTarget(bffclient.BFFTargetMaaS)), client)
        next(w, r.WithContext(ctx), ps)
    }
}
```

::: tip Writing This for Another Target?
You don't need to hand-roll a copy. `bffclient/middleware.go` ships a generic version, `bffclient.AttachBFFClient(factory, target)`, that does the configured-check, token extraction, `CreateClient` and context attach for any `BFFTarget`. gen-ai's MaaS middleware is bespoke only because of the extra headers.
:::

::: warning The Token Is the User's, Not the Service's
Inter-BFF calls forward the **caller's** token (`x-forwarded-access-token`) so the target BFF makes Kubernetes calls *as that user*, with that user's RBAC. This is why a limited-access user stays limited across BFF boundaries. Do not "simplify" this by giving the target a service-account token -- that would silently escalate every request. See the [security note](../guide/deep-dive/inter-bff-communication#authentication-forward-the-user-s-token) on `internal` auth before touching auth methods.
:::

## Step 5: The Handler

The handler asks the context for its client and makes the call. `MaaSIssueTokenHandler` lives in `internal/api/maas_tokens_handler.go`:

```go
// packages/gen-ai/bff/internal/api/maas_tokens_handler.go (trimmed)
func (app *App) MaaSIssueTokenHandler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
    ctx := r.Context()

    // The client the middleware attached. It already carries the user's token.
    maasClient := bffclient.GetClient(ctx, bffclient.BFFTargetMaaS)
    if maasClient == nil {                               // target not configured
        app.maasBFFUnavailableResponse(w, r)             // 503
        return
    }

    var tokenRequest models.MaaSTokenRequest
    if r.Body != nil && r.ContentLength != 0 {
        if err := app.ReadJSON(w, r, &tokenRequest); err != nil {
            app.badRequestResponse(w, r, err)
            return
        }
    }
    subscription := strings.TrimSpace(tokenRequest.Subscription)
    if subscription == "" {
        app.badRequestResponse(w, r, fmt.Errorf("subscription is required"))
        return
    }
    // (trimmed: expiresIn defaults to "1h", must match ^[0-9]+(m|h)$ and be <= 1h;
    //  keyName defaults to "genai-ephemeral-<unix time>")

    bffRequest := models.MaaSBFFAPIKeyRequest{          // MaaS expects an envelope: {"data": {...}}
        Data: models.MaaSBFFAPIKeyRequestData{
            Name: keyName, Description: tokenRequest.Description,
            ExpiresIn: expiresIn, Subscription: subscription,
            Ephemeral: true,                             // always ephemeral for playground sessions
        },
    }

    // The inter-BFF call: POST <maas base URL>/api-keys
    var bffResponse models.MaaSBFFAPIKeyResponse
    if err := maasClient.Call(ctx, "POST", "/api-keys", bffRequest, &bffResponse); err != nil {
        app.handleBFFClientError(w, r, err)              // maps BFFClientError codes to HTTP statuses
        return
    }
    if bffResponse.Data.Key == "" {
        app.serverErrorResponse(w, r, fmt.Errorf("MaaS BFF returned empty key in response"))
        return
    }

    // Reshape MaaS's answer into gen-ai's own contract
    genAIResponse := models.MaaSTokenResponse{Key: bffResponse.Data.Key}
    if bffResponse.Data.ExpiresAt != nil {
        genAIResponse.ExpiresAt = *bffResponse.Data.ExpiresAt
    }
    err := app.WriteJSON(w, http.StatusCreated, Envelope[models.MaaSTokenResponse, None]{Data: genAIResponse}, nil)
    if err != nil {
        app.serverErrorResponse(w, r, err)
    }
}
```

`client.Call(ctx, method, path, body, &resp)` is the whole API surface. It is `fetch(path, { method, body })` followed by `await res.json()` -- but with the auth header, TLS config, and a 30-second timeout already handled for you. The path is relative to the target's base URL, which already ends in `/api/v1`.

On the other side, MaaS registers `apiRouter.POST(constants.APIKeyCreatePath, ...)` (`/api/v1/api-keys`, in `packages/maas/bff/internal/api/api_keys_handlers.go`) and answers `201` with its own envelope.

## Step 6: The Route

The route composes the middleware chain, inside-out, exactly like every other authenticated route:

```go
// packages/gen-ai/bff/internal/api/app.go
apiRouter.POST(constants.MaaSTokensPath,                 // "/api/v1/maas/tokens"
    app.AttachNamespace(                                 // require ?namespace=
        app.RequireAccessToService(                      // SSAR: can the caller list OGXServers there?
            app.AttachBFFMaaSClient(                     // build the MaaS client with the user's token
                app.MaaSIssueTokenHandler))))            // the handler
```

Read it outside-in: namespace → access check → attach client → handler. Each wrapper runs, then calls the next. If any layer rejects the request, the inner ones never run.

Two details trip people up when they add a route like this:

- **Write the path without `/gen-ai`.** `Routes()` mounts `apiRouter` twice -- under `/api/v1/` and under `/gen-ai/api/v1/` with `http.StripPrefix("/gen-ai", ...)` -- so the router only ever sees `/api/v1/...`. A route registered as `"/gen-ai/api/v1/..."` never matches.
- **Pick a new path.** httprouter panics at startup if you register the same method + path twice. To experiment with your own inter-BFF endpoint, add a fresh constant (say `ApiPathPrefix + "/maas/tokens-demo"`) and register it alongside the real one.

## Step 7: Run Two BFFs and Watch Them Talk

This is the payoff. Start MaaS in one terminal, then start gen-ai pointing at it. Both use `make run`, because `--mock-k8s-client` needs the envtest binaries the Makefile downloads and exports as `ENVTEST_ASSETS` (a bare `go run` would try to find a kubeconfig instead).

**Terminal 1 -- the target (MaaS):**

```bash
cd packages/maas/bff
make run PORT=4000 MOCK_K8S_CLIENT=true MOCK_HTTP_CLIENT=true
```

The Makefile already passes `--auth-method=user_token --auth-token-header=x-forwarded-access-token` (the binary default would be `internal`, which rejects a forwarded token with "missing kubeflow-userid"). `MOCK_HTTP_CLIENT=true` starts an in-process fake of the upstream maas-api, so `/api-keys` has something to talk to.

**What you should see** (among the startup lines):

```
level=INFO msg="MaaS Fake API Server is running" url=http://127.0.0.1:...
level=INFO msg="starting server" addr=:4000 "TLS enabled"=false
```

**Terminal 2 -- the caller (gen-ai), pointed at local MaaS:**

```bash
cd packages/gen-ai/bff
make run MOCK_K8S_CLIENT=true MOCK_LS_CLIENT=true MOCK_MCP_CLIENT=true \
  BFF_MAAS_DEV_URL=http://localhost:4000/api/v1
```

`BFF_MAAS_DEV_URL` overrides service discovery -- instead of resolving `odh-dashboard-maas-ui.<ns>.svc.cluster.local`, the client calls `http://localhost:4000/api/v1`. The mock K8s client answers the namespace and SSAR checks, so you don't need a cluster.

**What you should see:**

```
level=INFO msg="Using real BFF client factory" ... maasDevURL=http://localhost:4000/api/v1 ...
level=INFO msg="starting server" addr=:8080 ...
```

**Terminal 3 -- hit the gen-ai endpoint, which calls MaaS under the hood:**

```bash
curl -s -X POST "http://localhost:8080/gen-ai/api/v1/maas/tokens?namespace=default" \
  -H "x-forwarded-access-token: FAKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subscription": "demo"}' | jq .
```

**What you should see** (from MaaS's fake upstream, reshaped by gen-ai):

```json
{
  "data": {
    "key": "MOCK_API_KEY_NOT_REAL_DO_NOT_USE",
    "expiresAt": "2026-06-10T12:00:00Z"
  }
}
```

You just made a BFF call another BFF, forwarding a user token across the boundary. With `LOG_LEVEL=debug` on the MaaS side you can watch the incoming `POST /api/v1/api-keys`. Drop the `subscription` field and gen-ai answers 400 before MaaS is ever called; stop MaaS and the same curl turns into a `handleBFFClientError` response.

::: info Verify Before You Rely On It
These commands were checked against each BFF's `cmd/main.go` and `Makefile`, not executed for this page. Mock behaviour changes over time -- if a flag has moved, `go run ./cmd -h` lists the current ones.
:::

## Step 8: Try Mock Mode

You do not always want to run a second BFF. `MOCK_BFF_CLIENTS=true` swaps in canned responses so you can develop the caller in isolation -- great for frontend work and CI.

Stop gen-ai (Ctrl+C in Terminal 2) and restart it in mock mode -- **no MaaS needed**:

```bash
cd packages/gen-ai/bff
make run MOCK_K8S_CLIENT=true MOCK_LS_CLIENT=true MOCK_MCP_CLIENT=true MOCK_BFF_CLIENTS=true
```

**What you should see:**

```
level=INFO msg="Using mock BFF client factory"
level=INFO msg="starting server" addr=:8080 ...
```

Hit the same endpoint (shut down MaaS in Terminal 1 first to prove it is not being used):

```bash
curl -s -X POST "http://localhost:8080/gen-ai/api/v1/maas/tokens?namespace=default" \
  -H "x-forwarded-access-token: FAKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subscription": "demo"}' | jq .
```

**What you should see:** A key like `sk-oai-mock-<timestamp>` from `bffmocks/mock_client.go`, which has a canned branch for `POST /api-keys` -- served entirely by gen-ai, with zero network calls to MaaS.

## What About core-bff?

You may expect to point gen-ai at core-bff the same way. You can't, today: there is no core-bff `BFFTarget` and no code reads `BFF_CORE_BFF_*` (the repo's own `docs/inter-bff-communication.md` is stale on this). Calling it would require adding a target -- constant, `ServiceConfigs` entry for the main dashboard Service on port `8943`, flags, Deployment env and NetworkPolicy. In the cluster, core-bff is the *front door* that proxies browser calls to module BFFs, and its own `coreBff` federation entry is generated by the operator. See [Core BFF architecture](/guide/core-bff/architecture).

## Step 9: Handle Errors Like the Codebase Does

`client.Call` returns a structured `*bffclient.BFFClientError` you can switch on -- much richer than a bare `fetch` rejection:

```go
err := maasClient.Call(ctx, http.MethodPost, "/api-keys", bffRequest, &bffResponse)
if err != nil {
    var bffErr *bffclient.BFFClientError
    if errors.As(err, &bffErr) {
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
| `INVALID_RESPONSE` | Body could not be decoded |
| `NOT_CONFIGURED` | Target not configured (503) |

Most handlers don't switch by hand: `app.handleBFFClientError(w, r, err)` (`internal/api/errors.go`) maps the code and status to a response, and replaces 5xx messages with a generic one so upstream details never reach the browser.

---

<div class="checkpoint">

#### Checkpoint

Before moving on, verify:

- [ ] You can point to each piece in gen-ai: flags (`cmd/main.go`), factory (`NewApp`), `AttachBFFMaaSClient`, `MaaSIssueTokenHandler`, and the `MaaSTokensPath` route
- [ ] With MaaS on `:4000` and `BFF_MAAS_DEV_URL` set, `curl` to the gen-ai endpoint returns a key from MaaS's fake upstream
- [ ] Stopping MaaS turns the same call into an error response (proving the two processes actually talk)
- [ ] `MOCK_BFF_CLIENTS=true` returns an `sk-oai-mock-...` key with MaaS shut down
- [ ] You can explain why the call forwards the **user's** token, not a service token

</div>

::: info If You Get Stuck
- [Inter-BFF Communication (concept)](../guide/deep-dive/inter-bff-communication) -- the architecture and auth model
- [Middleware Chain](../guide/deep-dive/middleware) -- how the inside-out composition works
- [Mock Clients](./mock-clients) -- the interface/factory pattern mock mode relies on
:::

## What's Next

You have made BFFs talk to each other. But how does a *new* BFF come into existence in the first place -- the package, the ports, the frontend registration? In the next tutorial, [Onboard a New Module](./onboard-a-module), you will scaffold a brand-new federated module from scratch with the module-onboarding workflow and `mod-arch-installer`.
