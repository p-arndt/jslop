import type { Plugin, PluginOption, UserConfig } from "vite";
import { compile } from "@rift/compiler";
import { scanRoutes, matchRoute, type RouteManifest } from "@rift/router";
import { renderPage, type RiftComponent } from "@rift/server";
import { resolve, posix, isAbsolute } from "node:path";

export interface RiftPluginOptions {
  /**
   * Directory containing route .rift files, resolved relative to the project root.
   * Defaults to `src/routes`.
   */
  routesDir?: string;
  /**
   * Page title generator. Receives the matched URL and params.
   * Only used in dev. In production builds, the adapter passes `title` to
   * `render(url, { title })` directly — a function can't be baked into the
   * server bundle.
   */
  title?: (url: string, params: Record<string, string>) => string;
  /**
   * Stylesheet URLs injected as <link rel="stylesheet"> into the SSR <head>.
   * Each entry is used verbatim, so it should be the URL the browser will
   * request — e.g. `/src/app.css` in dev. In production, the hashed CSS
   * emitted by Vite is auto-discovered from the client manifest; values here
   * are emitted in addition.
   */
  css?: string | string[];
  /**
   * Enable Tailwind CSS v4. When `true`, `@tailwindcss/vite` is auto-loaded
   * and appended to the plugin chain. Install `tailwindcss` and
   * `@tailwindcss/vite` in the project for this to work.
   */
  tailwind?: boolean;
}

const VIRTUAL_ROUTES = "virtual:rift-routes";
const VIRTUAL_CLIENT = "virtual:rift-client";
const VIRTUAL_ENTRY_SERVER = "virtual:rift-entry-server";
const RESOLVED_ROUTES = "\0" + VIRTUAL_ROUTES;
const RESOLVED_CLIENT = "\0" + VIRTUAL_CLIENT;
const RESOLVED_ENTRY_SERVER = "\0" + VIRTUAL_ENTRY_SERVER;

