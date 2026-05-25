# 前端视觉系统与布局重构

## Goal

基于当前 Attuno 聊天/图像助手界面的截图和视觉审查结论，重构前端布局、视觉层级和组件状态，让应用从“白卡片堆叠的原型感”提升为更成熟、紧凑、工作台式的 App UI。

## What I already know

* 用户已确认按照前一轮提出的方向实现。
* 当前界面主要问题集中在：左侧栏过宽且像组件陈列、主空状态标题过重、右侧设置 drawer 过宽且表单/按钮组织松散、薄荷绿和阴影使用过散、按钮体系不清晰、移动端设置展开会撑坏侧栏。
* 前端主体位于 `attuno-studio/ui-prototype`，React + Vite + TypeScript，样式集中在 `src/styles.css`，主界面集中在 `src/App.tsx`。
* 项目规范要求聊天页保持固定视口高度，长消息滚动应由 `.chatgpt-thread` 承担，composer 保持在底部或空状态中央区域。
* 当前存在大量未提交改动，需只改本任务相关前端文件，不回滚用户已有改动。

## Assumptions

* 本次不重新设计品牌 logo，不生成新位图资产，主要通过布局、CSS token、组件结构和文案改善完成。
* 不改变聊天、生成、配置保存、模型检测等业务行为，只调整前端呈现和入口组织。
* 已有截图和已确认的文字方案作为本次视觉规格，不额外等待 Figma 设计稿。

## Requirements

* 建立更一致的设计 token：背景、surface、边框、主文字、辅助文字、主色、圆角、阴影。
* 桌面三栏布局收敛宽度：侧栏约 300-328px，主内容 max-width 880-960px，右 drawer 约 420-480px。
* 侧栏改为导航系统：品牌、主导航、最近聊天、底部设置/账号，不再在侧栏中展开大型设置菜单。
* 空状态改为更具体的工作台起点：降低标题重量，提供具体 starter chips，保持输入框为核心操作。
* 右侧设置 drawer 降低视觉权重，统一 header、section、field、button 规则；避免按钮换行和卡片套卡片的廉价感。
* 按钮体系明确 primary / secondary / ghost；导航项、卡片、输入框补齐 hover/focus/selected/disabled 视觉状态。
* 移动端不让设置菜单撑坏侧栏；drawer/面板在窄屏保持可用滚动和清晰层级。
* 保持现有功能入口可达：新对话、图片管理、结果库、记忆与偏好、生成控制、模型与 API、高级功能、提示词设置。

## Acceptance Criteria

* [ ] `npm run build` 在 `attuno-studio/ui-prototype` 通过。
* [ ] 与布局相关的现有测试通过，必要时更新 `test:composer-layout`。
* [ ] 桌面截图中侧栏、主区、右 drawer 比例更协调；右 drawer 不再像半屏表单页。
* [ ] 侧栏设置不再展开成巨大浮层，而是点击具体入口打开右 drawer。
* [ ] 空状态标题、说明、starter chips、composer 间距和层级符合工作台式 App UI。
* [ ] 按钮、导航项、设置项、composer 控件具备统一的 hover/focus/selected 状态。
* [ ] 窄屏下没有明显水平溢出、文字挤压或按钮换行破坏布局。

## Out of Scope

* 不改后端 API、模型配置存储协议或生成流程。
* 不新增大型设计系统依赖或 UI 框架。
* 不重做登录/注册弹窗、图片管理页面的完整信息架构。
* 不做 Figma 文件写入或新视觉概念图生成。

## Technical Notes

* Relevant specs:
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/state-management.md`
  * `.trellis/spec/frontend/type-safety.md`
* Likely files:
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/styles.css`
  * `attuno-studio/ui-prototype/tests/composerLayout.test.ts`
* `rg.exe` 当前在环境中返回 Access denied，使用 PowerShell 检索替代。
* Augment code search indexing failed once with network/service error; use local inspection.
