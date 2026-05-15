import type { Plugin, PluginOption, UserConfig } from "vite";
import { compile } from "@jslop/compiler";
import { scanRoutes, matchRoute, type RouteManifest } from "@jslop/router";
import { renderPage, type JSlopComponent } from "@jslop/server";
import { isNotFoundError } from "@jslop/runtime";
import { resolve, posix, isAbsolute } from "node:path";

export interface JSlopPluginOptions {
  /**
   * Directory containing route .jslop files, resolved relative to the project root.
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

const VIRTUAL_ROUTES = "virtual:jslop-routes";
const VIRTUAL_CLIENT = "virtual:jslop-client";
const VIRTUAL_ENTRY_SERVER = "virtual:jslop-entry-server";
const RESOLVED_ROUTES = "\0" + VIRTUAL_ROUTES;
const RESOLVED_CLIENT = "\0" + VIRTUAL_CLIENT;
const RESOLVED_ENTRY_SERVER = "\0" + VIRTUAL_ENTRY_SERVER;

export default function jslop(opts: JSlopPluginOptions = {}): PluginOption[] {
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
    opts.title ? opts.title(url, params) : `JSlop — ${url}`;

  const transformPlugin: Plugin = {
    name: "jslop:transform",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".jslop")) return null;
      const out = compile(code, { compiledExtension: ".jslop", filename: id });
      return { code: out, map: null };
    },
  };

  const virtualPlugin: Plugin = {
    name: "jslop:virtual",
    config(_config, env): UserConfig | undefined {
      // In build mode, point rollup at the right virtual entry depending on
      // whether this is the client or the SSR pass. Users run:
      //   vite build              (client → dist/client, with manifest)
      //   vite build --ssr        (server → dist/server/entry-server.js)
      // The adapter (e.g. @jslop/node-adapter) imports the server entry and
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
            noExternal: [/^@jslop\//],
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
        const allFiles = collectAllJSlopFiles(m);
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
        const allFiles = collectAllJSlopFiles(m);
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
        return `${cssImports}import { boot } from "@jslop/client";\n${imports}\n\nboot({\n${registry}\n});\n`;
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
      if (ctx.file.endsWith(".jslop")) {
        // If a new .jslop file was added or removed, invalidate route list.
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
    name: "jslop:ssr",
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

            const loadComponent = async (rel: string): Promise<JSlopComponent> => {
              const mod = await server.ssrLoadModule(resolve(routesDir, rel));
              const c =
                (mod as { default?: unknown }).default ??
                (mod as { __jslop_component?: unknown }).__jslop_component;
              if (!c) throw new Error(`${rel} has no default export`);
              return c as JSlopComponent;
            };
            // Parallel: routes that don't declare load() return `undefined` and
            // get treated as no-op (props = match.params verbatim).
            const loadRouteLoader = async (
              rel: string
            ): Promise<((ctx: { params: Record<string, string>; url: URL }) => unknown) | undefined> => {
              const mod = await server.ssrLoadModule(resolve(routesDir, rel));
              const fn = (mod as { load?: unknown }).load;
              return typeof fn === "function"
                ? (fn as (c: { params: Record<string, string>; url: URL }) => unknown)
                : undefined;
            };

            const runLayoutLoaders = async (
              relPaths: string[],
              loadCtx: { params: Record<string, string>; url: URL }
            ): Promise<Record<string, unknown>> => {
              const data: Record<string, unknown> = {};
              for (const rel of relPaths) {
                const fn = await loadRouteLoader(rel);
                if (!fn) continue;
                const result = await fn(loadCtx);
                if (result && typeof result === "object") {
                  Object.assign(data, result as Record<string, unknown>);
                }
              }
              return data;
            };

            const renderNotFound = async (status: number): Promise<void> => {
              if (manifest.notFound) {
                const nfComp = await loadComponent(manifest.notFound.relPath);
                const nfLayouts = await Promise.all(
                  manifest.notFound.layouts.map((rel) => loadComponent(rel))
                );
                // 404 layouts may have their own loaders (e.g. global session).
                // We run them with empty params here; throwing notFound again
                // would loop, so we let that bubble as a real error.
                const nfLayoutProps = await runLayoutLoaders(manifest.notFound.layouts, {
                  params: {},
                  url: new URL(url, "http://localhost"),
                });
                let html = renderPage({
                  title: titleFor(url, {}),
                  component: nfComp,
                  layouts: nfLayouts,
                  appScriptUrl: "/@id/" + VIRTUAL_CLIENT,
                  props: nfLayoutProps,
                  layoutProps: nfLayoutProps,
                  stylesheets,
                });
                html = await server.transformIndexHtml(url, html);
                res.statusCode = status;
                res.setHeader("content-type", "text/html; charset=utf-8");
                res.end(html);
                return;
              }
              res.statusCode = status;
              res.setHeader("content-type", "text/plain");
              res.end("not found");
            };

            if (!match) {
              await renderNotFound(404);
              return;
            }

            const routeComp = await loadComponent(match.route.relPath);
            const layoutComps = await Promise.all(
              match.route.layouts.map((rel) => loadComponent(rel))
            );
            const routeLoad = await loadRouteLoader(match.route.relPath);

            let layoutData: Record<string, unknown> = {};
            let extraProps: Record<string, unknown> = {};
            try {
              // Pass the request URL alongside path params so a route's load
              // can read query string filters etc. via url.searchParams.
              const loadCtx = {
                params: match.params,
                url: new URL((req.url ?? url) || "/", "http://localhost"),
              };
              layoutData = await runLayoutLoaders(match.route.layouts, loadCtx);
              if (routeLoad) {
                const result = await routeLoad(loadCtx);
                if (result && typeof result === "object") {
                  extraProps = result as Record<string, unknown>;
                }
              }
            } catch (err) {
              if (isNotFoundError(err)) {
                await renderNotFound(404);
                return;
              }
              throw err;
            }

            let html = renderPage({
              title: titleFor(url, match.params),
              component: routeComp,
              layouts: layoutComps,
              appScriptUrl: "/@id/" + VIRTUAL_CLIENT,
              // Route sees: URL params first, layout data next, then its own
              // load result on top (route-load wins on key conflicts).
              props: { ...match.params, ...layoutData, ...extraProps },
              layoutProps: layoutData,
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
      "[@jslop/vite] tailwind: true requires `@tailwindcss/vite` and `tailwindcss` to be installed in the project. " +
        "Run `pnpm add -D tailwindcss @tailwindcss/vite`.\n" +
        `Original error: ${(err as Error).message}`
    );
  }
}

function toImportPath(routesDir: string, relPath: string): string {
  return posix.join(routesDir.split(/[\\/]/).join("/"), relPath.split(/[\\/]/).join("/"));
}

/**
 * Deduplicated list of every .jslop file in the manifest (routes + layouts +
 * 404). Order is stable so the same file always gets the same Cn identifier.
 */
function collectAllJSlopFiles(m: RouteManifest): string[] {
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
 * Generate the source for `virtual:jslop-entry-server`. The result is a JS
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
  const allFiles = collectAllJSlopFiles(m);
  const indexOf = (rel: string): number => allFiles.indexOf(rel);
  // Namespace imports so we can pick up both the default component and the
  // optional `load` export without separate import lines per route.
  const componentImports = allFiles
    .map((f, i) => `import * as M${i} from ${JSON.stringify(toImportPath(routesDir, f))};`)
    .join("\n");

  const routeEntries = m.routes
    .map((r) => {
      const layoutEntries = r.layouts
        .map((l) => `{ component: M${indexOf(l)}.default, load: M${indexOf(l)}.load }`)
        .join(", ");
      const idx = indexOf(r.relPath);
      return `  { pattern: ${JSON.stringify(r.pattern)}, paramNames: ${JSON.stringify(
        r.paramNames
      )}, component: M${idx}.default, load: M${idx}.load, layouts: [${layoutEntries}] }`;
    })
    .join(",\n");

  let notFoundLiteral = "null";
  if (m.notFound) {
    const layoutEntries = m.notFound.layouts
      .map((l) => `{ component: M${indexOf(l)}.default, load: M${indexOf(l)}.load }`)
      .join(", ");
    notFoundLiteral = `{ component: M${indexOf(m.notFound.relPath)}.default, layouts: [${layoutEntries}] }`;
  }

  const staticCss = JSON.stringify(staticStylesheets);

  return `import { renderPage } from "@jslop/server";
import { matchRoute } from "@jslop/router";
import { isNotFoundError } from "@jslop/runtime";
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
    if (process.env.JSLOP_CLIENT_MANIFEST) {
      candidates.push(process.env.JSLOP_CLIENT_MANIFEST);
    }
    // Default layout produced by @jslop/vite:
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
  return "JSlop — " + url;
}

/**
 * Render a JSlop route for a given URL.
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

  const runLayoutLoaders = async (entries, loadCtx) => {
    const data = {};
    for (const e of entries) {
      if (typeof e.load !== "function") continue;
      const r = await e.load(loadCtx);
      if (r && typeof r === "object") Object.assign(data, r);
    }
    return data;
  };

  const renderNotFound = async (status) => {
    if (notFound) {
      // 404 layouts may have their own loaders. We run them with empty params;
      // if one throws notFound again, we let the error bubble — recursive 404
      // would loop.
      const layoutData = await runLayoutLoaders(notFound.layouts, {
        params: {},
        url: new URL(rawUrl || "/", "http://localhost"),
      });
      const html = renderPage({
        title: titleFn(url, {}),
        component: notFound.component,
        layouts: notFound.layouts.map((e) => e.component),
        appScriptUrl,
        props: layoutData,
        layoutProps: layoutData,
        stylesheets,
      });
      return { status, html, headers: { "content-type": "text/html; charset=utf-8" } };
    }
    return {
      status,
      html: "not found",
      headers: { "content-type": "text/plain; charset=utf-8" },
    };
  };

  const match = matchRoute(url, routes);
  if (!match) return renderNotFound(404);

  let layoutData = {};
  let extraProps = {};
  try {
    const loadCtx = {
      params: match.params,
      url: new URL(rawUrl || "/", "http://localhost"),
    };
    layoutData = await runLayoutLoaders(match.route.layouts, loadCtx);
    if (typeof match.route.load === "function") {
      const result = await match.route.load(loadCtx);
      if (result && typeof result === "object") extraProps = result;
    }
  } catch (err) {
    if (isNotFoundError(err)) return renderNotFound(404);
    throw err;
  }

  const html = renderPage({
    title: titleFn(url, match.params),
    component: match.route.component,
    layouts: match.route.layouts.map((e) => e.component),
    appScriptUrl,
    // Route sees: URL params first, layout data next, then its own load
    // result on top (route-load wins on key conflicts).
    props: { ...match.params, ...layoutData, ...extraProps },
    layoutProps: layoutData,
    stylesheets,
  });
  return { status: 200, html, headers: { "content-type": "text/html; charset=utf-8" } };
}

export const __jslop = { routes, notFound };
`;
}
