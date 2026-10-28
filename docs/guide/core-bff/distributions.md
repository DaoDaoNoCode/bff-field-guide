# Core BFF Across Distributions

> The same binary runs in three very different shapes. This page shows each one -- containers, ports, auth topology, network policy and how the operator wires it -- and what that means for the promotion work.

A *distribution* (see [Part 2: Distributions](/guide/architecture/distributions)) is a product built from the same packages: a shell, a set of bundled or federated modules, and a backend. Core BFF is the backend of every Go-backed distribution, and a side container in the one that is still on Fastify.

## At a Glance

| | RHOAI / ODH dashboard | RHAII on xKS | MaaS Portal |
|---|---|---|---|
| **Source** | `manifests/base/deployment.yaml` | `manifests/distributions/rhaii/`, `distributions/rhaii/` | `manifests/distributions/maas-portal/`, `distributions/maas-portal/` |
| **Containers** | 3: Fastify, kube-rbac-proxy, core-bff | 1: `rhaii-dashboard` | 1: `maas-portal` |
| **Core BFF role** | Side container; Fastify is primary | Sole backend | Sole backend |
| **Core BFF port** | `8943`, HTTPS | `8443`, **plain HTTP** (no cert flags) | `8443`, HTTPS |
| **Who authenticates** | kube-rbac-proxy in the pod | The Gateway in front | The shared Gateway (its OAuth session) |
| **Platform** | auto-detected (OpenShift) | `--platform-type=XKS` | `--platform-type=OpenShift` |
| **Serves the SPA?** | No -- Fastify does | Yes, `/static` | Yes, `/static/maas-portal` |
| **Module proxy** | Not configured | Not configured; model serving is baked in | **Yes** -- maas and gen-ai, from `maas-portal-federation-config.json` |
| **Image** | `core-bff-image` (`RELATED_IMAGE_ODH_CORE_BFF_IMAGE`) | `rhaii-dashboard-image` | `core-bff-image` (the Konflux image bundles the portal assets) |

## RHOAI / ODH: The Three-Container Pod

```
Gateway (HTTPRoute) ──► Service odh-dashboard / rhods-dashboard :8443
                         │
            ┌────────────┴──────────────────────────────────────────┐
            │ Pod                                                    │
            │  kube-rbac-proxy :8443  ──►  Fastify (odh-dashboard)   │
            │   authenticates the user,      :8080 on loopback       │
            │   sets x-forwarded-access-token  │                     │
            │   and X-Auth-Request-* headers   │ /core-bff/api/* ──► │
            │                                  ▼                     │
            │                          core-bff :8943 (TLS)          │
            └──────────────────────────────────────────────────────┘
                                   │
                    Fastify also proxies /<module>/api/* and /_mf/* to
                    the module Services (odh-dashboard-<slug>-ui:8x43)
```

**Containers:**

| Container | Port | Probes | Job |
|---|---|---|---|
| `kube-rbac-proxy` | 8443 (the Service port) | -- | Authenticates the user against the cluster, checks access, injects `x-forwarded-access-token` and `X-Auth-Request-*` |
| `odh-dashboard` (Fastify) | 8080, loopback | `/api/health` | Serves the SPA, renders `index.html` with the module remotes, proxies modules and `/_mf/*`, runs most APIs |
| `core-bff` | 8943, HTTPS | `/healthcheck` (startup, liveness, readiness) | The Go platform APIs, reached through Fastify |

**Core BFF arguments** in this pod:

```yaml
args:
  - '--auth-method=user_token'
  - '--auth-token-header=x-forwarded-access-token'
  - '--auth-token-prefix='
  - '--port=8943'
  - '--cert-file=/etc/tls/private/tls.crt'   # proxy-tls service-serving cert
  - '--key-file=/etc/tls/private/tls.key'
```

**How requests reach it.** The dashboard operator adds a `coreBff` entry to the generated `federation-config` (`dashboard-operator/internal/controller/dashboard_federation.go`):

