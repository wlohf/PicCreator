# 来源引用展示

## Goal

在 AI 聊天回复中展示联网搜索来源引用，让用户能直观看到回答参考了哪些网页，从而提升结果可信度。展示形态参考用户截图：正文保持可读，来源以轻量、可点击的引用链接呈现在回答附近。

## Requirements

* 对带有 `webSearch` 元数据的助手消息展示来源引用。
* 引用优先展示搜索结果中的标题、域名、URL、发布时间或相关性信息；最多展示 5 条，避免撑开聊天流。
* 来源链接必须可点击并在新窗口打开。
* 正常搜索结果使用轻量引用条/引用列表，不再默认占用大块卡片空间。
* 联网搜索失败或无结果时仍展示简短诊断，提示来源不可用或需要配置 Tavily。
* 流式输出完成、普通非流式返回、重试版本切换、历史持久化都应保留并展示同一份 `webSearch` 元数据。

## Acceptance Criteria

* [ ] 助手消息含 `webSearch.results` 时，正文下方出现“来源/References”区域。
* [ ] 每条来源展示可点击链接、标题或域名，且长 URL/标题不会溢出。
* [ ] 无结果但存在诊断时，展示简短“来源不可用/需处理”状态。
* [ ] 现有聊天 API 元数据保留测试通过。
* [ ] 前端类型检查或构建通过。

## Definition of Done

* 代码改动聚焦在聊天来源引用展示相关文件。
* 不改动无关未提交文件。
* 运行可行的前端测试/构建命令并记录结果。

## Technical Approach

复用已有后端 `web_search` 数据流：`backend/app/routes/chat.py` 已把 `web_search.results` 放入聊天响应，前端 `sendDesignChat`/`streamDesignChat` 已把它保存为消息的 `webSearch`。本任务主要重做 `WebSearchSourcesCard` 为更轻量的引用展示，并补充必要的 helper 与样式。

## Decision (ADR-lite)

**Context**: 项目已具备 `WebSearchMetadata` 数据和展示组件，但当前样式更像诊断卡片，不像回答正文中的来源引用。

**Decision**: 不改后端契约，前端在助手消息正文后渲染轻量 `SourceCitationList` 风格区域。

**Consequences**: 实现风险小，能保留历史数据兼容；后续若需要正文内编号引用，可在同一元数据上继续扩展，不阻断当前 MVP。

## Out of Scope

* 不做 LLM 正文内自动插入 `[1]`/脚注编号。
* 不抓取网页 favicon 或生成来源预览图。
* 不调整联网搜索策略、Tavily key 轮询或后端搜索逻辑。

## Technical Notes

* 已定位前端类型：`attuno-studio/ui-prototype/src/types/domain.ts`
* 已定位聊天 API：`attuno-studio/ui-prototype/src/api/chat.ts`
* 已定位消息渲染和现有来源组件：`attuno-studio/ui-prototype/src/App.tsx`
* 已定位样式：`attuno-studio/ui-prototype/src/styles.css`
* 已定位覆盖测试：`attuno-studio/ui-prototype/tests/chatApi.test.ts`
