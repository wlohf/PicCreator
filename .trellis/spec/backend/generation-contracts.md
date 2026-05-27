# Generation Contracts

> Backend and cross-layer contracts for image generation modes, result metadata, notes, and annotations.

---

## Scenario: Home Generation Modes, Tool Actions, And Result Notes

### 1. Scope / Trigger
- Trigger: generation requests cross frontend form state, FastAPI routes, service orchestration, pipeline mode selection, persistent result records, and result-library UI display.
- Applies when changing generation modes, explicit floor-plan tool actions, result metadata, result notes, source floor-plan links, or annotation/edit flows.

### 2. Signatures
- `POST /api/generate` accepts multipart form data with `mode` set to one of `standard`, `render3d`, or `colored_floor_plan`.
- The primary home mode selector exposes only `standard` and `render3d`.
- `colored_floor_plan` remains a supported API mode, but the frontend should trigger it through an explicit floor-plan tool action after a floor-plan attachment exists.
- `GET /api/results` returns persisted result records including mode, prompt/output metadata, optional `floor_plan_url`, and optional `notes`.
- `PUT /api/results/{result_id}/notes` updates notes for a stored result and returns the updated record.
- `GET /api/results/{result_id}/floor-plan` serves the stored source floor-plan artifact when the result was produced by a structured floor-plan mode.

### 3. Contracts
- `standard`: strict pass-through mode. User prompt is sent to image generation as-is. Do not run requirement parsing, floor-plan analysis, prompt compilation, or evaluation system prompts.
- `render3d`: structured floor-plan mode. Requires the existing floor-plan analysis and 3D prompt compilation path, and stores source floor-plan metadata for comparison.
- `colored_floor_plan`: structured floor-plan tool action. Uses the uploaded floor plan to produce a colored floor-plan output and stores source floor-plan metadata for comparison. Do not present it as a primary home generation mode.
- Quality review / iteration is optional strict review. It defaults off; when off, the first returned image is stored directly. When on, the vision evaluator may request additional passes up to `max_iterations`, but the UI must not promise guaranteed quality improvement.
- Structured modes should expose a floor-plan URL so the frontend can compare `source floor plan -> generated output`.
- Result notes are user-authored text metadata on the result record. Notes must not depend on authentication state.
- Annotation/image-edit flows may carry forward result and source floor-plan metadata, but must not require a user id in the main unauthenticated workflow.

### 4. Validation & Error Matrix
- Unknown `mode` -> reject with a client error before pipeline execution.
- `render3d` or `colored_floor_plan` without a source floor-plan image -> reject with a clear missing-input error.
- `colored_floor_plan` clicked while the composer is in edit-selected-result mode -> block in the frontend; it is only a new-generation floor-plan tool action.
- `standard` without images -> allowed when a prompt is present.
- `standard` with images -> allowed only when the configured image provider supports image inputs; otherwise return the existing provider capability error.
- Quality review disabled -> force the effective generation pass count to one for the current run.
- Quality review enabled -> allow the configured max-iteration value, subject to the normal upper bound and model-fallback rules.
- Notes update for a missing `result_id` -> return not found.
- Floor-plan fetch for a result without stored floor-plan artifact -> return not found.

### 5. Good / Base / Bad Cases
- Good: upload a floor plan, choose `render3d`, generate, then fetch results and see `floor_plan_url` plus editable notes.
- Good: upload a floor plan, click the colored-floor-plan tool action, and submit `mode=colored_floor_plan` while preserving the source floor-plan URL for comparison.
- Base: enter only text in `standard`, generate without any floor-plan analysis or prompt compilation.
- Bad: silently fall back from an unknown mode to `render3d`; this hides frontend/backend contract drift.
- Bad: putting `colored_floor_plan` back in the primary mode selector; this makes a low-frequency tool look like a main generation path.
- Bad: labeling strict review as guaranteed optimization; the evaluator is advisory and may be wrong.

### 6. Tests Required
- Backend API test asserting valid modes are accepted and invalid modes are rejected.
- Backend service or API test asserting structured-mode results expose source floor-plan URLs.
- Backend API test asserting notes persist through update and list/fetch responses.
- Pipeline policy test asserting `standard` bypasses floor-plan analysis, prompt compilation, and evaluation prompts.
- Frontend test asserting the primary mode selector exposes only `standard` and `render3d`.
- Frontend test/assertion proving the colored-floor-plan tool action submits `mode=colored_floor_plan` and remains tied to source result floor-plan metadata.
- Frontend test/assertion proving quality review defaults off and only enabled runs use the multi-pass value.
- Frontend build/typecheck must cover the shared mode union and result metadata fields.