```go
const coreBffPort = 8943

func (r *DashboardReconciler) coreBffFederationEntry() federationEntry {
    return federationEntry{
        Name: coreBffFederationName,
        ProxyService: []proxyServiceEntry{{
            Path:        "/core-bff/api",
            PathRewrite: "/api",
            federationTarget: explicitFederationTarget(true, true, serviceRef{
                Name:      mainDashboardServiceName(r.Platform), // rhods-dashboard on RHOAI
                Namespace: r.ApplicationsNamespace,
                Port:      coreBffPort,
            }),
        }},
    }
}
```

Fastify reads that config (as `MODULE_FEDERATION_CONFIG`) and proxies `/core-bff/api/*` to `https://<dashboard-service>.<ns>.svc.cluster.local:8943/api/*`, forwarding the user token. So the browser calls `/core-bff/api/...`, and Fastify is still in the path.

**Who uses it today.** Very little: the only production frontend caller is `connectionTestService.ts` (`POST /core-bff/api/v1/connections/test`). Everything else Core BFF can do -- config, status, components, connection types, serving runtimes, Prometheus -- is still served by Fastify in this distribution. Core BFF here is **pre-positioned**, not yet load-bearing.

**Network policy.** `manifests/base/networkpolicy.yaml` (`dashboard-allow-ports`) opens 8443 and 8943 to the ingress policy group, and **8943 to any namespace** (`namespaceSelector: {}`). Egress allows DNS, the API server (6443) and the module Service ports (8043, 8143, 8243, ...).

