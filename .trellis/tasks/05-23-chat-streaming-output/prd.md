# chat streaming output

## Goal

为 Attuno Studio 的聊天工作区增加 SSE 流式输出效果，让日常聊天回复像 Codex/ChatGPT 一样逐步出现，同时保留现有供应商展示、模型切换、推理强度选择，以及设计意图路由和草稿/记忆能力。

## What I already know

* 现有 `POST /api/chat` 已经能在 `suggested_action == "chat"` 时走已配置的分析模型，并返回完整 JSON。
* 聊天输入框已经具备供应商 badge、模型切换、推理强度选择，不需要再做权限管理功能。
* 图片生成链路已经有独立的 `/api/generate/stream` SSE，不应与聊天流式输出耦合。
* 用户确认流式方案采用 SSE。
* `DesignChatAgent` 仍然负责先做意图判断；在聊天工作区里，用户也可能输入“改图/出图”类消息，这类请求仍需保留结构化草稿返回能力。

## Requirements

* 新增聊天 SSE 接口，供聊天工作区提交消息并接收增量回复。
* SSE 仅改变聊天呈现方式，不改变当前聊天工作区的供应商显示、模型切换、推理强度选择。
* 当路由结果为 `suggested_action == "chat"` 时，后端应使用当前分析模型进行流式输出。
* 当路由结果不是 `chat` 时，后端仍返回当前结构化结果语义，前端继续支持：
  * `draft_instruction`
  * `memory_candidate`
  * `ui_hints`
* 前端在发送聊天消息后应立即插入一条 assistant 占位消息，并随着 SSE 增量更新文本。
* 流式结束后，assistant 消息要保留最终文本，并继续挂载 `draftInstruction`、`memoryCandidate` 等动作数据。
* 出错时要明确显示错误消息，不能悄悄回退成本地固定文案。

## Acceptance Criteria

* [ ] 聊天工作区发送普通日常消息时，assistant 回复会逐步流式出现，而不是一次性整段插入。
* [ ] 聊天工作区发送图片/改图意图时，仍然能得到原有的结构化草稿能力，不会误触发真实聊天流。
* [ ] 聊天工作区的供应商 badge、模型切换、推理强度选择继续可用，且仍影响聊天请求。
* [ ] SSE 结束、异常、空回复等情况均有明确事件和前端处理。
* [ ] 后端和前端测试覆盖聊天流式新增契约。

## Definition of Done

* 后端 SSE 路由、前端流式渲染、测试与相关契约文档完成更新。
* 现有图片生成 SSE 行为不受影响。
* 前端构建通过，相关前端测试通过。
* 后端聊天 API 测试通过，至少覆盖普通聊天流式与非聊天意图回退。

## Technical Approach

* 后端新增 `POST /api/chat/stream`，使用 `text/event-stream` 返回事件流。
* 事件模型：
  * `meta`：返回路由后的结构化字段（不含最终 reply 或仅含初始 reply）
  * `delta`：聊天模型返回的增量文本
  * `complete`：返回最终结构化响应
  * `error`：返回错误信息
* `DesignChatAgent` 仍先执行：
  * 若 `suggested_action != "chat"`，SSE 直接发出 `complete`，前端按现有结构化消息渲染
  * 若 `suggested_action == "chat"`，后端调用分析模型的流式能力；若适配器无原生流式能力，则做服务端分段回退，保证前端仍能获得增量体验
* 前端新增聊天 SSE 请求函数，解析事件流并回调 `meta` / `delta` / `complete`
* `runDailyChatFlow()` 改为：
  * 先写入用户消息
  * 立即插入 assistant 占位消息
  * 接收增量并就地更新该消息内容
  * 在 `complete` 时补齐动作数据和文案

## Decision (ADR-lite)

**Context**：用户想要类 Codex 的聊天流式输出，同时当前聊天工作区已包含设计路由能力，不能因为改成流式就丢掉图片草稿/记忆路径。  
**Decision**：采用 SSE，并在同一个聊天流接口里先做 `DesignChatAgent` 路由，再根据 `suggested_action` 决定是进入真实聊天流还是直接完成结构化返回。  
**Consequences**：前端只需要一套聊天提交逻辑；后端需要维护 SSE 事件契约，并处理“非聊天意图不流式但仍走 SSE 通道”的兼容路径。

## Out of Scope

* 图片生成、改图、标注改图链路的流式协议调整
* 聊天中断/停止生成按钮
* 聊天历史回放动画
* 权限管理、临时访问标识或额外账号控制

## Technical Notes

* 受影响文件预计包括：
  * `attuno-studio/backend/app/routes/chat.py`
  * `attuno-studio/adapters/openai_compat.py`
  * `attuno-studio/ui-prototype/src/api/chat.ts`
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/types/domain.ts`
  * `attuno-studio/tests/test_backend_api.py`
  * `attuno-studio/tests/test_openai_compat.py`
  * `attuno-studio/ui-prototype/tests/chatApi.test.ts`
  * `.trellis/spec/backend/generation-contracts.md`
* 已参考现有图片生成 SSE 模式：`backend/app/services/generation_service.py` 与 `ui-prototype/src/api/generation.ts`
* 当前环境里 `python` / `py` 命令不可直接用，若需要跑 Python 测试，需先定位可用解释器路径或使用项目现有启动方式。
