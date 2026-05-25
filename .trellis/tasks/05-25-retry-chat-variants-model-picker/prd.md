# 重试对话支持替换上下文与模型选择

## Goal

优化聊天回复的重试体验：重试同一轮对话时不再把原用户提示词作为新消息追加进上下文，而是在原 assistant 回复位置生成新的回复版本；用户可以在重试前选择用于重试的分析模型，并在重试后通过版本切换查看旧回复和新回复。

## Requirements

* 点击 assistant 回复下方的重试按钮时，弹出一个轻量小弹窗，而不是立即追加一轮新对话。
* 小弹窗提供“使用当前/指定模型重试”的入口，模型选项应来自现有分析模型选项，不引入硬编码模型列表。
* 执行重试时复用该 assistant 回复之前的对话上下文和对应上一条 user 消息，但不把该 user 消息再次追加到消息列表。
* 重试结果应写回原 assistant 消息，保留旧回复为历史版本，并将最新版本设为当前显示。
* 有多个版本的 assistant 回复下方显示类似 ChatGPT 的版本切换控件，可在旧回复和新回复之间切换查看。
* 重试期间应避免重复触发并保持已有 streaming/错误处理体验。
* 已保存的聊天历史应能持久化回复版本和当前版本索引；旧历史没有版本字段时应继续正常显示。

## Acceptance Criteria

* [ ] 对某条 assistant 回复点击重试后，聊天消息数量不会新增一条重复 user 消息。
* [ ] 重试完成后，原 assistant 消息保留为一个带版本的消息，并默认显示新回复。
* [ ] 同一 assistant 回复有 2 个及以上版本时显示上一条/下一条版本切换按钮与 `当前/总数` 文本。
* [ ] 切换版本只影响当前 assistant 消息的展示，不重新请求接口。
* [ ] 重试弹窗能选择现有分析模型选项；未选择时使用当前分析模型。
* [ ] lint/typecheck 或可用测试通过。

## Definition of Done

* Tests added/updated where practical for changed helper behavior.
* Frontend type-check passes.
* Existing chat history remains backwards compatible.
* No unrelated dirty files are reverted or included.

## Technical Approach

Extend `ChatMessage` with optional `variants` and `activeVariantIndex`. Introduce helpers that resolve active content and safely append a retry variant. Update daily-chat submit/retry flow to support a `retryTargetMessageId` path that truncates request context at the assistant being retried, streams into that existing message, and appends the completed response as a new variant instead of appending a new user turn. Render assistant messages through active-variant helpers and add a retry popover plus version navigation controls near the existing message actions.

## Decision (ADR-lite)

**Context**: Replaying the old prompt as a new user message bloats visible history and request context, and loses the relationship between alternate assistant answers.

**Decision**: Store alternate assistant answers as message-level variants and keep the original user message single. Retry uses the conversation prefix before the target assistant message plus the preceding user message as the request input.

**Consequences**: This keeps history compact and enables local version switching. It adds a small compatibility layer for rendering and persistence because existing messages do not have variants.

## Out of Scope

* Branching entire conversations from an older assistant version.
* Backend chat-history schema migration beyond accepting the existing JSON message payload.
* Web-search retry mode from the screenshot, unless already supported elsewhere.
* Image generation/render retries.

## Technical Notes

* Relevant specs: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/state-management.md`, `.trellis/spec/frontend/component-guidelines.md`, `.trellis/spec/frontend/quality-guidelines.md`, `.trellis/spec/frontend/type-safety.md`.
* Main implementation area: `attuno-studio/ui-prototype/src/App.tsx`, `attuno-studio/ui-prototype/src/types/domain.ts`, `attuno-studio/ui-prototype/src/utils/chatSessions.ts`, `attuno-studio/ui-prototype/src/styles.css`.
* Existing model option contract: chat composer analysis models come from configured `apiConfig.analysisModel` plus user-added detected analysis models.
