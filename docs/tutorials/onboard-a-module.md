# Tutorial 7: Onboard a New Module

So far you have written code *inside* existing BFFs. Now you will create a whole new one -- a federated module: its own package, its own frontend, its own Go BFF, its own ports, registered with the host dashboard so it shows up in the nav. This is the "new page in the app" task, but at the architecture level.

The good news: you do not do this by hand. There is a scaffolder (`mod-arch-installer`) and a skill (`/module-onboarding`) that does the tedious parts. This tutorial walks you through what they do, so when you run the skill you understand every file it touches.

**Time:** ~40 minutes

::: info The React Analogy
Adding a federated module is like adding a new micro-frontend that the shell loads at runtime via Module Federation. The host dashboard is the shell; your module is a remote it mounts. You register a feature flag, a nav entry, and a route -- then the shell knows how to find and render your module. If you have ever added a lazy-loaded route in a big React app, this will feel familiar.
:::

## Step 1: Pick a Name and Derive Its Variants

Everything flows from one **kebab-case** name. Pick yours -- this tutorial uses `my-module`. From it, a fixed set of variants and identifiers is derived. You do not invent these; they follow rules:

| Variant | Rule | `my-module` becomes |
|---------|------|---------------------|
| kebab-case | as-is | `my-module` |
| camelCase | drop hyphens, capitalize after first | `myModule` |
| UPPER_SNAKE | hyphens → `_`, uppercase | `MY_MODULE` |
| Title Case | capitalize words | `My Module` |

And the derived identifiers you will see throughout:

| Identifier | Pattern | Example |
|------------|---------|---------|
| Package name | `@odh-dashboard/<kebab>` | `@odh-dashboard/my-module` |
| Directory | `packages/<kebab>/` | `packages/my-module/` |
| Module Federation name | `<camelCase>` | `myModule` |
| SupportedArea enum | `PLUGIN_<UPPER_SNAKE>` | `PLUGIN_MY_MODULE` |
| Feature flag key | `<camelCase>` | `myModule` |
| Proxy path | `/<kebab>/api` | `/my-module/api` |

::: tip Let the Skill Do This
`/module-onboarding my-module` computes all of these for you and validates the name is kebab-case and that `packages/my-module/` does not already exist. This step exists so you can *read* the generated code and know why `myModule` appears in one file and `PLUGIN_MY_MODULE` in another.
:::

## Step 2: Allocate Ports

A module claims three ports, each from a different range and tracked in a different file. Before scaffolding, find the next free one in each range.

```bash
# Frontend dev server port (9100–9399)
jq -r '."module-federation".local.port // empty' packages/*/package.json 2>/dev/null \
  | awk '$1>=9100 && $1<=9399' | sort -n

# BFF proxy port (4000–4099)
grep -r 'PROXY_PORT=' packages/*/Makefile | grep -oE '[0-9]{4,5}' | sort -n

# Production service port (8043–8943, ~100 apart)
grep 'Port:' dashboard-operator/internal/controller/modules.go | grep -oE '[0-9]{4}' | sort -n
```

**What you should see:** three sorted lists of ports already in use. Pick the next free value in each range -- say frontend `9110`, BFF proxy `4010`, service `8043` if open.

| Purpose | Range | Lives in |
|---------|-------|----------|
| Frontend dev server | 9100–9399 | `package.json` → `module-federation.local.port` |
| BFF proxy port | 4000–4099 | `Makefile` → `PROXY_PORT` |
| Production service | 8043–8943 | `package.json` → `module-federation.service.port` **and** `modules.go` |

::: warning The Service Port Is Shared with the Operator
The production **service** port is written in two places that must agree: your `package.json` and the operator's `modules.go` registry (Tutorial 8). If they drift, the operator deploys a Service on one port while the container listens on another. Keep them identical.
:::

## Step 3: Scaffold with mod-arch-installer

From the `packages/` directory, run the installer:

```bash
cd packages
npx mod-arch-installer -n my-module
```

**What you should see:** the installer generating a full module skeleton under `packages/my-module/`. Here is what it produces and why each piece matters:

- **`package.json`** with the `module-federation` block -- the module's identity card:

  ```json
  {
    "module-federation": {
      "name": "myModule",
      "remoteEntry": "/remoteEntry.js",
      "authorize": true,
      "tls": false,
      "proxy": [{ "path": "/my-module/api", "pathRewrite": "/api" }],
      "local": { "host": "localhost", "port": 9110 },
      "service": { "name": "odh-dashboard-my-module-ui", "port": 8043 }
    }
  }
  ```

- **`frontend/config/moduleFederation.js`** -- uses `OdhFederationPlugin` and computes `isHost` from `process.env.DEPLOYMENT_MODE === 'standalone'`, and `exposes` `./extensions`. Standalone builds eager-share React/PatternFly; federated remotes consume them from the host.
- **`frontend/src/odh/extensions.ts`** -- stub `app.area`, `app.navigation`, and `app.route` extensions (this is how the host discovers your nav entry and route).
- **`Makefile`** -- `PORT`, `PROXY_PORT`, and the standard dev targets.
- **`tsconfig.json`, `jest.config.ts`, `.eslintrc.js`** -- wired to the monorepo.

::: tip You Do Not Maintain a `shared` Map
`OdhFederationPlugin` applies the shared-singleton policy for React, PatternFly, and ODH packages automatically. Do not hand-write a `shared: {...}` block -- just make sure those packages are in the frontend `package.json` dependencies. This is the single biggest "why is React loaded twice?" footgun the plugin removes for you.
:::

