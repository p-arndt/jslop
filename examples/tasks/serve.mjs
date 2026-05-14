/**
 * Custom serve.mjs that wraps @jslop/node-adapter and adds REST /api/* routes
 * for the CRUD demo. JSlop doesn't have a server-action primitive yet, so
 * mutations are plain HTTP endpoints driven from src/api.js.
 */
import { createHandler } from "@jslop/node-adapter";
import { render } from "./dist/server/entry-server.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
} from "./src/store.js";
import { createServer as createHttpServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

const ssrHandler = createHandler({
  render,
  clientDir: resolve(here, "dist/client"),
});

async function readJson(req) {
  return await new Promise((res, rej) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const txt = Buffer.concat(chunks).toString("utf8");
      if (!txt) return res({});
      try { res(JSON.parse(txt)); }
      catch (e) { rej(e); }
    });
    req.on("error", rej);
  });
}

function send(res, status, body, type = "application/json") {
  res.statusCode = status;
  res.setHeader("content-type", `${type}; charset=utf-8`);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function apiHandler(req, res, pathname) {
  // GET /api/tasks
  if (req.method === "GET" && pathname === "/api/tasks") {
    return send(res, 200, await listTasks());
  }
  // POST /api/tasks
  if (req.method === "POST" && pathname === "/api/tasks") {
    try {
      const body = await readJson(req);
      const task = await createTask(body);
      return send(res, 201, task);
    } catch (err) {
      return send(res, 400, { error: String(err.message ?? err) });
    }
  }
  // /api/tasks/:id
  const m = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
  if (m) {
    const id = m[1];
    if (req.method === "GET") {
      const task = await getTask(id);
      if (!task) return send(res, 404, { error: "not found" });
      return send(res, 200, task);
    }
    if (req.method === "PATCH") {
      try {
        const body = await readJson(req);
        const task = await updateTask(id, body);
        if (!task) return send(res, 404, { error: "not found" });
        return send(res, 200, task);
      } catch (err) {
        return send(res, 400, { error: String(err.message ?? err) });
      }
    }
    if (req.method === "DELETE") {
      const ok = await deleteTask(id);
      if (!ok) return send(res, 404, { error: "not found" });
      res.statusCode = 204;
      return res.end();
    }
  }
  return null;
}

const server = createHttpServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0] || "/";
    if (pathname.startsWith("/api/")) {
      const handled = await apiHandler(req, res, pathname);
      if (handled !== null) return;
      return send(res, 404, { error: "not found" });
    }
    return ssrHandler(req, res);
  } catch (err) {
    console.error("[serve] error:", err);
    send(res, 500, { error: "internal server error" });
  }
});

server.listen(port, () => {
  console.log(`tasks app listening on http://localhost:${port}`);
});
