# @rift/vite

Vite plugin that wires up the full Rift experience: `.rift` transforms, route scanning, dev SSR middleware, dual-pass production build (client + SSR), and (optionally) Tailwind v4.

```bash
pnpm add -D @rift/vite vite
pnpm add @rift/client @rift/runtime @rift/server @rift/router
```

`@rift/server` and `@rift/router` are runtime deps because they're bundled into the production SSR entry — pnpm's strict resolver needs them declared at the project level.

## Usage

```js
// vite.config.mjs
import { defineConfig } from "vite";
import rift from "@rift/vite";

export default defineConfig({
  plugins: [rift()],
});
```

Then run `vite` from your project. Every `.rift` file under `src/routes/` becomes a route. Each request is server-rendered, the client bundle resumes it.

## Options

```js
rift({
  routesDir: "src/routes",           // default
  title: (url, params) => "...",     // page title generator
  css: ["/src/app.css"],             // injected as <link rel="stylesheet">
  tailwind: true,                    // auto-load @tailwindcss/vite
})
```

| Option       | Type                                                   | Default              | Notes                                                            |
|--------------|--------------------------------------------------------|----------------------|------------------------------------------------------------------|
| `routesDir`  | `string`                                               | `"src/routes"`       | Resolved relative to `config.root`. Absolute paths are honored.  |
| `title`      | `(url, params) => string`                              | `` `Rift — ${url}` `` | Page `<title>`.                                                  |
| `css`        | `string \| string[]`                                   | `[]`                 | Injected as `<link rel="stylesheet" href="…">` in the SSR HTML.   |
| `tailwind`   | `boolean`                                              | `false`              | When `true`, requires `tailwindcss` and `@tailwindcss/vite`.     |

## Production build

`vite build` runs in two passes:

```bash
vite build              # → dist/client/  (hashed JS + CSS + .vite/manifest.json)
vite build --ssr        # → dist/server/entry-server.js  (exports render(url))
```

The plugin's `config()` hook detects the build mode (`env.isSsrBuild`) and flips Rollup's input/output:

- **Client pass:** entry is `virtual:rift-client`, `manifest: true`, output to `dist/client/`. Vite hashes the JS bundle and any CSS imported by the entry; the manifest records the mapping.
- **SSR pass:** entry is `virtual:rift-entry-server`, `ssr: true`, `ssr.noExternal: [/^@rift\//]` so workspace packages bundle into a single self-contained server entry under `dist/server/`.

The SSR entry exports:

```ts
function render(
  url: string,
  opts?: {
    appScriptUrl?: string;
    stylesheets?: string[];
    title?: (url: string, params: Record<string, string>) => string;
    clientManifestPath?: string;
  }
): Promise<{ status: number; html: string; headers: Record<string, string> }>;
```

On first call `render` reads `dist/client/.vite/manifest.json` to discover the hashed client script and any CSS it emitted, then caches the result. Pair it with [`@rift/node-adapter`](../node-adapter) for a working production server.

## What it does

The plugin returns three Vite plugins:

1. **`rift:transform`** — `enforce: "pre"` transform. Every `.rift` file goes through `@rift/compiler.compile()`.
2. **`rift:virtual`** — exposes virtual modules and (in build mode) configures Rollup:
   - `virtual:rift-routes` — imports every route component and exports `routes: RouteDef[]`. (Stable surface for adapters; not used by the runtime today.)
   - `virtual:rift-client` — imports `boot` from `@rift/client` plus every route/layout/404 component, and calls `boot({ ComponentName: ComponentRef, ... })`. Browser entry. In build mode, also `import`s any `opts.css` entries so Vite tracks them as assets of the client entry.
   - `virtual:rift-entry-server` — production SSR entry: statically imports every route/layout, matches the URL, calls `renderPage`, returns `{ status, html, headers }`.
   - `handleHotUpdate` invalidates the routes manifest when `.rift` files are added or removed.
3. **`rift:ssr`** — dev-only middleware **registered ahead of Vite's HTML fallback** so requests get matched by the router before Vite tries to serve an index. On each request:
   - Skip Vite internals (`/@…`, `/node_modules`, asset paths).
   - Normalize the URL.
   - `matchRoute(url, routes)`; 404 (with `_404.rift` if present) if no match.
   - `ssrLoadModule()` the matched file plus its layout chain.
   - `renderPage(...)` → `transformIndexHtml(...)` → respond.

If `tailwind: true`, `@tailwindcss/vite` is appended to the plugin chain.

## Known limitations

> [!CAUTION]
> - **HMR is full-reload.** `.rift` edits trigger a page reload, not partial component reload.
> - **`transformIndexHtml` is a single static call** — streaming would require re-architecting this.
> - **No static prerender mode yet.** Even fully static routes go through `render(url)` at request time in production.
> - **No Bun / edge adapters** — only `@rift/node-adapter` ships today. The `RenderFn` shape is request-agnostic so they're drop-ins, but the work hasn't happened.

See [`TODO.md`](../../TODO.md).
