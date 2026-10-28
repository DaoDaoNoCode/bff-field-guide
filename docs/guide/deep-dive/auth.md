# Authentication & RBAC

> **The security layer** -- how the BFF verifies who you are and what you're allowed to do, enforced on every API request.

The frontend has `useUser()` to check if someone is admin. It has hooks that hide buttons from unauthorized users. Those checks control what the UI *shows*. The BFF is where that check actually matters -- it's the enforcer. Even if someone opens DevTools and calls the API directly, the BFF blocks unauthorized requests at the API level.

Think of it this way: the frontend is the friendly bouncer who suggests you might not want to go to the VIP section. The BFF is the locked door.

## Two Questions, Two Stages

Authentication in the BFF answers two questions, in order:

1. **Who are you?** -- `InjectRequestIdentity` middleware extracts the user's identity from HTTP headers
2. **What can you do?** -- `RequireAccessToService` middleware asks the Kubernetes API if the user has permission

Let's walk through both stages, starting with how the frontend sets things up.

## Authentication Methods

BFFs support up to three authentication methods, controlled by the `--auth-method` flag:

| Method | Flag Value | How It Works | Used In |
|---|---|---|---|
| **Internal** | `internal` | Reads `kubeflow-userid` and `kubeflow-groups` headers | Upstream Kubeflow deployments |
| **User Token** | `user_token` | Reads the user's token from a header | ODH and RHOAI (every deployed module BFF) |
| **Disabled** | `disabled` | Bypasses auth (behavior varies by BFF) | Local development / testing |

::: warning Binary Defaults vs. What Is Deployed
In ODH/RHOAI **every module BFF runs with `--auth-method=user_token --auth-token-header=x-forwarded-access-token`**. Those flags are set in `manifests/modules/<slug>/deployment.yaml`, so in a real cluster all BFFs read the same header the same way.

The table below is only what each binary falls back to when you `go run` it locally without those flags:

| BFF | Binary Default (local `go run`) | Default Token Header | Methods Accepted |
|---|---|---|---|
| **gen-ai** | `user_token` | `x-forwarded-access-token` | `user_token`, `disabled` |
| **core-bff** | `user_token` | `x-forwarded-access-token` | `user_token`, `disabled` |
| **automl** / **autorag** | `user_token` | `Authorization` | `user_token`, `internal`, `disabled` |
| **mlflow** | `user_token` | `Authorization` | `user_token`, `disabled` |
| **maas** | `internal` | `x-forwarded-access-token` | `internal`, `user_token` (no `disabled`) |
| **eval-hub** | `internal` | `Authorization` | `internal`, `user_token` |
| **agent-ops** | `internal` | `Authorization` | `internal`, `user_token`, `disabled` |
| **data-connect-hub** | `user_token` | `Authorization` | `internal`, `user_token` |
| **data-registry** | `user_token` | `Authorization` | `user_token` |

Always check the specific BFF's `cmd/main.go` before relying on a default -- and remember that a mismatch between your local flags and the manifest is a common source of "works locally, 401 in the cluster".
:::

### Internal Auth (Kubeflow Headers)

In upstream Kubeflow-style deployments, an auth proxy (like Istio or oauth2-proxy) sits in front of the BFF. The proxy authenticates the user and forwards their identity via HTTP headers:

```
kubeflow-userid: alice@example.com
kubeflow-groups: system:authenticated,team-alpha
```

The BFF reads these headers and trusts them because the proxy has already verified the user. This is similar to how many Node.js apps trust `X-Forwarded-User` headers from a reverse proxy. ODH/RHOAI does not use this mode for module BFFs.

### User Token Auth (Forwarded Token)

In ODH/RHOAI, the OpenShift auth proxy in front of the dashboard forwards the user's OpenShift token on every request. All deployed BFFs read it from the same header:

```
x-forwarded-access-token: sha256~abc123...
```

When you run a BFF locally with its binary default, it may expect `Authorization: Bearer sha256~abc123...` instead (see the table above). Pass `--auth-token-header=x-forwarded-access-token` to match the cluster.

