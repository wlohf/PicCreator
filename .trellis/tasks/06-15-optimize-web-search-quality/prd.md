# 优化联网搜索效果

## Goal

提升 Attuno 在“最新发布、模型能力、发布时间、产品/模型对比”等时间敏感问题上的联网搜索质量，让模型能拿到更明确的来源证据，减少像 GLM-5.2 发布时间这类问题回答模糊的情况。

## Requirements

- 对时间敏感、模型/产品发布、能力对比类问题自动使用更强的 Tavily 检索参数，而普通搜索继续保持低成本。
- Tavily 结果应保留更完整的可用证据，包括 Tavily answer、raw content 摘要、来源 score 等非敏感元数据。
- 注入给聊天模型的联网上下文应明确包含搜索词、搜索策略、Tavily answer、来源标题/URL/摘要/正文摘录，提示模型优先依据联网证据回答并在证据不足时说明不确定。
- 聊天回答输出上限应设置为当前模型最大输出 token 数 128K（131072 tokens），不应因默认 token 上限过低而明显截短。
- 聊天 UI 应把常见 Markdown 回复正常渲染为标题、段落、无序/有序列表、加粗和代码块，而不是把 Markdown 标记挤在纯文本段落里。
- 搜索失败诊断继续保留，不泄露 API key，并保持 DuckDuckGo fallback 行为。
- 保持现有 `/api/chat` 和 `/api/chat/stream` 返回结构兼容。

## Acceptance Criteria

- [ ] GLM-5.2 这类“发布时间/当前能力/对比”问题会触发增强 Tavily 请求参数。
- [ ] 普通联网搜索仍可用，且不会无条件使用高成本 advanced/news 检索。
- [ ] 搜索上下文包含 Tavily answer 和 raw content 摘录（当 Tavily 返回时）。
- [ ] 聊天模型回答 `max_tokens` 设置为 128K（131072 tokens），stream 和非 stream 路径一致。
- [ ] 前端聊天消息能渲染常见 Markdown 结构，包括 `##` 标题、`-` 列表、数字列表、`**加粗**` 和 fenced code block。
- [ ] 现有 Tavily key 轮询与 DuckDuckGo fallback 测试继续通过。
- [ ] 新增测试覆盖增强参数选择和上下文证据注入。

## Definition of Done

- 后端单元测试覆盖新增行为。
- 相关 pytest 通过。
- 实现不引入前端破坏性 API 变更。
- 搜索诊断不包含敏感 key。

## Technical Approach

在 `backend/app/services/web_search.py` 内新增搜索策略判断：通过既有 `TIME_SENSITIVE_MARKERS` 和 `CHANGEABLE_FACT_HINTS` 识别时间敏感事实问题。普通 query 使用 Tavily `basic`、5 条结果；时间敏感 query 使用更强的 Tavily 参数，例如 `search_depth=advanced`、更多结果、`topic=news`、`time_range=month`、`include_answer=advanced`、`include_raw_content=markdown`。归一化结果时保留 answer、score、raw_content 摘录，并在 `build_web_search_context_detailed` 中注入更完整的证据。

## Decision (ADR-lite)

**Context**: 用户对比 Cherry Studio、Hermes、Grok 后发现同样 Tavily key 下 Attuno 搜索结果更模糊，原因主要是 Attuno 只用 basic search 和短 snippet。

**Decision**: 采用“按 query 意图智能升级 Tavily 参数”的方案，而不是所有搜索都开 advanced/raw content。

**Consequences**: 时间敏感问题质量提升，普通搜索成本保持可控；策略仍是启发式，后续可增加 UI 配置或多 query 改写。

## Out of Scope

- 不改前端 UI 展示引用卡片。
- 不更换搜索供应商。
- 不做多轮搜索代理或网页二次抓取。
- 不修改用户 Tavily key 配置/轮询机制。

## Technical Notes

- 主要文件：`attuno-studio/backend/app/services/web_search.py`。
- 相关测试：`attuno-studio/tests/test_web_search.py`。
- 相关规范：`.trellis/spec/backend/error-handling.md`。
- Tavily Search API 支持 `search_depth`、`topic`、`time_range`、`include_answer`、`include_raw_content`、`chunks_per_source` 等参数。
