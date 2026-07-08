# 优化 Attuno 历史聊天首屏加载性能

## Goal

将网页端打开 Attuno 时历史聊天约 10 秒才显示的问题优化为“先快速显示本地/摘要历史，再按需加载完整会话”，减少首屏等待、网络传输和前端同步解析压力。

## Requirements

- 新增或更新技术文档，记录当前瓶颈、数据链路、API 契约、前端策略、后端策略和验收标准。
- 后端支持轻量历史摘要加载：`GET /api/chat-history?summary=1` 返回会话摘要列表，不返回完整 `messages`。
- 后端支持单会话详情加载：`GET /api/chat-history/{session_id}` 返回指定会话完整消息。
- 现有 `GET /api/chat-history` 与 `PUT /api/chat-history` 保持兼容，避免破坏已有客户端和 legacy 数据迁移。
- 前端启动时优先应用账号 scoped localStorage 作为快速首屏，再后台刷新服务端摘要。
- 前端历史列表可显示摘要会话，并能在点击会话时懒加载完整详情。
- 前端保存逻辑不得把摘要空消息覆盖后端完整历史。
- 保持账号隔离与现有 `user_id` compatibility query 约定。

## Acceptance Criteria

- [ ] `attuno-studio/docs/chat-history-performance-plan.md` 存在并描述本轮技术方案。
- [ ] 后端测试覆盖摘要接口不返回完整消息。
- [ ] 后端测试覆盖单会话详情接口返回完整消息和缺失 404。
- [ ] 前端测试覆盖 `loadChatHistorySummary` / `loadChatSession` API 与启动、打开会话懒加载调用路径。
- [ ] `npm run test:chat-api` 通过。
- [ ] `npm run test:chat-sessions` 通过。
- [ ] 相关后端 pytest 通过。
- [ ] 前端 build/typecheck 通过，或记录明确阻塞原因。

## Definition of Done

- 文档、后端、前端和测试均已更新。
- 不破坏现有聊天历史保存、账号隔离、图片历史恢复和 legacy localStorage 恢复。
- 不引入数据库拆表迁移作为本轮必要条件。
- 运行验证命令并记录结果。

## Technical Approach

采用低风险两阶段加载：首屏使用 localStorage 快速恢复，服务端默认请求切换为摘要列表，点击具体历史会话时再按需加载完整详情。后端仍基于现有 JSON/JSONB payload 生成摘要，避免本轮进行数据库结构拆分。

## Decision (ADR-lite)

**Context**: 当前完整历史一次性加载导致首屏阻塞；但聊天历史结构包含消息树、variants、图片记录和账号隔离，直接拆表风险较高。

**Decision**: 本轮先实现摘要接口 + 单会话懒加载 + 前端本地快速首屏，不做数据库拆表。

**Consequences**: 网络传输和前端首屏解析显著降低；后端仍需要读取完整 JSONB 来生成摘要，数据库层性能会留给后续拆表优化。

## Out of Scope

- PostgreSQL 表结构拆分。
- 服务端全文搜索。
- 历史分页和 cursor。
- 保存接口改为当前 session 增量保存。
- 大规模 UI 重构。

## Technical Notes

- 技术方案：`attuno-studio/docs/chat-history-performance-plan.md`
- 前端主要文件：`attuno-studio/ui-prototype/src/App.tsx`
- 前端历史 API：`attuno-studio/ui-prototype/src/api/chatHistory.ts`
- 前端会话 helper：`attuno-studio/ui-prototype/src/utils/chatSessions.ts`
- 后端路由：`attuno-studio/backend/app/routes/chat_history.py`
- 后端存储：`attuno-studio/backend/app/services/chat_history_store.py`
- 相关规范：`.trellis/spec/frontend/state-management.md`、`.trellis/spec/backend/generation-contracts.md`
