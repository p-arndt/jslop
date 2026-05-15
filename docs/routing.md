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

## `load { ... }` — running code before render

Any route or layout component can declare a `load { ... }` block. It runs on the server before the component renders, receives the URL params as `params`, and returns an object whose keys are merged into the component's props:

```tsx
// routes/posts/[slug].jslop
import { findPost } from "../../lib/posts.js"

component PostPage {
  prop slug = ""
  prop post = null

  load {
    const post = await findPost(params.slug)
    if (!post) notFound()
    return { post }
  }

  view {
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  }
}
```

How merging works (most → least specific wins on key conflicts):

1. URL params (e.g. `slug` from `[slug]`).
2. Layout `load()` results, outer-first then inner.
3. The route's own `load()` result.

So a route loader can override a layout-provided key if it really wants to; layout loaders can fill in props the route declares but doesn't compute itself.

`load` may be `async` — the server `await`s it before rendering. It runs **only on the server**: the body is bundled into the SSR entry, not the client.

### Layout loaders

The same block works on `_layout.jslop`. Layouts further out run first, so a root layout can populate (say) a `user` prop that every inner layout and route can `prop user` into:

```tsx
// routes/_layout.jslop
component Layout {
  prop buildId = ""

  load {
    return { buildId: String(Date.now()).slice(-6) }
  }

  view {
    <div>
      <children/>
      <footer>build {buildId}</footer>
    </div>
  }
}
```

### Throwing `notFound()`

Importing `notFound` from `@jslop/runtime` and calling it inside a `load` block throws a `NotFoundError` that the server catches and turns into the 404 chain (`_404.jslop` + layouts, with HTTP status 404):

```tsx
import { notFound } from "@jslop/runtime"

component PostPage {
  load {
    const post = await findPost(params.slug)
    if (!post) notFound()
    return { post }
  }
  /* ... */
}
```

`notFound()` is the way to render the 404 page from a matched route — useful when the URL is structurally valid but the resource it points at doesn't exist (a missing slug, a deleted record).

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

Same-origin `<a href="...">` clicks are intercepted on the client: the page's reactive scopes are torn down, the new page's HTML is fetched, `#app` is swapped in place, `<title>` and any new scoped `<style>` tags are merged into `<head>`, and the new root is booted with its state capsule. The browser's history is updated via `history.pushState`, and `popstate` (back/forward) navigates the same way.

```tsx
<a href="/posts/hello">Read the post</a>     {/* SPA-style swap */}
<a href="/big.pdf" download>Download</a>      {/* download attribute → full nav */}
<a href="https://example.com">External</a>    {/* cross-origin → full nav */}
<a href="/legacy" data-jslop-reload>Legacy</a>{/* opt out per-link */}
```

Opt-outs the interceptor honors (all fall back to a full document load):

- Cross-origin or non-`http(s)` `href` values.
- `target` attribute set to anything other than `_self`.
- `download` attribute present.
- `data-jslop-reload` attribute present (escape hatch).
- Modified clicks: middle-click, ⌘/Ctrl/Shift/Alt+click.
- Fragment-only `href="#..."` (browser scrolls).
- Server responses that aren't `text/html` (e.g. a redirect to an asset).

You can also navigate programmatically:

```ts
import { navigate } from "@jslop/client";

navigate("/posts/hello");                   // pushState + swap
navigate("/posts/hello", { push: false });  // replace current entry instead
```

> [!NOTE]
> Each navigation re-runs the server's `load { ... }` block for the new route (and any layouts it doesn't already share) because the new page is fetched as fully-rendered HTML. There's no client-side data layer yet — every navigation is one HTML fetch.

## Not yet supported

> [!NOTE]
> The following are listed in [`PLAN.md`](https://github.com/p-arndt/jslop/blob/main/PLAN.md) but **not implemented yet**:
>
> - Catch-all routes (`[...slug]`)
> - Optional segments
> - Route groups (`(group)/`)
> - Typed `server function` (split-bundled RPC with auto-generated client signatures and auth context). The stepping stone — untyped `action { ... }` blocks driving a POST endpoint per route — *is* shipped, see [Actions](./actions.md).

## See also

- [Project structure](./project-structure.md) — where `routes/` sits.
- [Components](./components.md) — declaring page components and the `<children/>` placeholder.
- [SSR & resumability](./ssr-and-resumability.md) — what happens during a route render.
