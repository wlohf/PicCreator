# 删除对话确认弹窗居中样式

## Goal

将聊天历史中“删除聊天”的确认从浏览器原生 `window.confirm` 改为应用内居中的确认弹窗，视觉接近用户提供的第一张参考图，避免当前页面顶部系统弹窗的体验。

## Requirements

* 删除单个聊天会话时显示应用内居中弹窗，而不是浏览器原生确认框。
* 弹窗包含标题“删除聊天?”、正文“这会删除“<会话标题>”。”和灰色辅助说明。
* 会话标题在正文中加粗，并保留英文界面的等价文案。
* 弹窗使用半透明遮罩/背景虚化、白色圆角面板、取消按钮和红色删除按钮。
* 点击取消、遮罩或 `Esc` 时关闭弹窗，不执行删除。
* 点击删除后沿用现有删除逻辑、状态更新和 toast。

## Acceptance Criteria

* [ ] 删除聊天不会再触发 `localhost ... 显示` 这类浏览器原生确认框。
* [ ] 确认框在视口中央显示，并在桌面与移动宽度下不溢出。
* [ ] 删除确认后仍会移除目标会话，并在删除当前会话时切换到合理的 fallback 会话。
* [ ] 取消确认不会改变聊天会话列表。
* [ ] 前端构建或类型检查通过。

## Definition of Done

* 前端代码只改动删除聊天弹窗相关逻辑和样式。
* 样式符合现有 CSS 变量和组件命名习惯。
* 完成基础验证，无法验证的部分明确说明。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 中增加一个受控的删除会话确认状态。`handleDeleteSession` 只负责打开弹窗，新增确认处理函数复用原有删除状态更新逻辑。弹窗 markup 放在现有 modal 区域附近，样式写入 `attuno-studio/ui-prototype/src/styles.css`。

## Out of Scope

* 不修改图片管理页的批量删除确认框。
* 不引入新的弹窗库。
* 不重构聊天历史侧边栏或删除 API。

## Technical Notes

* 当前删除会话确认位于 `attuno-studio/ui-prototype/src/App.tsx`，使用 `window.confirm`。
* 现有项目使用单文件 `App.tsx` + 全局 `styles.css` 的前端模式，并已有多处应用内 modal 样式可参考。
