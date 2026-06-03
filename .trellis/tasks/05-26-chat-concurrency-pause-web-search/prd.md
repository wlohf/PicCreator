# 完善聊天并发、停止输出与联网搜索

## Goal

修复 Attuno Studio 当前聊天工作区的三个可用性缺口：支持多个对话窗口/会话并行发起请求，支持用户主动停止正在输出的回复，并为聊天增加可用的联网搜索能力。

## What I Already Know

* 用户反馈当前项目只能同时一个对话窗口工作；一个窗口还在思考或输出时，无法开新窗口继续对话。
* 当前聊天没有暂停/停止按钮，只能等待模型完整输出。
* 当前聊天无法联网搜索。
* 既有聊天流式输出需求在 `05-23-chat-streaming-output` 中明确将“聊天中断/停止生成按钮”列为 out of scope，本任务需要补齐这一点。

## Requirements

* 聊天请求的忙碌状态应按会话/对话隔离，不应使用一个全局状态阻塞所有会话。
* 用户可以在某个正在输出的会话中停止当前回复；停止只影响该会话，不影响其他会话。
* 停止后前端应保留已输出内容并恢复该会话输入能力。
* 如果底层请求被取消或连接中断，前后端应把它作为可预期状态处理，不显示误导性的失败堆栈。
* 聊天支持联网搜索：用户显式要求搜索/联网/最新信息时，聊天应带上搜索结果上下文，且回答中能说明使用了联网信息。
* 联网搜索失败时，应在聊天中返回明确错误或降级说明，不应静默假装已搜索。

## Acceptance Criteria

* [x] 会话 A 正在流式输出时，可以切到/新建会话 B 并发送消息。
* [x] 会话 A 的停止按钮只终止 A 的当前输出，B 的输出不受影响。
* [x] 停止后 A 可以继续发送下一条消息。
* [x] 前端按钮状态、输入禁用状态、加载态均按当前会话计算。
* [x] 后端/前端支持取消流式请求，不把用户主动停止误报为系统错误。
* [x] 聊天输入包含搜索意图时，会进行联网搜索并将结果作为上下文传给模型。
* [x] 搜索能力有清晰配置和失败提示。

## Definition of Done

* 相关前后端代码完成并保持现有聊天流式/结构化草稿能力可用。
* 新增或更新针对并发状态、停止输出、搜索请求构造的测试。
* 前端 typecheck/build 与后端相关测试通过，或明确记录环境阻塞。

## Out of Scope

* 图片生成任务队列并发改造。
* 真正“暂停并恢复同一次模型流”的协议；本任务的暂停语义按用户可理解的“停止当前输出”实现。
* 多用户权限系统调整。

## Technical Notes

* 已实现：
  * 前端聊天运行状态改为 `chatRespondingSessionIds`，只锁定当前会话的输入和停止按钮。
  * `streamDesignChat` 支持 `AbortSignal`，用户停止输出时抛出可识别的 `ChatStreamAbortedError`。
  * 后端新增 `backend/app/services/web_search.py`，对“联网/搜索/最新/新闻/查找”等明确搜索意图抓取 DuckDuckGo Lite 结果并注入模型 system context。
  * `/api/chat` 与 `/api/chat/stream` 均支持搜索上下文，流式 meta/complete 会返回 `web_search` 元数据。
* 实际相关文件包括：
  * `attuno-studio/backend/app/routes/chat.py`
  * `attuno-studio/backend/app/services/web_search.py`
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/api/chat.ts`
  * `attuno-studio/ui-prototype/src/api/sse.ts`
  * `attuno-studio/ui-prototype/tests/chatApi.test.ts`
  * `attuno-studio/tests/test_backend_api.py`
* 验证已通过：
  * `npm run test:chat-api`
  * `npm run test:chat-sessions`
  * `npm run build`
  * `python -m pytest tests/test_backend_api.py`
  * `python -m pytest tests/test_backend_api.py -k "daily_chat"`
  * `python -m pytest tests/test_openai_compat.py tests/test_design_chat_agent.py`
