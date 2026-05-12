# @rift/router

File-system route scanning and URL matching for Rift apps. Pure functions, no runtime dependency.

```bash
pnpm add @rift/router
```

## API

```ts
import { scanRoutes, matchRoute, type RouteDef, type MatchResult } from "@rift/router";

const routes = await scanRoutes("/abs/path/to/src/routes");
// → RouteDef[], sorted most-specific-first

const match = matchRoute("/posts/hello-world", routes);
// → { route, params } | null
if (match) {
  console.log(match.route.pattern);     // "/posts/[slug]"
  console.log(match.route.relPath);     // "posts/[slug].rift"
  console.log(match.params);            // { slug: "hello-world" }
}
```

## Conventions

| File path                        | URL pattern         |
|----------------------------------|---------------------|
| `routes/index.rift`              | `/`                 |
| `routes/about.rift`              | `/about`            |
| `routes/dashboard/index.rift`    | `/dashboard`        |
| `routes/posts/[slug].rift`       | `/posts/:slug`      |

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
> - Conventional `_404.rift` / `_error.rift`

See [`TODO.md`](../../TODO.md) and [docs/routing.md](../../docs/routing.md).