The BFF uses this token to create a Kubernetes client that operates *as the user*. Every K8s API call the BFF makes is scoped to that user's permissions. This is the more secure approach -- the BFF never has more power than the user.


## The RequestIdentity Struct

::: warning RequestIdentity Differs Between BFFs
The `RequestIdentity` struct differs between BFFs. automl and autorag use the shared one from `packages/autox-core/services/kubernetes/models.go`; maas, mlflow, eval-hub and core-bff each have their own in `internal/integrations/kubernetes/types.go`. These store `UserID`, `Groups`, and `Token`. The gen-ai BFF's `*integrations.RequestIdentity` (`internal/integrations/types.go`) only stores `Token` and `MCPToken`. Check your specific BFF before relying on a field.
:::

Both auth methods produce a data structure that flows through the request. Here is the three-field shape (autox-core, maas):

```go
// autox-core / maas shape -- gen-ai only has Token and MCPToken
type RequestIdentity struct {                      // Holds the authenticated user's info
    UserID string                                  // Who they are (email or username)
    Groups []string                                // What groups they belong to
    Token  string                                  // Their auth token (if using user_token auth)
}
```

| Field | Internal Auth | User Token Auth |
|---|---|---|
| `UserID` | From `kubeflow-userid` header | Empty -- the K8s API server resolves the user from the token |
| `Groups` | From `kubeflow-groups` header (comma-separated) | Empty |
| `Token` | Empty (BFF uses its service account) | The token itself |

**TypeScript equivalent:**

```typescript
// autox-core / maas shape -- gen-ai differs
interface RequestIdentity {                        // Same shape, TypeScript style
  userId: string;                                  // Who they are
  groups: string[];                                // Their groups
  token: string;                                   // Their token (if applicable)
}
```

## Stage 1: InjectRequestIdentity -- Who Are You?

This middleware runs on every API request. It's wired in `Routes()`. Let's walk through it:

**Express version first:**

```typescript
function injectRequestIdentity(                    // Express middleware
  req: Request,                                    // Request
  res: Response,                                   // Response
  next: NextFunction,                              // Next handler
) {
  if (config.authMethod === 'internal') {          // Kubeflow mode
    const userId = req.headers['kubeflow-userid'] as string;
    if (!userId) {                                 // Check for header
      return res.status(400).json({ error: 'Missing user ID' });
    }
    req.user = {                                   // Attach identity to request
      userId,
      groups: (req.headers['kubeflow-groups'] as string || '').split(',').map(g => g.trim()),
    };
  } else if (config.authMethod === 'disabled') {   // Dev mode
    req.user = { userId: 'user@example.com', groups: ['system:masters'] };
  } else {                                         // Token mode
    const token = req.headers['x-forwarded-access-token'] as string;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    req.user = { token };
  }
  next();                                          // Continue
}
```

**Go version (automl/autorag, via autox-core):**

automl and autorag don't hand-write this middleware any more. They pick an `IdentityExtractor` for the auth method and hand it to the generic `InjectRequestIdentity` from `packages/autox-core/services/kubernetes/middleware.go`:

```go
// packages/automl/bff/internal/api/app.go -- Routes() (trimmed)
var identityExtractor kubernetes.IdentityExtractor  // One interface, three implementations
switch app.config.AuthMethod {
case config.AuthMethodDisabled:
    identityExtractor = &fake.IdentityExtractor{}  // Always returns fake-user@example.com
case config.AuthMethodInternal:
    identityExtractor = &kubernetes.KubeflowHeaderExtractor{
        UserIDHeader:     constants.KubeflowUserIDHeader,
        UserGroupsHeader: constants.KubeflowUserGroupsIdHeader,
    }
case config.AuthMethodUser:
    identityExtractor = &kubernetes.TokenHeaderExtractor{
        Header: app.config.AuthTokenHeader,         // x-forwarded-access-token in the cluster
        Prefix: app.config.AuthTokenPrefix,
    }
}

injectRequestIdentity := kubernetes.InjectRequestIdentity(kubernetes.InjectRequestIdentityConfig{
    Extractor: identityExtractor,
    OnError: func(w http.ResponseWriter, r *http.Request, err error) {
        badRequestResponse(app.logger, w, r, err.Error()) // 400 if extraction fails
    },
    ContextKey: constants.RequestIdentityKey,       // Legacy key, kept for older code
})

// Only the API routes are wrapped -- static files and /healthcheck stay public
authedAPI := injectRequestIdentity(preserveRawPath(apiRouter))
appMux.Handle(ApiPathPrefix+"/", authedAPI)
appMux.Handle(PathPrefix+ApiPathPrefix+"/", http.StripPrefix(PathPrefix, authedAPI))
```

