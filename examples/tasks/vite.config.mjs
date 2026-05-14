import { defineConfig } from "vite";
import jslop from "@jslop/vite";

/**
 * Tiny dev-mode middleware that serves the same /api/* routes as serve.mjs.
 * In production those endpoints live in serve.mjs (which wraps the node
 * adapter); in dev, vite owns the server, so we add an SSR-time middleware
 * here. Both code paths import the same src/store.js so behaviour stays
 * identical between `pnpm dev` and `pnpm build && pnpm serve`.
 */
const apiPlugin = {
  name: "tasks:api-dev",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] || "/";
      if (!pathname.startsWith("/api/")) return next();
      try {
        const store = await server.ssrLoadModule("/src/store.js");
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        };
        const readJson = () =>
          new Promise((resolve, reject) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
              const txt = Buffer.concat(chunks).toString("utf8");
              if (!txt) return resolve({});
              try { resolve(JSON.parse(txt)); }
              catch (e) { reject(e); }
            });
            req.on("error", reject);
          });

        if (req.method === "GET" && pathname === "/api/tasks") {
          return send(200, await store.listTasks());
        }
        if (req.method === "POST" && pathname === "/api/tasks") {
          try {
            const body = await readJson();
            return send(201, await store.createTask(body));
          } catch (err) {
            return send(400, { error: String(err.message ?? err) });
          }
        }
        const m = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
        if (m) {
          const id = m[1];
          if (req.method === "GET") {
            const t = await store.getTask(id);
            if (!t) return send(404, { error: "not found" });
            return send(200, t);
          }
          if (req.method === "PATCH") {
            try {
              const body = await readJson();
              const t = await store.updateTask(id, body);
              if (!t) return send(404, { error: "not found" });
              return send(200, t);
            } catch (err) {
              return send(400, { error: String(err.message ?? err) });
            }
          }
          if (req.method === "DELETE") {
            const ok = await store.deleteTask(id);
            if (!ok) return send(404, { error: "not found" });
            res.statusCode = 204;
            return res.end();
          }
        }
        return send(404, { error: "not found" });
      } catch (err) {
        console.error("[api-dev] error:", err);
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: String(err.message ?? err) }));
      }
    });
  },
};

export default defineConfig({
  plugins: [
    apiPlugin,
    jslop({
      tailwind: true,
      css: "/src/app.css",
      title: (url) => {
        if (url === "/") return "Stack";
        if (url === "/about") return "Stack — about";
        if (url.startsWith("/tasks/")) return "Stack — task";
        return "Stack";
      },
    }),
  ],
});
