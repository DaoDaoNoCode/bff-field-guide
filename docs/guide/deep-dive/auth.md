# Authentication & RBAC

> **The security layer** -- how the BFF verifies who you are and what you're allowed to do, enforced on every API request.

The frontend has `useUser()` to check if someone is admin. It has hooks that hide buttons from unauthorized users. Those checks control what the UI *shows*. The BFF is where that check actually matters -- it's the enforcer. Even if someone opens DevTools and calls the API directly, the BFF blocks unauthorized requests at the API level.

Think of it this way: the frontend is the friendly bouncer who suggests you might not want to go to the VIP section. The BFF is the locked door.

## Two Questions, Two Stages

Authentication in the BFF answers two questions, in order:

1. **Who are you?** -- `InjectRequestIdentity` middleware extracts the user's identity from HTTP headers
2. **What can you do?** -- `RequireAccess` middleware asks the Kubernetes API if the user has permission

Let's walk through both stages, starting with how the frontend sets things up.

## Authentication Methods

BFFs support up to three authentication methods, controlled by the `--auth-method` flag:

| Method | Flag Value | How It Works | Used In |
|---|---|---|---|
| **Internal** | `internal` | Reads `kubeflow-userid` and `kubeflow-groups` headers | ODH / Kubeflow deployments |
| **User Token** | `user_token` | Reads `Authorization: Bearer <token>` header | RHOAI deployments |
| **Disabled** | `disabled` | Bypasses auth (behavior varies by BFF) | Local development / testing |

::: warning Not All BFFs Support All Auth Methods
Not all BFFs support all three auth methods:
- **gen-ai, eval-hub**: `user_token` and `disabled` only (no `internal`)
- **maas**: `internal` and `user_token` only (no `disabled`)
- **automl, autorag**: all three (`internal`, `user_token`, `disabled`)
- **mlflow, model-registry**: check each BFF's `cmd/main.go` for the current list

The default also varies: gen-ai defaults to `user_token`, while automl/maas/autorag default to `internal`. Always check the specific BFF's `main.go`.
:::

### Internal Auth (Kubeflow Headers)

In ODH/Kubeflow deployments, an auth proxy (like Istio or oauth2-proxy) sits in front of the BFF. The proxy authenticates the user and forwards their identity via HTTP headers:

```
kubeflow-userid: alice@example.com
kubeflow-groups: system:authenticated,team-alpha
```

The BFF reads these headers and trusts them because the proxy has already verified the user. This is similar to how many Node.js apps trust `X-Forwarded-User` headers from a reverse proxy.

### User Token Auth (Bearer Token)

In RHOAI deployments, the frontend sends the user's OpenShift token directly:

```
Authorization: Bearer sha256~abc123...
```

The BFF uses this token to create a Kubernetes client that operates *as the user*. Every K8s API call the BFF makes is scoped to that user's permissions. This is the more secure approach -- the BFF never has more power than the user.

## The RequestIdentity Struct

::: warning RequestIdentity Differs Between BFFs
The `RequestIdentity` struct differs between BFFs. The automl/maas BFFs store `UserID`, `Groups`, and `Token`. The gen-ai BFF only stores `Token` and `MCPToken`. The example below uses the automl/maas pattern -- check your specific BFF's `internal/integrations/kubernetes/types.go` for the actual fields.
:::

Both auth methods produce a data structure that flows through the request. Here is the automl/maas pattern:

```go
// automl/maas pattern -- gen-ai BFF only has Token and MCPToken
type RequestIdentity struct {                      // Holds the authenticated user's info
    UserID string                                  // Who they are (email or username)
    Groups []string                                // What groups they belong to
    Token  string                                  // Their auth token (if using user_token auth)
}
```

| Field | Internal Auth | User Token Auth |
|---|---|---|
| `UserID` | From `kubeflow-userid` header | Extracted from token claims |
| `Groups` | From `kubeflow-groups` header (comma-separated) | From token claims |
| `Token` | Empty (BFF uses service account) | The Bearer token itself |

**TypeScript equivalent:**

```typescript
// automl/maas pattern -- gen-ai BFF differs
interface RequestIdentity {                        // Same shape, TypeScript style
  userId: string;                                  // Who they are
  groups: string[];                                // Their groups
  token: string;                                   // Their token (if applicable)
}
```

## Stage 1: InjectRequestIdentity -- Who Are You?

