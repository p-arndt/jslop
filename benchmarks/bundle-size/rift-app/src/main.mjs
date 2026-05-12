// Mirrors what @rift/vite's virtual:rift-client emits in dev:
// pull in @rift/client's boot and register every route component so the
// SSR-emitted capsule can be matched at boot time.
import { boot } from "@rift/client";
import Index from "./routes/index.rift";

boot({
  [Index.name]: Index,
});
