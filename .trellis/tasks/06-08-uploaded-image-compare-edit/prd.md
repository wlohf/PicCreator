# 支持上传源图参与二次编辑对比分析

## Goal

让用户上传的原始图片在图像工作区中不仅能作为图生图/二次编辑参考图，还能进入当前会话的对比分析候选项，方便用户直接对比“上传源图”和“编辑后结果”。

## What I Already Know

- 用户明确反馈：如果上传一张图片并基于它二次编辑，就必须能把上传图和编辑结果一起做对比分析。
- 当前规范要求对比分析优先从当前聊天路径中的 render 消息构建 A/B 选项，再合并图片库结果。
- 当前 `ChatMessage.attachments` 已可保存提交后的图片附件，且规范要求提交时将文件快照成 durable message attachment，不能依赖 composer blob preview URL。
- 已有任务 `06-08-fix-image-edit-send-mode` 处理二次编辑发送路由问题；本任务专注上传源图进入对比分析资产池。

## Requirements

- 已提交的用户上传图片附件必须作为当前会话的可对比图像候选项。
- 对比候选项应同时包含当前聊天路径里的上传源图附件和生成/编辑结果图。
- 用户基于上传图生成或二次编辑后，打开对比分析时应默认尽量选择“最近的上传源图”作为 A，“最新的生成/编辑结果”作为 B。
- 上传源图候选项应有明确标签，避免和生成结果混淆，例如“上传源图 · 文件名”。
- 候选项需要去重，避免同一张附件重复出现在 A/B 下拉项中。
- 保持已有生成图对比、图片库候选合并、少于两张图时的 floor-plan-vs-render fallback 行为。

## Acceptance Criteria

- [x] 上传一张图片并提交图生图后，当前会话的对比分析选项中出现该上传源图。
- [x] 同一会话中有上传源图和编辑/生成结果时，打开对比分析默认 A/B 分别指向源图和最新结果。
- [x] 用户可手动把上传源图选入 A 或 B 任一槽位，与任意生成结果比较。
- [x] 没有上传源图的旧流程不退化，仍按当前聊天生成图和图片库构建对比候选。
- [x] 前端类型检查或相关测试通过。

## Definition of Done

- 代码改动聚焦于前端对比候选构建和会话附件资产化。
- 不回滚或夹带已有未提交改动。
- 运行聚焦验证；若部分检查无法运行，记录原因。

## Technical Approach

读取 `App.tsx`、`chat-workspace.tsx`、`domain.ts` 和 `chatSessions.ts` 中的图像附件、render 消息、active path、对比模式实现。优先复用 `ChatMessage.attachments` 的 `dataUrl` 作为会话内上传源图 URL，不新增后端资产接口。构建候选项时在当前 active message path 中提取 image-workflow 用户消息附件，再与 render 消息和 `renderHistory` 合并。

## Decision (ADR-lite)

**Context**: 上传图现在作为生成输入存在，但对比分析只看生成结果/图片库，导致用户无法比较源图和二次编辑输出。

**Decision**: 将已提交的上传附件视为会话内 source image asset，进入 compare candidate 列表，并优先用于“源图 vs 最新结果”的默认 A/B 配对。

**Consequences**: 当前实现依赖 message attachment 的 data URL，因此适合会话内对比；长期如需跨会话资产管理，可再增加后端上传资产存储。

## Out of Scope

- 不新增独立的上传图片管理库。
- 不改变后端生成接口或图片上传存储策略。
- 不重做对比分析 UI 样式。
- 不处理模型图生图能力检测以外的问题。

## Technical Notes

- Relevant specs:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/frontend/type-safety.md`
  - `.trellis/spec/frontend/quality-guidelines.md`
  - `.trellis/spec/backend/generation-contracts.md`
- `rg` 在当前环境被拒绝执行，代码定位使用 PowerShell `Select-String`。
- Verification:
  - `npm run build` passed in `attuno-studio/ui-prototype`.
  - Focused static Node check for uploaded-source compare logic passed.
  - `npm run test:composer-layout` still fails on an unrelated existing assertion expecting render-message copy to call `handleCopyImage`; current source only copies render text/URL via `handleCopyMessage`.
