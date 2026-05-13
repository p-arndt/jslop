# @jslop/node-adapter

A Node HTTP wrapper around a built JSlop SSR `render(url)`. Serves static assets from `dist/client/` and falls through to the SSR entry for everything else.

```bash
pnpm add @jslop/node-adapter
```

## Usage

Build your app first (see [`@jslop/vite`](../vite) docs):

```bash
vite build              # → dist/client/
vite build --ssr        # → dist/server/entry-server.js
```

Then drop in a serve script:

```js
// serve.mjs
import { createServer } from "@jslop/node-adapter";
import { render } from "./dist/server/entry-server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = createServer({
  render,
  clientDir: resolve(here, "dist/client"),
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`listening on http://localhost:${process.env.PORT ?? 3000}`);
});
```

```bash
node serve.mjs
```

## API

### `createHandler(opts) → (req, res) => void`

Returns a Node HTTP request handler.

| Option               | Type                                                              | Required | Notes                                                                |
|----------------------|-------------------------------------------------------------------|----------|----------------------------------------------------------------------|
| `render`             | `RenderFn`                                                        | yes      | The function exported by `dist/server/entry-server.js`.              |
| `clientDir`          | `string`                                                          | yes      | Absolute path to the built client dir (typically `dist/client`).     |
| `title`              | `(url, params) => string`                                         | no       | Forwarded to `render` as `opts.title`.                               |
| `clientManifestPath` | `string`                                                          | no       | Override path to `.vite/manifest.json`. Defaults to `<clientDir>/.vite/manifest.json`. |

Behavior:

- If the request path has a file extension (`.js`, `.css`, `.png`, ...) and the file exists under `clientDir`, it's served as a static asset.
- Files under `/assets/` get `cache-control: public, max-age=31536000, immutable` — safe because Vite hashes their filenames.
- Path traversal is blocked: anything that resolves outside `clientDir` falls through to `render`.
- All other requests call `render(url, { title, clientManifestPath })`. The result's `status`, `headers`, and `html` are written to the response.
- Render errors are logged and answered with `500 internal server error`.

### `createServer(opts) → http.Server`

Same options as `createHandler`, plus passes the handler to `http.createServer`. Returns the unstarted server — call `.listen(port)` yourself.

### Types

```ts
type RenderFn = (
  url: string,
  opts?: {
    appScriptUrl?: string;
    stylesheets?: string[];
    title?: (url: string, params: Record<string, string>) => string;
    clientManifestPath?: string;
  }
) => Promise<{
  status: number;
  html: string;
  headers: Record<string, string>;
}>;
```

The `RenderFn` shape is intentionally request-agnostic — only a URL string in, a result object out — so Bun / edge / fetch-handler adapters can be written against the same contract.
