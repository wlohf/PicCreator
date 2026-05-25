# 修复聊天排版并支持检测 API 模型

## Goal

修复日常聊天回复的可读性问题，并让模型配置页可以从当前 API 配置自动检测可用模型，用户可以直接点击/勾选模型，而不是只能手动输入模型名。

## What I already know

* 截图中助手回复把 Markdown 加粗和编号列表当作纯文本渲染，造成整段内容挤在一起。
* 聊天 composer 的模型下拉会把硬编码默认项 `gpt-4o`、`gpt-4o-mini`、`claude-3-5-sonnet`、`gemini-pro` 混入候选。
* 当前 API 配置面板已有保存、验证分析模型、验证画图模型能力，但模型字段仍是纯输入框。
* 后端已有 `/api/config`、`/api/config/verify-analysis`、`/api/config/verify-image`，配置会按当前登录账号隔离。

## Requirements

* 聊天消息支持基础 Markdown 排版，至少处理段落、编号列表和 `**加粗**`。
* 模型下拉只显示当前已配置/检测/备用的模型，不再无条件混入硬编码聊天默认模型。
* API 配置页新增“检测分析模型”和“检测画图模型”能力。
* 检测成功后展示可选模型列表，用户可以多选并加入配置；分析模型加入聊天模型候选，画图模型写入主模型/备用模型。
* 画图模型允许从检测结果中勾选多个模型：第一个作为主模型，其余写入备用模型。
* 检测失败时显示清晰错误，不破坏已输入的配置。
* 保留手动输入模型名能力，兼容不支持 `/models` 的供应商。
* 多轮对话后页面外壳保持一屏高度，滚动只发生在聊天消息流内部，整体交互贴近 ChatGPT 官网的固定侧栏 + 底部 composer 样式。
* 空对话时 composer 居中展示；用户输入但未发送草稿时，空态标题和快捷按钮仍保留；首条消息发送后 composer 再回到底部。
* 用户消息不显示“你/You”标签；主区右上角不再显示“结果/Results”按钮，结果入口统一收敛到图片管理/空态入口。
* 主区右上角不再显示“分析/Analysis”按钮；运行状态与平面图分析入口移到设置菜单的“高级功能/Advanced”。
* 快捷短语在图像模式的新生成 composer 中直接显示和可用，不只限定 3D 效果图模式。
* 快捷短语在 composer 最底部以更小的紧凑样式显示，避免抢占主输入区。
* composer 右侧的供应商名称、模型切换和思考强度控件保持紧凑尺寸。
* “严格复核”不放在 composer 快捷操作里，统一放到设置菜单的“高级功能/Advanced”中，与运行阶段和分析结果同组。
* 3D 效果图模式支持只输入文字直接生成；平面图是可选结构参考。彩色平面图工具仍需要上传平面图。
* 工作台支持拖拽上传图片；拖入图片时应自动进入图像工作台并追加为平面图附件。
* 快捷短语编辑只保留一个文本字段，不再分中文/英文两份。
* API 供应商设置里的模型搜索按钮保持紧凑并排，不占用整块大按钮面积。

## Acceptance Criteria

