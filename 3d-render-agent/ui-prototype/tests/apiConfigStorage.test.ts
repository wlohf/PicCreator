import { API_CONFIG_STORAGE_BASE_KEY, apiConfigStorageKey } from "../src/utils/apiConfigStorage.js";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(apiConfigStorageKey("") === API_CONFIG_STORAGE_BASE_KEY, "default namespace should keep the legacy config key");
assert(apiConfigStorageKey("   ") === API_CONFIG_STORAGE_BASE_KEY, "blank namespace should keep the legacy config key");
assert(
  apiConfigStorageKey("alpha-token") === `${API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
  "named token should use a token-scoped config key",
);
assert(
  apiConfigStorageKey(" alpha-token ") === `${API_CONFIG_STORAGE_BASE_KEY}:alpha-token`,
  "storage key should trim token whitespace",
);
