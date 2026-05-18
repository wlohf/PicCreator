# 聊天产品定位与用户管理完善

## Goal

将当前项目从“偏 3D 生图工作台”的定位调整为“聊天优先的 AI 对话界面，带有面向生图的辅助能力”。用户可以像日常聊天一样使用系统，需要生图时再通过快捷短语、内置提示词、平面图/结果上下文和图像模式获得更好的生成质量。同时补齐真实用户管理，让每个登录用户的 API key、配置、历史、结果和偏好隔离清楚，避免敏感信息通过临时命名空间或默认配置泄漏。

## What I Already Know

* 前端已经有接近 ChatGPT/OpenAI 官网聊天界面的布局：左侧历史、主聊天区、底部 composer、设置弹窗和“聊天/图像”模式切换。
* 现有品牌文案仍偏“Render Director Studio / 室内效果图设计工作台 / Generation workspace”，没有体现“日常对话 + 生图辅助”的产品定位。
* 后端已有真实账号能力：`/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`，session cookie 名为 `render_agent_session`。
* 前端也已有 `auth.ts` API 封装，但主界面仍使用“临时访问标识”弹窗，并明确提示“不是安全登录”。
* `apiFetch` 当前会在存在 `currentUserId` 时发送 `X-Render-Agent-User-Token`，而后端 `get_current_or_default_user()` 会优先解析这个临时 namespace。若要做真实用户管理，这个 header 不能继续作为登录用户的主身份来源。
* 现有用户 key 隔离已完成一部分：`resolve_config_user_id(user)` 统一配置归属，登录用户和 token namespace 用户都有后端测试覆盖，非 default 用户不应回退默认 `.env` / `config.json` API key。
* 结果、偏好、快捷短语等数据已经按 `user_id` 命名空间落盘。
* 当前记忆方案在 `preferences_store.py` 中维护快捷短语、显式/推断偏好、项目记忆、行为信号和偏好摘要；`DesignChatAgent` 用确定性关键词抽取 `memory_candidate`，前端提供“记住偏好”按钮手动写入。
* 现有记忆更像“偏好/风格/生成习惯记忆”，不是通用对话长期记忆。

## Assumptions

* 产品可以“借鉴 ChatGPT/OpenAI 官网式聊天体验”，但不直接使用 OpenAI 品牌名作为产品名或界面品牌。
* 日常聊天是默认可用能力；图像生成功能作为 composer 的模式/工具增强出现，而不是把整个产品称为单一生图器。
* 真实用户管理应成为默认入口；临时访问标识最多保留为本地/demo/访客模式，并在 UI 上与安全登录明确区分。
* 敏感信息包括 analysis/image API key、provider/base URL 中可能含凭据的字段、后续可能增加的个人系统提示词和私有记忆。

## Open Questions

* None. User confirmed real accounts should be the default identity model and the frontend temporary access-token flow should be removed.

## Requirements

* 产品定位与命名：
  * 将主品牌、标题、状态文案从“生成工作台/Render Director”调整为聊天优先的名称与文案。
  * 聊天模式不应显得像生图工具的附属页；图像模式应是可切换的增强能力。
  * 快捷短语、内置提示词、提示词设置应被解释为“图像辅助能力”，不应干扰普通聊天。
* 用户管理：
  * 前端启动时调用 `/api/auth/me` 识别真实登录状态。
  * 未登录用户看到登录/注册入口，而不是默认要求输入临时访问标识。
  * 登录后所有配置、结果、快捷短语、偏好、聊天历史都以登录用户为主身份隔离。
  * 登出后清空当前可见聊天、结果、配置缓存和用户态，不能继续展示上一用户数据。
  * 前端移除临时访问标识入口、本地 token 存储、token 切换弹窗和 token header 主路径。
  * 后端可以保留 token namespace 兼容测试/旧调用，但真实登录 session 必须优先，已登录请求不能被 `X-Render-Agent-User-Token` 覆盖到任意 namespace。
  * 保存/读取/验证/生成 API key 时继续复用 `resolve_config_user_id(user)`，确保每个用户独立。
