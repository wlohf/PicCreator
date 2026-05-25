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
