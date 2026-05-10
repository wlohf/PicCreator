import { apiFetch, parseApiJson } from "./client";

export type AuthUser = {
  user_id: string;
  username: string;
};

export type AuthMeResponse = {
  ok: boolean;
  authenticated: boolean;
  has_users: boolean;
  user: AuthUser | null;
};

type AuthMutationResponse = {
  ok: boolean;
  user?: AuthUser;
  error?: string;
  detail?: string;
};

async function authMutation(path: string, username: string, password: string): Promise<AuthMutationResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await parseApiJson<AuthMutationResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data;
}

export async function loadAuthMe(): Promise<AuthMeResponse> {
  const response = await apiFetch("/api/auth/me");
  const data = await parseApiJson<AuthMeResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(response.statusText);
  }
  return data;
}

export async function login(username: string, password: string) {
  return authMutation("/api/auth/login", username, password);
}

export async function register(username: string, password: string) {
  return authMutation("/api/auth/register", username, password);
}

export async function logout(): Promise<void> {
  const response = await apiFetch("/api/auth/logout", { method: "POST" });
  const data = await parseApiJson<{ ok: boolean; error?: string }>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
}
