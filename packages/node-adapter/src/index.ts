import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, normalize, sep } from "node:path";

/**
 * Shape of `render` exported by `virtual:rift-entry-server`.
 */
export type RenderFn = (
  url: string,
  opts?: {
    appScriptUrl?: string;
    stylesheets?: string[];
    title?: (url: string, params: Record<string, string>) => string;
    clientManifestPath?: string;
  }
) => Promise<RenderResult>;

export interface RenderResult {
  status: number;
  html: string;
  headers: Record<string, string>;
}

export interface NodeAdapterOptions {
  /** The bundled `render` function from `dist/server/entry-server.js`. */
  render: RenderFn;
  /** Absolute path to the client build dir (typically `dist/client`). */
  clientDir: string;
  /** Optional title generator passed through to render(). */
  title?: (url: string, params: Record<string, string>) => string;
  /** Override path to `.vite/manifest.json`. Defaults to `<clientDir>/.vite/manifest.json`. */
  clientManifestPath?: string;
}

const MIME: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/**
 * Build a Node HTTP request handler from a Rift SSR build.
 *
 * Static assets under `clientDir` are served with long cache headers when they
 * include a hash in the filename (Vite default for `assets/`); other paths
 * fall through to `render(url)`.
 */
export function createHandler(
  opts: NodeAdapterOptions
): (req: IncomingMessage, res: ServerResponse) => void {
  const clientDir = resolve(opts.clientDir);
  const manifestPath = opts.clientManifestPath ?? join(clientDir, ".vite", "manifest.json");

  return async (req, res) => {
    try {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] || "/";

      // Try a static file under clientDir first if the path looks like an
      // asset (has an extension, isn't a route).
      const ext = extname(pathname);
      if (ext) {
        const served = await tryServeStatic(clientDir, pathname, ext, res);
        if (served) return;
      }

      const result = await opts.render(url, {
        title: opts.title,
        clientManifestPath: manifestPath,
      });

      res.statusCode = result.status;
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
      res.end(result.html);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[@rift/node-adapter] render error:", err);
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("internal server error");
    }
  };
}

async function tryServeStatic(
  clientDir: string,
  pathname: string,
  ext: string,
  res: ServerResponse
): Promise<boolean> {
  // Resolve under clientDir and guard against path traversal.
  const rel = pathname.replace(/^\/+/, "");
  const target = normalize(join(clientDir, rel));
  if (!target.startsWith(clientDir + sep) && target !== clientDir) {
    return false;
  }
  try {
    const st = await stat(target);
    if (!st.isFile()) return false;
    const buf = await readFile(target);
    res.statusCode = 200;
    res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
    // Vite hashes filenames under /assets/, so those are safe to cache hard.
    if (rel.startsWith("assets/")) {
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
    }
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience: spin up an http.Server bound to a port.
 */
export function createServer(opts: NodeAdapterOptions & { port?: number }): Server {
  const handler = createHandler(opts);
  const server = createHttpServer(handler);
  return server;
}
