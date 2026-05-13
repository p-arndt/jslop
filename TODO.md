# Rift — TODO

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
- ❌ Compile-time validation: today an unbalanced `{/if}` or unknown tag throws a generic parser error with offset only; needs a friendlier diagnostic with source location
- ❌ `derived`, `when`, `mount`, `cleanup` block syntax from PLAN.md
- ❌ `style { ... }` / `style Name { variants: ... }` block from PLAN.md
- ❌ `schema Name { ... }` block (form schemas) from PLAN.md

## SSR (`@rift/server`)

- ✅ Renders elements, binds, components, conditionals, lists
- ✅ State capsule with nested children + root props
- ✅ Page template with `<link rel="stylesheet">` + extra head injection
- 🐛 Whitespace handling: text nodes that are pure whitespace still emit a space character. Mostly harmless but produces ugly HTML and forces the client to pair them correctly. Trim more aggressively or distinguish significant whitespace.
- ❌ Streaming SSR — currently buffers the whole HTML before responding.

## Client (`@rift/client`)

- ✅ Boot reads capsule, restores state, walks view tree
- ✅ Attaches event handlers from view nodes (as function values, not lookups)
- ✅ Recursive `buildNode` for fresh DOM mounts (used by `{#if}` rebuilds and `{#each}`)
- ✅ Keyed `{#each}` reconciliation: `{#each list as item, i (item.id)}` preserves DOM identity across reorder, dispose-on-remove, and insert-in-middle without rebuilding neighbors. Per-item effect scopes are disposed when an item is removed, so binds inside list items no longer leak. Unkeyed lists fall back to dispose-then-rebuild but now correctly tear down the previous items' effect scopes. Covered by 5 client integration tests.
- 🟡 Components nested inside `{#each}` now get a fresh instance per item (codegen emits `const __c_N = X.create(...)` inside the build callback instead of hoisting). For keyed lists, instances are reused across reorders since `build()` only runs for new keys. **Open gap:** child component state inside an each is *not* serialized into the parent's `__children`, so SSR-restored state for those instances doesn't round-trip — they re-create from scratch on hydration. Acceptable for stateless presentational components; problematic for stateful ones.
- ❌ Client-side navigation (SPA mode). Today every `<a>` is a full page load. Needs `<a>` interception + `history.pushState` + fetch new HTML + swap root.
- ✅ Two-way binding sugar: `<input bind:value={cell}>`, `<input type="checkbox" bind:checked={cell}>`, `<select bind:value={cell}>`. Compiler synthesizes both the property bind (driving the IDL property, not the attribute, so programmatic updates overwrite user-typed values correctly) and the matching event handler. Counter example migrated. Conflicts with explicit `value=`/`oninput=` on the same element are rejected at parse time. Covered by 7 compiler + 3 SSR + 2 client tests.
- ✅ `<children/>` placeholder + `renderRouteChain` for nesting layouts around routes. Each layout is a normal Rift component (own state, own cid, own capsule entry); the placeholder is replaced with the inner HTML at SSR, and the client skips over the placeholder position when attaching the layout (the inner component owns its own attach via its cid). Covered by compiler + server tests.

## Vite plugin (`@rift/vite`)

- ✅ `.rift` transform via `@rift/compiler`
- ✅ Virtual modules `virtual:rift-routes` and `virtual:rift-client`
- ✅ SSR middleware (registered pre-Vite-internals so route matching beats the html-fallback)
- ✅ `handleHotUpdate` invalidates routes manifest on `.rift` add/remove
- ✅ Optional Tailwind v4 wiring (`tailwind: true`), CSS injection (`css: "/src/app.css"`)
- ✅ Production build path. `vite build` emits `dist/client/` (hashed JS + CSS + `.vite/manifest.json`) and `vite build --ssr` emits `dist/server/entry-server.js` exporting `render(url, opts?) → { status, html, headers }`. The plugin's `config()` hook flips rollup input/output between the two via `env.isSsrBuild`; workspace `@rift/*` packages are bundled into the server entry (`ssr.noExternal`). The server entry auto-discovers the hashed client bundle and any emitted CSS by reading `dist/client/.vite/manifest.json` at runtime — opts.css source paths are not re-emitted in prod. Verified end-to-end on `examples/counter` and `examples/site` (routes, layouts, dynamic params, 404 page).
- 🟡 Node / Bun / edge runtime adapters. `@rift/node-adapter` exports `createHandler` / `createServer` that wraps the SSR `render` plus static-asset serving from `dist/client/` (long-cache headers for hashed `assets/`). No Bun/edge adapters yet, but the `RenderFn` shape is request-agnostic so they'd be drop-ins.
- ❌ `transformIndexHtml` integration is a single static call; for streaming responses we'd need to re-architect
- ❌ Static-HTML pre-render mode for fully static routes (today every request goes through `render(url)`).
- 🐛 HMR for `.rift` changes triggers a **full page reload**, not partial component reload. Vite's defaults do the right thing for module changes, but the visible behavior is "reload". Could be improved with explicit `import.meta.hot.accept` codegen.

## Router (`@rift/router`)

