# Part 4: Kubernetes for Go Developers

> **The bridge chapter** -- the Kubernetes concepts you need in your head *before* you open the dashboard-operator's Go code.

Up to this point, Kubernetes has been something the BFF *talks to*. You learned that a handler calls the K8s API to list resources or run a SubjectAccessReview, and that was enough -- the BFF is a client, and you treated the cluster like a REST API you `fetch()` against.

The operator is different. The operator doesn't just *call* Kubernetes -- it *extends* it. It defines its own resource type (`Dashboard`), it runs a control loop that reconciles desired state against reality, and it creates, owns, and garbage-collects other resources. To read that code, you need a working model of a handful of Kubernetes concepts that never came up in BFF-land: CRDs, finalizers, owner references, Server-Side Apply, and the status subresource.

This part gives you exactly those concepts -- no more, no less -- always anchored to something you already know.

::: info You Do Not Need to Be a Kubernetes Expert
You need to be *comfortable* with the operational basics: you've run `kubectl get pods`, you know a Deployment manages replicas, you've seen a Service. If that's you, this part fills the gap between "I can deploy an app to a cluster" and "I can read a reconciler." If Pods and Deployments are brand new, skim a Kubernetes intro first, then come back.
:::

## Who Can Skip This Part

| You are... | Recommendation |
|---|---|
| Here **only for the BFF** (adding endpoints, handlers, tests) | You can skip Part 4 and Part 5 entirely. The BFF never defines CRDs or reconciles resources. Come back if you get curious. |
| Going to touch the **operator** | Read this part. Every concept here shows up on the very first page of the reconciler. |
| Already fluent in **CRDs, SSA, and controllers** | Skim the comparison tables and jump to [Part 5: The Dashboard Operator](/guide/operator/). |

## What This Part Covers

This part has three pages, in order:

- **[Resources & CRDs](./resources-and-crds)** -- a 30-second refresh on the core resources, then the big idea: how a CRD lets you add your *own* resource type to the Kubernetes API. We use the real `Dashboard` CRD as the running example, including the kubebuilder markers and CEL rules that generate its validation.

- **[RBAC & Access](./rbac-and-access)** -- ServiceAccounts, Roles, ClusterRoles, and Bindings, plus SubjectAccessReview and SelfSubjectAccessReview. You already met SAR/SSAR in the BFF's [auth layer](/guide/deep-dive/auth) -- here you'll see the other side: how the *operator* gets the permissions it needs.

- **[Controller Concepts](./controller-concepts)** -- the four ideas that make the control loop work: finalizers, owner references + garbage collection, Server-Side Apply with field ownership, and the status subresource with conditions. Plus the `client-go` vs `controller-runtime` comparison that explains why the operator and the BFF use *different* Kubernetes client libraries.

## The One Mental Model to Carry Forward

Everything in Kubernetes -- and everything the operator does -- follows the same loop:

```
   You declare DESIRED state          A controller observes ACTUAL state
   (spec: "I want 3 replicas")        (status: "there are 2 running")
              |                                     |
              v                                     v
        +-----------------------------------------------+
        |   reconcile: make actual match desired        |
        |   (start 1 more replica, then check again)    |
        +-----------------------------------------------+
                            |
                            v
              repeat forever, on every change
```

If React's render loop takes props/state and reconciles the DOM to match, Kubernetes takes `spec` and reconciles the cluster to match. The operator you're about to read *is* a render loop -- it just renders Deployments and ConfigMaps instead of DOM nodes.

Keep that picture in mind. Every concept in this part is a detail of how that loop stays correct.

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Can you explain the difference between `spec` (desired) and `status` (observed)?
- [ ] Do you know why a BFF developer might skip this part?
- [ ] Can you name the three pages in this part and roughly what each covers?
- [ ] Are you comfortable with `kubectl get pods` / Deployments / Services at an operational level?

</div>

::: info What's Next
Start with **[Resources & CRDs](./resources-and-crds)** -- how the operator adds its own resource type to Kubernetes.
:::
