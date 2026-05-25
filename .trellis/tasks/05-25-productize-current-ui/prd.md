# 产品化当前 UI

## Goal

把当前 Attuno Studio 主工作台从“功能堆叠的原型界面”打磨成更成熟的产品 App UI：保持聊天优先、图像辅助的现有功能，不改后端和业务流程，重点统一视觉系统、空状态、主工作区、侧栏、设置弹窗与常用交互状态。

## What I already know

* 用户明确要求使用 `frontend-design`、`web-design-guidelines`、`design-review` 产品化当前 UI。
* 这三个技能在本机主要提供设计方向：App UI 应该克制、密集但可读、少装饰、强层级、明确控件状态，并通过截图审查。
* 前端主体位于 `attuno-studio/ui-prototype`，React + Vite + TypeScript，主界面集中在 `src/App.tsx`，样式集中在 `src/styles.css`。
* 当前 `styles.css` 有多轮历史视觉覆盖，最终生效段已经偏 ChatGPT 风格浅色 UI，但 token、空状态、设置弹窗、按钮和侧栏产品感还可以进一步统一。
* 工作树有大量用户/历史 WIP，必须只做本任务相关的增量改动，不回滚不相关文件。

## Requirements

* 将当前 UI 作为工作台 App，而不是营销页：不做 hero landing、不做装饰卡片堆叠，不新增图片资产或大 UI 框架。
* 建立最终生效的产品化 token：页面背景、侧栏 surface、内容 surface、边框、hover、selected、focus、主文字、辅助文字、主色、阴影和圆角。
* 侧栏保持品牌、主导航、历史聊天、账户/设置入口四层结构，宽度紧凑、选中态清晰、折叠态可用。
* 主工作区空状态要具体且可行动：突出“需求起草/图像生成/结果管理”等当前产品能力，提供 starter actions，但不解释使用说明或堆文案。
* Composer 仍是核心输入控件；按钮、模型选择、provider badge、短语 chips 必须保持稳定尺寸，不因文字变化导致明显跳动。
* 设置弹窗应像产品设置页：左侧分类导航、右侧滚动内容、控制区低装饰、按钮对齐且不会挤压换行。
* 移动端保持可用：侧栏不撑破视口，设置弹窗全屏或近全屏，主输入和控件不水平溢出。
* 保持现有功能入口可达：新对话、图片管理、结果库、快捷短语、记忆偏好、生成控制、模型/API、高级功能、提示词设置、登录/退出。

## Acceptance Criteria

* [ ] `npm run build` 在 `attuno-studio/ui-prototype` 通过。
* [ ] `npm run test:composer-layout` 通过，必要时更新断言以覆盖产品化布局约束。
* [ ] 浏览器桌面截图中侧栏、主区、composer 和设置弹窗比例协调，界面不再像松散卡片原型。
* [ ] 空状态文案更具体，starter actions 能把用户带到核心工作流。
* [ ] 按钮、导航、输入、chips、设置 section 有统一 hover/focus/selected/disabled 表现。
* [ ] 窄屏截图没有明显水平溢出、文字重叠或设置导航撑坏布局。

## Technical Approach

* 优先 CSS-first：在 `styles.css` 末尾添加一个最终生效的 `Productized app UI` 覆盖段，避免大面积重排历史 CSS。
* 对 `App.tsx` 只做轻结构调整：空状态增加 compact orientation/starter items，保留现有事件处理与业务流。
* 更新/保持 `composerLayout.test.ts` 中与布局、设置入口、空状态有关的断言。
* 使用 Vite 构建和现有轻量测试验证，再用浏览器截图做设计审查。

## Decision (ADR-lite)

**Context**: 当前 UI 已有多轮未提交视觉改造，直接重写整份 CSS 风险高，且容易覆盖其他任务 WIP。

**Decision**: 采用最终覆盖层 + 轻 JSX 结构调整，先把主工作台产品化到可交付状态。

**Consequences**: 改动范围更小、风险更低；`styles.css` 仍保留历史重复段，后续可以单独清理 CSS 债务。

## Out of Scope

* 不改后端 API、模型配置协议、生成流程或聊天历史存储协议。
* 不引入 Tailwind、组件库、字体服务或新构建工具。
* 不完整重做图片管理页面的信息架构。
* 不做 Figma 文件、新品牌 logo 或图片资产生成。
* 不清理所有历史 CSS 重复定义。

## Technical Notes

* Relevant specs:
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/component-guidelines.md`
  * `.trellis/spec/frontend/quality-guidelines.md`
  * `.trellis/spec/frontend/type-safety.md`
* Likely files:
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/styles.css`
  * `attuno-studio/ui-prototype/tests/composerLayout.test.ts`
* `rg.exe` 当前在环境中返回 Access denied，使用 PowerShell / git 文件列表替代。
* 代码索引服务本轮索引失败，已降级为本地文件读取和搜索。
