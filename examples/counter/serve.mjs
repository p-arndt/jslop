import { createServer } from "@rift/node-adapter";
import { render } from "./dist/server/entry-server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);

const server = createServer({
  render,
  clientDir: resolve(here, "dist/client"),
});

server.listen(port, () => {
  console.log(`rift counter listening on http://localhost:${port}`);
});
