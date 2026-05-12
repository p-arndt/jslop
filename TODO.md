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

- ✅ Hand-rolled DSL parser (`component`, `let`, `function`, `prop`, `view`, `import`)
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
- ❌ Bind for `<input value={cell}>` is one-way (cell → DOM only). No `value` ↔ cell two-way binding sugar. Users have to wire `oninput` manually like the counter example does.

## Vite plugin (`@rift/vite`)

- ✅ `.rift` transform via `@rift/compiler`
- ✅ Virtual modules `virtual:rift-routes` and `virtual:rift-client`
- ✅ SSR middleware (registered pre-Vite-internals so route matching beats the html-fallback)
- ✅ `handleHotUpdate` invalidates routes manifest on `.rift` add/remove
- ✅ Optional Tailwind v4 wiring (`tailwind: true`), CSS injection (`css: "/src/app.css"`)
- ❌ Production build path. `vite build` will currently emit a client bundle but **there's no SSR build target** and no static-output mode. Need a build hook that emits a server bundle the Node adapter can run, plus a static-HTML pre-render mode for fully static routes.
- ❌ Node / Bun / edge runtime adapters
- ❌ `transformIndexHtml` integration is a single static call; for streaming responses we'd need to re-architect
- 🐛 HMR for `.rift` changes triggers a **full page reload**, not partial component reload. Vite's defaults do the right thing for module changes, but the visible behavior is "reload". Could be improved with explicit `import.meta.hot.accept` codegen.

## Router (`@rift/router`)

- ✅ Recursive scan of routes dir
- ✅ Pattern → regex matching with `[param]` placeholders
- ✅ Static segments rank higher than dynamic (specificity sort)
- ❌ Catch-all routes (`[...slug]`)
- ❌ Optional segments
- ❌ Route groups / layouts. PLAN.md's example structure has `dashboard/` with `index.rift` and `settings.rift` and an implied layout — no layout primitive exists yet (`<Outlet />` or similar).
- ❌ Per-route `meta {}` block (title, description) from PLAN.md
- ❌ 404 / error pages by convention (`routes/_404.rift`, `routes/_error.rift`)

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
  - 🟡 Parser unit tests (5 — `{#each}` key-syntax variants only; rest of grammar still uncovered)
  - 🟡 Codegen tests (4 — lazy component instantiation inside `{#each}`, hoisted-vs-inline parity)
  - 🟡 SSR snapshot tests (4 — keyed/unkeyed `<rift-each>` rendering, child component inside each)
  - 🟡 Client tests (6 keyed/unkeyed reconciliation, leak prevention, child-instance reuse across reorders, against a hand-rolled stub DOM — replace with happy-dom)
  - ✅ Runtime scope tests (5)
  - ❌ Router unit tests
  - ❌ E2E via Playwright against `pnpm dev`
- ❌ Error boundaries
- ❌ Bundle size budget / measurement
- ❌ Performance benchmarks vs Solid / Svelte
- ❌ Accessibility audit on emitted DOM
- ❌ CSP-friendly output (no inline scripts beyond the capsule)

## Repo hygiene

- ❌ Root README explaining what Rift is and how to try the examples
- ❌ Per-package READMEs
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
3. **Two-way binding sugar** (`bind:value={cell}` or similar) — removes the `oninput` boilerplate visible in the counter todos. Small but high-DX-impact.
4. **Layouts + 404 routes** — turns routing from "matches URLs" into something you'd actually ship.
5. **Production build path** (`vite build` → SSR bundle + Node adapter) — without this, Rift is dev-mode only.
6. **Server functions** — the PLAN.md "killer protocol." Big scope but the most distinctive feature. Needs split bundling, RPC transport, security defaults.
7. **Schema-native forms** — second killer feature from PLAN.md. Depends on server functions being landed first.
