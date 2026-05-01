import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = "0.0.0.0";
const port = Number(process.env.VITE_PORT ?? 5174);
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    allowedHosts: true,
    port,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    host,
    allowedHosts: true,
    port
  }
});
