# Add Tavily And Grok Web Search

## Goal

为当前 Attuno 聊天能力增加更稳定、可配置的联网搜索能力，并支持两条可选路径：

1. Tavily API Key 直连搜索。
2. Grok 搜索能力接入。

目标不是单纯替换当前 DuckDuckGo 抓取逻辑，而是把现有 `web_search.py` 升级为可扩展的搜索 provider 架构，后续可继续接第三种搜索方式。

## What I Already Know

* 当前项目已经有一版联网搜索，位于 `attuno-studio/backend/app/services/web_search.py`。
* 当前聊天链路会在 `attuno-studio/backend/app/routes/chat.py` 中先判断是否需要联网搜索，再把搜索结果拼成 system context 喂给聊天模型。
* 当前搜索实现是 DuckDuckGo HTML 抓取，不是官方 API，对稳定性、结构化结果和风控都不够理想。
* 前端和后端已经有一套“分析模型 provider 配置”的完整保存/加载链路，可复用配置管理模式。
* 当前 adapter 层支持普通 chat、stream chat、openai responses 文本调用，但还没有单独的“搜索 provider 编排层”。
* 用户已确认首版采用 API key 直连方案，不走 MCP。

## Requirements

* 将现有联网搜索能力从单一实现改为 provider 化。
* 至少支持 `duckduckgo_html` 之外的新 provider：
  * `tavily`
* 支持配置搜索 provider 的类型、base URL、API key、默认参数。
* 支持在聊天时自动触发联网搜索，并把结构化搜索结果注入聊天上下文。
* 前端需要允许用户查看或编辑搜索配置，至少达到与现有分析模型配置同等级别的可配置性。
* 搜索结果响应中继续返回 `web_search.query`、`web_search.results`、`web_search.ok`，避免破坏当前 UI 流程。
* 保持当前路由行为：
  * `suggested_action != "chat"` 时不执行联网搜索。
  * 流式接口继续先发 `meta`，再发 `delta`/`complete`。

## Non-Goals

* 本轮不做通用 MCP 平台接入。
* 本轮不做多 provider 并发聚合排序。
* 本轮不做联网搜索计费统计。
* 本轮不强依赖模型原生 tools 调用做搜索编排。

## Acceptance Criteria

* [ ] 后端存在独立的搜索 provider 抽象，而不是把 Tavily/Grok 逻辑继续硬塞进单个 `web_search.py` 函数里。
* [ ] 可以通过配置切换 Tavily 与 Grok 搜索实现。
* [ ] Tavily 模式下，填入 key 后可返回结构化结果。
* [ ] Grok 模式下，至少有一条明确、可测试的接入路径。
* [ ] `/api/chat` 与 `/api/chat/stream` 在启用联网搜索时继续返回 `web_search` 元信息。
* [ ] 保留现有测试覆盖思路，并补上新 provider 的单测。

## Technical Approach

推荐把现有实现拆成三层：

1. `search provider` 层
   * 统一输出：
     * `query`
     * `results: [{title, url, snippet}]`
     * `search_context`
   * provider 负责各自请求和结果归一化。

2. `search orchestration` 层
   * 负责：
     * 是否触发搜索
     * 读配置
     * 选择 provider
     * provider 失败时回退
     * 生成注入给聊天模型的上下文文本

3. `chat route integration` 层
   * 保持 `chat.py` 中 `_with_web_search_context(...)` 的接口形状基本不变，只把底层实现换成 orchestration。

### Tavily 方案

推荐优先实现。

原因：

* 接入最直接，官方 API 明确，当前项目后端用 `httpx`/`http` 风格即可完成。
* 与现有“先搜，再把结果喂给聊天模型”的架构最契合。
* 不要求当前聊天模型必须支持原生 tool calling。

### Grok 方案

分两种路线：

1. `推荐`：Grok 原生 Responses `tools=[{\"type\":\"web_search\"}]`
2. `不推荐作为首版主路径`：通过 MCP server 间接接入 GrokSearch-rs

原因：

* 当前项目本身不是 MCP client 平台，没有现成 MCP 生命周期、tool discovery、tool invocation、session 管理。
* 如果为了“只要 Grok 搜索”而先补 MCP，复杂度会远高于直接调 xAI Responses。
* `GrokSearch-rs` 更适合 Claude Code / Codex / Cursor 这类 MCP client 环境，而不是当前这个 FastAPI + React 聊天产品直接内嵌。

## Recommended MVP

### Phase 1

* 保留现有 DuckDuckGo 作为 fallback。
* 新增 Tavily provider。
* 搜索配置先落在后端配置文件和当前设置页。
* 本阶段不做 MCP。
* 本阶段不接 GrokSearch-rs。
* 本阶段不依赖 Grok 搜索能力。

### Phase 2

* 新增 Grok provider：
  * 直接请求 xAI `/v1/responses`
  * 使用 `tools` 中的 `web_search`
* 把 Grok 结果归一化到统一 `SearchResult` 结构。

### Phase 3

* 如果未来项目确实要做“通用工具生态”，再评估 MCP client 化。
* 届时可考虑兼容 `GrokSearch-rs` 这类 MCP server。

## Decision (ADR-lite)

**Context**

用户希望同时支持 Tavily 和 Grok 搜索，并参考 Aether、GrokSearch-rs、DEEIX-Chat 的做法。

**Decision**

优先采用“provider 化搜索服务”方案：

* Tavily 走官方 API 直连。
* 首版只做 Tavily + DuckDuckGo fallback。
* 暂不把 MCP 作为当前项目首版联网搜索的必选基础设施。
* 暂不接入 `GrokSearch-rs`。
* 用户已确认使用 direct key 调用，而不是 MCP。

**Consequences**

* 好处：
  * 与当前代码结构兼容度高。
  * 首版成本低，测试边界清晰。
  * 后续仍可继续扩展到 MCP。
* 代价：
  * GrokSearch-rs 里的 Tavily/Firecrawl/MCP 生态不能直接复用，需要只借鉴其架构思路。
  * 你的 Grok 反代因为当前主要走 completion 格式，是否支持原生 `web_search` 不能先假设成立。

## Research References

* [`research/current-project-search-architecture.md`](research/current-project-search-architecture.md) — 当前仓库搜索与配置链路梳理。
* [`research/external-repos-and-apis.md`](research/external-repos-and-apis.md) — Aether、GrokSearch-rs、DEEIX-Chat 与官方 API 对照。

## Out Of Scope

* MCP server 托管、发现、健康检查、工具权限系统
* 联网搜索计费
* 多搜索引擎融合排序
* 前端高级搜索参数面板
