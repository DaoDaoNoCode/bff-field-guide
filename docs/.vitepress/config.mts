import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'The ODH Go Field Guide',
  description: 'Go across the ODH Dashboard — BFFs, the dashboard-operator, and the modular architecture, taught through real repo code for frontend engineers',

  base: process.env.VITEPRESS_BASE || '/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: (process.env.VITEPRESS_BASE || '/') + 'logo.svg' }],
    ['meta', { property: 'og:title', content: 'The ODH Go Field Guide' }],
    ['meta', { property: 'og:description', content: 'Learn Go across the ODH Dashboard — BFFs, the dashboard-operator, and the modular architecture — through real repo code. For frontend engineers going full-stack.' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: 'The ODH Go Field Guide' }],
    ['meta', { name: 'twitter:description', content: 'A frontend engineer\'s hands-on path to full-stack Go: BFFs, the operator, and modular architecture.' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/DaoDaoNoCode/bff-field-guide' },
    ],
    outline: {
      level: [2, 3],
    },
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'Reference', link: '/reference/cheat-sheet' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Setting Up Go', link: '/guide/setup' },
          ],
        },
        {
          text: 'Part 1: Go for TypeScript Devs',
          collapsed: false,
          items: [
            { text: 'Types & Variables', link: '/guide/go-basics/types-and-variables' },
            { text: 'Structs — The Go "Class"', link: '/guide/go-basics/structs' },
            { text: 'Functions & Methods', link: '/guide/go-basics/functions-and-methods' },
            { text: 'Error Handling', link: '/guide/go-basics/error-handling' },
            { text: 'Pointers', link: '/guide/go-basics/pointers' },
            { text: 'Interfaces', link: '/guide/go-basics/interfaces' },
            { text: 'Slices & Maps', link: '/guide/go-basics/slices-and-maps' },
            { text: 'Packages & Modules', link: '/guide/go-basics/packages' },
            { text: 'JSON', link: '/guide/go-basics/json' },
            { text: 'HTTP Servers', link: '/guide/go-basics/http' },
            { text: 'Testing', link: '/guide/go-basics/testing' },
          ],
        },
        {
          text: 'Part 2: BFF Architecture',
          collapsed: false,
          items: [
            { text: 'What is a BFF?', link: '/guide/architecture/what-is-bff' },
            { text: 'The Big Picture', link: '/guide/architecture/big-picture' },
            { text: 'Request Flow', link: '/guide/architecture/request-flow' },
            { text: 'Directory Structure', link: '/guide/architecture/directory-structure' },
            { text: 'Distributions', link: '/guide/architecture/distributions' },
          ],
        },
        {
          text: 'Part 3: BFF Deep Dive',
          collapsed: false,
          items: [
            { text: 'Entry Point (main.go)', link: '/guide/deep-dive/entry-point' },
            { text: 'The App Struct & Routes', link: '/guide/deep-dive/app-and-routes' },
            { text: 'Writing Handlers', link: '/guide/deep-dive/handlers' },
            { text: 'Middleware Chain', link: '/guide/deep-dive/middleware' },
            { text: 'Authentication & RBAC', link: '/guide/deep-dive/auth' },
            { text: 'Models & DTOs', link: '/guide/deep-dive/models' },
            { text: 'Integrations', link: '/guide/deep-dive/integrations' },
            { text: 'Error Handling', link: '/guide/deep-dive/error-handling' },
            { text: 'Inter-BFF Communication', link: '/guide/deep-dive/inter-bff-communication' },
            { text: 'Debugging', link: '/guide/deep-dive/debugging' },
            { text: 'Advanced Patterns', link: '/guide/deep-dive/advanced-patterns' },
          ],
        },
        {
          text: 'Part 4: Kubernetes for Go Devs',
          collapsed: false,
          items: [
            { text: 'Why Kubernetes?', link: '/guide/kubernetes/' },
            { text: 'Resources & CRDs', link: '/guide/kubernetes/resources-and-crds' },
            { text: 'RBAC & Access', link: '/guide/kubernetes/rbac-and-access' },
            { text: 'Controller Concepts', link: '/guide/kubernetes/controller-concepts' },
          ],
        },
        {
          text: 'Part 5: The Dashboard Operator',
          collapsed: false,
          items: [
            { text: 'Meet the Operator', link: '/guide/operator/' },
            { text: 'controller-runtime', link: '/guide/operator/controller-runtime' },
            { text: 'The Dashboard CRD', link: '/guide/operator/the-crd' },
            { text: 'The Reconciler', link: '/guide/operator/reconciler' },
            { text: 'Modules & Federation', link: '/guide/operator/modules-and-federation' },
            { text: 'The ODH Operator Connection', link: '/guide/operator/odh-operator-connection' },
            { text: 'Testing the Operator', link: '/guide/operator/testing' },
          ],
        },
        {
          text: 'Part 6: Development Workflow',
          collapsed: false,
          items: [
            { text: 'The Monorepo', link: '/guide/workflow/' },
            { text: 'Make Targets', link: '/guide/workflow/make-targets' },
            { text: 'Debugging & Gotchas', link: '/guide/workflow/debugging' },
          ],
        },
      ],
      '/tutorials/': [
        {
          text: 'BFF Tutorials',
          items: [
            { text: 'Overview', link: '/tutorials/' },
            { text: '1. Your First GET Endpoint', link: '/tutorials/first-get-endpoint' },
            { text: '2. POST with Validation', link: '/tutorials/post-with-validation' },
            { text: '3. Writing Handler Tests', link: '/tutorials/writing-tests' },
            { text: '4. Mock Clients', link: '/tutorials/mock-clients' },
            { text: '5. Contract Tests', link: '/tutorials/contract-tests' },
            { text: '6. Inter-BFF Communication', link: '/tutorials/inter-bff-communication' },
          ],
        },
        {
          text: 'Modules & Operator Tutorials',
          items: [
            { text: '7. Onboard a New Module', link: '/tutorials/onboard-a-module' },
            { text: '8. Register a Module in the Operator', link: '/tutorials/register-module-in-operator' },
            { text: '9. Build & Deploy the Operator', link: '/tutorials/build-and-deploy-operator' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Go ↔ TypeScript Cheat Sheet', link: '/reference/cheat-sheet' },
            { text: 'Common Gotchas', link: '/reference/gotchas' },
            { text: 'Go CLI Quick Reference', link: '/reference/cli' },
            { text: 'Glossary', link: '/reference/glossary' },
          ],
        },
      ],
    },
  },
})
