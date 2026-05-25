# 聊天结果交互按钮与提交后清空输入

## Goal

提升聊天/出图连续使用体验：用户提交输入后，输入框不再残留上一条文本；AI 输出结果下方提供常见操作按钮，便于重新生成、反馈、分支继续和复制内容。

## Requirements

* 日常聊天和图像生成共用的主输入框，在成功进入提交流程后立即清空文本草稿。
* 如果输入校验未通过或请求未真正开始，不清空输入框，方便用户补齐内容。
* AI 助手输出下方显示基础操作：重新生成、点赞、差评、分支对话、复制。
* 点赞/差评用于判断结果质量：本次实现记录到消息本地状态，并通过现有偏好事件接口尽力上报；不自动写入长期记忆。
* 复制按钮对文本/分析消息复制消息内容，对图片结果优先保留现有复制图片能力，同时支持复制消息文本。
* 分支对话先提供轻量本地分支入口：把消息内容带回输入框并聚焦，方便用户基于该结果继续改写。
* 图像结果卡片保留现有放大、复制图片、对比分析、下载能力。

## Acceptance Criteria

* [ ] 日常聊天提交后输入框立即变空。
* [ ] 图像生成/改图提交后输入框立即变空。
* [ ] 校验失败时输入框内容仍保留。
* [ ] 每条 AI 输出可看到重新生成、点赞、差评、分支、复制相关操作。
* [ ] 点赞/差评按钮有选中状态，并再次点击可切换/取消。
* [ ] 复制失败时有 toast 提示。
* [ ] 前端类型检查/构建通过。

## Definition of Done

* Tests added/updated where feasible.
* Lint / typecheck / build green.
* 不覆盖当前工作区已有的其它未提交改动。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 中扩展 `ChatMessage` 的反馈状态，增加消息操作处理函数并接入现有 `firePreferenceEvent`、`showToast`、`runDailyChatFlow` 和 `runConversationFlow`。样式放在 `styles.css`，复用现有消息按钮和结果卡片视觉语言。

## Out of Scope

* 后端持久化完整反馈记录或搭建反馈管理页面。
* 真正复制一条完整会话树并切换到新分支会话。
* 大规模拆分当前 `App.tsx`。

## Technical Notes

* 相关规范：`.trellis/spec/frontend/state-management.md`、`.trellis/spec/frontend/type-safety.md`、`.trellis/spec/frontend/component-guidelines.md`。
* 关键文件：`attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/types/domain.ts`、`attuno-studio/ui-prototype/src/styles.css`、`attuno-studio/ui-prototype/tests/composerLayout.test.ts`。
