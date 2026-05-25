# Move Homepage Prompt Above Composer

## Goal

把空会话首页的主标题“你在忙什么？”放到聊天输入框正上方，让标题和真实输入区形成一个紧凑的首屏组合，而不是停留在页面上方的空状态区域。

## Requirements

* 空会话时，标题显示在聊天框正上方，并与输入框水平对齐。
* 标题与输入框的垂直距离应紧凑，避免看起来仍停留在页面上方空状态区。
* 保留现有空会话输入 placeholder、模型选择、发送按钮和快捷入口行为。
* 空状态输入框右侧模型名称不能溢出圆角输入栏或压到发送按钮外。
* 非空会话时不改变消息列表和 composer 的业务逻辑。
* 移动端不能出现标题、输入框、快捷入口重叠或横向溢出。

## Acceptance Criteria

* [x] 空会话首页标题位于真实 composer 正上方。
* [x] 标题与输入框之间使用紧凑间距。
* [x] 空会话输入框仍显示“有问题，尽管问”/“Ask anything”。
* [x] 空状态模型名称不会溢出输入栏右侧。
* [x] 标题和输入框宽度在桌面端视觉对齐，移动端自然收缩。
* [x] `npm run build` 通过。

## Definition of Done

* 仅修改前端布局和样式相关代码。
* 不覆盖或整理本轮之前已经存在的未提交 WIP。
* 运行前端 build 验证。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 中把空会话标题从 thread 空状态移动到 composer 区域正上方；在 `attuno-studio/ui-prototype/src/styles.css` 中调整空状态 thread 占位和 composer 空状态标题的间距、宽度和响应式规则。

## Out of Scope

* 不调整聊天提交、模型选择、历史记录、图片生成流程或后端 API。
* 不重构 composer 组件结构以外的页面布局。

## Technical Notes

* 当前标题渲染在 `chatgpt-empty__copy` 内。
* 当前空会话 placeholder 由 `visibleComposerPlaceholder` 控制。
* 需要复用现有 composer，避免新增一个假的输入框。
