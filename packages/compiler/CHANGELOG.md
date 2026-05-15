# @jslop/compiler

## 0.1.1

### Patch Changes

- Fix parser treating apostrophes in JSX text (e.g. `You've`) as JS string openers, which consumed the rest of the file and produced spurious `unbalanced '{…}'` errors. JS `'`/`"` strings can't contain raw newlines, so the scanner now bails out of string mode at an unescaped newline. This unblocks the default scaffold from `create-jslop`.
