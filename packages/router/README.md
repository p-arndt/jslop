# @jslop/router

File-system route scanning and URL matching for JSlop apps. Pure functions, no runtime dependency.

```bash
pnpm add @jslop/router
```

## API

```ts
import { scanRoutes, matchRoute, type RouteDef, type MatchResult } from "@jslop/router";

const routes = await scanRoutes("/abs/path/to/src/routes");
// → RouteDef[], sorted most-specific-first

const match = matchRoute("/posts/hello-world", routes);
// → { route, params } | null
if (match) {
  console.log(match.route.pattern);     // "/posts/[slug]"
  console.log(match.route.relPath);     // "posts/[slug].jslop"
  console.log(match.params);            // { slug: "hello-world" }
}
```

## Conventions

| File path                        | URL pattern         |
|----------------------------------|---------------------|
| `routes/index.jslop`              | `/`                 |
| `routes/about.jslop`              | `/about`            |
| `routes/dashboard/index.jslop`    | `/dashboard`        |
| `routes/posts/[slug].jslop`       | `/posts/:slug`      |

- `index` segments are stripped from the URL.
- `[bracketed]` segments are dynamic params. The name inside the brackets is the key returned in `match.params`.
- Static segments outrank dynamic ones during matching (specificity-first sort).
- Trailing slashes are normalized away.

## Not yet supported

> [!WARNING]
> The router doesn't yet support:
>
> - Catch-all `[...slug]`
> - Optional segments
> - Layout / `<Outlet />` conventions
> - Conventional `_404.jslop` / `_error.jslop`

See [`TODO.md`](../../TODO.md) and [docs/routing.md](../../docs/routing.md).
