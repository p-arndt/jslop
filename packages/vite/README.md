# @rift/vite

Vite plugin that wires up the full Rift dev experience: `.rift` transforms, route scanning, SSR middleware, and (optionally) Tailwind v4.

```bash
pnpm add -D @rift/vite vite
pnpm add @rift/client @rift/runtime
```

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

## What it does

The plugin actually returns three Vite plugins:

1. **`rift:transform`** — `enforce: "pre"` transform. Every `.rift` file goes through `@rift/compiler.compile()`.
2. **`rift:virtual`** — exposes two virtual modules:
   - `virtual:rift-routes` — imports every route component and exports `routes: RouteDef[]`.
   - `virtual:rift-client` — imports `boot` from `@rift/client` plus every route component, and calls `boot({ ComponentName: ComponentRef, ... })`. This is the browser entry point.
   `handleHotUpdate` invalidates the routes manifest when `.rift` files are added or removed.
3. **`rift:ssr`** — registers a middleware **ahead of Vite's HTML fallback** so requests get matched by the router before Vite tries to serve an index. On each request:
   - Skip Vite internals (`/@…`, `/node_modules`, asset paths).
   - Normalize the URL.
   - `matchRoute(url, routes)`; 404 if no match.
   - `ssrLoadModule()` the matched file.
   - `renderPage(...)` → `transformIndexHtml(...)` → respond.

If `tailwind: true`, `@tailwindcss/vite` is appended to the plugin chain.

## Known limitations

> [!CAUTION]
> - **No production build path.** `vite build` produces a client bundle, but there's no SSR build target and no static-output mode. Rift currently runs only in `vite dev`. A Node adapter is on the roadmap.
> - **HMR is full-reload.** `.rift` edits trigger a page reload, not partial component reload.
> - **`transformIndexHtml` is a single static call** — streaming would require re-architecting this.

See [`TODO.md`](../../TODO.md).
