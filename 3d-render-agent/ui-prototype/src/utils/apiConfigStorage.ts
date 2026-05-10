export const API_CONFIG_STORAGE_BASE_KEY = "render-director-api-config-v1";

export function apiConfigStorageKey(userId: string) {
  const normalized = userId.trim();
  return normalized ? `${API_CONFIG_STORAGE_BASE_KEY}:${normalized}` : API_CONFIG_STORAGE_BASE_KEY;
}
