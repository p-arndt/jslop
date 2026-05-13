# Template syntax

The `view { ... }` block holds the markup half of a component. The syntax looks like JSX, but a few details differ.

## Elements

A lowercase tag is a real DOM element:

```tsx
view {
  <main>
    <h1>Hello</h1>
    <p>Body text.</p>
    <br />
  </main>
}
```

Rules:

- Exactly **one root element** per `view`. Wrap multiples in a `<div>` or `<>` (fragments aren't currently a special form — use a wrapper).
- Self-closing is supported: `<br />`, `<img src="..." />`.
- Children can mix text, `{expr}` interpolations, and nested tags freely.

## Components

A tag whose name starts with an **uppercase** letter is a component reference. It must resolve to either an imported component or a sibling component declared in the same file:

```tsx
import { Stepper } from "../components/widgets.jslop"

component Counter {
  state n = 0
  function inc() { n++ }

  view {
    <div>
      <Stepper label="+" onstep={inc} />
      <Helper value={n} />
    </div>
  }
}

component Helper {
  prop value = 0
  view { <span>n is {value}</span> }
}
```

## Attributes

Attribute values come in two flavors:

```tsx
<a href="/about" class="nav-link">About</a>     <!-- string literal -->
<a href={url} class={cls}>{label}</a>            <!-- {expression} -->
```

- **String literals** are written verbatim into HTML.
- **`{expression}`** is a reactive bind: re-evaluated whenever its dependencies change, and only that one attribute updates.

**Boolean shorthand:**

```tsx
<input type="checkbox" checked />     <!-- checked = true -->
<button disabled>can't click me</button>
```

**Component props** are also written with `{expr}` or string literals:

```tsx
<Display value={count} label="Count" />
<Toggle checked />
```

## Text and interpolation

Text between tags is HTML-escaped on output. Wrap any expression in `{ }` to interpolate it:

```tsx
<h1>Hello, {user.name}!</h1>
<p>{count} item{count === 1 ? "" : "s"}</p>
<small>price: ${price.toFixed(2)}</small>
```

The expression is `String(...)`-coerced. It updates fine-grained — only that single text node changes when its dependencies do.

> [!TIP]
> No special syntax for HTML — interpolated values are always escaped. If you genuinely need raw HTML, render it into a real DOM element from a `function` and reach for `state` to swap nodes. There's no `{@html}` equivalent today; this is intentional given JSlop's security stance.

## Events

Any attribute on a lowercase element that starts with `on` followed by a lowercase letter is a DOM event handler:

```tsx
<button onclick={inc}>+</button>
<input oninput={e => draft = e.target.value} />
<form onsubmit={e => { e.preventDefault(); save() }}>
  ...
</form>
```

Inside the handler expression, reads and writes of `state`/`prop` identifiers are rewritten reactively, so inline mutations work:

```tsx
<button onclick={() => count++}>+</button>
```

See [Events](./events.md) for the full story (component callbacks, modifiers, gotchas).

## Bindings

`bind:value={cell}` is two-way sugar for the common "wire an input into a state cell" case:

```tsx
<input bind:value={draft} placeholder="add a todo..." />
<input type="checkbox" bind:checked={agreed} />
<select bind:value={pick}>
  <option value="a">A</option>
  <option value="b">B</option>
</select>
```

See [Bindings](./bindings.md) for the rules and edge cases.

## Logic blocks

Use `{#if}` and `{#each}` for conditional and list rendering:

```tsx
{#if count > 0}
  <p>positive</p>
{:else}
  <p>zero or negative</p>
{/if}

{#each todos as t, i (t.id)}
  <li>{i}: {t.text}</li>
{/each}
```

See [Logic blocks](./logic-blocks.md).

## The `<children/>` placeholder

Inside a layout component or any wrapper component, `<children/>` marks where the nested content should go:

```tsx
component Layout {
  view {
    <div class="app">
      <header>...</header>
      <children/>            <!-- the route content lands here -->
      <footer>...</footer>
    </div>
  }
}
```

In file-system routing, `<children/>` in a `_layout.jslop` is where the matched page component renders. Other frameworks call this `<slot/>` or `<Outlet/>`; JSlop uses the same primitive for layouts now and will use it for generic component children later.

## A complete view

```tsx
import { Card } from "./Card.jslop"

component Inbox {
  prop unreadOnly = false

  state messages = []
  state draft = ""

  function send() {
    if (!draft.trim()) return
    messages = [...messages, { id: crypto.randomUUID(), text: draft, read: false }]
    draft = ""
  }

  view {
    <main class="inbox">
      <h1>Inbox ({messages.length})</h1>

      <form onsubmit={e => { e.preventDefault(); send() }}>
        <input bind:value={draft} placeholder="write a message..." />
        <button type="submit">send</button>
      </form>

      {#if messages.length === 0}
        <p>no messages yet.</p>
      {:else}
        <ul>
          {#each messages as m (m.id)}
            {#if !unreadOnly || !m.read}
              <li><Card title={m.text} /></li>
            {/if}
          {/each}
        </ul>
      {/if}
    </main>
  }
}
```

## What you can't do (today)

> [!NOTE]
> The following are deliberately not supported yet:
>
> - **Fragments / multiple roots.** One root element per view.
> - **`{@html ...}`-style raw HTML interpolation.** Always escaped.
> - **`<svelte:head>` equivalent.** Per-route titles are configured on the Vite plugin (`title: url => "..."`); finer control is on the [roadmap](./roadmap.md).
> - **Spread props.** `<Foo {...attrs}/>` is parsed but not yet supported across all sites.
> - **`{#await}`/`{#snippet}`/`{#key}` blocks.** Only `{#if}` and `{#each}` are implemented today.

## See also

- [Events](./events.md) — `on*` handlers in depth.
- [Bindings](./bindings.md) — `bind:value`, `bind:checked`.
- [Logic blocks](./logic-blocks.md) — `{#if}`, `{#each}`.
- [Styling](./styling.md) — `class`, Tailwind, plain CSS.
