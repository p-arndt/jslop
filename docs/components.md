# Components

Every `.jslop` file declares one or more **components**. A component bundles state, behavior, and markup into a unit you can render and reuse.

## Declaring a component

```tsx
component Hello {
  view {
    <h1>Hello, world</h1>
  }
}
```

A component block has:

- A **name** in PascalCase (`Hello`, `UserCard`, `PostList`).
- An optional body of declarations: `prop`, `state`, `let`, `function`, in any order.
- Exactly one `view { ... }` block, with exactly one root element.

You can declare **as many components as you like in a single file**. The first one is the default export, and every component becomes a named export.

```tsx
// widgets.jslop
component Button {
  prop label = "?"
  prop onclick = () => {}
  view { <button onclick={onclick}>{label}</button> }
}

component Card {
  prop title = ""
  view { <section><h2>{title}</h2></section> }
}
```

Consumers can pick either form:

```tsx
import Button from "./widgets.jslop"                // default = first block
import { Button, Card } from "./widgets.jslop"      // named
import Default, { Card } from "./widgets.jslop"     // both
```

Sibling components in the same file can reference each other directly — `<Card/>` inside `Button`'s view just works.

## The four declarations

| Keyword       | Reactive | Survives SSR | Use it for                                                              |
|---------------|----------|--------------|-------------------------------------------------------------------------|
| `prop x`      | yes      | parent decides | input from a parent component                                         |
| `state x`     | yes      | yes            | anything the view reads — counters, drafts, lists, toggles            |
| `let x`       | no       | no             | per-instance bookkeeping the view never reads (caches, IDs, timers)   |
| `function f`  | —        | —              | event handlers, actions, derived helpers                              |

The next four sections cover each.

## `prop` — input from a parent

```tsx
component Display {
  prop value = 0
  prop label = "Count"

  view {
    <p><strong>{label}:</strong> {value}</p>
  }
}
```

```tsx
<Display value={count} label="Hits" />
<Display value={5} />              // label falls back to "Count"
<Display />                        // value falls back to 0
```

A `prop` is a reactive input — when the parent changes the value it passed, the child re-renders the parts that depend on it.

The default expression after `=` is used when the parent omits the prop or passes `undefined`. If you omit the default entirely, the value is `undefined`:

```tsx
prop label = "?"             // string default
prop onclick = () => {}      // callback default
prop count                   // no default → undefined
```

> [!TIP]
> If the parent passes a reactive cell as a prop, writes to it from inside the child flow back to the parent. Most of the time you don't need to think about this — it just works.

## `state` — reactive variable

```tsx
state count = 0
state todos = []
state user = { name: "Ada" }
```

Mutations look like ordinary JavaScript:

```tsx
count++
count = count + 1
todos = [...todos, "buy milk"]
user.name = "Lovelace"      // ← see callout below
```

Anywhere in the component that reads `count` — a `view` interpolation, a `function`, an event handler — subscribes to it. When `count` changes, only those locations re-run.

`state` values are **serialized** when the server renders the page and **restored** on the client. That's how a counter at `5` on the server lands at `5` in the browser without re-running the whole tree.

> [!WARNING]
> Reactivity tracks **assignments**, not deep property changes. `user.name = "x"` updates `user.name`, but the cell `user` itself didn't get a new value — so subscribers to `user` won't re-run. If a view reads `user.name`, replace the whole object: `user = { ...user, name: "x" }`. Same rule for arrays: use `arr = [...arr, x]`, not `arr.push(x)`.

## `let` — plain mutable variable

```tsx
let lastId = 0
let cache = new Map()
let abortCtrl = null
```

A `let` is **not** reactive. It's a plain JavaScript `let` binding scoped to the component instance. The view never knows when it changes. It is not serialized in the SSR capsule.

Use it for bookkeeping the view doesn't read:

```tsx
component Search {
  prop query = ""
  state results = []         // view renders this → reactive
  let pendingId = 0          // sequence number for race-cancellation → plain JS

  async function run() {
    const id = ++pendingId
    const r = await fetch("/search?q=" + query).then(r => r.json())
    if (id === pendingId) results = r     // ignore stale responses
  }

  view {
    <ul>{#each results as r (r.id)}<li>{r.label}</li>{/each}</ul>
  }
}
```

> [!WARNING]
> If you reference a `let` from a view expression (e.g. `<p>{cache.size}</p>`), it's read **once at mount** and never again. Reach for `state` whenever the view needs to see the value.

You can also use `let` as a per-instance constant when you don't want a cell:

```tsx
let id = crypto.randomUUID()
```

## `function` — handlers and actions

```tsx
function increment() {
  count++
}

function addTodo() {
  if (draft.trim().length > 0) {
    todos = [...todos, draft.trim()]
    draft = ""
  }
}
```

Inside a function body, identifiers that match a `state` or `prop` name are rewritten to read and write through their reactive cell. Local variables, parameters, and `let` references are left alone.

You don't have to wrap functions in `useCallback` — they're plain functions and JSlop doesn't re-run the component body. The function reference is stable for the lifetime of the component instance.

> [!IMPORTANT]
> Use `function`, not `fn`. `fn` appears in design notes but the implemented keyword is `function`.

## `view` — the markup

Every component must have exactly one `view` block with exactly one root element:

```tsx
view {
  <div>
    <h1>Title</h1>
    <p>Body</p>
  </div>
}
```

What goes inside is covered in detail in [Template syntax](./template-syntax.md), [Logic blocks](./logic-blocks.md), [Events](./events.md), and [Bindings](./bindings.md).

## Putting it together

```tsx
import { Stepper } from "../components/widgets.jslop"

component TodoList {
  prop initial = []

  state items = initial
  state draft = ""
  let nextId = 1

  function add() {
    const text = draft.trim()
    if (!text) return
    items = [...items, { id: nextId++, text, done: false }]
    draft = ""
  }

  function toggle(id) {
    items = items.map(t => t.id === id ? { ...t, done: !t.done } : t)
  }

  view {
    <section>
      <h2>Todos</h2>

      <input bind:value={draft} placeholder="what next?" />
      <Stepper label="add" onstep={add} />

      <ul>
        {#each items as t (t.id)}
          <li>
            <input type="checkbox" bind:checked={t.done} />
            <span>{t.text}</span>
          </li>
        {/each}
      </ul>

      {#if items.length === 0}
        <p>nothing here yet.</p>
      {/if}
    </section>
  }
}
```

This is the whole authoring surface today. The next pages cover the markup half — what you can put inside `view { ... }`.

## See also

- [Template syntax](./template-syntax.md) — tags, attributes, interpolation.
- [Logic blocks](./logic-blocks.md) — `{#if}`, `{#each}`.
- [Events](./events.md) — `onclick`, inline mutations, component callbacks.
- [Bindings](./bindings.md) — `bind:value`, `bind:checked`.
- [Reactivity](./reactivity.md) — the primitives behind `state` and `prop`.
