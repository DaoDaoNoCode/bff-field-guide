# Development Workflow

> **The day-to-day mechanics** -- how a repo with many independent Go modules actually gets built, tested, and navigated, and how to make your editor understand all of it at once.

You've read how BFFs work and how the operator reconciles. This part is about the *keyboard-level* reality of working in the Go side of the monorepo: where the `go.mod` files live, why `go test ./...` from the repo root does nothing, and how to set up `go.work` so gopls stops complaining. It's short and practical -- the stuff nobody writes down but everyone trips over on day one.

::: info Who This Is For
This part assumes you've met both worlds already -- the [BFF deep dive](/guide/deep-dive/entry-point) and the [dashboard-operator](/guide/operator/). If some of the make targets or envtest references are unfamiliar, that's fine; the next two pages ([Make Targets](./make-targets) and [Debugging](./debugging)) cover them in detail. This page is about *layout and setup*.
:::

## Not a Single Module -- Many

If you come from npm, your instinct is that a repo has one dependency graph coordinated from the root. A single `package.json`, one `node_modules`, `npm install` at the top and everything's wired together.

Go in this monorepo is the opposite. There is **no root `go.mod`**. Each BFF and the operator is its own independent Go module, with its own `go.mod`, its own `go.sum`, and its own dependency versions:

```text
odh-dashboard/
├── dashboard-operator/
│   └── go.mod          # github.com/opendatahub-io/odh-dashboard/dashboard-operator
├── distributions/
│   └── core-bff/
│       └── bff/
│           └── go.mod  # .../distributions/core-bff/bff
├── packages/
│   ├── gen-ai/
│   │   └── bff/
│   │       └── go.mod  # .../packages/gen-ai/bff
│   └── maas/
│       └── bff/
│           └── go.mod  # .../packages/maas/bff
```

Three consequences follow directly from this, and each one bites newcomers:

::: warning The Three Gotchas of a Multi-Module Repo
1. **`go test ./...` from the repo root does nothing.** There's no `go.mod` there, so Go has no module to walk. You must `cd` into a module first (or use a `make` target that does).
2. **Dependencies are not shared.** Each module pins its own versions in its own `go.sum`. Bumping a library in the operator does *not* bump it in the BFFs.
3. **Your editor only sees one module by default.** gopls (the Go language server) indexes the first `go.mod` it finds and ignores the rest -- so cross-module "go to definition" silently fails until you fix it (see [go.work](#tie-it-together-for-your-editor-with-go-work) below).
:::

This is the npm-monorepo-vs-Go-monorepo mental flip: think **git submodules that happen to live in one repo**, not **npm workspaces**.

## Go Versions Per Module

Because each module is independent, they don't have to agree on a Go toolchain version -- and they don't. Here's the current landscape:

| Module | Location | Go version | controller-runtime |
|---|---|---|---|
| Dashboard Operator | `dashboard-operator/` | 1.26 | v0.23.3 |
| Core BFF | `distributions/core-bff/bff/` | 1.25 | v0.22.3 |
| Gen AI BFF | `packages/gen-ai/bff/` | 1.26 | -- |
| MaaS BFF | `packages/maas/bff/` | 1.26 | -- |
| Other BFFs | `packages/*/bff/` | varies | -- |

::: tip One Install Covers Everything
You don't need multiple Go installations. The `GOTOOLCHAIN` directive in each `go.mod` handles version negotiation automatically -- install the *highest* version any module requires (1.26) and Go transparently uses the right toolchain for a module that asks for 1.25. It's the closest thing Go has to `nvm`, except you don't manage it manually.
:::

```bash
# macOS with Homebrew -- install the highest required version
brew install go

# Verify
go version
# go version go1.26.x darwin/arm64
```

## Tie It Together for Your Editor with `go.work`

The third gotcha above -- gopls only seeing one module -- is the one that actually slows you down all day. The fix is a `go.work` file at the repo root that tells the Go toolchain "these directories are all part of one workspace."

::: info `go.work` Is the `tsconfig` `references` of Go
If you've used TypeScript project references (a root `tsconfig.json` with a `references` array pointing at sub-projects so the language server resolves symbols across them), `go.work` is the exact same idea. It doesn't change how anything *builds* -- each module still builds independently -- it only teaches your editor's language server to index all of them at once.
:::

Create `go.work` at the repo root. **Do not commit it** -- it's gitignored, because everyone's set of modules-in-flight differs:

```go
// go.work (gitignored)
go 1.26

use (
    ./dashboard-operator
    ./distributions/core-bff/bff
    ./packages/gen-ai/bff
    ./packages/maas/bff
)
```

Add whichever modules you're actively working across. With this in place, gopls gives you cross-module go-to-definition, completion, and refactoring -- and stops flagging imports it "can't resolve."

::: tip VS Code Restart
After creating or editing `go.work`, run **Go: Restart Language Server** from the command palette (or reload the window). gopls reads the workspace file at startup and won't pick up changes live.
:::

## Where to Go Next

- **[Make Targets](./make-targets)** -- the BFF and operator Makefiles side by side: `build`, `test`, `lint`, plus the operator's codegen targets (`generate`, `manifests`) and the BFF mock flags.
- **[Debugging](./debugging)** -- `log/slog`, Delve, mock modes, envtest binary setup, and a "Common Mistakes" list distilled from real onboarding pain.

::: tip Key Takeaway
The Go side of this repo is **many independent modules, not one workspace**. There's no root `go.mod`, so you run Go commands from inside a module (or via `make`); dependencies and Go versions are per-module; and you install the single highest Go version (1.26) since `GOTOOLCHAIN` negotiates the rest. The one setup step that pays off immediately is a gitignored `go.work` at the root so your editor indexes every module at once.
:::

::: info See Also
- [Make Targets](./make-targets) -- the build/test/lint/codegen commands for each module
- [Debugging](./debugging) -- logging, Delve, mocks, and envtest setup
- [The Dashboard Operator](/guide/operator/) -- the operator module this workflow builds
- [BFF Deep Dive](/guide/deep-dive/entry-point) -- the BFF modules this workflow builds
:::

---

<div class="checkpoint">

#### Before You Continue

Make sure you can answer these:
- [ ] Why does `go test ./...` from the repo root do nothing?
- [ ] Are dependencies and Go versions shared across modules, or per-module?
- [ ] Why is it enough to install only Go 1.26 even though core-bff asks for 1.25?
- [ ] What does `go.work` do, what TypeScript feature is it analogous to, and why is it gitignored?
- [ ] What must you do in VS Code after editing `go.work`?

</div>
