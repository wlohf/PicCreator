import { apiFetch, parseApiJson } from "./client";
import type { SystemUpdateStatus } from "../types/domain";

export type UpdateAdminCredentials = {
  username: string;
  password: string;
};

function authHeader(credentials: UpdateAdminCredentials) {
  return `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
}

async function requestUpdateStatus(path: string, method: "GET" | "POST", credentials: UpdateAdminCredentials): Promise<SystemUpdateStatus> {
  const response = await apiFetch(path, {
    method,
    headers: {
      Authorization: authHeader(credentials),
    },
  });
  const data = await parseApiJson<SystemUpdateStatus | { detail?: string }>(response);
  if (!response.ok) {
    throw new Error("detail" in data && data.detail ? data.detail : response.statusText);
  }
  return data as SystemUpdateStatus;
}

export function getSystemUpdateStatus(credentials: UpdateAdminCredentials) {
  return requestUpdateStatus("/api/system/update/status", "GET", credentials);
}

export function checkSystemUpdate(credentials: UpdateAdminCredentials) {
  return requestUpdateStatus("/api/system/update/check", "POST", credentials);
}

export function applySystemUpdate(credentials: UpdateAdminCredentials) {
  return requestUpdateStatus("/api/system/update/apply", "POST", credentials);
}
