# 修复分支对话空白与生成/图像模式交互

## Goal

修复当前聊天与图像工作台的三个用户可见问题：点击分支对话后页面不应变空白；AI 输出期间右下角发送按钮应进入“生成中/停止”状态并允许暂停；画图模式应支持文生图、图生图，以及基于已有/上传图片的二次编辑。

## Requirements

- 点击分支对话或分支导航时，前端必须稳定渲染对应 active path，不能因为缺失或不一致的 `activeMessageId` / `parentId` 导致空白页或异常。
- 当当前会话正在进行 AI 输出时，右下角发送按钮显示生成中/停止语义，点击后中止当前流式请求，并保留已输出内容。
- 聊天流式 busy 状态按会话隔离；一个会话生成中不应让其他会话的发送逻辑错误禁用或崩溃。
- 图像工作台的 `standard` 模式支持仅文本文生图，也支持带上传图片的图生图/参考图生成。
- 图像工作台的编辑/二次编辑入口支持使用已有结果图片，也支持用户上传参考图片后提交编辑。
- `render3d` 和 `colored_floor_plan` 仍按现有结构化 floor-plan 契约处理，不把所有上传图片都误判为必需 floor plan。

## Acceptance Criteria

- [ ] 打开/切换分支聊天不会出现空白页，历史线性会话和树状会话都能正常显示。
- [ ] 当前可见会话 streaming 时发送按钮变为停止/生成中状态，点击可中止，并允许再次发送。
- [ ] 中止流式聊天不会显示通用后端失败气泡。
- [ ] 图像模式 `standard` 无上传图片时可文生图，有上传图片时可作为参考图/图生图生成。
- [ ] 图像编辑模式可使用已有结果或上传图片作为编辑源。
- [ ] 相关前端类型检查/后端测试通过，或明确说明无法运行的原因。

## Definition of Done

- 更新前端状态和提交逻辑，保持现有 UI/状态管理约定。
- 若后端契约或请求字段需要调整，同步 API 客户端、路由/服务和测试。
- 运行聚焦测试或类型检查；若环境限制导致无法运行，记录限制。

## Technical Approach

先定位 `App.tsx`、聊天会话 helper、API client、后端 `/api/generate` / image edit 路由与相关测试。优先复用现有 branch path helper、`AbortController` 流式聊天客户端、附件上传结构和 OpenAI Images API 图片输入路由。只在缺少兼容分支时补齐 guard/normalization，不重写整体聊天架构。

## Decision (ADR-lite)

**Context**: 用户报告的是线上交互断裂，且仓库已有分支会话、流式暂停、图像输入契约。  
**Decision**: 以现有契约为准修 bug：分支显示走 active path 容错；流式停止走 session-scoped abort；图像 `standard` 上传图片走 reference image，不把它归为 floor-plan-only。  
**Consequences**: 改动范围集中，但需要同时覆盖前端状态、请求 payload 和后端图片输入映射。

## Out of Scope

- 不新增全新的图片供应商或模型配置体系。
- 不重做聊天 UI 视觉系统。
- 不改变 `render3d` / `colored_floor_plan` 的主要产品定位。
- 不实现多图高级编辑历史版本树，除非现有接口已支持且只需接线。

## Technical Notes

- Relevant specs:
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/backend/generation-contracts.md`
- Initial repo discovery:
  - `rg` execution is denied in this environment, so use PowerShell/Git search fallback.
  - Semantic search timed out and CodeGraph is not initialized for this workspace.
