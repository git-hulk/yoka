import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api → Rust backend on :3000.
// In production the same-origin assumption holds: serve the built bundle
// behind the same host as the API, or set VITE_API_BASE at build time.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
