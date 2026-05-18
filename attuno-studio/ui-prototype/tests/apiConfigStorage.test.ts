import {
  API_CONFIG_STORAGE_BASE_KEY,
  LEGACY_API_CONFIG_STORAGE_BASE_KEY,
  apiConfigStorageKey,
  apiConfigStorageReadKeys,
  legacyApiConfigStorageKey,
} from "../src/utils/apiConfigStorage.js";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(API_CONFIG_STORAGE_BASE_KEY === "attuno-api-config-v1", "primary config key should use Attuno branding");
assert(LEGACY_API_CONFIG_STORAGE_BASE_KEY === "render-director-api-config-v1", "legacy config key should remain readable");
assert(apiConfigStorageKey("") === API_CONFIG_STORAGE_BASE_KEY, "default namespace should use the primary config key");
assert(apiConfigStorageKey("   ") === API_CONFIG_STORAGE_BASE_KEY, "blank namespace should use the primary config key");
assert(
  apiConfigStorageKey("alpha-token") === `${API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
  "named token should use a token-scoped config key",
);
assert(
  apiConfigStorageKey(" alpha-token ") === `${API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
  "storage key should trim token whitespace",
);
assert(
  legacyApiConfigStorageKey(" alpha-token ") === `${LEGACY_API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
  "legacy storage key should trim token whitespace",
);
assert(
  JSON.stringify(apiConfigStorageReadKeys("alpha-token")) === JSON.stringify([
    `${API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
    `${LEGACY_API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
  ]),
  "read keys should try Attuno first and legacy render-director second",
);
