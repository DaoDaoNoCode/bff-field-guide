# Meet Core BFF

> **The dashboard's own Go backend** -- what it is, where it already runs, and why it is going to replace the Node.js Fastify backend.

Every module in the dashboard (Model Registry, Gen AI, MaaS, AutoML...) has its own BFF. Core BFF is different: it is the BFF for the **dashboard itself** -- the platform-wide APIs that do not belong to any one feature. Configuration, cluster settings, users and namespaces, connection types, serving runtimes, the Kubernetes API proxy, Prometheus, and serving the SPA.

Today those platform APIs exist **twice**: once in Node.js (the Fastify server in `backend/`) and once in Go (Core BFF in `distributions/core-bff/bff/`). This part of the guide explains the Go one, where each distribution uses it, and the plan to make it the only one.

::: info Who this part is for
Engineers starting on the Core BFF promotion -- the three initiatives [RHOAIENG-83693](https://redhat.atlassian.net/browse/RHOAIENG-83693), [RHOAIENG-83694](https://redhat.atlassian.net/browse/RHOAIENG-83694) and [RHOAIENG-83695](https://redhat.atlassian.net/browse/RHOAIENG-83695). It assumes you have read [Part 2: BFF Architecture](/guide/architecture/what-is-bff) and [Part 5: The Dashboard Operator](/guide/operator/).
:::

## Core BFF in One Page

| | |
|---|---|
| **Code** | `distributions/core-bff/bff/` -- a standalone Go module (Go 1.25), `httprouter` inside `net/http` muxes |
| **Contract** | `distributions/core-bff/bff/openapi/src/core-bff.yaml` -- contract first, always |
| **Tests** | Go unit tests (`make test`, with envtest) and contract tests in `distributions/core-bff/contract-tests/` for OpenShift and xKS |
| **Images** | `distributions/core-bff/Dockerfile` (upstream, distroless) and `Dockerfile.workspace` (Konflux, FIPS, UBI9-minimal) |
| **Ports** | `--port`, default `4000`; `8943` (TLS) in the RHOAI dashboard pod; `8443` in rhaii and the MaaS Portal |
| **Caching** | None. Every request goes to the Kubernetes API with the user's token |
| **Owner** | Pewter (Dashboard Platform) |

## Where It Runs Today

Core BFF is not a future plan -- it already ships. What changes from one distribution to the next is **how much** of the backend it is.

| Distribution | Core BFF's role | Who else is in the pod |
|---|---|---|
| **RHOAI / ODH dashboard** | Side container on `:8943`. Fastify is still the primary backend and forwards `/core-bff/api/*` to it | Fastify (`odh-dashboard`, `:8080`) and `kube-rbac-proxy` (`:8443`) |
| **RHAII on xKS** (`distributions/rhaii`) | **Sole backend** -- serves the shell, the baked-in model-serving remote and all APIs | Nobody: one container |
| **MaaS Portal** (`distributions/maas-portal`) | **Sole backend** -- serves the portal SPA and proxies the MaaS and Gen AI module BFFs | Nobody: one container |
| **AI Grid** | Not built yet. The architecture positions Core BFF as the identity and Kubernetes-abstraction boundary for the tenant UI | -- |

So the question is not *whether* Core BFF can be a primary backend. It already is, for two products. The question is how to make it the primary backend of the **main dashboard**, which carries ten years of Fastify behaviour.

## Why Replace Fastify

The case, as written in the initiatives:

- **One backend, one language.** Two backends mean two Dockerfiles, two Konflux pipelines, two images and two sets of patterns for every change. Every module BFF is already Go.
- **Lighter pods.** The Node.js runtime costs roughly 500-750 MB of memory per dashboard pod and about 15 s of startup; the Go binary starts in about 2 s. Removing Fastify takes the pod from 3 containers to 2.
- **Correct by construction.** Fastify's `ResourceWatcher` caches cluster data with a service-account token and serves the same view to every user; Core BFF calls the API with the user's token, so a user only sees what RBAC lets them see.
- **Smaller attack surface.** No Node.js runtime and its dependency tree in the image that fronts the whole product.
- **Every distribution, one backend.** RHAII and the MaaS Portal already run on Core BFF; the main dashboard is the last one on Fastify.

::: warning Not a port
The single most important decision in these initiatives: **do not carbon-copy Fastify.** Its auth chain, caching and many thin routes exist because there was no operator to guarantee a consistent environment. Now there is. Port what has real business logic, replace thin wrappers with direct Kubernetes calls, and let the operator provide what Fastify used to discover. Keep the BFF thin.
:::

## How to Read This Part

1. [Architecture](/guide/core-bff/architecture) -- how the binary is put together: flags, bootstrap, the request pipeline, auth, the proxies and static serving.
2. [Across Distributions](/guide/core-bff/distributions) -- the three deployment shapes, their auth topology, ports and network policies, and how the operator wires each one.
3. [Fastify Today](/guide/core-bff/fastify-today) -- everything the Node.js backend does, route by route, and what Core BFF already covers.
4. [Replacing Fastify](/guide/core-bff/replacing-fastify) -- the three initiatives and fifteen epics, the decisions already taken, the gaps, and the order to do it in.

::: tip Key Takeaway
Core BFF is the dashboard's platform BFF. It is already the only backend for RHAII and the MaaS Portal, and a side container in RHOAI. The work ahead is to make it the only backend of the main dashboard -- by thinning the API surface, not by translating Fastify line by line.
:::
