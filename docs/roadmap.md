# Roadmap

This page summarizes where JSlop is going. For the design rationale, read [`PLAN.md`](https://github.com/p-arndt/jslop/blob/main/PLAN.md). For the current punch list with statuses, read [`TODO.md`](https://github.com/p-arndt/jslop/blob/main/TODO.md). This file just stitches the two together.

## Where we are

Working today (in `vite dev` **and** in production builds):

- `.jslop` parsing + AST-aware identifier rewriting
- `cell` / `derived` / `effect` / `batch` / `untrack`
- DSL keywords: `state`, `prop`, `derived`, `let`, `function`, `view`, `head`, `style`, `load`
- Reactive scopes: `createScope` / `runInScope` / `disposeScope` / `onCleanup`. `{#if}` swaps and `{#each}` removals dispose the prior subtree's effects, no leaks.
- View constructs: elements, components, `{expr}`, `on<event>` handlers, `bind:value` / `bind:checked`, `{#if}`/`{:else}`/`{/if}`, `{#each list as item, i (key)}`
- Per-component `head { ... }` fragments (SSR-merged, route wins over layout)
- Per-component `style { ... }` blocks — scoped via a hashed class on the component root
- Keyed `{#each}` reconciliation: DOM identity preserved per key across reorders / inserts / removes; per-item child component instances reused for matching keys.
- SSR with serialized state capsule
- Client boot that **resumes** rather than hydrates
- File-system routing with dynamic `[param]` segments, `_layout.jslop` chains, `_404.jslop`
- Per-route and per-layout `load { ... }` blocks (server-only, async, merged into props) and `notFound()` to trigger the 404 chain from inside a loader
- Client-side SPA navigation: `<a>` interception + `pushState`/`popstate`, programmatic `navigate()`, scoped-style merge across page swaps
- Vite plugin: transform + virtual modules + dev SSR middleware + dual-pass production build (`vite build` → `dist/client/`, `vite build --ssr` → `dist/server/entry-server.js`)
- `@jslop/node-adapter` for serving the production build (static assets + `render(url)`)
- Optional Tailwind v4

## North star priorities

In order, from [`TODO.md`](https://github.com/p-arndt/jslop/blob/main/TODO.md):

1. ~~**Effect disposers + keyed `<For>` reconciliation.**~~ ✅ Done.
2. ~~**Two-way binding sugar** (`bind:value={cell}`).~~ ✅ Done.
3. ~~**Layouts + 404 routes.**~~ ✅ Done.
4. ~~**Production build path.**~~ ✅ Done — two-pass build + `@jslop/node-adapter`. Static prerender and Bun/edge adapters still to come.
5. **Interim server-action block.** `action { … }` inside a `.jslop` route, callable from the client by name, auto-refetches `load` on success. Surfaced by `examples/tasks/`, where today every mutation goes through hand-written `/api/*` handlers in `serve.mjs` + a parallel dev middleware + a client-side `src/api.js`. Stepping stone to (6), not a replacement.
6. **Server functions.** The killer protocol from PLAN.md. Split bundling + JSON-only RPC + security defaults.
7. **Schema-native forms.** Built on top of server functions.

## Big features still on the design board

> [!NOTE]
> Everything in this section is **designed but not built**. It's what we're aiming for; treat it as a forecast, not a feature list.

- `server data = await db.x.find()` — async server values with auto-wired `loading` / `error` / `refresh()`.
- `server function name(...) { ... }` — typed RPC with CSRF, validation, auth context.
- `when`, `mount`, `cleanup` block syntax.
- `style Name { variants: ... }` — first-class variant declarations on top of the existing scoped `style { ... }` block.
- `schema Form { ... }` + `<Form schema={Form} action={save}>` with no-JS fallback.
- `local todos = collection<Todo>("todos")` + `sync todos with server.todos { ... }` — local-first data.
- `<Await value={x}><Pending/><Error/><Resolved/></Await>`.
- Devtools showing the reactive graph (where a value came from, what it updates, SSR vs client, size).

## Explicitly out of MVP scope

> [!IMPORTANT]
> The following are intentionally not in scope until the core is good:
>
> - Native mobile
> - Edge runtime
> - Plugin system
> - Animation system
> - Built-in ORM / auth / i18n / CMS

## How to contribute

There's no CI, contribution guide, or license yet — those are also on the todo list. If you want to poke at the codebase:

- Read [`docs/internals/architecture.md`](./internals/architecture.md) to learn what each package does.
- Pick something from [`TODO.md`](https://github.com/p-arndt/jslop/blob/main/TODO.md) — the early items are scoped to be tractable.
- Run `pnpm install && pnpm build && pnpm dev:counter` to confirm your environment works.