If the installer fails (offline, npm hiccup), the fallback is to copy an existing module (e.g. `packages/eval-hub/`) and rename. The skill handles this automatically.

## Step 4: Register the Module in the Host (3 Files)

The scaffold exists, but the host dashboard does not know about it yet. Registration is a **three-file** feature-flag pattern. This is the part people forget, so do it carefully.

**File 1 -- `frontend/src/k8sTypes.ts`:** add the flag to `DashboardCommonConfig`:

```typescript
export type DashboardCommonConfig = {
  // ... existing flags ...
  myModule?: boolean;   // ← the feature flag, optional boolean
};
```

**File 2 -- `frontend/src/concepts/areas/types.ts`:** add the SupportedArea enum entry:

```typescript
export enum SupportedArea {
  // ... existing entries ...
  /* Plugins */
  PLUGIN_MY_MODULE = 'plugin-my-module',
}
```

**File 3 -- `frontend/src/concepts/areas/const.ts`:** wire the default **and** the state map:

```typescript
// (a) default the flag on for local dev
export const devTemporaryFeatureFlags = {
  // ... existing flags ...
  myModule: false,
} satisfies Partial<DashboardCommonConfig>;

// (b) connect the area to its flag
export const SupportedAreasStateMap: SupportedAreasState = {
  // ... existing entries ...
  [SupportedArea.PLUGIN_MY_MODULE]: {
    featureFlags: ['myModule'],
  },
};
```

::: warning These Three Files Are a Set
If you add the enum (File 2) but forget the type (File 1), `type-check` fails with *"feature flag name not assignable to FeatureFlag"* in `const.ts`. The three files must move together. This is the single most common onboarding mistake.
:::

## Step 5: Check the Dockerfile

Federated modules ship with `packages/my-module/Dockerfile.workspace` -- a multi-stage build (Node frontend builder → optional Go BFF builder → minimal runtime). If the installer did not create one, copy `packages/plugin-template/Dockerfile.workspace`. You will actually build it in Step 6.

## Step 6: Build Verification (Stop on the First Failure)

Run these in order. Each one must pass before the next -- a failure here means a failure in CI, so catch it now.

```bash
# From the repo root
npm install                        # pick up the new workspace package
```

**What you should see:** npm resolving and linking the new `@odh-dashboard/my-module` workspace.

```bash
npm run validate:ports             # no duplicate ports across all modules
```

**What you should see:** a success line. If it reports a duplicate, go back to Step 2 and pick a free port.

```bash
npm run type-check                 # the 3-file registration must be consistent
```

**What you should see:** no type errors. Errors here almost always mean Step 4 is incomplete.

```bash
cd packages/my-module/bff && go build ./cmd    # the BFF compiles (if you kept the BFF)
```

**What you should see:** silence. If it fails on imports, run `go mod tidy` and retry.

```bash
# Optional -- slower; earlier steps already prove correctness
podman build --file ./packages/my-module/Dockerfile.workspace .
# or: docker build --file ./packages/my-module/Dockerfile.workspace .
```

**What you should see:** a successful multi-stage build. You can defer this in a hurry -- the type-check and `go build` above are the fast signal.

## Step 7: Run It Locally

Start the module (frontend + BFF together) with its Makefile:

```bash
cd packages/my-module
make dev-start-federated
```

**What you should see:** the frontend dev server on your allocated port (`9110`) and the BFF on its proxy port (`4010`), both logging startup. Enable the `myModule` flag locally, load the host dashboard, and your module's nav entry appears -- rendered as a Module Federation remote.

::: tip Two Ways to Enable the Flag Locally
`devTemporaryFeatureFlags` (Step 4a) turns it on in dev automatically. If you set it to `false` there, you can still flip it at runtime via the dashboard's dev feature-flags panel. In the cluster the flag is driven by the `Dashboard` CR + DSC gates (Tutorial 8).
:::

## What the Skill Automates

Everything above maps to `/module-onboarding my-module` phases:

| You saw | Skill phase |
|---------|-------------|
| Name variants + validation | Phase 0 |
| Port allocation | Phase 1 |
| `mod-arch-installer` scaffold | Phase 2 |
| 3-file host registration | Phase 3 |
| Dockerfile check | Phase 4 |
| Build verification | Phase 5 |

Note what is **deferred**: standalone deployment manifests and operator registration. The skill hands those to `/konflux-onboarding` on purpose -- the operator deploys your module's *image*, so the image has to be buildable in CI first, or the pod hits `ImagePullBackOff`. That is exactly the next tutorial.

---

<div class="checkpoint">

#### Checkpoint

Before moving on, verify:

- [ ] `packages/my-module/` exists with `package.json` (module-federation block), `frontend/`, `Makefile`, and a BFF
- [ ] All three host files edited: `k8sTypes.ts`, `areas/types.ts`, `areas/const.ts`
- [ ] `npm run validate:ports` passes (no duplicate ports)
- [ ] `npm run type-check` passes (registration is consistent)
- [ ] `cd packages/my-module/bff && go build ./cmd` succeeds
- [ ] `make dev-start-federated` runs and the module appears in the host nav

</div>

::: info If You Get Stuck
- `.claude/skills/module-onboarding/reference.md` -- the full name/port/flag reference
- [Distributions](../guide/architecture/distributions) -- how modules relate to the deployable images
- [Modules & Federation](../guide/operator/modules-and-federation) -- how the operator wires modules together
:::

## What's Next

Your module builds and runs locally, but the operator does not yet know it exists, and there are no cluster manifests to deploy it. In [Register a Module in the Operator](./register-module-in-operator), you will create the standalone manifests and add the module to the operator's registry so it can be deployed and controlled in a real cluster.
