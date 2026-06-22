# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

(To be filled by the team)

---

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

(To be filled by the team)

---

## API Error Responses

<!-- Standard error response format -->

### Scenario: 聊天联网搜索诊断

#### 1. Scope / Trigger

- Trigger: `/api/chat` 和 `/api/chat/stream` 在普通聊天中触发联网搜索，搜索链路会访问 Tavily 和 DuckDuckGo fallback，容易出现 key 缺失、鉴权失败、限流、超时、网络出口不可达、查询过短等问题。

#### 2. Signatures

- Decision helper: `should_use_web_search(message, context)` returns `bool`.
- Context builder: `build_web_search_context_detailed(message, user_id, context, suggested_query)` returns a dict with `query`, `ok`, `provider`, `results`, `diagnostics`, `context`, `answer`, `search_profile`, and `search_parameters`.
- Route metadata field: `web_search = {"query", "results", "ok", "provider", "answer", "search_profile", "search_parameters", "diagnostics", "decision"}`.

#### 3. Contracts

- Explicit search words and time-sensitive model/product/version questions should trigger search before final model response.
- Time-sensitive model/product/version/release questions should use an enhanced Tavily profile instead of basic-only search: more results, `advanced` search depth, recent time filtering, Tavily answer, and raw content when Tavily supports it.
- If rules do not trigger, the chat route may call the configured chat model with a short JSON-only classifier prompt to decide whether search is needed.
- Search failures must be converted into diagnostic system context for the final chat model. The final model must not claim that Attuno has no internet capability when the search service was attempted.
- Diagnostics must never include raw API keys.

#### 4. Validation & Error Matrix

- Empty/ambiguous query -> `query_empty`, ask for or derive a clearer query from context.
- No Tavily key for current account -> `missing_api_key`, tell the user to configure Tavily API Keys in settings while still trying DuckDuckGo fallback.
- Tavily HTTP 401/403 -> `auth_failed`, key may be invalid or unauthorized.
- Tavily HTTP 429 -> `rate_limited`, key may be rate-limited or out of quota.
- Provider timeout -> `timeout`, suggest retrying or checking network.
- Provider request failure -> `network_error`, network exit or provider access may be blocked.
- Provider success with no parsed results -> `empty_results`, suggest a clearer query or fallback provider.

#### 5. Good/Base/Bad Cases

- Good: Tavily succeeds; `web_search.ok=true`, `provider="tavily"`, and source snippets are injected into chat context.
- Base: Tavily has no key or fails; DuckDuckGo succeeds and metadata reports `provider="duckduckgo"`.
- Bad: Both providers fail and the assistant says "我不能联网" instead of explaining the concrete diagnostic and next action.

#### 6. Tests Required

- Unit tests for keyword/time-sensitive detection and context-inherited short follow-ups.
- Unit tests for enhanced Tavily profile selection and search context evidence injection.
- Unit tests for Tavily failure categorization and DuckDuckGo fallback behavior.
- API route tests for explicit-search injection and AI-classifier-triggered search.
- Stream route tests that verify `web_search` progress/meta still appears when search is triggered.

#### 7. Wrong vs Correct

Wrong:

```python
except Exception:
    return []
```

Correct:

```python
except httpx.HTTPStatusError as exc:
    return {"status": "rate_limited" if exc.response.status_code == 429 else "http_error", "message": "..."}
```

### Scenario: API 配置模型列表检测

#### 1. Scope / Trigger

- Trigger: `/api/config/models-analysis` 和 `/api/config/models-image` 会访问外部供应商模型列表接口，容易出现 URL 形态、鉴权、空响应、供应商不支持等边界错误。

#### 2. Signatures

- `POST /api/config/models-analysis`
- `POST /api/config/models-image`
- Form fields: `provider_name`, `api_format`, `base_url`, `api_key`, `model`
- Runtime helper: `list_available_models(role, provider_name, api_format, base_url, api_key, model, user_id)`

#### 3. Contracts

- Success response: `{"ok": true, "models": string[], "message": string}`.
- Failure response: HTTP 400, `{"ok": false, "stage": "models-analysis" | "models-image", "error": string}`.
- OpenAI-compatible detection may try more than one URL candidate, such as stripping `/chat/completions` or `/responses` and falling back from host root to `/v1/models`.
- Ollama detection uses `/api/tags` and must not require an API key.
- Azure OpenAI model listing is unsupported unless a future task adds resource and `api-version` handling; return a manual-entry error instead.

#### 4. Validation & Error Matrix

- Missing API format -> `<role> 配置缺少 API 格式`.
- Unsupported API format -> `<role> 暂未实现 <label> 模型列表检测`.
- Missing API key for non-Ollama, non-default-user fallback -> tell the user to save their own API key for the current account.
- External HTTP failure -> include the attempted model-list URL and HTTP status/body excerpt.
- Empty/unrecognized response -> report that no `id`/`name`/`model` field was found.

#### 5. Good/Base/Bad Cases

- Good: OpenAI-compatible `https://api.example/v1/chat/completions` detects through `https://api.example/v1/models`.
- Base: OpenAI-compatible `https://api.example` first tries `/models`, then `/v1/models`.
- Bad: Azure OpenAI detection returns a clear manual-entry message instead of pretending the generic `/models` path works.

#### 6. Tests Required

- Unit test `_extract_model_ids` for list/data/models/items shapes, dedupe, sort, and `models/` namespace stripping.
- Unit test `_model_list_requests` for endpoint-style OpenAI-compatible base URLs.
- Unit test OpenAI-compatible host-root fallback to `/v1/models`.
- Unit test Ollama `/api/tags` without API key.
- API route test that confirms role/user/form values reach `list_available_models`.

#### 7. Wrong vs Correct

Wrong:

```python
url = f"{cfg.base_url.rstrip('/')}/models"
```

Correct:

```python
for url, headers in _model_list_requests(cfg):
    response = await client.get(url, headers=headers)
```

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

(To be filled by the team)
