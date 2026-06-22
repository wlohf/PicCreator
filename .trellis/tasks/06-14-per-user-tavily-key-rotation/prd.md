# Per-user Tavily Key Rotation

## Goal

Add support for each logged-in user to configure multiple Tavily API keys and have web search use them in round-robin order. Key pools and rotation state must be isolated per user so one account never consumes another account's keys.

## What I already know

* The user wants to provide multiple Tavily keys and use them one by one.
* The user explicitly called out that keys belong to each logged-in user and must not be shared through a global pool.
* The current backend web search implementation lives in `attuno-studio/backend/app/services/web_search.py` and uses DuckDuckGo HTML scraping only.
* Chat routes call `_with_web_search_context()` before model chat and currently do not pass the authenticated user id into `build_web_search_context()`.
* Model/API provider settings are already stored through `/api/config` and resolved per logged-in user using `resolve_config_user_id(user)`.
* UI config is typed in `attuno-studio/ui-prototype/src/types/domain.ts`, normalized in `App.tsx`, saved through `src/api/config.ts`, and cached per user in localStorage.
* User-provided key examples must not be committed to source, tests, PRDs, or generated config files.

## Requirements

* Add a user-level Tavily key list field to the existing config flow.
* Accept multiple keys pasted as newline, comma, semicolon, or whitespace separated input, normalize them to a de-duplicated list, and store only non-empty values.
* Web search should prefer Tavily when the current user's Tavily key list is non-empty.
* Tavily calls must rotate keys per user: request N uses key index N, request N+1 uses the next key, wrapping at the end.
* Rotation state must be persisted in that user's config or user-scoped data, not held only in process memory and not shared globally.
* If a Tavily key fails due to auth/quota/rate-limit/server/network error, try the next configured key during the same search request before returning failure.
* If all Tavily keys fail, fall back to the existing DuckDuckGo implementation so chat can still attempt web search.
* The chat response metadata should still include query/results/ok as it does today; no key material may be returned to the frontend except the saved settings field in the authenticated user's config load.
* Frontend settings should expose a Tavily API keys textarea in the existing settings/config surface and save/load it with the rest of API config.
* Existing logged-in user isolation must remain intact for chat history, results, and provider config.

## Acceptance Criteria

* [ ] User A and User B can save different Tavily key lists; loading config for each returns only that user's own list.
* [ ] A user with keys `k1`, `k2`, `k3` sees web search attempt keys in round-robin order across repeated searches.
* [ ] The rotation pointer advances only inside that user's namespace.
* [ ] If the selected key fails, the search attempts the next configured key before falling back.
* [ ] If no Tavily keys are configured, current DuckDuckGo behavior still works.
* [ ] No committed file contains the real keys pasted in the chat.
* [ ] Backend tests cover normalization, per-user persistence, round-robin selection, and fallback behavior.
* [ ] Frontend type/API save path includes the Tavily key field without breaking existing config storage.

## Definition of Done

* Tests added/updated for backend behavior and frontend config serialization where practical.
* Lint/typecheck/test commands run for touched layers, or limitations reported.
* No unrelated dirty files are reverted or included silently.
* Sensitive API keys are not committed.

## Technical Approach

Use the existing per-user config system rather than introducing a global key manager. Store `web_search.tavily_api_keys` and `web_search.tavily_next_key_index` in each user's effective config JSON. Add helper functions in `app_runtime.py` or a small backend service to normalize keys, load the current user's web-search config, and atomically advance the pointer. Update `web_search.py` to call Tavily's search endpoint with the next user-scoped key, trying each configured key at most once per request. Keep the current DuckDuckGo scraper as the fallback provider.

Data flow:

Frontend settings textarea -> `/api/config/save` form field -> user config JSON `web_search` section -> chat route passes `resolve_config_user_id(user)` -> web search service obtains/advances that user's Tavily key -> Tavily results normalized to the existing `{title, url, snippet}` contract -> chat metadata unchanged.

## Decision (ADR-lite)

**Context**: Multiple Tavily keys can improve quota availability, but using a single global key pool would leak one user's capacity to another user and break account isolation.

**Decision**: Implement a per-user key pool and persistent round-robin pointer inside the existing user config namespace. Prefer Tavily when configured, keep DuckDuckGo as fallback.

**Consequences**: The implementation has to write config during search to advance the pointer, so tests should cover per-user pointer updates and concurrent safety as far as the current file-based config model allows. The frontend remains simple: it only edits a textarea, while the backend owns normalization and rotation.

## Out of Scope

* Encrypting keys at rest.
* Admin-shared/global Tavily key pool.
* Per-key health dashboard or usage quota display.
* Supporting arbitrary third-party search providers beyond Tavily and the existing DuckDuckGo fallback.
* Validating the pasted Tavily keys by making a test request from the settings form.

## Technical Notes

* Existing web search service: `attuno-studio/backend/app/services/web_search.py`.
* Chat integration: `attuno-studio/backend/app/routes/chat.py`.
* Per-user config save/load: `attuno-studio/app_runtime.py`, `attuno-studio/backend/app/routes/config.py`.
* Frontend config API: `attuno-studio/ui-prototype/src/api/config.ts`.
* Frontend config type/default/normalization: `attuno-studio/ui-prototype/src/types/domain.ts`, `attuno-studio/ui-prototype/src/data/studioData.ts`, `attuno-studio/ui-prototype/src/App.tsx`.
* Relevant specs: `.trellis/spec/backend/index.md`, `.trellis/spec/frontend/index.md`, `.trellis/spec/guides/cross-layer-thinking-guide.md`, `.trellis/spec/guides/code-reuse-thinking-guide.md`.
