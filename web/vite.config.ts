import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        // SSE: never time out the long-lived stream, and make sure nothing buffers or compresses it.
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on("proxyRes", (res) => {
            if (String(res.headers["content-type"] ?? "").includes("text/event-stream")) {
              res.headers["cache-control"] = "no-cache, no-transform";
              res.headers["x-accel-buffering"] = "no";
              delete res.headers["content-length"];
            }
          });
        },
      },
    },
  },
});
