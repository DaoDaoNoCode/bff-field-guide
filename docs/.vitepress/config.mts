import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'The BFF Field Guide',
  description: 'A frontend engineer\'s hands-on path to full-stack Go — built for the ODH Dashboard team',

  base: process.env.VITEPRESS_BASE || '/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: (process.env.VITEPRESS_BASE || '/') + 'logo.svg' }],
    ['meta', { property: 'og:title', content: 'The BFF Field Guide' }],
    ['meta', { property: 'og:description', content: 'Learn Go and BFF development through real ODH Dashboard code. For frontend engineers going full-stack.' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: 'The BFF Field Guide' }],
    ['meta', { name: 'twitter:description', content: 'A frontend engineer\'s hands-on path to full-stack Go.' }],
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
            { text: 'What Is Coming Next', link: '/guide/architecture/whats-next' },
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
          ],
        },
      ],
      '/tutorials/': [
        {
          text: 'Hands-On Tutorials',
          items: [
            { text: 'Overview', link: '/tutorials/' },
            { text: '1. Your First GET Endpoint', link: '/tutorials/first-get-endpoint' },
            { text: '2. POST with Validation', link: '/tutorials/post-with-validation' },
            { text: '3. Writing Handler Tests', link: '/tutorials/writing-tests' },
            { text: '4. Mock Clients', link: '/tutorials/mock-clients' },
            { text: '5. Contract Tests', link: '/tutorials/contract-tests' },
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
