---
title: "Documentation"
description: "Welcome to Documentation"
tags: [docs]
date: 2026-05-13
draft: false
---

# JSlop docs

Welcome. These docs cover the **currently implemented** surface of JSlop. Aspirational features (server functions, schema forms, local-first collections, devtools) are tracked in [`PLAN.md`](https://github.com/p-arndt/jslop/blob/main/PLAN.md) and [`TODO.md`](https://github.com/p-arndt/jslop/blob/main/TODO.md) — they aren't documented here yet because they don't exist yet.

> [!WARNING]
> **Status: pre-1.0.** No semver guarantees, no release cadence. Everything below works end-to-end for the example apps in `examples/`.

## Start here

1. **[Introduction](./introduction.md)** — what JSlop is and the mental model in 60 seconds.
2. **[Getting started](./getting-started.md)** — install, run the examples, write your first component.
3. **[Project structure](./project-structure.md)** — `package.json`, `vite.config.mjs`, where files go.

## Authoring `.jslop` files

4. **[Components](./components.md)** — `component`, `prop`, `state`, `let`, `function`, `view`.
5. **[Template syntax](./template-syntax.md)** — tags, attributes, text interpolation, `<children/>`.
6. **[Logic blocks](./logic-blocks.md)** — `{#if}`, `{#each}`, keyed reconciliation.
7. **[Events](./events.md)** — `on*` handlers, inline mutations, component callbacks.
8. **[Bindings](./bindings.md)** — `bind:value`, `bind:checked`.
9. **[Styling](./styling.md)** — `class={...}`, global CSS, Tailwind v4.

## Apps

10. **[Routing](./routing.md)** — file-system routes, dynamic `[param]` segments, layouts, 404.
11. **[Actions](./actions.md)** — `action name(params) { ... }` for server mutations from a route.
12. **[SSR & resumability](./ssr-and-resumability.md)** — how state survives the network without re-rendering.
13. **[Building & deploying](./building.md)** — the two-pass production build and `@jslop/node-adapter`.

## Reference

- **[Reactivity](./reactivity.md)** — `cell`, `derived`, `effect`, `batch`, `untrack`, scopes.
- **[Cheatsheet](./syntax.md)** — every construct in one page.
- **[FAQ](./faq.md)** — comparisons with Svelte / React / Solid / Qwik, common gotchas.
- **[Roadmap](./roadmap.md)** — what's done, what's next, what's out of scope.

## For contributors

- **[Internals/](./internals/README.md)** — architecture, package layout, request flow. Not required to ship apps.

---

> **In a hurry?** The whole DSL fits on one screen — see the [cheatsheet](./syntax.md). For everything else, the FAQ is probably faster than skimming the guide.

