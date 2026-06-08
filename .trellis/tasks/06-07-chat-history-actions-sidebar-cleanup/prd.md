# 历史对话管理与侧栏精简

## Goal

完善左侧历史对话的管理操作，让用户可以从历史列表中重命名和删除会话，并移除左侧栏里价值不高的“AI 聊天”主导航入口，让侧栏更聚焦于图片管理、提示词和历史会话。

## Requirements

* 历史聊天列表里的会话必须提供重命名入口。
* 重命名应使用现有内联编辑体验，保存后锁定自定义标题并通过现有聊天历史持久化链路保存。
* 历史聊天列表里的会话必须提供删除入口。
* 删除会话前需要二次确认，避免误删。
* 删除当前会话后应自动切换到剩余可用会话；没有剩余会话时创建空白新会话。
* 删除非当前会话时不应打断当前会话状态。
* 左侧栏主导航不再展示“AI 聊天 / AI chat”入口。
* 保留“图片管理”和“提示词广场”等仍有实际跳转价值的入口。
* 在同一个聊天里从聊天模式切换到画图模式时，生成请求和结果应继续落在当前会话消息树中。
* 图片生成适配器必须兼容 Images API 返回 `b64_json`、data URL 或远程 URL 的图片结果，不能因为 `b64_json` 为空而中断继续画图。
* 在图像模式或历史图像流程中编辑历史用户输入、重试图像结果、重试图像错误时，必须继续调用画图流程和画图模型，不能切换到日常聊天模型。

## Acceptance Criteria

* [x] 历史聊天条目菜单中可以触发重命名，提交后列表标题更新。
* [x] 刷新页面或重新加载历史后，自定义标题仍保留。
* [x] 历史聊天条目菜单中可以触发删除，并先展示确认提示。
* [x] 确认删除后，该会话从历史列表和持久化会话集合中移除。
* [x] 删除当前会话后界面不会空白或报错。
* [x] 取消删除确认时，会话不发生变化。
* [x] 左侧栏不再出现“AI 聊天 / AI chat”主导航项。
* [x] 从聊天模式切换到画图模式后，当前会话里能显示用户画图请求和生成结果。
* [x] Images API 返回 data URL 或远程 URL 图片时不会出现 `base64.b64decode(None)` 类错误。
* [x] 图像历史输入的编辑重发保持图像模式并调用画图流程。
* [x] 图像结果、分析消息或图像错误的重试保持图像模式并调用画图流程。
* [x] 项目 TypeScript/build 检查通过。
* [x] 相关后端适配器回归测试通过。

## Definition of Done

* 遵循现有 React 本地状态与 `/api/chat-history` 持久化模式。
* 不引入新依赖。
* 不改变工作区模式、图片管理、提示词广场的既有行为。
* 运行前端构建或等价类型检查。

## Technical Approach

现有 `App.tsx` 已经维护 `chatSessions`、`currentSessionId`、`renamingSessionId`、`renameDraft` 和历史菜单状态；`ChatSidebar` 也已渲染历史条目菜单。实现应复用这些结构，补齐删除确认和更可靠的当前会话重命名状态更新。左侧栏导航由 `sidebarPrimaryActions` 控制，移除其中 `workspace` / “AI 聊天”项即可。

## Decision (ADR-lite)

**Context**: 历史会话已经通过 `chatSessions` 统一持久化到本地缓存和后端聊天历史 API，侧栏主导航则是 `sidebarPrimaryActions` 派生 UI。

**Decision**: 复用现有菜单和持久化链路，不新增全局状态、不新增 API；删除增加浏览器确认，重命名继续通过内联表单提交。

**Consequences**: 变更范围小，和现有架构一致；删除确认是浏览器原生弹窗，后续若需要更精细的品牌化确认框可单独迭代。

## Out of Scope

* 批量删除历史会话。
* 恢复已删除会话。
* 历史搜索结果里的重命名/删除快捷操作。
* 新增后端聊天历史单条删除 API。

## Technical Notes

* 关键文件：`attuno-studio/ui-prototype/src/App.tsx`
* 关键文件：`attuno-studio/ui-prototype/src/components/chat-workspace.tsx`
* 关键文件：`attuno-studio/adapters/google.py`
* 相关规范：`.trellis/spec/frontend/state-management.md`
* 相关规范：`.trellis/spec/backend/generation-contracts.md`
* 本地发现：`handleStartRenameSession`、`commitRenameSession`、`handleDeleteSession` 已存在，应在现有实现上补强而不是重写存储模型。

## Verification

* `python -m pytest tests\test_adapter_factory.py`（在 `attuno-studio` 下运行）通过，覆盖 `b64_json`、data URL、远程 URL 和空图片响应。
* `npm run test:chat-sessions`（在 `attuno-studio/ui-prototype` 下运行）通过。
* `npm run build`（在 `attuno-studio/ui-prototype` 下运行）通过。
* `git diff --check` 通过；仅提示 `chat-workspace.tsx` 下次 Git 触碰时 LF 会转 CRLF。
