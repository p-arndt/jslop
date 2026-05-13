# Introduction

JSlop is a fullstack TypeScript framework. You write components in `.jslop` files that look like ordinary code, and the compiler turns them into resumable, fine-grained, server-rendered web apps.

> **Svelte-like authoring, Solid-like reactivity, Qwik-like resumability, Next-like fullstack — without the mental tax.**

No `useEffect`. No dependency arrays. No `use client` / `use server` boundaries to keep in your head. No loader/action files. State is just variables; the compiler turns them into reactive cells.

> [!WARNING]
> **Status: early.** JSlop is pre-1.0. Everything documented here works end-to-end for the [example apps](https://github.com/p-arndt/jslop/tree/main/examples). Aspirational features (server functions, schema forms, local-first collections) are tracked in [`PLAN.md`](https://github.com/p-arndt/jslop/blob/main/PLAN.md) / [`TODO.md`](https://github.com/p-arndt/jslop/blob/main/TODO.md) — they are **not** documented here yet because they don't exist yet.

## A 60-second tour

Here is a complete JSlop component:

```tsx
component Counter {
  state count = 0

  function inc() {
    count++
  }

  view {
    <button onclick={inc}>clicked {count} times</button>
  }
}
```

Five things to notice:

1. **`state count = 0`** declares a reactive variable. When `count` changes anywhere, every place that reads it updates.
2. **`count++`** is a plain expression. The compiler rewrites it into the appropriate reactive read+write — you never type `count.value` or `setCount(c + 1)`.
3. **`function inc()`** is a plain JavaScript function. No `useCallback`, no closure traps.
4. **`view { ... }`** holds HTML-like markup. `{count}` is an interpolation that re-evaluates fine-grained when `count` changes — only that text node updates.
5. **No imports.** `state`, `view`, `component` are language constructs the compiler understands. The runtime is wired up for you.

## What you get

| Feature                                       | Status |
|-----------------------------------------------|--------|
| `state` / `prop` / `let` reactivity           | done   |
| `{#if}` / `{#each}` (with keyed reconciliation) | done |
| `bind:value` / `bind:checked`                 | done   |
| Multiple components per file                  | done   |
| File-system routing with `[param]` segments   | done   |
| Layouts (`_layout.jslop`) and `_404.jslop`      | done   |
| SSR with state capsule + client resume        | done   |
| Production build + Node adapter               | done   |
| Tailwind v4 out of the box                    | done   |
| Server functions, schema forms, local-first   | planned ([roadmap](./roadmap.md)) |

## The mental model

**Three kinds of variables**, picked by what reads them:

```tsx
component Search {
  prop query = ""        // input from a parent — reactive
  state results = []     // the view reads it — reactive, serialized to the client
  let cache = new Map()  // bookkeeping the view never reads — plain JS

  function run() {
    if (cache.has(query)) { results = cache.get(query); return }
    // ...
  }

  view {
    <ul>{#each results as r (r.id)}<li>{r.label}</li>{/each}</ul>
  }
}
```

**One way to update:** assign. `count = count + 1`, `count++`, `todos = [...todos, t]`. There is no setter function and no `.value` accessor.

**One way to react:** read. If `count` appears inside a `view {...}` expression or inside a `function`, that location depends on it. Update the cell and only that location re-runs.

That's the whole model. The rest of the docs are details.

## How to read the docs

If you've never used JSlop:

1. **[Getting started](./getting-started.md)** — install, run the example apps, see code change live.
2. **[Components](./components.md)** — the four declaration keywords (`prop`, `state`, `let`, `function`).
3. **[Template syntax](./template-syntax.md)** — what goes inside `view { ... }`.
4. **[Logic blocks](./logic-blocks.md)** — `{#if}` and `{#each}`.
5. **[Bindings](./bindings.md)** — `bind:value` for forms.
6. **[Routing](./routing.md)** — file-system routes, layouts, 404.

Then dip into the reference pages as you need them:

- **[Reactivity](./reactivity.md)** — the `cell` / `derived` / `effect` primitives the compiler uses.
- **[SSR & resumability](./ssr-and-resumability.md)** — how state survives the network.
- **[Styling](./styling.md)** — Tailwind, plain CSS, `class={...}`.
- **[Building & deploying](./building.md)** — production build, `@jslop/node-adapter`.
- **[Architecture](./internals/architecture.md)** — what each package does, end-to-end request flow. *(For contributors / curious readers — not required to ship apps.)*

If you're comparing JSlop against the framework you already use, jump to the **[FAQ](./faq.md)**.
