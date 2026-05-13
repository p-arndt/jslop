# Bindings

`bind:value={cell}` is two-way sugar that wires a form control into a reactive `state` cell. It combines:

- a **property bind** — when the cell changes, write the new value to the input's DOM property
- an **event listener** — when the user types, write the input's current value back into the cell

You could write both halves yourself, but `bind:` is shorter and ensures the two stay in sync.

## `bind:value`

For `<input>`, `<textarea>`, and `<select>`:

```tsx
component LoginForm {
  state email = ""
  state password = ""

  view {
    <form>
      <input bind:value={email} type="email" placeholder="email" />
      <input bind:value={password} type="password" placeholder="password" />
    </form>
  }
}
```

Without `bind:`, the equivalent is:

```tsx
<input value={email} oninput={e => email = e.target.value} />
```

Same behavior, more keystrokes.

### `<select>`

```tsx
component Picker {
  state pick = "a"

  view {
    <select bind:value={pick}>
      <option value="a">A</option>
      <option value="b">B</option>
      <option value="c">C</option>
    </select>
    <p>you picked {pick}</p>
  }
}
```

`bind:value` on `<select>` listens to `change` and reads `e.target.value`.

### `<textarea>`

```tsx
<textarea bind:value={notes} rows="6" />
```

Listens to `input`. Same as the `<input>` case.

## `bind:checked`

For checkboxes and radio buttons:

```tsx
component Settings {
  state notifications = true
  state darkMode = false

  view {
    <label>
      <input type="checkbox" bind:checked={notifications} />
      notifications
    </label>
    <label>
      <input type="checkbox" bind:checked={darkMode} />
      dark mode
    </label>
  }
}
```

`bind:checked` listens to `change` and reads `e.target.checked` (a boolean — no string coercion).

## Rules

A handful of rules the compiler enforces:

1. **The bound expression must be a writable reactive lvalue.** Typically a `state` identifier or a reactive `prop`:

   ```tsx
   state draft = ""
   <input bind:value={draft} />      ✓

   let raw = ""
   <input bind:value={raw} />        ✗ — let is not reactive
   ```

2. **You can't combine `bind:value` with an explicit `value=` or `oninput=` on the same element.** It's a parse error. Pick one.

3. **`bind:value` chooses the right event for the element:** `input` for `<input>`/`<textarea>`, `change` for `<select>`.

## Property, not attribute

Internally `bind:` emits a **property bind**, not an attribute bind. The runtime sets `el.value = ...` or `el.checked = ...` directly on the DOM node.

This matters because `setAttribute("value", "...")` only changes the *initial* value of an input — it does **not** overwrite what the user has typed. Property assignment does. So when you do `draft = "preset"` programmatically, the user's already-typed text gets replaced as expected.

## Other bindings?

Today, only `bind:value` and `bind:checked` are implemented. Bindings for `group`, `files`, `bind:this`, dimension bindings (`clientWidth`, etc.), media bindings — none of those are wired up yet. If you need them, attach the listener manually with an `oninput` / `onchange` handler and read the property off `e.target`.

## See also

- [Components](./components.md) — declaring `state` cells.
- [Events](./events.md) — what `bind:` desugars to.