And the generic middleware itself:

```go
// packages/autox-core/services/kubernetes/middleware.go (trimmed)
func InjectRequestIdentity(cfg InjectRequestIdentityConfig) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            identity, err := cfg.Extractor.Extract(r.Header) // Who are you?
            if err != nil {
                if cfg.OnError != nil {
                    cfg.OnError(w, r, err)          // BFF-specific error response
                } else {
                    http.Error(w, "authentication required", http.StatusUnauthorized)
                }
                return                              // Stop! No identity = no access
            }

            ctx := ContextWithIdentity(r.Context(), identity) // Like req.user = identity
            if cfg.ContextKey != nil {
                ctx = context.WithValue(ctx, cfg.ContextKey, identity)
            }
            next.ServeHTTP(w, r.WithContext(ctx))   // Continue with identity in context
        })
    }
}
```

**The gen-ai version** is a method on `App` that checks the path prefix itself, skips extraction entirely when auth is disabled, and returns 401 (not 400) on failure:

```go
// packages/gen-ai/bff/internal/api/middleware.go (trimmed)
func (app *App) InjectRequestIdentity(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        isAPIPath := strings.HasPrefix(r.URL.Path, app.config.APIPathPrefix) ||
            strings.HasPrefix(r.URL.Path, constants.PathPrefix+app.config.APIPathPrefix)
        if !isAPIPath {                             // /healthcheck, static files
            next.ServeHTTP(w, r)
            return
        }
        if app.config.AuthMethod == config.AuthMethodDisabled {
            next.ServeHTTP(w, r)                    // No identity at all
            return
        }
        identity, err := app.kubernetesClientFactory.ExtractRequestIdentity(r.Header)
        if err != nil {
            app.unauthorizedResponse(w, r, err)     // 401
            return
        }
        ctx := context.WithValue(r.Context(), constants.RequestIdentityKey, identity)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

This is the first gate. Every API request must pass through here. If auth is enabled, the identity must be extractable from headers or the request is rejected.

::: warning Disabled Auth Behavior Varies
When `--auth-method=disabled`:
- **automl/autorag**: The `fake.IdentityExtractor` attaches `UserID: "fake-user@example.com"`, `Groups: ["system:masters"]`, and `RequireAccessToService` skips the SSAR. automl also switches to `disabled` automatically when you run with `--dev-mode` and any mock client flag.
- **gen-ai**: Simply passes the request through with no identity extraction. There is no fake admin identity created.
- **maas**: Has no `disabled` mode at all -- only `internal` and `user_token`.

Always check the specific BFF's `Routes()` and `cmd/main.go`.
:::

### How the Extractors Work

For **internal auth** (Kubeflow headers):

```go
// packages/autox-core/services/kubernetes/identity_extractor.go
func (e *KubeflowHeaderExtractor) Extract(headers http.Header) (*RequestIdentity, error) {
    userID := headers.Get(e.UserIDHeader)           // Read the user ID header
    if userID == "" {
        return nil, fmt.Errorf("missing required header: %s", e.UserIDHeader)
    }

    groups := []string{}                            // Start with empty slice
    if g := headers.Get(e.UserGroupsHeader); g != "" {
        for _, group := range strings.Split(g, ",") { // Split on commas
            groups = append(groups, strings.TrimSpace(group))
        }
    }

    return &RequestIdentity{UserID: userID, Groups: groups}, nil
}
```

For **user token auth**:

```go
// packages/autox-core/services/kubernetes/identity_extractor.go (trimmed)
func (e *TokenHeaderExtractor) Extract(headers http.Header) (*RequestIdentity, error) {
    raw := headers.Get(e.Header)                    // e.g. x-forwarded-access-token
    if raw == "" {
        return nil, fmt.Errorf("missing required header: %s", e.Header)
    }

    token := raw
    if e.Prefix != "" {                             // e.g. "Bearer "
        if !strings.HasPrefix(raw, e.Prefix) {
            return nil, fmt.Errorf("expected token header %s to start with prefix %q", e.Header, e.Prefix)
        }
        token = strings.TrimPrefix(raw, e.Prefix)
    }

    token = strings.TrimSpace(token)
    if token == "" {
        return nil, fmt.Errorf("token in header %s is empty after stripping prefix", e.Header)
    }
    return &RequestIdentity{Token: token}, nil      // Store the raw token
}
```

gen-ai does the same job in `TokenClientFactory.ExtractRequestIdentity` (`internal/integrations/kubernetes/factory.go`, built by `NewTokenClientFactory`), with one extra: if the configured header is missing it falls back to `Authorization: Bearer ...`, which is how OGX's passthrough provider calls it back.

Internal auth reads explicit headers and builds an identity from them. Token auth just extracts the raw token -- the token itself carries the user's identity, and the K8s API server will validate it when we make API calls.

::: info Checkpoint
Stage 1 is complete: we know *who* the user is. Their identity is in the request context. Now for stage 2: checking *what* they can do.
:::

## Stage 2: SelfSubjectAccessReview (SSAR) -- Can This User Do X?

After we know *who* the user is, we need to check *what they can do*. This is where access reviews come in.

A SubjectAccessReview is a Kubernetes API call that asks: "Can user X perform action Y on resource Z in namespace N?" A **Self**SubjectAccessReview asks the same question about whoever is making the call: "Can *I* do Y?" The K8s API server checks its RBAC policies and returns `allowed: true` or `allowed: false`.

**Why do we need this if the BFF uses the user's token?** For direct K8s API calls, K8s enforces its own RBAC -- the user's token would be rejected if they lack permission. But the BFF also forwards requests to upstream services like LlamaStack, Pipelines and MLflow. These services accept the user's token for authentication but do not check K8s namespace-level RBAC. The BFF is the enforcement point -- it asks K8s "is this user allowed?" before forwarding the request to an upstream service that cannot answer that question itself.

Here's how the shared autox-core K8s client performs the check (automl and autorag use it):

```go
// packages/autox-core/services/kubernetes/client_base.go
func (c *baseClient) CanAccessResource(
    ctx context.Context,                            // Request context (carries the identity)
    namespace, verb, group, resource, name string,  // What to ask about
) (bool, error) {
    timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()

    ssar := &authorizationv1.SelfSubjectAccessReview{ // "Can I ...?"
        Spec: authorizationv1.SelfSubjectAccessReviewSpec{
            ResourceAttributes: &authorizationv1.ResourceAttributes{
                Verb:      verb,                    // e.g. "list"
                Group:     group,                   // e.g. "datasciencepipelinesapplications.opendatahub.io"
                Resource:  resource,                // e.g. "datasciencepipelinesapplications"
                Namespace: namespace,               // e.g. "my-project"
                Name:      name,                    // "" = any object of that type
            },
        },
    }

    resp, err := c.Clientset.AuthorizationV1().SelfSubjectAccessReviews().Create(
        timeoutCtx, ssar, metav1.CreateOptions{},   // Standard K8s API call
    )
    if err != nil {
        return false, err
    }
    return resp.Status.Allowed, nil                 // The answer: true or false
}
```

**What just happened?** In plain English, this asks: "Can **I** (the user whose token this client carries) **list** `datasciencepipelinesapplications` in namespace `my-project`?" The K8s API server checks its RBAC rules and returns yes or no.

gen-ai has the same shape with a fixed resource: `CanListOGXServers` (`internal/integrations/kubernetes/token_k8s_client.go`) builds an SSAR for `list` on `ogxservers` in group `ogx.io`, using a clientset created from the user's token.

Notice that the check is **resource-specific** -- it asks about a particular resource type, not "can this user access the namespace in general." This distinction matters. A user might have permission to access MLflow prompts in a namespace but not pipeline applications. As the dashboard evolves (e.g., shared namespaces where users have narrow, per-resource permissions), the checks for each service path will need to match the specific resources that service uses.

**The frontend equivalent:** On the frontend, you might check `isAdmin` or use a custom hook to determine what to show. But those checks are *informational* -- they control the UI. The BFF's access check is *authoritative* -- it blocks the request at the API level.

```typescript
// Frontend: controls what the UI shows (advisory)
const { isAdmin } = useUser();                     // Check user role
if (isAdmin) {                                     // Show admin panel if admin
  return <AdminPanel />;                           // UI-level gate
}