### 7. Wrong vs Correct

#### Wrong

```python
# Unknown modes should not become render3d implicitly.
mode = form.mode or "render3d"
```

#### Correct

```python
# Keep the enum/validation boundary explicit so cross-layer drift fails fast.
mode = GenerationMode(form.mode)
```

#### Wrong

```typescript
// This turns a low-frequency floor-plan tool into a permanent primary mode.
const generationModeOptions = ["standard", "render3d", "colored_floor_plan"];
```

#### Correct

```typescript
// Primary modes stay focused; colored floor plans are triggered explicitly.
const generationModeOptions = ["standard", "render3d"];
runConversationFlow(undefined, "colored_floor_plan");
```

---

## Scenario: OpenAI Images API Text And Image Input Routing

### 1. Scope / Trigger
- Trigger: image provider adapter behavior crosses saved provider configuration, image generation pipeline inputs, verification probes, and frontend setup labels.
- Applies when changing OpenAI Images API-compatible adapters, provider capability detection, image API verification, or setup options for text-to-image and image-to-image providers.

### 2. Signatures
- OpenAI Images API-compatible providers use one Base URL and API key, then call provider endpoints through the OpenAI SDK.
- Text-only `PromptSet` input calls `client.images.generate(model, prompt, response_format="b64_json", n=1)`.
- `PromptSet.floor_plan` or `PromptSet.reference_image` calls `client.images.edit(model, image, prompt, response_format="b64_json", n=1)`.
- Frontend setup options must distinguish chat-compatible formats from Images API formats, including `openai_image` and `custom_openai_image`.

### 3. Contracts
- Do not require users to configure endpoint-specific URLs. Users provide the Base URL; the adapter chooses generate vs edit based on whether image bytes exist.
- `reference_image` is the preferred edit image when both `reference_image` and `floor_plan` are present, but generation metadata must preserve both `has_reference_image` and `has_floor_plan`.
- `generation_params.endpoint` must be `images.generate` for text-only calls and `images.edit` for image-input calls.
- `openai_image` and `custom_openai_image` support image inputs for `gpt-image-*` models because image edits are routed through `/images/edits`.
- `dall-e-2` and `dall-e-3` remain text-only, even if a config override claims image-input support.

### 4. Validation & Error Matrix
- Text-to-image verification failure -> report `文生图调用失败` with provider, format, model, Base URL, and original error.
- Image-input verification failure -> report `图生图/参考图调用失败` with the same adapter context.
- Image input with a text-only model chain -> return the existing no-compatible-model error before losing the image constraint.
- Saved `openai_image` / `custom_openai_image` format -> load back as the same UI value, not as generic `openai` / `custom`.

### 5. Good / Base / Bad Cases
- Good: configure Base URL plus API key with `OpenAI Images API`, set model `gpt-image-2`, verify both text-to-image and reference-image edit probes.
- Good: edit an existing result; the source result image is passed to `images.edit` and the returned `b64_json` is stored as a new result version.
- Base: default mode with only text still uses `images.generate`.
- Bad: route image-input prompts to `chat/completions` when the selected provider format is `openai_image`.
- Bad: collapse `openai_image` to `openai` when loading saved settings, because that hides the selected endpoint family.
- Bad: mark DALL-E models as image-input capable through a broad config override.

### 6. Tests Required
- Adapter test asserting text-only prompts call `images.generate`.
- Adapter tests asserting `reference_image` and `floor_plan` prompts call `images.edit`, decode `data[0].b64_json`, and set endpoint metadata.
- Capability tests asserting `openai_image` / `custom_openai_image` support `gpt-image-*` image inputs and reject DALL-E image inputs.
- Runtime verification tests asserting text and edit probes both run when image inputs are supported.
- Backend config tests asserting `openai_image` / `custom_openai_image` save and load without value collapse.
- Frontend build/typecheck covering setup option values.

### 7. Wrong vs Correct

#### Wrong

```python
# This loses the image constraint for Images API providers.
resp = await client.images.generate(model=model, prompt=prompt_text)
```

#### Correct

```python
if prompt.reference_image or prompt.floor_plan:
    resp = await client.images.edit(model=model, image=image_file, prompt=prompt_text)
else:
    resp = await client.images.generate(model=model, prompt=prompt_text)
```

---

## Scenario: API Config Model Detection

### 1. Scope / Trigger
- Trigger: model detection crosses frontend API setup state, FastAPI config routes, per-account config namespaces, remote provider `/models` responses, and composer model dropdown options.
- Applies when changing API config forms, model picker UI, config route signatures, account-specific API key behavior, or remote model-list parsing.

