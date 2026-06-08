# 修复重试覆盖与历史版本切换

## Goal

修复聊天和图像模式的重试行为：用户点击重试后，新的 AI 回复应替换当前可见的上一条 AI 回复位置，并保留旧回复为可切换历史版本，避免把同一轮请求再次追加到上下文里导致聊天记录越来越长。

## Requirements

* 重试普通聊天回复时，不追加重复的用户消息，也不在可见线程末尾追加新的 AI 消息。
* 重试图像模式中的 AI 分析、生成状态或错误回复时，也应在原 AI 回复位置形成版本切换，而不是新增一段重复输出。
* 同一条 AI 回复存在多个重试版本时，消息操作栏显示类似 `1/2`、`2/2` 的版本计数和左右箭头，允许查看旧版本和当前版本。
* 默认展示最新重试结果；切换旧版本只影响该消息的可见内容，不破坏会话主分支。
* 复制、渲染、上下文构建、持久化应读取当前激活版本，兼容没有 `variants` 的旧消息。

## Acceptance Criteria

* [ ] 点击 AI 回复上的“重试”后，可见消息数量不因为同一次用户输入增长。
* [ ] 重试成功后，同一 AI 消息显示最新内容，并出现版本切换控件。
* [ ] 版本切换控件可以在旧回复和新回复之间切换，并显示正确计数。
* [ ] 聊天模式和图像模式的重试路径都使用相同的消息版本机制。
* [ ] 前端类型检查通过，相关测试或最小验证通过。

## Definition of Done

* 更新前端消息状态/渲染逻辑。
* 补充或调整覆盖重试版本行为的测试。
* 运行可用的 lint/typecheck/test 验证。
* 如发现可沉淀的新规范，更新 `.trellis/spec/`；否则记录无需更新。

## Technical Approach

优先复用前端状态规范中已有的 `ChatMessage.variants`、`activeVariantIndex` 和 `withActiveMessageVariant` 约定。实现应把重试结果写回目标 assistant 消息的 variants，并让操作栏显示消息级版本导航。对于仍采用树状分支的会话结构，重试行为应避免创建新的可见消息分支导致上下文膨胀。

## Out of Scope

* 不重构整个聊天树结构。
* 不新增后端 API。
* 不改变用户编辑消息、分支对话和新建对话的既有语义，除非它们直接依赖重试结果。

## Technical Notes

* 相关规范：`.trellis/spec/frontend/state-management.md`
* 重点文件预计包括：`attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/components/chat-workspace.tsx`、`attuno-studio/ui-prototype/src/utils/chatSessions.ts`、`attuno-studio/ui-prototype/src/types/domain.ts`
* 用户截图说明：当前图像模式重试会在下方再次输出新的 AI 信息；目标样式类似消息操作栏中的左右箭头和 `2/2` 版本计数。
