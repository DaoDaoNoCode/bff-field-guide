# Tutorial 9: Build & Deploy the Operator

You have written operator code and registered a module, but so far everything ran against tests and envtest -- an *in-process* fake API server. Now you will run the real thing: build the operator image, deploy it and a `Dashboard` custom resource to a cluster, and watch it reconcile. Then you will run the operator in **local dev mode** so you can set a breakpoint and iterate without rebuilding an image every time.

**Time:** ~30 minutes

**Prerequisite:** A cluster you can `oc`/`kubectl` into (CRC, kind, or a dev OpenShift cluster) and either Docker or Podman. If you have not read [The Dashboard Operator](../guide/operator/index) and [The Reconciler](../guide/operator/reconciler), skim them first -- this tutorial assumes you know what a reconcile loop is.

::: info The Frontend Analogy
Building and deploying the operator is like building your app's Docker image and `kubectl apply`-ing it -- except the "app" is a controller whose whole job is to *watch a CR and apply other resources*. And dev mode is `npm run dev`: the same code, running on your laptop against the real cluster, with a fast edit-reload loop instead of a rebuild-repush-redeploy cycle.
:::

## Step 1: Build the Operator Image

The operator ships a multi-stage `Dockerfile` (`dashboard-operator/Dockerfile`): a `golang:1.26` builder compiles a static binary, then it is copied into a minimal `ubi9/ubi-minimal` runtime. The build context is the **repo root** (the parent of `dashboard-operator/`), because the build needs sibling paths.

The Makefile wraps this for you. From `dashboard-operator/`:

```bash
cd dashboard-operator
make docker-build IMG=quay.io/<you>/odh-dashboard-operator:dev
```

Under the hood that runs `docker build ... -f Dockerfile ..` (note the `..` context). If you use Podman, either alias `docker=podman` or run it directly from the repo root:

```bash
cd /path/to/odh-dashboard    # repo root -- the build context
podman build \
  --build-arg OPERATOR_VERSION=dev \
  -t quay.io/<you>/odh-dashboard-operator:dev \
  -f dashboard-operator/Dockerfile .
```

**What you should see:** the two build stages run in order:

```
STEP 1/N: FROM golang:1.26 AS builder
...
STEP N/N: FROM registry.access.redhat.com/ubi9/ubi-minimal:9.3
...
Successfully tagged quay.io/<you>/odh-dashboard-operator:dev
```

::: warning Apple Silicon: Build for the Cluster's Arch
On an M-series Mac, your default build produces an `arm64` image. Most clusters run `amd64` nodes, and an arch mismatch shows up as `exec format error` in the pod (not at build time -- so it is easy to miss). Always cross-build:

```bash
podman build --platform linux/amd64 -t quay.io/<you>/odh-dashboard-operator:dev \
  -f dashboard-operator/Dockerfile .
```

The same rule bit us deploying the dashboard itself -- cross-compile for the cluster, not your laptop.
:::

## Step 2: Push the Image

```bash
podman push quay.io/<you>/odh-dashboard-operator:dev
# or: make docker-push IMG=quay.io/<you>/odh-dashboard-operator:dev
```

**What you should see:** layer digests uploading, ending in the manifest being written. Make sure the repo is public (or your cluster has a pull secret), or the pod will `ImagePullBackOff`.

## Step 3: Install the CRD

The operator watches the `Dashboard` custom resource, which the cluster does not know about until you install its CRD. Apply the generated CRD:

```bash
oc apply -f dashboard-operator/config/crd/bases/
```

**What you should see:**

```
customresourcedefinition.apiextensions.k8s.io/dashboards.components.platform.opendatahub.io created
```

::: tip If You Edited the CRD Types
Changed anything in `dashboard-operator/api/v1alpha1/`? Regenerate before applying, or the cluster has a stale schema:

```bash
cd dashboard-operator
make manifests        # regenerate CRD YAML from Go types
make sync-chart-crds  # copy it into the Helm chart too
```

`make check-chart-crds` fails CI if the chart CRD drifts from the generated one -- run `sync-chart-crds` whenever you touch the types.
:::

## Step 4: Deploy the Operator with Helm

The operator deploys via its Helm chart, which bundles the CRD, RBAC, and the manager Deployment. Point it at the image you pushed:

```bash
oc new-project odh-dashboard-operator-system 2>/dev/null || true
helm install dashboard dashboard-operator/charts/dashboard \
  --namespace odh-dashboard-operator-system \
  --set image.repository=quay.io/<you>/odh-dashboard-operator \
  --set image.tag=dev
```

**What you should see:**

```
NAME: dashboard
STATUS: deployed
NAMESPACE: odh-dashboard-operator-system
```

Confirm the manager pod is running:

```bash
oc get pods -n odh-dashboard-operator-system
```

```
NAME                                    READY   STATUS    RESTARTS   AGE
dashboard-operator-xxxxxxxxxx-xxxxx     1/1     Running   0          20s
```

If it is `CrashLoopBackOff`, check the logs -- the most common cause is a missing `--namespace` (the operator refuses to start without it; see `cmd/manager/main.go:69`).

## Step 5: Apply a Dashboard CR

The operator is running but idle -- it has nothing to reconcile. Create a `Dashboard` CR:

```yaml
# dashboard-cr.yaml
apiVersion: components.platform.opendatahub.io/v1alpha1
kind: Dashboard
metadata:
  name: default-dashboard
  namespace: odh-dashboard-operator-system
spec:
  # module overrides, gateway config, etc. -- see the CRD page
```