### 2. Signatures
- `POST /api/config/models-analysis` accepts form fields `provider_name`, `api_format`, `base_url`, `api_key`, and `model`.
- `POST /api/config/models-image` accepts the same form fields for image provider detection.
- Response success shape: `{"ok": true, "models": string[], "message": string}`.
- Response failure shape: `{"ok": false, "stage": "models-analysis" | "models-image", "error": string}`.
- Frontend client signature: `detectConfigModels(role: "analysis" | "image", apiConfig: ApiConfig): Promise<string[]>`.

### 3. Contracts
- The backend resolves the same authenticated/default config namespace as save/verify routes before merging form overrides.
- Detection must not require a non-empty model name; current model is only an override hint.
- OpenAI-compatible formats use the configured Base URL plus `/models` and bearer API key authentication.
- Anthropic uses `/v1/models` with `x-api-key` and `anthropic-version`.
- Model extraction accepts common response shapes: `data[]`, `models[]`, or `items[]`, and item keys `id`, `name`, or `model`.
- The returned list must be de-duplicated and sorted, and Gemini-style `models/<id>` names may be normalized to `<id>`.

### 4. Validation & Error Matrix
- Missing API format -> return a config error before any remote call.
- Unsupported API format -> return an explicit “暂未实现 ... 模型列表检测” error.
- Missing API key -> return the same account-aware key guidance as config verification.
- Azure OpenAI -> return a manual-entry guidance error because model listing depends on resource-specific API versions.
- Remote HTTP failure -> return `ok=false` with stage `models-analysis` or `models-image`.
- Empty or unrecognized response -> return a clear “模型列表接口返回为空” style error.

### 5. Good / Base / Bad Cases
- Good: user fills OpenAI-compatible Base URL and API key, clicks detect, and receives `["gpt-5.5", "gpt-image-2"]`.
- Good: authenticated user with saved API key can detect without exposing the key in `GET /api/config`.
- Base: provider does not support model listing; user can still manually type a model and verify/save it.
- Bad: frontend hard-codes `gpt-4o`/Claude/Gemini fallback options into the chat dropdown when the user only configured one model.
- Bad: detection mutates saved config; it should only return options until the user saves.

### 6. Tests Required
- Backend API test asserting `models-analysis` returns the model array and resolved user namespace.
- Unit test for model-id extraction covering duplicate ids and `models/<id>` normalization.
- Frontend/static test asserting composer options come from configured/detected models, not hard-coded chat defaults.
- Build/typecheck covering `ConfigRole`, `ConfigModelsResponse`, and model picker state.

### 7. Wrong vs Correct

#### Wrong

```typescript
const defaultChatModelOptions = ["gpt-4o", "claude-3-5-sonnet", "gemini-pro"];
const options = [apiConfig.analysisModel, ...defaultChatModelOptions];
```

#### Correct

```typescript
const options = modelSelectOptions(apiConfig.analysisModel, detectedModels.analysis);
```

#### Wrong

```python
# This forces users to enter a model before they can discover models.
_validate_adapter_config("分析模型", cfg)
```

#### Correct

```python
# Model listing validates provider format and key, but does not require cfg.model.
_validate_model_list_config("分析模型", cfg)
```

---

## Scenario: Account And Legacy Token Namespace Isolation

### 1. Scope / Trigger
- Trigger: unauthenticated workspace isolation crosses frontend session state, API client headers, FastAPI user resolution, preferences, generation writes, result listing, and result asset URLs.
- Applies when maintaining account sessions, backward-compatible non-session callers, tests, or legacy local namespace behavior.
- Account sessions are the primary frontend identity contract. Token namespaces are compatibility aliases for older/local callers.

### 2. Signatures
- The primary browser session cookie is `attuno_session`.
- `render_agent_session` is accepted only as a legacy cookie alias during the Attuno rename transition.
- Non-session compatibility API requests should send `X-Attuno-User-Token: <custom-token>`.
- `X-Render-Agent-User-Token: <custom-token>` is accepted only as a legacy header alias.
- Persistent data should use `ATTUNO_STUDIO_DATA_DIR` when an override is needed.
- `RENDER_AGENT_DATA_DIR` is accepted only as a legacy environment-variable alias when `ATTUNO_STUDIO_DATA_DIR` is absent.
- APIs that expose stored result assets may accept `user_id=<custom-token>` in the query string only for legacy/default namespace compatibility.
- `GET /api/preferences/shortcuts` returns shortcut phrases for the resolved namespace.
- `PUT /api/preferences/shortcuts` stores shortcut phrases for the resolved namespace.
- `POST /api/generate` writes generated result records under the resolved namespace.
- `GET /api/results` lists only records under the resolved namespace.
- `GET /api/results/{result_id}/image` and related asset endpoints must resolve the same namespace before serving artifacts.

