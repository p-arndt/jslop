# Getting started

This page walks you through installing Rift, running the example apps, and writing your first component.

## Prerequisites

- **Node** 20 or newer
- **pnpm** 11 or newer (the workspace is pnpm-only)

> [!IMPORTANT]
> Use **pnpm**, not npm or yarn. The workspace will not resolve correctly with other package managers.

## Install

From the repo root:

```bash
pnpm install
pnpm build
```

`pnpm build` runs the TypeScript build in every workspace package (`packages/*`). You need this once before the examples can resolve `@rift/client`, `@rift/runtime`, etc. from each package's `dist/`.

## Run the counter example

```bash
pnpm dev:counter
```

Vite boots with the `@rift/vite` plugin against `examples/counter`. Open the URL Vite prints (usually `http://localhost:5173`) and you'll see:

1. A server-rendered HTML page with the initial state baked in.
2. A small client bundle that reads the state capsule and attaches event handlers.
3. Fine-grained DOM updates on click — no hydration of the entire tree.

Edit `examples/counter/src/routes/index.rift` and the page reloads. (HMR currently triggers a full page reload, not partial component reload.)

## Run the site example

```bash
pnpm --filter @rift/example-site run dev
```

This one uses Tailwind v4 via `@tailwindcss/vite`, layouts, dynamic routes, and a 404 page. It's a small but complete demo.

## Build for production

Rift apps build in two passes. The first emits the hashed client bundle (and CSS, if any) plus a Vite manifest. The second emits a self-contained Node SSR entry that reads that manifest to know which asset URLs to inject.

```bash
pnpm --filter @rift/example-counter run build
# vite build        → dist/client/  (hashed JS + CSS + manifest)
# vite build --ssr  → dist/server/entry-server.js

pnpm --filter @rift/example-counter run serve
# → rift counter listening on http://localhost:3000
```

See [Building & deploying](./building.md) for the details.

## Writing your first component

Create `src/routes/index.rift`:

```tsx
component Home {
  state name = "world"

  function shout() {
    name = name.toUpperCase()
  }

  view {
    <main>
      <h1>Hello, {name}!</h1>
      <button onclick={shout}>shout</button>
    </main>
  }
}
```

Four pieces:

- **`state name = "world"`** — a reactive variable. Mutations like `name = ...` trigger view updates and the value is persisted into the SSR capsule.
- **`function shout()`** — plain function. Reads and writes of `state`/`prop` identifiers stay reactive; everything else stays plain JS.
- **`<main>...</main>`** — markup. One root element per `view`.
- **`onclick={shout}`** — DOM event handler. Function reference, arrow function, or any expression that produces a function.

That's the whole authoring surface today. See [Components](./components.md) for the full picture.

### `state` vs `let`

```tsx
component Search {
  prop query = ""

  state results = []     // view renders this → reactive, serialized
  let cache = new Map()  // bookkeeping the view never reads → plain JS
  let lastQueryId = 0

  function run() {
    lastQueryId++
    if (cache.has(query)) { results = cache.get(query); return }
    // ...fetch and update results...
  }

  view {
    <ul>{#each results as r (r.id)}<li>{r.label}</li>{/each}</ul>
  }
}
```

Rule of thumb: **if the view reads it, use `state`. Otherwise, use `let`** — it's cheaper, doesn't bloat the SSR capsule, and behaves like normal JavaScript.

## Bootstrapping a fresh app

There's no `create-rift-app` yet. The fastest path: copy `examples/counter/` somewhere, rename, and start editing. The full file inventory is in [Project structure](./project-structure.md).

## Next steps

- **[Components](./components.md)** — the four declaration keywords (`prop`, `state`, `let`, `function`).
- **[Template syntax](./template-syntax.md)** — what goes inside `view { ... }`.
- **[Logic blocks](./logic-blocks.md)** — `{#if}` and `{#each}`.
- **[Routing](./routing.md)** — file-system routes, layouts, 404.
- **[Building & deploying](./building.md)** — production builds.
