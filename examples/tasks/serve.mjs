/**
 * Production serve entry. All mutations are declared as `action` blocks
 * inside the .jslop routes — the node adapter forwards POSTs carrying the
 * `x-jslop-action` header to executeAction, which dispatches to the right
 * server-side action body. No /api/* handlers needed.
 */
import { createServer } from "@jslop/node-adapter";
import { render, executeAction } from "./dist/server/entry-server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

const server = createServer({
  render,
  executeAction,
  clientDir: resolve(here, "dist/client"),
});

server.listen(port, () => {
  console.log(`tasks app listening on http://localhost:${port}`);
});
