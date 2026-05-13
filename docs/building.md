# Building & deploying

A JSlop app builds in **two passes** and serves with a small Node adapter. This page walks the full production flow.

## The build

```bash
pnpm build
# expands to: vite build && vite build --ssr
```

Pass 1 — `vite build`:

- Compiles every `.jslop` file via `@jslop/compiler`.
- Emits the **client bundle** to `dist/client/` with hashed filenames in `assets/`.
- Emits `dist/client/.vite/manifest.json` so the server entry can look up which asset URL corresponds to the client entry.
- Bundles any CSS you imported (and Tailwind, if enabled) into hashed CSS files alongside.

Pass 2 — `vite build --ssr`:

- Bundles the **server entry** to `dist/server/entry-server.js`.
- Inlines `@jslop/server`, `@jslop/router`, and your route components into a single self-contained module.
- Exports a `render(url, opts?) → { status, html, headers }` function.

After both passes, your `dist/` looks like:

```
dist/
├── client/
│   ├── .vite/manifest.json
│   └── assets/
│       ├── client-<hash>.js
│       └── client-<hash>.css     (if you imported any CSS)
└── server/
    └── entry-server.js
```

## Serving the build

Use `@jslop/node-adapter` for a tiny Node HTTP server:

```js
// serve.mjs
import { createServer } from "@jslop/node-adapter";
import { render } from "./dist/server/entry-server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

const server = createServer({
  render,
  clientDir: resolve(here, "dist/client"),
});

server.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});
```

```bash
pnpm serve
```

What the adapter does:

- Paths that look like asset URLs (`/assets/client-abc.js`) → served as static files from `clientDir`, with `cache-control: public, max-age=31536000, immutable` (safe because Vite hashes their names).
- Everything else → passed to `render(url)`, which returns `{ status, html, headers }`.
- The SSR entry reads `dist/client/.vite/manifest.json` once and caches it, so the rendered HTML always references the correct hashed asset URLs.

## Custom adapters

`render(url, opts?)` is request-agnostic — it takes a URL string and returns a plain object. That means you can drop it into any host:

```js
// Bun
import { render } from "./dist/server/entry-server.js";
Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/assets/")) return new Response(/* ... */);
    const { status, html, headers } = await render(url.pathname + url.search);
    return new Response(html, { status, headers });
  },
});
```

Cloudflare Workers / Deno / Lambda follow the same pattern — feed `url` in, send `html` back.

> [!NOTE]
> Right now `@jslop/node-adapter` is the only adapter shipped. Bun, Workers, Deno, and edge adapters are on the [roadmap](./roadmap.md). The render contract is intentionally minimal so writing one is a small task.

## Streaming SSR

> [!WARNING]
> Today, `render()` produces the full HTML as a single string before responding. Streaming SSR is **not yet implemented**.

## Static site generation (SSG)

> [!WARNING]
> A "render every route at build time" mode is **not yet implemented**. You can hack it with a script that calls `render()` for each known URL and writes the result to disk, but there's no first-class command for it.

## Environment variables

Vite's standard rules apply. Use `import.meta.env.VITE_*` in any code that needs to run in the browser. Server-only env vars are just `process.env.X` inside `serve.mjs` or your adapter glue.

## See also

- [Project structure](./project-structure.md) — where `serve.mjs` and `vite.config.mjs` sit.
- [SSR & resumability](./ssr-and-resumability.md) — what the SSR pass produces and how the client picks up.
- [Internals: architecture](./internals/architecture.md) — what `@jslop/vite` does with the build hooks.
