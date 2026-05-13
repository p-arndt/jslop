# Getting started

This walks you through installing Rift, understanding the project layout, and running the example apps.

## Prerequisites

- **Node** 20 or newer
- **pnpm** 11 or newer (the workspace is pnpm-only)

## Install

From the repo root:

```bash
pnpm install
pnpm build
```

`pnpm build` runs the TypeScript build in every workspace package (`packages/*`). You need to do this once before the examples can resolve `@rift/client`, `@rift/runtime`, etc. from `dist/`.

## Run the counter example

```bash
pnpm dev:counter
```

This boots Vite with the `@rift/vite` plugin against `examples/counter`. Open the URL Vite prints (usually `http://localhost:5173`) and you'll get:

1. A server-rendered HTML page with the initial state baked in.
2. A small client bundle that reads the state capsule and attaches event handlers.
3. Fine-grained DOM updates on click — no hydration of the entire tree.

Edit `examples/counter/src/routes/index.rift` and the page reloads. (HMR currently triggers a full page reload — see [TODO.md](../TODO.md).)

## Run the site example

```bash
pnpm --filter @rift/example-site run dev
```

This one uses Tailwind v4 via `@tailwindcss/vite`, which `@rift/vite` auto-wires when you pass `tailwind: true`.

## Project layout

A Rift app's `vite.config.mjs` is minimal:

```js
import { defineConfig } from "vite";
import rift from "@rift/vite";

export default defineConfig({
  plugins: [rift()],
});
```

By default the plugin scans `src/routes/` for `.rift` files and turns them into routes. Components you import inside routes live wherever you want — `src/components/` is the convention used in `examples/counter`.

```
src/
  routes/
    index.rift           → /
    about.rift           → /about
    posts/[slug].rift    → /posts/:slug
  components/
    Button.rift
    Display.rift
```

See [routing.md](./routing.md) for details on the route conventions.

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

The DSL gives you:

- `state x = value` — declares a **reactive variable**. Mutations like `x++` or `x = ...` trigger view updates and the value is persisted into the SSR capsule.
- `let x = value` — declares a **non-reactive** mutable variable (per-instance caches, counters, debounce handles). Plain JS, never wrapped in a cell, never serialized.
- `function foo() { ... }` — plain function. Reads/writes of `state`/`prop` identifiers stay reactive; `let` and other locals stay plain JS.
- `prop x = default` — a prop with an optional default. Parents can pass either a plain value or a reactive cell.
- `view { ... }` — the markup. One root element.

That's the whole authoring surface today.

### Quick comparison: `state` vs `let`

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

Rule of thumb: if the view (or an `{expr}` inside it) reads the value, use `state`. Otherwise, use `let` — it's cheaper, doesn't bloat the SSR capsule, and behaves like normal JavaScript.

> [!NOTE]
> Anything else from [`PLAN.md`](../PLAN.md) — `server`, `derived`, `when`, `mount`, `style`, `schema`, server functions, etc. — is **not yet implemented**. Track [TODO.md](../TODO.md) for progress.

## Build for production

Rift apps build in two passes. The first emits the hashed client bundle (and CSS, if you import any) plus a Vite manifest. The second emits a self-contained Node SSR entry that reads that manifest to know which asset URLs to inject.

```bash
pnpm --filter @rift/example-counter run build
# expands to: vite build && vite build --ssr
#   dist/client/.vite/manifest.json
#   dist/client/assets/client-<hash>.js
#   dist/server/entry-server.js
```

To serve the build, use [`@rift/node-adapter`](../packages/node-adapter):

```js
// examples/counter/serve.mjs
import { createServer } from "@rift/node-adapter";
import { render } from "./dist/server/entry-server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = createServer({
  render,
  clientDir: resolve(here, "dist/client"),
});
server.listen(Number(process.env.PORT ?? 3000));
```

```bash
pnpm --filter @rift/example-counter run serve
# → rift counter listening on http://localhost:3000
```

The adapter serves anything under `dist/client/` as a static asset (with long-cache headers for `/assets/*`, which Vite hashes) and routes everything else through `render(url)`. The render function auto-discovers the hashed client bundle and any CSS it emitted from `dist/client/.vite/manifest.json` — you don't have to wire URLs by hand.

> [!NOTE]
> Apps using `@rift/vite` need `@rift/server` and `@rift/router` declared as dependencies in `package.json` — they're bundled into the SSR entry, so pnpm's strict resolver requires them at the project level. See `examples/counter/package.json` for the full set.

## Next

- [Syntax reference](./syntax.md)
- [Reactivity](./reactivity.md)
- [Routing](./routing.md)