### 3. Contracts
- Real account session cookies are the primary identity for the frontend app.
- `get_current_or_default_user(request)` must resolve an authenticated `attuno_session` before considering `X-Attuno-User-Token` or the legacy `X-Render-Agent-User-Token`.
- The frontend app must not send `X-Attuno-User-Token` or `X-Render-Agent-User-Token` for normal logged-in flows.
- Logged-in result asset URLs should rely on the session cookie and should not append `user_id=<current-user>`.
- Query `user_id` is allowed for browser-loaded assets and compatibility with existing default/legacy namespace URLs.
- If neither header nor query user id is present, the namespace resolves to `default`.
- A new token must behave like an empty workspace: no previous chat history, shortcuts, preferences, or results should appear.
- A reused token must reopen the same namespace: existing chat history, shortcuts, preferences, and results for that token should be visible.
- Token values are normalized through the backend user-id normalizer before filesystem/storage access.
- UI copy must not present the legacy token namespace as secure login, authorization, or access control.
- Registration must reject blank usernames and normalized `default`, because `default` is reserved for the local workspace and may keep special config/key behavior.

### 4. Validation & Error Matrix
- Logged-in request with both session cookie and `X-Attuno-User-Token` -> session user wins.
- Logged-in request with both session cookie and legacy `X-Render-Agent-User-Token` -> session user wins.
- Missing header/query on API request -> use `default` namespace for backward compatibility.
- Header and query both present -> resolve consistently with the backend namespace resolver; do not manually fork behavior per route.
- Asset request for a result id outside the active namespace -> return not found.
- Malformed or unusual token characters -> normalize to a safe user id before storage lookup.
- Registration username normalizes to `default` -> reject with a client error.

### 5. Good / Base / Bad Cases
- Good: logged-in user `alice` saves API keys and generates results; asset URLs open through cookie-authenticated `/api/results/<id>/image` without a `user_id` query.
- Good: legacy token `alpha` saves a shortcut, generates an image, reloads through a compatibility caller, and sees only `alpha` shortcuts and results.
- Base: no token is supplied by legacy callers, and APIs continue to use `default`.
- Bad: a logged-in request can be switched to another namespace by adding `X-Attuno-User-Token`.
- Bad: new code or tests use legacy `X-Render-Agent-User-Token`, `render_agent_session`, or `RENDER_AGENT_DATA_DIR` as the default path instead of covering them explicitly as compatibility aliases.
- Bad: token `beta` can list or fetch token `alpha` results by id.
- Bad: the frontend reintroduces the temporary access-token modal as the default identity flow.

### 6. Tests Required
- Backend API test proving two token namespaces do not share result listings or result assets.
- Backend API test proving two token namespaces do not share shortcut preferences.
- Backend API test proving generation writes use the active token namespace.
- Backend API test proving session identity wins over namespace headers.
- Backend API test proving `default` cannot be registered as a real account.
- Frontend test/build coverage proving paste/drag image handling remains available when the attachment button is removed.
- Frontend test proving logged-in/default result asset URL behavior does not append user ids for session users.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Logged-in users should not keep leaking their user id into asset URLs.
buildApiUrl(item.image_url, { user_id: currentUserId });
```

#### Correct

```typescript
// Session users rely on cookies; only default/legacy compatibility needs a query.
const includeNamespaceQuery = userId === "default";
resolveResultAssetUrl(item.image_url, userId, includeNamespaceQuery, buildApiUrl);
```

#### Wrong

```python
# Legacy namespace headers must not override a real session.
namespace_user = get_request_namespace_user(request)
if namespace_user:
    return namespace_user
```

#### Correct

```python
# Resolve the real account first; use namespace only for unauthenticated callers.
try:
    user = get_current_user(request)
except HTTPException:
    namespace_user = get_request_namespace_user(request)
    return namespace_user or get_default_local_user()