This middleware runs on every API request. It's set up as global middleware in `Routes()`. Let's walk through it:

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
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing token' });
    req.user = { token };
  }
  next();                                          // Continue
}
```

**Go version (automl/maas pattern):**

```go
// automl/maas pattern -- gen-ai BFF differs (see note below)
func (app *App) InjectRequestIdentity(             // Global middleware
    next http.Handler,                             // The next handler in the chain
) http.Handler {                                   // Returns a wrapped handler
    return http.HandlerFunc(func(                   // Create the wrapper function
        w http.ResponseWriter,                     // Response writer
        r *http.Request,                           // Request
    ) {
        // Skip auth for non-API routes (health check, static files)
        if !strings.HasPrefix(r.URL.Path, "/api/v1") { // Only protect API routes
            next.ServeHTTP(w, r)                   // Pass through without auth
            return                                 // Done
        }

        var identity *kubernetes.RequestIdentity   // Will hold the user's identity

        if app.config.AuthMethod == config.AuthMethodDisabled { // Dev mode
            identity = &kubernetes.RequestIdentity{ // Create a fake admin identity
                UserID: "user@example.com",        // Mock user
                Groups: []string{"system:masters"},// Full admin permissions
            }
        } else {                                   // Production mode (internal or user_token)
            var err error                          // Declare error variable
            identity, err = app.kubernetesClientFactory.ExtractRequestIdentity(
                r.Header,                          // Extract identity from request headers
            )
            if err != nil {                        // Extraction failed
                app.badRequestResponse(w, r, err)  // Send 400 error
                return                             // Stop! No identity = no access
            }
        }

        // Attach identity to request context (like req.user = identity)
        ctx := context.WithValue(                  // Create new context with identity
            r.Context(),                           // Start from existing context
            constants.RequestIdentityKey,           // The key constant
            identity,                              // The identity struct
        )
        next.ServeHTTP(w, r.WithContext(ctx))      // Continue with identity in context
    })
}
```

**What just happened?** This is the first gate. Every API request must pass through here. If auth is disabled (dev mode), the request passes through with a mock or empty identity. If auth is enabled, the identity must be extractable from headers or the request is rejected.

::: warning Disabled Auth Behavior Varies
When `--auth-method=disabled`:
- **automl/maas**: Creates a mock admin identity (`UserID: "user@example.com"`, `Groups: ["system:masters"]`). All SAR checks are also skipped.
- **gen-ai**: Simply passes the request through with no identity extraction. There is no fake admin identity created.

Always check the specific BFF's `InjectRequestIdentity` implementation.
:::

### How ExtractRequestIdentity Works

For **internal auth** (Kubeflow headers):

```go
func (f *StaticClientFactory) ExtractRequestIdentity( // Internal auth extraction
    httpHeader http.Header,                        // The request headers
) (*RequestIdentity, error) {                      // Returns identity or error
    userID := httpHeader.Get("kubeflow-userid")     // Read the user ID header
    if userID == "" {                              // Check if it's present
        return nil, errors.New(                    // Return error if missing
            "missing required kubeflow-userid header")
    }

    userGroupsHeader := httpHeader.Get("kubeflow-groups") // Read the groups header
    groups := []string{}                           // Start with empty slice
    if userGroupsHeader != "" {                    // If groups header exists
        for _, g := range strings.Split(           // Split on commas
            userGroupsHeader, ",") {
            groups = append(groups,                // Add each trimmed group
                strings.TrimSpace(g))
        }
    }

    return &RequestIdentity{                       // Return the identity struct
        UserID: userID,                            // User from header
        Groups: groups,                            // Groups from header
    }, nil                                         // No error
}
```

For **user token auth** (Bearer token):

```go
func (f *TokenClientFactory) ExtractRequestIdentity( // Token auth extraction
    httpHeader http.Header,                        // The request headers
) (*RequestIdentity, error) {                      // Returns identity or error
    authHeader := httpHeader.Get(f.tokenHeader)     // Read the auth header (usually "Authorization")
    if authHeader == "" {                          // Check if it's present
        return nil, errors.New(                    // Return error if missing
            "missing authorization header")
    }

    token := strings.TrimPrefix(                   // Remove the "Bearer " prefix
        authHeader, f.tokenPrefix)                 // Left with just the token string

    return &RequestIdentity{                       // Return the identity struct
        Token: token,                              // Store the raw token
    }, nil                                         // No error
}
```

**What just happened?** Internal auth reads explicit headers and builds an identity from them. Token auth just extracts the raw token -- the token itself carries the user's identity, and the K8s API server will validate it when we make API calls.

::: info Checkpoint
Stage 1 is complete: we know *who* the user is. Their identity is in the request context. Now for stage 2: checking *what* they can do.
:::

## Stage 2: SubjectAccessReview (SAR) -- Can This User Do X?

After we know *who* the user is, we need to check *what they can do*. This is where SubjectAccessReview comes in.

A SubjectAccessReview is a Kubernetes API call that asks: "Can user X perform action Y on resource Z in namespace N?" The K8s API server checks its RBAC policies and returns `allowed: true` or `allowed: false`.

**Why do we need this if the BFF uses the user's token?** For direct K8s API calls, K8s enforces its own RBAC -- the user's token would be rejected if they lack permission. But the BFF also forwards requests to upstream services like LlamaStack and MLflow. These services accept the user's token for authentication but do not check K8s namespace-level RBAC. The BFF is the enforcement point -- it asks K8s "is this user allowed?" before forwarding the request to an upstream service that cannot answer that question itself.

Here's how the K8s client performs the check:

```go
func (client *K8sClient) CanListDSPipelineApplications( // RBAC check method
    ctx context.Context,                           // Request context
    identity *RequestIdentity,                     // The user to check
    namespace string,                              // The namespace to check access in
) (bool, error) {                                  // Returns allowed (bool) or error
    // Build the review request
    review := &authv1.SubjectAccessReview{         // Create a SAR request object
        Spec: authv1.SubjectAccessReviewSpec{      // The specification of what to check
            User:   identity.UserID,               // Who: "alice@example.com"
            Groups: identity.Groups,               // Groups: ["team-alpha"]
            ResourceAttributes: &authv1.ResourceAttributes{ // What they want to do
                Namespace: namespace,              // Where: "my-project"
                Verb:      "list",                 // Action: "list" (could be get, create, delete)
                Group:     "datasciencepipelinesapplications.opendatahub.io", // K8s API group
                Resource:  "datasciencepipelinesapplications", // K8s resource type
            },
        },
    }

    // Ask the K8s API server
    result, err := client.authClient.SubjectAccessReviews().Create( // Send the SAR request
        ctx, review, metav1.CreateOptions{},       // Standard K8s API call
    )
    if err != nil {                                // Check for API errors
        return false, err                          // Return the error
    }

    return result.Status.Allowed, nil              // Return the answer: true or false
}
```

**What just happened?** In plain English, this asks: "Can `alice@example.com` (member of `team-alpha`) **list** `datasciencepipelinesapplications` in namespace `my-project`?" The K8s API server checks its RBAC rules and returns yes or no.

Notice that the check is **resource-specific** -- it asks about a particular resource type, not "can this user access the namespace in general." This distinction matters. A user might have permission to access MLflow prompts in a namespace but not pipeline applications. As the dashboard evolves (e.g., shared namespaces where users have narrow, per-resource permissions), the SAR checks for each service path will need to match the specific resources that service uses.

**The frontend equivalent:** On the frontend, you might check `isAdmin` or use a custom hook to determine what to show. But those checks are *informational* -- they control the UI. The BFF's SAR check is *authoritative* -- it blocks the request at the API level.

```typescript
// Frontend: controls what the UI shows (advisory)
const { isAdmin } = useUser();                     // Check user role
if (isAdmin) {                                     // Show admin panel if admin
  return <AdminPanel />;                           // UI-level gate
}

