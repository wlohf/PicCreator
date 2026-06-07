# A/B 图像对比模式

## Goal

将图像对比分析收敛为清晰的 A/B 槽位模式：A 是基准图，B 是对比图。用户在当前聊天窗口多次生成图片时，默认进入对比时自动选中最近两张当前聊天生成图；用户也可以手动从当前聊天图片或图片库里选择任意两张进行对比。

## What I already know

* 用户确认采用 A/B 模式。
* 默认行为应优先使用当前聊天窗口里生成的最近两张图片。
* 用户希望既能选图片库里的图片，也能选当前聊天窗口里的图片。
* 现有 `attuno-studio/ui-prototype/src/App.tsx` 已有 `history-vs-history` 对比弹窗、当前聊天生成图候选列表和左右图片选择器。
* 现有图片库数据来自 `renderHistory`，图片管理页使用 `RenderHistoryItem` 展示历史生成图片。

## Requirements

* 对比弹窗在图片对比场景中使用 A/B 语言，而不是仅“左侧/右侧”。
* A 槽位表示基准图，B 槽位表示对比图。
* 打开当前聊天图片对比时，默认选择当前聊天生成图中最近的两张：较早的一张作为 A，较新的一张作为 B。
* 如果用户从某张图点击“对比分析”，该图应优先作为 B，对比对象 A 取最近一个不同候选。
* A/B 两个槽位都应能从当前聊天生成图和图片库历史生成图中选择。
* 候选选项需要标明来源：当前聊天 / 图片库，降低误选成本。
* 当前聊天不足两张时，只要图片库和当前聊天合计不少于两张，也允许打开 A/B 对比。
* 图片库中同一结果若已出现在当前聊天候选里，不重复展示。
* 保留平面图 vs 效果图的原有对比模式，不纳入本次 A/B 图像对比改造。

## Acceptance Criteria

* [ ] 当前聊天生成两张或以上图片时，点击对比默认打开 A/B 对比，A/B 分别为最近两张当前聊天图。
* [ ] 当前聊天只有一张图、图片库还有其他图时，可以打开 A/B 对比并从图片库补选。
* [ ] A/B 下拉框同时包含当前聊天与图片库候选，并能切换两侧图片。
* [ ] A/B 图像预览标题、弹窗标题、说明文案均使用基准图/对比图语义。
* [ ] 对同一张图片不能形成有效对比；如果自动选择失败，应给出至少需要两张不同图片的提示。
* [ ] 现有平面图/效果图对比仍可用。

## Out of Scope

* 本次不新增后端图像差异分析 API。
* 本次不实现“设为长期基准图”的持久化偏好。
* 本次不重构图片管理页的批量选择逻辑。
* 本次不改变生成结果写入图库的存储结构。

## Technical Notes

* 主要实现位置：`attuno-studio/ui-prototype/src/App.tsx`。
* 可能需要补样式：`attuno-studio/ui-prototype/src/styles.css`。
* 现有相关类型：`ComparisonImage`、`ConversationComparisonCandidate`。
* 现有相关函数/状态：`conversationComparisonCandidates`、`comparisonCandidates`、`handleOpenComparison`、`comparisonLeftResult`、`comparisonRightResult`。
* 现有相关组件：`ImageManagementPage` 使用 `RenderHistoryItem` 作为图片库来源。