return {**user, "authenticated": True}
```

#### Wrong

```python
# New tests and runtime defaults should not keep the old product name primary.
monkeypatch.setenv("RENDER_AGENT_DATA_DIR", str(tmp_path / "data"))
headers = {"X-Render-Agent-User-Token": "alpha-token"}
```

#### Correct

```python
# Use Attuno names as the primary path; cover old names only in legacy tests.
monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
headers = {"X-Attuno-User-Token": "alpha-token"}
```

---

## Scenario: Editable Memory Preferences

### 1. Scope / Trigger
- Trigger: chat-derived preferences cross chat route memory extraction, preference storage, preferences API, and the frontend memory drawer.
- Applies when changing `/api/chat/memory`, `/api/preferences/memory`, preference summaries, or memory editing UI.

### 2. Signatures
- `POST /api/chat/memory` accepts `{ project_id, memory_candidate }` and persists only after the user explicitly confirms.
- `GET /api/preferences/memory?project_id=<id>` returns a grouped memory view plus the style profile.
- `PATCH /api/preferences/memory/{item_id}` accepts `{ text, project_id }` and returns the updated memory view.
- `DELETE /api/preferences/memory/{item_id}?project_id=<id>` removes an editable memory item and returns the updated memory view.

### 3. Contracts
- Memory writes from chat must remain manually confirmed. Do not silently save every chat message.
- Daily chat memory and image-prompt preferences are separate groups in the response.
- Editable memory item ids encode their backing store, such as `daily_memories:<id>` or `user_style_preferences.explicit:<index>`.
- Recent behavior-derived items may be shown read-only; they are derived from events and should not be edited as canonical preferences.
- Updating or deleting image preference memory must refresh the preference summary used by future prompt context.

### 4. Validation & Error Matrix
- Empty memory text on update -> 400.
- Unknown memory item id -> 404.
- Read-only/derived memory item id -> 404 or non-editable error.
- Missing project id -> use `default`.

### 5. Good / Base / Bad Cases
- Good: chat returns a memory candidate, user clicks Remember, then edits or deletes the item from the memory drawer.
- Base: no remembered preferences exist; the memory drawer shows an empty state.
- Bad: daily chat automatically writes personal facts without a visible confirmation action.
- Bad: editing a memory item changes only the UI and does not update backend preference summaries.

### 6. Tests Required
- Backend API test for view/edit/delete of memory items.
- Frontend build/typecheck for memory API types and UI state.
- Frontend behavior/unit test for preserving manual memory-write semantics where feasible.

### 7. Wrong vs Correct

#### Wrong

```typescript
// This turns every chat message into durable memory.
await applyChatMemory(projectId, response.memory_candidate);
```

#### Correct

```typescript
// The user explicitly chooses whether to persist the extracted candidate.
if (userClickedRemember && memoryCandidateHasEntries(response.memory_candidate)) {
  await applyChatMemory(projectId, response.memory_candidate);
}
```

---

## Scenario: Configured Daily Chat Routing

### 1. Scope / Trigger
- Trigger: daily chat crosses frontend composer state, `/api/chat`, authenticated config resolution, model-provider adapters, and memory/draft routing.
- Applies when changing daily-chat behavior, chat model controls, chat request payloads, or the relationship between normal chat and image-assist intent routing.

### 2. Signatures
- `POST /api/chat` accepts JSON with existing fields plus optional:
  - `api_config`: frontend `ApiConfig` subset for the active analysis provider (`analysisProviderName`, `analysisApiFormat`, `analysisBaseUrl`, `analysisApiKey`, `analysisModel`).
  - `reasoning_effort`: one of `low`, `medium`, or `high`.
- `POST /api/chat` returns the existing structured action response, with `reply` populated from the configured analysis chat model only when `suggested_action` is `chat`.
- Frontend daily chat calls `sendDesignChat({ api_config: apiConfig, reasoning_effort, context: { workspace_mode: "chat", ... } })`.

### 3. Contracts
- Daily chat is model-backed. If `DesignChatAgent` classifies a message as `daily_chat` and returns `suggested_action: "chat"`, the backend must build the analysis adapter for the resolved current user and call `llm.chat(...)`.
- Image-assist routing stays deterministic. If the message implies generation, edit, analysis, or remembering preferences, `/api/chat` must keep the structured `intent`, `suggested_action`, `draft_instruction`, `memory_candidate`, and `ui_hints` behavior and must not call the daily-chat model.
- Account identity wins over compatibility namespaces. For logged-in requests, config lookup must use `resolve_config_user_id(user)` after `get_current_or_default_user(...)` has resolved the real session, even if namespace headers are present.
- Non-default users must not inherit default workspace API keys. If a logged-in or token namespace user lacks its own analysis key, daily chat returns a clear `stage: "chat"` error instead of falling back to `.env` or default `config.json`.
- The frontend must render backend `reply` or an explicit error message. Do not synthesize fixed local fallback replies such as `收到。` for a successful `/api/chat` response.
- Composer model switching in chat mode updates `apiConfig.analysisModel`; image mode model switching continues to update the image model.

### 4. Validation & Error Matrix
- `daily_chat` with valid analysis config -> call configured analysis provider/model and return its text as `reply`.
- `daily_chat` with missing current-user API key -> `400 { ok: false, stage: "chat", error: ... }`.
- `daily_chat` model returns empty text -> `400 { ok: false, stage: "chat", error: "聊天模型返回为空" }`.
- Image/generation intent in chat workspace -> structured draft response; no model call.
- Logged-in request with spoofed namespace header -> session user's saved chat config is used.

### 5. Good / Base / Bad Cases
- Good: logged-in user saves `analysisModel=chat-model`, sends a normal chat message, and `/api/chat` calls `chat-model`.
- Good: user types "把这个空间画成温馨一点的效果图"; `/api/chat` returns a draft generation instruction without spending a model call on normal chat.
- Base: unauthenticated/default workspace can still use default config for backward-compatible local usage.
- Bad: daily chat keeps returning the deterministic `DesignChatAgent` sentence after API verification succeeded.
- Bad: frontend replaces a missing backend reply with a local fixed phrase, hiding chat route failures.
- Bad: a logged-in request can be redirected to a different namespace's key by adding `X-Attuno-User-Token`.

### 6. Tests Required
- Backend API test proving daily chat calls the configured analysis model and returns the adapter reply.
- Backend API test proving image/generation chat intents do not call the daily-chat model.
- Backend API test proving session identity wins over namespace headers for chat config lookup.
- Backend API test proving non-default users without their own key do not fall back to workspace keys.
- Frontend test proving `sendDesignChat` carries `api_config` and `reasoning_effort`.
- Frontend test proving the composer exposes provider/model/effort controls and no local fixed reply fallback.

### 7. Wrong vs Correct

#### Wrong

```python
# This leaves daily chat as a fixed router response even after API keys are configured.
result = DesignChatAgent().respond(data)
return result
```

#### Correct

```python
result = DesignChatAgent().respond(data)
if result.get("suggested_action") == "chat":
    result["reply"] = run_configured_daily_chat(payload, result, user)
