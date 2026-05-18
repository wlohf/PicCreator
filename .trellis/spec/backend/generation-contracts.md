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
