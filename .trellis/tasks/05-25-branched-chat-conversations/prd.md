# Branched Chat Conversations

## Goal

把当前聊天系统从纯线性 `messages` 数组升级为支持 ChatGPT 风格分支对话的树结构。用户继续看到一条从 root 到当前活跃消息的线性路径，但历史编辑、重新生成和新聊天分支都要保留原分支，不能覆盖已有消息。

## Requirements

- `ChatMessage` 增加 `parentId: string | null`。旧历史没有该字段时，加载时按原数组顺序自动补齐父子链。
- `ChatSessionRecord` 增加 `activeMessageId: string | null`。当前聊天窗口只渲染从 root 到 `activeMessageId` 的路径。
- 发送新 user message 时，`parentId` 等于当前 session 的 `activeMessageId`；assistant 回复的 `parentId` 等于刚创建的 user message id；回复完成后 `activeMessageId` 指向最新 assistant message。
- 编辑历史 user message 时，不覆盖原消息；在原消息的 `parentId` 下创建一个新的 user sibling，并基于它生成新的 assistant 回复。
- 重新生成 assistant 回复时，不覆盖原 assistant message；在同一个 user parent 下创建一个新的 assistant sibling，并将 `activeMessageId` 切到新 sibling。
- 当某个 parent 下有多个 children 时，在路径中对应的 message 旁显示分支切换控件，形如 `1 / 3` 和左右箭头。切换后更新 `activeMessageId` 到所选 sibling 的后代路径末端，后续提交从该分支继续。
- 实现 `Branch in new chat`：从选中 message 回溯到 root，复制该路径到新的 conversation；新 conversation 有新的 session id 和 message id，之后独立继续。
- 发送给模型的上下文必须仍是线性 path，不发送整棵树。日常聊天请求需要包含当前路径中可表达为文本的 user/assistant 消息。
- 保持现有图片生成/改图对话消息也参与分支树；render/analysis/error 消息作为 assistant 节点保留在当前路径上。
- 保持旧 `variants` 数据可读：加载旧历史时可继续显示；新重试逻辑应使用 sibling 分支而不是 `variants`。

## Acceptance Criteria

- [ ] 新建空会话后 `activeMessageId` 为 `null`；第一次发送 user/assistant 后形成 `user(parent=null) -> assistant(parent=user)`。
- [ ] 在已有 assistant 后继续发送消息，新 user 的 `parentId` 等于当前活跃 assistant id。
- [ ] 重试一个 assistant 回复会新增 assistant sibling，不修改原 assistant；UI 可在 sibling 间切换并显示 `1 / N`。
- [ ] 从历史 user message 编辑/重发会新增 user sibling，不修改原 user；新 assistant 回复挂到新 user 下。
- [ ] `messages.map` 不再直接渲染整棵树，只渲染 active path。
- [ ] `Branch in new chat` 会创建只包含所选路径的新会话，源会话保持不变，新会话能独立继续。
- [ ] `/api/chat` 请求上下文包含当前 active path 的线性 `messages`，后端构造模型消息时使用该线性上下文。
- [ ] 旧的线性历史记录加载后不丢消息、不空白，标题/持久内容判断仍正常。
- [ ] 前端 `npm run test:chat-sessions` 和 `npm run test:composer-layout` 通过；可行时运行 `npm run build`。

## Technical Approach

- 在 `utils/chatSessions.ts` 添加树辅助函数：
  - 规范化消息父链和 session 活跃指针；
  - 从 `messages` + `activeMessageId` 计算 active path；
  - 查找 siblings、切换 sibling 时选择该 sibling 子树里的默认末端；
  - 复制路径到新会话时重新生成 message id 并重写 parentId。
- `App.tsx` 仍保留平铺 `messages: ChatMessage[]` 作为存储形态，但新增 `activeMessageId` state/session 字段；渲染和标题等可见逻辑使用 active path。
- 新增/更新消息时显式设置 parentId，并通过统一 helper 推进 activeMessageId。
- 重试从 `variants` 改为 sibling append；旧 `variants` helper 保留给历史兼容和局部显示，但不再作为新重试的数据模型。
- 对模型 API：前端在 `context.messages` 中传 active path 的文本上下文；后端 `_daily_chat_messages` 把该路径转换成标准 role/content 列表，并只把当前 user message 放在末尾一次。

## Decision (ADR-lite)

**Context**: 现有会话已经以 `messages: ChatMessage[]` 存到本地和 `/api/chat-history`，一次性改成嵌套 children 会造成大范围迁移和更新复杂度。

**Decision**: 使用平铺节点数组表示树：每个 message 有 `parentId`，conversation/session 记录 `activeMessageId`。渲染、上下文和分支切换都通过 helper 从平铺节点派生路径。

**Consequences**: 迁移成本低、与现有 merge/update 工具兼容；需要严格避免业务代码继续把数组顺序当成可见路径，因此测试要覆盖 active path 和 sibling 切换。

## Out of Scope

- 不新增后端数据库结构或持久化表；继续使用现有 chat history payload。
- 不实现完整富文本编辑器；历史 user message 的“编辑”可以用现有 composer/重发路径承载，核心是不能覆盖原消息。
- 不改变图片结果管理和 result versioning 结构。
- 不把整棵树发送给模型，也不让模型自动理解隐藏分支。

## Technical Notes

- 主要文件：
  - `attuno-studio/ui-prototype/src/types/domain.ts`
  - `attuno-studio/ui-prototype/src/utils/chatSessions.ts`
  - `attuno-studio/ui-prototype/src/App.tsx`
  - `attuno-studio/ui-prototype/src/api/chat.ts`
  - `attuno-studio/backend/app/routes/chat.py`
  - `attuno-studio/ui-prototype/tests/chatSessions.test.ts`
  - `attuno-studio/ui-prototype/tests/composerLayout.test.ts`
- Relevant specs:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
  - `.trellis/spec/guides/code-reuse-thinking-guide.md`
