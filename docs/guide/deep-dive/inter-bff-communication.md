# Inter-BFF Communication

> **When one BFF calls another** -- how the `bffclient` package, service discovery, and token forwarding let independent BFF pods coordinate without the browser ever knowing.

Most of the time, a BFF is a self-contained world: a request comes in from the browser, the handler talks to Kubernetes or an upstream service, and a response goes back. But the modular architecture splits features across **independent BFF pods** -- gen-ai, maas, model-registry, mlflow, and more -- each its own Kubernetes Deployment with its own Service. Sooner or later one of them needs something another one owns. The gen-ai BFF needs an ephemeral API key that the maas BFF issues, and the model catalog the maas BFF knows how to list.

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
   "POST maas /api-keys as this user"
```

Every module runs as its own pod with its own Service (`odh-dashboard-<module>-ui`). The one exception is **core-bff**, which stays inside the main dashboard pod on port `8943`. It is also the **front door** for module APIs: browser calls to `/<module>/api/*` reach core-bff first, which reads the `federation-config` ConfigMap and proxies them pod-to-pod to the module's Service (see [Core BFF architecture](/guide/core-bff/architecture)). Inter-BFF calls are different: they go straight from one module pod to another, without passing through core-bff.

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

::: info No Shared Go Module (for this package)
There is no shared `bffclient` library imported across BFFs -- each BFF **copies** the package (gen-ai, agent-ops, data-connect-hub, data-registry, mlflow and model-registry carry their own today). That keeps the modules independent, at the cost of some duplication. When you add inter-BFF calls to a new module, you literally copy this directory in.

The repo does share *some* Go code as real modules, wired in with `replace` directives: `pkg/tls` (the cluster TLS-profile helper almost every BFF imports) and `packages/autox-core/services` (automl and autorag). Copy-per-BFF is a choice made for `bffclient`, not a rule.
:::

The core interface is intentionally tiny -- one method does the whole HTTP round-trip:

```go
// BFFClientInterface -- the contract for calling another BFF
type BFFClientInterface interface {
    Call(ctx context.Context,                       // Request context (carries auth + cancellation)
        method, path string,                        // e.g. "POST", "/api-keys"
        body interface{},                           // Request body, JSON-encoded (nil for none)
        response interface{},                       // Pointer to a struct the JSON decodes into
    ) error                                         // Non-nil on any failure (see error codes below)

    IsAvailable(ctx context.Context) bool           // Health check: is the target reachable?
    GetBaseURL() string                             // The resolved target URL
    GetTarget() BFFTarget                           // Which BFF this client talks to
}
```

If you squint, `Call(ctx, "POST", "/api-keys", body, &resp)` is just a typed `fetch()` -- method, path, body in, decoded response out, error on failure. The path is relative to the target's base URL, which already ends in `/api/v1`.

The factory that hands out these clients has four methods: `CreateClient(target, authToken)`, `CreateClientWithHeaders(target, authToken, headers)` (extra headers to forward, e.g. the kubeflow pair in `internal` mode), `GetConfig(target)`, and `IsTargetConfigured(target)` -- the last one lets middleware degrade gracefully when a target isn't wired up.

## Configuration: The `BFF_<TARGET>_*` Environment Variables

The targets are a fixed list of `BFFTarget` constants in `config.go`: `maas`, `gen-ai`, `model-registry`, `mlflow` in gen-ai's copy (data-registry's also has `data-connect-hub`; mlflow's and model-registry's carry only the one target they call). There is no core-bff target. A BFF learns *how* to reach each target it actually calls from flags/env vars, one set per target, read in its `cmd/main.go`. gen-ai reads them for `MAAS` and `MLFLOW` only:

| Variable | What it does | Binary default (gen-ai) |
|---|---|---|
| `MOCK_BFF_CLIENTS` | Return canned responses instead of real HTTP (global switch) | `false` |
| `BFF_<TARGET>_DEV_URL` | Dev override URL, e.g. `http://localhost:4000/api/v1` | *(unset)* |
| `BFF_<TARGET>_SERVICE_NAME` | Target's Kubernetes Service name | `odh-dashboard` (the manifests set `odh-dashboard-<slug>-ui`) |
| `BFF_<TARGET>_SERVICE_PORT` | Target's port | `8243` maas, `8343` mlflow |
| `BFF_<TARGET>_TLS_ENABLED` | Use HTTPS for the call | `false` (mlflow: `true`); manifests set `true` |
| `BFF_<TARGET>_AUTH_METHOD` | `user_token` or `internal` | `user_token` |
| `BFF_<TARGET>_AUTH_TOKEN_HEADER` | Header carrying the token | `x-forwarded-access-token` |
| `BFF_<TARGET>_AUTH_TOKEN_PREFIX` | Prefix, e.g. `Bearer ` | `` *(empty)* |
| `POD_NAMESPACE` | Fallback namespace for DNS | injected via downward API |

::: tip Who Sets These in Production?
Today they are **hardcoded in the module's Deployment**: `manifests/modules/gen-ai/deployment.yaml` sets `BFF_MAAS_SERVICE_NAME=odh-dashboard-maas-ui`, port `8243`, `TLS_ENABLED=true`, and the same for MLflow. The dashboard-operator also writes `BFF_<T>_SERVICE_NAME`/`PORT` into the module's generated `<slug>-params` ConfigMap -- but only for modules that declare `InterBFFDeps` in its module registry, and only while the target module is deployed (`addInterBFFParams` in `module_deploy.go`). gen-ai doesn't consume those keys yet, so they are inert. A module that wants the operator-managed values must read them via `envFrom` on `<slug>-params` and must not ship static defaults for them. See [Modules & Federation](/guide/operator/modules-and-federation) for the operator side. In local dev, you set `BFF_<TARGET>_DEV_URL` yourself.
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

The middle segment is the caller's own namespace: gen-ai sets `bffConfig.PodNamespace` to the dashboard namespace it detects at startup, and `GetURL` falls back to `POD_NAMESPACE` (from the [downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/)) and finally to `opendatahub`. The same image works in any namespace without rebuilding.

::: warning NetworkPolicies Must Allow the Caller
Every module ships a NetworkPolicy (`manifests/modules/<slug>/networkpolicy.yaml`) that only admits ingress from the main dashboard pod (`deployment in (odh-dashboard, rhods-dashboard)`, i.e. the core-bff front door), the OpenShift ingress, and named callers -- maas lists `gen-ai-ui` and `maas-portal`. If you add a new inter-BFF call, add your pod to the **target's** policy, or the call silently times out.
:::

For **local development**, DNS doesn't exist -- so `BFF_<TARGET>_DEV_URL` short-circuits discovery and points straight at a `localhost` port:

```bash
# Run gen-ai locally, but send its MaaS calls to a maas BFF on :4000
# (see the tutorial for the full set of mock flags both BFFs need)
make run MOCK_K8S_CLIENT=true MOCK_LS_CLIENT=true BFF_MAAS_DEV_URL=http://localhost:4000/api/v1
```

## Authentication: Forward the User's Token

This is the single most important thing to get right. When BFF A calls BFF B, it forwards **the user's token from the original request** -- never its own service-account credentials. BFF B then runs its *own* auth middleware and RBAC checks against that user. No privilege escalation: BFF A can never make BFF B do something the user couldn't do themselves.

The token comes out of the `RequestIdentity` that the auth middleware already put in context (see [Authentication & RBAC](./auth)):

```go
// packages/gen-ai/bff/internal/api/middleware.go -- AttachBFFMaaSClient (trimmed)
var authToken string
if identity, ok := ctx.Value(
    constants.RequestIdentityKey,
).(*integrations.RequestIdentity); ok && identity != nil {
    authToken = identity.Token            // The USER's token -- not a service account
}
client := app.bffClientFactory.CreateClientWithHeaders(
    bffclient.BFFTargetMaaS, authToken, forwardHeaders)
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
| Production (K8s) | `true` | HTTPS with OpenShift service-serving certificates |

In the cluster, each module Service carries the `service.beta.openshift.io/serving-cert-secret-name` annotation (e.g. `maas-proxy-tls` in `manifests/modules/maas/service.yaml`); OpenShift mints a certificate for the Service DNS name, and the target BFF serves it with `--cert-file`/`--key-file` using the cluster TLS profile from `pkg/tls`. The caller trusts it because its Deployment mounts the `odh-trusted-ca-bundle` and the service CA and lists them in `--bundle-paths` (or `BUNDLE_PATHS`).

## Mock Mode: Developing One BFF at a Time

Set `MOCK_BFF_CLIENTS=true` and the factory hands back mock clients that return predefined responses without ever making an HTTP call:

```bash
make run MOCK_K8S_CLIENT=true MOCK_LS_CLIENT=true MOCK_BFF_CLIENTS=true
```

This is the inter-BFF equivalent of `jest.mock()` -- and it's what makes single-BFF and frontend development possible without spinning up every other module. Use it for isolated unit tests, frontend work, and CI.

gen-ai has one twist: with `MOCK_BFF_CLIENTS=true` **and** `BFF_MLFLOW_DEV_URL` set, it builds a `NewCompositeClientFactory` -- real HTTP for MLflow, mocks for every other target.

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
| `NOT_CONFIGURED` | Target not configured (503) |

```go
err := client.Call(ctx, "POST", "/api-keys", req, &resp)
if err != nil {
    var bffErr *bffclient.BFFClientError
    if errors.As(err, &bffErr) {           // Type-assert into the structured error
        switch bffErr.Code {
        case bffclient.ErrCodeUnauthorized:    // Map to a 401 for the browser
            app.unauthorizedResponse(w, r, err)
        case bffclient.ErrCodeServerUnavailable: // Map to a 503
            app.maasBFFUnavailableResponse(w, r)
        default:
            app.handleBFFClientError(w, r, err)
        }
        return
    }
    app.serverErrorResponse(w, r, err)     // Anything else -> 500
}
```

In practice gen-ai just calls `app.handleBFFClientError(w, r, err)` (`internal/api/errors.go`), which does that mapping for you -- and replaces 5xx messages with a generic one so upstream details don't leak to the browser.

Because every BFF uses the same error-envelope format (`{"error": {"code": "...", "message": "..."}}`), that helper can translate the target's error straight into an HTTP response for the browser.

## What About core-bff?

`core-bff` (`distributions/core-bff/`) runs on port **8943 inside the main dashboard pod** and exposes platform-level APIs -- cluster settings, connection types, serving runtimes. It is tempting to call it from a module BFF instead of re-implementing that Kubernetes code, but **no BFF does this today**: there is no `BFFTargetCoreBFF` constant, and no Go code reads any `BFF_CORE_BFF_*` variable. (The repo's own `docs/inter-bff-communication.md` still describes those variables; treat it as stale.)

If you need it, you would have to add a target to your copy of `bffclient`:

- a `BFFTargetCoreBFF` constant and a `ServiceConfigs` entry, pointing at the **main dashboard Service** (`odh-dashboard` on ODH, `rhods-dashboard` on RHOAI), port `8943`, path prefix `/api`;
- the matching flags/env vars in your `cmd/main.go`, set in your module's Deployment;
- an egress path your NetworkPolicy allows.

For local dev, core-bff's binary default port is `4000` (`--port`), not 8943 -- 8943 is the deployed port.

The browser side is a separate concern: requests to `/core-bff/api/*` reach core-bff through the `coreBff` entry in the `federation-config` ConfigMap. That entry is **generated by the dashboard-operator** (`coreBffFederationEntry` in `dashboard_federation.go`, Service name from `mainDashboardServiceName`), not hand-written. See [Core BFF architecture](/guide/core-bff/architecture) for how core-bff serves those routes and proxies the rest.

## From Concept to Keyboard

This chapter is the *mental model*. When you're ready to actually wire it up -- copy the package, add the flags, write the middleware, run two BFFs side by side, and watch a real inter-BFF call succeed -- head to the hands-on tutorial:

➡️ **[Tutorial: Inter-BFF Communication](/tutorials/inter-bff-communication)**

::: tip Key Takeaway
Inter-BFF communication is the [integrations](./integrations) pattern pointed at another BFF instead of an upstream service. The `bffclient` package gives you a one-method `Call` interface; env vars (`BFF_<TARGET>_*`) plus K8s DNS handle discovery; the user's token is forwarded so the target enforces RBAC as that user; `MOCK_BFF_CLIENTS` lets you develop in isolation; and `BFFClientError` codes give you structured failures. core-bff is not an inter-BFF target today -- it is the front door that proxies browser calls to module BFFs.
:::

::: info See Also
- [Integrations](./integrations) -- the factory-and-interface pattern this builds on
- [Authentication & RBAC](./auth) -- where `RequestIdentity` and the user token come from
- [Advanced Patterns](./advanced-patterns) -- SSE streaming and concurrent service calls
- [Modules & Federation](/guide/operator/modules-and-federation) -- the operator's `<slug>-params` ConfigMap and `InterBFFDeps`
- [Core BFF architecture](/guide/core-bff/architecture) -- the front door that proxies `/<module>/api/*`
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
- [ ] Why isn't core-bff a `BFFTarget`, and what would you need to add to call it?

</div>