```bash
oc apply -f dashboard-cr.yaml
```

**What you should see:** the reconciler wakes up. Watch its logs:

```bash
oc logs -n odh-dashboard-operator-system deploy/dashboard-operator -f
```

```
level=INFO msg="Reconciling Dashboard" name=default-dashboard
level=INFO msg="Applying module manifests" module=myModule
level=INFO msg="Updated federation ConfigMap" changed=true
level=INFO msg="Reconcile complete" requeue=false
```

The module you registered in Tutorial 8 gets its manifests applied, its entry added to the federation ConfigMap, and -- if the ConfigMap changed -- the dashboard rolling-restarts. That is the 14-step pipeline running for real.

Inspect the CR's status to see conditions the reconciler wrote back:

```bash
oc get dashboard default-dashboard -n odh-dashboard-operator-system -o yaml | less
```

Look for `status.conditions` and per-module status -- the operator reports what it did through the status subresource.

## Step 6: Run in Dev Mode (the Fast Loop)

Rebuilding and repushing an image for every code change is painfully slow. For development, run the operator **on your laptop** against the cluster. It uses your kubeconfig, so it can watch and apply resources exactly as the in-cluster pod would.

First, scale the in-cluster operator to zero so two reconcilers do not fight:

```bash
oc scale deploy/dashboard-operator -n odh-dashboard-operator-system --replicas=0
```

Then run the manager from source. It needs a namespace and a path to the manifests directory (in-cluster this is `/opt/manifests/dashboard`; locally it is the repo's `manifests/`):

```bash
cd dashboard-operator
go run ./cmd/manager \
  --namespace=odh-dashboard-operator-system \
  --manifests-base-path=../manifests \
  --leader-elect=false
```

Or use the Makefile shortcut, which wires the same flags:

```bash
make run NAMESPACE=odh-dashboard-operator-system MANIFESTS_BASE_PATH=../manifests
```

**What you should see:** the manager starts locally and immediately reconciles the existing CR, logging to your terminal:

```
level=INFO msg="starting manager"
level=INFO msg="Starting Controller" controller=dashboard
level=INFO msg="Reconciling Dashboard" name=default-dashboard
```

Now edit a reconciler file, `Ctrl+C`, and re-run -- seconds, not minutes. This is your inner loop.

::: tip Debugging with Delve
For breakpoints, run under Delve instead of `go run`:

```bash
dlv debug ./cmd/manager -- \
  --namespace=odh-dashboard-operator-system \
  --manifests-base-path=../manifests --leader-elect=false
```

Set a breakpoint in `Reconcile` (`dashboard_reconciler.go`), apply/modify the CR, and step through the pipeline live. `--leader-elect=false` matters -- leader election adds startup latency and lease churn you do not want while debugging.
:::

## Step 7: Clean Up

When you are done, restore the in-cluster operator (or tear everything down):

```bash
# Restore the in-cluster operator
oc scale deploy/dashboard-operator -n odh-dashboard-operator-system --replicas=1

# Or remove everything
oc delete -f dashboard-cr.yaml
helm uninstall dashboard -n odh-dashboard-operator-system
oc delete -f dashboard-operator/config/crd/bases/
```

::: warning Deleting the CR Triggers Teardown, Not Just Deletion
The `Dashboard` CR has a finalizer. Deleting it does not vanish instantly -- the reconciler runs its teardown path (removing deployed modules, cleaning cross-namespace resources) *before* the finalizer is removed and the object disappears. If a delete hangs, check the operator logs: teardown is probably waiting on something. See the finalizer section in [The Reconciler](../guide/operator/reconciler).
:::

---

<div class="checkpoint">

#### Checkpoint

Before finishing, verify:

- [ ] `make docker-build` (or `podman build`) produces an image, `linux/amd64` if on Apple Silicon
- [ ] The image is pushed and pullable by the cluster
- [ ] `oc apply -f config/crd/bases/` created the `Dashboard` CRD
- [ ] `helm install` deployed a `Running` operator pod
- [ ] Applying a `Dashboard` CR produces reconcile logs and populates `status.conditions`
- [ ] `make run` (or `go run ./cmd/manager`) runs the operator locally against the cluster
- [ ] You can explain why you scale the in-cluster operator to 0 before running dev mode

</div>

::: info If You Get Stuck
- [The Dashboard Operator](../guide/operator/index) -- architecture and repo layout
- [The Reconciler](../guide/operator/reconciler) -- the pipeline you just watched run
- [Operator Testing](../guide/operator/testing) -- envtest, for iterating without a cluster at all
- [Development Workflow](../guide/workflow/index) -- Makefile targets, debugging, common mistakes
- `.claude/local-specs/dashboard-operator-unified.md` -- the full deploy + dev-mode reference
:::

## Congratulations -- You've Finished the Tutorials

You started by writing a single GET handler and you have arrived here: building an operator image, deploying it to a cluster, and reconciling a real custom resource. Along the way you learned the BFF request lifecycle, testing, inter-BFF communication, module onboarding, operator registration, and the deploy loop. That is the entire Go realm of the ODH Dashboard, end to end.

Where to go next:
- **Go deeper on the operator internals** → [The Dashboard Operator](../guide/operator/index) guide (Part 5).
- **Sharpen your daily workflow** → [Development Workflow](../guide/workflow/index) (Part 6).
- **Keep the reference handy** → the [Cheat Sheet](../reference/cheat-sheet), [Gotchas](../reference/gotchas), and [Glossary](../reference/glossary).