export default function rift(opts: RiftPluginOptions = {}): PluginOption[] {
  const routesDirRel = opts.routesDir ?? "src/routes";
  const stylesheets = opts.css == null
    ? []
    : Array.isArray(opts.css)
      ? opts.css
      : [opts.css];
  let projectRoot = process.cwd();
  let routesDir = resolve(projectRoot, routesDirRel);
  let cachedManifest: RouteManifest | null = null;

  const invalidateRoutes = () => {
    cachedManifest = null;
  };

  const loadManifest = async (): Promise<RouteManifest> => {
    if (cachedManifest) return cachedManifest;
    cachedManifest = await scanRoutes(routesDir);
    return cachedManifest;
  };

  const titleFor = (url: string, params: Record<string, string>): string =>
    opts.title ? opts.title(url, params) : `Rift — ${url}`;

  const transformPlugin: Plugin = {
    name: "rift:transform",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".rift")) return null;
      const out = compile(code, { compiledExtension: ".rift" });
      return { code: out, map: null };
    },
  };

  const virtualPlugin: Plugin = {
    name: "rift:virtual",
    config(_config, env): UserConfig | undefined {
      // In build mode, point rollup at the right virtual entry depending on
      // whether this is the client or the SSR pass. Users run:
      //   vite build              (client → dist/client, with manifest)
      //   vite build --ssr        (server → dist/server/entry-server.js)
      // The adapter (e.g. @rift/node-adapter) imports the server entry and
      // serves static assets from dist/client.
      if (env.command !== "build") return undefined;
      if (env.isSsrBuild) {
        const cfg: UserConfig = {
          build: {
            ssr: true,
            outDir: "dist/server",
            emptyOutDir: true,
            rollupOptions: {
              input: { "entry-server": VIRTUAL_ENTRY_SERVER },
              output: {
                entryFileNames: "[name].js",
                format: "esm",
              },
            },
          },
          ssr: {
            // Workspace packages need to be bundled into the server entry so
            // it can run standalone. Externalizing them would require the user
            // to install them at deploy time.
            noExternal: [/^@rift\//],
          },
        };
        return cfg;
      }
      const cfg: UserConfig = {
        build: {
          outDir: "dist/client",
          emptyOutDir: true,
          manifest: true,
          rollupOptions: {
            input: { client: VIRTUAL_CLIENT },
          },
        },
      };
      return cfg;
    },
    configResolved(config) {
      projectRoot = config.root;
      routesDir = isAbsolute(routesDirRel)
        ? routesDirRel
        : resolve(projectRoot, routesDirRel);
    },
    resolveId(id) {
      if (id === VIRTUAL_ROUTES) return RESOLVED_ROUTES;
      if (id === VIRTUAL_CLIENT) return RESOLVED_CLIENT;
      if (id === VIRTUAL_ENTRY_SERVER) return RESOLVED_ENTRY_SERVER;
      return null;
    },
    async load(id) {
      if (id === RESOLVED_ROUTES) {
        const m = await loadManifest();
        const allFiles = collectAllRiftFiles(m);
        const imports = allFiles
          .map((f, i) => `import C${i} from ${JSON.stringify(toImportPath(routesDir, f))};`)
          .join("\n");
        const indexOf = (rel: string): number => allFiles.indexOf(rel);
        const entries = m.routes
          .map((r) => {
            const layoutVars = r.layouts.map((l) => `C${indexOf(l)}`).join(", ");
            return `  { pattern: ${JSON.stringify(r.pattern)}, paramNames: ${JSON.stringify(
              r.paramNames
            )}, component: C${indexOf(r.relPath)}, layouts: [${layoutVars}] }`;
          })
          .join(",\n");
        const notFound = m.notFound
          ? `C${indexOf(m.notFound.relPath)}`
          : "null";
        return `${imports}\n\nexport const routes = [\n${entries}\n];\nexport const notFound = ${notFound};\n`;
      }
      if (id === RESOLVED_CLIENT) {
        const m = await loadManifest();
        const allFiles = collectAllRiftFiles(m);
        const imports = allFiles
          .map((f, i) => `import C${i} from ${JSON.stringify(toImportPath(routesDir, f))};`)
          .join("\n");
        const registry = allFiles.map((_, i) => `  [C${i}.name]: C${i}`).join(",\n");
        // In build mode, also import stylesheets so Vite tracks them as
        // assets of the client entry. The hashed CSS shows up in the client
        // manifest under the entry's `css` field, and the server entry pulls
        // it from there at request time.
        const cssImports =
          stylesheets.length > 0
            ? stylesheets
                .map((s) => `import ${JSON.stringify(s)};`)
                .join("\n") + "\n"
            : "";
        return `${cssImports}import { boot } from "@rift/client";\n${imports}\n\nboot({\n${registry}\n});\n`;
      }
      if (id === RESOLVED_ENTRY_SERVER) {
        // `opts.css` entries are source-path stylesheets used by the dev
        // middleware. In production they're imported into the client virtual
        // (so Vite emits hashed CSS) and surface via the client manifest's
        // `css` field — they must not also be rendered as raw source URLs,
        // which wouldn't resolve in prod.
        return generateServerEntry(await loadManifest(), routesDir, []);
      }
      return null;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.endsWith(".rift")) {
        // If a new .rift file was added or removed, invalidate route list.
        invalidateRoutes();
        // Touch the virtual modules so dependents reload.
        const routesMod = ctx.server.moduleGraph.getModuleById(RESOLVED_ROUTES);
        const clientMod = ctx.server.moduleGraph.getModuleById(RESOLVED_CLIENT);
        if (routesMod) ctx.server.moduleGraph.invalidateModule(routesMod);
        if (clientMod) ctx.server.moduleGraph.invalidateModule(clientMod);
      }
    },
  };

  const ssrPlugin: Plugin = {
    name: "rift:ssr",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
          try {
            let url = req.url ?? "/";
            // Let Vite's own asset/module URLs through.
            if (
              url.startsWith("/@") ||
              url.startsWith("/node_modules") ||
              (url.includes(".") &&
                !url.endsWith(".html") &&
                /\.[a-z0-9]+(\?|$)/i.test(url))
            ) {
              return next();
            }
            // Normalize index.html requests (Vite's spa fallback turns "/" into "/index.html")
            if (url.endsWith("/index.html")) {
              url = url.slice(0, -"index.html".length);
            }
            if (url.length > 1 && url.endsWith("/")) {
              url = url.slice(0, -1);
            }
            if (url === "") url = "/";

            const manifest = await loadManifest();
            const match = matchRoute(url, manifest.routes);

            const loadComponent = async (rel: string): Promise<RiftComponent> => {
              const mod = await server.ssrLoadModule(resolve(routesDir, rel));
              const c =
                (mod as { default?: unknown }).default ??
                (mod as { __rift_component?: unknown }).__rift_component;
              if (!c) throw new Error(`${rel} has no default export`);
              return c as RiftComponent;
            };

            if (!match) {
              if (manifest.notFound) {
                const nfComp = await loadComponent(manifest.notFound.relPath);
                const nfLayouts = await Promise.all(
                  manifest.notFound.layouts.map((rel) => loadComponent(rel))
                );
                let html = renderPage({
                  title: titleFor(url, {}),
                  component: nfComp,
                  layouts: nfLayouts,
                  appScriptUrl: "/@id/" + VIRTUAL_CLIENT,
                  props: {},
                  stylesheets,
                });
                html = await server.transformIndexHtml(url, html);
                res.statusCode = 404;
                res.setHeader("content-type", "text/html; charset=utf-8");
                res.end(html);
                return;
              }
              res.statusCode = 404;
              res.setHeader("content-type", "text/plain");
              res.end("not found");
              return;
            }

            const routeComp = await loadComponent(match.route.relPath);
            const layoutComps = await Promise.all(
              match.route.layouts.map((rel) => loadComponent(rel))
            );

            let html = renderPage({
              title: titleFor(url, match.params),
              component: routeComp,
              layouts: layoutComps,
              appScriptUrl: "/@id/" + VIRTUAL_CLIENT,
              props: match.params,
              stylesheets,
            });
            html = await server.transformIndexHtml(url, html);
            res.statusCode = 200;
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(html);
          } catch (err) {
            server.ssrFixStacktrace(err as Error);
            next(err);
          }
        });
    },
  };

  const plugins: PluginOption[] = [transformPlugin, virtualPlugin, ssrPlugin];

  if (opts.tailwind) {
    plugins.push(loadTailwindPlugin() as unknown as PluginOption);
  }

  return plugins;
}

