const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
let apiUserNamespace = "";

export function setApiUserNamespace(userId: string) {
  apiUserNamespace = userId.trim();
}

export function buildApiUrl(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const queryEntries = Object.entries(query || {}).filter(([, value]) => value !== undefined && value !== "");
  if (queryEntries.length === 0) {
    return `${apiBaseUrl}${normalizedPath}`;
  }
  const search = new URLSearchParams(queryEntries.map(([key, value]) => [key, String(value)]));
  return `${apiBaseUrl}${normalizedPath}?${search.toString()}`;
}

export function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (apiUserNamespace) {
    headers.set("X-Render-Agent-User-Token", apiUserNamespace);
  }
  return fetch(buildApiUrl(input), {
    credentials: "include",
    ...init,
    headers,
  });
}

export async function parseApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return (await response.json()) as T;
}
