<div align="center">

# JSlop

**A fullstack TypeScript framework that compiles normal-looking component code into resumable, fine-grained, progressively-enhanced web apps.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A511-f69220.svg)](https://pnpm.io)
[![Status: pre-1.0](https://img.shields.io/badge/status-pre--1.0-orange.svg)](./TODO.md)

*Svelte-like authoring · Solid-like reactivity · Qwik-like resumability · Next-like fullstack — without the mental tax.*

[**Docs**](./docs/README.md) · [**Getting started**](./docs/getting-started.md) · [**Syntax**](./docs/syntax.md) · [**Roadmap**](./docs/roadmap.md) · [**FAQ**](./docs/faq.md)

</div>

---

No `useEffect`. No dependency arrays. No `use client`. No loader/action files. State is just variables; the compiler turns them into fine-grained reactive cells.

> [!WARNING]
> **Status: early.** JSlop is pre-1.0. The compiler, runtime, SSR, client boot, router, Vite plugin, layouts, 404 pages, and the production build path all work end-to-end for the apps in [`examples/`](./examples). Many features in [`PLAN.md`](./PLAN.md) (server functions, schema forms, local-first collections, devtools) are **not yet implemented** — see [`TODO.md`](./TODO.md) for the honest status.

---

## A 60-second tour

```tsx
component Counter {
  state count = 0

  function increment() {
    count++
  }

  view {
    <button onclick={increment}>clicked {count} times</button>
  }
}
```

Five things to notice:

1. **`state count = 0`** declares a reactive variable. When it changes, every place that reads it updates — fine-grained, no virtual DOM diff.
2. **`count++`** is a plain expression. No `count.value`, no `setCount(c => c + 1)`.
3. **`function increment()`** is a plain JS function. No `useCallback`, no closure traps.
4. **`view { ... }`** holds HTML-ish markup with `{expr}` interpolation, `on<event>` handlers, `{#if}` / `{#each}`, and `bind:value` sugar.
5. **No imports for the runtime.** `state`, `view`, `component` are language constructs the compiler understands; the runtime is wired up for you.

A `.jslop` file may declare any number of components — the first is the default export, the rest are named exports.

```tsx
import { Display, Stepper } from "../components/widgets.jslop"

component Counter {
  state count = 0

  view {
    <div>
      <h1>JSlop Counter</h1>
      <Display value={count} label="Count" />
      <Stepper label="+" onstep={() => count++} />

      {#if count > 0}
        <p>count is positive: {count}</p>
      {/if}
    </div>
  }
}
```

See [docs/syntax.md](./docs/syntax.md) for the full DSL reference.

---

## Quickstart

```bash
pnpm install
pnpm build
pnpm dev:counter
```

Open the URL Vite prints. You'll see the counter example SSR'd from `examples/counter/src/routes/index.jslop`, hydrated by `@jslop/client`.

To run the marketing-site example with Tailwind v4:

```bash
pnpm --filter @jslop/example-site run dev
```

To build and serve a production bundle (SSR + hashed client + static assets via `@jslop/node-adapter`):

```bash
pnpm --filter @jslop/example-counter run build   # vite build && vite build --ssr
pnpm --filter @jslop/example-counter run serve   # node serve.mjs
```

> [!IMPORTANT]
> Use **pnpm**, not npm or yarn — the workspace is pnpm-only.

---

## What works today

| Feature                                            | Status   |
|----------------------------------------------------|----------|
| `state` / `prop` / `let` reactivity                | ✅ done   |
| `{#if}` / `{#each}` with keyed reconciliation      | ✅ done   |
| `bind:value` / `bind:checked` two-way sugar        | ✅ done   |
| Multiple components per file                       | ✅ done   |
| File-system routing with `[param]` segments        | ✅ done   |
| Layouts (`_layout.jslop`) and `_404.jslop`         | ✅ done   |
| SSR with state capsule + client resume             | ✅ done   |
| Production build + Node adapter                    | ✅ done   |
| Tailwind v4 out of the box                         | ✅ done   |
| Server functions / schema forms / local-first      | 🚧 planned ([roadmap](./docs/roadmap.md)) |
| Source maps, devtools, streaming SSR               | 🚧 planned |

Full status in [`TODO.md`](./TODO.md).

---

## The mental model

**Three kinds of variables**, picked by what reads them:

```tsx
component Search {
  prop query = ""        // input from a parent — reactive
  state results = []     // the view reads it — reactive, serialized to the client
  let cache = new Map()  // bookkeeping the view never reads — plain JS
}
```

**One way to update:** assign. `count = count + 1`, `count++`, `todos = [...todos, t]`. There is no setter function and no `.value` accessor.

**One way to react:** read. If a `state` or `prop` is read inside `view {...}` or inside a `function`, that location depends on it. Update it, and only that location re-runs.

That's the whole model. The rest of the docs are details.

---

## Docs

The full guide lives in [`docs/`](./docs/README.md). The quickest path through it:

- **[Introduction](./docs/introduction.md)** — what JSlop is, the mental model.
- **[Getting started](./docs/getting-started.md)** — install, run the examples, write your first component.
- **[Components](./docs/components.md)** — `prop`, `state`, `let`, `function`, `view`.
- **[Template syntax](./docs/template-syntax.md)** · **[Logic blocks](./docs/logic-blocks.md)** · **[Events](./docs/events.md)** · **[Bindings](./docs/bindings.md)**
- **[Routing](./docs/routing.md)** · **[SSR & resumability](./docs/ssr-and-resumability.md)** · **[Building & deploying](./docs/building.md)** · **[Styling](./docs/styling.md)**
- **[Reactivity](./docs/reactivity.md)** · **[Cheatsheet](./docs/syntax.md)** · **[FAQ](./docs/faq.md)** · **[Roadmap](./docs/roadmap.md)**

For contributors and curious readers: [`docs/internals/`](./docs/internals/) covers the architecture and how each `@jslop/*` package fits together.

---

## Repository layout

```
packages/
  compiler/         — .jslop → JS module (parser, AST rewriter, codegen)
  runtime/          — cell / derived / effect / batch / untrack / scope
  server/           — SSR: render component tree + serialize state capsule
  client/           — boot: restore state capsule + attach handlers + reactive DOM
  router/           — file-system route scan + URL match + layout chains
  vite/             — Vite plugin: transform + virtual modules + dev SSR + prod build
  node-adapter/     — Node HTTP wrapper around the built SSR render() + static assets
  prettier-plugin/  — Prettier formatter for .jslop files

examples/
  counter/   — minimal interactive demo
  site/      — multi-route example with Tailwind v4, layouts, 404, dynamic routes

editors/
  vscode-jslop — VS Code grammar + snippets for .jslop files

benchmarks/
  bundle-size/   — esbuild same-fixture comparison vs Svelte 5
  reactivity/    — reactivity-throughput micro-benchmarks vs Svelte 5 runes
```

---

## Requirements

- **Node** 20 or newer
- **pnpm** 11 or newer

---

## Contributing

JSlop is pre-1.0 and the API surface is still moving. If you want to hack on it:

1. Fork the repo, `pnpm install`, `pnpm build`.
2. Run the example apps (`pnpm dev:counter`) to verify your environment.
3. Look at [`TODO.md`](./TODO.md) for the honest status of each area — many items have small, well-scoped gaps.
4. Open an issue before starting on anything large, so we can sanity-check the design.

Each package has its own README explaining what it does and how it's tested.

### Cutting a release

The publish flow (first `0.1.0`, subsequent Changesets-driven releases, troubleshooting) lives in [`docs/publishing.md`](./docs/publishing.md).

---

## License

[MIT](./LICENSE) © 2026 p-arndt 
