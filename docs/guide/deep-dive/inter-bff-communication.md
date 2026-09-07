# Inter-BFF Communication

> **When one BFF calls another** -- how the `bffclient` package, service discovery, and token forwarding let independent BFF pods coordinate without the browser ever knowing.

Most of the time, a BFF is a self-contained world: a request comes in from the browser, the handler talks to Kubernetes or an upstream service, and a response goes back. But the modular architecture splits features across **independent BFF pods** -- gen-ai, maas, model-registry, mlflow, and more -- each its own Kubernetes Deployment with its own Service. Sooner or later one of them needs something another one owns. The gen-ai BFF needs an ephemeral API key that the maas BFF issues. A module BFF needs cluster settings that core-bff already knows how to fetch.

That's inter-BFF communication: one BFF making an authenticated HTTP call to another, in-cluster, as the same user who made the original request.

::: info You Already Saw the Shape of This
The [Integrations](./integrations) chapter showed how a BFF calls *upstream* services (LlamaStack, Pipeline Server) with the factory-and-interface pattern. Inter-BFF calls use the **exact same pattern** -- a factory, an interface, per-request middleware, mocks for testing. The only new ideas are *service discovery* (finding the other BFF's address) and *token forwarding* (calling as the user, not as a service account). If you know `fetch()` from one microservice to another, you know this.
:::

## Why Not Just Call the Backend Directly?

A fair question. If the gen-ai BFF needs a MaaS token, why not call the MaaS *backend* directly instead of the MaaS *BFF*?

Because the MaaS BFF is where the MaaS domain logic lives -- validation, error shaping, the OpenAPI contract, the RBAC checks. Calling it directly means the gen-ai BFF gets the same behavior the browser would get, with none of the duplication. It's the same reason your React app calls the BFF instead of the Kubernetes API directly: the BFF is the layer that knows how to do the thing correctly.

```
┌─────────────────────────────────────────────┐
│  Main Dashboard Pod (odh-dashboard svc)      │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ odh-dashboard │  │   core-bff   │          │
│  │    :8080     │  │    :8943     │          │
│  └──────────────┘  └──────┬───────┘          │
└──────────────────────────┼───────────────────┘
                           │  ← core-bff stays in the main pod, on :8943
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────┴──────┐   ┌───────┴──────┐   ┌───────┴──────┐
│  gen-ai pod  │   │   maas pod   │   │  mlflow pod  │
│    :8143     │──▶│    :8243     │   │    :8343     │
│ gen-ai-ui svc│   │  maas-ui svc │   │ mlflow-ui svc│
└──────────────┘   └──────────────┘   └──────────────┘
     "call maas /tokens as this user"
```

Every module runs as its own pod with its own Service (`odh-dashboard-<module>-ui`). The one exception is **core-bff**, which stays inside the main dashboard pod on port `8943` -- so calls to it target the `odh-dashboard` Service, not a module Service. We'll come back to that.

## The `bffclient` Package

Inter-BFF calls are handled by a small package that each BFF vendors its own copy of, at `internal/integrations/bffclient/`:

```
internal/integrations/bffclient/
├── client.go       # The HTTP client: TLS, auth header, timeout, JSON round-trip
├── config.go       # Service discovery configuration (names, ports, dev URLs)
├── factory.go      # Client factory -- real & mock selection
├── middleware.go   # Per-request middleware that injects a client into context
├── errors.go       # Structured BFFClientError types + codes
└── bffmocks/       # Mock implementation for tests and single-BFF dev
```

::: info No Shared Go Module
There is no shared `bffclient` library imported across BFFs -- each BFF **copies** the package. That keeps the modules independent (no cross-module Go dependency, no shared version to bump), at the cost of some duplication. When you add inter-BFF calls to a new module, you literally copy this directory in. This is a deliberate trade-off of the modular architecture.
:::

The core interface is intentionally tiny -- one method does the whole HTTP round-trip:

```go
// BFFClientInterface -- the contract for calling another BFF
type BFFClientInterface interface {
    Call(ctx context.Context,                       // Request context (carries auth + cancellation)
        method, path string,                        // e.g. "POST", "/tokens"
        body interface{},                           // Request body, JSON-encoded (nil for none)
        response interface{},                       // Pointer to a struct the JSON decodes into
    ) error                                         // Non-nil on any failure (see error codes below)

    IsAvailable(ctx context.Context) bool           // Health check: is the target reachable?
    GetBaseURL() string                             // The resolved target URL
    GetTarget() BFFTarget                           // Which BFF this client talks to
}
```

If you squint, `Call(ctx, "POST", "/tokens", body, &resp)` is just a typed `fetch()` -- method, path, body in, decoded response out, error on failure.

## Configuration: The `BFF_<TARGET>_*` Environment Variables

A BFF learns *how* to reach each target it depends on from environment variables, one set per target. Replace `<TARGET>` with the target's name in upper snake case (`MAAS`, `GENAI`, `MODEL_REGISTRY`, `CORE_BFF`):

| Variable | What it does | Default |
|---|---|---|
| `MOCK_BFF_CLIENTS` | Return canned responses instead of real HTTP (global switch) | `false` |
| `BFF_<TARGET>_DEV_URL` | Dev override URL, e.g. `http://localhost:4000/api/v1` | *(unset)* |
| `BFF_<TARGET>_SERVICE_NAME` | Target's Kubernetes Service name | `odh-dashboard-<target>-ui` |
| `BFF_<TARGET>_SERVICE_PORT` | Target's port | varies by target |
| `BFF_<TARGET>_TLS_ENABLED` | Use HTTPS for the call | `false` local / `true` prod |
| `BFF_<TARGET>_AUTH_METHOD` | `user_token` or `internal` | `user_token` |
| `BFF_<TARGET>_AUTH_TOKEN_HEADER` | Header carrying the token | `x-forwarded-access-token` |
| `BFF_<TARGET>_AUTH_TOKEN_PREFIX` | Prefix, e.g. `Bearer ` | `` *(empty)* |
| `POD_NAMESPACE` | The pod's own namespace (used to build DNS) | injected via downward API |

::: tip Who Sets These in Production?
You don't hand-write these into a running pod. The **dashboard-operator injects them** into each module's Deployment based on the module's declared dependencies (see [The App Struct & Routes](./app-and-routes) for where they're read, and the [Modules & Federation](/guide/operator/modules-and-federation) operator chapter for where they're written). In local dev, you set `BFF_<TARGET>_DEV_URL` yourself.
:::

## Service Discovery: Finding the Other BFF

In Kubernetes, a Service gets a stable DNS name. The `bffclient` builds the target URL from the service name, the pod's namespace, and the port:

```
<service-name>.<namespace>.svc.cluster.local:<port>
```

So gen-ai calling maas resolves to something like:

```
odh-dashboard-maas-ui.redhat-ods-applications.svc.cluster.local:8243
```

`POD_NAMESPACE` (from the [downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/)) fills in the middle segment, so the same image works in any namespace without rebuilding.

For **local development**, DNS doesn't exist -- so `BFF_<TARGET>_DEV_URL` short-circuits discovery and points straight at a `localhost` port:

```bash
# Run gen-ai locally, but send its MaaS calls to a maas BFF on :4000
BFF_MAAS_DEV_URL=http://localhost:4000/api/v1 go run cmd/main.go
```

## Authentication: Forward the User's Token

This is the single most important thing to get right. When BFF A calls BFF B, it forwards **the user's token from the original request** -- never its own service-account credentials. BFF B then runs its *own* auth middleware and RBAC checks against that user. No privilege escalation: BFF A can never make BFF B do something the user couldn't do themselves.

The token comes out of the `RequestIdentity` that the auth middleware already put in context (see [Authentication & RBAC](./auth)):

```go
// Inside AttachBFFTargetClient middleware -- pull the user's token from context
var authToken string
if identity, ok := ctx.Value(
    constants.RequestIdentityKey,
).(*integrations.RequestIdentity); ok && identity != nil {
    authToken = identity.Token            // The USER's token -- not a service account
}
client := app.bffClientFactory.CreateClient(bffclient.BFFTargetMaaS, authToken)
```

Two auth methods exist, controlled by `BFF_<TARGET>_AUTH_METHOD`:

| Method | Header(s) forwarded | Where it's used |
|---|---|---|
| `user_token` | `x-forwarded-access-token` | ODH / RHOAI (the default) |
| `internal` | `kubeflow-userid`, `kubeflow-groups` | Kubeflow deployments only |

::: danger `internal` Auth Trusts Headers Verbatim
A BFF running `AUTH_METHOD=internal` believes the `kubeflow-userid` / `kubeflow-groups` headers on incoming requests **as-is** -- there is no signature, no cryptographic proof of who set them. That is only safe behind a trusted boundary (Istio `RequestAuthentication` / `AuthorizationPolicy`) that strips any client-supplied copies and re-injects verified ones.

**Never** set `BFF_<TARGET>_AUTH_METHOD=internal` -- on either side of a call -- unless that boundary is confirmed to be in place. Otherwise you've turned a call into a spoofable-identity vulnerability. When in doubt, use `user_token`.

Also check the target actually implements `internal`: some BFFs (e.g. MLflow) accept only `disabled`/`user_token` and exit at startup on anything else. Read the target's `internal/config/environment.go` before flipping this.
:::

::: warning A Subtle Token-Forwarding Trap
If the **calling** BFF itself runs with `--auth-method=internal`, incoming requests aren't required to carry a user bearer token, so `identity.Token` can be empty. If the target then expects `user_token` (the default), the call fails auth. Do **not** "fix" this by switching the target to `internal` -- that trades a failed call for a spoofable identity. Instead, treat the failure as expected and make best-effort call sites **degrade gracefully** rather than block the caller's own response.
:::

## TLS

| Environment | `TLS_ENABLED` | Notes |
|---|---|---|
| Local development | `false` | Plain HTTP between local processes |
| Production (K8s) | `true` | HTTPS with service-mesh certificates |

In production, make sure CA bundles are configured via the `BUNDLE_PATHS` environment variable so the client can verify the target's certificate.

## Mock Mode: Developing One BFF at a Time

Set `MOCK_BFF_CLIENTS=true` and the factory hands back mock clients that return predefined responses without ever making an HTTP call:

```bash
MOCK_BFF_CLIENTS=true go run cmd/main.go --port=8080
```

This is the inter-BFF equivalent of `jest.mock()` -- and it's what makes single-BFF and frontend development possible without spinning up every other module. Use it for isolated unit tests, frontend work, and CI.

## Errors: The `BFFClientError` Codes

`Call` returns a structured `*BFFClientError` you can switch on, instead of parsing status codes by hand:

| Code | Meaning |
|---|---|
| `CONNECTION_FAILED` | Network connectivity problem |
| `TIMEOUT` | Request exceeded the 30s default |
| `INVALID_RESPONSE` | Response body couldn't be parsed |
| `SERVER_UNAVAILABLE` | 5xx or unhealthy target |
| `UNAUTHORIZED` | 401 -- auth failure |
| `FORBIDDEN` | 403 -- permission denied |
| `NOT_FOUND` | 404 -- endpoint missing |
| `BAD_REQUEST` | 400 -- validation error |
| `INTERNAL_ERROR` | Generic 500 |

```go
err := client.Call(ctx, "POST", "/tokens", req, &resp)
if err != nil {
    var bffErr *bffclient.BFFClientError
    if errors.As(err, &bffErr) {           // Type-assert into the structured error
        switch bffErr.Code {
        case bffclient.ErrCodeUnauthorized:    // Map to a 401 for the browser
            app.authenticationRequiredResponse(w, r)
        case bffclient.ErrCodeServerUnavailable: // Map to a 503
            app.serviceUnavailableResponse(w, r)
        }
        return
    }
    app.serverErrorResponse(w, r, err)     // Anything else -> 500
}
```

Because every BFF uses the same error-envelope format (`{"error": {"code": "...", "message": "..."}}`), a helper like `handleBFFClientError` can translate the target's error straight into an HTTP response for the browser.

## Calling core-bff (The Special Case)

`core-bff` is the Go central BFF at `distributions/core-bff/`. It runs on port **8943 inside the main dashboard pod** (next to `odh-dashboard` and `kube-rbac-proxy`), and exposes platform-level APIs -- connection testing, cluster settings, serving runtimes -- that module BFFs can reuse instead of re-implementing Kubernetes client code.

Two things make it different from a module target:

**1. Its Service name is the main dashboard Service, not a module Service:**

| Variable | Value |
|---|---|
| `BFF_CORE_BFF_SERVICE_NAME` | `odh-dashboard` (ODH) / `rhods-dashboard` (RHOAI) |
| `BFF_CORE_BFF_SERVICE_PORT` | `8943` |
| `BFF_CORE_BFF_TLS_ENABLED` | `true` (K8s) / `false` (local dev) |

**2. The frontend reaches it through a Fastify proxy entry.** Requests to `/core-bff/api/*` are routed to core-bff via the `coreBff` `proxyService` entry in the `federation-config` ConfigMap:

```json
{
  "name": "coreBff",
  "proxyService": [{
    "authorize": true,
    "path": "/core-bff/api",
    "pathRewrite": "/api",
    "tls": true,
    "service": { "name": "odh-dashboard", "namespace": "opendatahub", "port": 8943 }
  }]
}
```

::: warning No Proxy Entry, No Route
Without that `coreBff` entry, `/core-bff/api/*` requests return **404** from Fastify -- there's simply no route registered. If a call into core-bff mysteriously 404s from the frontend, this ConfigMap is the first place to look.
:::

For local dev, run core-bff with auth disabled and point the caller at it:

```bash
# Terminal 1 -- core-bff locally
cd distributions/core-bff/bff
go run cmd/main.go --port=8943 --auth-method=disabled

# Terminal 2 -- a module BFF pointed at local core-bff
cd packages/gen-ai/bff
BFF_CORE_BFF_DEV_URL=http://localhost:8943/api go run cmd/main.go --port=8080
```

## From Concept to Keyboard

This chapter is the *mental model*. When you're ready to actually wire it up -- copy the package, add the flags, write the middleware, run two BFFs side by side, and watch a real inter-BFF call succeed -- head to the hands-on tutorial:

➡️ **[Tutorial: Inter-BFF Communication](/tutorials/inter-bff-communication)**

::: tip Key Takeaway
Inter-BFF communication is the [integrations](./integrations) pattern pointed at another BFF instead of an upstream service. The `bffclient` package gives you a one-method `Call` interface; env vars (`BFF_<TARGET>_*`) plus K8s DNS handle discovery; the user's token is forwarded so the target enforces RBAC as that user; `MOCK_BFF_CLIENTS` lets you develop in isolation; and `BFFClientError` codes give you structured failures. core-bff is the one target that lives in the main pod on `:8943` and needs a Fastify proxy entry to be reachable from the browser.
:::

::: info See Also
- [Integrations](./integrations) -- the factory-and-interface pattern this builds on
- [Authentication & RBAC](./auth) -- where `RequestIdentity` and the user token come from
- [Advanced Patterns](./advanced-patterns) -- SSE streaming and concurrent service calls
- [Modules & Federation](/guide/operator/modules-and-federation) -- how the operator injects the `BFF_<TARGET>_*` env vars
- [Tutorial: Inter-BFF Communication](/tutorials/inter-bff-communication) -- wire it up end to end
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Why does a BFF call another **BFF** instead of that module's backend directly?
- [ ] What does `Call(ctx, method, path, body, &resp)` do, and what does it map to in `fetch()` terms?
- [ ] How does a BFF find another BFF's address in-cluster vs. in local dev?
- [ ] Whose token gets forwarded on an inter-BFF call, and why does that prevent privilege escalation?
- [ ] Why is `internal` auth dangerous without a trusted network boundary?
- [ ] What makes core-bff different from a module target (Service name, port, Fastify proxy entry)?

</div>