* [ ] 截图中类似 `1. **日常问答** ... 2. **写作** ...` 的回复在聊天区呈现为有序列表和加粗标题。
* [ ] 当只配置 `gpt-5.5` 时，聊天 composer 模型下拉不再出现 `gpt-4o` 等硬编码默认项。
* [ ] API 配置页可以检测分析模型并多选加入聊天模型候选。
* [ ] API 配置页可以检测画图模型并勾选主模型/备用模型。
* [ ] 检测接口对 OpenAI-compatible `/models` 响应做去重、排序和错误处理。
* [ ] 多轮对话后浏览器页面本身不继续拉长，聊天记录在中间消息区滚动，composer 固定在主区域底部。
* [ ] 未发送草稿不隐藏空态文案；空对话 composer 居中，发送后 composer 靠下。
* [ ] 用户消息气泡只显示正文；主区 header 不再出现“结果”按钮。
* [ ] 主区 header 不再出现“分析”按钮；设置菜单包含“高级功能”入口并打开原运行状态/分析面板。
* [ ] 图像模式的新生成 composer 在标准画图和 3D 模式下都显示快捷短语。
* [ ] 快捷短语显示在 composer 底部且尺寸更小；供应商/模型控件视觉尺寸更紧凑。
* [ ] “严格复核”在高级功能面板中可开关，composer 内不再出现该按钮。
* [ ] 3D 效果图模式在没有上传平面图时，只要填写提示词即可提交生成；彩色平面图工具仍保留平面图必填。
* [ ] 将图片文件拖入工作台会显示拖拽提示并追加到平面图附件。
* [ ] 快捷短语编辑只显示一个输入框，并兼容旧的 `zh/en` 本地/后端数据。
* [ ] 模型搜索/加入按钮在 API 设置里并排紧凑展示。
* [ ] `npm run build` 通过，相关轻量测试通过。

## Definition of Done

* 前端交互完成并通过类型检查/构建。
* 后端新增模型检测接口并覆盖基本测试。
* 不引入新的大型前端依赖。
* 若发现新的项目约定，完成 Trellis spec 更新判断。

## Technical Approach

* 在 `App.tsx` 中增加轻量消息内容渲染函数，避免 `dangerouslySetInnerHTML`。
* 移除聊天 composer 对硬编码默认模型的依赖，改为从当前主模型、备用模型、检测结果组合候选。
* 在 `api/config.ts` 增加 `detectModels(role, apiConfig)` 客户端方法。
* 在 `backend/app/routes/config.py` 增加 `/api/config/models-{role}` 或等价接口，复用账号配置解析逻辑。
* 在 `app_runtime.py` 中增加模型列表检测 helper，优先支持 OpenAI-compatible `/models`，Anthropic 可走其模型列表接口；不支持的格式返回可读错误。
* API 配置页展示检测到的模型 chip/checkbox，不移除原有输入框和备用模型 textarea。
* 固定 `.studio-shell` / `.chatgpt-layout` / `.chatgpt-main` 的视口高度，避免父级 `min-height` 随消息内容撑开；保留 `.chatgpt-thread` 作为唯一主滚动区域。
* 将空态判断抽成 `isEmptyConversation = messages.length === 0 && !isRendering && !isChatResponding`，不要把 `chatInput` 草稿纳入空态退出条件。

## Decision (ADR-lite)

**Context**: 模型列表属于供应商远程状态，前端不能可靠硬编码；但不同供应商模型列表接口并不完全统一。

**Decision**: MVP 后端提供统一检测接口，先支持 OpenAI-compatible `/models` 和可兼容的常见响应格式，前端保留手动输入作为兜底。

**Consequences**: 用户体验明显改善；部分供应商仍可能需要手动输入，但失败会有明确提示，不会阻塞保存和验证。

## Out of Scope

* 不做模型能力自动分类或价格/上下文窗口展示。
* 不移除手动模型输入。
* 不为所有非 OpenAI-compatible 供应商实现专用模型列表协议。
* 不改变现有 API Key 保存和账号隔离规则。

## Technical Notes

* 前端相关文件：`attuno-studio/ui-prototype/src/App.tsx`、`src/api/config.ts`、`src/styles.css`。
* 后端相关文件：`attuno-studio/backend/app/routes/config.py`、`attuno-studio/app_runtime.py`。
* 测试相关文件：`attuno-studio/tests/test_backend_api.py`、`attuno-studio/ui-prototype/tests/composerLayout.test.ts`。
* 适用 spec：`.trellis/spec/frontend/index.md`、`.trellis/spec/frontend/state-management.md`、`.trellis/spec/frontend/type-safety.md`、`.trellis/spec/frontend/quality-guidelines.md`、`.trellis/spec/backend/index.md`、`.trellis/spec/backend/error-handling.md`、`.trellis/spec/guides/index.md`、`.trellis/spec/guides/cross-layer-thinking-guide.md`、`.trellis/spec/guides/code-reuse-thinking-guide.md`。
