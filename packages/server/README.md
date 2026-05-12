# @rift/server

SSR for Rift components. Walks a compiled component's `buildView()` tree, emits HTML, and inlines the state capsule that `@rift/client` resumes from.

```bash
pnpm add @rift/server
```

## API

```ts
import { renderPage, renderView } from "@rift/server";

const html = renderPage({
  title: "My page",
  component,                            // a __rift_component (default export of a compiled .rift)
  props: { slug: "hello-world" },
  appScriptUrl: "/client.js",           // <script type="module" src="...">
  stylesheets: ["/src/app.css"],        // optional <link rel="stylesheet">
  head: "<meta name=\"x\" content=\"y\">", // optional extra <head> HTML
});
```

`renderView(node)` is the lower-level helper that turns a single `ViewNode` into an HTML string.

## Output shape

```html
<!doctype html>
<html>
  <head>
    <title>My page</title>
    <link rel="stylesheet" href="/src/app.css">
  </head>
  <body>
    <div id="__rift_root">
      <!-- rendered component HTML -->
    </div>
    <script id="__rift_state" type="application/json">
      { "count": 0, "children": [ ... ] }
    </script>
    <script type="module" src="/client.js"></script>
  </body>
</html>
```

The state capsule is plain JSON — `@rift/client` reads it via `JSON.parse`. There is no class revival or function deserialization.

## Known limitations

> [!CAUTION]
> - **Buffered.** The whole page is rendered to a string before responding. Streaming SSR isn't implemented.
> - **Whitespace.** Pure-whitespace text nodes still emit a space character — usually harmless but produces ugly HTML.

See [`TODO.md`](../../TODO.md) and [docs/ssr-and-resumability.md](../../docs/ssr-and-resumability.md).
