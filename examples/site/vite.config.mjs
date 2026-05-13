import { defineConfig } from "vite";
import jslop from "@jslop/vite";

export default defineConfig({
  plugins: [
    jslop({
      tailwind: true,
      css: "/src/app.css",
    }),
  ],
});
