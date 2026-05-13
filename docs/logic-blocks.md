# Logic blocks

Logic blocks let your view branch and loop. Rift has two: `{#if}` and `{#each}`.

## `{#if}`

```tsx
{#if count > 0}
  <p>positive</p>
{/if}
```

Add an `{:else}` for the other branch:

```tsx
{#if loggedIn}
  <p>welcome back</p>
{:else}
  <a href="/login">log in</a>
{/if}
```

The condition is any expression. It's re-evaluated whenever its dependencies change.

> [!NOTE]
> `{:else if condition}` chains aren't a parse case yet — nest `{#if}` blocks inside `{:else}` for now.

### Scopes and cleanup

When a branch becomes inactive, Rift **disposes** everything inside it: child component instances, per-item effects, event listeners, the DOM itself. There's no zombie state lurking under a hidden subtree.

Re-entering a branch builds it fresh from scratch.

## `{#each}`

```tsx
{#each todos as item}
  <li>{item}</li>
{/each}
```

Add an index binding after a comma:

```tsx
{#each todos as item, i}
  <li>{i}: {item}</li>
{/each}
```

The item (and optional index) is scoped to the block body — it's just a regular local binding, not a reactive cell.

### Keyed `{#each}` (recommended)

Wrap a key expression in `(...)` after the bindings:

```tsx
{#each todos as t, i (t.id)}
  <li>{i}: {t.text}</li>
{/each}
```

With a key, Rift reconciles the list **by identity**, not by position:

- Matching keys keep their existing DOM, per-item effects, and any nested component state across reorders and inserts.
- New keys get a fresh build.
- Removed keys have their per-item scope disposed and their DOM removed.

**Always key any list that mutates by anything other than append-only.** Without a key, the list falls back to dispose-then-rebuild on every change — correct, but you lose focus, scroll position, input draft state, and animation state on every update.

```tsx
// ✓ keyed — focus and scroll survive
{#each items as it (it.id)}
  <li><input bind:value={it.label} /></li>
{/each}

// ✗ unkeyed — every change rebuilds every <li>
{#each items as it}
  <li><input value={it.label} /></li>
{/each}
```

### Nesting

You can nest `{#if}` and `{#each}` freely:

```tsx
<ul>
  {#each groups as g (g.id)}
    <li>
      <h3>{g.name}</h3>
      {#if g.items.length === 0}
        <p>empty.</p>
      {:else}
        <ul>
          {#each g.items as it (it.id)}
            <li>{it.label}</li>
          {/each}
        </ul>
      {/if}
    </li>
  {/each}
</ul>
```

### Components inside `{#each}`

Components nested in an each are instantiated **lazily per iteration** — each row owns its own instance. With a key, that instance survives reorders.

```tsx
{#each rows as row (row.id)}
  <RowView data={row} />
{/each}
```

> [!WARNING]
> SSR-restored state for components nested inside `{#each}` does not currently round-trip through the state capsule. They re-create from scratch on hydration. Top-level component state and props do round-trip — this gap is each-scoped. Track it on the [roadmap](./roadmap.md).

## Empty lists

There's no `{:empty}` clause yet. Pair an `{#each}` with an `{#if}`:

```tsx
{#if items.length === 0}
  <p>nothing here yet.</p>
{:else}
  <ul>
    {#each items as it (it.id)}
      <li>{it.label}</li>
    {/each}
  </ul>
{/if}
```

## What's not here

> [!NOTE]
> Logic blocks Rift does **not** yet implement (see [roadmap](./roadmap.md)):
>
> - `{:else if}` chains
> - `{#await promise}` / `{:then}` / `{:catch}`
> - `{#key expression}` for forcing a re-mount
> - `{#snippet}` / `{@render}` for reusable view fragments

## See also

- [Template syntax](./template-syntax.md) — what `{expr}` does outside logic blocks.
- [Reactivity](./reactivity.md) — how scopes are disposed when branches and rows go away.
