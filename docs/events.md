# Events

DOM event handlers in JSlop are just attributes that start with `on` followed by a lowercase letter.

## The basics

```tsx
component Counter {
  state n = 0
  function inc() { n++ }

  view {
    <button onclick={inc}>+</button>
  }
}
```

The handler can be a function reference, an arrow function, or any expression that produces a function:

```tsx
<button onclick={inc}>+</button>
<button onclick={() => n++}>+</button>
<button onclick={() => { n++; logged = true }}>+</button>
```

## Inline mutations

Inside an event handler expression, reads and writes of `state` / `prop` identifiers are rewritten reactively. You can update state inline:

```tsx
<button onclick={() => count++}>+</button>
<button onclick={() => count = 0}>reset</button>
<input oninput={e => draft = e.target.value} />
```

For most "wire an input back into a cell" cases you don't need an event handler at all — use [`bind:value`](./bindings.md) instead.

## The event object

DOM event handlers receive a regular `Event` (or subclass — `MouseEvent`, `InputEvent`, etc.):

```tsx
<form onsubmit={e => {
  e.preventDefault()
  save()
}}>
  ...
</form>

<input onkeydown={e => {
  if (e.key === "Enter") submit()
}} />
```

There are no synthetic events — JSlop attaches real DOM listeners.

## Common events

Anything the browser fires:

```tsx
<button onclick={...}>
<button ondblclick={...}>
<input oninput={...}>
<input onchange={...}>
<input onfocus={...}>
<input onblur={...}>
<input onkeydown={...} onkeyup={...} onkeypress={...}>
<form onsubmit={...}>
<select onchange={...}>
<a onpointerenter={...} onpointerleave={...}>
<div onmouseover={...} onmouseout={...} onscroll={...}>
```

The attribute name is the standard `on<event>` form, lowercase.

## Component callbacks

When you put `on*` on a **component** tag, it's just a regular prop — JSlop does not auto-bind component callbacks to DOM events. The component decides what to call it:

```tsx
// Stepper.jslop
component Stepper {
  prop label = "?"
  prop onstep = () => {}

  view {
    <button onclick={onstep}>{label}</button>
  }
}
```

```tsx
// parent
<Stepper label="+" onstep={inc} />
```

Naming is convention. Call it `onstep`, `onclick`, `onclose`, `onaction` — whatever reads clearest at the call site. The child receives whatever the parent passed and invokes it manually.

## Capture phase, once, passive

> [!NOTE]
> Modifier suffixes like `onclick|capture`, `onclick|once`, `onclick|passive` are **not implemented** today. If you need them, attach the listener yourself with `effect` + `onCleanup` from `@jslop/runtime`, or wrap the call:
>
> ```tsx
> let didFire = false
> function once(e) {
>   if (didFire) return
>   didFire = true
>   ...
> }
> ```

## Preventing default / stopping propagation

Call the standard methods on the event:

```tsx
<form onsubmit={e => {
  e.preventDefault()
  save()
}}>
  ...
</form>

<a href="/x" onclick={e => {
  e.preventDefault()
  navigate("/x")
}}>x</a>
```

## Handlers in `{#each}`

The item binding is in scope inside the handler:

```tsx
{#each todos as t (t.id)}
  <li>
    <button onclick={() => remove(t.id)}>×</button>
    {t.text}
  </li>
{/each}
```

`t` is a normal local variable inside the each-body, so reads of it aren't rewritten — JSlop just reads the value at the point the handler fires.

## See also

- [Bindings](./bindings.md) — when to use `bind:value` instead of an inline event handler.
- [Components](./components.md) — `prop onstep = () => {}` pattern for component callbacks.
