# 图片结果操作按钮与图生图支持确认

## Goal

修正聊天图片结果下方操作栏的重复复制入口，并让用户能从 AI 生成图片结果直接进入二次编辑/图生图流程，同时确认当前项目已有图生图能力范围。

## Requirements

* 在 AI 图片输出操作栏中移除“复制图片 / Copy image”按钮，保留“复制 / Copy”文本输出复制按钮。
* 在 AI 图片输出操作栏中为可编辑的生成图片增加“继续改图 / Edit image”入口。
* 二次编辑入口应复用现有 `edit-selected-result` composer 模式和 `/api/results/{result_id}/edit` 提交流程。
* 点击二次编辑入口时应切换回工作区、进入图像模式、选中源结果，并让输入框呈现“继续修改当前图”的状态。
* 如果当前 render 消息没有可追踪的 `sourceResultId`，不显示二次编辑入口，避免无法提交到后端结果编辑接口。
* 向用户说明项目当前支持图生图/结果续改，但依赖支持 image input / images.edit 的图像模型配置。

## Acceptance Criteria

* [ ] 截图所示 AI 图片输出操作栏不再同时出现“复制”和“复制图片”两个剪贴板按钮。
* [ ] AI 图片输出操作栏中出现“继续改图 / Edit image”按钮。
* [ ] 点击“继续改图 / Edit image”后，composer 切换到图像工作区的改图状态，源图指向该结果。
* [ ] 项目仍能通过现有图片编辑 API 提交二次编辑请求。
* [ ] 前端 typecheck/build 通过，或说明无法运行的原因。

## Definition of Done

* 按前端状态管理规范复用现有状态，不引入新的全局状态。
* 不修改无关后端接口。
* 执行可行的静态检查。

## Technical Approach

前端已经存在 `requestImageEdit`、`requestAnnotatedImageEdit`、`composerMode = "edit-selected-result"`、`handleEditResult` 和结果编辑提交链路。新增聊天结果操作按钮时复用 `handleEditResult(renderMessageDownloadItem)`，并删除 render action row 中的 `handleCopyImage(...)` 按钮即可。

## Decision (ADR-lite)

**Context**: 用户反馈 AI 图片输出操作区有重复复制按钮，并缺少结果级二次编辑入口。  
**Decision**: 保留文本复制按钮，移除图片复制按钮；将现有图片管理中的“继续修改”能力暴露到聊天图片结果操作栏。  
**Consequences**: 聊天结果操作栏更清爽，图生图入口更直接；没有结果 id 的历史/临时图片不显示编辑按钮。

## Out of Scope

* 不新增新的后端图生图接口。
* 不实现新标注编辑画布入口；已有标注编辑流程保持不变。
* 不更改模型能力检测或 provider 配置规则。

## Technical Notes

* 前端操作栏位于 `attuno-studio/ui-prototype/src/App.tsx` 的 render message action block。
* 后端图生图/续改接口已存在：`backend/app/routes/image_edits.py` 下的 `POST /api/results/{result_id}/edit` 和 `POST /api/results/{result_id}/annotated-edit`。
* `backend/app/services/image_edit_service.py` 会检查模型链是否支持参考图输入，不支持时返回“当前画图模型链不支持参考图/图生图输入”。
* 相关规范：`.trellis/spec/frontend/state-management.md`、`.trellis/spec/backend/generation-contracts.md`。
