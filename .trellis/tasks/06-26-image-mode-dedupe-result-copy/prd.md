# 减少画图模式重复结果话术

## Goal

画图模式生成成功后，聊天流里不要同时展示一条“生成完成/最终提示词”说明和一条“渲染预览/结果”卡片。成功结果只保留最后的 render 卡片，减少重复话术，让用户更快看到图片。

## Requirements

* 保留提交后的临时进度消息，用于说明图片仍在生成中。
* 成功返回图片后，移除临时进度消息。
* 成功返回图片后，只追加最终 render 消息，render 消息直接挂在本次用户输入下面。
* 标注改图成功后也只保留最终 render 消息，先清理临时进度消息。
* render 消息继续保留状态 bullet、最终提示词展开、图片、历史结果关联和重试所需的 image workflow 元数据。
* 重试已有 render 消息时继续更新目标消息变体，不新增重复消息。
* 失败和停止生成的提示逻辑保持不变。

## Acceptance Criteria

* [ ] 标准画图成功后，聊天流只出现一条最终 render 结果消息，不再出现独立的 `m-api-analysis-*` 成功说明消息。
* [ ] 最终 render 消息仍能展示图片、状态 bullet 和最终提示词。
* [ ] render 消息的 `parentId` 指向本次用户消息，活跃路径保持连续。
* [ ] 标注改图成功后只出现一条最终 render 结果消息，并清掉临时进度消息。
* [ ] 现有前端行为测试通过，新增或更新覆盖重复结果话术的断言。

## Definition of Done

* 前端代码改动范围尽量小。
* 相关测试通过。
* 不触碰后端生成协议和历史存储格式。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 的 `runConversationFlow` 成功分支中，保留 `renderPatch` 的构造和 retry 更新逻辑；非 retry 成功时只追加 `m-api-render-*` 消息，并把它的 `parentId` 从 `m-api-analysis-*` 改为 `userMessageId`。相同模式可同步用于上传图续改和已有图片编辑成功分支，避免同类重复展示继续出现。

## Decision (ADR-lite)

**Context**: 当前成功分支会先追加一条分析/说明消息，再追加 render 结果消息；两者共享相似 bullet 和最终提示词，用户感知为重复啰嗦。

**Decision**: 成功结果以 render 消息作为唯一最终助手输出，进度与失败仍使用各自消息类型。

**Consequences**: 聊天流更短、更聚焦；成功说明文案减少，但 render 卡片仍保留必要状态、提示词和图片信息。

## Out of Scope

* 不修改后端生成结果结构。
* 不改图片管理、下载、复制和历史记录存储。
* 不重设计 render 卡片样式。

## Technical Notes

* 已定位 `attuno-studio/ui-prototype/src/App.tsx` 中 `runConversationFlow` 会在成功时追加 `m-api-analysis-*` 和 `m-api-render-*` 两条消息。
* 已搜索 `m-api-analysis` 用法，相关成功追加点集中在生成、上传图续改、已有图片编辑分支。
* 前端测试主要是源码断言型测试，适合增加对成功分支只追加 render 消息的字符串/正则断言。
* Spec update review: 本次是局部前端展示策略修复，不改变 API/存储/跨层契约；用回归测试固定行为即可，无需更新 `.trellis/spec/`。
