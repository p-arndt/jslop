# Rift

> A fullstack TypeScript framework that compiles normal-looking component code into resumable, fine-grained, progressively-enhanced web apps.

Rift's pitch:

> **Svelte-like authoring, Solid-like reactivity, Qwik-like resumability, Next-like fullstack — without the mental tax.**

No `useEffect`. No dependency arrays. No `use client`. No loader/action files. State is just variables; the compiler turns them into fine-grained reactive cells.

> [!WARNING]
> **Status: early.** Rift is pre-1.0. The compiler, runtime, SSR, client boot, router, Vite plugin, layouts, 404 pages, and the production build path all work end-to-end for the example apps in `examples/`. Many features in [`PLAN.md`](./PLAN.md) (server functions, schema forms, local-first collections, devtools) are **not yet implemented** — see [`TODO.md`](./TODO.md) for the honest status.

---

## Quickstart

```bash
pnpm install
pnpm build
pnpm dev:counter
```

Open the URL Vite prints. You'll see the counter example SSR'd from `examples/counter/src/routes/index.rift`, hydrated by `@rift/client`.

To run the marketing-site example with Tailwind:

```bash
pnpm --filter @rift/example-site run dev
```

To build and serve a production bundle (SSR + hashed client + static assets via `@rift/node-adapter`):

```bash
pnpm --filter @rift/example-counter run build   # vite build && vite build --ssr
pnpm --filter @rift/example-counter run serve   # node serve.mjs
```

> [!IMPORTANT]
> Use **pnpm**, not npm or yarn — the workspace is pnpm-only.

---

## What a `.rift` file looks like

```tsx
import { Display, Stepper } from "../components/widgets.rift"

component Counter {
  state count = 0

  function increment() {
    count++
  }

  view {
    <div>
      <h1>Rift Counter</h1>
      <Display value={count} label="Count" />
      <Stepper label="+" onstep={increment} />

      {#if count > 0}
        <p>count is positive: {count}</p>
      {/if}
    </div>
  }
}
```

That's it. `state` declarations become reactive cells; `let` declarations stay plain JS for per-instance bookkeeping. Functions are plain JS. The view is HTML-ish with `{expr}` interpolation, `on<event>` handlers, `{#if}`/`{:else}`/`{/if}`, and `{#each list as item, i}`. A `.rift` file may declare any number of components; the first is the default export, the rest are named exports.

See [docs/syntax.md](./docs/syntax.md) for the full DSL reference.

---

## Docs

The full guide lives in [`docs/`](./docs/README.md). The quickest path through it:

- **[Introduction](./docs/introduction.md)** — what Rift is, the mental model.
- **[Getting started](./docs/getting-started.md)** — install, run the examples, write your first component.
- **[Components](./docs/components.md)** — `prop`, `state`, `let`, `function`, `view`.
- **[Template syntax](./docs/template-syntax.md)** · **[Logic blocks](./docs/logic-blocks.md)** · **[Events](./docs/events.md)** · **[Bindings](./docs/bindings.md)**
- **[Routing](./docs/routing.md)** · **[SSR & resumability](./docs/ssr-and-resumability.md)** · **[Building & deploying](./docs/building.md)** · **[Styling](./docs/styling.md)**
- **[Reactivity](./docs/reactivity.md)** · **[Cheatsheet](./docs/syntax.md)** · **[FAQ](./docs/faq.md)** · **[Roadmap](./docs/roadmap.md)**

For contributors / curious readers: [`docs/internals/`](./docs/internals/) covers the architecture and how each `@rift/*` package fits together.

---

## Repository layout

```
packages/
  compiler/      — .rift → JS module (parser, AST rewriter, codegen)
  runtime/       — cell / derived / effect / batch / untrack
  server/        — SSR: render component tree + serialize state capsule
  client/        — boot: restore state capsule + attach handlers + reactive DOM
  router/        — file-system route scan + URL match
  vite/          — Vite plugin: transform + virtual modules + dev SSR + prod build
  node-adapter/  — Node HTTP wrapper around the built SSR render() + static assets

examples/
  counter/    — minimal interactive demo
  site/       — multi-route example with Tailwind v4

editors/
  vscode-rift — VS Code grammar + snippets for .rift files
```

---

## Requirements

- Node 20+
- pnpm 11+

---

## License

Not yet declared. Treat as "all rights reserved" until a `LICENSE` file lands.
