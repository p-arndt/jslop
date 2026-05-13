import { readdir, stat } from "node:fs/promises";
import { join, relative, sep, posix, extname } from "node:path";


export interface RouteDef {
  /** URL pattern with [param] placeholders, e.g. "/posts/[slug]" */
  pattern: string;
  /** Names of bracketed params in pattern order */
  paramNames: string[];
  /** Path to the source .rift file relative to the routes dir */
  relPath: string;
  /** Compiled JS path expected (e.g. routes/posts/[slug].compiled.mjs) */
  compiledRelPath: string;
  /** A safe JS identifier derived from relPath, e.g. "Posts__slug" */
  identifier: string;
  /**
   * Layout files wrapping this route, outermost first. Each entry is a rel
   * path to a `_layout.rift` file in this route's directory chain.
   */
  layouts: string[];
}

export interface LayoutDef {
  /** Path relative to routes dir, e.g. "dashboard/_layout.rift" */
  relPath: string;
  /**
   * Directory this layout owns (forward-slash, "" for routes root). Applies
   * to any route whose relPath is under this directory.
   */
  dir: string;
  identifier: string;
}

export interface NotFoundDef {
  /** Path relative to routes dir, e.g. "_404.rift" */
  relPath: string;
  identifier: string;
  /** Layout chain (outermost first) applying to the 404 page. */
  layouts: string[];
}

export interface RouteManifest {
  routes: RouteDef[];
  layouts: LayoutDef[];
  notFound: NotFoundDef | null;
}

/**
 * Walk a routes directory and produce a deterministic, more-specific-first
 * list of routes plus the layout chain that wraps each one.
 *
 * Conventions:
 * - Files named `_layout.rift` are layouts; they apply to every route under
 *   the directory they live in.
 * - A file named `_404.rift` at the routes root is the catch-all page rendered
 *   when no route matches.
 * - Any other file starting with `_` is reserved and ignored.
 */
export async function scanRoutes(routesDir: string): Promise<RouteManifest> {
  const routes: RouteDef[] = [];
  const layouts: LayoutDef[] = [];
  let notFound: NotFoundDef | null = null;

  await walk(routesDir, routesDir, routes, layouts, (nf) => {
    notFound = nf;
  });

  // Resolve layout chain for each route: every layout whose `dir` is a
  // prefix of the route's directory applies, outermost first.
  const layoutsByDir = new Map<string, LayoutDef>();
  for (const l of layouts) layoutsByDir.set(l.dir, l);

  const chainFor = (rel: string): string[] => {
    const dir = parentDir(rel);
    const segs = dir === "" ? [] : dir.split("/");
    const dirs: string[] = [""];
    for (let i = 0; i < segs.length; i++) {
      dirs.push(segs.slice(0, i + 1).join("/"));
    }
    const chain: string[] = [];
    for (const d of dirs) {
      const lay = layoutsByDir.get(d);
      if (lay) chain.push(lay.relPath);
    }
    return chain;
  };
  for (const r of routes) r.layouts = chainFor(r.relPath);
  if (notFound) (notFound as NotFoundDef).layouts = chainFor((notFound as NotFoundDef).relPath);

  routes.sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
  layouts.sort((a, b) => a.dir.length - b.dir.length);
  return { routes, layouts, notFound };
}

async function walk(
  rootDir: string,
  current: string,
  routes: RouteDef[],
  layouts: LayoutDef[],
  setNotFound: (nf: NotFoundDef) => void
): Promise<void> {
  const entries = await readdir(current);
  for (const entry of entries) {
    const full = join(current, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      await walk(rootDir, full, routes, layouts, setNotFound);
      continue;
    }
    if (extname(entry) !== ".rift") continue;

    const rel = relative(rootDir, full).split(sep).join(posix.sep);
    const noExt = rel.slice(0, -".rift".length);
    const base = basenameOf(rel);

    if (base === "_layout") {
      layouts.push({
        relPath: rel,
        dir: parentDir(rel),
        identifier: identifierOf(noExt),
      });
      continue;
    }
    if (base === "_404") {
      // Only honor `_404.rift` at the routes root.
      if (parentDir(rel) === "") {
        setNotFound({ relPath: rel, identifier: identifierOf(noExt), layouts: [] });
      }
      continue;
    }
    if (base.startsWith("_")) continue;

    const segments = noExt.split("/");
    const last = segments[segments.length - 1] ?? "";
    const urlSegments = (last === "index" ? segments.slice(0, -1) : segments).map(toUrlSegment);
    const pattern = "/" + urlSegments.join("/");
    const cleanPattern = pattern === "" ? "/" : pattern;
    const paramNames: string[] = [];
    for (const seg of urlSegments) {
      const m = /^\[(.+)\]$/.exec(seg);
      if (m && m[1]) paramNames.push(m[1]);
    }
    routes.push({
      pattern: cleanPattern,
      paramNames,
      relPath: rel,
      compiledRelPath: noExt + ".compiled.mjs",
      identifier: identifierOf(noExt),
      layouts: [], // filled in by scanRoutes
    });
  }
}

function toUrlSegment(seg: string): string {
  return seg;
}

function basenameOf(rel: string): string {
  const slash = rel.lastIndexOf("/");
  const file = slash === -1 ? rel : rel.slice(slash + 1);
  return file.slice(0, -".rift".length);
}

function parentDir(rel: string): string {
  const slash = rel.lastIndexOf("/");
  return slash === -1 ? "" : rel.slice(0, slash);
}

function identifierOf(rel: string): string {
  let s = rel.replace(/\W+/g, "_");
  if (/^\d/.test(s)) s = "_" + s;
  // Capitalize first letter to make it look like a component
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function specificity(pattern: string): number {
  // Static segments score higher than dynamic ones.
  let score = 0;
  for (const seg of pattern.split("/")) {
    if (!seg) continue;
    if (/^\[.+\]$/.test(seg)) score += 1;
    else score += 100;
  }
  return score;
}

export interface MatchResult {
  route: RouteDef;
  params: Record<string, string>;
}

export function matchRoute(url: string, routes: RouteDef[]): MatchResult | null {
  const path = url.split("?")[0] ?? "/";
  const cleaned = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  for (const route of routes) {
    const m = patternToRegex(route.pattern).exec(cleaned);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      params[route.paramNames[i]!] = decodeURIComponent(m[i + 1] ?? "");
    }
    return { route, params };
  }
  return null;
}

function patternToRegex(pattern: string): RegExp {
  const parts = pattern.split("/").map((seg) => {
    if (!seg) return "";
    if (/^\[.+\]$/.test(seg)) return "([^/]+)";
    return escapeRegex(seg);
  });
  return new RegExp("^" + parts.join("/") + "$");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
