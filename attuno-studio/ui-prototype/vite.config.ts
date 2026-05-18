import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

const host = "0.0.0.0";
const port = Number(process.env.VITE_PORT ?? 5174);
const apiTarget = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8787";
let apiProxyWarningShown = false;
let apiHealthyUntil = 0;

async function isApiAvailable() {
  const now = Date.now();
  if (apiHealthyUntil > now) {
    return true;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${apiTarget}/api/health`, { signal: controller.signal });
    if (response.ok) {
      apiHealthyUntil = now + 1000;
      return true;
    }
  } catch {
    // Handled by the caller with a compact 503 response.
  } finally {
    clearTimeout(timeout);
  }
  return false;
}

function writeApiUnavailableResponse(error: Error, req: IncomingMessage, res: ServerResponse) {
  if (!apiProxyWarningShown) {
    console.warn(`[vite] API backend is not reachable at ${apiTarget}. Start the API with "python api_server.py" or use start_attuno_studio.bat.`);
    apiProxyWarningShown = true;
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(503, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    ok: false,
    error: "API backend is not reachable",
    detail: error.message,
    path: req.url
  }));
}

async function bypassUnavailableApi(req: IncomingMessage, res?: ServerResponse) {
  if (await isApiAvailable()) {
    return undefined;
  }
  if (res) {
    writeApiUnavailableResponse(new Error(`connect ECONNREFUSED ${apiTarget}`), req, res);
    return req.url ?? "/";
  }
  return false;
}

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    allowedHosts: true,
    port,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        timeout: 15 * 60 * 1000,
        proxyTimeout: 15 * 60 * 1000,
        bypass: bypassUnavailableApi,
        configure(proxy) {
          proxy.on("error", writeApiUnavailableResponse);
        }
      }
    }
  },
  preview: {
    host,
    allowedHosts: true,
    port
  }
});
