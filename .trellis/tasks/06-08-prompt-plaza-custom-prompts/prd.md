# 优化提示词广场布局并支持自定义提示词

## Goal

优化提示词广场的浏览和扩展体验：提示词数量少时卡片不要被拉大；用户能添加或导入自己的提示词；广场内置一批基础示例；没有真实图片素材时移除卡片顶部大块空白图片区。

## What I Already Know

- 用户截图显示提示词卡片在只有 2 个条目时被横向拉成大卡，阅读密度差。
- 卡片顶部有大面积空白/渐变区域，看起来像图片占位，但当前提示词没有真实配图，造成无意义留白。
- 当前广场已有筛选、收藏、复制和使用动作。
- 用户希望可以“自己上传提示词”，这里按可落地 MVP 理解为：支持用户在 UI 中添加提示词，以及通过文本/JSON 文件导入提示词。

## Requirements

- 提示词卡片保持固定/受控宽度；当结果数量少于一行时，不要拉伸填满整行。
- 移除或显著压缩没有真实图片时的卡片顶部大空白区域，保留来源与标签信息。
- 提示词网格在宽屏下应尽量铺满可用行宽，不要在右侧留下突兀空列，同时单张/少量卡片仍保持最大宽度。
- 增加用户自定义提示词入口：
  - 可在广场中手动添加标题、内容、分类、模式等基础字段。
  - 可从本地文件导入提示词，至少支持纯文本；优先兼容 JSON 数组对象；界面只保留一个自定义“导入文件”按钮，不露出浏览器原生文件按钮。
  - 用户添加/导入的提示词应持久化到浏览器本地存储，并作为共享提示词列表展示给所有本机账号。
- 收藏是个人态，按账号分开；提示词本体和点赞数是共享态。
- 每个提示词可点赞；点赞数达到阈值后可进入“社区精选”来源筛选。
- 补充一批基础示例提示词，覆盖图像生成、图生图/修改、中文产品文案、会议总结、资料分析等常用场景。
- 自定义提示词应能参与搜索、筛选、收藏、复制和“使用”。

## Acceptance Criteria

- [x] 收藏或筛选后只剩 1-2 个提示词时，卡片宽度保持与多卡片场景一致，不会拉大成半屏/整屏。
- [x] 提示词卡片不再出现大面积空白图片区；无图时整体高度更紧凑。
- [x] 用户可以在提示词广场添加一个自定义提示词，添加后立即出现在列表中。
- [x] 用户可以导入本地 `.txt` 或 `.json` 提示词文件，导入结果进入列表并可被搜索/收藏/使用。
- [x] 内置示例不少于 8 条，基础场景覆盖图像、聊天、研究和产品文案。
- [x] 只显示一个“导入文件”按钮，不显示浏览器原生“选择文件”控件。
- [x] 提示词卡片支持点赞，点赞达到阈值后进入社区精选；个人收藏和共享提示词数据分开。
- [x] 前端构建或相关测试通过。

## Definition of Done

- 代码改动聚焦在提示词广场数据、状态、样式和验证。
- 不引入后端接口；自定义提示词先使用浏览器本地存储。
- 不回滚或夹带当前工作区已有的未提交改动。

## Technical Approach

定位 `PromptPlazaItem`、提示词列表数据源、收藏状态、搜索筛选与卡片 CSS。将内置提示词和本地自定义提示词合并成展示列表；新增 add/import UI；导入时解析 JSON 数组或纯文本块。CSS 使用固定列宽/`auto-fill` 与 `justify-content: start`，并将卡片视觉区改成紧凑 meta header。

## Decision (ADR-lite)

**Context**: 当前提示词广场把少量卡片拉伸，并为没有图片的提示词保留图片区，导致界面空而不实用。

**Decision**: 提示词卡片按工作台工具卡片处理，保持固定宽度和紧凑信息层级；用户自定义提示词先存储在 localStorage，避免新增后端复杂度。

**Consequences**: 本地自定义提示词暂不跨设备同步；后续如需要账号级提示词库，可迁移到后端 preferences。

## Out of Scope

- 不做账号级云同步。
- 不做图片封面上传。
- 不重做整个提示词广场视觉系统。
- 不增加复杂模板变量编辑器。

## Technical Notes

- Relevant specs:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/frontend/component-guidelines.md`
  - `.trellis/spec/frontend/type-safety.md`
  - `.trellis/spec/frontend/quality-guidelines.md`
- Verification:
  - `npm run build` passed in `attuno-studio/ui-prototype` after the import/grid/like update.
  - Focused static Node check for prompt plaza custom/import/fixed-card/like behavior passed.
  - `npm run test:composer-layout` still fails on an unrelated existing assertion expecting render-message copy to call `handleCopyImage`; current source only copies render text/URL through `handleCopyMessage`.
