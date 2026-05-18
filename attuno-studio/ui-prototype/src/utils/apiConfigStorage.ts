export const API_CONFIG_STORAGE_BASE_KEY = "attuno-api-config-v1";
export const LEGACY_API_CONFIG_STORAGE_BASE_KEY = "render-director-api-config-v1";

function scopedStorageKey(baseKey: string, userId: string) {
  const normalized = userId.trim();
  return normalized ? `${baseKey}:${normalized}` : baseKey;
}

export function apiConfigStorageKey(userId: string) {
  return scopedStorageKey(API_CONFIG_STORAGE_BASE_KEY, userId);
}

export function legacyApiConfigStorageKey(userId: string) {
  return scopedStorageKey(LEGACY_API_CONFIG_STORAGE_BASE_KEY, userId);
}

export function apiConfigStorageReadKeys(userId: string) {
  return [apiConfigStorageKey(userId), legacyApiConfigStorageKey(userId)];
}