return result
```

#### Wrong

```typescript
content: response.reply || "收到。"
```

#### Correct

```typescript
content: response.reply
```

---

## Scenario: Configured Daily Chat Streaming

### 1. Scope / Trigger
- Trigger: daily chat crosses frontend message rendering, `/api/chat/stream`, configured llm adapters, and the existing deterministic intent router.
- Applies when changing chat streaming UX, SSE event contracts, incremental reply rendering, or how non-chat intents behave in the chat workspace.

### 2. Signatures
- `POST /api/chat/stream` accepts the same JSON shape as `POST /api/chat`.
- `POST /api/chat/stream` returns `text/event-stream` with these events:
  - `meta`
  - repeated `delta`
  - terminal `complete`
  - terminal `error`
- Frontend chat mode calls `streamDesignChat({ api_config: apiConfig, reasoning_effort, context: { workspace_mode: "chat", ... } })`.

### 3. Contracts
- `DesignChatAgent` still routes first. Streaming does not bypass intent classification.
- If `suggested_action == "chat"`, the backend must stream the configured analysis-model reply through SSE and emit a final `complete` event containing the assembled `reply`.
- If `suggested_action != "chat"`, `/api/chat/stream` must not call the daily-chat model. It should emit a single `complete` event carrying the same structured routing payload shape as `/api/chat`.
- Frontend should append an assistant placeholder message immediately, then mutate that same message as `delta` chunks arrive.
- `complete` must carry the final assistant `reply` plus existing structured fields such as `draft_instruction`, `memory_candidate`, `context_summary`, and `ui_hints`.
- Errors must surface explicitly through `error` events and the frontend must show an error state/message instead of silently keeping an empty assistant bubble.
- Existing provider badge, chat-model switching, and reasoning-effort controls remain the source of truth for streamed chat requests.

### 4. Validation & Error Matrix
- Streamed `daily_chat` with valid config -> `meta`, one or more `delta`, then `complete`.
- Streamed `daily_chat` with missing current-user API key -> `error` event with `stage: "chat"`.
- Streamed `daily_chat` model returns no text -> `error` event with `聊天模型返回为空`.
- Streamed image/generation intent in chat workspace -> one `complete` event, no llm stream call.
- Client stream closes without `complete` -> frontend treats as failure and shows an explicit error.

### 5. Good / Base / Bad Cases
- Good: user types a normal project chat message and sees one assistant bubble fill in incrementally.
- Good: user types “把这个空间画成温馨一点的效果图” in chat mode and still gets a draft instruction without spending a chat-model call.
- Base: a provider without native stream support may still be chunked server-side, but the frontend contract stays SSE-based.
- Bad: `/api/chat/stream` calls the model before route classification; this wastes spend and breaks structured draft behavior.
- Bad: frontend appends multiple assistant bubbles for one streamed response.
- Bad: empty stream failures leave a blank assistant message with no explicit error.

### 6. Tests Required
- Backend API test proving streamed daily chat emits `meta` / `delta` / `complete`.
- Backend API test proving non-chat intents through `/api/chat/stream` do not call the daily-chat model and end with `complete`.
- Adapter/unit test proving stream parsers extract text deltas from supported OpenAI-compatible SSE payloads.
- Frontend test proving `runDailyChatFlow` uses the streaming chat client and updates one assistant message incrementally.

### 7. Wrong vs Correct

#### Wrong

```python
# This breaks draft routing by forcing all chat-workspace messages into the llm stream.
async for chunk in llm.stream_chat(messages):
    yield chunk
