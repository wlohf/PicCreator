# 修复模型下拉与图像聊天历史

## Goal

修复聊天工作台里模型下拉、图像模式会话记录、左侧历史排序的三个异常，让前端会话列表和模型候选严格反映用户配置与真实对话更新时间。

## What I Already Know

* 用户截图显示模型下拉出现 `dall-e-3`、`imagen-preview`，但中转站没有这些模型。
* 前端 `attuno-studio/ui-prototype/src/data/studioData.ts` 里存在内置 `modelOptions = ["gpt-image-2", "dall-e-3", "imagen-preview"]`。
* 前端规范要求聊天模型下拉不能注入硬编码默认模型；图像下拉只可在空/default 配置下使用小型内置起始列表。
* 会话记录存在于浏览器本地 `attuno-chat-history-v1`，由 `App.tsx` 和 `utils/chatSessions.ts` 管理。
* 历史列表当前按 `updatedAt` 倒序展示，但打开旧会话时会保存当前/目标快照，可能导致“点击就置顶”的体验。

## Requirements

* 图像模型下拉不应无条件显示用户中转站或配置中不存在的 `dall-e-3`、`imagen-preview`。
* 保留一个合理的空配置默认模型，让首次使用仍有可见选项；配置或检测到模型后，优先只展示用户配置/检测/手动加入的模型。
* 图像模式生成、编辑、渲染中的对话消息必须作为持久会话内容进入左侧历史记录。
* 左侧历史记录按最近真实对话内容更新时间倒序排列。
* 仅点击/打开历史会话不应刷新该会话的排序时间，也不应让旧会话直接置顶。

## Acceptance Criteria

* [ ] 默认图像模型候选不再包含 `dall-e-3`、`imagen-preview`，除非它们来自用户配置、fallback 或检测加入。
* [ ] 图像模式提交并生成消息后，左侧历史列表能显示该会话。
* [ ] 点击较旧历史记录只切换当前会话，不改变该会话 `updatedAt`。
* [ ] 对旧会话继续发送新消息后，该会话按最新内容更新时间回到顶部。
* [ ] 前端相关单元测试覆盖模型候选和会话排序/打开行为。
* [ ] 前端测试通过；如涉及后端契约，后端相关测试保持通过。

## Definition of Done

* Tests added/updated where behavior changes.
* Lint / typecheck / targeted tests pass where feasible.
* Spec update considered if new state-management convention emerges.

## Technical Approach

先从前端状态根因修复：

* 收窄内置图像模型 starter list，避免把 `dall-e-3`、`imagen-preview` 作为无条件 composer options。
* 调整会话 upsert/快照逻辑，只在内容发生变化时刷新 `updatedAt`，仅打开会话时保留原时间。
* 确认图像模式消息是否满足 durable content 过滤，如缺漏则补齐持久内容判断。

## Out of Scope

* 不改后端模型检测接口协议。
* 不新增服务端会话存储；本任务只修复当前浏览器本地历史行为。
* 不重做侧边栏视觉设计。

## Technical Notes

* 相关规范：`.trellis/spec/frontend/state-management.md`，`.trellis/spec/backend/generation-contracts.md`。
* 相关代码初步定位：`attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/data/studioData.ts`、`attuno-studio/ui-prototype/src/utils/chatSessions.ts`、`attuno-studio/ui-prototype/tests/chatSessions.test.ts`。
