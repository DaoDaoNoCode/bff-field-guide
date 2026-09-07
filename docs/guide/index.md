# Introduction

You've been writing React components for years. You can build a form, manage state, call an API. You've debugged more `useEffect` dependency arrays than you care to admit, and you've gotten into at least one argument about whether to use Zustand or Redux. You're comfortable in TypeScript. You _live_ in TypeScript.

But then you open a `bff/` directory and suddenly you're looking at `.go` files, and the code looks like someone wrote JavaScript in a parallel universe where semicolons disappeared, errors are returned instead of thrown, and every function has two return values for some reason. Your editor is showing you red squiggles you've never seen before. The syntax is _almost_ familiar -- close enough to be disorienting, like trying to read Portuguese when you speak Spanish.

This guide exists because that feeling is completely normal, and it goes away faster than you think.

## Who This Guide Is For

This guide is written for **frontend engineers on the ODH Dashboard team** -- people who write React and TypeScript every day but now need to work on the Go backend layer. Maybe one of these scenarios sounds familiar:

**The JIRA ticket scenario.** You pick up a ticket that says "Add a new endpoint to the gen-ai BFF." You open the `packages/gen-ai/bff/` directory and see folders named `cmd/`, `internal/`, `api/`. There's a `go.mod` file that looks vaguely like a `package.json` but with fewer fields. You find `main.go` and it starts with `package main` and you're not sure if that's like `export default` or something else entirely. You need to add an HTTP handler, but the existing handlers have this signature with `http.ResponseWriter` and `*http.Request` and `httprouter.Params`, and you're not sure what any of those asterisks and dots mean.

**The PR review scenario.** A teammate submitted a PR that touches Go code. You can see they added a new file in `internal/api/` with a handler function. The function does something with `json.NewDecoder(r.Body).Decode(&req)` and you want to know: is that safe? Does it handle errors properly? What happens if the request body is malformed? You can review TypeScript PRs in your sleep, but this Go code has patterns you've never seen before, and you don't want to just click "Approve" and hope for the best.

**The bug fix scenario.** There's a 500 error in production. The logs show it's coming from the BFF layer -- specifically from the model-registry package. You can trace the API call from your React code to the BFF endpoint, but once you're in Go-land, you're stuck. What's a `SubjectAccessReview`? Why does the error say `forbidden` when you're clearly logged in? You need to understand enough Go to follow the execution path and find the bug.

**The curiosity scenario.** You've been working on the frontend for months and you keep importing API functions that call endpoints like `/gen-ai/api/v1/lsd/models`. You've never actually seen what happens on the other side. How does the BFF authenticate you? How does it talk to Kubernetes? You want to understand the full picture -- not because someone assigned you a ticket, but because knowing how the whole system works makes you a better engineer.

If any of those sound like you, you're in the right place.

::: info No Go Experience Required
Every concept in this guide is explained from scratch, with direct comparisons to TypeScript and JavaScript. We start with "what is `package main`?" and build from there. If you can write a TypeScript interface and call `fetch`, you have everything you need. The goal is not to make you a Go expert -- it's to make you dangerous enough to read, write, and debug BFF code with confidence.
:::

## Why Go? (And Why Not Just Use Node.js?)

This is the first question every frontend developer asks, and it's a fair one. You already know JavaScript. You could write a BFF in Express or Fastify in your sleep. Why learn a whole new language?

The answer isn't one thing -- it's a combination of factors that add up. Let me walk through each one, not just as a bullet point, but as a "here's what this means for your daily work" explanation.

### Go is a first-class citizen in the Kubernetes world

The ODH Dashboard BFFs don't just serve HTTP requests. They talk to Kubernetes -- creating resources, checking permissions, watching for changes. Kubernetes itself is written in Go, and its official client library (`client-go`) is the gold standard. When you use `client-go`, you're using the same code that Kubernetes uses internally.

