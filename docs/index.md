---
layout: home
hero:
  name: The ODH Go Field Guide
  text: Frontend to Full-Stack Go
  tagline: A hands-on guide for TypeScript developers learning Go across the ODH Dashboard — BFFs, the dashboard-operator, and the modular architecture
  image:
    src: /logo.svg
    alt: ODH Go Field Guide
  actions:
    - theme: brand
      text: Start the Guide
      link: /guide/
    - theme: alt
      text: Go ↔ TS Cheat Sheet
      link: /reference/cheat-sheet

features:
  - icon: "🗺️"
    title: Go for TypeScript Devs
    details: Every Go concept explained through its TypeScript equivalent. No prior Go knowledge needed — we start from scratch.
    link: /guide/go-basics/types-and-variables
  - icon: "🏗️"
    title: BFF Architecture & Deep Dive
    details: Understand the BFF pattern in ODH Dashboard, then walk through real handler, middleware, auth, and inter-BFF code line by line.
    link: /guide/architecture/what-is-bff
  - icon: "☸️"
    title: Kubernetes for Go Devs
    details: The K8s concepts you need to read operator code — CRDs, RBAC, Server-Side Apply, conditions — anchored to what you already know.
    link: /guide/kubernetes/
  - icon: "⚙️"
    title: The Dashboard Operator
    details: A full deep dive into the dashboard-operator — controller-runtime, the Dashboard CRD, the reconcile pipeline, and module federation.
    link: /guide/operator/
  - icon: "🔧"
    title: Hands-On Tutorials
    details: Add endpoints, wire inter-BFF calls, onboard a new module, and build & deploy the operator. You'll be committing Go by the end.
    link: /tutorials/
  - icon: "📋"
    title: Reference
    details: Quick-lookup cheat sheets, common gotchas, CLI and make-target commands, and a glossary. Keep this tab open while you code.
    link: /reference/cheat-sheet
---
