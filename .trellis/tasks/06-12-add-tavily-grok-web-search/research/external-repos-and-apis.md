# External Repos And APIs

## 1. Aether

仓库：

* https://github.com/Zhou-Shilin/Aether

### What it does

Aether 不是一个普通的 Web 聊天站点，它是 Android 本地 Agent 应用。

从源码可见：

* `AppSettings.kt` 里明确有：
  * `tavilyApiKey`
  * `tavilyBaseUrl`
* `WebToolsClient.kt` 里直接实现了 Tavily Search HTTP 调用。
* 同一个项目也有完整 MCP client 管理能力：
  * `McpClientManager.kt`

### Conclusion

Aether 对 Tavily 的实现是：

* **Tavily 直连 API**
* 不是“必须通过 MCP 才能用 Tavily”

同时它也支持 MCP，但这是另一条并行能力，不是 Tavily 的唯一入口。

### Relevance to this project

可以借鉴的点：

* Tavily API key/base URL 做成一等配置项
* 搜索结果结构化返回
* 把 Tavily 视为独立的 web tools client

不适合直接照搬的点：

* Aether 本身是 Agent + MCP client 架构，复杂度远高于当前项目
* 当前项目并不具备 Aether 那种原生 MCP 生命周期管理

## 2. GrokSearch-rs

仓库：

* https://github.com/Episkey-G/GrokSearch-rs

### What it does

这是一个 **Rust MCP stdio server**。

根据其 README 与架构文档：

* 它暴露 MCP tools：
  * `web_search`
  * `get_sources`
  * `web_fetch`
  * `web_map`
  * `doctor`
* 上游主路径是：
  * xAI `/v1/responses` 原生 `web_search`
* Tavily 与 Firecrawl 是：
  * source enrichment
  * fallback
  * fetch/map 能力

### Key architectural point

GrokSearch-rs 的边界是：

* **MCP client -> GrokSearch-rs -> xAI/Tavily/Firecrawl**

不是：

* 普通 Web 应用后端直接内嵌调用它的库接口

### Conclusion

如果当前项目要“像 MCP 客户端一样”接 `GrokSearch-rs`，需要先具备：

* MCP client 进程管理
* stdio JSON-RPC 通信
* tool catalog
* tool invocation lifecycle
* 失败重试与 server health 管理

对当前项目来说，这个成本明显偏高。

### Relevance to this project

可借鉴：

* 把 Grok 作为主搜索 provider
* Tavily 作为补充/回退 provider
* 统一 `web_search -> sources -> fetch` 的分层思想

不建议首版直接采用：

* “为了用 Grok 搜索，先把整个 MCP client 能力补齐”

## 3. DEEIX-Chat

仓库：

* https://github.com/DEEIX-AI/DEEIX-Chat

### What it does

DEEIX-Chat 是完整 AI 平台，能力比当前项目更重。

从 README 和源码结构可见：

* 同时支持：
  * provider native tools
  * MCP tools
* 在原生工具目录里，明确内置了：
  * OpenAI `web_search`
  * Anthropic `web_search`
  * xAI `web_search`
  * xAI `x_search`
  * Google Search grounding

关键文件：

* `backend/internal/shared/nativetool/catalog.go`

### Conclusion

DEEIX-Chat 的思路不是“把搜索写死成一个外部 API 调用”，而是：

* 把搜索当作模型或工具生态的一种能力目录
* 区分：
  * provider native tools
  * MCP tools

### Relevance to this project

可以借鉴的不是其全部系统复杂度，而是它的方向：

* 搜索应该做成“能力类型”，而不是单个 if/else
* xAI 原生 `web_search` 是成立的、可产品化的路径

## 4. Tavily Official API

官方文档：

* https://docs.tavily.com/documentation/api-reference/endpoint/search

### Confirmed facts

* Tavily Search 是标准 HTTP API。
* 使用 Bearer API key。
* 关键参数包括：
  * `query`
  * `topic`
  * `search_depth`
  * `max_results`
  * `time_range`
  * `include_answer`
  * `include_raw_content`
  * `include_domains`
  * `exclude_domains`

### Conclusion

对当前项目而言，Tavily 是最容易落地的新搜索 provider。

## 5. xAI Official API

官方文档：

* https://docs.x.ai/docs/api-reference

### Confirmed facts

* xAI 提供 `/v1/responses`。
* Responses API 支持 `tools`。
* 文档明确写到：
  * 当前支持的 tools 包括 `functions` 和 `web search`。

### Conclusion

Grok 搜索 **不必经由 MCP**。

当前项目完全可以直接请求 xAI Responses，把 `web_search` 作为原生 tool 使用。

## Final Recommendation

### Best first implementation order

1. Tavily 直连
2. Grok 原生 Responses `web_search`
3. 保留 DuckDuckGo 作为 fallback
4. MCP 以后再评估

### Why

* 最契合当前 FastAPI + React 架构
* 不需要先建设 MCP client 基础设施
* 与当前“先搜，再把结果注入聊天上下文”的模式兼容

## Links

* Aether: https://github.com/Zhou-Shilin/Aether
* GrokSearch-rs: https://github.com/Episkey-G/GrokSearch-rs
* DEEIX-Chat: https://github.com/DEEIX-AI/DEEIX-Chat
* Tavily Search docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
* xAI API reference: https://docs.x.ai/docs/api-reference
