# 简化主页面导航与工作台设置

## Goal

让主页面更简洁：去掉与“图片管理”重复的“结果库”入口，并把工作台相关设置收纳到一个“设置”按钮后面，点击后再展开设置项。

## Requirements

- 左侧主导航不再显示“结果库 / Result library”入口。
- 历史生成图片的管理入口保留为“图片管理 / Image management”。
- 不再通过右侧抽屉暴露独立“结果库”面板；结果数据、预览、下载、编辑、删除等能力继续由图片管理页和上下文操作承载。
- 左侧“工作台设置”不默认展开具体设置项，只显示一个“设置 / Settings”按钮。
- 点击“设置 / Settings”按钮后展开或收起设置项。
- 点击某个设置项仍打开对应右侧抽屉；重置/切换会话后主页面保持默认简洁。

## Acceptance Criteria

- [ ] 主导航只保留图片管理入口，不再显示结果库入口。
- [ ] 空状态快捷操作不再打开结果库。
- [ ] 工作台设置默认只显示设置按钮。
- [ ] 点击设置按钮能展开设置项，再点击可收起。
- [ ] 点击设置项能打开右侧设置抽屉。
- [ ] TypeScript/Vite build 通过。

## Definition of Done

- 前端源码改动集中且不影响后台结果数据协议。
- 运行项目可用的构建或类型检查。
- 不修改无关工作区脏文件。

## Technical Approach

在 `attuno-studio/ui-prototype/src/App.tsx` 中移除 `results` 作为可打开的 utility panel 和 `ResultLibrary` 渲染入口，保留 `renderHistory` 作为图片管理页和生成流程的数据来源。新增本地 UI 状态控制侧边栏设置菜单是否展开，默认折叠。样式只补充设置按钮和展开列表的必要布局。

## Out of Scope

- 不删除结果数据 API、历史生成记录或图片管理页。
- 不移除生成完成后的历史记录保存逻辑。
- 不重构整体布局或重新设计视觉系统。

## Technical Notes

- 相关规范：`.trellis/spec/frontend/state-management.md` 中要求图片管理使用 `renderHistory`，并提示避免在主 header 重复结果入口。
- 主要文件：`attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/styles.css`。
