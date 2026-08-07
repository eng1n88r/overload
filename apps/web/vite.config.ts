import { fileURLToPath, URL } from "url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";

// https://vitejs.dev/config/
export default defineConfig({
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
