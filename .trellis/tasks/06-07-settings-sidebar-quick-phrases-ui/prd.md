# 优化设置与侧栏快捷短语体验

## Goal

统一聊天侧栏和设置弹窗的视觉/信息架构，并让个性化记忆与快捷短语真正可管理、可使用。

## What I Already Know

* 侧栏“新建对话”按钮当前棕色块过重，和浅米色主题、低对比导航风格不一致。
* 设置弹窗顶部有两个“设置”标题：一个小字号眉标和一个大字号标题。用户希望删除所有设置分类页里的小字号“设置”。
* “生成控制”和“高级功能”里的“严格复核”都属于高级功能，应集中放在“高级功能”分类里。
* 个性化页需要支持用户手动输入、编辑、保存和删除记忆信息，方便管理。
* 管理快捷短语里新增短语后，用户看不到新增内容实际显示/可用的位置，需要让新增短语在管理列表和右侧快捷短语入口中可见。

## Requirements

* 侧栏“新建对话”按钮改为项目主题内的轻量样式，保留明确的主操作感，但不要突兀。
* 设置弹窗顶部只保留大标题，删除小字号重复标题，并确保切换其他设置分类时也不会出现小字号重复“设置”。
* 设置分类保留“个性化 / 高级功能 / 供应商与模型 / 提示词设置 / 管理快捷短语”等清晰入口；移除单独“生成控制”入口，将严格复核相关控制归入“高级功能”。
* 个性化页的记忆信息支持新增、编辑、保存、取消和删除；新增/编辑应走现有记忆 API，避免只在前端临时显示。
* 管理快捷短语页新增短语后，应立即显示在快捷短语管理列表中，并能出现在主输入区右侧快捷短语弹层里供插入使用。
* 不改变现有聊天、生成、模型保存、图片管理等无关功能。

## Acceptance Criteria

* [ ] “新建对话”按钮颜色与侧栏主题协调，无突兀大面积深棕色块。
* [ ] 设置弹窗任一分类页顶部没有重复的小字号“设置”文本。
* [ ] 设置导航不再有单独“生成控制”；严格复核控制只在高级功能分类内出现。
* [ ] 个性化页可新增一条记忆，保存后能在记忆列表里看到；现有记忆仍可编辑和删除。
* [ ] 新增快捷短语保存后，在管理列表和快捷短语弹层中都能看到，并可插入到输入框。
* [ ] 前端 TypeScript 构建通过，相关现有测试不回归。

## Out Of Scope

* 不重做完整设置弹窗视觉系统。
* 不新增后端记忆模型或改变记忆分类语义。
* 不引入新的状态管理库或 UI 组件库。

## Technical Notes

* 前端主实现集中在 `attuno-studio/ui-prototype/src/App.tsx`、`attuno-studio/ui-prototype/src/components/chat-workspace.tsx`、`attuno-studio/ui-prototype/src/styles.css`。
* 前端规范参考 `.trellis/spec/frontend/index.md`、`.trellis/spec/frontend/state-management.md`、`.trellis/spec/frontend/type-safety.md`。
* `state-management.md` 已要求：Strict review belongs under Advanced drawer；Memory UI should separate daily chat memory/image preferences and editable memory items should round-trip through `GET/PATCH/DELETE /api/preferences/memory`.
