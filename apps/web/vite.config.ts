import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";

// https://vitejs.dev/config/
// Single source of truth for the version shown in the footer: the root
// package.json, baked in at build time.
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [vue(), vueJsx()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['vue-demi']
  },
  test: {
    // Unit tests live in src/. Without this, vitest also globs cypress/, whose
    // specs are Cypress's to run and whose tsconfig it cannot resolve.
    include: ["src/**/*.{test,spec}.{js,ts}"],
    environment: "jsdom",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/mcp": "http://127.0.0.1:3001",
      "/img": "http://127.0.0.1:3001",
    },
  },
});
