# Routing

JSlop uses **file-system routing**: every `.jslop` file under `src/routes/` becomes a route. The `@jslop/router` package walks the directory; `@jslop/vite`'s SSR middleware matches incoming URLs against the result.

## File conventions

| File path                        | URL pattern         |
|----------------------------------|---------------------|
| `routes/index.jslop`              | `/`                 |
| `routes/about.jslop`              | `/about`            |
| `routes/dashboard/index.jslop`    | `/dashboard`        |
| `routes/dashboard/settings.jslop` | `/dashboard/settings` |
| `routes/posts/[slug].jslop`       | `/posts/:slug`      |
| `routes/[a]/[b].jslop`            | `/:a/:b`            |
| `routes/_layout.jslop`            | wraps siblings + descendants |
| `routes/_404.jslop`               | served on no match  |

Rules:

- A segment named `index` is dropped from the URL.
- A segment in `[brackets]` becomes a dynamic param. The name inside the brackets is the param key.
- A file starting with `_` is **not** routable directly — `_layout` and `_404` are special.
- Trailing slashes are normalized away (`/about/` → `/about`).

## Dynamic params

Define your route at `routes/posts/[slug].jslop` and declare the matching `prop`:

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

The router decodes the path segment with `decodeURIComponent` and passes it as the prop value. Multiple params work the same way:

```tsx
// routes/[org]/[repo].jslop
component Repo {
  prop org = ""
  prop repo = ""

  view { <h1>{org}/{repo}</h1> }
}
```

The prop name **must match** the bracket name — that's how the router knows where to inject the value.

## Specificity

Routes are sorted **most-specific first** before matching. Static segments outrank dynamic ones, so `/posts/featured` always beats `/posts/[slug]` even though both match the URL.

```
routes/posts/featured.jslop     → /posts/featured     (wins for exact match)
routes/posts/[slug].jslop       → /posts/:slug        (catches everything else)
```

## Layouts

A `_layout.jslop` file wraps every route in its folder (and all subfolders) in a shared shell. Use `<children/>` to mark where the page renders:

```tsx
// src/routes/_layout.jslop
component Layout {
  view {
    <div class="app">
      <header>
        <nav>
          <a href="/">home</a>
          <a href="/about">about</a>
        </nav>
      </header>

      <children/>

      <footer>© 2026</footer>
    </div>
  }
}
```

Layouts **chain**: a `routes/_layout.jslop` wraps the whole site; a `routes/dashboard/_layout.jslop` wraps only the dashboard pages but is itself wrapped by the outer layout. The matched page sits at the inside of the chain.

```
routes/_layout.jslop                ── outer shell
  routes/dashboard/_layout.jslop    ── dashboard sidebar etc.
    routes/dashboard/settings.jslop ── the actual page
```

## 404 pages

A `_404.jslop` is rendered when no route matches:

```tsx
// src/routes/_404.jslop
component NotFound {
  view {
    <main>
      <h1>404</h1>
      <p>no route matches.</p>
    </main>
  }
}
```

The 404 page goes through the layout chain like any other page, so it inherits the site shell automatically. The HTTP response status is `404` when this component renders.

If there's no `_404.jslop` and no route matches, the response is a plain 404 with minimal HTML.

## Customizing the routes directory

```js
// vite.config.mjs
import { defineConfig } from "vite";
import jslop from "@jslop/vite";

export default defineConfig({
  plugins: [
    jslop({
      routesDir: "src/pages",        // default: "src/routes"
      title: (url) => `Site — ${url}`, // <title> per route
    }),
  ],
});
```

## Programmatic API

You can drive the router yourself if you're embedding JSlop somewhere unusual:

```ts
import { scanRoutes, matchRoute } from "@jslop/router";

const routes = await scanRoutes("/abs/path/to/routes");
const match = matchRoute("/posts/hello-world", routes);
if (match) {
  console.log(match.route.relPath);   // "posts/[slug].jslop"
  console.log(match.params);          // { slug: "hello-world" }
}
```

## Client-side navigation

> [!WARNING]
> Today, **every `<a href>` is a full document load.** SPA-mode client navigation (intercepting clicks, fetching the next page, swapping the DOM in place) is not implemented yet. Because JSlop resumes rather than hydrates, full loads are cheap — but a client router is on the [roadmap](./roadmap.md).

## Not yet supported

> [!NOTE]
> The following are listed in [`PLAN.md`](https://github.com/p-arndt/jslop/blob/main/PLAN.md) but **not implemented yet**:
>
> - Catch-all routes (`[...slug]`)
> - Optional segments
> - Per-route `meta { title, description }` blocks (today, `title` is a single function on the Vite plugin)
> - Route groups (`(group)/`)
> - Loaders / actions (server functions, with `server function name(...) { }` syntax)

## See also

- [Project structure](./project-structure.md) — where `routes/` sits.
- [Components](./components.md) — declaring page components and the `<children/>` placeholder.
- [SSR & resumability](./ssr-and-resumability.md) — what happens during a route render.
