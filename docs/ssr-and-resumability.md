# SSR & resumability

Rift renders on the server, then **resumes** on the client without re-running the whole component tree. There is no hydration in the React sense.

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

When the server renders a component, it walks its `state` cells (declarations like `state count = 0`) and writes their current values into a JSON blob embedded in the HTML. Non-reactive `let` bindings are *not* serialized — they're recomputed on the client:

```html
<script id="__rift_state" type="application/json">
  { "count": 0, "draft": "", "todos": ["learn rift", "build something"],
    "children": [ ... ] }
</script>
```

The client reads this on boot, calls `restoreState()` on the root component (which `cell.set(...)`s each value back), and then attaches event handlers to existing DOM nodes by walking the view tree in the same order the server walked it.

> [!NOTE]
> Because state values come back through `cell.set`, and `set` is a no-op on `Object.is`-equal updates, restoring state on the client doesn't kick off any redundant renders.

## Why this isn't hydration

Classic React hydration:

1. Server renders HTML.
2. Client downloads the same component tree.
3. Client re-runs every component to build a virtual DOM.
4. Client diffs the virtual DOM against the real DOM and "attaches".

Rift:

1. Server renders HTML + serialized state.
2. Client reads the state, restores cells, attaches handlers, sets up reactive bindings.
3. **No re-render of the initial state happens.** The DOM the server produced is the DOM the client uses.

The result: the initial JS work scales with **the number of interactive bindings**, not with the size of the component tree.

## Where this is implemented

| Step                       | Code                                          |
|----------------------------|-----------------------------------------------|
| Walk view tree → HTML      | `packages/server/src/index.ts` → `renderView` |
| Serialize state capsule    | `packages/server/src/index.ts` → `renderPage` |
| Read capsule on boot       | `packages/client/src/index.ts` → `boot`       |
| Restore cell values        | compiler-generated `restoreState`             |
| Attach event handlers      | `packages/client/src/index.ts` → `attach`     |
| Wire reactive bindings     | `effect()` per `kind: "bind"` node            |

## Known limitations

> [!CAUTION]
> - **Buffered SSR.** The server renders the whole page to a string before responding. Streaming SSR isn't implemented.
> - **Production build.** `vite build` produces a client bundle, but there is **no SSR build target** and no static-output mode. Today Rift runs only in `vite dev`. A Node adapter is on the roadmap.
> - **HMR.** `.rift` edits trigger a full page reload, not partial component reload.
> - **No client-side nav.** `<a>` links cause a full document load. SPA-mode navigation is on the roadmap.

See [TODO.md](../TODO.md) for the full list.

## Security note (re. RSC)

[`PLAN.md`](../PLAN.md) explicitly calls out the RSC RCE disclosed in late 2025 and commits Rift to a **boring** wire protocol: JSON only, no executable payloads, no arbitrary object revival. The state capsule today is plain JSON with `JSON.parse` — no class revival, no function deserialization, no `eval`. Server functions (when they land) will follow the same constraint.
