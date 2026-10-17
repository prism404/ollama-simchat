import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.SIMCHAT_API_URL ?? "http://127.0.0.1:3000",
        timeout: 360000,
        proxyTimeout: 360000,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.SIMCHAT_API_URL ?? "http://127.0.0.1:3000",
        timeout: 360000,
        proxyTimeout: 360000,
      },
    },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
