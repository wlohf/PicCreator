# 优化图片发送状态和画图错误提示

## Goal

优化图像工作台中“图片已作为消息发送后仍停留在输入框”的体验，并将画图上游失败的原始 JSON/网关错误收敛为用户可理解的提示。用户会自行处理画图服务/key 问题，本任务只处理项目前端表现和状态一致性。

## What I already know

- 用户截图显示：用户消息气泡已经包含上传图片，但 composer 里仍保留同一张图片预览。
- 同一截图显示出图失败原因包含 `Upstream gateway error` / `upstream_error` / `Upstream request failed` 等上游网关错误。
- 前端规范要求区分 durable conversation content 和 transient composer state：已提交消息属于 durable content，composer 附件属于 transient content。
- `attuno-studio/ui-prototype/src/App.tsx` 维护 `floorPlanFiles` 和 `floorPlanPreviews`，并已有 `clearComposerDraft()`。
- `attuno-studio/ui-prototype/src/api/generation.ts` 将 SSE `error` 事件中的 `data.error` 直接抛给 UI。

## Assumptions

- 图片发送后应保留在已提交用户消息里，但从 composer 附件预览中清空，避免重复/误导。
- 失败时不恢复已发送图片到 composer；用户可从消息历史看到本次输入，并可重新上传/重试。
- 上游服务失败应在 UI 中显示友好摘要，同时保留简短技术原因供排查。

## Requirements

- 成功创建用户消息并发起生成后，清空 composer 中已提交的图片附件和输入文本。
- 如果提交前校验失败，不清空附件。
- 如果用户还没发送，只点击附件卡片上的移除按钮，现有移除行为保持不变。
- 出图失败时不要把 `image_generation_error: InternalServerError: {...}` 这种长 JSON 原样展示在聊天气泡主文案中。
- 对 `Upstream gateway error`、`upstream_error`、`Upstream request failed`、`InternalServerError` 等上游失败特征显示友好中文/英文提示。
- 保留足够短的原始技术原因，方便用户排查供应商/key/网关问题。

## Acceptance Criteria

- [ ] 发送图像生成请求后，composer 附件区不再显示已发送的图片。
- [ ] 已发送用户消息仍展示该图片附件。
- [ ] 图像生成失败时，聊天窗口显示友好错误文案，而不是完整原始 JSON/SSE 错误。
- [ ] TypeScript build 通过。
- [ ] 相关前端测试通过或说明无法运行原因。

## Out of Scope

- 不修复上游画图供应商、key、模型权限、代理网关本身的问题。
- 不改后端生成链路和模型切换策略，除非前端类型/测试必须同步。
- 不新增“自动重试”或“重试按钮”能力。

## Technical Notes

- Relevant specs:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/frontend/type-safety.md`
  - `.trellis/spec/frontend/quality-guidelines.md`
  - `.trellis/spec/guides/index.md`
- Likely files:
  - `attuno-studio/ui-prototype/src/App.tsx`
  - `attuno-studio/ui-prototype/src/api/generation.ts`
  - Existing frontend tests under `attuno-studio/ui-prototype/tests/`
