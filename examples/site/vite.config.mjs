import { defineConfig } from "vite";
import rift from "@rift/vite";

export default defineConfig({
  plugins: [
    rift({
      tailwind: true,
      css: "/src/app.css",
    }),
  ],
});
