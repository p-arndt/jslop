# create-jslop

Scaffold a new [JSlop](https://github.com/p-arndt/jslop) app.

```bash
npm create jslop@latest my-app
# or
pnpm create jslop my-app
# or
bun create jslop my-app
```

Then:

```bash
cd my-app
pnpm install
pnpm dev
```

## Flags

- `--template=<name>` — pick a template non-interactively. Currently shipped: `minimal`.
- `--yes` / `-y` — skip prompts. With a project name on the command line and a single template available, no prompts fire anyway.

## Templates

| Template  | What you get                                                                 |
|-----------|------------------------------------------------------------------------------|
| `minimal` | One route, `state`, two-way `bind:value`, `{#if}`, a Vite config and a Node `serve.mjs` for production. |

More templates (Tailwind, CRUD) will land alongside future JSlop releases.
