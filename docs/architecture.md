# Architecture

Rift is a pnpm workspace of small, single-purpose packages. Each one does one job and depends only on the runtime and (sometimes) the compiler.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         @rift/vite (plugin)                          │
│                                                                      │
│   .rift file  ──►  @rift/compiler  ──►  JS module                    │
│                                                                      │
│   virtual:rift-routes  ◄──  @rift/router  (scan src/routes)          │
│                                                                      │
│   request /url  ──►  @rift/router.match  ──►  @rift/server.render    │
│                                                                      │
│   virtual:rift-client  ──►  @rift/client.boot()  in browser          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          @rift/runtime
                  (cell / derived / effect / batch)
```

## Packages

### `@rift/runtime`

The reactivity engine. Tiny — about 150 lines.

Exports: `cell`, `derived`, `effect`, `batch`, `untrack`, `isReactive`, types `Cell<T>`, `Derived<T>`, `Reactive<T>`.

Push-based subscription model: cells track which subscribers read them; on `set`, subscribers re-run unless we're inside a `batch`. See [reactivity.md](./reactivity.md).

### `@rift/compiler`

Parses `.rift` files and emits ES modules.

Three stages:

1. **Parser** (`parser.ts`) — hand-rolled cursor-based DSL parser. Produces a `ParsedComponent` AST with imports, props, reactive `state` declarations, non-reactive `let` bindings, functions, and a `ViewNode` tree.
2. **Rewriter** (`rewrite.ts`) — AST-aware JS rewriter built on `acorn` + `magic-string`. The reactive-name set is `props ∪ states` — `let` bindings are never in it, so identifier references to them pass through untouched. For names that *are* reactive, reads become `.get()`, writes become `.set(...)`, and compound assignments expand via `.peek()`. Shadow-aware: function parameters, function-local `const`/`let`, and `each` item/index bindings shadow same-named outer reactives.
3. **Codegen** (`codegen.ts`) — walks the AST and emits a JS module with a default export `__rift_component = { name, create(props) }`. The `create()` function builds cells, declares functions, wires up children, and returns `{ actions, buildView, serializeState, restoreState, children }`.

Public API: `compile(source, opts?)`, `parseComponent(source)`, `generate(parsed, opts?)`.

### `@rift/router`

File-system route scanning and URL matching.

- `scanRoutes(dir)` — async walk, returns `RouteDef[]` sorted most-specific first.
- `matchRoute(url, routes)` — returns `{ route, params } | null`.

Pure functions, no runtime dependency. Used by `@rift/vite` to build the routes manifest.

### `@rift/server`

SSR. Walks a component instance's `buildView()` tree and emits HTML + a JSON state capsule.

- `renderView(node)` — `ViewNode` → HTML string.
- `renderPage({ title, component, props, appScriptUrl, stylesheets })` — full page including capsule, `<script type="module" src="...">` for the client bundle, optional `<link rel="stylesheet">` injections.

The state capsule lives in `<script id="__rift_state" type="application/json">`.

### `@rift/client`

Browser boot.

- `boot(registry)` — reads the state capsule from the DOM, instantiates the root component from `registry`, calls `restoreState`, then walks the view tree and attaches event handlers + sets up `effect()`s for every reactive binding.
- Every mounted root opens a top-level `Scope`. `mountIf` opens a fresh scope per branch swap, `mountEach` opens one scope per list item. Disposing a scope tears down every effect created inside it, so `{#if}` swaps and `{#each}` removes don't leak.
- Keyed `{#each list as item, i (key)}` is reconciled by key: matching items keep their DOM and per-item scope across reorders / inserts; removed keys have their scope disposed and DOM removed. Unkeyed lists fall back to dispose-then-rebuild (still scoped, just less efficient).
- `bind:value` / `bind:checked` desugar to a property bind (`{ kind: "prop", get }`) that the runtime writes directly to the DOM IDL property — necessary because `setAttribute('value', …)` doesn't update an `<input>` the user has already typed into.

The view tree it walks is the **same shape** the server walked, so DOM and view nodes line up by traversal order — there's no separate "hydration matching" step.

### `@rift/vite`

The bundler integration that ties everything together.

- **Transform plugin** — every `.rift` file goes through `@rift/compiler.compile()`.
- **Virtual modules** — `virtual:rift-routes` (server-side import of every route component) and `virtual:rift-client` (client entry that calls `boot()` with a registry of components).
- **SSR middleware** — registered ahead of Vite's HTML fallback. On each request: load routes manifest, match URL, `ssrLoadModule` the matched `.rift`, call `renderPage`, run `transformIndexHtml`, send.
- **Optional Tailwind v4** — `tailwind: true` auto-loads `@tailwindcss/vite`.

## A request, end-to-end

For `GET /posts/hello-world`:

1. **`@rift/vite` SSR middleware** intercepts the request.
2. `loadRoutes()` returns the cached `RouteDef[]` (or scans `src/routes/`).
3. `matchRoute("/posts/hello-world", routes)` finds `posts/[slug].rift` and extracts `{ slug: "hello-world" }`.
4. `ssrLoadModule(absPath)` runs the compiled module on the server. Vite's transform pipeline calls `@rift/compiler.compile()` on the source first.
5. The module's default export is `__rift_component`. We call `component.create({ slug: "hello-world" })`.
6. `renderPage({ component, props, ... })`:
   - Calls `component.create(props)` again (one instance for render).
   - Walks `instance.buildView()` and writes HTML.
   - Calls `instance.serializeState()` and inlines the JSON.
   - Emits `<script type="module" src="/@id/virtual:rift-client">`.
7. `transformIndexHtml` runs Vite's normal pipeline (HMR client, etc.).
8. Response goes out as `text/html`.

In the browser:

1. Vite serves `virtual:rift-client`. The generated module imports `boot` from `@rift/client` plus every route component, then calls `boot({ ComponentName: ComponentRef, ... })`.
2. `boot` reads `<script id="__rift_state">`, finds the right component in the registry, calls `create(props)` and `restoreState(capsule)`.
3. `boot` walks `instance.buildView()` and the existing DOM in lockstep, attaching event handlers and wrapping each `bind` node in an `effect()`.
4. From this point on, user interactions trigger `cell.set` → subscribers re-run → DOM nodes update fine-grained.

## What's intentionally not here

- No virtual DOM. The view tree is just descriptors; updates write directly to DOM nodes via the `effect` graph.
- No global store or context. State is component-local; reactivity flows through cells passed as props.
- No special server/client file split. Today everything is "isomorphic" because there are no server-only constructs yet — when `server function` lands, the compiler will split bodies at compile time.
- No CSS-in-JS engine. Plain `class="..."` works; Tailwind works because nothing rewrites classes.

See [PLAN.md](../PLAN.md) for the design intent and [TODO.md](../TODO.md) for the gap list.
