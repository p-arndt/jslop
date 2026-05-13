# Reactivity

The runtime lives in `@rift/runtime` and gives you five primitives:

- `cell(initial)` — a writable reactive value.
- `derived(fn)` — a read-only value computed from cells.
- `effect(fn)` — runs `fn` immediately, then again whenever any cell it read changes.
- `batch(fn)` — defer notifications until `fn` returns; each subscriber runs at most once.
- `untrack(fn)` — read cells without subscribing to them.

You rarely call these directly — the compiler emits `cell(...)` for every `let`/`prop` and `effect(...)` for every `{expr}` and event attachment. But they're there when you need them (e.g. computed values in a `function`, or a custom JS helper imported into a `.rift` file).

## `cell<T>(initial: T): Cell<T>`

```ts
import { cell } from "@rift/runtime";

const count = cell(0);

count.get();     // 0     — tracks if called inside an effect/derived
count.peek();    // 0     — never tracks
count.set(1);
count.update(n => n + 1);
```

`set` is a no-op when the new value is `Object.is`-equal to the old one, so trivial reassignments don't trigger updates.

> [!TIP]
> Use `peek()` inside event handlers when you want the current value but don't want to add a subscription. The compiler already does this for compound assignments like `count++`.

## `derived<T>(fn: () => T): Derived<T>`

```ts
import { cell, derived } from "@rift/runtime";

const count = cell(0);
const doubled = derived(() => count.get() * 2);

doubled.get();   // 0
count.set(5);
doubled.get();   // 10
```

`derived` is just `cell` + `effect` under the hood — the inner function re-runs whenever its dependencies change, and the result is cached in a cell.

## `effect(fn): () => void`

```ts
import { cell, effect } from "@rift/runtime";

const q = cell("");

const dispose = effect(() => {
  console.log("query is", q.get());
  return () => console.log("cleaning up previous run");
});

q.set("hello");   // logs cleanup, then "query is hello"
dispose();        // unsubscribes
```

`fn` may return a cleanup function. It runs before the next re-execution and on disposal.

## Scopes

Effects can be grouped into **scopes** so a chunk of work — typically one `{#if}` branch or one `{#each}` item — can be torn down as a unit.

```ts
import { createScope, runInScope, disposeScope, onCleanup, effect } from "@rift/runtime";

const scope = createScope();
runInScope(scope, () => {
  effect(() => { /* ... */ });
  onCleanup(() => clearInterval(handle));
});

disposeScope(scope);  // cleans up the effect AND runs the onCleanup
```

- `createScope(parent?)` — returns a new scope. Defaults to the current scope as parent so disposing the parent cascades to children.
- `runInScope(scope, fn)` — runs `fn` with `scope` as the current scope; `effect()` calls inside register their disposer with it.
- `disposeScope(scope)` — disposes child scopes recursively, then runs cleanups in LIFO order. Idempotent.
- `onCleanup(fn)` — registers a non-effect cleanup with the current scope (timers, abort controllers, third-party subscriptions).

`effect()` snapshots the current scope at creation and restores it on every re-run, so a `cell.set` triggered from a foreign scope still parents new child scopes correctly under the effect's owner.

`@rift/client` uses this internally: `boot` opens a root scope per mounted component, `mountIf` opens a fresh scope per branch swap, and `mountEach` opens one scope per list item (disposed on remove for keyed lists, on rebuild for unkeyed). Most app code doesn't need to call this API directly, but it's available for ad-hoc subtrees (e.g. a future `<Await>` or imperative DOM mounts).

## `batch(fn): void`

```ts
import { cell, batch, effect } from "@rift/runtime";

const a = cell(0);
const b = cell(0);

effect(() => console.log(a.get() + b.get()));

batch(() => {
  a.set(1);
  b.set(2);
});
// effect runs once with 3, not twice with 1 then 3
```

Use this when a single user action mutates several cells and you want exactly one render.

## `untrack(fn): T`

```ts
import { cell, derived, untrack } from "@rift/runtime";

const a = cell(1);
const b = cell(10);

const onlyTracksA = derived(() => a.get() + untrack(() => b.get()));
```

`onlyTracksA` updates when `a` changes but **not** when `b` changes.

## `isReactive(v)`

Type guard the compiler uses for prop forwarding:

```ts
import { cell, isReactive } from "@rift/runtime";

const c = cell(0);
isReactive(c);       // true
isReactive(42);      // false
```

If a parent passes a cell into `<Child x={someCell} />`, the child sees the same cell and writes flow back. If it passes a plain value, the child wraps it locally.

## How the compiler uses these

For a component like:

```tsx
component Counter {
  let count = 0

  function inc() {
    count++
  }

  view {
    <button onclick={inc}>{count}</button>
  }
}
```

The compiler emits (simplified):

```js
import { cell, isReactive } from "@rift/runtime";

export const __rift_component = {
  name: "Counter",
  create(props = {}) {
    const count = cell(0);
    function inc() {
      count.set(count.peek() + 1);
    }
    function buildView() {
      return {
        kind: "element",
        tag: "button",
        attrs: {},
        events: { click: inc },
        children: [
          { kind: "bind", get: () => String(count.get()) },
        ],
      };
    }
    return { actions: { inc }, buildView, serializeState, restoreState, children: [] };
  },
};
```

The client walks `buildView()` once to materialize DOM, wrapping each `kind: "bind"` in an `effect` so it updates fine-grained when its source cells change.

See [architecture.md](./architecture.md) for the full pipeline.
