# 优化生图等待、历史图片与分支对话 UI

## Goal

优化当前聊天/画图工作区的几个交互细节，让长对话中的生图状态可见、历史对话图片不受图片管理删除影响、分支会话标题更易区分，并让顶部聊天/图像模式切换视觉居中。

## Requirements

* 生图等待/进度 UI 不再固定出现在聊天线程顶部；应显示在当前 AI 输出消息的位置附近，长聊天滚动到底部时也能看到。
* 生图完成并出现图片结果后，等待/进度动态效果按现有逻辑消失。
* 图片管理删除生成图片只影响图片管理列表和当前可选结果，不应移除或破坏历史聊天消息里已经保存的图片展示；旧历史消息里的结果图片 URL 也应继续可访问。
* 开启“分支对话”时，新分支会话标题不能与源会话完全相同；标题应包含清晰、短小的分支标识，例如“分支 1”。
* 顶部“聊天 / 图像”模式切换控件应进一步向中间移动，尽量保持在主内容区域视觉居中。

## Acceptance Criteria

* [ ] 在历史消息很多、线程滚动靠下时，生图等待状态显示在当前 AI 输出区域而不是被藏在聊天顶部。
* [ ] 生图完成后等待态消失，生成结果仍按当前样式展示。
* [ ] 从图片管理删除某张图片后，该图片从图片管理列表移除，但历史对话中的旧图片消息仍可正常显示，包括删除前已保存的 `/api/results/.../image` 历史 URL。
* [ ] 从同一个会话创建分支时，历史会话列表里新旧会话标题不会完全相同，连续分支也能区分。
* [ ] 顶部模式切换控件在桌面布局中相对主内容居中，不再明显偏右。
* [ ] 相关 TypeScript 构建和现有聊天会话测试通过。

## Definition of Done

* 前端实现遵循当前 React + CSS 模式，不引入新的状态管理库。
* 只调整本次相关交互，不重构无关页面。
* 更新/新增聚焦测试覆盖分支标题或历史图片持久显示的纯逻辑行为。
* 运行可行的前端构建/测试命令并记录结果。

## Technical Approach

先定位 `ui-prototype` 中聊天工作区、会话持久化工具、图片管理删除处理和 CSS 布局。等待 UI 优先复用已有渲染状态，只移动渲染入口；新历史图片通过消息内保存 `data_url` 快照与图片管理列表解耦，旧历史图片通过后端结果软删除继续服务资产 URL；分支标题在创建分支会话时生成去重后缀；顶部模式切换通过 header/grid/flex CSS 调整。

## Decision (ADR-lite)

**Context**: 四个问题都集中在前端状态和布局，用户已经给出明确期望，不需要额外产品调研。

**Decision**: 采用最小前端改动，在现有组件和工具函数内修复行为；不引入新页面或新的持久化层。

**Consequences**: 变更面保持可控，但需要仔细避免删除图片管理记录时误改聊天消息中的 `imageUrl`。

## Out of Scope

* 不改变后端生成接口；图片删除 API 仍从图片管理列表移除记录，但改为保留资产供历史对话访问。
* 不重新设计整个聊天页视觉系统。
* 不实现新的批量删除后端接口。

## Technical Notes

* Relevant specs: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/state-management.md`, `.trellis/spec/frontend/type-safety.md`, `.trellis/spec/frontend/quality-guidelines.md`, `.trellis/spec/backend/index.md`, `.trellis/spec/backend/generation-contracts.md`.
* Likely files: `attuno-studio/ui-prototype/src/components/chat-workspace.tsx`, `attuno-studio/ui-prototype/src/App.tsx`, `attuno-studio/ui-prototype/src/utils/chatSessions.ts`, `attuno-studio/ui-prototype/src/types/domain.ts`, `attuno-studio/ui-prototype/src/styles.css`, `attuno-studio/ui-prototype/tests/chatSessions.test.ts`.
