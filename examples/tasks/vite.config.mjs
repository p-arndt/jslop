import { defineConfig } from "vite";
import jslop from "@jslop/vite";

// All mutations are declared as `action` blocks inside the .jslop routes;
// the framework handles POST dispatch in both dev and prod. No hand-rolled
// /api/* middleware needed.
export default defineConfig({
  plugins: [
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
