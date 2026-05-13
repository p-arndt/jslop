# SSR & resumability

Rift renders pages on the server, then **resumes** on the client without re-running the whole component tree. There is no hydration in the React sense.

This page explains what "resumability" actually means here and how a page makes it across the network.

## The big idea

A classic hydration framework runs your component code **twice** — once on the server to produce HTML, once in the browser to "attach" event handlers and rebuild a virtual DOM. The browser pass scales with the size of your component tree.

Rift runs your component code **once on the server**, serializes just the state, and the browser picks up where the server left off. The browser pass scales with the number of *interactive bindings*, not the size of the tree.

## The flow

```
┌──────────────────── server ──────────────────────┐    ┌────── client ──────┐
│                                                  │    │                     │
│  request /                                       │    │                     │
│    │                                             │    │                     │
│    ▼                                             │    │                     │
│  matchRoute(url, routes)  ──►  component.create()│    │                     │
│                                  │               │    │                     │
│                                  ▼               │    │                     │
│                              renderView()        │    │                     │
│                                  │               │    │                     │
│                                  ▼               │    │                     │
│            HTML  +  <script>state capsule</script> ──►│  boot()             │
│                                                  │    │    │                │
│                                                  │    │    ▼                │
│                                                  │    │  restoreState()     │
│                                                  │    │    │                │
│                                                  │    │    ▼                │
│                                                  │    │  attach handlers    │
│                                                  │    │    │                │
│                                                  │    │    ▼                │
│                                                  │    │  effects wire DOM   │
│                                                  │    │     fine-grained    │
└──────────────────────────────────────────────────┘    └─────────────────────┘
```

## The state capsule

When the server renders a component, it walks its `state` cells and writes their values into a JSON blob embedded in the HTML. Non-reactive `let` bindings are *not* serialized — they're recomputed on the client:

```html
<script id="__rift_state" type="application/json">
  { "count": 0, "draft": "", "todos": ["learn rift", "build something"],
    "children": [ ... ] }
</script>
```

The client reads this on boot, calls `restoreState()` on the root component (which `cell.set(...)`s each value back), and then attaches event handlers to the existing DOM nodes by walking the view tree in the same order the server walked it.

> [!NOTE]
> Because state values come back through `cell.set`, and `set` is a no-op on `Object.is`-equal updates, restoring state on the client doesn't kick off any redundant renders.

## Why this isn't hydration

Classic React hydration:

1. Server renders HTML.
2. Client downloads the same component tree.
3. Client re-runs every component to build a virtual DOM.
4. Client diffs the virtual DOM against the real DOM and "attaches."

Rift:

1. Server renders HTML + serialized state.
2. Client reads the state, restores cells, attaches handlers, sets up reactive bindings.
3. **No re-render of the initial state happens.** The DOM the server produced is the DOM the client uses.

The result: the initial JS work scales with **the number of interactive bindings**, not with the size of the component tree.

## Security note (the boring wire protocol)

[`PLAN.md`](../PLAN.md) explicitly calls out the RSC RCE disclosed in late 2025 and commits Rift to a **boring** wire protocol: JSON only, no executable payloads, no arbitrary object revival.

The state capsule today is plain JSON with `JSON.parse` — no class revival, no function deserialization, no `eval`. Server functions (when they land) will follow the same constraint.

## Known limitations

> [!WARNING]
> - **Buffered SSR.** The server renders the whole page to a string before responding. Streaming SSR isn't implemented.
> - **No static prerender mode.** Static site generation (render every route at build time) is on the roadmap but not built. You can hack it with a script today.
> - **HMR.** `.rift` edits trigger a full page reload, not partial component reload.
> - **No client-side nav.** `<a>` links cause a full document load. SPA-mode navigation is on the roadmap.
> - **Each-nested component state.** State for components nested inside `{#each}` does not currently round-trip through SSR — they re-create from scratch on hydration. Top-level component state and props do round-trip.

See [`TODO.md`](../TODO.md) for the full list and [roadmap](./roadmap.md) for what's coming.

## See also

- [Reactivity](./reactivity.md) — `cell`, `derived`, `effect`, scopes.
- [Building & deploying](./building.md) — what the production SSR entry contains.
- [Internals: architecture](./internals/architecture.md) — full request flow.
