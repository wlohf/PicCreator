# 修复聊天图片上传与上下文污染

## Goal

修复日常聊天中上传图片后模型看不到图片的问题，并排查 AI 回复是否错误携带了全局聊天历史或跨分支上下文，确保用户上传的图片只进入当前提交，聊天请求只使用当前会话当前分支的线性上下文。

## What I Already Know

- 用户截图显示：图片预览已出现在 composer 内，但 AI 回复称“没有看到实际图片内容”，并凭空描述“红色裙子的成熟御姐风美女”。
- 这通常说明前端只展示了图片缩略图，没有把图片内容传给 `/api/chat` 或后端没有把图片转成模型可识别的多模态消息。
- 项目规范要求模型 API 请求从 `getActiveMessagePath(...)` 构建线性上下文，不能从整个存储消息树构建。
- 项目规范要求聊天记忆候选必须手动确认后才持久化，不能静默把每条聊天消息写入长期记忆。

## Requirements

- 日常聊天提交带图片时，当前用户消息必须包含图片附件信息，并且请求后端时要把图片作为多模态输入传给分析模型。
- 后端 `/api/chat` 和 `/api/chat/stream` 在调用配置的分析模型时，必须保留当前用户消息中的图片输入。
- 聊天模型上下文只能来自当前会话当前分支的线性消息路径，不能包含其他会话、其他分支或全局历史。
- 如果当前模型/供应商不支持图片输入，前端或后端必须明确报错，不能生成看似看过图片的猜测回复。
- 保持现有图片生成工作区附件流程不回退。

## Acceptance Criteria

- [ ] 前端提交带图片的日常聊天时，请求 payload 包含当前图片附件数据。
- [ ] 后端将图片附件转换为 OpenAI-compatible/Responses-compatible 可识别的 `image_url` 多模态内容。
- [ ] 流式与非流式聊天都支持同一套图片输入路径，或明确共享同一构建函数。
- [ ] 请求上下文由当前 active message path 构成，不遍历整棵消息树。
- [ ] 静态/单元测试覆盖图片聊天 payload、当前分支上下文、以及没有本地固定兜底回复。

## Definition of Done

- 相关前后端代码完成并保持类型一致。
- 运行可用的前端测试和后端测试，至少覆盖受影响路径。
- 若发现实际是配置或模型能力导致，需要在结果里说明具体原因和用户可操作检查项。

## Out of Scope

- 不重做图片生成工作区整体上传体验。
- 不新增自动长期记忆功能。
- 不实现跨供应商完整视觉能力探测 UI，只做当前问题所需的能力边界和错误处理。

## Technical Notes

- 需要检查：`attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/api.ts`、`attuno-studio/ui-prototype/src/utils/chatSessions.ts`、`attuno-studio/backend/app/routes/chat.py`、`attuno-studio/adapters/openai_compat.py`。
- 相关规范：`.trellis/spec/frontend/state-management.md`、`.trellis/spec/backend/generation-contracts.md`、`.trellis/spec/backend/error-handling.md`。
