# Fix Analysis API Format Routing

## Goal

让 Attuno 的分析模型配置按用户选择的 API 格式稳定路由：选择 `openai_responses` 时走 `/responses`，选择 `openai_chat` 或 `custom_openai_chat` 时走 `/chat/completions`，选择 `anthropic` / Messages 类别时走 Anthropic Messages 适配器。同时让 UI、`/api/config` 回显、保存配置和校验错误里的格式名称一致，避免用户以为选了 completion 兼容但后端实际仍在走 responses。

## Requirements

- 前端分析格式下拉必须使用后端真实格式值，尤其是 `openai_chat`、`custom_openai_chat` 和 `openai_responses`。
- 前端分析格式下拉必须显式展示三类常见文本协议：Chat Completions、Responses、Anthropic Messages。
- 后端 `GET /api/config` 必须回显规范格式值，不再把 `openai_chat` 折叠成 `openai`，也不再把 `custom_openai_chat` 折叠成 `custom`。
- 旧保存值 `openai`、`custom`、`chat/completions` 等别名仍必须兼容读取和保存，统一归一化到规范格式。
- provider profile 的保存/加载必须保留每个档案的真实 `apiFormat`，切换档案后 flat config 继续同步到当前选中档案。
- `verify-analysis`、聊天、流式聊天继续只由归一化后的 `api_format` 控制 endpoint，不能因为供应商名称或展示文案误判。

## Acceptance Criteria

- [ ] 保存 `analysis_api_format=openai_chat` 后，`GET /api/config` 返回 `analysisApiFormat=openai_chat`，真实配置为 `openai_chat`。
- [ ] 保存 `analysis_api_format=custom_openai_chat` 后，`GET /api/config` 返回 `analysisApiFormat=custom_openai_chat`。
- [ ] 保存旧别名 `openai` / `custom` 后，后端仍能正常归一化并回显规范值。
- [ ] 保存 `analysis_api_format=openai_responses` 后，回显保持 `openai_responses`，适配器仍打 `/responses`。
- [ ] 保存 `analysis_api_format=messages` 后，回显归一化为 `anthropic`，适配器走 Anthropic Messages。
- [ ] 前端下拉标签明确区分 Chat Completions 与 Responses，用户能直接看出请求路径族。
- [ ] 相关 Python 单测覆盖格式回显、provider profile round trip、adapter endpoint 分流。
- [ ] 前端 TypeScript 构建通过。

## Definition of Done

- 更新后端/前端代码和测试。
- 运行相关 Python 测试。
- 运行前端构建或类型检查。
- 不改动无关的模型供应商、密钥隔离、图片生成行为。

## Technical Approach

- 保持 `normalize_api_format(...)` 的旧别名兼容入口。
- 将 `_ui_api_format(...)` 改成“规范化后原样返回”，让 UI 与 API 都使用 canonical values。
- 更新前端 `apiFormatOptions` 的 `value` 到 canonical values，并把标签写清楚 endpoint family。
- 更新测试中旧别名回显的断言，并增加 `openai_responses`、`openai_chat`、`messages` 三类分流保护。

## Decision (ADR-lite)

**Context**: 当前适配器按 `api_format == "openai_responses"` 决定 `/responses`，否则 OpenAI-compatible chat 格式走 `/chat/completions`。问题来自 UI/配置回显仍使用旧别名 `openai`/`custom`，容易让真实配置和用户认知不一致。

**Decision**: 新 UI 和 `/api/config` 全部使用 canonical format values；旧别名只作为输入兼容层存在。

**Consequences**: 已保存旧配置仍能读，但新回显可能从 `openai` 变为 `openai_chat`，这是预期的显式化行为。

## Out of Scope

- 不自动修改用户远端/生产机器上的现有配置文件。
- 不改变 OpenAI Responses payload 结构。
- 不新增供应商格式。
- 不重做设置页面布局。

## Technical Notes

- 关键代码：`attuno-studio/app_runtime.py`、`attuno-studio/config.py`、`attuno-studio/adapters/openai_compat.py`、`attuno-studio/ui-prototype/src/data/studioData.ts`。
- 相关规范：`.trellis/spec/backend/generation-contracts.md` 的 API Config Provider Profiles 与 Configured Daily Chat Routing。
