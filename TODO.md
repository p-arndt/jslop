# JSlop — TODO

Honest status of what's built, what's broken, and what's missing. Compared against `PLAN.md`.

## Legend

- ✅ Done and verified end-to-end
- 🟡 Partially done — works for happy path, has known gaps
- ❌ Not started
- 🐛 Known bug

---

## Core runtime

- ✅ `cell(v)` / `derived(fn)` / `effect(fn)` / `batch` / `untrack`
- ✅ `isReactive` helper for prop normalization
- ✅ Effect disposer scopes (`createScope` / `runInScope` / `disposeScope` / `onCleanup`). Effects created inside a scope are auto-cleaned when the scope is disposed. Effects snapshot their owner scope at creation, so re-runs triggered from foreign scopes still own their child scopes correctly. Covered by 5 unit tests.
- ❌ Async cells: `ServerValue<T>` shape from `PLAN.md` (`{ value, loading, error, refresh() }`). Required for `server data = await ...` in the DSL.

## Compiler

- ✅ Hand-rolled DSL parser (`component`, `state`, `let`, `function`, `prop`, `view`, `import`)
- ✅ AST-based identifier rewriter (acorn + magic-string), shadow-aware, 19 unit tests
- ✅ View parser: elements, `{expr}`, `on<event>` handlers, capitalized tags as components, `{#if}…{:else}…{/if}`, `{#each list as item, i}…{/each}`
- ❌ Source maps — codegen outputs no maps, so stack traces point at compiled coords
- ✅ Friendly compile-time diagnostics. Parse errors now throw a `JSlopParseError` (offset + optional hint) and the compiler wraps it into a `file:line:col` header plus a 5-line code frame with a caret and a remediation hint when `filename` is passed. The Vite plugin passes the module `id`, so errors in dev show e.g. `src/routes/index.jslop:6:12: closing tag </buton> does not match opening <button>` with a frame. Common cases (unknown declaration keyword, closing-tag mismatch, unterminated tag children, unbalanced braces, missing top-level `component`) carry tailored hints. Covered by `diagnostics.test.mjs`.
- 🟡 `derived`, `when`, `mount`, `cleanup` block syntax from PLAN.md — `derived name = expr` keyword shipped (parser + codegen + tests in `derived.test.mjs`; RHS identifiers rewritten to `.get()`, emitted as `derived(() => …)`). Compile-time write guard rejects `derived = …`, compound-assign, and `++`/`--` (`derived_write_guard.test.mjs`). `when` / `mount` / `cleanup` blocks still pending.
- ✅ State / let initializers go through a `.peek()` rewrite so `state title = task.title` reads the loaded prop's current value instead of the cell wrapper. Without it, every form prefilled from a loaded prop required `task.peek().title` boilerplate. Covered by `rewriteInitExpr` in `rewrite.ts`.
- 🟡 `style { ... }` / `style Name { variants: ... }` block from PLAN.md — scoped `style { ... }` shipped (hashed `jslop-<name>-<hash>` class on the component root, selectors prefixed, single `<style>` per component registered at module load; SSR emits the registry into `<head>`, client injects on boot; covered by `style.test.mjs`). First-class `style Name { variants: … }` declarations still pending.
- ✅ Per-component `head { ... }` block — parser + codegen + SSR injection (route head rendered after layouts so its `<title>`/meta win; reactive `{expr}` works inside, raw text in `<title>` preserved). Covered by `head.test.mjs` (compiler) + `head.test.mjs` (server).
- ❌ `schema Name { ... }` block (form schemas) from PLAN.md

## SSR (`@jslop/server`)

- ✅ Renders elements, binds, components, conditionals, lists
- ✅ State capsule with nested children + root props
- ✅ Page template with `<link rel="stylesheet">` + extra head injection
- 🐛 Whitespace handling: text nodes that are pure whitespace still emit a space character. Mostly harmless but produces ugly HTML and forces the client to pair them correctly. Trim more aggressively or distinguish significant whitespace.
- ❌ Streaming SSR — currently buffers the whole HTML before responding.