async function loadTailwindPlugin(): Promise<PluginOption> {
  try {
    const mod = (await import("@tailwindcss/vite")) as {
      default: (...args: unknown[]) => PluginOption;
    };
    return mod.default();
  } catch (err) {
    throw new Error(
      "[@rift/vite] tailwind: true requires `@tailwindcss/vite` and `tailwindcss` to be installed in the project. " +
        "Run `pnpm add -D tailwindcss @tailwindcss/vite`.\n" +
        `Original error: ${(err as Error).message}`
    );
  }
}

function toImportPath(routesDir: string, relPath: string): string {
  return posix.join(routesDir.split(/[\\/]/).join("/"), relPath.split(/[\\/]/).join("/"));
}

/**
 * Deduplicated list of every .rift file in the manifest (routes + layouts +
 * 404). Order is stable so the same file always gets the same Cn identifier.
 */
function collectAllRiftFiles(m: RouteManifest): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (rel: string) => {
    if (!seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  };
  for (const r of m.routes) push(r.relPath);
  for (const l of m.layouts) push(l.relPath);
  if (m.notFound) push(m.notFound.relPath);
  return out;
}

/**
 * Generate the source for `virtual:rift-entry-server`. The result is a JS
 * module that exports an async `render(url, opts?)` function.
 *
 * Static imports keep tree-shaking and code-splitting honest, and let the SSR
 * Rollup pass bundle every route component into a single server entry.
 */
