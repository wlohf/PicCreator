# 修复图生图与局部重绘

## Goal

修复当前项目中基于图片生成图片和对已有图片进行二次局部修改的链路。文生图已经可用，但带图片输入时一直被归因为上游问题；本任务要定位真实原因并让图生图/局部编辑按既有生成契约跑通。

## Requirements

* 标准图像生成在携带参考图时必须把图片作为 `reference_image` 传入图像生成适配器，而不是误当作结构化平面图或丢失图片输入。
* 对已有结果进行二次编辑/局部修改时，必须把原图作为编辑输入传给支持图片输入的图像适配器，并生成新的可展示结果。
* OpenAI Images API 兼容供应商在有图片输入时必须调用 `images.edit`，文生图继续调用 `images.generate`。
* 前端提交图片附件、历史结果编辑和后端 `PromptSet` 字段之间的契约要一致。
* 错误提示应区分真实上游失败和本地请求/能力不匹配失败。

## Acceptance Criteria

* [x] 文生图路径保持可用。
* [x] 上传参考图后提交标准生图，会触发图生图路径并传递 `reference_image`。
* [x] 从已有生成结果发起二次修改，会以源图作为图片输入生成新结果。
* [x] OpenAI Images API 文生图和图生图适配器测试覆盖 `images.generate` / `images.edit` 路由。
* [x] 聚焦的后端/前端测试通过，或记录无法运行的具体原因。

## Definition of Done

* 相关单元/API 测试已补充或更新。
* 运行与本修复相关的测试。
* 不混入无关工作区改动。
* 如发现新的跨层契约，更新或确认 `.trellis/spec/` 是否需要补充。

## Technical Approach

先沿前端请求构造、FastAPI 表单、`generation_service` 上传拆分、`pipeline` 的 `PromptSet` 构造、图像适配器调用这条跨层链路定位问题。修复时优先保留现有 `floor_plans` multipart 字段兼容性，但在后端根据生成模式和输入意图正确拆分 `floor_plan` 与 `reference_image`。

## Out of Scope

* 不重做图像编辑 UI。
* 不新增蒙版绘制工具或独立遮罩文件格式，除非现有局部修改链路已经支持并只需修复传参。
* 不更换供应商或模型。

## Technical Notes

* Relevant spec: `.trellis/spec/backend/generation-contracts.md`
* Relevant spec: `.trellis/spec/frontend/state-management.md`
* Shared guide: `.trellis/spec/guides/cross-layer-thinking-guide.md`
* Root cause found: historical image edit used `render3d` pipeline even though it only had a source result reference image. That forced the structured floor-plan/analysis path instead of the direct image-to-image path.
* Fix: text edit and annotated/local edit now call generation as `standard` with `reference_image`, so OpenAI Images API-compatible providers reach `images.edit`.
* Fix: edit mode frontend validation now accepts uploaded reference images without requiring an active historical result, using the submitted file snapshot.
* Guardrail: unsupported text-only image models now fail with an explicit local capability error instead of silently dropping the reference image.
* Verification: `python -m pytest ...` focused backend/adapter/pipeline tests passed; `npm run test:composer-layout` passed; `npm run build` passed.