## Client (`@jslop/client`)

- ✅ Boot reads capsule, restores state, walks view tree
- ✅ Attaches event handlers from view nodes (as function values, not lookups)
- ✅ Recursive `buildNode` for fresh DOM mounts (used by `{#if}` rebuilds and `{#each}`)
- ✅ Keyed `{#each}` reconciliation: `{#each list as item, i (item.id)}` preserves DOM identity across reorder, dispose-on-remove, and insert-in-middle without rebuilding neighbors. Per-item effect scopes are disposed when an item is removed, so binds inside list items no longer leak. Unkeyed lists fall back to dispose-then-rebuild but now correctly tear down the previous items' effect scopes. Covered by 5 client integration tests.
- 🟡 Components nested inside `{#each}` now get a fresh instance per item (codegen emits `const __c_N = X.create(...)` inside the build callback instead of hoisting). For keyed lists, instances are reused across reorders since `build()` only runs for new keys. **Open gap:** child component state inside an each is *not* serialized into the parent's `__children`, so SSR-restored state for those instances doesn't round-trip — they re-create from scratch on hydration. Acceptable for stateless presentational components; problematic for stateful ones.
- ✅ Client-side navigation (SPA mode). Same-origin `<a>` clicks intercepted; new page fetched as HTML, previous root scopes disposed, `#app` swapped, `<title>` updated, new scoped `<style>` tags merged, `pushState`/`popstate` wired. Honors `target`/`download`/cross-origin/modifier-click/fragment-only/`data-jslop-reload` opt-outs, plus non-`text/html` responses. Programmatic `navigate(url, { push? })` exported from `@jslop/client`.
- ✅ Two-way binding sugar: `<input bind:value={cell}>`, `<input type="checkbox" bind:checked={cell}>`, `<select bind:value={cell}>`. Compiler synthesizes both the property bind (driving the IDL property, not the attribute, so programmatic updates overwrite user-typed values correctly) and the matching event handler. Counter example migrated. Conflicts with explicit `value=`/`oninput=` on the same element are rejected at parse time. Covered by 7 compiler + 3 SSR + 2 client tests.
- ✅ `<children/>` placeholder + `renderRouteChain` for nesting layouts around routes. Each layout is a normal JSlop component (own state, own cid, own capsule entry); the placeholder is replaced with the inner HTML at SSR, and the client skips over the placeholder position when attaching the layout (the inner component owns its own attach via its cid). Covered by compiler + server tests.

## Vite plugin (`@jslop/vite`)

- ✅ `.jslop` transform via `@jslop/compiler`
- ✅ Virtual modules `virtual:jslop-routes` and `virtual:jslop-client`
- ✅ SSR middleware (registered pre-Vite-internals so route matching beats the html-fallback)
- ✅ `handleHotUpdate` invalidates routes manifest on `.jslop` add/remove
- ✅ Optional Tailwind v4 wiring (`tailwind: true`), CSS injection (`css: "/src/app.css"`)
- ✅ Production build path. `vite build` emits `dist/client/` (hashed JS + CSS + `.vite/manifest.json`) and `vite build --ssr` emits `dist/server/entry-server.js` exporting `render(url, opts?) → { status, html, headers }`. The plugin's `config()` hook flips rollup input/output between the two via `env.isSsrBuild`; workspace `@jslop/*` packages are bundled into the server entry (`ssr.noExternal`). The server entry auto-discovers the hashed client bundle and any emitted CSS by reading `dist/client/.vite/manifest.json` at runtime — opts.css source paths are not re-emitted in prod. Verified end-to-end on `examples/counter` and `examples/site` (routes, layouts, dynamic params, 404 page).
- 🟡 Node / Bun / edge runtime adapters. `@jslop/node-adapter` exports `createHandler` / `createServer` that wraps the SSR `render` plus static-asset serving from `dist/client/` (long-cache headers for hashed `assets/`). No Bun/edge adapters yet, but the `RenderFn` shape is request-agnostic so they'd be drop-ins.
- ❌ `transformIndexHtml` integration is a single static call; for streaming responses we'd need to re-architect
- ❌ Static-HTML pre-render mode for fully static routes (today every request goes through `render(url)`).
- 🐛 HMR for `.jslop` changes triggers a **full page reload**, not partial component reload. Vite's defaults do the right thing for module changes, but the visible behavior is "reload". Could be improved with explicit `import.meta.hot.accept` codegen.

