# 图片管理侧边栏功能

## Goal

在现有左侧边栏增加“图片管理”入口，点击后将主工作区切换为类似参考图的图片管理页，用于查看历史生成图片并执行批量管理操作。

## What I already know

* 用户希望入口位于当前项目左侧边栏。
* 参考图展示顶部标题、日期筛选、刷新、选择、下载所选、删除所选、删除匹配日期等批量管理能力。
* 当前前端为 `attuno-studio/ui-prototype` 的 React/Vite 应用。
* 历史图片数据已有 `renderHistory` 状态，并通过 `listResults(currentUserId)` 从 `/api/results` 加载。
* 现有结果库组件 `ResultLibrary` 支持单图预览、复制摘要、载入提示词、改图、标注、下载、删除、清空。
* 后端已有单项删除 `DELETE /api/results/{id}` 和清空 `DELETE /api/results`，没有专门的批量删除接口。

## Assumptions

* MVP 先在前端复用现有 `/api/results` 数据，不新增后端批量接口。
* “批量删除”通过依次调用现有单项删除 API 实现，失败时保留未删除项并提示错误。
* “删除匹配日期”作用于当前日期筛选命中的结果。
* 历史结果 API 目前不返回图片大小/分辨率，MVP 展示日期、模式、版本、标题/标签等已有元数据。

## Requirements

* 左侧边栏新增“图片管理”入口，入口能明显显示历史图片数量。
* 点击“图片管理”后，主工作区切换到图片管理页；返回聊天/图像工作区时保留原会话状态。
* 图片管理页以网格卡片展示历史生成图片，支持空状态。
* 支持按日期范围筛选历史图片，并提供清除筛选、查询和删除匹配日期操作。
* 支持刷新结果列表。
* 支持本页全选、全选结果、取消选择。
* 支持下载所选图片。
* 支持删除所选图片，并同步更新 `renderHistory` 和 `activeResultId`。
* 单张卡片仍支持预览、下载、复制摘要、继续改图、删除。
* 页面需要在桌面和移动端可用，并保持现有视觉语言。

## Acceptance Criteria

* [ ] 左侧边栏出现“图片管理”按钮，点击后进入图片管理页。
* [ ] 图片管理页展示 `/api/results` 加载到的历史图片。
* [ ] 日期筛选能过滤结果；清除筛选能恢复全量列表。
* [ ] 选中多个图片后，“下载所选”和“删除所选”可用。
* [ ] 删除所选或删除匹配日期后，页面列表和现有结果库状态一致。
* [ ] 空结果和未登录/加载失败场景有可读提示，不出现运行时崩溃。
* [ ] `npm run build` 通过。

## Definition of Done

* 前端实现完成并通过类型检查/构建。
* 如新增可复用逻辑，避免与现有结果库逻辑无谓分叉。
* 若发现需要更新项目 spec，完成 Trellis spec 判断。

## Technical Approach

* 在 `App.tsx` 中增加主视图状态，例如 `activePrimaryView: "workspace" | "image-management"`。
* 左侧栏增加图片管理导航按钮，点击时关闭右侧抽屉并切换主视图。
* 新增 `ImageManagementPage` 组件，接收 `renderHistory`、选中状态、筛选状态和复用的结果操作回调。
* 复用现有 `handleDownloadResult`、`handleOpenResult`、`handleCopyRunSummary`、`handleEditResult`、`handleRemoveResult` 等操作。
* 新增批量删除 helper，通过现有 `deleteResult` API 顺序删除结果，并复用 `removeResultFromState` 更新前端状态。
* 样式放入现有 `styles.css`，与当前 ChatGPT-like 布局协调，但图片管理页使用更接近截图的浅色大网格视觉。

## Decision (ADR-lite)

**Context**: 当前应用已有右侧“结果库”抽屉，但用户指定从左侧边栏进入，参考图是独立管理页面而非窄抽屉。

**Decision**: 做成左侧入口驱动的主工作区页面，同时保留现有右侧结果库抽屉用于工作流内快速查看。

**Consequences**: 不需要新增路由库或后端接口；页面状态集中在 `App.tsx`，但需要注意不要破坏当前聊天/图像工作区状态。

## Out of Scope

* 不新增真正分页。
* 不新增后端批量删除接口。
* 不在本次补充图片文件大小/分辨率元数据。
* 不改变现有结果生成、改图、标注流程。

## Technical Notes

* 相关前端文件：`attuno-studio/ui-prototype/src/App.tsx`、`src/components/ResultLibrary.tsx`、`src/api/results.ts`、`src/types/domain.ts`、`src/styles.css`。
* 相关后端文件：`attuno-studio/backend/app/routes/results.py`、`backend/app/services/result_store.py`。
* 适用 spec：`.trellis/spec/frontend/index.md`、`state-management.md`、`type-safety.md`、`quality-guidelines.md`、`.trellis/spec/guides/index.md`。
