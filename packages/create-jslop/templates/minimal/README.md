# __PROJECT_NAME__

A [JSlop](https://github.com/p-arndt/jslop) app.

## Develop

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. Edit `src/routes/index.jslop` — the dev server reloads on save.

## Build for production

```bash
pnpm build       # emits dist/client and dist/server
pnpm serve       # runs the Node adapter against the built output
```

## Layout

- `src/routes/` — file-based routes. `index.jslop` → `/`, `about.jslop` → `/about`, `users/[id].jslop` → `/users/:id`.
- `src/routes/_layout.jslop` — wraps every route in this directory (optional). Use `<children/>` to mark where the inner route goes.
- `src/routes/_404.jslop` — custom not-found page (optional).
- `vite.config.mjs` — the Vite + `@jslop/vite` configuration.
- `serve.mjs` — production Node entrypoint.
