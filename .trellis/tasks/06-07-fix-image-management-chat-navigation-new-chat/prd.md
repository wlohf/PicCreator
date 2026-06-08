# 修复图片管理跳转与生图中新建对话

## Goal

修复两个会打断用户工作流的前端问题：从图片管理页点击左侧聊天记录应能回到对应聊天；图片生成中的后台任务不应阻止用户新建对话并进入新的聊天会话。

## Requirements

- 在 `activePrimaryView === "image-management"` 时，点击左侧任意历史聊天记录都应切回工作区视图并显示该聊天。
- 即使点击的是当前已选中的会话，也应从图片管理页返回工作区，而不是被早退逻辑拦截。
- 正在图片生成时，左侧“新建对话”按钮保持可点击。
- 新建对话时，如果当前会话已有持久内容或正在生成，应保存当前会话快照并创建/切换到新的空白会话。
- 旧会话中的生图请求继续由原会话 guard/session id 接收进度和最终消息；不要把旧请求结果写入新会话。
- 新会话中的日常聊天提交不应被其他会话的图片生成全局阻塞，但当前可见会话自己的回复/生成仍应按原规则防重复提交。

## Acceptance Criteria

- [ ] 从图片管理页点击当前会话的历史项会返回聊天工作区。
- [ ] 从图片管理页点击其他历史项会返回聊天工作区并加载目标会话。
- [ ] 图片生成进行中时“新建对话”按钮不是 disabled，点击后进入新的空白会话。
- [ ] 后台生成完成时结果仍追加到原始生成会话，而不是当前新会话。
- [ ] 前端类型检查或构建通过。

## Definition of Done

- 按现有 React state/session helper 实现，不引入新全局状态库。
- 不回滚或覆盖当前工作树中与本任务无关的既有修改。
- 更新 Trellis context，并运行可行的前端验证命令。

## Technical Approach

- 调整 `handleOpenSession`：先关闭图片管理/弹层状态；当点击当前 session 时也允许视图回到 workspace，只跳过重新应用 session。
- 调整 `handleResetWorkspace` 和 `ChatSidebar`：移除生图时禁用新建按钮；新建逻辑使用 `currentConversationHasContent()`，该 helper 已把当前可见生成/回复视为 durable content。
- 调整日常聊天入口的 busy guard：只阻止当前会话已有聊天回复，不用全局 `isRendering` 阻止其他会话聊天。

## Out of Scope

- 不改后端生成接口或图片管理批量操作。
- 不新增 URL 路由体系。
- 不处理同时启动多个图片生成任务；本任务只允许生成中切到新对话/聊天，当前生成会话的生图防重复规则保持。

## Technical Notes

- 相关规范：`.trellis/spec/frontend/state-management.md` 的 Primary Views vs Workspace Modes、Conversation State、Image Management State。
- 相关文件：`attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/components/chat-workspace.tsx`。
- 观察到现状：`handleOpenSession` 在 `sessionId === currentSessionId` 时早退，导致当前会话无法从图片管理页返回；`ChatSidebar` 的新建按钮用 `disabled={isRendering}`，`handleResetWorkspace` 也在 `isRendering` 时直接 return。
