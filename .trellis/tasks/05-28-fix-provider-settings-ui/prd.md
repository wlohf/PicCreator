# Fix Provider Settings UI

## Goal

修复模型与 API 设置里的默认值和可用性问题：模型下拉不再显示残缺/异常模型名，默认 Base URL 改为 `https://api.xyleisure.site/v1`，API Key 可以一键显示/隐藏，验证成功提示颜色更清晰；补充用户反馈的聊天图片复制、普通聊天误触发图像草稿、模型删除和设置面板排版问题。

## Requirements

* 分析和画图 Base URL 的默认值使用 `https://api.xyleisure.site/v1`。
* API Key 输入框默认隐藏，并提供眼睛按钮切换明文/隐藏。
* 模型候选过滤掉明显异常的短前缀或占位模型，避免 `g`、`gpt-`、`gpt-5.`、`your-chat-or-vision-model` 进入下拉。
* 验证通过的状态文案颜色使用更深的绿色。
* 渲染消息的复制操作应优先复制图片本身，而不是只复制“真实渲染结果已返回”等说明文字。
* 日常聊天里询问 logo、命名、风格建议等脑暴问题必须走聊天模型，不应因为出现“风格”或有当前图而直接返回改图草稿。
* 已加入的分析/画图模型候选必须可删除，并同步更新默认模型或备用模型。
* AI 正在回复时，当前助手消息要显示正在输出的状态图标。
* 设置与生成控制面板保持紧凑，折叠状态和操作按钮不能撑出大块留白。

## Acceptance Criteria

* [x] 设置页默认 URL 显示为 `https://api.xyleisure.site/v1`。
* [x] API Key 可通过眼睛按钮显示，再次点击隐藏。
* [x] 聊天模型下拉不会出现残缺短模型项。
* [x] 配置验证成功提示文本比原浅绿色更清晰。
* [x] 渲染消息复制优先复制图片，粘贴回聊天框时按聊天图片附件处理。
* [x] logo/命名/风格建议在日常聊天模式下返回普通聊天回复，不误触发“基于当前图改图”。
* [x] 已加入模型可删除，删除默认模型会切到下一个可用模型。
* [x] 前端 build 和相关轻量测试通过。

## Technical Notes

* Frontend entry: `attuno-studio/ui-prototype/src/App.tsx`
* Defaults: `attuno-studio/ui-prototype/src/data/studioData.ts`
* Styling: `attuno-studio/ui-prototype/src/styles.css`
* Existing spec: `.trellis/spec/frontend/state-management.md` requires model dropdowns to reflect configured/detected models, not hard-coded guesses.
