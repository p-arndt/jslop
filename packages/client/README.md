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

## Known limitations

> [!CAUTION]
> - **Full-rebuild lists.** Any change to a `{#each}` source list re-creates all child DOM nodes, losing focus / scroll / animation state. Keyed reconciliation is on the roadmap.
> - **No per-item state.** Components nested inside `{#each}` don't currently get a stable instance per item; their state isn't preserved across rebuilds.
> - **One-way `value` binding.** `<input value={cell}>` writes cell→DOM only. Wire `oninput` manually until `bind:value=` lands.
> - **No SPA navigation.** Every `<a>` is a full page load.

See [`TODO.md`](../../TODO.md).
