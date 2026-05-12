# Roadmap

This page summarizes where Rift is going. For the design rationale, read [`PLAN.md`](../PLAN.md). For the current punch list with statuses, read [`TODO.md`](../TODO.md). This file just stitches the two together.

## Where we are

Working today (in `vite dev`):

- `.rift` parsing + AST-aware identifier rewriting
- `cell` / `derived` / `effect` / `batch` / `untrack`
- View constructs: elements, components, `{expr}`, `on<event>` handlers, `{#if}`/`{:else}`/`{/if}`, `{#each list as item, i}`
- SSR with serialized state capsule
- Client boot that **resumes** rather than hydrates
- File-system routing with dynamic `[param]` segments
- Vite plugin: transform + virtual modules + SSR middleware
- Optional Tailwind v4

## North star priorities

In order, from [`TODO.md`](../TODO.md):

1. **Effect disposers + keyed `<For>` reconciliation.** Foundational correctness/memory fixes.
2. **Two-way binding sugar** (`bind:value={cell}`).
3. **Layouts + 404 routes.** Make routing shippable.
4. **Production build path.** `vite build` → SSR bundle + Node adapter. Without this, Rift is dev-mode only.
5. **Server functions.** The killer protocol from PLAN.md. Split bundling + JSON-only RPC + security defaults.
6. **Schema-native forms.** Built on top of server functions.

## Big features still on the design board

> [!NOTE]
> Everything in this section is **designed but not built**. It's what we're aiming for; treat it as a forecast, not a feature list.

- `server data = await db.x.find()` — async server values with auto-wired `loading` / `error` / `refresh()`.
- `server function name(...) { ... }` — typed RPC with CSRF, validation, auth context.
- `derived`, `when`, `mount`, `cleanup` block syntax.
- `style Name { variants: ... }` — first-class variant declarations.
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

- Read [`docs/architecture.md`](./architecture.md) to learn what each package does.
- Pick something from [`TODO.md`](../TODO.md) — the early items are scoped to be tractable.
- Run `pnpm install && pnpm build && pnpm dev:counter` to confirm your environment works.
