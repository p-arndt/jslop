# Routing

Rift uses **file-system routing**: every `.rift` file under `src/routes/` becomes a route. The `@rift/router` package walks the directory; `@rift/vite`'s SSR middleware matches incoming URLs against the result.

## File conventions

| File path                        | URL pattern         |
|----------------------------------|---------------------|
| `routes/index.rift`              | `/`                 |
| `routes/about.rift`              | `/about`            |
| `routes/dashboard/index.rift`    | `/dashboard`        |
| `routes/dashboard/settings.rift` | `/dashboard/settings` |
| `routes/posts/[slug].rift`       | `/posts/:slug`      |
| `routes/[a]/[b].rift`            | `/:a/:b`            |

Rules:

- A segment named `index` is dropped from the URL.
- A segment wrapped in `[brackets]` becomes a dynamic param. The name inside the brackets is the param key.
- Trailing slashes are normalized away (`/about/` → `/about`).

## Dynamic params

Define your route file at `routes/posts/[slug].rift` and declare the matching `prop`:

```tsx
component PostBySlug {
  prop slug = ""

  view {
    <article>
      <h1>Post: {slug}</h1>
    </article>
  }
}
```

The router decodes the path segment (`decodeURIComponent`) and passes it as the prop value. Multiple params work the same way:

```tsx
// routes/[org]/[repo].rift
component Repo {
  prop org = ""
  prop repo = ""

  view { <h1>{org}/{repo}</h1> }
}
```

## Specificity

Routes are sorted **most-specific first** before matching. Static segments outrank dynamic ones, so `/posts/featured` always beats `/posts/[slug]` even though both regex-match the URL.

## Customizing the routes directory

```js
// vite.config.mjs
import { defineConfig } from "vite";
import rift from "@rift/vite";

export default defineConfig({
  plugins: [
    rift({
      routesDir: "src/pages",     // default: "src/routes"
      title: (url) => `Site — ${url}`,
    }),
  ],
});
```

## Programmatic API

You can drive the router yourself if you're embedding Rift somewhere unusual:

```ts
import { scanRoutes, matchRoute } from "@rift/router";

const routes = await scanRoutes("/abs/path/to/routes");
const match = matchRoute("/posts/hello-world", routes);
if (match) {
  console.log(match.route.relPath);   // "posts/[slug].rift"
  console.log(match.params);          // { slug: "hello-world" }
}
```

## Not yet supported

> [!WARNING]
> The following are listed in [`PLAN.md`](../PLAN.md) but **not implemented yet**:
>
> - Catch-all routes `[...slug]`
> - Optional segments
> - Layouts / `<Outlet />`
> - Per-route `meta { title, description }` blocks
> - Conventional `_404.rift` / `_error.rift` pages
> - Client-side navigation — every `<a>` is currently a full page load
>
> See [TODO.md](../TODO.md) for status.
