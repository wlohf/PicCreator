# 重构聊天画图页面组件化视觉实现

## Goal

以 Open Design 原型 `attuno-chat-redesign` 为视觉目标，在当前 React/Vite 技术栈内重新实现聊天画图页面。实现必须保持现有聊天、图片生成、改图、会话历史、图片管理、供应商设置等业务链路可用，同时把页面拆成更清晰、可维护的组件结构。

## What I already know

* 用户明确要求：参考 open-design 原型，也就是 `attuno-chat-redesign` 文档；不要直接复制 HTML。
* 当前前端入口是 `attuno-studio/ui-prototype/src/App.tsx`，样式集中在 `src/styles.css`。
* 当前技术栈是 React 18、Vite、TypeScript、lucide-react，无额外 UI 框架。
* open-design 原型视觉关键词：暖象牙主画布、柔和米色侧栏、陶土色重点操作、固定左会话栏、顶部模型/模式工具条、中间聊天流、底部 composer、右侧面板/弹窗。
* `brand-spec.md` 提供了 Attuno 色彩、字体、布局姿态：暖色背景、少硬边框、多 tonal surface/spacing/shadow，暗色模式保持棕黑温度。
* 当前项目已有复杂状态：`workspaceMode`、`primaryView`、`messages`、`activeMessageId`、`renderHistory`、`activeUtilityPanel`、`composerMode`、生成流和聊天流。
* 前端规范强调：app shell 固定视口高度，`.chatgpt-thread` 是主要滚动容器；聊天模式和图像模式分离；图片管理是 full-page primary view。

## Assumptions

* 本任务只重构聊天画图页面前端 UI 结构和样式，不改后端 API 协议。
* 视觉实现可以提取原型的 token、布局、密度、交互意图，但不能粘贴原型 HTML/JS。
* 业务逻辑优先保留在现有 `App.tsx` 状态层，先把可复用 UI 段落组件化，避免一次性重写整个应用状态。

## Requirements

* 基于当前 React/TypeScript 代码实现，不引入新的重型 UI 框架。
* 创建清晰的聊天画图页面组件边界，例如 shell、sidebar、header、thread、empty state、composer、drawer 等。
* 使用 lucide-react 图标表达工具按钮，避免文本堆叠式工具栏。
* 视觉上贴近 `attuno-chat-redesign`：暖色主题、左侧会话栏、顶部模式/模型区、中心聊天工作区、底部 composer、右侧上下文工具区。
* 保留现有功能入口：新会话、历史会话切换、聊天/图像模式切换、图片管理、设置/供应商、上传附件、发送、停止生成、快捷短语、改图模式、结果预览/对比。
* 保持前端状态契约：聊天内容滚动在 thread 内，composer 固定在底部；empty state 不因草稿文本退出；图片管理是 primary view。
* 保持响应式：桌面三栏/两栏布局，移动端主工作区优先，侧栏和 drawer 不造成页面整体溢出。
* 不直接复制 open-design HTML、脚本或 DOM 结构。

## Acceptance Criteria

* [ ] 页面主结构拆成组件化实现，`App.tsx` 的 JSX 渲染区明显更易读。
* [ ] 当前聊天、生成、改图、图片管理、设置、会话历史功能入口仍然连接到原有 handler/state。
* [ ] `npm run build` 通过。
* [ ] 现有布局回归测试 `npm run test:composer-layout` 通过，必要时更新测试以匹配新结构但保留滚动边界要求。
* [ ] 新 CSS 使用 Attuno/open-design 风格 token，避免直接粘贴原型 HTML/CSS 大段结构。
* [ ] 桌面和移动视口没有明显文本重叠、主页面不随消息增长整体滚动。

## Out of Scope

* 不重写后端生成、聊天、配置或结果 API。
* 不实现 open-design 原型里所有静态演示功能，如完整提示词市场、模拟 provider catalog、原型专用 toast 脚本。
* 不新增登录/计费等产品能力。
* 不把当前应用改成 HTML 原型或 image-only 页面。

## Technical Notes

* Open Design project: `a6314a41-dbc7-40ee-b844-040303509548`
* Visual target files: `attuno-chat-redesign.html`, `brand-spec.md`
* Current frontend files likely touched:
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/styles.css`
  * new components under `attuno-studio/ui-prototype/src/components/`
  * possible focused tests under `attuno-studio/ui-prototype/tests/`
* Relevant specs:
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/state-management.md`
  * `.trellis/spec/frontend/component-guidelines.md`
  * `.trellis/spec/frontend/quality-guidelines.md`
  * `.trellis/spec/frontend/type-safety.md`
