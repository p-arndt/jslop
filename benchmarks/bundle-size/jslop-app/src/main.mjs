// Mirrors what @jslop/vite's virtual:jslop-client emits in dev:
// pull in @jslop/client's boot and register every route component so the
// SSR-emitted capsule can be matched at boot time.
import { boot } from "@jslop/client";
import Index from "./routes/index.jslop";

boot({
  [Index.name]: Index,
});
