# 修复图片上传生成输出权限

## Goal

修复图像模式中上传参考图后生成失败的问题。用户在 composer 中能看到上传缩略图，但生成请求报 `PermissionError: [Errno 13] Permission denied: '/opt/attuno/PicCreator/attuno-studio/outputs'`，导致图片没有进入正常生成/展示流程。

## Requirements

- 上传的参考图必须随当前生成请求进入后端，图生图供应商应收到 `reference_image` 或结构化模式所需的源图。
- 后端不能依赖 Git 工作树内不可写的 `attuno-studio/outputs` 目录作为生产运行写入路径。
- 生成结果、源图和临时产物应优先写入已配置的运行数据目录或确保可写的输出目录。
- 如果输出目录不可写，错误信息应清楚指向运行目录配置或权限问题，不能表现为“图片没上传过去”的静默失败。
- 保持现有聊天展示：用户消息中的上传图应像参考截图二那样在消息区可见。

## Acceptance Criteria

- [ ] 图像模式带上传图提交时，前端请求包含上传图文件。
- [ ] `standard` + 支持图生图模型时，后端将上传图作为参考图传给图像生成管线。
- [ ] `render3d` / `colored_floor_plan` 继续将上传图作为 floor plan 使用。
- [ ] 生产路径 `/opt/attuno/PicCreator/attuno-studio/outputs` 不可写时，请求不再因为直接创建该目录而失败。
- [ ] 后端测试或针对性检查覆盖输出目录选择和上传图映射。

## Definition of Done

- 相关前后端代码完成，接口字段保持一致。
- 运行受影响的后端测试和前端类型/构建检查中可行的部分。
- 如发现服务器还需要权限调整，明确给出部署侧操作建议。

## Out of Scope

- 不重做整套上传 UI。
- 不调整供应商配置保存逻辑。
- 不修改模型能力判断规则，除非当前 bug 必需。

## Technical Approach

先定位 `/api/generate` 的 multipart 提交流程和后端 `outputs` 路径来源；若前端已经正确传文件，则重点修复后端输出目录解析，优先使用 `ATTUNO_STUDIO_DATA_DIR` / `.render-agent-data` 下的可写目录。同步检查 `standard` 图生图与结构化 floor-plan 模式对上传图字段的映射。

## Technical Notes

- 相关规范：`.trellis/spec/backend/generation-contracts.md`、`.trellis/spec/backend/deployment-operations.md`、`.trellis/spec/guides/cross-layer-thinking-guide.md`。
- 相关历史任务：`.trellis/tasks/05-25-fix-chat-image-upload-context/prd.md`。
