# Tutorial 9: Build & Deploy the Operator

You have written operator code and registered a module, but so far everything ran against tests and envtest -- an *in-process* fake API server. Now you will run the real thing: build the operator image, deploy it and a `Dashboard` custom resource to a cluster, and watch it reconcile. Then you will run the operator in **local dev mode** so you can set a breakpoint and iterate without rebuilding an image every time.

**Time:** ~30 minutes

**Prerequisite:** A cluster you can `oc`/`kubectl` into (CRC, kind, or a dev OpenShift cluster) and either Docker or Podman. If you have not read [The Dashboard Operator](../guide/operator/index) and [The Reconciler](../guide/operator/reconciler), skim them first -- this tutorial assumes you know what a reconcile loop is.

::: info The Frontend Analogy
Building and deploying the operator is like building your app's Docker image and `kubectl apply`-ing it -- except the "app" is a controller whose whole job is to *watch a CR and apply other resources*. And dev mode is `npm run dev`: the same code, running on your laptop against the real cluster, with a fast edit-reload loop instead of a rebuild-repush-redeploy cycle.
:::

## Step 1: Build the Operator Image

The operator ships a multi-stage `Dockerfile` (`dashboard-operator/Dockerfile`): a `golang:1.26` builder compiles a static binary, then it is copied into a minimal `ubi9/ubi-minimal:9.3` runtime. The build context is the **repo root** (the parent of `dashboard-operator/`), because the image also copies the repo's `manifests/` directory to `/opt/manifests/dashboard/` and makes the `params.env` files group-writable (the operator rewrites them at reconcile time). That is why `--manifests-base-path` defaults to `/opt/manifests/dashboard`.

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

## Step 3: The CRD Comes With the Chart

The operator watches the `Dashboard` custom resource, which the cluster does not know about until its CRD is installed. You don't need a separate step for that: the Helm chart ships the CRD in `charts/dashboard/crds/`, and `helm install` applies it before anything else. (`oc apply -f dashboard-operator/config/crd/bases/` still works if you want the CRD without the chart.)

::: tip If You Edited the CRD Types
Changed anything in `dashboard-operator/api/v1alpha1/`? Regenerate before installing, or the cluster gets a stale schema:

```bash
cd dashboard-operator
make manifests        # regenerate CRD YAML from Go types
make sync-chart-crds  # copy it into the Helm chart too
```

`make check-chart-crds` fails CI if the chart CRD drifts from the generated one -- run `sync-chart-crds` whenever you touch the types. Note that Helm installs files in `crds/` only on first install and never upgrades them; after a schema change, `oc apply` the new CRD yourself.
:::

## Step 4: Deploy the Operator with Helm

The operator deploys via its Helm chart, which bundles the CRD, RBAC, the config ConfigMap and the manager Deployment. Point it at the image you pushed:

```bash
oc new-project odh-dashboard-operator-system 2>/dev/null || true
helm install dashboard dashboard-operator/charts/dashboard \
  --namespace odh-dashboard-operator-system \
  --set namespace=odh-dashboard-operator-system \
  --set namePrefix= \
  --set image.repository=quay.io/<you>/odh-dashboard-operator \
  --set image.tag=dev
```

Two flags are easy to miss:

- **`--set namespace=...`** -- the chart's `values.yaml` has `namespace: opendatahub`, and its templates use `default .Release.Namespace .Values.namespace`. A non-empty value wins, so without this flag everything lands in `opendatahub` regardless of `--namespace`.
- **`--set namePrefix=`** -- the chart default is `namePrefix: odh-`, which names the Deployment `odh-dashboard-operator`. The ODH Operator sets it to `""`, and so do we, so the Deployment is `dashboard-operator` (and matches what dev mode assumes in Step 6). Keep the default and every `deploy/dashboard-operator` below becomes `deploy/odh-dashboard-operator`.

The operator's applications namespace (where the dashboard itself runs) defaults to the operator namespace, because the chart doesn't set `APPLICATIONS_NAMESPACE`.

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

If it is `CrashLoopBackOff`, check the logs -- the most common cause is a missing `--namespace` (the operator refuses to start without it or `OPERATOR_NAMESPACE`; see `cmd/manager/main.go` around L69-75).

## Step 5: Apply a Dashboard CR

The operator is running but idle -- it has nothing to reconcile. Create a `Dashboard` CR. It is **cluster-scoped**, so there is no `metadata.namespace`:

```yaml
# dashboard-cr.yaml
apiVersion: components.platform.opendatahub.io/v1alpha1
kind: Dashboard
metadata:
  name: default-dashboard
spec: {}
  # managementState defaults to Managed.
  # Off OpenShift, add a domain to get a URL:
  # gateway:
  #   domain: dashboard.example.com
```

With no `spec.components` map at all (`nil`), the DSC gate is skipped and **every** module in the registry deploys -- your module included. Modules with a DSC requirement are only filtered out once `spec.components` is set. See [Modules & Federation](../guide/operator/modules-and-federation).

```bash
oc apply -f dashboard-cr.yaml
```

**What you should see:** the reconciler wakes up. Watch its logs:

```bash
oc logs -n odh-dashboard-operator-system deploy/dashboard-operator -f
```

Trimmed (the development zap format adds timestamps and the controller name to each line):

```
INFO  Reconciling Dashboard  {"name": "default-dashboard"}
INFO  Deployed module  {"module": "myModule", "slug": "my-module"}
INFO  Patched federation config hash on deployment  {"deployment": "odh-dashboard", "hash": "..."}
INFO  Dashboard reconciled successfully  {"url": "...", "modules": 12}
```