- ✅ Recursive scan of routes dir
- ✅ Pattern → regex matching with `[param]` placeholders
- ✅ Static segments rank higher than dynamic (specificity sort)
- ✅ Layouts via `_layout.rift` convention. A `_layout.rift` in any directory wraps every route at or below that directory; chains compose outermost-first. Layouts use `<children/>` as the placeholder (chosen over Svelte-style `<slot/>` so the same primitive can later cover generic component children — one mental model, not two). Per-route effect serialization for layout state is the same as any other component (each gets its own cid + capsule entry, boots independently).
- ✅ 404 pages via `_404.rift` at the routes root. Served with status 404; goes through the layout chain so the not-found page wears the same chrome as the rest of the site.
- ❌ Catch-all routes (`[...slug]`)
- ❌ Optional segments
- ❌ Per-route `meta {}` block (title, description) from PLAN.md
- ❌ Per-route error pages (`routes/_error.rift`)

## Forms (PLAN.md killer feature, mostly missing)

- ❌ `schema FormName { ... }` declaration
- ❌ `<Form schema={...} action={...}>` component
- ❌ `<Field name="x" />` with auto wiring
- ❌ Server validation + client validation
- ❌ No-JS submit fallback (POST → redirect → SSR) — would unlock the "progressive by default" pitch
- ❌ Optimistic updates, pending state
- ❌ CSRF, rate limiting

## Server functions (the PLAN.md "killer protocol")

- ❌ `server function rename(id, name) { ... }` syntax in `.rift`
- ❌ Compiler split: server bodies stripped from client bundle; replaced with typed RPC stubs
- ❌ Transport: explicit action IDs, JSON-only, no executable payload (per PLAN's "boring protocol" stance after RSC RCE)
- ❌ Built-in `requireUser()`, auth context plumbing
- ❌ `invalidate(server_value)` for reactive refetch

## Local-first / data primitives

- ❌ `server data = await db.x.find()` syntax + auto-wired loading/error/refresh
- ❌ `local todos = collection<Todo>("todos")` — IndexedDB-backed collections
- ❌ `sync todos with server.todos { conflict: "server-wins" }`
- ❌ `<Await value={...}><Pending/><Error/><Resolved/></Await>`

## Styling

- ✅ Plain `class="..."` works (Tailwind works because we don't touch class attrs)
- ❌ Scoped `<style>` blocks
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
  - 🟡 SSR snapshot tests (7 — keyed/unkeyed `<rift-each>` rendering, child component inside each, prop-bind boolean+escape)
  - 🟡 Client tests (8 keyed/unkeyed reconciliation, leak prevention, child-instance reuse across reorders, two-way property bind, against a hand-rolled stub DOM — replace with happy-dom)
  - ✅ Runtime scope tests (5)
  - ❌ Router unit tests
  - ❌ E2E via Playwright against `pnpm dev`
- ❌ Error boundaries
- 🟡 Bundle size budget / measurement — `benchmarks/bundle-size/` builds the counter fixture in both Rift and Svelte 5 via the same esbuild config and reports raw/gzip/brotli. No budget enforced in CI yet.
- 🟡 Performance benchmarks vs Solid / Svelte — `benchmarks/reactivity/` covers four reactivity-throughput scenarios vs Svelte 5 runes (set, fanout, wide reader, create+dispose). Solid not yet added; no large-list / DOM benchmark yet.
- ❌ Accessibility audit on emitted DOM
- ❌ CSP-friendly output (no inline scripts beyond the capsule)

## Repo hygiene

- ✅ Root README explaining what Rift is, how to try the examples, and how to build for production
- ✅ Per-package READMEs (compiler, runtime, server, client, router, vite, node-adapter)
- ❌ CHANGELOG
- ❌ License file
- ❌ CI (lint, typecheck, test, build the examples)
- ❌ `pnpm test` script at root that runs all package tests
- ❌ Pruning: the `examples/counter/smoke.mjs` hand-rolled DOM stub is fragile and now redundant with Vite; replace with happy-dom-backed tests

---

## Suggested next priorities

If I had to pick a north star, in order:

1. ~~**Effect disposers + keyed list reconciliation**~~ — done. Scopes + keyed `{#each}` landed; per-item effect leak fixed.
2. ~~**Per-item child component instances inside `{#each}`**~~ — done at runtime. Lazy instantiation inside the build callback; keyed reorder reuses instances. State serialization for nested-in-each instances is the remaining gap, deferred until a real consumer needs it.
3. ~~**Two-way binding sugar** (`bind:value={cell}` / `bind:checked={cell}`)~~ — done. Counter example migrated.
4. ~~**Layouts + 404 routes**~~ — done. `_layout.rift` chains compose outermost-first via `<children/>`; `_404.rift` at routes root serves with status 404 and wears the same layout chrome. `examples/site` demonstrates both.
5. ~~**Production build path** (`vite build` → SSR bundle + Node adapter)~~ — done. Two-pass build (client + ssr), `@rift/node-adapter` for serving, manifest-driven asset URL discovery. Static prerender and Bun/edge adapters still TODO.
6. **Server functions** — the PLAN.md "killer protocol." Big scope but the most distinctive feature. Needs split bundling, RPC transport, security defaults.
7. **Schema-native forms** — second killer feature from PLAN.md. Depends on server functions being landed first.
