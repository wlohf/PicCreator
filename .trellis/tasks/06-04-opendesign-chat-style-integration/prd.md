# 融合 OpenDesign 聊天前端样式

## Goal

把当前目录下的 `attuno-chat-redesign.html` 作为视觉参考，迁移到现有 `attuno-studio/ui-prototype` React 前端中，让真实应用的聊天工作台呈现 OpenDesign 原型中的 Attuno 暖色聊天 SaaS 风格，同时保留现有业务交互、状态管理、聊天/生图流程和组件结构。

## What I already know

- 用户已经用 OpenDesign 生成了 `attuno-chat-redesign.html`，希望“按照这个样式去修改前端代码”并结合当前项目。
- 当前前端是 `attuno-studio/ui-prototype` 下的 Vite + React 应用，入口样式文件是 `src/styles.css`，主聊天壳层在 `src/App.tsx` 中使用大量 `chatgpt-*` 类名。
- 现有 `App.tsx` 和 `styles.css` 已经有未提交改动，不能回退或覆盖无关业务变更。
- `styles.css` 末尾已经存在一段之前追加的暖色主题覆盖块，本次应在其基础上继续融合 OpenDesign 的 Attuno 原型细节。
- 用户反馈第一次融合后“比之前还要差一点”，希望更明显模仿 HTML 原稿里的前端样式、UI 设计和动态效果；本轮需要补回空态 hero、提示卡片、交互动效和视觉层次，而不是只套颜色。
- CodeGraph 未初始化，`rg` 在当前环境被拒绝执行；本次上下文通过 PowerShell 文件读取和精确搜索获得。

## Assumptions

- 不把 OpenDesign 生成的静态 HTML 直接嵌入 React；只提取视觉系统、布局比例、控件状态和响应式规则。
- 视觉融合优先作用于聊天工作台、侧栏、顶部栏、空状态、消息气泡、composer、设置/弹窗等已有真实 UI。
- 不新增第三方依赖，不改后端 API，不改变聊天/生图状态机。

## Requirements

- 从 `attuno-chat-redesign.html` 提取 Attuno 设计特征：暖米色背景、焦糖棕主色、柔和面板、固定侧栏、胶囊模式切换、轻量阴影、圆角控件、暖色焦点态。
- 将这些特征映射到现有 `chatgpt-*`、composer、message、drawer、modal、image management 等真实组件类。
- 保留现有响应式布局：桌面固定壳层，移动端侧栏/顶部/composer 不重叠。
- 保持文本不溢出控件，按钮和选择器在桌面/移动端都有稳定尺寸。
- 空对话首屏应接近 `attuno-chat-redesign.html`：有 `ATTUNO WORKSPACE` kicker、大号 serif 标题、说明文案、六张 prompt card、宽 composer，并带轻量进入/hover/focus 动效。
- 更新或补充轻量测试，防止主题覆盖被误删或关键布局回退。

## Acceptance Criteria

- [ ] `attuno-studio/ui-prototype/src/styles.css` 包含明确的 OpenDesign/Attuno 主题覆盖，并映射到现有 React 类名。
- [ ] 当前 React 业务逻辑、聊天提交、生图提交、设置弹窗等不因样式迁移被改坏。
- [ ] `npm run build` 通过。
- [ ] 与 composer/布局相关的测试通过。
- [ ] 桌面和移动端视觉检查无明显空白、重叠、按钮文字溢出或不可读问题。

## Definition of Done

- Tests added/updated where appropriate.
- Typecheck/build passes for `ui-prototype`.
- Visual screenshot verification completed when feasible.
- No unrelated dirty files reverted or included.

## Out of Scope

- 不重写 App 组件结构。
- 不把静态 HTML 原型作为运行页面。
- 不修改后端、部署脚本或认证/API 配置逻辑。
- 不处理已有未提交业务逻辑改动的提交归属。

## Technical Notes

- Visual source: `attuno-chat-redesign.html`.
- Frontend files: `attuno-studio/ui-prototype/src/App.tsx`, `attuno-studio/ui-prototype/src/styles.css`.
- Relevant test: `attuno-studio/ui-prototype/tests/composerLayout.test.ts`.
- Relevant specs: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/state-management.md`, `.trellis/spec/frontend/component-guidelines.md`, `.trellis/spec/frontend/quality-guidelines.md`, `.trellis/spec/guides/index.md`.
