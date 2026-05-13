# @jslop/runtime

The reactivity engine that the JSlop compiler targets. Tiny — about 150 lines.

```bash
pnpm add @jslop/runtime
```

## API

```ts
import {
  cell, derived, effect, batch, untrack, isReactive,
  type Cell, type Derived, type Reactive,
} from "@jslop/runtime";
```

### `cell<T>(initial: T): Cell<T>`

A writable reactive value.

```ts
const count = cell(0);
count.get();              // tracks if called inside an effect/derived
count.peek();             // never tracks
count.set(1);
count.update(n => n + 1);
```

`set` is a no-op when the new value is `Object.is`-equal to the previous one.

### `derived<T>(fn: () => T): Derived<T>`

A read-only value recomputed when its dependencies change.

```ts
const doubled = derived(() => count.get() * 2);
doubled.get();   // 0
count.set(5);
doubled.get();   // 10
```

### `effect(fn: () => void | (() => void)): () => void`

Runs `fn` immediately, then again when any cell it read changes. Returns a disposer. If `fn` returns a function, it's called as cleanup before the next re-run and on disposal.

```ts
const dispose = effect(() => {
  console.log(count.get());
  return () => console.log("cleanup");
});
dispose();
```

### `batch(fn: () => void): void`

Defers notifications until `fn` returns. Each subscriber runs at most once.

```ts
batch(() => {
  a.set(1);
  b.set(2);
});
```

### `untrack<T>(fn: () => T): T`

Reads cells inside `fn` without subscribing to them.

```ts
const c = derived(() => a.get() + untrack(() => b.get()));
// c reacts to a, not b
```

### `isReactive(v): v is Reactive<unknown>`

Type guard used by compiled components for prop forwarding.

## Design notes

- Push-based subscription model. Cells maintain a `Set<Subscriber>`.
- `effect` tracks its dependencies on each run and unsubscribes from cells it no longer reads.
- `batch` deduplicates by `Subscriber` identity, so a subscriber that reads N cells in the batch only runs once.

## How the compiler uses this

For every `state` and `prop` in a `.jslop` file, the compiler emits a `cell(...)`. Non-reactive `let` declarations are emitted as plain `let` bindings — they don't participate in the reactive graph. For every `{expr}` in the view and every event attachment, the runtime wraps it in an `effect(...)`. See [docs/reactivity.md](../../docs/reactivity.md).
