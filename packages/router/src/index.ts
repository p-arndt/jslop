import { readdir, stat } from "node:fs/promises";
import { join, relative, sep, posix, basename, extname } from "node:path";

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
}

/**
 * Walk a routes directory and produce a deterministic, more-specific-first list of routes.
 */
export async function scanRoutes(routesDir: string): Promise<RouteDef[]> {
  const out: RouteDef[] = [];
  await walk(routesDir, routesDir, out);
  out.sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
  return out;
}

async function walk(rootDir: string, current: string, out: RouteDef[]): Promise<void> {
  const entries = await readdir(current);
  for (const entry of entries) {
    const full = join(current, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      await walk(rootDir, full, out);
      continue;
    }
    if (extname(entry) !== ".rift") continue;

    const rel = relative(rootDir, full).split(sep).join(posix.sep);
    const noExt = rel.slice(0, -".rift".length);
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
    out.push({
      pattern: cleanPattern,
      paramNames,
      relPath: rel,
      compiledRelPath: noExt + ".compiled.mjs",
      identifier: identifierOf(noExt),
    });
  }
}

function toUrlSegment(seg: string): string {
  return seg;
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