## Router (`@jslop/router`)

- ✅ Recursive scan of routes dir
- ✅ Pattern → regex matching with `[param]` placeholders
- ✅ Static segments rank higher than dynamic (specificity sort)
- ✅ Layouts via `_layout.jslop` convention. A `_layout.jslop` in any directory wraps every route at or below that directory; chains compose outermost-first. Layouts use `<children/>` as the placeholder (chosen over Svelte-style `<slot/>` so the same primitive can later cover generic component children — one mental model, not two). Per-route effect serialization for layout state is the same as any other component (each gets its own cid + capsule entry, boots independently).
- ✅ 404 pages via `_404.jslop` at the routes root. Served with status 404; goes through the layout chain so the not-found page wears the same chrome as the rest of the site.
- ✅ Per-route and per-layout `load { ... }` block. Compiled into an exported async `load({ params, url })` alongside the component; `params` is the matched path-param object, `url` is the parsed request URL so loaders can read `url.searchParams` for filters etc. The server runs layout loaders outer-first, then the route loader, merging results into props (URL params → layout loads → route load, route wins on key conflicts). `notFound()` from `@jslop/runtime` throws a `NotFoundError` that bubbles to the 404 chain (status 404). Covered by `layout_load.test.mjs`.
- ❌ Catch-all routes (`[...slug]`)
- ❌ Optional segments
- ❌ Per-route error pages (`routes/_error.jslop`)

## Forms (PLAN.md killer feature, mostly missing)

- ❌ `schema FormName { ... }` declaration
- ❌ `<Form schema={...} action={...}>` component
- ❌ `<Field name="x" />` with auto wiring
- ❌ Server validation + client validation
- ❌ No-JS submit fallback (POST → redirect → SSR) — would unlock the "progressive by default" pitch
- ❌ Optimistic updates, pending state
- ❌ CSRF, rate limiting

## Server functions (the PLAN.md "killer protocol")

