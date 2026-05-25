# 聊天消息内联编辑保持输出

## Goal

点击历史用户消息的编辑按钮时，界面应像 ChatGPT 一样保持当前对话和已有助手输出可见，只把被编辑的用户消息切换成原位可编辑输入框。重新发送后仍按现有分支模型创建新用户同级节点和新助手回复。

## Requirements

* 进入编辑态时不得切换 `activeMessageId` 到旧用户消息导致后续助手输出从当前线程消失。
* 被编辑的用户消息应在消息流中原位展示为可编辑控件，已有助手输出和后续消息保持可见。
* 取消编辑应恢复普通消息展示，不清空或重排对话。
* 发送编辑后的内容应沿用现有“创建新分支”语义，不直接修改原消息节点。
* 编辑态应兼容原用户消息的图片附件展示，不把历史附件错误注入当前普通 composer 草稿。

## Acceptance Criteria

* [ ] 点击用户消息“编辑”后，当前可见 active path 保持不变，旧助手输出仍然显示。
* [ ] 被编辑的用户消息显示输入框以及取消/发送操作。
* [ ] 取消编辑后消息流恢复原样。
* [ ] 发送编辑内容会创建新分支并生成新助手回复。
* [ ] 相关前端静态/单元检查通过。

## Definition of Done

* 前端实现符合 `.trellis/spec/frontend/state-management.md` 中 conversation state 和 branched conversation tree 约束。
* 添加或更新聚焦回归检查。
* 运行相关测试或说明未运行原因。

## Technical Approach

保留 `editingMessage` 状态来记录目标消息和父节点。进入编辑态时不再截断或切换当前可见路径，而是在消息渲染层对匹配的用户消息渲染原位编辑 UI。提交编辑时复用现有 daily chat flow 的 `editParentId` 分支逻辑。

## Decision (ADR-lite)

**Context**: 当前点击编辑后，旧助手输出会从视图消失，和用户期望的 ChatGPT 原位编辑体验不一致。

**Decision**: 把编辑视作消息级 UI 状态，而不是会话路径切换。只有重新发送时才改变分支。

**Consequences**: 已有分支数据模型保持不变；需要确保编辑草稿与底部 composer 草稿分离或至少不再影响 visible path。

## Out of Scope

* 不重做完整分支导航设计。
* 不改变后端 chat history schema。
* 不处理助手回复编辑。

## Technical Notes

* Relevant spec: `.trellis/spec/frontend/state-management.md`
* Likely files: `attuno-studio/ui-prototype/src/App.tsx`, `attuno-studio/ui-prototype/tests/composerLayout.test.ts`
