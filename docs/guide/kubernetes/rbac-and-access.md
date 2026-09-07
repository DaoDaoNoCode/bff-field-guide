# RBAC & Access

> **Who can do what** -- how Kubernetes decides whether an action is allowed, and how both the operator and the BFF plug into that system.

You met the enforcement side of this in the BFF's [Authentication & RBAC](/guide/deep-dive/auth) page: the BFF asks Kubernetes "is this user allowed?" via a SubjectAccessReview. This page fills in the model *underneath* that question -- the four RBAC building blocks -- and then shows the other consumer of RBAC: the operator, which needs its *own* permissions to manage resources.

## The Four Building Blocks

Kubernetes RBAC is four resource types wired together:

```
 ServiceAccount  --bound by-->  RoleBinding  --grants-->  Role  --lists-->  [resources, verbs]
    (identity)                     (the link)              (the permissions)
```

| Component | Scope | Purpose | Frontend analogy |
|---|---|---|---|
| **ServiceAccount** | Namespaced | Identity for a pod/process | A service's API key / bot user |
| **Role** | Namespaced | Permissions *within one namespace* | A permission set scoped to one tenant |
| **ClusterRole** | Cluster-wide | Permissions *across all namespaces* | A global permission set |
| **RoleBinding** | Namespaced | Attaches a Role to a ServiceAccount | Assigning a role to a user |
| **ClusterRoleBinding** | Cluster-wide | Attaches a ClusterRole cluster-wide | Assigning a global role |

::: tip The Anchor
A **ServiceAccount** is *who* a process is. A **Role/ClusterRole** is a list of *what's allowed* (verbs like `get`, `list`, `create`, `delete` on resource types). A **Binding** is the line that connects them. If you've ever set up IAM -- an identity, a policy document, and an attachment -- this is the same three-part shape.
:::

## The Operator's Own Permissions

A BFF runs as *the user* (using their forwarded token). The operator is different: it runs as **its own ServiceAccount** and needs broad permission to create and manage the resources it deploys. Those permissions are declared in `dashboard-operator/config/rbac/role.yaml`:

```yaml
rules:
- apiGroups: ["apps"]                              # Manage Deployments...
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["components.platform.opendatahub.io"] # ...read the Dashboard CR...
  resources: ["dashboards"]
  verbs: ["get", "list", "watch", "update", "patch"]
- apiGroups: ["components.platform.opendatahub.io"] # ...and write its status subresource
  resources: ["dashboards/status"]
  verbs: ["get", "update", "patch"]
```

::: info RBAC Is Also Generated From Markers
Just like the CRD schema, the operator's RBAC YAML is generated. `// +kubebuilder:rbac:...` markers on the reconciler declare what permissions the controller needs, and `make manifests` writes `config/rbac/role.yaml`. Change what the reconciler touches, add the marker, regenerate -- same loop as the CRD types.
:::

Notice `dashboards/status` is a *separate* rule from `dashboards`. That's deliberate, and it connects to the status subresource you'll see in the next page: the controller can be granted permission to write `status` without letting anyone else set it by hand.

## SAR and SSAR: Asking "Is This Allowed?"

RBAC rules are static declarations. To check them *at runtime*, Kubernetes gives you two API calls.

### SubjectAccessReview (SAR) -- "Can user X do Y?"

A SAR asks the API server whether a *specific, named* user is allowed to perform an action. The caller supplies the user and groups. This is what a process with its own ServiceAccount uses to check *someone else's* access:

```go
sar := &authv1.SubjectAccessReview{                 // "Can this user do this thing?"
    Spec: authv1.SubjectAccessReviewSpec{
        User:   identity.UserID,                    // WHO: "alice@example.com"
        Groups: identity.Groups,                    // their groups
        ResourceAttributes: &authv1.ResourceAttributes{
            Namespace: namespace,                   // WHERE
            Verb:      "list",                      // ACTION
            Group:     "datasciencepipelinesapplications.opendatahub.io",
            Resource:  "datasciencepipelinesapplications", // WHAT
        },
    },
}
// The API server checks its RBAC rules and returns Status.Allowed: true/false
```

### SelfSubjectAccessReview (SSAR) -- "Can *I* do Y?"

An SSAR asks about the *caller's own* identity -- you don't name a user, because the token you're calling with already identifies you. This is what the BFF uses when it operates with a user's forwarded token:

```go
// SAR : "Can user X do Y?"   -- caller uses its OWN service account to ask about someone else
// SSAR: "Can I do Y?"        -- caller uses the USER'S token; the token IS the subject
```

The practical outcome is identical -- you learn whether the action is permitted -- but the mechanism differs based on *whose* credentials are making the check.

::: warning This Is the Same SSAR From the BFF Auth Page
In [Authentication & RBAC](/guide/deep-dive/auth), the BFF's `RequireAccess` middleware runs exactly this check before letting a handler execute. The frontend *also* uses SSAR (to show or hide UI). Same API, three consumers: the frontend (advisory, controls UI), the BFF (authoritative, blocks the request), and -- in checks like `IsUserAdmin` -- the platform layer. The UI check is a suggestion; the BFF check is the locked door.
:::

## The Full Picture

```
                    RBAC rules (static, in the cluster)
                    Role / ClusterRole  +  Binding  +  ServiceAccount
                                    |
              +---------------------+---------------------+
              |                                           |
      OPERATOR uses its                         BFF asks about the
      ServiceAccount's grants                   USER via SAR/SSAR
      to create Deployments,                    before running a handler
      Services, ConfigMaps                      (403 if not allowed)
              |                                           |
              v                                           v
      "I am allowed to manage               "Is THIS user allowed to
       these resources"                      touch THIS namespace?"
```

Two different consumers, one RBAC system. The operator *has* permissions (its ServiceAccount is powerful, scoped to what it manages). The BFF *checks* permissions (it never wants more power than the user it's acting for).

::: tip Key Takeaway
RBAC is four pieces: a ServiceAccount (identity), a Role/ClusterRole (permissions), and a Binding (the link). The operator runs as its own ServiceAccount with generated RBAC so it can manage Deployments and write the Dashboard status. The BFF, by contrast, checks the *user's* permissions at runtime with SAR (name a user) or SSAR (ask about yourself). Never assume access -- always check.
:::

---

<div class="checkpoint">

#### Before You Continue

You should be able to:
- [ ] Name the four RBAC building blocks and how they connect
- [ ] Explain why the operator has a powerful ServiceAccount but the BFF does not
- [ ] State the difference between SAR and SSAR in one sentence
- [ ] Explain why `dashboards/status` is a separate RBAC rule from `dashboards`
- [ ] Recall that RBAC YAML is generated from `// +kubebuilder:rbac:` markers

</div>

::: info What's Next
Next: **[Controller Concepts](./controller-concepts)** -- finalizers, owner references, Server-Side Apply, and the status subresource: the four ideas that make the control loop correct.
:::
