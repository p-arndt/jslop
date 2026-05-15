# Publishing JSlop to npm

This is the operator's runbook for cutting a release. Everything below assumes you're on `main`, the tree is clean, and `pnpm install` is up to date.

## One-time setup

Done already, but kept here for reference / future maintainers:

- The `@jslop` scope is reserved on npm (the owning account must run `npm login` and be a member of the scope).
- Every publishable package has `publishConfig: { "access": "public" }` so the first publish doesn't 402 on a scoped package.
- Cross-package deps use `workspace:^`, which `pnpm publish` rewrites to the actual version range at publish time.
- Changesets is configured in `.changeset/config.json` with a single `fixed` group containing every framework package + `create-jslop`. They version together.
- `@jslop/prettier-plugin` is `"private": true` and is skipped by recursive publish.
- Examples and benchmarks are listed in the Changesets `ignore` array so they never get version-bumped or published.

## The packages that ship

| Package              | What it is                                                      |
|----------------------|-----------------------------------------------------------------|
| `@jslop/runtime`     | Reactive primitives (cell / derived / effect / scopes) + CDN bundles |
| `@jslop/compiler`    | `.jslop` → JavaScript compiler                                  |
| `@jslop/client`      | Browser hydration + DOM reconciliation                          |
| `@jslop/server`      | SSR renderer                                                    |
| `@jslop/router`      | File-based router with layouts and loaders                      |
| `@jslop/vite`        | Vite plugin (dev SSR + virtual modules + prod build)            |
| `@jslop/node-adapter`| Node HTTP adapter for the prod SSR bundle                       |
| `create-jslop`       | Scaffolding CLI — powers `npm create jslop@latest`              |

`create-jslop` is intentionally **unscoped**: the `npm create <foo>` / `pnpm create <foo>` / `bun create <foo>` conventions all resolve to a package literally named `create-<foo>`.

## First publish (initial 0.1.0)

The very first release skips Changesets — there's nothing to bump from, and we want all eight packages to land at `0.1.0` in one shot.

```bash
# 1. Make sure you're logged in as a member of the @jslop scope
npm whoami
npm login   # if not

# 2. Clean install + build everything
pnpm install --frozen-lockfile
pnpm build

# 3. Smoke-test the tarballs without uploading
pnpm -r --filter "./packages/*" exec npm pack --dry-run

# 4. Publish all non-private workspace packages
#    --access public is belt-and-braces (publishConfig already sets it)
pnpm publish -r --access public
```

`pnpm publish -r` walks the workspace, skips anything marked `"private": true`, rewrites `workspace:^` → real version ranges in the published tarballs, and publishes in dependency order.

Verify on npm:

```bash
npm view @jslop/runtime
npm view create-jslop
```

## Subsequent releases (via Changesets)

For every change worth publishing:

```bash
# 1. Record what changed and how (patch / minor / major)
#    Since all framework packages are in a `fixed` group, you only need to
#    pick a bump level once — the rest follow.
pnpm changeset

# 2. (later, when ready to cut a release) Apply the bumps + rewrite CHANGELOGs
pnpm version-packages
git add .
git commit -m "Version Packages"

# 3. Build + publish
pnpm release   # = pnpm build && changeset publish

# 4. Push tags
git push --follow-tags
```

`changeset publish` only publishes packages whose versions changed since the last publish, so re-running it is a no-op when there's nothing new.

## Trying the scaffold after a publish

```bash
cd /tmp
pnpm create jslop test-app
cd test-app
pnpm install
pnpm dev   # http://localhost:5173
```

If the scaffold's `package.json` shows `"@jslop/runtime": "^X.Y.Z"` matching what you just published, the release is good.

## Troubleshooting

**"402 Payment Required" on first publish.** A scoped package defaulted to private. Make sure `publishConfig: { "access": "public" }` is in the offending `package.json`, or pass `--access public` to the publish command.

**"You do not have permission to publish."** You aren't a member of the `@jslop` scope, or 2FA on the account requires an OTP that automation isn't supplying. For interactive publishes, npm prompts for the OTP. For CI, use an automation token (`npm token create --read-only=false`) that bypasses interactive 2FA.

**`workspace:^` showed up in the published tarball.** This means `pnpm publish` wasn't used — `npm publish` doesn't rewrite workspace protocol strings. Always publish via `pnpm publish` (or `pnpm release` / `changeset publish` which call it internally).

**Scaffold installs but `@jslop/*` 404s.** The `create-jslop` version pinned `__JSLOP_VERSION__` to a `@jslop/*` version that doesn't exist yet on npm. Either bump `create-jslop` separately to track a real published framework version, or publish the framework packages first. The fixed-version group is designed to keep these in lockstep so this shouldn't happen in normal flow.

**Pre-publish dry run.** To inspect what would ship without uploading anything:

```bash
pnpm -r --filter "./packages/*" exec npm pack --dry-run
```

That lists every file in every tarball with sizes — useful for catching accidental inclusions (test fixtures, node_modules, secrets).

## CI publish (future)

Recommended once the manual flow is verified: a GitHub Actions workflow that runs on push to `main`, opens a "Version Packages" PR via `changesets/action`, and publishes when that PR merges. Requires `NPM_TOKEN` secret + `NPM_CONFIG_PROVENANCE=true` for supply-chain attestation. Not wired up yet — track in TODO.md under "Production readiness → CI".
