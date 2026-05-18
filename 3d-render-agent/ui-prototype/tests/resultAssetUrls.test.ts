import { resolveResultAssetUrl, shouldIncludeResultNamespaceQuery } from "../src/utils/resultAssetUrls.js";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const entries = Object.entries(query || {}).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) return path;
  return `${path}?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}

assert(!shouldIncludeResultNamespaceQuery("alice"), "logged-in users should rely on the session cookie for result assets");
assert(shouldIncludeResultNamespaceQuery("default"), "default compatibility requests may use the legacy namespace query");

assert(
  resolveResultAssetUrl("/api/results/result-1/image", "alice", false, buildUrl) === "/api/results/result-1/image",
  "logged-in asset URL should not append a namespace query",
);
assert(
  resolveResultAssetUrl("/api/results/result-1/image", "alice", true, buildUrl) === "/api/results/result-1/image?user_id=alice",
  "legacy namespace asset URL should still support a user_id query",
);
