# JSlop for VS Code

Syntax highlighting, language configuration, and snippets for `.jslop` files
used by the JSlop framework.

## Features

- Highlighting for JSlop declarations: `component`, `route`, `schema`, `style`,
  `prop`, `state`, `let`, `const`, `derived`, `local`, `function`, `view`,
  `head`, `load`, `meta`, `mount`, `cleanup`, `when ... changes`,
  `sync ... with`.
- Anonymous `style { ... }` block treated as embedded CSS, so VS Code's CSS
  grammar (and themes) highlight selectors / properties / values inside.
  Named `style Name { variants: ... }` blocks still get the variant-specific
  property highlighting.
- `head { ... }` block highlights its contents as view markup — tags,
  `{expr}` interpolations, and attribute directives all work the same as
  inside `view { ... }`.
- `load { ... }` block highlights its body as a JS expression context;
  `notFound()` and `navigate()` are recognized as built-in functions.
- The reactive `state` keyword gets its own scope (`storage.type.reactive.jslop`)
  so themes can color it distinctly from plain `let`/`const`.
- The `<children/>` placeholder gets its own scope
  (`keyword.other.children-placeholder.jslop`) so it stands out from regular
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
- Snippets: `component`, `componentprop`, `route`, `schema`, `function`,
  `serverfunction`, `state`, `let`, `prop`, `derived`, `view`, `head`,
  `style`, `load`, `notfound`, `mount`, `when`, `for`, `await`, `form`.

## Install (development)

From the repo root:

```bash
# package the extension
cd editors/vscode-jslop
pnpm dlx @vscode/vsce package --no-dependencies
# install the produced .vsix
code --install-extension vscode-jslop-0.1.0.vsix
```

Or, for live development, symlink/copy this folder into your VS Code
extensions directory and reload:

- Windows: `%USERPROFILE%\.vscode\extensions\jslop.vscode-jslop-0.1.0`
- macOS / Linux: `~/.vscode/extensions/jslop.vscode-jslop-0.1.0`

## File layout

```
editors/vscode-jslop/
  package.json                  extension manifest
  language-configuration.json   brackets, comments, autoclose
  syntaxes/jslop.tmLanguage.json TextMate grammar
  snippets/jslop.code-snippets   common JSlop scaffolds
  icons/jslop-file.svg           file icon
```