function generateServerEntry(
  m: RouteManifest,
  routesDir: string,
  staticStylesheets: string[]
): string {
  const allFiles = collectAllRiftFiles(m);
  const indexOf = (rel: string): number => allFiles.indexOf(rel);
  const componentImports = allFiles
    .map((f, i) => `import C${i} from ${JSON.stringify(toImportPath(routesDir, f))};`)
    .join("\n");

  const routeEntries = m.routes
    .map((r) => {
      const layoutVars = r.layouts.map((l) => `C${indexOf(l)}`).join(", ");
      return `  { pattern: ${JSON.stringify(r.pattern)}, paramNames: ${JSON.stringify(
        r.paramNames
      )}, component: C${indexOf(r.relPath)}, layouts: [${layoutVars}] }`;
    })
    .join(",\n");

  let notFoundLiteral = "null";
  if (m.notFound) {
    const layoutVars = m.notFound.layouts.map((l) => `C${indexOf(l)}`).join(", ");
    notFoundLiteral = `{ component: C${indexOf(m.notFound.relPath)}, layouts: [${layoutVars}] }`;
  }

  const staticCss = JSON.stringify(staticStylesheets);

  return `import { renderPage } from "@rift/server";
import { matchRoute } from "@rift/router";
import { readFile } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

${componentImports}

const routes = [
${routeEntries}
];
const notFound = ${notFoundLiteral};
const STATIC_STYLESHEETS = ${staticCss};

let _clientManifestPromise = null;
function loadClientManifest(manifestPath) {
  if (_clientManifestPromise && !manifestPath) return _clientManifestPromise;
  const promise = (async () => {
    const here = fileURLToPath(import.meta.url);
    const candidates = [];
    if (manifestPath) {
      candidates.push(isAbsolute(manifestPath) ? manifestPath : join(process.cwd(), manifestPath));
    }
    if (process.env.RIFT_CLIENT_MANIFEST) {
      candidates.push(process.env.RIFT_CLIENT_MANIFEST);
    }
    // Default layout produced by @rift/vite:
    //   <root>/dist/server/entry-server.js
    //   <root>/dist/client/.vite/manifest.json
    candidates.push(join(dirname(here), "..", "client", ".vite", "manifest.json"));
    for (const p of candidates) {
      try {
        const text = await readFile(p, "utf8");
        return JSON.parse(text);
      } catch {}
    }
    return null;
  })();
  if (!manifestPath) _clientManifestPromise = promise;
  return promise;
}

function findClientEntry(manifest) {
  if (!manifest) return null;
  for (const entry of Object.values(manifest)) {
    if (entry && typeof entry === "object" && entry.isEntry) return entry;
  }
  return null;
}

function normalizeUrl(raw) {
  let u = (raw || "/").split("?")[0] || "/";
  if (u.endsWith("/index.html")) u = u.slice(0, -"index.html".length);
  if (u.length > 1 && u.endsWith("/")) u = u.slice(0, -1);
  if (u === "") u = "/";
  return u;
}

function defaultTitle(url) {
  return "Rift — " + url;
}

/**
 * Render a Rift route for a given URL.
 *
 * @param {string} rawUrl - The request URL (path or full).
 * @param {object} [opts]
 * @param {string} [opts.appScriptUrl] - Override the client script URL.
 *   If omitted, auto-discovered from the client manifest.
 * @param {string[]} [opts.stylesheets] - Override stylesheets. If omitted,
 *   STATIC_STYLESHEETS plus any CSS emitted for the client entry are used.
 * @param {(url: string, params: Record<string,string>) => string} [opts.title]
 * @param {string} [opts.clientManifestPath] - Path to client \`.vite/manifest.json\`.
 *   Defaults to a sibling \`../client/.vite/manifest.json\` relative to this entry.
 * @returns {Promise<{ status: number, html: string, headers: Record<string,string> }>}
 */
export async function render(rawUrl, opts = {}) {
  const url = normalizeUrl(rawUrl);
  const titleFn = opts.title || defaultTitle;

  let appScriptUrl = opts.appScriptUrl;
  let stylesheets = opts.stylesheets;

  if (appScriptUrl === undefined || stylesheets === undefined) {
    const manifest = await loadClientManifest(opts.clientManifestPath);
    const entry = findClientEntry(manifest);
    if (entry) {
      if (appScriptUrl === undefined) appScriptUrl = "/" + entry.file;
      if (stylesheets === undefined) {
        const entryCss = Array.isArray(entry.css) ? entry.css.map((c) => "/" + c) : [];
        stylesheets = [...STATIC_STYLESHEETS, ...entryCss];
      }
    } else {
      if (appScriptUrl === undefined) appScriptUrl = "";
      if (stylesheets === undefined) stylesheets = [...STATIC_STYLESHEETS];
    }
  }

  const match = matchRoute(url, routes);
  if (!match) {
    if (notFound) {
      const html = renderPage({
        title: titleFn(url, {}),
        component: notFound.component,
        layouts: notFound.layouts,
        appScriptUrl,
        props: {},
        stylesheets,
      });
      return { status: 404, html, headers: { "content-type": "text/html; charset=utf-8" } };
    }
    return {
      status: 404,
      html: "not found",
      headers: { "content-type": "text/plain; charset=utf-8" },
    };
  }

  const html = renderPage({
    title: titleFn(url, match.params),
    component: match.route.component,
    layouts: match.route.layouts,
    appScriptUrl,
    props: match.params,
    stylesheets,
  });
  return { status: 200, html, headers: { "content-type": "text/html; charset=utf-8" } };
}

export const __rift = { routes, notFound };
`;
}
