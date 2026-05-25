# 删除输入框底部提示文字

## Goal

删除主输入框底部截图红圈里的两处辅助文字，保持聊天/图像模式切换、模型选择和底层聊天/画图接口完全不变。

## Requirements

* 删除聊天模式下的 `日常对话不会直接出图` / `Daily chat does not render directly`。
* 删除输入框右下的 `已输入 N 字` / `N characters`。
* 保留图像模式的生成模式按钮、彩色平面图按钮和现有提交逻辑。
* 当聊天模式没有底部 meta 控件时，不渲染空白 meta 行。

## Acceptance Criteria

* [ ] 聊天模式输入框底部不再出现上述提示文字。
* [ ] 图像模式的生成模式按钮和彩色平面图按钮仍存在。
* [ ] 顶部聊天/图像模式切换仍存在。
* [ ] `npm run test:composer-layout` 通过。

## Definition of Done

* 前端相关测试通过。
* 不改后端接口和模型配置逻辑。

## Technical Notes

* 主要改动在 `attuno-studio/ui-prototype/src/App.tsx` 的 composer meta JSX。
* 更新 `attuno-studio/ui-prototype/tests/composerLayout.test.ts` 的源码断言。