**What this means for you:** When you need to perform a SubjectAccessReview (checking if a user has permission to do something in a namespace), there's a Go function for it that's well-documented, battle-tested, and exactly matches the Kubernetes API. In Node.js, you'd be using a third-party wrapper that's always playing catch-up with the Go version.

### Compiled to a single binary

When you build a Go program, you get one file. Not a folder of `.js` files plus `node_modules` plus a Node.js runtime. One binary. You can `scp` it to a server, run it, and it works. No "which version of Node do I need?" No "did you run `npm install`?"

**What this means for you:** The BFF Docker images are tiny -- around 20-30MB. Compare that to a Node.js image that needs the full Node.js runtime and all of `node_modules`, which easily hits 200MB+. Smaller images mean faster deployments, faster scaling, and less surface area for security vulnerabilities.

### Go is simple (on purpose)

Go has 25 keywords. TypeScript has... well, nobody's sure exactly, but it's a lot more. Go deliberately left out features that other languages have: no classes, no inheritance, no decorators, no operator overloading, no generics gymnastics (it has basic generics now, but they're intentionally limited). This isn't a limitation -- it's a design choice.

**What this means for you:** The learning curve is genuinely short. Unlike picking up Rust (which would take months to feel comfortable with the borrow checker) or Java (which drowns you in design patterns and boilerplate), Go can be productive-in-a-week territory. The language is small enough to hold in your head. There's usually one obvious way to do something, so reading other people's Go code is surprisingly easy.

### Concurrency is built into the language

JavaScript has the event loop, which is great for I/O-heavy work but means CPU-intensive operations block everything. Go has goroutines -- lightweight threads that cost almost nothing to create. You can spin up thousands of them without breaking a sweat.

**What this means for you:** When a BFF needs to make three API calls to different services (say, checking permissions, fetching models, and getting configuration all at once), it can do them concurrently with a few lines of code. No `Promise.all()` gymnastics, no callback hell, no worrying about whether your event loop is blocked.

### The toolchain is all-in-one

In the JavaScript ecosystem, you need separate tools for everything: Prettier for formatting, ESLint for linting, Jest for testing, webpack or Vite for building. Each one has its own config file. In Go, the `go` command does it all: `go fmt` formats, `go vet` lints, `go test` runs tests, `go build` compiles. No config files. No plugins. No compatibility matrices.

**What this means for you:** You can jump into a Go project and immediately run `go test ./...` without wondering "is it Jest? Vitest? Mocha? Where's the config?" It just works.

::: tip The Frontend Developer's Silver Lining
Here's the thing nobody tells you: Go is actually _easier_ to learn than most frontend developers expect. If you know TypeScript's type system, Go's will feel like a minimalist subset. Fewer concepts to learn means faster ramp-up. And Go's strict compiler catches entire categories of bugs that TypeScript lets slip through. You'll miss some of TypeScript's expressiveness, but you'll appreciate how rarely Go code surprises you at runtime.
:::

## Your First 5 Minutes: A Taste of Go

Before we set anything up, let's look at what you're getting into. I want you to see a Go HTTP server right now, compare it to what you already know, and realize that the gap between "TypeScript developer" and "Go developer" is smaller than you think.

Here's a tiny API server. On the left, the TypeScript version you could write with your eyes closed. On the right, the Go version you're about to learn.

**TypeScript (Express) -- what you know:**

```typescript
import express from 'express';              // Import the Express framework
                                             // You installed this with: npm install express

const app = express();                       // Create an Express application instance

app.get('/api/hello', (req, res) => {        // Register a GET route at /api/hello
                                             // (req, res) is the handler signature you know by heart
  res.json({ message: 'Hello from Express!' }); // Send a JSON response -- Express sets
                                                 // Content-Type and serializes for you
});

app.listen(8080, () => {                     // Start listening on port 8080
  console.log('Server running on :8080');    // Log a message when the server is ready
});
```

Six lines of actual code, plus an `npm install express` you ran earlier. You've written this a hundred times. Now here's the Go version:

**Go -- what you're about to learn:**

```go
package main                 // Every Go file starts with a package declaration
                             // "main" is special -- it means "this is a runnable program"
                             // Think of it like: this file is the entry point

import (                     // Import block -- like ES import statements
    "encoding/json"          // For JSON encoding/decoding (like JSON.stringify/parse)
    "fmt"                    // For formatted I/O (like console.log)
    "log"                    // For logging errors (like console.error)
    "net/http"               // The HTTP server package (like Express, but built-in!)
)                            // All four of these are from Go's standard library
                             // No "go install" needed -- they ship with Go itself

func main() {               // The entry point -- Go runs this function when you start the program
                             // Like: if (require.main === module) { main() }

    http.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {
        // Register a handler for /api/hello (all HTTP methods)
        // w = the response writer (like Express's "res")
        // r = the incoming request (like Express's "req")
        // Notice: the response comes FIRST, request comes SECOND
        // (yeah, it's backwards from Express -- you'll get used to it)

        json.NewEncoder(w).Encode(map[string]string{
            // Create a JSON encoder that writes to the response
            // Encode a map (like a JS object) with one key-value pair
            // map[string]string means: keys are strings, values are strings
            // This is like: res.json({ message: "Hello from Go!" })
            // Note: this simple example doesn't set Content-Type.
            // A real handler should call:
            //   w.Header().Set("Content-Type", "application/json")
            "message": "Hello from Go!",
        })
    })

    fmt.Println("Server running on :8080")   // Print to stdout (like console.log)
    log.Fatal(http.ListenAndServe(":8080", nil))
    // Start the HTTP server on port 8080
    // http.ListenAndServe blocks until the server shuts down
    // (unlike Express's app.listen, which returns immediately)
    // log.Fatal means: if ListenAndServe returns an error, print it and exit
    // The "nil" means "use the default request router"
}
```

### What just happened?

Let me break down the key differences you probably noticed:

**No semicolons.** Go doesn't use semicolons at the end of lines. The compiler inserts them automatically. This is one less thing to worry about (and one less Prettier rule to configure).

**The handler signature is different.** In Express, it's `(req, res)`. In Go, it's `(w http.ResponseWriter, r *http.Request)` -- and the order is flipped. The response writer comes first. This trips up every JavaScript developer exactly once. You'll remember it after that.

**No `res.json()` convenience method.** Instead of calling `res.json(data)`, you create a JSON encoder, point it at the response writer, and tell it to encode your data. This is more explicit -- you can see exactly what's happening -- but it's definitely more typing. You'll build helper functions to wrap this, and the BFF codebase already has them.

**Everything is from the standard library.** The `net/http` package gives you a production-grade HTTP server. The `encoding/json` package handles JSON. No `npm install` needed. This is one of Go's most beloved features -- the standard library is so complete that many Go projects have zero external dependencies.

**Types are explicit.** `map[string]string` means "a map (object) where both keys and values are strings." In TypeScript, that's `Record<string, string>`. Go makes you spell out the types of your data structures, but in return, the compiler catches type mismatches before your code ever runs.

::: tip The Pattern You'll See Everywhere
In Go, you write things out explicitly that frameworks would hide. This feels verbose at first, but it means you always know exactly what's happening. There's no "how does Express parse the body?" mystery -- you call `json.NewDecoder(r.Body).Decode(&myStruct)` and that's it. No middleware magic. No hidden behavior. Every line does exactly what it says.

After a week of writing Go, this transparency starts to feel like a superpower. "Where does the authentication happen?" is never a mystery -- you can trace every line.
:::

## How This Guide Is Structured

This guide is organized into six progressive parts, followed by hands-on tutorials and reference material. The first three parts get you fluent in Go and the BFF layer; the last three take you into Kubernetes, the `dashboard-operator`, and the day-to-day development workflow that ties the whole Go side of the repo together. Each part builds on the previous one, so going in order is recommended -- but feel free to jump around if you need to fix a bug _right now_ and can't wait.

::: tip Already Know Go?
If you have written Go before (even a little), skip Part 1 and jump straight to [What is a BFF?](./architecture/what-is-bff). Part 1 teaches Go through TypeScript equivalents -- valuable if Go is new to you, but skippable if you already know the basics. You can always circle back to specific chapters (like [JSON](./go-basics/json) or [Interfaces](./go-basics/interfaces)) when you hit something unfamiliar.
:::

::: info Pick Your Learning Path
There are two Go codebases in this repo -- the **BFFs** (the per-module HTTP services your React app calls) and the **dashboard-operator** (the Kubernetes controller that deploys those modules). You don't have to learn both at once:

- **BFF track** -- Parts 1 → 2 → 3, then Tutorials 1–6. Everything you need to add endpoints and wire inter-BFF calls.
- **Operator track** -- Part 1 (skim), then Parts 4 → 5 → 6, then Tutorials 7–9. For controller-runtime, the Dashboard CRD, and deploying the operator.
- **Full track** -- Parts 1 → 6 in order, then all nine tutorials. The complete tour of the repo's Go realm.

Part 6 (Development Workflow) is shared -- come back to it whichever track you take.
:::

### Part 1: Go for TypeScript Devs

This is where you learn the language itself. Every section shows the TypeScript way and the Go way side by side, so you always have a familiar anchor point.

- **[Types & Variables](./go-basics/types-and-variables)** -- `let`/`const` vs `:=`/`var`, primitive types, zero values, and why Go doesn't have `undefined`. _After this chapter, you'll be able to read variable declarations in any Go file and understand what type each variable is._

- **[Structs](./go-basics/structs)** -- Go's answer to classes, but without inheritance or constructors. _After this chapter, you'll be able to read and write struct definitions, which is 90% of what you'll encounter in BFF model files._

- **[Functions & Methods](./go-basics/functions-and-methods)** -- Multiple return values, method receivers, and why Go doesn't have `this` (but has something similar). _After this chapter, you'll understand handler function signatures and how methods attach to structs._

- **[Error Handling](./go-basics/error-handling)** -- No `try`/`catch`. The `if err != nil` pattern and why it actually makes sense once you stop fighting it. _After this chapter, you'll be able to read and write error handling code, which is probably 30% of all Go code you'll see._

- **[Pointers](./go-basics/pointers)** -- The one concept with no TypeScript equivalent. What `*` and `&` mean, and why you'll see them everywhere. _After this chapter, you'll stop panicking when you see `*http.Request` in a function signature._

- **[Interfaces](./go-basics/interfaces)** -- Implicit satisfaction means no `implements` keyword. If your struct has the right methods, it satisfies the interface. Period. _After this chapter, you'll understand how the middleware chain works and how mock clients are swapped in for testing._

- **[Slices & Maps](./go-basics/slices-and-maps)** -- Arrays and objects, but with important differences in how they behave. _After this chapter, you'll be able to work with collections of data in handlers._

- **[Packages & Modules](./go-basics/packages)** -- `go.mod` is your `package.json`, and the import system has some surprising rules. _After this chapter, you'll understand the BFF directory structure and how files relate to each other._

- **[JSON](./go-basics/json)** -- Struct tags, marshaling, unmarshaling, and why `` `json:"fieldName"` `` exists. _After this chapter, you'll be able to define request and response types for your endpoints._

- **[HTTP Servers](./go-basics/http)** -- Building APIs with `net/http` and `httprouter`, the library the BFFs actually use. _After this chapter, you'll understand how routes are registered and how request handlers work._

- **[Testing](./go-basics/testing)** -- `go test`, table-driven tests, and `httptest` for testing HTTP handlers without starting a real server. _After this chapter, you'll be able to write tests for any handler you create._

### Part 2: BFF Architecture

Before diving into code, you need to understand the big picture. This part explains the architecture: what a BFF is, why it exists, and how requests flow through the system.

- **What a BFF is** and why it sits between your React app and Kubernetes
- **The full request flow** from browser click to Kubernetes API call and back
- **How authentication and RBAC work** -- what happens when a user makes a request
- **The standard directory structure** every BFF follows and why

_After this part, you'll have a mental model of how the entire system fits together. You'll know where to look when something goes wrong._

### Part 3: BFF Deep Dive

Walking through real code from the ODH Dashboard repository, explained line by line. This is where everything from Parts 1 and 2 comes together.

- **The entry point** (`main.go`) and how the server starts up
- **The `App` struct** and route registration with `httprouter`
- **Writing request handlers** -- the actual code that runs when your React app calls an endpoint
- **The middleware chain** -- identity extraction, namespace validation, access checks, client attachment
- **Authentication methods** and RBAC with SubjectAccessReview
- **Models, DTOs, and the data layer** -- how data is structured as it moves through the BFF
- **Calling upstream services** -- how the BFF talks to LlamaStack, Model Registry, and other backends
- **Error handling patterns** and the error envelope -- how errors are structured and returned
- **Inter-BFF communication** -- how one BFF calls another (and how any BFF calls `core-bff`) with the `bffclient` package, service discovery, and user-token forwarding

_After this part, you'll be able to open any BFF in the repo and read it like a book._

### Part 4: Kubernetes for Go Developers

A bridge chapter. Before you can read operator code, you need a working mental model of the Kubernetes concepts it's built on -- explained the same way as everything else, through things you already know.

- **Resources & CRDs** -- what a Custom Resource Definition is, the `Dashboard` CRD, kubebuilder markers, and CEL validation
- **RBAC & Access** -- ServiceAccounts, Roles, and the `SubjectAccessReview` checks you already met in the BFF auth layer
- **Controller concepts** -- finalizers, owner references, Server-Side Apply, and status conditions

_After this part, YAML manifests and CRD types will stop looking like magic._

### Part 5: The Dashboard Operator

A full deep dive into the `dashboard-operator/` -- the Kubernetes controller that deploys and manages every dashboard module.

- **controller-runtime** -- the Scheme, Manager, Controller, and Reconciler that every operator is built from
- **The Dashboard CRD** and the reconcile pipeline that turns spec into running pods
- **Modules & Federation** -- the module registry, dependency resolution, and the federation ConfigMap
- **The ODH Operator connection** -- how the platform operator projects config into the Dashboard CR

_After this part, you'll be able to trace a `Dashboard` CR from `kubectl apply` to running module pods._

### Part 6: Development Workflow

The practical glue: how to actually build, test, generate, and debug across the multi-module monorepo -- for both BFFs and the operator.

- **The monorepo** -- multiple `go.mod` files, `go.work`, and IDE setup
- **Make targets** -- the commands you'll run every day
- **Debugging & gotchas** -- Delve, structured logging, and the mistakes everyone makes once

### Tutorials

Hands-on, step-by-step exercises where you build real features. Each tutorial takes 30-60 minutes and produces working code.

1. **Your First GET Endpoint** -- Add a new read endpoint from scratch, with route registration, handler, and response types
2. **POST with Validation** -- Handle request bodies, validate input, and return proper error responses
3. **Writing Handler Tests** -- Unit test your handlers with `httptest` and mock clients
4. **Mock Clients** -- Create mock implementations for Kubernetes and upstream service clients
5. **Contract Tests** -- Validate that your API matches the OpenAPI specification
6. **Inter-BFF Communication** -- Wire the `bffclient` package end-to-end so one BFF can call another
7. **Onboard a New Module** -- Scaffold a new federated module with `mod-arch-installer` and register it in the host
8. **Register a Module in the Operator** -- Add standalone manifests and the operator registry entry that deploys it
9. **Build & Deploy the Operator** -- Build the operator image, deploy it to a cluster, and run it in dev mode

### Reference

Keep-it-open-while-you-code material for when you're writing Go and need a quick answer:

- **Go <-> TypeScript Cheat Sheet** -- Side-by-side syntax comparison for the patterns you'll use most
- **Common Gotchas** -- Mistakes every TypeScript developer makes in Go, and how to avoid them
- **Go CLI Quick Reference** -- Every `go` command you'll actually use
- **Glossary** -- Terms and concepts defined in plain English

## What You'll Be Able to Do

After working through this guide, you will be able to:

- **Read any BFF in the repo** and understand what it does -- the handler logic, middleware chain, authentication flow, and Kubernetes interactions. No more "I don't touch Go files."

- **Add a new API endpoint** to an existing BFF, including the handler, route registration, models, tests, and OpenAPI spec updates. This is the most common task you'll be assigned.

- **Write and run Go tests** using table-driven patterns, `httptest` for handler testing, and mock clients. You'll know the conventions and be able to follow them.

- **Debug BFF issues** by reading logs, understanding the request lifecycle, and tracing errors through the middleware chain. When something returns a 500 or 403, you'll know where to look.

- **Review Go PRs** with confidence. You'll catch common mistakes, suggest improvements, and understand the patterns well enough to know when something deviates from them.

- **Run the BFF locally** with mock flags for development without a cluster. You'll be able to start the BFF, hit it with `curl`, and iterate on your changes without needing a full OpenShift environment.

- **Read and reason about the dashboard-operator** -- follow a `Dashboard` CR through the reconcile pipeline, understand how modules get deployed, and know where to look when a module won't come up.

- **Onboard a new module end-to-end** -- scaffold it with `mod-arch-installer`, register it in the host, add its standalone manifests, and wire it into the operator so the platform can deploy it.

- **Build and deploy the operator** -- produce a container image with Docker or Podman, install it with Helm, and run it locally in dev mode against a real cluster.

## Prerequisites

Here's what you need before starting:

**What you should already know:**

- **TypeScript and React.** You understand types, interfaces, generics, hooks, and async/await. You don't need to be an expert -- intermediate is fine.
- **Basic HTTP concepts.** You know what GET, POST, PUT, and DELETE mean. You know what status codes like 200, 404, and 500 indicate. You've seen request headers before.
- **Terminal basics.** You're comfortable running commands, navigating directories, and reading command output.

**What you need installed:**

- **A macOS or Linux machine.** The setup instructions target macOS with Homebrew, but everything works on Linux too. Windows with WSL2 also works.
- **VS Code** (or your editor of choice). Technically optional, but the Go extension provides IntelliSense, auto-formatting, and go-to-definition that make learning significantly faster.
- **Homebrew** (macOS only). Run `brew --version` to check. If you don't have it, visit [brew.sh](https://brew.sh).

::: warning What You Do NOT Need
- **Prior Go experience.** That's literally the entire point of this guide.
- **Kubernetes expertise.** We'll explain what you need as we go. You don't need to know what a Pod is to understand the BFF code -- you just need to know that the BFF talks to a Kubernetes API, which is conceptually the same as your React app talking to a REST API.
- **Deep backend experience.** If you've ever called `fetch()` against an API, you understand the consumer side. Now you're learning the producer side. That's all.
:::

## Ready to Start?

Head to **[Setting Up Go](./setup)** to install the Go toolchain and write your first program. It takes about 15 minutes, and by the end you'll have Go installed, VS Code configured, and your first Go HTTP server running. You'll have written, compiled, and executed real Go code.

That's the hardest part -- starting. Once you've got `Hello from Go!` printing in your terminal, the rest is just building on that foundation.

Let's go.

---

<div class="checkpoint">

#### Before You Continue

Make sure you have the following ready:
- [ ] A macOS or Linux machine with terminal access
- [ ] VS Code installed (or your preferred editor)
- [ ] Homebrew installed (macOS) -- run `brew --version` to check
- [ ] About 30 minutes set aside for the next section
- [ ] A sense of adventure (the Go gopher is friendly, I promise)

</div>