```

#### Correct

```python
routed = DesignChatAgent().respond(payload)
if routed["suggested_action"] != "chat":
    yield complete_event(routed)
else:
    async for chunk in llm.stream_chat(messages):
        yield delta_event(chunk)
```

---

## Scenario: Daily Chat Web Search And Stop

### 1. Scope / Trigger
- Trigger: daily chat crosses frontend streaming controls, `/api/chat` and `/api/chat/stream`, backend web search context injection, and configured analysis-model prompts.
- Applies when changing chat cancellation UX, chat SSE request options, search intent detection, or `web_search` response metadata.

### 2. Signatures
- `streamDesignChat(request, handlers, { signal })` accepts an optional `AbortSignal`.
- `POST /api/chat` and `POST /api/chat/stream` may include `web_search` in the response payload when the user explicitly asks to search.
- `web_search` shape: `{ query: string, results: { title: string, url: string, snippet: string }[], ok: boolean }`.
- Chat SSE keeps the existing event sequence and may include `web_search` on `meta` and terminal `complete`.

### 3. Contracts
- Chat busy state is scoped by session id. A streaming response in session A must not block creating, switching to, or sending chat in session B.
- The visible session's composer send button becomes a stop button while that same session is streaming.
- Stopping a chat uses `AbortController.abort()`, preserves already streamed text, clears that session's busy state, and must not show a backend failure message.
- Search is triggered only by explicit search/current-info intent such as “联网”, “搜索”, “查找”, “最新”, or “新闻”. Plain daily-chat phrases such as “今天聊聊” must not trigger web search.
- Search context is injected as a system message before calling the configured analysis adapter. Non-chat image/draft intents must not run web search.
- Search failure should surface as a chat/search failure or explicit degraded context; do not silently claim search was performed.

### 4. Validation & Error Matrix
- User aborts current stream -> frontend throws/handles `ChatStreamAbortedError`, keeps partial text or shows “已停止输出”.
- Session A streaming, session B visible -> session B send controls are not disabled by A.
- Search intent with results -> adapter receives system context containing search result title, URL, and snippet.
- Search intent with empty results -> model receives an explicit “联网搜索没有返回可用结果” context.
- Non-chat routed intent -> no search request and no analysis-model call.

### 5. Good / Base / Bad Cases
- Good: ask “联网搜索 Attuno 最新参考资料”; `meta.web_search.results` contains source URLs and the model receives the search summary.
- Good: stop a partially streamed answer; the partial answer remains and the same session can submit again.
- Base: ask “今天先正常聊聊项目节奏”; no search occurs.
- Bad: a global `isChatResponding` boolean disables all sessions while one chat streams.
- Bad: aborting a user-stopped stream renders a generic “聊天流连接已中断” error bubble.

### 6. Tests Required
- Frontend/static test asserting per-session responding state, `AbortController`, and stop-button wiring.
- Frontend/API test asserting `streamDesignChat` accepts abort options and normalizes abort errors.
- Backend API test asserting `/api/chat` injects web search context into adapter messages.
- Backend SSE test asserting `/api/chat/stream` emits `web_search` metadata in `meta` and preserves final reply.
- Existing daily-chat tests proving ordinary chat does not accidentally trigger search.

### 7. Wrong vs Correct

#### Wrong

```typescript
// This blocks every conversation tab/window.
const [isChatResponding, setIsChatResponding] = useState(false);
const canSubmitComposer = !isChatResponding && hasPromptText;
```

#### Correct

```typescript
const [chatRespondingSessionIds, setChatRespondingSessionIds] = useState<string[]>([]);
const isVisibleChatResponding = chatRespondingSessionIds.includes(currentSessionId);
const canSubmitChat = hasPromptText && !isVisibleChatResponding;
```

#### Wrong

```python
# Too broad: ordinary daily chat should not search.
SEARCH_INTENT_MARKERS = ("今天", "现在", "current")
```

#### Correct

```python
SEARCH_INTENT_MARKERS = ("联网", "搜索", "查找", "最新", "新闻")
```

---

## Scenario: API Config Provider Profiles

### 1. Scope / Trigger
- Trigger: API provider setup crosses browser-local `ApiConfig`, FastAPI config routes, per-account config JSON, environment-key fallback, runtime adapter selection, chat, generation, image edit, model verification, and model detection.
- Applies when changing provider setup fields, config save/load payloads, account namespacing, or adapter config loading.

### 2. Signatures
- `GET /api/config` returns the legacy flat fields plus provider profile fields:
  - `activeAnalysisProviderId: string`
  - `analysisProviders: ApiProviderProfile[]`
  - `activeImageProviderId: string`
  - `imageProviders: ApiProviderProfile[]`
- `ApiProviderProfile` fields are `id`, `providerName`, `apiFormat`, `baseUrl`, `apiKey`, and `model`.
- `POST /api/config/save` accepts existing flat form fields plus:
  - `analysis_providers_json`
  - `active_analysis_provider_id`
  - `image_providers_json`
  - `active_image_provider_id`
- Runtime config JSON stores profiles under adapter sections as `providers` plus `active_provider_id`.

### 3. Contracts
- The selected provider profile is mirrored into the existing flat fields (`analysisProviderName`, `analysisBaseUrl`, `imageApiKey`, etc.) before chat/generation/image-edit requests are sent.
- Backend save must preserve legacy section fields (`llm`, `vision`, `image_gen`) as the current selected profile for backwards compatibility.
- `vision` mirrors the active analysis provider; image generation keeps its own profile list.
- `config.py` must apply `active_provider_id` before building `AdapterConfig`, otherwise runtime calls ignore saved profile switching.
- Legacy config files with only flat adapter sections must load as a one-item provider profile list.
- Non-default users must not inherit default workspace keys. If they have no explicit key, both flat `api_key` and nested provider `api_key` values are cleared in effective config.

### 4. Validation & Error Matrix
- Invalid provider JSON -> return `/api/config/save` failure with a clear JSON format error.
- Provider list is absent or empty -> keep legacy flat behavior and synthesize one profile for UI load.
- Active provider id missing from list -> fall back to the first provider profile.
- Duplicate provider ids in save payload -> keep the first occurrence and ignore later duplicates.
- Non-dict provider entries -> ignore them instead of crashing config load.

### 5. Good / Base / Bad Cases
- Good: user saves two analysis providers and two image providers, selects provider B, reloads, and all calls use B without retyping key/Base URL/model.
- Good: old `config.json` without `providers` still appears as one editable provider profile.
- Base: user only changes the current provider fields; flat fields and active profile remain synchronized.
- Bad: storing profiles only in frontend localStorage; the backend then loses them on another browser or after reload.
- Bad: changing the profile selector without syncing flat fields; generation/chat requests would still use the previous provider.
- Bad: applying nested default-user provider keys to a logged-in user namespace that has not saved its own key.

### 6. Tests Required
- Backend unit test for legacy section -> one UI provider profile.
- Backend unit test for save round-trip with multiple provider profiles and active id.
- Backend config test proving `active_provider_id` affects `build_config_from_dict`.
- Frontend build/typecheck covering `ApiProviderProfile` and `ApiConfig` additions.
- Frontend/API client test or static assertion that save sends both profile JSON and active ids.

### 7. Wrong vs Correct

#### Wrong

```typescript
// This changes visible state but leaves requests using the old flat fields.
setApiConfig({ ...apiConfig, activeAnalysisProviderId: nextId });
```

#### Correct

```typescript
const provider = apiConfig.analysisProviders.find((item) => item.id === nextId);
setApiConfig(applyProviderProfile(apiConfig, "analysis", provider));
```

#### Wrong

```python
# This ignores active_provider_id during runtime config loading.
api_format = d.get("api_format")
```

#### Correct

```python
d = active_provider_overlay(d)
api_format = d.get("api_format")
```
