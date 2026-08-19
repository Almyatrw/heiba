import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Same-origin in production (the API server serves the built assets); in dev
// Vite proxies /api to the API server. Override with API_PROXY_TARGET.
const proxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";
const port = Number(process.env.PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port,
    host: true,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: false,
      },
    },
  },
  preview: {
    port,
    host: true,
  },
});
