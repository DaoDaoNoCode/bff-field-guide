# Replacing Fastify

> The strategy: three initiatives, fifteen epics, the decisions already taken, the gaps they do not cover yet, and an order to do it in. Technical detail lives on the previous pages; this page is the plan.

## The Goal in One Sentence

**The RHOAI dashboard pod runs two containers -- kube-rbac-proxy and Core BFF -- built from one image, with no Node.js in production, and no user-visible regression.**

Everything below serves that sentence. The benefits, from [RHOAIENG-83695](https://redhat.atlassian.net/browse/RHOAIENG-83695):

| Benefit | Size |
|---|---|
| Memory per dashboard pod | about 500-750 MB less (the Node.js runtime and Fastify) |
| Pod startup | about 13 s faster (about 2 s for Go vs about 15 s for Node.js) |
| Build | one Dockerfile, one image, one Konflux component instead of two |
| Onboarding | one backend language and one set of patterns -- the same as every module BFF |
| Security | no Node.js runtime or npm dependency tree in the image that fronts the product; per-user data access instead of a shared SA cache |

## The Principles

These are already decided in the initiatives. They are the lens for every detailed decision:

1. **Simplify, don't translate.** Fastify's complexity mostly exists because there was no operator to guarantee the environment. Find the root cause of each behaviour, then decide: delete it, move it to the operator, move it to the frontend, or port it.
2. **Keep the BFF thin.** Only routes with genuine multi-resource logic, secret handling or operations that are unsafe in the browser stay server-side. Thin CRUD becomes direct Kubernetes calls through `/api/k8s/*`.
3. **No cache by default.** Direct API calls with the user's token. An informer only when a measurement proves it is needed, per resource, with the justification written down.
4. **The operator provides the environment.** Auth topology, platform type, namespaces and RBAC come from the operator -- as env vars and RoleBindings, **not** new CRD fields (except `spec.backendMode`).
5. **Correctness over benchmarks.** Go will be faster; the risk is regressions. Dual-run, E2E, contract tests and a two-week soak decide readiness.

## The Three Initiatives

```
RHOAIENG-83693  Platform auth & infrastructure simplification   ─┐
                (make the environment uniform and the BFF thin)  │  can run in parallel
RHOAIENG-83694  Route audit & selective migration               ─┤
                (decide every route; build MF hosting; switch)   │
                                                                 ▼
RHOAIENG-83695  Promote Core BFF to primary backend
                (remove Fastify: 2 containers, 1 image, backend/ is Go)
```

### Initiative 1 -- Auth and Infrastructure ([RHOAIENG-83693](https://redhat.atlassian.net/browse/RHOAIENG-83693))

| Epic | What | Key decision |
|---|---|---|
| [83696](https://redhat.atlassian.net/browse/RHOAIENG-83696) Auth simplification | Investigate which platforms lack kube-rbac-proxy; have the operator provision it everywhere; validate Core BFF auth with header identity only | Keep strategy 1 (kube-rbac-proxy header) and 5 (dev); **do not port** the User API, SelfSubjectReview fallback or JWT parsing. Deprecate `openshift_user.go`. Keep the SSAR admin check |
| [83697](https://redhat.atlassian.net/browse/RHOAIENG-83697) RBAC & namespace middleware | `secureNamespacedRoute` mirroring `requestSecurityGuard`; notebook ownership; `usernameTranslate` in Go; `isUserAllowed` (SSAR `get` on `auths/default-auth`) | Identical access control to Fastify, proven by contract tests |
| [83698](https://redhat.atlassian.net/browse/RHOAIENG-83698) Kill ResourceWatcher | Measure request frequency and direct-fetch p99 for every watched resource; decide per resource; operator RoleBindings for SA-token reads; no silent errors | No cache by default |
| [83699](https://redhat.atlassian.net/browse/RHOAIENG-83699) Platform detection | Operator injects `PLATFORM_TYPE`; Core BFF reads it first and keeps the API probe only as a dev fallback | No `PlatformCapabilities` struct in the BFF; feature gating stays in DashboardConfig flags |
| [83700](https://redhat.atlassian.net/browse/RHOAIENG-83700) Operator-managed config | Operator injects `PLATFORM_TYPE`, `NAMESPACE`, `WORKBENCH_NAMESPACE`, `AUTH_METHOD`, `PROMETHEUS_HOST`, `DASHBOARD_CONFIG_NAME`; rolling restart on an annotation hash | **No `spec.coreBff`** and no new ConfigMap |

### Initiative 2 -- Routes and Traffic ([RHOAIENG-83694](https://redhat.atlassian.net/browse/RHOAIENG-83694))

| Epic | What | Key decision |
|---|---|---|
| [83701](https://redhat.atlassian.net/browse/RHOAIENG-83701) Route audit | A keep / deprecate / investigate decision for every route; move ~9 thin routes to `/api/k8s/*` in the frontend | Deprecate, don't port, thin wrappers |
| [83702](https://redhat.atlassian.net/browse/RHOAIENG-83702) Business-logic routes in Go | notebooks, modelRegistries, featurestores, validate-isv, ray-job-logs (cluster-settings, namespaces, connection-types and NIM are done) | Contract-first; LOC comparable to or less than Fastify |
| [83703](https://redhat.atlassian.net/browse/RHOAIENG-83703) MF proxy & static serving | `/_mf/<name>/*` proxy, `mfRemotesJson` injection into `index.html`, hot reload of the federation config, cache headers, gzip/brotli | **The critical path.** MF proxy and static serving are one unit because the injection needs both |
| [83704](https://redhat.atlassian.net/browse/RHOAIENG-83704) K8s-native proxy investigation & traffic switch | Which proxies can go away; add `spec.backendMode` | `/api/k8s/*` and `/wss/k8s/*` stay in Core BFF (kube-rbac-proxy cannot forward bearer tokens, and CORS blocks browser → API) |
| [83705](https://redhat.atlassian.net/browse/RHOAIENG-83705) Validation & E2E | Shadow-mode comparison, the Cypress suite against `coreBffPrimary`, contract tests for every migrated route, baselines, a 2-week staging soak | Functional correctness first |

### Initiative 3 -- Promotion ([RHOAIENG-83695](https://redhat.atlassian.net/browse/RHOAIENG-83695))

| Epic | What |
|---|---|
| [83706](https://redhat.atlassian.net/browse/RHOAIENG-83706) Static finalization | Edge cases (hash fragments, query strings, encoded paths), pre-compressed `.gz`, `index.html` and `remoteEntry.js` no-cache, CSP if needed, every distribution |
| [83707](https://redhat.atlassian.net/browse/RHOAIENG-83707) `coreBffOnly`, 2-container pod | New overlay without Fastify; kube-rbac-proxy upstream to Core BFF; automated rollback to 3 containers if readiness fails |
| [83708](https://redhat.atlassian.net/browse/RHOAIENG-83708) Unified Dockerfile | Node builder (frontend) → Go builder (`-tags strictfipsruntime`) → UBI9-minimal; merge the Konflux pipelines; `odh-dashboard-image` becomes the Go image; drop `RELATED_IMAGE_ODH_CORE_BFF_IMAGE` |
| [83709](https://redhat.atlassian.net/browse/RHOAIENG-83709) Repository restructuring | `distributions/core-bff/bff/` → `backend/`; delete Fastify (history keeps it); new Go module path; workspace, turbo, CI and Makefiles. Do it in a merge-freeze window |
| [83710](https://redhat.atlassian.net/browse/RHOAIENG-83710) Cleanup & docs | Agent rules and docs, 2-container diagrams, a migration guide for downstream, and **shared Go modules** (auth chain, K8s client factory, SSRF, audit logging) used by at least two BFFs |

## The Traffic Switch: `spec.backendMode`

The one CRD change, owned by the operator ([83704](https://redhat.atlassian.net/browse/RHOAIENG-83704), [83707](https://redhat.atlassian.net/browse/RHOAIENG-83707)):

```
split  (today)
  kube-rbac-proxy ──► Fastify :8080 ──► /core-bff/api/* ──► core-bff :8943
                                    └─► modules, /_mf/*

coreBffPrimary   (opt-in per cluster via a DashboardConfig flag)
  kube-rbac-proxy ──► core-bff ──► SPA, APIs, /api/k8s, modules, /_mf/*
  Fastify still running, no traffic  (instant rollback: switch the upstream back)

coreBffOnly      (default after the soak)
  kube-rbac-proxy ──► core-bff          ← 2 containers, 1 image
  coreBffPrimary stays available for one release as the rollback path
```

The operator owns the transitions: readiness gates before it moves the upstream, and rollback when Core BFF is not ready. It reports the mode and backend version in `status.distribution`.

::: warning What changes in the pod at each step
When Core BFF takes the upstream, these must change together, or the pod breaks in ways tests may not catch:
- **Port and TLS.** kube-rbac-proxy upstreams to `:8080` over loopback today. Either Core BFF moves to that port or the upstream points at `:8943` (with TLS).
- **Probes.** The pod's readiness comes from Fastify's `/api/health` today; Core BFF exposes `/healthcheck`.
- **The `coreBff` federation entry** (`/core-bff/api` → `/api`) becomes self-referential. Keep `/core-bff/api/*` working for existing callers, but stop routing it through a proxy.
- **The NetworkPolicy** opens 8943 to any namespace -- narrow it or document why.
- **Static assets.** The Core BFF image must carry the main dashboard's `frontend/public`, not only its own shell (and today the Konflux image also bundles the MaaS Portal).
:::

## Gaps the Initiatives Don't Cover Yet

The epics are well scoped. These came out of reading the code and should be added or folded into an epic:

| Gap | Why it matters | Suggested home |
|---|---|---|
| **Unlisted routes**: `service/pipelines`, `service/mlmd`, `service/trustyai`, `service/modelregistry`, `prometheus/cluster`, `segment-key`, `dev-impersonate` | No epic names them; any one forgotten is a broken page after the switch | 83701 audit document |
| **Unguarded routes**: Prometheus `POST`s without `secureRoute`, public NIM GETs | They copy Fastify, but promotion makes them the only implementation | 83697 |
| **Identity parity**: `usernameTranslate` and the kube-rbac-proxy `X-Auth-Request-*` headers vs Core BFF reading only `x-forwarded-access-token` | Notebook names and audit identities must match byte for byte | 83696 / 83697, with golden tests |
| **Auth topology differs per distribution**: kube-rbac-proxy in RHOAI, the Gateway in RHAII and the MaaS Portal | "kube-rbac-proxy everywhere" is a decision, not a fact yet; the auth matrix in 83696 should cover all three shapes | 83696 |
| **Metrics**: Core BFF has no `/metrics` endpoint | Without it, the baselines and the soak in 83705 have no data | 83705 |
| **Request load without a cache**: every page load becomes several SelfSubjectReviews plus API calls | Measure API-server QPS, not just latency, in the 83698 spike | 83698 |
| **Two Dockerfiles diverge today**: distroless vs UBI9/FIPS, and what each bundles | The unified image has to settle base, FIPS and contents once | 83708 |
| **`--static-assets-dir` has no env var** | The operator wants to configure by env (83700) | 83700 |

## A Suggested Order

The initiatives can start in parallel, but the work has a natural critical path. Start with the decisions that unblock everything else, and the hard engineering (MF hosting) as early as possible.

| Phase | Work | Output |
|---|---|---|
| **0. Map** (weeks 1-2) | The route audit document (83701) with a decision per route, including the unlisted ones; the platform auth matrix (83696) | Two documents everyone can review -- the plan becomes a checklist |
| **1. Foundations** | Operator env injection (83700) and `PLATFORM_TYPE` (83699); `secureNamespacedRoute`, `usernameTranslate` and `isUserAllowed` with golden tests (83697) | Core BFF behaves like Fastify on identity and access |
| **2. Critical path** | `/_mf/*` proxy, `index.html` injection and config hot reload (83703), on top of the existing `module_proxy.go` | Core BFF can host the main dashboard's federated modules |
| **2'. In parallel** | Measurement spike and per-resource decisions (83698); frontend hooks for deprecated routes (83701); the five business-logic routes (83702) | The route list shrinks while the critical path is built |
| **3. Switch** | `spec.backendMode` with `coreBffPrimary` (83704); dual-run, Cypress against `coreBffPrimary`, baselines, the soak (83705) | Production traffic on Core BFF with Fastify as the safety net |
| **4. Remove** | 83706 → 83707 → 83708 → 83709 (in a merge freeze) → 83710 | 2 containers, 1 image, `backend/` is Go |

::: tip The first two weeks
1. Run Core BFF locally (`make run PORT=4000 MOCK_K8S_CLIENT=true`) and the contract tests for both platforms.
2. Read `routes.go`, `middleware_auth.go` and `module_proxy.go` end to end -- they are most of what matters.
3. Start the route audit document from the tables in [Fastify Today](/guide/core-bff/fastify-today): one row per route, a decision, an owner, a test.
4. Write the auth matrix (RHOAI, ODH standalone, RHAII on xKS, MaaS Portal): who authenticates, which headers arrive, which namespaces.
5. Open the design discussion for the `/_mf/*` proxy and `index.html` injection early -- it is the longest pole.
:::

## Definition of Done

From the acceptance criteria of [RHOAIENG-83695](https://redhat.atlassian.net/browse/RHOAIENG-83695), plus the gaps above:

- [ ] The dashboard pod runs two containers (Core BFF + kube-rbac-proxy) in every distribution that has a pod of its own.
- [ ] One image contains the Go binary and the frontend assets; Konflux produces one artifact per run; FIPS is verified.
- [ ] Every Fastify route has a recorded decision, and the deprecated ones are gone from the frontend.
- [ ] Federated modules load from Core BFF, with `mfRemotesJson` injected and the config reloaded without a restart.
- [ ] Access control matches Fastify, including notebook ownership and `usernameTranslate`, with golden tests.
- [ ] No `ResourceWatcher`; every data path surfaces errors; any informer has a written justification.
- [ ] The E2E and contract suites pass against `coreBffOnly`; the soak is complete; memory and startup are measurably better.
- [ ] `coreBffPrimary` remains available as rollback for one release.
- [ ] No Fastify code or references remain; the docs (and this guide) describe the 2-container model.

::: tip Key Takeaway
Replacing Fastify is mostly **deciding**, not porting: a decision per route, per cached resource and per auth path, with the operator providing the environment. The real engineering is MF hosting in Go and a safe traffic switch through `spec.backendMode`. Get the audit and the auth matrix written first; build MF hosting early; let the soak decide when Fastify goes.
:::
