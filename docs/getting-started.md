# Getting started

This page walks you through creating a new JSlop app, running the example apps from the repo, and writing your first component.

## Prerequisites

- **Node** 20 or newer
- A package manager: **pnpm** ≥ 11 (recommended), **npm** ≥ 10, or **bun** ≥ 1.

## Start a new app

The fastest path is the scaffolding CLI:

```bash
pnpm create jslop my-app
# or:  npm create jslop@latest my-app
# or:  bun create jslop my-app
```

It will prompt for a project name (if you didn't pass one) and a template, then drop a ready-to-run app into `./my-app/`. After it finishes:

```bash
cd my-app
pnpm install        # or: npm install / bun install
pnpm dev            # http://localhost:5173
```

Edit `src/routes/index.jslop` and save — the dev server reloads. Build for production with `pnpm build` (emits `dist/client/` + `dist/server/`) and serve with `pnpm serve` (Node + `@jslop/node-adapter`).

### Templates

Pass `--template=<name>` to skip the picker:

| Template  | What you get |
|-----------|--------------|
| `minimal` | A single route with `state`, two-way `bind:value`, `{#if}`, plus `vite.config.mjs` and a Node `serve.mjs`. The starting point for everything below. |

More templates (Tailwind, CRUD) will land alongside future releases.

### What just got installed

The scaffold's `package.json` pins real semver ranges against the published packages:

- `@jslop/runtime` — reactive primitives
- `@jslop/compiler` — `.jslop` → JS (loaded transitively via `@jslop/vite`)
- `@jslop/server` — SSR
- `@jslop/client` — browser boot + reconciliation
- `@jslop/router` — file-based routes
- `@jslop/vite` — dev server + virtual modules + production build
- `@jslop/node-adapter` — Node HTTP wrapper for the production build

You don't import any of these from your `.jslop` files — the compiler wires them up. They're just the runtime moving parts your app needs in `node_modules`.

---

## Running the repo's examples (contributors)

If you cloned this monorepo to hack on JSlop itself:

```bash
pnpm install
pnpm build
```

`pnpm build` runs the TypeScript build in every workspace package (`packages/*`). You need this once before the examples can resolve `@jslop/client`, `@jslop/runtime`, etc. from each package's `dist/`.

### Run the counter example

```bash
pnpm dev:counter
```

Vite boots with the `@jslop/vite` plugin against `examples/counter`. Open the URL Vite prints (usually `http://localhost:5173`) and you'll see:

1. A server-rendered HTML page with the initial state baked in.
2. A small client bundle that reads the state capsule and attaches event handlers.
3. Fine-grained DOM updates on click — no hydration of the entire tree.

Edit `examples/counter/src/routes/index.jslop` and the page reloads. (HMR currently triggers a full page reload, not partial component reload.)

### Run the site example

```bash
pnpm --filter @jslop/example-site run dev
```

This one uses Tailwind v4 via `@tailwindcss/vite`, layouts, dynamic routes, and a 404 page. It's a small but complete demo.

### Run the tasks CRUD example

```bash
pnpm dev:tasks
```

A real, persistent task tracker (~400 LOC). Exercises every primitive end-to-end: `state` / `derived` / `bind:value`, per-route `load { params, url }` + `notFound()`, layout-level `load` (the topbar's per-status counts), per-component `head { ... }` and scoped `style { ... }`, SPA navigation, and full CRUD against a file-backed REST API. Build & serve for production with `pnpm --filter @jslop/example-tasks run build && pnpm --filter @jslop/example-tasks run serve`.

## Build for production

JSlop apps build in two passes. The first emits the hashed client bundle (and CSS, if any) plus a Vite manifest. The second emits a self-contained Node SSR entry that reads that manifest to know which asset URLs to inject.

```bash
pnpm --filter @jslop/example-counter run build
# vite build        → dist/client/  (hashed JS + CSS + manifest)
# vite build --ssr  → dist/server/entry-server.js

pnpm --filter @jslop/example-counter run serve
# → jslop counter listening on http://localhost:3000
```

See [Building & deploying](./building.md) for the details.

## Writing your first component

Create `src/routes/index.jslop`:

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

## Next steps

- **[Components](./components.md)** — the four declaration keywords (`prop`, `state`, `let`, `function`).
- **[Template syntax](./template-syntax.md)** — what goes inside `view { ... }`.
- **[Logic blocks](./logic-blocks.md)** — `{#if}` and `{#each}`.
- **[Routing](./routing.md)** — file-system routes, layouts, 404.
- **[Building & deploying](./building.md)** — production builds.
