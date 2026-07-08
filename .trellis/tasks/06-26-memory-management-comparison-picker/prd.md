# 优化记忆管理与对比选图

## Goal

把“个性化 > 记忆”做成可直接手动维护的管理界面，并把“对比分析”的 A/B 图片选择从纯文字下拉升级为可视化缩略图选择，减少图片多时逐个打开确认的成本。

## Requirements

* 记忆管理：
  * 在个性化记忆页顶部保留清晰的新增记忆入口，支持选择保存分类。
  * 每个记忆分区都提供“添加到这里”入口，点击后自动把新增表单目标切到该分区。
  * 支持编辑、保存、取消、删除已有可编辑记忆。
  * 项目偏好新增时支持选择更具体的分组：风格、家具、结构、材质、灯光、避免项。
  * “最近常见修改”等只读推断项保持只读，但可以一键带入新增表单，方便转存为正式记忆。
  * 操作完成后刷新记忆视图并保持现有 toast 反馈。

* 对比分析：
  * A/B 选择区改为可视化选择体验，显示当前 A 基准图、B 对比图两个槽位。
  * 默认优先使用当前聊天里的上传源图和最新结果；当前聊天图片应直接展示缩略图。
  * 提供“当前聊天 / 图片库”切换，图片库以小缩略图网格展示历史图片。
  * 点击缩略图设置当前激活槽位（A 或 B）；已选图片有明确选中/勾选态。
  * 不允许 A/B 选择同一张图片，继续使用现有 toast 提示。
  * 保留现有对比预览区域和 floor-vs-render 对比模式。

## Acceptance Criteria

* [ ] 用户能从顶部新增记忆，也能从空分区或任意分区点击“添加到这里”新增。
* [ ] 项目偏好新增时能选择具体项目分组，并正确传给现有记忆创建 API。
* [ ] 可编辑记忆能内联编辑、保存、取消和删除；只读项不会被编辑/删除。
* [ ] 只读“最近常见修改”可以带入新增表单转存。
* [ ] 对比分析 A/B 不再只依赖原生 select 下拉；能看到候选图片缩略图再选择。
* [ ] 当前聊天和图片库候选可切换查看，图片库大量图片时不需要逐个打开确认。
* [ ] 选择同一图片作为 A/B 时保持阻止和提示。
* [ ] 相关前端测试和 build 通过。

## Definition of Done

* 不新增依赖。
* 优先复用现有 `comparisonCandidates`、`conversationComparisonCandidates`、`renderHistory` 和记忆 API。
* 样式保持 Attuno 当前设置页和弹窗风格。
* 不修改后端生成、图片存储或历史记录结构。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 内增强现有状态和渲染：

* 记忆新增草稿从 `{ text, sectionId }` 扩展为包含 `group`，`handleCreateMemoryItem` 调用现有 `createMemoryItem(text, sectionId, projectId, group)`。
* 增加 section 级“添加到这里”和只读项“转为记忆”行为，复用顶部新增表单而不是开新弹窗。
* 对比弹窗新增本地 UI 状态：当前选择槽位（A/B）与候选来源 tab（当前聊天/图片库）。
* 用 `conversationComparisonCandidates` 和 `comparisonCandidates` 派生候选列表，渲染缩略图按钮；点击候选更新 `comparisonImage.leftResultId/rightResultId`。
* 保留原有 `comparisonLeftResult` / `comparisonRightResult` 的大图预览。

## Decision (ADR-lite)

**Context**: 原生 select 只能看到图片名，图片多时用户需要逐个打开确认；记忆页面虽然有底层接口，但手动新增、分区添加和只读项转存不够直观。

**Decision**: 采用“当前聊天优先 + 图片库缩略图选择器”的 A/B 选图方式；记忆管理采用顶部表单和分区快捷入口，不引入额外复杂路由。

**Consequences**: 对比选择更直观，设置页记忆管理更可控；第一版不做搜索/分页，后续可在图片库 tab 上继续扩展筛选。

## Out of Scope

* 不做图片库全文搜索、日期筛选或分页。
* 不改对比分析算法或后端分析内容。
* 不改记忆存储结构。
* 不做批量记忆导入/导出。

## Technical Notes

* 现有前端已有 `createMemoryItem/updateMemoryItem/deleteMemoryItem/loadMemoryView`。
* 现有后端 `createMemoryItem` 已支持 `section_id` 和 `group`。
* 现有对比候选已区分 `source: "conversation" | "library"`，适合直接渲染分组缩略图。
* 现有样式已有 `memory-create-panel`、`memory-item-row`、`comparison-modal`、图片管理 selected 状态可复用。
* Spec update review: 本次复用现有前后端契约，只做前端交互增强和回归断言；无需更新 `.trellis/spec/`。
