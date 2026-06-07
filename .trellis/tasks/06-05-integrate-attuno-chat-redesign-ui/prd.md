# Integrate attuno chat redesign UI

## Goal

将根目录 `attuno-chat-redesign.html` 里的 Open Design 前端样式和交互结构，继续融合到当前 `attuno-studio/ui-prototype` React 前端中，保持现有后端接口和 API 请求逻辑不变。

## Requirements

* 详细对照 `attuno-chat-redesign.html` 与当前 React UI，优先复用其 CSS 视觉语言、侧栏布局、导航结构、历史列表与设置入口交互。
* 保留当前项目已有的后端接口接入、认证、聊天历史、图片管理和设置数据流，不改动 Python 后端 API 逻辑。
* 重点补齐当前未完全接入的部分：左侧导航栏布局、左下角设置按钮/用户卡样式、侧栏折叠与移动端表现一致性。
* 当前已有接入部分不做大重写；在现有 React 组件与 `styles.css` 中小范围调整，避免破坏已可用功能。
* 使用当前项目已有 `lucide-react` 图标体系替代手写 SVG。

## Acceptance Criteria

* [ ] 左侧侧栏结构接近参考 HTML：品牌区、新建对话、主导航、历史搜索/分组、底部用户卡与设置按钮。
* [ ] 左下角设置入口视觉与参考 HTML 一致，并继续打开当前项目设置弹窗。
* [ ] 导航按钮状态、hover、active、折叠状态和移动端侧栏不出现文本溢出或错位。
* [ ] 现有聊天、图片管理、设置、登录和后端请求逻辑不变。
* [ ] `npm run build` 通过。
* [ ] 用浏览器/截图检查桌面和移动端关键界面。

## Definition of Done

* 前端代码改动集中在 React UI 与 CSS。
* 不引入新的后端接口或破坏现有 API client。
* 构建通过，必要时补充轻量回归测试。
* 记录如有新发现的项目 UI 约定。

## Technical Approach

从 `attuno-chat-redesign.html` 中提取仍未对齐的侧栏和设置入口设计，映射到 `attuno-studio/ui-prototype/src/App.tsx` 的现有状态和事件处理。CSS 以当前 `styles.css` 为主，补齐参考 HTML 的布局尺寸、按钮状态、历史分组和底部用户卡样式。

## Out of Scope

* 不重写后端 API、认证、配置存储或聊天历史持久化。
* 不把静态 HTML 直接替换为单页 React 应用。
* 不新增大型 UI 框架或改变构建工具。
* 不重新设计设置弹窗全量内容，除非为入口一致性必须调整。

## Technical Notes

* 参考源：`attuno-chat-redesign.html`
* 目标前端：`attuno-studio/ui-prototype`
* 当前 Trellis specs：`.trellis/spec/frontend/index.md`、`.trellis/spec/frontend/state-management.md`、`.trellis/spec/guides/index.md`
* 本环境没有可用 `spawn_agent/wait_agent` 工具；实现会在主会话内联完成，但仍保留 Trellis 任务上下文。
