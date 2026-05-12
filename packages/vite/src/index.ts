import type { Plugin, PluginOption } from "vite";
import { compile } from "@rift/compiler";
import { scanRoutes, matchRoute, type RouteDef } from "@rift/router";
import { renderPage } from "@rift/server";
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
  let cachedRoutes: RouteDef[] | null = null;

  const invalidateRoutes = () => {
    cachedRoutes = null;
  };

  const loadRoutes = async (): Promise<RouteDef[]> => {
    if (cachedRoutes) return cachedRoutes;
    cachedRoutes = await scanRoutes(routesDir);
    return cachedRoutes;
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
        const routes = await loadRoutes();
        const imports = routes
          .map(
            (r, i) =>
              `import C${i} from ${JSON.stringify(toImportPath(routesDir, r.relPath))};`
          )
          .join("\n");
        const entries = routes
          .map(
            (r, i) =>
              `  { pattern: ${JSON.stringify(r.pattern)}, paramNames: ${JSON.stringify(
                r.paramNames
              )}, component: C${i} }`
          )
          .join(",\n");
        return `${imports}\n\nexport const routes = [\n${entries}\n];\n`;
      }
      if (id === RESOLVED_CLIENT) {
        const routes = await loadRoutes();
        const imports = routes
          .map(
            (r, i) =>
              `import C${i} from ${JSON.stringify(toImportPath(routesDir, r.relPath))};`
          )
          .join("\n");
        const registry = routes
          .map((_, i) => `  [C${i}.name]: C${i}`)
          .join(",\n");
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

            const routes = await loadRoutes();
            const match = matchRoute(url, routes);
            if (!match) {
              res.statusCode = 404;
              res.setHeader("content-type", "text/plain");
              res.end("not found");
              return;
            }

            const modPath = resolve(routesDir, match.route.relPath);
            const mod = await server.ssrLoadModule(modPath);
            const component =
              (mod as { default?: unknown }).default ??
              (mod as { __rift_component?: unknown }).__rift_component;
            if (!component) {
              throw new Error(`route ${match.route.relPath} has no default export`);
            }

            let html = renderPage({
              title: titleFor(url, match.params),
              component: component as Parameters<typeof renderPage>[0]["component"],
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
