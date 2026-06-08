# 去掉二次修改输入框线条

## Goal

去掉聊天历史消息二次修改/原位编辑输入框里出现的内部线条框，让编辑态视觉只保留外层消息气泡和底部取消/发送按钮。

## Requirements

* 历史用户消息进入编辑态时，`textarea` 不显示自身边框、focus 线、阴影或右下角 resize 手柄。
* 保留现有编辑、取消、发送、键盘提交、自动聚焦交互。
* 改动范围限制在消息内联编辑输入框，不影响底部主输入框、设置弹窗、提示词广场等其它文本域。

## Acceptance Criteria

* [ ] `.message-inline-editor textarea` 常态和聚焦态都没有内部线条框。
* [ ] 取消/发送按钮仍可正常展示。
* [ ] 前端构建或类型检查通过。

## Definition of Done

* 只做必要样式修改。
* 不回滚已有未提交改动。
* 运行可行的前端校验。

## Technical Approach

在 `attuno-studio/ui-prototype/src/styles.css` 中增强 `.message-inline-editor textarea` 选择器，显式关闭浏览器默认 appearance、border、outline、box-shadow 和 resize，并添加聚焦态覆盖。

## Out of Scope

* 不改消息编辑业务逻辑。
* 不调整其它输入框样式。

## Technical Notes

* 目标 JSX 位于 `attuno-studio/ui-prototype/src/App.tsx` 的 `message-inline-editor`。
* 目标样式位于 `attuno-studio/ui-prototype/src/styles.css` 的 `.message-inline-editor textarea`。
