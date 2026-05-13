# Project structure

A Rift app is a normal Vite project with a `@rift/vite` plugin. Here's what a minimal app looks like.

## File layout

```
my-app/
├── package.json
├── vite.config.mjs
├── src/
│   ├── routes/
│   │   ├── index.rift           → /
│   │   ├── about.rift           → /about
│   │   ├── _layout.rift         (optional)
│   │   ├── _404.rift            (optional)
│   │   └── posts/
│   │       └── [slug].rift      → /posts/:slug
│   ├── components/              (convention, not required)
│   │   └── Button.rift
│   └── app.css                  (optional, for Tailwind / global CSS)
└── serve.mjs                    (production only)
```

What each piece is for:

- `src/routes/` — the route tree. Every `.rift` file here becomes a route. See [Routing](./routing.md).
- `src/components/` — a convention for shared `.rift` components. Rift doesn't enforce a location; import them from anywhere.
- `src/app.css` — your global stylesheet, if you have one. Tell the Vite plugin about it via `css: "/src/app.css"`.
- `serve.mjs` — a small Node entrypoint that serves the production build with `@rift/node-adapter`. See [Building & deploying](./building.md).

## `package.json`

The minimum set of dependencies:

```json
{
  "name": "my-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build && vite build --ssr",
    "serve": "node serve.mjs"
  },
  "dependencies": {
    "@rift/client": "workspace:*",
    "@rift/node-adapter": "workspace:*",
    "@rift/router": "workspace:*",
    "@rift/runtime": "workspace:*",
    "@rift/server": "workspace:*"
  },
  "devDependencies": {
    "@rift/vite": "workspace:*",
    "vite": "^7.0.0"
  }
}
```

> [!IMPORTANT]
> Use **pnpm**, not npm or yarn. The Rift workspace is pnpm-only.

> [!NOTE]
> `@rift/server` and `@rift/router` are listed as **runtime** dependencies, not dev dependencies. That's deliberate — the production SSR entry bundles them, and pnpm's strict resolver refuses to find them if they're not declared at the project level.

## `vite.config.mjs`

The smallest possible config:

```js
import { defineConfig } from "vite";
import rift from "@rift/vite";

export default defineConfig({
  plugins: [rift()],
});
```

Common options:

```js
rift({
  routesDir: "src/routes",         // default: "src/routes"
  tailwind: true,                  // auto-load @tailwindcss/vite
  css: "/src/app.css",             // global CSS to inject
  title: (url) => `Site — ${url}`, // <title> per route
})
```

See [Routing](./routing.md) for `routesDir`, [Styling](./styling.md) for `tailwind` and `css`.

## A route file

```tsx
// src/routes/index.rift
component Home {
  state n = 0
  function inc() { n++ }

  view {
    <main>
      <h1>hello</h1>
      <button onclick={inc}>clicked {n} times</button>
    </main>
  }
}
```

A route file is just a `.rift` file that exports a component. The first component declared is the route's page. You can declare helpers in the same file:

```tsx
// src/routes/index.rift
component Home {
  view {
    <main>
      <Greeting name="world" />
      <Greeting name="rift" />
    </main>
  }
}

component Greeting {
  prop name = "?"
  view { <p>hello, {name}</p> }
}
```

The router only routes to the **first** component in a route file; the rest are local helpers.

## A layout file

A `_layout.rift` wraps every route in the same folder (and below). Use `<children/>` to mark where the page should render:

```tsx
// src/routes/_layout.rift
component Layout {
  view {
    <div class="app">
      <header><nav>...</nav></header>
      <children/>
      <footer>© 2026</footer>
    </div>
  }
}
```

## A 404 file

`_404.rift` is the page that renders when no route matches:

```tsx
// src/routes/_404.rift
component NotFound {
  view {
    <main>
      <h1>404</h1>
      <p>no route matches.</p>
    </main>
  }
}
```

It runs through the layout chain like any other page.

## Where to put shared components

Anywhere. The convention used in `examples/counter` is `src/components/`, but you're free to organize however you like. Import them from routes:

```tsx
import { Button, Card } from "../components/widgets.rift"
import Header from "../components/Header.rift"
```

A `.rift` file may declare any number of components. The first is the default export; the rest are named exports. See [Components](./components.md).

## See also

- [Getting started](./getting-started.md) — bootstrap a fresh project.
- [Routing](./routing.md) — file-system route conventions.
- [Building & deploying](./building.md) — production build and `serve.mjs`.
