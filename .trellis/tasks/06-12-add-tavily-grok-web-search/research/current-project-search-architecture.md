# Current Project Search Architecture

## Summary

当前项目已经具备“聊天时自动联网搜索”的主流程，但实现仍是单一 provider、单文件逻辑。

最关键的现状是：

* 搜索触发判断在聊天路由中。
* 搜索实现是 DuckDuckGo HTML 抓取。
* 搜索结果以文本上下文形式拼进聊天模型 system message。
* 搜索配置目前没有独立配置域。

## Current Flow

### Chat route

文件：`attuno-studio/backend/app/routes/chat.py`

关键流程：

1. `chat(...)` / `chat_stream(...)`
2. `_route_chat_payload(...)` 判定当前是否是日常聊天
3. `_with_web_search_context(...)`
4. `should_use_web_search(...)`
5. `build_web_search_context(...)`
6. 将 `web_search_context` 塞进 payload context
7. `_run_configured_daily_chat(...)` 或 `_stream_configured_daily_chat(...)`

### Search service

文件：`attuno-studio/backend/app/services/web_search.py`

当前能力：

* 基于关键词判断是否需要联网搜索
* 构造简化 query
* 请求 `https://duckduckgo.com/html/`
* 解析 HTML 结果
* 返回：
  * `query`
  * `results`
  * `search_context`

## Existing API Contract

聊天结果中已暴露：

* `web_search.query`
* `web_search.results`
* `web_search.ok`

这意味着后续做 provider 化时，最好不要改变响应形状。

## Existing Tests

文件：`attuno-studio/tests/test_backend_api.py`

已有测试覆盖了：

* `/api/chat` 注入 web search context
* `/api/chat/stream` 发出包含 `web_search` 的 `meta` 事件

现有测试结构很适合继续扩展到：

* Tavily provider 成功
* Grok provider 成功
* provider fallback
* provider 失败时的错误/降级行为

## Existing Config Infrastructure

### Frontend

文件：

* `attuno-studio/ui-prototype/src/types/domain.ts`
* `attuno-studio/ui-prototype/src/api/config.ts`
* `attuno-studio/ui-prototype/src/data/studioData.ts`
* `attuno-studio/ui-prototype/src/App.tsx`

现有前端已支持：

* `analysisProviders`
* `activeAnalysisProviderId`
* `imageProviders`
* `activeImageProviderId`

说明：

* 项目已经有“多 provider + 当前激活 provider”这一套 UI/存储形状。
* 搜索配置可以仿照这个模式新增，而不需要重新发明配置体系。

### Backend

文件：

* `attuno-studio/backend/app/routes/config.py`
* `attuno-studio/app_runtime.py`

现有后端已支持：

* 加载 UI 配置 `load_model_config_for_ui(...)`
* 保存配置 `save_model_config_to_files(...)`
* 多 provider profile 序列化/反序列化

说明：

* 搜索配置最合理的落点是 `config.json` / per-user config 体系。
* 不建议把搜索 key 硬编码在 `.env` 之外的临时前端 localStorage 里。

## Important Constraint

当前 adapter 层虽然支持：

* `openai_responses`
* `chat.completions`
* `stream_chat`

但当前聊天入口只是把它当“普通文本聊天模型”使用，还没有独立的：

* tool call 编排
* function calling 抽象
* provider native search abstraction

因此如果要接 Grok 原生 `web_search`，更稳的路径是：

* 在搜索服务层单独请求 xAI Responses
* 将结果归一化后继续注入聊天上下文

而不是直接让现有 daily chat adapter 即时承担完整工具调用编排。

## Recommended Internal Refactor

把 `backend/app/services/web_search.py` 拆成：

* `search_types.py`
  * `SearchResult`
  * `SearchResponse`
  * `SearchProviderConfig`
* `search_providers/duckduckgo.py`
* `search_providers/tavily.py`
* `search_providers/grok.py`
* `search_service.py`
  * provider 选择
  * fallback
  * context formatting

这样可以最大限度减少对 `chat.py` 的侵入。
