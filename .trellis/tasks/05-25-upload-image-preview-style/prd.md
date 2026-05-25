# 调整上传图片预览样式

## Goal

将首页空对话状态下上传图片后的预览，从输入框外/胶囊式文件提示调整为输入框内部的大缩略图卡片样式，贴近用户提供的第二张参考图。

## Requirements

* 上传图片后，预览必须显示在主输入框容器内部顶部区域，而不是脱离输入框显示。
* 有图片附件时，空状态 composer 从紧凑胶囊形态切换为更高的圆角矩形输入容器。
* 图片附件卡片以大缩略图为主，隐藏文件名栏和小圆形缩略图，删除按钮悬浮在图片右上角。
* 底部保留加号、输入文本、模型/语音/发送等现有操作，不改变提交流程或附件状态逻辑。
* 移动端保持可用：容器宽度适配屏幕，缩略图不会撑破布局。

## Acceptance Criteria

* [ ] 空对话上传图片后，`.chatgpt-composer__bar--has-attachments` 内部展示大缩略图卡片。
* [ ] 删除按钮是图片右上角的悬浮圆形按钮。
* [ ] 文件名和顶部小缩略图不会占据卡片视觉空间。
* [ ] 底部输入行仍包含上传、输入、模型/语音/发送控件。
* [ ] `npm run test:composer-layout` 和 `npm run build` 通过。

## Definition of Done

* 前端样式更新完成。
* 轻量布局测试覆盖新增视觉约束。
* 不改动聊天、生图提交或附件合并逻辑。

## Technical Approach

主要调整 `attuno-studio/ui-prototype/src/styles.css` 中靠后的 productized UI 覆盖规则，避免被旧样式覆盖；必要时只增加测试断言，不重构 `App.tsx`。

## Decision (ADR-lite)

**Context**: 现有 JSX 已经把附件渲染进 `.chatgpt-composer__bar`，问题主要来自最终 CSS 覆盖仍将空状态 composer 维持为胶囊形态。

**Decision**: 保留现有 DOM 和状态逻辑，通过 `.chatgpt-composer__bar--has-attachments` 与空状态组合选择器切换为参考图中的大输入框和大缩略图布局。

**Consequences**: 改动范围小，风险集中在响应式视觉；未来如果需要更丰富附件信息，可以再显式调整 JSX，而不是现在引入新组件。

## Out of Scope

* 不改变上传、粘贴、拖拽、提交和清空附件行为。
* 不新增图片裁剪、重命名或多图排序能力。
* 不重做整个首页 composer 视觉系统。

## Technical Notes

* 相关状态：`floorPlanFiles`、`floorPlanPreviews`。
* 相关 JSX：`attuno-studio/ui-prototype/src/App.tsx` 的 `.chatgpt-composer__attachments-inner`。
* 相关 CSS：`attuno-studio/ui-prototype/src/styles.css` 的 productized UI 末尾覆盖规则。
