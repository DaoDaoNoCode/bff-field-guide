# What Is Coming Next

> The BFF architecture you have learned is about to evolve. Here is a heads-up on what is changing, why, and what it means for your daily work -- so nothing catches you off guard.

## The Split-Stack Problem

Right now, the ODH Dashboard runs a **split backend**. The Fastify (Node.js) server handles ~33 API route categories -- dashboard config, Kubernetes proxying, RBAC, WebSocket watch, and more. Meanwhile, 7 Go-based module BFFs (gen-ai, model-registry, maas, automl, autorag, eval-hub, mlflow) handle package-specific logic.

This means the dashboard team maintains two backend languages, two sets of patterns, and two mental models. If you are a frontend developer who just learned Go for the BFF, you still need to understand Fastify when you touch dashboard-level routes. If you are debugging a request, you might start in Go and end up in TypeScript. Context-switching is expensive.

The initiative to fix this is already underway: **migrate the Fastify backend into a unified Go BFF.**

## The Common BFF -- Shared Infrastructure for Everyone

Instead of each team building its own BFF from scratch, there is now a **core BFF** -- a shared Go service that provides the platform plumbing every team needs. It already exists at `distributions/core-bff/` in the monorepo.

What is built today:

- **Authentication** -- user token extraction (bearer token via configurable header) with `disabled` mode for testing
- **K8s client** -- a token-switching client factory so each request runs with the user's own permissions
- **Router, CORS, panic recovery** -- the same `httprouter` pattern you already know from the module BFFs
- **Inter-BFF communication** -- a `bffclient` package for calling other BFFs (maas, gen-ai, model-registry, mlflow) with auth forwarding
- **Cluster discovery** -- startup-time queries for OpenShift cluster ID and branding (graceful fallback on vanilla K8s)
- **OpenAPI + Swagger UI** -- embedded spec with Swagger UI in dev mode

What is planned but not yet implemented:

- **SSRF protection** -- hostname resolution and private IP blocking for outbound requests
- **Rate limiting** -- per-user request limits
- **Additional auth strategies** -- beyond bearer token (e.g., OpenShift OAuth, service account)

Think of it as a **shared foundation**. Teams do not build their own auth or K8s clients -- they register handlers on the common router, and the platform handles the rest. It is the same pattern you already use in the module BFFs (`App` struct, middleware chain, `httprouter`), just elevated to a shared service.

```
Today (current state):                       Future (migration complete):

Dashboard Pod                               Dashboard Pod
┌──────────────────────┐                     ┌──────────────────────┐
│  Fastify (Node.js)   │ ← still runs       │  Core BFF (Go)       │
│  - 33 route groups   │                     │  - All routes        │
│  - Auth, config      │                     │  - Auth, config      │
│  - K8s proxy         │                     │  - K8s proxy         │
│  - WebSocket watch   │                     │  - WebSocket watch   │
│  - MF proxy          │                     │  - MF proxy          │
├──────────────────────┤                     ├──────────────────────┤
│  Core BFF (Go)       │ ← NEW, early stage  │                      │
│  - healthcheck       │   (distributions/   │                      │
│  - user, namespaces  │    core-bff/)       │                      │
├──────────────────────┤                     ├──────────────────────┤
│  gen-ai BFF (Go)     │                     │  gen-ai BFF (Go)     │
│  model-reg BFF (Go)  │                     │  model-reg BFF (Go)  │
│  maas BFF (Go)       │                     │  maas BFF (Go)       │
│  ...                 │                     │  ...                 │
└──────────────────────┘                     └──────────────────────┘
  Two languages + core BFF starting            One language, one pattern
```

## How the Migration Works

The migration is **gradual, not a big-bang cutover**. Fastify endpoints move over in waves, starting with the simplest routes and ending with the most complex. Nothing breaks along the way -- the old Fastify route and the new Go route can run side by side until the team is confident the Go version is solid.

### Phase 0: Lay the Foundation ✅ (done)

The core BFF now exists at `distributions/core-bff/` in the monorepo. It is a standalone Go service (not a sidecar) with its own Dockerfile that bundles the BFF and a React frontend into a single container. It replaces the Fastify backend rather than running alongside it.

The core BFF currently handles: `/healthcheck`, `/api/v1/user`, `/api/v1/namespaces`, and OpenAPI documentation endpoints. It also has inter-BFF communication infrastructure (`bffclient` package) for calling maas, gen-ai, model-registry, and mlflow BFFs. Teams can contribute new handlers using the K8s client factory and inter-BFF client already in place.

### Phases 1-2: Audit and Extend

Before migrating Fastify routes, the team audits all 33 route categories and documents their request/response contracts. This produces a migration matrix: which endpoints move when, who owns them, and what the priority order is.

The common BFF also gets extended with infrastructure specific to the migration -- admin RBAC middleware, an HTTP reverse proxy framework, and a K8s pass-through resource handler.

### Phases 3-5: Move the Routes

Fastify endpoints migrate in three waves of increasing complexity:

| Wave | What Moves | Examples |
|---|---|---|
| **Simple** | K8s passthroughs, service proxies, status endpoints | builds, docs, console-links, health |
| **Moderate** | Config, templates, RBAC, connection types | dashboardConfig, cluster-settings, Prometheus |
| **Complex** | Multi-step orchestration, feature stores, model registries | notebooks, servingRuntimes, ray-job-logs |

Each endpoint follows the same pattern: implement the Go handler, write contract tests, validate with the E2E suite, switch traffic, remove the Fastify route.

### Phases 6-8: The Hard Parts and Finish Line

The most complex pieces -- WebSocket proxying, resource caching, and Module Federation serving -- migrate last. These get prototype spikes before production implementation.

Once everything is migrated, shared Go modules are extracted from the common BFF and module BFFs (auth, K8s client factory, response helpers). Finally, the `backend/` directory and all Node.js dependencies are removed.

::: info This Is a Plan, Not a Promise
The migration is dependency-ordered, not calendar-driven. Phases happen when they are ready, not on a fixed schedule. Some phases can overlap. The timeline depends on team capacity and competing priorities. What matters is the direction: from split-stack to unified Go.
:::

## What This Means for You

Here is the practical impact, depending on when you are reading this:

**Where we are now:** The core BFF exists at `distributions/core-bff/` and Fastify still runs at `backend/`. Both coexist. When adding new dashboard-level routes, check whether they should go in the core BFF (new Go code at `distributions/core-bff/bff/`) or Fastify (legacy, will be migrated later). When in doubt, ask the team.

**When Fastify is gone:** The `backend/` directory will no longer exist. All routes will be Go. The architecture diagram from [The Big Picture](./big-picture) will simplify: no more Fastify layer.

Regardless of timing, the key takeaway is this: **the Go patterns you are learning in this guide are the future of the entire dashboard backend, not just the module BFFs.** Every hour you spend understanding Go handlers, middleware, and testing is an investment that becomes more valuable as the migration progresses.

::: tip The Skills Transfer Directly
The common BFF follows the same conventions as the module BFFs you have been learning about: `cmd/main.go` entry point, `internal/api/app.go` with the App struct, `Routes()` function, middleware chain, `httprouter`, OpenAPI specs, and contract tests. If you can write a handler for the gen-ai BFF, you can write one for the common BFF.
:::

::: info See Also
- [The Big Picture](./big-picture) -- the current architecture, layer by layer
- [The App Struct & Routes](../deep-dive/app-and-routes) -- the pattern the common BFF follows
- [Middleware Chain](../deep-dive/middleware) -- the same middleware pipeline used everywhere
:::
