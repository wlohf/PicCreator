# 精简首页顶部提示样式

## Goal

把项目首页空会话状态从多段说明和卡片式入口，收敛为更轻的首屏入口：只保留一行标题，并参考用户提供的第二张图，呈现居中的圆角输入栏和少量胶囊快捷入口。

## Requirements

* 空会话顶部只保留一行主标题，去掉 badge、副标题长文和三张说明卡。
* 新空状态视觉参考图二：标题居中、下方是一条宽圆角输入式操作栏，再下方是三个胶囊快捷按钮。
* 保留现有入口行为：点击输入式操作栏聚焦真实输入框，快捷按钮继续触发现有生成图片、写作/编辑、查找资料/结果等动作。
* 只调整首页空状态的展示和样式，不改聊天提交、模型选择、历史结果、设置面板等业务逻辑。
* 移动端不能出现文字重叠或横向溢出。

## Acceptance Criteria

* [ ] 空会话首页不再展示顶部 badge、长说明段落、三张大卡片和旧的三按钮操作区。
* [ ] 首屏顶部文案只有一行标题：中文为“你在忙什么？”，英文为“What are you working on?”。
* [ ] 空状态展示一条居中的圆角输入栏，点击后聚焦底部真实 composer。
* [ ] 三个胶囊快捷入口点击行为可用，并复用现有处理函数。
* [ ] `npm run build` 通过。

## Definition of Done

* 前端代码和样式按现有 React + CSS 文件结构落地。
* 类型检查和 Vite build 通过。
* 不整理或覆盖本轮之前已经存在的未提交 WIP。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 的空会话分支内替换 `chatgpt-empty` 的内容结构，新增轻量的 `chatgpt-empty__prompt` 和 `chatgpt-empty__suggestions` 元素。样式在 `attuno-studio/ui-prototype/src/styles.css` 的最终产品化样式段覆盖旧的空状态卡片布局，保证后置规则生效。

## Out of Scope

* 不重构真实 composer。
* 不调整后端 API、模型配置、历史结果存储或设置弹窗。
* 不清理当前工作区已有的大量未提交变更。

## Technical Notes

* 相关代码集中在 `attuno-studio/ui-prototype/src/App.tsx` 空会话渲染分支。
* 最终生效样式集中在 `attuno-studio/ui-prototype/src/styles.css` 靠后的 Productized app UI 段和对应 media query。
* 用户参考图二表现为 ChatGPT 风格居中标题、输入栏和胶囊快捷入口。