* 记忆模式：
  * 保留“手动确认后记住”的路径，避免普通聊天误保存敏感或错误偏好。
  * 记忆面板应能让用户看见当前记住了什么，至少能区分长期偏好、避免项、项目偏好、评判标准和最近常见修改。
  * 增加记忆编辑/删除能力，让用户能修正误记内容。
  * 日常聊天记忆和生图偏好记忆要在界面和数据结构上分清：日常记忆保存用户明确要求记住的事实/偏好，生图偏好继续保存风格、避免项、项目约束和评判标准。

## Acceptance Criteria

* [ ] 打开应用时，未登录状态显示真实登录/注册入口，界面不再默认说“临时标识不是安全登录”。
* [ ] 注册/登录成功后，侧边栏显示当前账号，`/api/auth/me` 返回 authenticated=true。
* [ ] 登录用户 A 保存 API key 后，用户 B 登录不能看到或使用 A 的 key。
* [ ] 登录用户缺少自己的 key 时，验证/生成返回清晰错误，不回退 default/workspace key。
* [ ] 已登录用户请求不会被 `X-Render-Agent-User-Token` 覆盖到任意 namespace。
* [ ] 前端删除临时访问标识弹窗、token 切换按钮和 token localStorage 依赖。
* [ ] 登出后，聊天历史、结果库、偏好摘要、API 配置和快捷短语 UI 不继续显示上一用户内容。
* [ ] 产品文案清楚表达“聊天为主，图像生成为增强能力”。
* [ ] 记忆面板可解释当前记忆内容，并支持编辑/删除记忆项。
* [ ] 日常聊天中明确触发“记住”时，可以保存到日常记忆；普通聊天不会自动保存。
* [ ] 相关后端 pytest 和前端 build/test 通过。

## Definition Of Done

* PRD scope confirmed by user.
* Implementation context jsonl curated before coding.
* Backend auth/config/preference/result tests updated.
* Frontend auth/session and user-state tests updated where feasible.
* Build/typecheck/test commands pass for touched layers.
* No unrelated dirty worktree changes are reverted or silently included.

## Out Of Scope

* 不接入第三方 OAuth、邮箱验证、找回密码、多租户管理员后台。
* 不把 API key 加密存储到系统级密钥管理服务。
* 不实现完整 RAG/向量数据库式长期语义记忆。
* 不完全复刻 OpenAI 官网品牌、Logo 或受保护商标。

## Technical Notes

* Existing auth backend:
  * `3d-render-agent/backend/app/services/auth_service.py`
  * `3d-render-agent/backend/app/routes/auth.py`
* Config/key isolation:
  * `3d-render-agent/backend/app/routes/config.py`
  * `3d-render-agent/app_runtime.py`
  * `3d-render-agent/tests/test_backend_api.py`
  * Existing active task: `.trellis/tasks/05-15-user-key-isolation/prd.md`
* Frontend identity flow:
  * `3d-render-agent/ui-prototype/src/App.tsx`
  * `3d-render-agent/ui-prototype/src/api/auth.ts`
  * `3d-render-agent/ui-prototype/src/api/client.ts`
* Memory/preferences:
  * `3d-render-agent/backend/app/services/preferences_store.py`
  * `3d-render-agent/backend/app/services/design_chat_agent.py`
  * `3d-render-agent/backend/app/routes/chat.py`
  * `3d-render-agent/backend/app/routes/preferences.py`
  * `3d-render-agent/ui-prototype/src/api/chat.ts`
  * `3d-render-agent/ui-prototype/src/api/preferences.ts`
* Relevant specs:
  * `.trellis/spec/backend/index.md`
  * `.trellis/spec/backend/generation-contracts.md`
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/type-safety.md`
  * `.trellis/spec/guides/cross-layer-thinking-guide.md`
  * `.trellis/spec/guides/code-reuse-thinking-guide.md`