- ❌ `server function rename(id, name) { ... }` syntax in `.jslop`
- ❌ Compiler split: server bodies stripped from client bundle; replaced with typed RPC stubs
- ❌ Transport: explicit action IDs, JSON-only, no executable payload (per PLAN's "boring protocol" stance after RSC RCE)
- ❌ Built-in `requireUser()`, auth context plumbing
- ❌ `invalidate(server_value)` for reactive refetch

### Interim: server-side mutation primitive

The tasks demo (`examples/tasks/`) surfaced an obvious smaller gap on the way
to server functions. Today, mutations live in `serve.mjs` as hand-written
`/api/*` HTTP handlers plus a parallel dev middleware in `vite.config.mjs`,
and the client calls them via a hand-written `src/api.js`. That's a lot of
plumbing for the most common reason to have a server.

- ❌ `action { create(input) { … } }` block declared inside a `.jslop` route
  alongside `load`. Compiled into named POST endpoints, callable from the
  client by name (`actions.create({...})`) without writing `/api/*` glue.
- ❌ On success, auto re-runs the route's `load` so the page reflects the
  mutation. (Today the tasks demo accomplishes this by calling
  `navigate(window.location.pathname + window.location.search)` after each
  mutation — workable but expensive: a full HTML round-trip per click.)
- ❌ Optimistic-update story: a way to apply a local diff before the round
  trip resolves and reconcile on response. Without it every mutation has a
  visible latency.
- ❌ `?ssr` (or similar) module convention for server-only code, so
  `src/store.js` doesn't need the current dance of dynamic imports inside
  function bodies + `@vite-ignore` to stay out of the client bundle.

This is meant as a stepping stone, not a replacement: it can ship without
the split-bundling / typed-RPC / auth-context machinery the full "server
functions" item demands.

## Local-first / data primitives

- ❌ `server data = await db.x.find()` syntax + auto-wired loading/error/refresh
- ❌ `local todos = collection<Todo>("todos")` — IndexedDB-backed collections
- ❌ `sync todos with server.todos { conflict: "server-wins" }`
- ❌ `<Await value={...}><Pending/><Error/><Resolved/></Await>`

## Styling

- ✅ Plain `class="..."` works (Tailwind works because we don't touch class attrs)
- ✅ Scoped `style { ... }` blocks — hashed scope class on component root, selectors prefixed at compile time, single `<style>` per component registered at module load. SSR emits the full registry into `<head>`; client injects on boot. Nested-component styles collected through the render tree.
- ❌ `style Button { base, variants }` first-class variant declaration

## Devtools (PLAN.md differentiator)

- ❌ Reactive-graph inspector ("click a value → see where it came from / what it updates / SSR vs client / size")
- ❌ Component tree
- ❌ State diff viewer

## Production readiness

- 🟡 Tests:
  - ✅ Compiler rewriter unit tests (19)
  - 🟡 Parser unit tests (10 — `{#each}` key-syntax variants + `bind:` sugar; rest of grammar still uncovered)
  - 🟡 Codegen tests (6 — lazy component instantiation inside `{#each}`, hoisted-vs-inline parity, `bind:` rewrites)
  - 🟡 SSR snapshot tests (7 — keyed/unkeyed `<jslop-each>` rendering, child component inside each, prop-bind boolean+escape)
  - 🟡 Client tests (8 keyed/unkeyed reconciliation, leak prevention, child-instance reuse across reorders, two-way property bind, against a hand-rolled stub DOM — replace with happy-dom)
  - ✅ Runtime scope tests (5)
  - ❌ Router unit tests
  - ❌ E2E via Playwright against `pnpm dev`
- ❌ Error boundaries
- 🟡 Bundle size budget / measurement — `benchmarks/bundle-size/` builds the counter fixture in both JSlop and Svelte 5 via the same esbuild config and reports raw/gzip/brotli. No budget enforced in CI yet.
- 🟡 Performance benchmarks vs Solid / Svelte — `benchmarks/reactivity/` covers four reactivity-throughput scenarios vs Svelte 5 runes (set, fanout, wide reader, create+dispose). Solid not yet added; no large-list / DOM benchmark yet.
- ❌ Accessibility audit on emitted DOM
- ❌ CSP-friendly output (no inline scripts beyond the capsule)

## Repo hygiene

- ✅ Root README explaining what JSlop is, how to try the examples, and how to build for production
- ✅ Per-package READMEs (compiler, runtime, server, client, router, vite, node-adapter)
- ❌ CHANGELOG
- ✅ License file (MIT)
- ❌ CI (lint, typecheck, test, build the examples)
- ❌ `pnpm test` script at root that runs all package tests
- ❌ Pruning: the `examples/counter/smoke.mjs` hand-rolled DOM stub is fragile and now redundant with Vite; replace with happy-dom-backed tests

## Onboarding / startup experience

Today, starting a new JSlop app means: clone this repo, run `pnpm install`, `pnpm build`, then either edit one of the examples in place or hand-copy `package.json` + `vite.config.mjs` + `src/app.css` + a routes folder and rewire the workspace dep paths into a new project. That's enough friction to lose every drive-by visitor.

- 🟡 `npm create jslop@latest` (and `pnpm create jslop` / `bun create jslop`) scaffolding CLI. Built as `packages/create-jslop`: takes a project name (positional arg or prompt) and a template (`--template=<name>`, prompts when ambiguous), copies the chosen template, rewrites `__JSLOP_VERSION__` to its own version (so the scaffold tracks the CLI release), and renames `_gitignore` → `.gitignore` to dodge npm's tarball-strip. One template shipped (`minimal`: routes/index.jslop with `state` + `bind:value` + `{#if}`, Vite config, Node `serve.mjs`). Not yet on npm — once `create-jslop@0.1.0` is published, `npm create jslop my-app` works. Open: Tailwind and CRUD templates.
- 🟡 Published npm packages for `@jslop/{client,compiler,node-adapter,router,runtime,server,vite}`. Versions bumped to `0.1.0`, metadata + `publishConfig.access: "public"` + `prepublishOnly` + slim `files` + `engines` + `sideEffects` in place, cross-package deps switched from `workspace:*` to `workspace:^` so `pnpm publish` rewrites to real ranges. Changesets installed at the root (`pnpm changeset` / `pnpm release`) with all framework packages in a single `fixed` version group. All packages build clean and `npm pack --dry-run` reports sane tarballs. Remaining step is the actual `pnpm release` (or first manual `pnpm -r build && pnpm publish -r --access public`) against the `@jslop` npm scope.
- ❌ A "Try it in StackBlitz / CodeSandbox" badge in the README pointing at a runnable fork of `examples/tasks` (or a hosted preview at e.g. `jslop.dev`). Removes even the "do I have Node installed?" step for the first 30 seconds.
- ❌ One-line install for the scaffold target. Today's quickstart in `docs/getting-started.md` is 3 commands; ideally:
  ```bash
  pnpm create jslop my-app && cd my-app && pnpm dev
  ```
  ... and they're staring at a working SSR'd page on `localhost:5173`.
- ❌ First-run experience inside a fresh scaffold: a `routes/index.jslop` that's actually useful as a starting point (not a Hello World), plus inline comments pointing at each primitive (`state`, `load`, `head`, `style`).
- 🟡 Error-on-first-mistake quality: the diagnostic engine is now in place (file:line:col, code frame, remediation hints — see the Compiler section). What's left to land for novices is (a) hints on the *codegen* side (rewriter / write-guard errors don't yet go through the same pipeline), (b) wiring the formatted message into a Vite overlay rather than the default error wrapper, and (c) extending hint coverage to common JS-inside-view mistakes (e.g. using `count` instead of `count.get()` when reaching for the value).

## Distribution / CDN usage

Today the only way to use JSlop is to clone the monorepo (or, once the create-jslop scaffold lands, run a Node-based scaffold + Vite dev server). There is no path to "drop a `<script>` tag into an HTML file and write a component." That cuts off three groups of users: people who want to sprinkle reactivity into an existing static site, REPL/playground/embed-in-a-blog-post use cases, and anyone who wants to try the framework without installing Node.

Three flavors, roughly in order of cost:

- ✅ **Runtime-only CDN bundle.** `@jslop/runtime` now builds four browser-ready bundles into `dist/` via an esbuild step (`build-cdn.mjs`): `jslop-runtime.esm.js[.min]` and `jslop-runtime.global.js[.min]` (IIFE → `globalThis.JSlop`). `package.json` exposes `unpkg` / `jsdelivr` fields plus a `./global` subpath export. Minified IIFE is ~2.7 KB raw / ~1 KB gzip. Verified end-to-end via [`packages/runtime/examples/cdn.html`](./packages/runtime/examples/cdn.html), documented in [`docs/cdn.md`](./docs/cdn.md). Not yet published to npm — see prereq below.

  *Original entry:* Ship `@jslop/runtime` as an ESM + UMD bundle on jsdelivr/unpkg (`<script type="module" src="https://cdn.jsdelivr.net/npm/@jslop/runtime/dist/jslop-runtime.esm.js">`). Users write plain JS against `cell` / `derived` / `effect` / `batch` / `untrack` — no `.jslop` syntax, no view DSL. Closest analog: Solid's `createSignal` from a CDN. Small surface, forces the runtime to be genuinely standalone (good hygiene regardless). Stepping stone, not the real CDN story.
- ❌ **`@jslop/standalone` — in-browser compiler.** Bundle the compiler (parser + AST rewriter + codegen) for the browser, plus a bootstrapper that finds `<script type="jslop">` blocks (or fetches `.jslop` URLs), pipes them through `compile()`, and evaluates the result via `new Function(...)`. This is the genuinely "drop a script tag and go" story (cf. Vue's "full build", Svelte's REPL). Costs: bundle gets big (parser + codegen + runtime in one), no SSR, no resumability, slower TTI. Most of the work is bundling the compiler without Node-only deps (acorn is browser-safe; check magic-string and the file-reading paths) and writing the `<script type="jslop">` discovery / sandboxed eval shim.
- ❌ **Precompiled component CDN (via esm.sh-style transform).** A CLI or hosted endpoint that takes a `.jslop` file and emits a self-contained ESM module users can `<script type="module" src="...">` directly. Falls out almost for free once the runtime-only CDN exists (the compiler already targets ESM; this just needs a hosted wrapper or a `jslop compile <file>` command). No browser compiler weight, no build tool on the user's side. Useful for "share a single component" workflows.

Cross-cutting prerequisites:

- ❌ Published npm packages for `@jslop/{runtime,compiler}` (also a prerequisite for the scaffold — tracked in **Onboarding**).
- ❌ A "standalone" build target in `packages/runtime` and `packages/compiler` that produces browser-ready ESM + UMD with no Node built-ins. Today both are authored as Node ESM and consumed via workspace deps.
- ❌ A docs page (`docs/cdn.md`) with copy-pasteable HTML for each flavor, plus a CodePen/StackBlitz embed.
- ❌ A REPL page (probably part of the eventual `jslop.dev` site) that uses the in-browser compiler — doubles as the canonical try-it-in-30-seconds entry point and the smoke test for flavor 2.

---

## Suggested next priorities

If I had to pick a north star, in order:

1. ~~**Effect disposers + keyed list reconciliation**~~ — done. Scopes + keyed `{#each}` landed; per-item effect leak fixed.
2. ~~**Per-item child component instances inside `{#each}`**~~ — done at runtime. Lazy instantiation inside the build callback; keyed reorder reuses instances. State serialization for nested-in-each instances is the remaining gap, deferred until a real consumer needs it.
3. ~~**Two-way binding sugar** (`bind:value={cell}` / `bind:checked={cell}`)~~ — done. Counter example migrated.
4. ~~**Layouts + 404 routes**~~ — done. `_layout.jslop` chains compose outermost-first via `<children/>`; `_404.jslop` at routes root serves with status 404 and wears the same layout chrome. `examples/site` demonstrates both.
5. ~~**Production build path** (`vite build` → SSR bundle + Node adapter)~~ — done. Two-pass build (client + ssr), `@jslop/node-adapter` for serving, manifest-driven asset URL discovery. Static prerender and Bun/edge adapters still TODO.
6. **Interim server-action block** (`action { … }` inside `.jslop`, plus a server-only module convention). Surfaced by the `examples/tasks/` CRUD demo: today every mutation needs hand-written `/api/*` handlers in `serve.mjs` AND a parallel dev middleware in `vite.config.mjs` AND a client-side `src/api.js`. An action block + auto-refetch on success would delete all three. Scoped to be tractable; stepping stone to (7), not a replacement.
7. **`pnpm create jslop` scaffolding CLI** + published `@jslop/*` packages. Right now the only path to a working app is "clone the monorepo and edit an example." Every framework that's been adopted in the last decade has a 30-second quickstart; without one, the value of (5)/(6) is invisible to anyone who hasn't already decided to try JSlop. See the **Onboarding / startup experience** section for the full punch list.
8. **Server functions** — the PLAN.md "killer protocol." Big scope but the most distinctive feature. Needs split bundling, RPC transport, security defaults.
9. **Schema-native forms** — second killer feature from PLAN.md. Depends on server functions being landed first.