// BFF: controls what the API allows (enforced)
// If the SSAR returns false, the handler NEVER runs // API-level gate
// The user gets 403 Forbidden, no data returned   // No workaround possible
```

### SAR vs. SSAR

```go
// SAR:  "Can user X do Y?" -- BFF asks with its own service account, naming the user
// SSAR: "Can I do Y?"      -- BFF asks with the user's own credentials
```

Under `user_token` -- which is what every deployed BFF runs -- the checks are SSARs sent with the user's token. autox-core's `internal` mode still sends SSARs: its client uses the service account plus impersonation headers built from `kubeflow-userid`/`kubeflow-groups`, so the API server evaluates the impersonated user. Classic SARs with `User`/`Groups` filled in survive in a few `internal` code paths (model-registry's `internal_k8s_client.go`, for example), which only matter outside ODH/RHOAI.

## The RequireAccessToService Middleware

This middleware puts both stages together. It reads the namespace from context, performs the SSAR, and blocks unauthorized requests. Here is automl's, which lives on the `Middleware` struct (`app.mw`) rather than on `App`:

```go
// packages/automl/bff/internal/api/middleware.go (trimmed)
func (mw *Middleware) RequireAccessToService(
    next func(http.ResponseWriter, *http.Request, httprouter.Params),
) httprouter.Handle {
    return func(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
        if mw.config.AuthMethod == config.AuthMethodDisabled { // Dev mode bypass
            next(w, r, ps)
            return
        }

        ctx := r.Context()
        namespace, ok := ctx.Value(constants.NamespaceHeaderParameterKey).(string) // Set by AttachNamespace
        if !ok || namespace == "" {
            badRequestResponse(mw.logger, w, r,
                "missing namespace in context - ensure AttachNamespace middleware is used first")
            return
        }

        // The identity is already in ctx; the k8s service reads it from there
        allowed, err := mw.k8sService.CanAccessResource(ctx, namespace, "list",
            "datasciencepipelinesapplications.opendatahub.io", "datasciencepipelinesapplications", "")
        if err != nil {
            switch {
            case errors.Is(err, kubernetes.ErrUnauthorized):
                unauthorizedResponse(mw.logger, w, r, "access unauthorized")
            case errors.Is(err, kubernetes.ErrForbidden):
                forbiddenResponse(mw.logger, w, r, "insufficient permissions to check service access")
            default:
                serverErrorResponse(mw.logger, w, r, fmt.Errorf("failed to check permissions: %w", err))
            }
            return
        }

        if !allowed {                               // Permission denied
            forbiddenResponse(mw.logger, w, r,
                "user does not have permission to access pipeline servers in this namespace")
            return                                  // Stop -- handler NEVER runs
        }

        next(w, r, ps)                              // Authorized -- proceed
    }
}
```

gen-ai's `RequireAccessToService` (`internal/api/middleware.go`) is the same idea as a method on `App`: it reads `*integrations.RequestIdentity` from context, calls `ValidateRequestIdentity`, gets a client from `kubernetesClientFactory.GetClient(ctx)` and calls `CanListOGXServers`.

**What just happened?** This is the locked door. If the SSAR returns `false`, the handler never runs and the user gets a 403. There's no way around it -- not from DevTools, not from curl, not from any client.

## The Complete Auth Flow

Here's the full journey of an authenticated request, from browser to response:

```
Browser                    BFF                         Kubernetes API
  |                         |                               |
  |  GET /api/v1/pipeline-runs                               |
  |  x-forwarded-access-token: sha256~alice                 |
  |------------------------>|                               |
  |                         |                               |
  |                    InjectRequestIdentity                 |
  |                    identity = {                          |
  |                      Token: "sha256~alice"               |
  |                    }                                     |
  |                         |                               |
  |                    AttachNamespace                       |
  |                    namespace = "my-project"              |
  |                         |                               |
  |                    RequireAccessToService                |
  |                         | SelfSubjectAccessReview       |
  |                         |  (as alice's token)           |
  |                         |  verb: list                   |
  |                         |  namespace: my-project        |
  |                         |------------------------------>|
  |                         |         allowed: true         |
  |                         |<------------------------------|
  |                         |                               |
  |                    Handler executes                     |
  |                         | List pipeline runs            |
  |                         |------------------------------>|
  |                         |       [run1, run2, ...]       |
  |                         |<------------------------------|
  |                         |                               |
  |  200 OK                 |                               |
  |  { "data": [...] }      |                               |
  |<------------------------|                               |
```

And when access is denied:

```
Browser                    BFF                         Kubernetes API
  |                         |                               |
  |  GET /api/v1/pipeline-runs                               |
  |  x-forwarded-access-token: sha256~bob                   |
  |------------------------>|                               |
  |                         |                               |
  |                    InjectRequestIdentity                 |
  |                    identity = { Token: "sha256~bob" }    |
  |                         |                               |
  |                    RequireAccessToService                |
  |                         | SelfSubjectAccessReview       |
  |                         |  (as bob's token)             |
  |                         |  verb: list                   |
  |                         |  namespace: my-project        |
  |                         |------------------------------>|
  |                         |         allowed: false        |
  |                         |<------------------------------|
  |                         |                               |
  |  403 Forbidden          |  (handler never runs)         |
  |  { "error": {...} }     |                               |
  |<------------------------|                               |
```

## Mock Auth -- The Development Shortcuts

When running with mock flags, auth checks are simplified:

| Scenario | What Happens |
|---|---|
| `--auth-method disabled` (automl/autorag) | Fake identity used: `fake-user@example.com` with `system:masters` group. Access checks skipped. automl does this automatically with `--dev-mode` plus any mock flag. |
| `--auth-method disabled` (gen-ai) | Request passes through with no identity extraction. No mock admin identity is created. |
| `--auth-method disabled` (maas) | Not supported -- maas only accepts `internal` and `user_token`. |
| `--auth-method user_token --mock-k8s-client` | Real token extraction, but the K8s client is a mock (envtest in gen-ai/maas, a fake client in automl) -- which typically allows everything. |

For Cypress tests and local development, a mock K8s client plus either `disabled` or `user_token` is the typical combination (gen-ai: `--mock-k8s-client --auth-method=disabled`; automl: `--dev-mode --mock-k8s-client`). This gives you a fully functional BFF without any real cluster or authentication.

::: warning Security Note
The `disabled` auth method and `mock-k8s-client` flag are for development and testing ONLY. In production, the BFF always runs with real auth and real K8s clients. The container Dockerfile and Kubernetes deployment manifests do not set these flags.
:::

::: tip Key Takeaway
Authentication happens in two stages: `InjectRequestIdentity` extracts *who* the user is (from headers or token), and `RequireAccessToService` checks *what* they can do (via a SelfSubjectAccessReview against the K8s API). The frontend's `isAdmin` check controls the UI; the BFF's access check enforces the actual security boundary. Mock flags bypass these checks for development, but production always runs with `user_token` and `x-forwarded-access-token`.
:::

::: info See Also
- [Middleware Chain](./middleware) -- how auth middleware fits into the request pipeline
- [Integrations](./integrations) -- how the K8s client is built per request
- [Entry Point (main.go)](./entry-point) -- the `--auth-method` and `--mock-k8s-client` flags
:::
