import { defineConfig } from "vite";
import jslop from "@jslop/vite";

export default defineConfig({
  plugins: [
    jslop({
      tailwind: true,
      css: "/src/app.css",
      title: (url) => {
        if (url === "/") return "Neon Lab — live mixer";
        if (url === "/presets") return "Neon Lab — presets";
        if (url.startsWith("/presets/")) return `Neon Lab — ${url.slice(9)}`;
        if (url === "/about") return "Neon Lab — about";
        return "Neon Lab";
      },
    }),
  ],
});
