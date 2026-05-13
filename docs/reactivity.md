# Reactivity

When you write `state count = 0` in a `.jslop` file, the compiler turns it into a **cell** — a reactive value provided by `@jslop/runtime`. Most of the time you don't need to think about this: assign, read, done.

This page is for when you do. It documents the primitives `@jslop/runtime` exposes — useful for custom helpers, JS files you import into your components, or when you want a derived value or an ad-hoc effect.

## The primitives

```ts
import { cell, derived, effect, batch, untrack } from "@jslop/runtime";
```

| Primitive       | What it is                                                            |
|-----------------|-----------------------------------------------------------------------|
| `cell(initial)` | A writable reactive value.                                            |
| `derived(fn)`   | A read-only value computed from cells, cached, auto-updated.          |
| `effect(fn)`    | A subscription that re-runs whenever any cell it read changes.        |
| `batch(fn)`     | Defers notifications until `fn` returns; each subscriber runs once.   |
| `untrack(fn)`   | Reads cells without subscribing to them.                              |

You rarely need to call these directly inside a component. The compiler emits `cell(...)` for every `state`/`prop` and `effect(...)` for every reactive `{expr}` in the view. Plain `let` declarations are *not* cells.

## `cell<T>(initial: T): Cell<T>`

```ts
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
const count = cell(0);
const doubled = derived(() => count.get() * 2);

doubled.get();   // 0
count.set(5);
doubled.get();   // 10
```

`derived` is just `cell` + `effect` under the hood — the inner function re-runs whenever its dependencies change, and the result is cached.

> [!NOTE]
> There's no `derived x = ...` keyword in the `.jslop` DSL yet. Use `derived(() => ...)` from `@jslop/runtime` directly inside a component body or in a JS helper. A DSL form is on the [roadmap](./roadmap.md).

## `effect(fn): () => void`

```ts
const q = cell("");

const dispose = effect(() => {
  console.log("query is", q.get());
  return () => console.log("cleaning up previous run");
});

q.set("hello");   // logs cleanup, then "query is hello"
dispose();        // unsubscribes
```

`fn` may return a cleanup function. It runs before the next re-execution and on disposal.

## `batch(fn): void`

```ts
const a = cell(0);
const b = cell(0);

effect(() => console.log(a.get() + b.get()));

batch(() => {
  a.set(1);
  b.set(2);
});
// effect runs once with 3, not twice with 1 then 3
```

Use this when one user action mutates several cells and you want exactly one render.

## `untrack(fn): T`

```ts
const a = cell(1);
const b = cell(10);

const onlyTracksA = derived(() => a.get() + untrack(() => b.get()));
```

`onlyTracksA` updates when `a` changes but **not** when `b` changes.

## `isReactive(v)`

Type guard the compiler uses for prop forwarding:

```ts
const c = cell(0);
isReactive(c);       // true
isReactive(42);      // false
```

If a parent passes a cell into `<Child x={someCell} />`, the child sees the same cell and writes flow back. If it passes a plain value, the child wraps it locally.

## Scopes

Effects can be grouped into **scopes** so a chunk of work — typically one `{#if}` branch or one `{#each}` item — can be torn down as a unit.

```ts
import { createScope, runInScope, disposeScope, onCleanup, effect } from "@jslop/runtime";

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

`@jslop/client` uses this internally: `boot` opens a root scope per mounted component, `{#if}` opens a fresh scope per branch swap, `{#each}` opens one scope per list item. Most app code doesn't need to call this API directly, but it's available for ad-hoc subtrees (e.g. an imperative DOM mount).

## How the compiler uses these

For a component like:

```tsx
component Counter {
  state count = 0

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
import { cell, isReactive } from "@jslop/runtime";

export const __jslop_component = {
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

See [Internals: architecture](./internals/architecture.md) for the full pipeline.
