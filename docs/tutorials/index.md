# Hands-On Tutorials

These tutorials are designed to get your hands dirty. Each one builds a real piece of BFF code that you can commit to the repo. No reading about theory, no watching someone else type. You will write Go, run it, break it, fix it, and walk away with code that actually works.

If you have been reading the guide sections and thinking "okay, but how do I actually *do* this?" -- this is where that changes.

## What Makes These Different

Every tutorial follows three rules:

1. **You type every line.** No copy-pasting a finished file and hoping it works. You will build each file from scratch, one piece at a time, so you understand every line before moving to the next.
2. **You see exactly what happens.** After every command, we show the exact terminal output. If your output looks different, something went wrong and we will tell you how to fix it.
3. **TypeScript is the bridge.** Every Go concept gets explained through the lens of something you already know from React, Express, or Jest. We will not assume you have Go intuition yet.

## Before You Start

You need four things ready. If any of these fail, stop and fix them before starting Tutorial 1.

::: warning Verify Your Setup
Run these commands right now. Not later -- right now.

```bash
go version          # You need 1.24 or later
```

**What you should see:**

```
go version go1.24.3 darwin/arm64
```

The exact patch version and architecture do not matter, but the major version must be 1.24 or higher.

```bash
cd packages/automl/bff   # Navigate to the BFF we'll work in
go build ./...            # Compile everything -- should produce zero output
```

**What you should see:** Absolutely nothing. No output means success. If you see errors, your Go toolchain or the repo is not set up correctly. Go back to [Setting Up Go](/guide/setup) and work through it.
:::

**Your full checklist:**

- [x] **Go 1.24+** installed and working
- [x] The **odh-dashboard repo** cloned locally
- [x] **VS Code** with the [Go extension](https://marketplace.visualstudio.com/items?itemName=golang.go) installed and configured
- [x] You have read **Part 1** (Go for TypeScript Devs), **Part 2** (BFF Architecture), and **Part 3** (BFF Deep Dive) -- or at least the sections on types, structs, functions, error handling, JSON, and HTTP servers

## The Tutorials

Work through these in order. Each one builds on concepts from the previous one. Skipping ahead is like skipping to `useEffect` before learning `useState` -- technically possible, but you will be confused.

| # | Tutorial | What You Will Build | Time |
|---|---------|-------------------|------|
| 1 | [Your First GET Endpoint](./first-get-endpoint) | A detailed healthcheck endpoint that returns system info -- your very first Go handler | ~20 min |
| 2 | [POST with Validation](./post-with-validation) | A POST endpoint that accepts JSON, validates every field, and returns structured error messages | ~25 min |
| 3 | [Writing Handler Tests](./writing-tests) | Go unit tests using `httptest` and table-driven patterns -- the Go equivalent of Jest | ~25 min |
| 4 | [Mock Clients](./mock-clients) | A mock implementation of a service interface -- Go's answer to `jest.mock()` | ~20 min |
| 5 | [Contract Tests](./contract-tests) | A TypeScript contract test that validates your BFF endpoint against an OpenAPI schema | ~15 min |

## What You Will Have When You Finish

By the end of all five tutorials, you will have:

- **Added a new endpoint to a real BFF** from scratch -- model, handler, route, the whole thing
- **Written a handler that reads and validates JSON request bodies** -- the pattern behind every POST/PUT/PATCH endpoint in the codebase
- **Created Go unit tests** with `httptest.NewRecorder` and table-driven patterns -- the same patterns used in the production BFF tests
- **Built mock implementations** of service interfaces -- Go's explicit, readable alternative to `jest.mock()`
- **Written a contract test in TypeScript** using the `@odh-dashboard/contract-tests` framework -- proving that your frontend and BFF agree on the API shape

These are not toy exercises. These are the exact skills you need to open a PR with BFF code.

## Which BFF Are We Working In?

All tutorials use `packages/automl/bff/` as the working directory. We picked automl because it has a clean, representative structure -- not too big, not too small. But here is the important thing: **all seven BFFs in the repo follow the same patterns.** The directory layout, the middleware chain, the error envelope, the testing approach -- all identical. Once you can write code in automl, you can write code in `gen-ai`, `maas`, `autorag`, `eval-hub`, `mlflow`, or any future BFF.

::: tip Do Not Commit Tutorial Code
These tutorials have you write code in the real repo so the experience is as realistic as possible. When you finish, you have two options:

1. **Discard everything:** `git checkout -- packages/automl/bff/` -- poof, gone
2. **Keep it on a practice branch:** `git checkout -b my-bff-practice` -- save it for reference

Either way, do not open a PR with tutorial exercise code. Save your PRs for the real thing.
:::

## Ready?

Open your terminal. `cd` into the odh-dashboard repo. Take a breath. Let's write some Go.

[Start Tutorial 1: Your First GET Endpoint -->](./first-get-endpoint)
