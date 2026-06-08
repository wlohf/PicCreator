# 修复二次编辑残留源图和输出权限

## Goal

修复图像工作区二次编辑体验中的两个缺陷：提交新的改图需求后，composer 不应继续显示上一张源图 chip；已有结果二次改图应和普通生成一样把运行时输出写入可配置的数据目录，避免部署环境下写入 `attuno-studio/outputs` 触发权限错误。

## Requirements

- 图像工作区在 `edit-selected-result` 模式提交后，当前输入框草稿和临时附件被清空，并恢复到 `new-generation` composer 模式。
- 已提交的用户消息仍保留本次源图/上传图预览，不能因为清空 composer 状态导致历史消息里的图片丢失。
- 基于已有结果的 `requestImageEdit` 后端流程必须传入 `record_output_dir`，目录为 `get_user_data_dir(user_id) / "outputs" / normalize_user_id(project_id)`。
- 标注改图复用同一改图管线，也必须走同样的输出目录。
- 权限错误仍返回清晰的 API 错误，不能静默落回仓库 `outputs` 目录。

## Acceptance Criteria

- [x] 二次编辑提交进入等待状态后，输入框顶部不再显示 `源图：...` chip。
- [x] 二次编辑成功或失败后，已提交消息中仍能看到提交时使用的源图附件。
- [x] 后端改图流程调用 `run_pipeline(..., record_output_dir=<runtime data dir>)`。
- [x] 后端测试覆盖改图输出目录位于 `ATTUNO_STUDIO_DATA_DIR` 用户命名空间。
- [x] 前端类型检查/构建通过。

## Definition of Done

- 代码改动尽量局部，沿用现有状态管理和生成服务模式。
- 运行相关后端测试与前端 build/typecheck。
- 若发现新的长期规范，补充 `.trellis/spec/`；否则说明无需更新。

## Technical Approach

- 前端：在 `runConversationFlow` 成功创建提交消息并清空草稿时，如果本次是用户直接从 composer 提交的改图请求，同时把 `composerMode` 设置为 `new-generation`，并更新当前 session 快照，避免会话持久化再次恢复编辑 chip。
- 后端：让 `image_edit_service._run_edit_pipeline` 计算并创建与普通生成一致的输出目录，再把 `record_output_dir` 传给 `run_pipeline`。
- 测试：在已有 backend API 测试旁补充改图路径的 `record_output_dir` 捕获断言。

## Out of Scope

- 不重构整个聊天/图像工作区状态模型。
- 不修改供应商配置、模型能力判定或图像生成核心适配器。
- 不改变历史图片版本链和图片管理 UI。

## Technical Notes

- 相关前端文件：`attuno-studio/ui-prototype/src/App.tsx`。
- 相关后端文件：`attuno-studio/backend/app/services/image_edit_service.py`、`attuno-studio/backend/app/services/generation_service.py`、`attuno-studio/backend/app/services/result_store.py`。
- 相关规范：前端 state-management、backend generation-contracts、deployment-operations、error-handling。
