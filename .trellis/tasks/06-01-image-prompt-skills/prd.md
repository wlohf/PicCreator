# 自定义图像提示词模式

## Goal

让图像工作台支持可复用的“提示词模式 / skill”：用户可以保留当前 3D 提示词增强模式，也可以自己创建风景图、产品图、头像等自定义模式。选择某个模式后，提交出图时自动把用户输入套入该模式的提示词模板，避免每次新会话都重新粘贴长 prompt。

## Requirements

* 保留现有 `standard`、`render3d`、`colored_floor_plan` 后端生成模式合同；自定义提示词模式作为前端/偏好层的 prompt 模板，不新增后端 `GenerationMode`。
* 图像工作台在“新生成”状态下提供模式选择：
  * 默认模式：用户输入直通。
  * 3D 提示词增强：沿用现有 `render3d` 模式。
  * 用户自定义模式：提交时仍走 `standard`，但发送给后端的文本是模板套用后的最终 prompt。
* 用户可以在设置/提示词面板中管理自定义模式：
  * 新增模式名称和提示词模板。
  * 编辑已有自定义模式。
  * 删除自定义模式。
  * 选择模式后能在主输入区直接生效。
* 自定义模式按账号持久化，优先使用后端 `/api/preferences` 存储；前端允许浏览器本地缓存作为加载失败兜底。
* 模板支持 `{prompt}` 或 `{{prompt}}` 占位符；若用户没有写占位符，则将模板与用户输入组合成最终 prompt。
* 提交后聊天/结果记录仍显示用户原始输入，同时生成记录里的 prompt 展示实际送到画图模型的最终 prompt。
* 空模板、空名称、过长列表要被规整；MVP 最多保存 20 个自定义模式。

## Acceptance Criteria

* [ ] 默认模式提交不改变用户输入。
* [ ] 3D 提示词增强仍作为 `render3d` 提交，并继续允许纯文本生成。
* [ ] 自定义模式提交时，`requestGenerationStream` 收到套用模板后的 prompt，提交模式为 `standard`。
* [ ] 自定义模式可新增、编辑、删除，并持久化到当前账号偏好。
* [ ] 重新加载偏好后，自定义模式仍出现在模式选择中。
* [ ] 后端偏好接口能保存、规范化并返回 `prompt_skills`。
* [ ] 前端测试覆盖模式选择、模板套用和管理入口的关键静态合同。
* [ ] 后端测试覆盖 `prompt_skills` 偏好保存/读取。

## Definition of Done

* 相关前端与后端测试通过。
* 前端 typecheck/build 或项目现有等价检查通过。
* 不破坏现有 generation mode 合同和已有快捷短语/记忆偏好。
* 任务实现过程中的新约定如有价值，更新 `.trellis/spec/`。

## Technical Approach

* 后端：扩展 `preferences_store` 的偏好数据结构，新增 `prompt_skills` 字段及 `load_prompt_skills` / `save_prompt_skills`；在 `routes/preferences.py` 增加 `/api/preferences/prompt-skills` GET/PUT。
* 前端 API：在 `api/preferences.ts` 增加 `PromptSkillPreference` 类型和 load/save 方法。
* 前端状态：在 `App.tsx` 增加 `promptSkills`、`selectedPromptSkillId`、编辑草稿状态；自定义模式选择与 `generationMode` 解耦，选内置 3D 时提交 `render3d`，选自定义时提交 `standard` 并套模板。
* UI：复用现有设置弹窗的 `prompts` 面板，增加“图像模式”管理区；主 composer 模式行展示内置与自定义模式。
* 测试：补充后端 API 测试和前端静态/单元测试，确保合同不回退。

## Decision (ADR-lite)

**Context**: 现有后端只支持三种稳定的生成模式，且规范明确 `standard` 必须直通、`render3d` 是 3D 提示词增强、`colored_floor_plan` 是平面图工具动作。把每个用户模板都变成后端 mode 会扩大合同面并增加迁移成本。

**Decision**: 自定义图像 skill 先作为用户偏好中的 prompt 模板实现。内置 3D 继续使用 `render3d`，自定义模板统一走 `standard`，由前端在提交前生成最终 prompt。

**Consequences**: MVP 更轻、更兼容；结果记录里的最终 prompt 能反映模板效果。短期内自定义模式不能绑定模型参数、比例、负面词等高级生成参数，这些留到后续版本。

## Out of Scope

* 模板市场、公开分享、导入/导出 JSON。
* 自定义模式绑定模型、尺寸、比例、负面词、参考图策略。
* 多级 skill 流程、调用外部工具或让 skill 自己执行多步推理。
* 后端新增任意动态 `GenerationMode`。

## Technical Notes

* 相关规范：
  * `.trellis/spec/frontend/state-management.md`
  * `.trellis/spec/backend/generation-contracts.md`
* 现有入口：
  * `attuno-studio/ui-prototype/src/App.tsx` 中 `generationModeOptions` 和 `runConversationFlow(...)`。
  * `attuno-studio/ui-prototype/src/api/preferences.ts` 已有 shortcuts/preferences API 客户端。
  * `attuno-studio/backend/app/routes/preferences.py` 和 `services/preferences_store.py` 已有账号级偏好持久化。
* 当前环境限制：
  * `mcp__ace_tool.search_context` 索引失败。
  * `mcp__codegraph` 未初始化。
  * `rg.exe` 执行被拒绝，代码检索使用 `git grep` / PowerShell。
  * 当前 Codex 工具列表未提供 Trellis 子代理 spawn/wait 工具；实现和检查会在主线程按 Trellis 规范完成。
