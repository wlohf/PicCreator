# 修复二次编辑图生图发送后切到聊天模式

## Goal

修复图像工作区里对已有生成图执行“二次编辑”时，点击发送后错误进入聊天流程的问题。用户在图像模式中基于已有结果或上传参考图继续编辑时，提交必须走图像生成/图生图路径，而不是 `/api/chat` 日常聊天路径。

## What I Already Know

- 用户截图显示顶部仍处于“图像”工作区，底部 composer 也显示图片模型 `gpt-image-2`，但发送后新增的是聊天式“已停止输出”消息，说明提交路由或工作流状态在发送时被错误判断为 chat。
- 前端主逻辑集中在 `attuno-studio/ui-prototype/src/App.tsx`，composer 展示在 `components/chat-workspace.tsx`。
- 项目规范要求 `workspaceMode` 决定 composer 行为：`chat` 只能聊天，`image` 只能生成/编辑图像；历史图像消息编辑/重试必须通过 `runConversationFlow` 和保存的 `generationMode`，不能切到 chat。
- 后端生成接口为 `/api/generate`，图像编辑接口为 `/api/image-edits/*`，聊天接口为 `/api/chat`。

## Requirements

- 在图像工作区、`composerMode === "edit-selected-result"` 时，发送必须走图像工作流。
- 二次编辑没有上传新图时，必须从当前选中的 `activeResult` 构建参考图附件并作为 durable 用户消息附件展示。
- 发送时不得依赖会被同步状态切换影响的最新 `composerMode` / `workspaceMode` 判断；需要在提交入口快照本次发送的工作区和编辑模式。
- 失败返回仍应表现为图像生成错误消息，不应新增聊天回复或聊天停止状态。
- 保持普通聊天发送、普通文生图、上传参考图图生图、历史消息重试/编辑的现有行为。

## Acceptance Criteria

- [ ] 点击生成结果的二次编辑入口后，输入提示词并发送，请求走 `/api/generate` 或图生图生成路径，不调用 `/api/chat`。
- [ ] 未上传新图但选中了已有结果时，发送消息中保留该结果缩略图/来源标签。
- [ ] 图像生成失败时，消息 `workflowMode` 仍为 `image`，不会显示聊天停止/聊天流错误状态。
- [ ] `npm`/TypeScript 构建或项目现有前端检查通过。

## Definition of Done

- 代码改动聚焦在发送路由和图像编辑引用保留。
- 运行聚焦验证，至少覆盖前端类型检查/构建；若无法运行，记录原因。
- 不回滚或夹带当前工作区已有的未提交改动。

## Technical Approach

先定位 `App.tsx` 中 composer submit、`runConversationFlow`、`runDailyChatFlow`、`requestGenerationStream` 和 image-edit API 调用之间的分支。修复点优先放在前端路由判断处，确保发送入口对 `workspaceMode` 和 `composerMode` 做一次性快照，并传入图像工作流，避免状态更新后被误判为 chat。

## Out of Scope

- 不调整模型供应商能力或后端图片返回解析。
- 不重做二次编辑 UI 样式。
- 不改变聊天意图分类规则。
- 不处理上游模型返回空图片的独立问题。

## Technical Notes

- Relevant specs:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/backend/generation-contracts.md`
- `rg` 在当前环境被拒绝执行，使用 PowerShell `Select-String` 进行定位。