::: warning Review the open 8943
Opening 8943 to every namespace makes sense while module BFFs might call Core BFF directly. No module does today (there is no `core-bff` target in any `bffclient`). Narrow the policy -- or document who needs it -- as part of [RHOAIENG-83693](https://redhat.atlassian.net/browse/RHOAIENG-83693).
:::

## RHAII on xKS: Core BFF Alone

RHAII is the dashboard for Red Hat AI Inference on non-OpenShift Kubernetes (xKS: EKS, AKS, GKE...). It has no OpenShift OAuth, no `ClusterVersion`, no `Route`, and no Fastify.

```
Gateway (HTTPRoute, gateway-namespace) ──► Service rhaii-dashboard :8443
                                              │
                                   ┌──────────┴──────────┐
                                   │ Pod: rhaii-dashboard │
                                   │  core-bff :8443      │
                                   │  /static  ← shell +  │
                                   │  /static/_mf/modelServing/ │
                                   └─────────────────────┘
```

```yaml
args:
  - --port=8443
  - --deployment-mode=standalone
  - --auth-method=user_token
  - --auth-token-header=x-forwarded-access-token
  - --auth-token-prefix=
  - --platform-type=XKS
  - --static-assets-dir=/static
```

Things that differ from RHOAI:

- **One container, plain HTTP.** No `--cert-file`/`--key-file`, so Core BFF listens on 8443 without TLS; TLS terminates at the Gateway. There is **no kube-rbac-proxy** in this pod -- some older docs say there is.
- **Model serving is baked in.** The image is built with `MODEL_SERVING_REMOTE_ENTRY=/_mf/modelServing/remoteEntry.js`, so the model-serving remote is part of the static assets under `/static/_mf/modelServing/` and served by the same static handler. No module proxy, no runtime federation.
- **XKS routes only.** `requirePlatform(OpenShift)` turns Prometheus, NIM, operator subscription status and allowed users into 404s. Contract tests under `contract-tests/__tests__/xks/` keep this honest.
- **Network policy.** Ingress on 8443 only from `gateway-namespace`; egress to DNS in `kube-system`, and to 443/6443 for the API server.

## MaaS Portal: Core BFF as a Product Front Door

The MaaS Portal ([RHAISTRAT-1545](https://redhat.atlassian.net/browse/RHAISTRAT-1545)) gives model consumers endpoints, API keys and usage without an OpenShift console. The frontend (`distributions/maas-portal/`) bundles `@odh-dashboard/observability`, `@odh-dashboard/maas` and `@odh-dashboard/gen-ai`. The backend is Core BFF.

The dashboard operator deploys it when `spec.maasPortal.managementState` is `Managed` on RHOAI and `spec.gateway.domain` is set (`dashboard-operator/internal/controller/maas_portal.go`). It is served at `https://<gateway domain>/maas-portal/` and shares the Gateway's login session.

```yaml
args:
  - --deployment-mode=standalone
  - --auth-method=user_token
  - --auth-token-header=x-forwarded-access-token
  - --auth-token-prefix=
  - --platform-type=OpenShift
  - --namespace=dashboard-namespace
  - --static-assets-dir=/static/maas-portal
  - --mf-remotes-config=/etc/odh-dashboard/maas-portal-federation-config.json
  - --port=8443
  - --cert-file=/etc/tls/private/tls.crt
  - --key-file=/etc/tls/private/tls.key
  - --bundle-paths=...   # system CA, SA CA, service CA, ODH bundles
```

- **The module proxy is live here, and only here.** The operator writes `maas-portal-federation-config` (`maas_portal_federation.go`) with the maas and gen-ai entries; Core BFF reads it and proxies `/maas/api/*` and `/gen-ai/api/*` to `maas-ui:8243` and `gen-ai-ui:8143` with the user token.
- **Everything else is bundled.** The UI code of those modules is compiled into the portal, so no `/_mf/*` proxy is needed -- which is exactly why Core BFF could be its backend before the MF-hosting gap was closed.
- **Network policy.** Ingress on 8443 from the ingress policy group; egress to DNS, the API server and only the `maas-ui` and `gen-ai-ui` pods (plus Perses for observability).

## `distributions/base` and `distributions/core-bff/manifests`

Two more things share the name and cause confusion:

- **`distributions/base/`** is a TypeScript library, not a backend: the shell pieces every distribution reuses (theme context, `DistributionConfig`, `K8sSdkProvider`, ...).
- **`distributions/core-bff/manifests/base/`** deploys Core BFF on its own (on port 4000, with its own ServiceAccount and ClusterRole). It is a standalone dev/xKS path, **not** how RHOAI deploys it. In RHOAI Core BFF is the third container of `manifests/base/deployment.yaml`.

## AI Grid: Where It Is Heading

AI Grid -- the multi-cluster, multi-tenant direction for RHOAI -- is not built yet. The architecture positions Core BFF as the **boundary** between tenant UIs and the clusters behind them: one place that resolves identity, decides which namespaces and resources a tenant can see, and hides whether a resource lives on OpenShift or xKS. Concretely, that argues for:

- keeping identity extraction and the admin check in one place (they already are: `InjectRequestIdentity`, `secureAdminRoute`);
- keeping the platform abstraction explicit (`--platform-type`, `requirePlatform`, per-platform contract tests);
- not reintroducing cluster-wide caches that leak one tenant's view to another.

These are the same properties the Fastify replacement needs, which is why the promotion and AI Grid point the same way.

## What Each Shape Teaches the Promotion

| Lesson | From |
|---|---|
| Core BFF can serve the SPA, proxy modules and handle auth on its own in production | RHAII, MaaS Portal |
| Module APIs through federation-config work, with token forwarding and SSRF checks | MaaS Portal |
| Remote-entry hosting (`/_mf/*`) and runtime `index.html` injection are **not** solved anywhere yet | RHOAI is the only distribution with runtime federation, and Fastify does it |
| Auth topology is per distribution: kube-rbac-proxy in RHOAI, the Gateway elsewhere | All three |
| Probes, ports, the `coreBff` federation entry and the NetworkPolicy all change when Core BFF becomes primary | RHOAI |

::: tip Key Takeaway
Same binary, three shapes. In RHAII and the MaaS Portal Core BFF is the whole backend; in RHOAI it sits behind Fastify and is barely called. The RHOAI shape is the one the initiatives change: Core BFF takes over the SPA, the module proxy and `/_mf/*`, and the pod goes from three containers to two.
:::