The module you registered in Tutorial 8 gets its manifests applied, its entry added to the federation ConfigMap, and -- if the ConfigMap changed -- the dashboard rolling-restarts. That is the reconcile pipeline running for real. If the Route isn't admitted yet you'll see `Dashboard reconcile cycle complete, requeuing` instead, and a retry 10 seconds later.

Inspect the CR's status to see conditions the reconciler wrote back:

```bash
oc get dashboard default-dashboard -o yaml | less
```

Look for `status.conditions` and per-module status -- the operator reports what it did through the status subresource.

## Step 6: Run in Dev Mode (the Fast Loop)

Rebuilding and repushing an image for every code change is painfully slow. For development, run the operator **on your laptop** against the cluster. It uses your kubeconfig, so it can watch and apply resources exactly as the in-cluster pod would.

First, scale the in-cluster operator to zero so two reconcilers do not fight:

```bash
oc scale deploy/dashboard-operator -n odh-dashboard-operator-system --replicas=0
```

Then run the manager from source. It needs a namespace and a path to the manifests directory (in-cluster this is `/opt/manifests/dashboard`; locally it is the repo's `manifests/`). Export the names the chart would normally inject, so teardown protection and image resolution behave the same as in-cluster:

```bash
export OPERATOR_DEPLOYMENT_NAME=dashboard-operator          # matches --set namePrefix=
export OPERATOR_SERVICE_ACCOUNT_NAME=dashboard-operator
export OPERATOR_CONFIGMAP_NAME=odh-dashboard-config
# export RELATED_IMAGE_ODH_MOD_ARCH_MY_MODULE_IMAGE=quay.io/<you>/my-module:dev   # optional image overrides
```

```bash
cd dashboard-operator
go run ./cmd/manager \
  --namespace=odh-dashboard-operator-system \
  --manifests-base-path=../manifests \
  --leader-elect=false
```

Or use the Makefile shortcut, which passes `--namespace` and `--manifests-base-path` (leader election is already off by default):

```bash
make run NAMESPACE=odh-dashboard-operator-system MANIFESTS_BASE_PATH=../manifests
```

::: warning Dev Mode Rewrites `params.env` in Your Checkout
Before rendering, the operator writes the computed parameters and image refs into the `params.env` files under `--manifests-base-path` (`writeParamsEnv`, called for the main manifests and for every module). Pointed at `../manifests`, that is **your working tree**: after a run, `git status` shows modified `params.env` files. Run `git restore manifests/` before committing, or point `--manifests-base-path` at a copy (`cp -r ../manifests /tmp/dash-manifests`).
:::

**What you should see:** the manager starts locally and immediately reconciles the existing CR, logging to your terminal:

```
INFO  setup  Detected platform  {"platform": "..."}
INFO  setup  Starting manager
INFO  Starting Controller  {"controller": "dashboard", ...}
INFO  Reconciling Dashboard  {"name": "default-dashboard"}
```

Now edit a reconciler file, `Ctrl+C`, and re-run -- seconds, not minutes. This is your inner loop.

::: tip Debugging with Delve
For breakpoints, run under Delve instead of `go run`:

```bash
dlv debug ./cmd/manager -- \
  --namespace=odh-dashboard-operator-system \
  --manifests-base-path=../manifests --leader-elect=false
```

Set a breakpoint in `Reconcile` (`internal/controller/dashboard_controller.go`), apply/modify the CR, and step through the pipeline live. `--leader-elect=false` matters -- leader election adds startup latency and lease churn you do not want while debugging.
:::

## Step 7: Clean Up

When you are done, restore the in-cluster operator (or tear everything down):

```bash
# Restore the in-cluster operator
oc scale deploy/dashboard-operator -n odh-dashboard-operator-system --replicas=1

# Or remove everything
oc delete -f dashboard-cr.yaml        # cluster-scoped, no -n
helm uninstall dashboard -n odh-dashboard-operator-system
oc delete crd dashboards.components.platform.opendatahub.io   # helm uninstall keeps CRDs
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
- [ ] `helm install` (with `--set namespace=` and `--set namePrefix=`) created the `Dashboard` CRD and a `Running` operator pod in your namespace
- [ ] Applying a `Dashboard` CR produces reconcile logs and populates `status.conditions`
- [ ] `make run` (or `go run ./cmd/manager`) runs the operator locally against the cluster, and you ran `git restore manifests/` afterwards
- [ ] You can explain why you scale the in-cluster operator to 0 before running dev mode

</div>

::: info If You Get Stuck
- [The Dashboard Operator](../guide/operator/index) -- architecture and repo layout
- [The Reconciler](../guide/operator/reconciler) -- the pipeline you just watched run
- [Operator Testing](../guide/operator/testing) -- envtest, for iterating without a cluster at all
- [Development Workflow](../guide/workflow/index) -- Makefile targets, debugging, common mistakes
- `docs/dashboard-operator.md` and `dashboard-operator/AGENTS.md` in the repo -- the operator's own docs (the latter still names some old file names; trust the code)
:::

## Congratulations -- You've Finished the Tutorials

You started by writing a single GET handler and you have arrived here: building an operator image, deploying it to a cluster, and reconciling a real custom resource. Along the way you learned the BFF request lifecycle, testing, inter-BFF communication, module onboarding, operator registration, and the deploy loop. That is the entire Go realm of the ODH Dashboard, end to end.

Where to go next:
- **Go deeper on the operator internals** → [The Dashboard Operator](../guide/operator/index) guide (Part 5).
- **Sharpen your daily workflow** → [Development Workflow](../guide/workflow/index) (Part 6).
- **Keep the reference handy** → the [Cheat Sheet](../reference/cheat-sheet), [Gotchas](../reference/gotchas), and [Glossary](../reference/glossary).
