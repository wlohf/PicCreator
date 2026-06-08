# Fix new conversation image mode switching

## Goal

修复图片生成进行中或已有图片生成流程后点击“新对话”只能停留在聊天模式的问题。新对话进入空白会话后，用户应能正常切换到图像模式继续发起新图像工作流。

## Requirements

* “新对话”创建的空白会话可以从聊天模式切换到图像模式。
* 如果旧会话仍在后台生图，新会话的聊天/图像模式切换不应被旧会话的全局渲染状态拦截。
* 当前可见会话正在生图或聊天输出时，仍保持现有保护，不允许切换模式。
* 不改动生成接口、历史会话结构、图片管理页面或模型配置行为。

## Acceptance Criteria

* [ ] 在图像模式触发生图后，点击“新对话”进入空白会话，点击“图像”可以切换到图像模式。
* [ ] 旧会话后台生图时，新会话顶部模式切换按钮行为与实际处理逻辑一致。
* [ ] 当前可见会话仍在输出时，模式切换仍被阻止。
* [ ] 前端 build 和相关会话状态测试通过。

## Definition of Done

* 代码改动范围保持在前端状态/测试相关文件。
* 运行 TypeScript build 或等价检查。
* 如发现新的状态管理约定，再更新 `.trellis/spec/`；否则说明无需更新。

## Technical Approach

`WorkspaceTopbar` 以 `isVisibleConversationBusy` 控制按钮禁用，但 `switchWorkspaceMode` 目前使用全局 `isRendering` 做早退判断。旧会话后台生图时，新会话按钮可点却无法切换，形成“只能聊天”的表现。修复应让 handler 的保护条件与可见会话 busy 状态一致。

## Decision (ADR-lite)

**Context**: 图像生成状态是全局布尔值并另有 `renderingSessionId` 标识可见会话；UI 禁用条件已经使用可见会话 busy。

**Decision**: 将模式切换 handler 的渲染保护从全局 `isRendering` 调整为当前可见会话的渲染状态，保持 chat response 的可见会话保护不变。

**Consequences**: 后台生成中的旧会话不会锁住新会话的模式切换；实际提交新生成仍受现有生成并发保护约束，本任务不扩大并发生成能力。

## Out of Scope

* 不支持多个会话并发图片生成。
* 不改变新建空白会话默认进入聊天模式的产品决策。
* 不重构 session 持久化、分支对话或图片管理。

## Technical Notes

* 关键代码：`attuno-studio/ui-prototype/src/App.tsx`
* 相关规范：`.trellis/spec/frontend/state-management.md`
* 相关测试：`attuno-studio/ui-prototype/tests/chatSessions.test.ts`
