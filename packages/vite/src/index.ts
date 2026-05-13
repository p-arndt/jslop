import type { Plugin, PluginOption } from "vite";
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
   */
  title?: (url: string, params: Record<string, string>) => string;
  /**
   * Stylesheet URLs injected as <link rel="stylesheet"> into the SSR <head>.
   * Each entry is used verbatim, so it should be the URL the browser will
   * request — e.g. `/src/app.css` in dev.
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
const RESOLVED_ROUTES = "\0" + VIRTUAL_ROUTES;
const RESOLVED_CLIENT = "\0" + VIRTUAL_CLIENT;

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
    configResolved(config) {
      projectRoot = config.root;
      routesDir = isAbsolute(routesDirRel)
        ? routesDirRel
        : resolve(projectRoot, routesDirRel);
    },
    resolveId(id) {
      if (id === VIRTUAL_ROUTES) return RESOLVED_ROUTES;
      if (id === VIRTUAL_CLIENT) return RESOLVED_CLIENT;
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
        return `import { boot } from "@rift/client";\n${imports}\n\nboot({\n${registry}\n});\n`;
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
