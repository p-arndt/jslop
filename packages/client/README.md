# @rift/client

Browser-side boot for Rift apps. Resumes the page from the server's state capsule — there is no hydration in the React sense.

```bash
pnpm add @rift/client
```

## API

```ts
import { boot } from "@rift/client";
import Home from "./routes/index.rift";
import Post from "./routes/posts/[slug].rift";

boot({
  Home,
  Post,
});
```

`boot(registry)` does:

1. Reads `<script id="__rift_state" type="application/json">` from the document.
2. Looks up the root component by name in `registry`.
3. Calls `component.create(props)` and then `instance.restoreState(capsule)` — `cell.set` for every serialized value.
4. Walks `instance.buildView()` and the existing DOM tree in lockstep:
   - Attaches event handlers (real function references, not name lookups).
   - Wraps each `kind: "bind"` node in an `effect()` so DOM updates fine-grained.
   - Recurses into child components and `{#each}` items.

After boot, user events trigger `cell.set` → subscribers re-run → DOM nodes update.

## Usually you don't call `boot` directly

`@rift/vite` generates a `virtual:rift-client` module that imports `boot` plus every route component and calls `boot()` with the right registry. Your `vite.config.mjs` only needs the Rift plugin.

## Reactive scopes

`boot` creates a top-level `Scope` (from `@rift/runtime`) per mounted root, and `mountIf` / `mountEach` open child scopes for each branch / list item. When a scope is disposed, every effect created inside it is torn down — so `{#if}` swaps and `{#each}` removals don't leak subscriptions.

## Lists

- `{#each list as item, i (item.id)}` — keyed. The reconciler reuses DOM nodes (and the per-item scope) across reorders, only inserting / moving / removing as needed.
- `{#each list as item}` — unkeyed, dispose-then-rebuild on every change. The previous items' scopes are still cleaned up; correct, but loses focus / scroll / animation state.

## Two-way binding

`<input bind:value={cell}>`, `<input type="checkbox" bind:checked={cell}>`, and `<select bind:value={cell}>` desugar to a property bind plus the appropriate event handler. The runtime sets the IDL property (`el.value` / `el.checked`) directly — `setAttribute('value', …)` doesn't update an input the user has already typed into.

## Known limitations

> [!CAUTION]
> - **Per-item child component state isn't serialized.** A component nested inside `{#each}` gets a fresh instance per key (and survives reorders for keyed lists), but its state isn't part of the parent's `__children`, so SSR-restored state doesn't round-trip on hydration.
> - **No SPA navigation.** Every `<a>` is a full page load.

See [`TODO.md`](../../TODO.md).
