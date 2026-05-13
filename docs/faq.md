# FAQ

## Is Rift production-ready?

No. Rift is pre-1.0. The compiler, runtime, SSR, client resume, router, layouts, 404 pages, Vite plugin, and production build path all work end-to-end for the example apps, but the surface is small and there is no semver guarantee yet. Track [`TODO.md`](../TODO.md) for the honest status.

## How does Rift compare to Svelte?

Closest sibling. If you know Svelte you'll feel at home — same kind of component file, similar `{#if}`/`{#each}` blocks, `bind:value` form sugar, file-system routing in SvelteKit-style. Differences:

- Rift compiles to **resumable** SSR (Qwik-style) rather than hydration. There's no second pass to re-run components in the browser.
- Reactive declarations are `state` / `let` / `prop`, not runes (`$state`, `$derived`).
- No `<script>`/`<style>`/`<template>` sections — declarations sit directly inside the `component { }` body.
- Multiple components per file by default. The first is the default export; the rest are named.

## How does Rift compare to React?

Bigger leap. Rift gives you:

- No `useState` / `useEffect` / dependency arrays — `state x = 0` is the whole API.
- No virtual DOM. Updates write to DOM nodes directly via the reactive graph.
- No `use client` / `use server` boundaries. There aren't any yet (server functions are on the roadmap, and they won't require special file markers).
- No re-running component functions to compute updates. The component body runs once per instance.

The tradeoff: Rift uses a **compiler-driven DSL**, not "just JavaScript." You write `.rift` files, not `.tsx`.

## How does Rift compare to Solid?

Same reactive primitives under the hood (`cell` ≈ `createSignal`, `derived` ≈ `createMemo`, `effect` ≈ `createEffect`), but Rift is a compiled DSL rather than a JS library. You write `count++`, not `setCount(c => c + 1)`.

Resumability is the other axis where Rift diverges from Solid — Solid uses SSR + hydration, Rift uses SSR + resume.

## How does Rift compare to Qwik?

Closest fit on the resumability axis. Rift adopts the same "no re-execution on the client" principle. Where it diverges:

- Component authoring is closer to Svelte than to React (Qwik's surface).
- No `useTask$` / `$` boundaries to think about. The compiler decides what's reactive based on whether you declared the variable with `state`.
- Smaller scope today — Qwik has shipped much more (Qwik City, Optimizer, etc.).

## Do I need to use TypeScript?

The compiler doesn't care. `.rift` files are parsed for the DSL keywords (`component`, `prop`, `state`, `view`, …) and everything else is raw JavaScript. TypeScript types inside function bodies and expressions work because the rewriter is type-aware (via `acorn`'s parser), but there's no `.d.ts` generation yet.

## Why does the view need exactly one root element?

It's a constraint the current renderer assumes; it makes resume / DOM matching cheaper. Wrap multiples in a `<div>` (or any wrapper element) for now. Fragments may land later; it's not a priority.

## Why is `state` reactive but `let` isn't?

The compiler needs to know **which identifiers participate in reactivity** so it can rewrite reads as `.get()` and writes as `.set(...)`. Doing that to every local would be expensive at runtime (every `let` becomes a cell) and surprising at authoring time (every `i` in a `for` loop becomes reactive). `state` is the opt-in signal; `let` is the escape hatch for "just give me a plain variable."

Rule of thumb: **if the view reads it, use `state`. Otherwise, use `let`.** See [Components](./components.md).

## How do I share state between components?

Two options:

1. **Lift it and pass it down as a `prop`.** The cell flows from parent to child; writes from the child propagate back to the parent automatically.
2. **Use a plain module-scoped cell** from `@rift/runtime`:

   ```ts
   // src/lib/auth.js
   import { cell } from "@rift/runtime";
   export const user = cell(null);
   ```

   ```tsx
   import { user } from "../lib/auth.js"
   component Header {
     view {
       {#if user.get()}<p>hi {user.get().name}</p>{/if}
     }
   }
   ```

   Module-scoped cells survive across components and routes within a single browser session. They are **not** part of the SSR capsule by default — restore on the client from a cookie / localStorage / endpoint as needed.

A real "context" API is on the [roadmap](./roadmap.md).

## How do I do async data fetching?

Today: roll it yourself with `state` + a `function` + an `effect`:

```tsx
import { effect } from "@rift/runtime"

component PostList {
  state posts = []
  state loading = true

  function load() {
    loading = true
    fetch("/api/posts").then(r => r.json()).then(p => {
      posts = p
      loading = false
    })
  }

  // ... call load() from an event or on mount
}
```

A clean `server data = await ...` block with auto-wired `loading` / `error` / `refresh()` is the headline feature of the next big release — see [PLAN.md](../PLAN.md) and [roadmap](./roadmap.md).

## How do I navigate client-side?

You don't, yet. Every `<a href="...">` does a full page load. Because Rift resumes rather than hydrates, full loads are cheaper than in a hydration-heavy framework — but a real SPA-mode `<a>` interceptor is on the [roadmap](./roadmap.md).

## Why does `user.name = "x"` not update the view?

Reactivity tracks **assignments to cells**, not deep property mutations. `user.name = "x"` doesn't write a new value to the `user` cell, so subscribers don't fire. Replace the whole object instead:

```tsx
user = { ...user, name: "x" }
```

Same rule for arrays — use `arr = [...arr, x]`, not `arr.push(x)`.

## Why are my keyed-each list items losing state?

Two common causes:

1. **No key.** `{#each todos as t}` falls back to dispose-then-rebuild on every list change. Add `(t.id)` to get keyed reconciliation.
2. **Component state inside `{#each}` doesn't round-trip through SSR yet.** Top-level component state does. This is a known gap — see the warning in [Logic blocks](./logic-blocks.md).

## Can I use it with Bun / Deno / Cloudflare Workers?

The build produces a host-agnostic `render(url) → { status, html, headers }`. Wrapping it for any host is a small task — see [Building & deploying](./building.md#custom-adapters). Only `@rift/node-adapter` is shipped today.

## How do I contribute?

There's no CI or contribution guide yet. Read [internals/architecture](./internals/architecture.md) for the big picture, pick something from [`TODO.md`](../TODO.md), and open a PR.

## Where do I report bugs?

GitHub issues on the repo. There's no triage process yet — early-stage project, light volunteer ops.
