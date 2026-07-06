import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api → Rust backend on :3000.
// Production builds target the API server itself: `make build` emits the
// bundle with a /web/ base and the Rust server mounts frontend/dist there,
// so the app lives at http://127.0.0.1:3000/web (API calls stay same-origin
// under /api). Set VITE_API_BASE at build time to point elsewhere.

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/web/" : "/",
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
}));