// BFF: controls what the API allows (enforced)
// If SAR returns false, the handler NEVER runs     // API-level gate
// The user gets 403 Forbidden, no data returned   // No workaround possible
```

### SelfSubjectAccessReview (SSAR)

There's a variant called SelfSubjectAccessReview. The difference is subtle but important:

```go
// SAR: "Can user X do Y?" -- BFF uses its service account to ask
// SSAR: "Can I do Y?" -- BFF uses the user's own token to ask
```

SAR is used when the BFF has its own service account (internal auth). SSAR is used when the BFF operates with the user's token (user_token auth). The practical result is the same -- we find out if the user is allowed.

## The RequireAccess Middleware

This middleware puts both stages together. It reads the identity from context, performs the SAR check, and blocks unauthorized requests:

```go
func (app *App) RequireAccessToPipelineServers(    // Route-level middleware
    next func(http.ResponseWriter, *http.Request, httprouter.Params),
) httprouter.Handle {                              // Returns a wrapped handler
    return func(                                   // The wrapper function
        w http.ResponseWriter,
        r *http.Request,
        ps httprouter.Params,
    ) {
        // Skip RBAC checks when auth is disabled (dev mode)
        if app.config.AuthMethod == config.AuthMethodDisabled { // Dev mode bypass
            next(w, r, ps)                         // Skip check entirely
            return                                 // Done
        }

        ctx := r.Context()                         // Get context (has namespace and identity)

        // Get namespace (set by AttachNamespace middleware in step 5)
        namespace, ok := ctx.Value(                // Read namespace from context
            constants.NamespaceQueryParameterKey,
        ).(string)
        if !ok || namespace == "" {                // Check if it was set
            app.badRequestResponse(w, r,           // Send 400 if missing
                fmt.Errorf("missing namespace"))
            return                                 // Stop
        }

        // Get user identity (set by InjectRequestIdentity middleware in step 4)
        identity, ok := ctx.Value(                 // Read identity from context
            constants.RequestIdentityKey,
        ).(*kubernetes.RequestIdentity)
        if !ok || identity == nil {                // Check if it was set
            app.badRequestResponse(w, r,           // Send 400 if missing
                fmt.Errorf("missing identity"))
            return                                 // Stop
        }

        // Get K8s client to perform the SAR check
        client, err := app.kubernetesClientFactory.GetClient(ctx) // Create/get K8s client
        if err != nil {                            // Check for client failure
            app.serverErrorResponse(w, r, err)     // Send 500
            return                                 // Stop
        }

        // Perform the SubjectAccessReview -- the actual permission check
        allowed, err := client.CanListDSPipelineApplications( // Ask K8s
            ctx, identity, namespace,              // Pass user and namespace
        )
        if err != nil {                            // Check for SAR failure
            app.serverErrorResponse(w, r, err)     // Send 500
            return                                 // Stop
        }

        // Block if not allowed
        if !allowed {                              // Permission denied
            app.forbiddenResponse(w, r,            // Send 403 Forbidden
                "user does not have permission in this namespace")
            return                                 // Stop -- handler NEVER runs
        }

        // User is authorized -- continue to the handler
        next(w, r, ps)                             // Proceed
    }
}
```

**What just happened?** This is the locked door. If the SAR check returns `false`, the handler never runs and the user gets a 403. There's no way around it -- not from DevTools, not from curl, not from any client.

## The Complete Auth Flow

Here's the full journey of an authenticated request, from browser to response:

```
Browser                    BFF                         Kubernetes API
  |                         |                               |
  |  GET /api/v1/runs       |                               |
  |  kubeflow-userid: alice  |                               |
  |  kubeflow-groups: devs   |                               |
  |------------------------>|                               |
  |                         |                               |
  |                    InjectRequestIdentity                 |
  |                    identity = {                          |
  |                      UserID: "alice",                    |
  |                      Groups: ["devs"]                    |
  |                    }                                     |
  |                         |                               |
  |                    AttachNamespace                       |
  |                    namespace = "my-project"              |
  |                         |                               |
  |                    RequireAccess                         |
  |                         | SubjectAccessReview           |
  |                         |  user: alice                  |
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
  |  GET /api/v1/runs       |                               |
  |  kubeflow-userid: bob    |                               |
  |------------------------>|                               |
  |                         |                               |
  |                    InjectRequestIdentity                 |
  |                    identity = { UserID: "bob" }          |
  |                         |                               |
  |                    RequireAccess                         |
  |                         | SubjectAccessReview           |
  |                         |  user: bob                    |
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
| `--auth-method disabled` (automl/maas) | Mock identity used: `user@example.com` with `system:masters` group. All SAR checks skipped. |
| `--auth-method disabled` (gen-ai) | Request passes through with no identity extraction. No mock admin identity is created. |
| `--auth-method internal --mock-k8s-client` | Real identity extraction from headers, but SAR checks go to mock K8s (envtest) -- which typically allows everything. |
| `--auth-method user_token --mock-k8s-client` | Real token extraction, but K8s client uses envtest. |

For Cypress tests and local development, `--auth-method disabled --mock-k8s-client` is the typical combination. This gives you a fully functional BFF without any real cluster or authentication.

::: warning Security Note
The `disabled` auth method and `mock-k8s-client` flag are for development and testing ONLY. In production, the BFF always runs with real auth and real K8s clients. The container Dockerfile and Kubernetes deployment manifests do not set these flags.
:::

::: tip Key Takeaway
Authentication happens in two stages: `InjectRequestIdentity` extracts *who* the user is (from headers or token), and `RequireAccess` checks *what* they can do (via SubjectAccessReview against the K8s API). The frontend's `isAdmin` check controls the UI; the BFF's SAR check enforces the actual security boundary. Mock flags bypass these checks for development, but production always runs with real auth.
:::

::: info See Also
- [Middleware Chain](./middleware) -- how auth middleware fits into the request pipeline
- [Integrations](./integrations) -- how the K8s client performs SubjectAccessReview
- [Entry Point (main.go)](./entry-point) -- the `--auth-method` and `--mock-k8s-client` flags
:::
