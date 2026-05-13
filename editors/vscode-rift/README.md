# Rift for VS Code

Syntax highlighting, language configuration, and snippets for `.rift` files
used by the Rift framework.

## Features

- Highlighting for Rift declarations: `component`, `route`, `schema`, `style`,
  `prop`, `state`, `let`, `const`, `derived`, `local`, `function`, `view`,
  `meta`, `mount`, `cleanup`, `when ... changes`, `sync ... with`.
- The reactive `state` keyword gets its own scope (`storage.type.reactive.rift`)
  so themes can color it distinctly from plain `let`/`const`.
- The `<children/>` placeholder gets its own scope
  (`keyword.other.children-placeholder.rift`) so it stands out from regular
  HTML elements in layouts and component bodies.
- Modifier keywords `server`, `client`, `browser` before bindings and
  functions.
- Embedded markup inside `view { ... }` blocks: HTML elements, capitalized
  component tags, `{expr}` interpolation, `on:event={...}` event directives
  and `bind:prop={...}` two-way bindings.
- Built-in template helpers: `<For>`, `<Await>`, `<Pending>`, `<Resolved>`,
  `<Error>`, `<Form>`, `<Field>`, `<Submit>`, `<Show>`, `<Match>`,
  `<Switch>`, `<Slot>`, `<Portal>`, `<Suspense>`, `<Page>`, `<Layout>`.
- Auto-closing pairs, comment toggling, bracket folding.
- Snippets: `component`, `componentprop`, `route`, `schema`, `fn`,
  `serverfn`, `view`, `mount`, `when`, `for`, `await`, `form`.

## Install (development)

From the repo root:

```bash
# package the extension
cd editors/vscode-rift
pnpm dlx @vscode/vsce package --no-dependencies
# install the produced .vsix
code --install-extension vscode-rift-0.1.0.vsix
```

Or, for live development, symlink/copy this folder into your VS Code
extensions directory and reload:

- Windows: `%USERPROFILE%\.vscode\extensions\rift.vscode-rift-0.1.0`
- macOS / Linux: `~/.vscode/extensions/rift.vscode-rift-0.1.0`

## File layout

```
editors/vscode-rift/
  package.json                  extension manifest
  language-configuration.json   brackets, comments, autoclose
  syntaxes/rift.tmLanguage.json TextMate grammar
  snippets/rift.code-snippets   common Rift scaffolds
  icons/rift-file.svg           file icon
```
