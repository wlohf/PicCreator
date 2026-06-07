# Claude + Runway 视觉适配当前聊天生图界面

## Goal

在不改变底层业务逻辑和现有信息架构的前提下，把当前聊天/生图界面适配为 Claude + Runway 方向：主体验保留温暖、耐看的聊天平台气质，图片生成结果和预览加入更聚焦的创作展示感。

## Requirements

* 保留当前布局骨架：左侧历史/账户、顶部模型与聊天/图像切换、中间消息线程、底部输入框、右侧设置/短语抽屉。
* 不改后端、API、状态流、提交逻辑、生成逻辑、历史逻辑和数据结构。
* 主要通过前端视觉层调整：颜色 token、边框、表面、按钮、输入框、消息气泡、图片结果卡、模态预览、hover/focus/active/disabled 状态、轻量动效。
* 主界面采用 Claude 风格的暖米白画布、暖珊瑚强调色、柔和分隔线和耐读文本。
* 图片结果、生成进度和大图预览借鉴 Runway：更突出图片内容，背景更沉稳，悬停反馈更像创作预览。
* 不直接套用预览 mockup，不大幅重排现有界面。

## Acceptance Criteria

* [ ] 当前 `chatgpt-*` 布局结构基本不变。
* [ ] 常规聊天模式和图像模式都使用同一套暖色视觉系统。
* [ ] 输入框、模式切换、历史项、账号菜单、设置弹窗都有清晰 hover/focus/active 状态。
* [ ] 图片结果卡和放大预览更突出图片，不影响复制、下载、对比、继续编辑等原有动作。
* [ ] 构建或相关轻量测试通过。

## Definition of Done

* 只改前端 UI 相关文件。
* 不引入新的业务逻辑分支。
* 本地构建通过。
* 可视化检查没有明显文字溢出、重叠或不可点击控件。

## Technical Approach

以 `awesome-design-md` 的 `claude` DESIGN.md 作为主色/表面/按钮/输入框参考，以 `runwayml` DESIGN.md 的图片内容优先、弱 UI 干扰和深色预览气质作为图片结果区补充。优先在 `attuno-studio/ui-prototype/src/styles.css` 的现有 Productized app 覆盖层后追加主题覆盖，避免修改 React 组件逻辑。

## Out of Scope

* 不新增功能。
* 不重构 `App.tsx`。
* 不改变布局为预览对比板样式。
* 不使用品牌官方素材，也不声明官方 affiliation。

## Technical Notes

* 风格参考来自本地 `awesome-design-md` skill。
* 已完成对比板预览产物：`.trellis/tasks/06-04-chat-image-style-preview/preview/`
* 当前实际实现目标：`attuno-studio/ui-prototype/src/styles.css`
