# Attuno 历史聊天首屏加载性能优化方案

## 背景

网页端打开 Attuno 后，历史聊天需要约 10 秒才正常显示。当前实现的主要问题是启动阶段通过 `/api/chat-history` 一次性加载账号下完整历史：最多 100 个会话，每个会话都包含完整 `messages`、变体、附件与图像相关字段。前端收到后还会同步执行 JSON 解析、会话归一化、活跃消息路径计算、历史搜索文本构建和列表渲染，导致首屏被完整历史数据阻塞。

## 现状链路

```text
App startup
  -> /api/auth/me resolves currentUserId
  -> loadChatHistory(currentUserId)
  -> backend load_chat_history(user_id)
  -> read chat_histories.payload or chat_history.json
  -> normalize every session and full messages
  -> return full sessions[]
  -> frontend parseStoredSessions(JSON.stringify(serverHistory))
  -> applyStoredSessionCollection(...)
  -> render sidebar/search/current session
```

关键代码位置：

- 前端加载入口：`attuno-studio/ui-prototype/src/App.tsx`
- 前端历史 API：`attuno-studio/ui-prototype/src/api/chatHistory.ts`
- 后端路由：`attuno-studio/backend/app/routes/chat_history.py`
- 后端存储：`attuno-studio/backend/app/services/chat_history_store.py`

## 性能瓶颈

1. **接口返回过重**：`GET /api/chat-history` 返回全量 `sessions[].messages`，历史越多越慢。
2. **首屏等待服务端**：前端优先等待服务端历史成功后才应用会话，本地缓存没有作为首屏快速路径。
3. **保存粒度过粗**：会话状态变化后会把完整历史重新序列化并 PUT 到后端。
4. **搜索依赖完整消息**：聊天搜索会扫描活跃路径内容，因此摘要列表如果不设计搜索字段，会被迫保留完整消息。
5. **存储结构暂未拆分**：PostgreSQL 目前仍以每用户一条 JSONB payload 保存完整聊天历史，短期无法只从数据库读取摘要字段；但可以在服务层生成轻量摘要并减少网络与前端首屏解析成本。

## 优化目标

### MVP 目标

- 首屏历史侧栏可在本地缓存存在时立即显示，不再等待服务端完整历史。
- 前端启动默认请求服务端轻量摘要，不携带完整 `messages`。
- 打开具体历史会话时再懒加载完整会话详情。
- 保存仍兼容现有整包历史格式，避免本轮重构数据库。
- 保持账号隔离、legacy localStorage 恢复、图片结果恢复历史的现有行为。

### 非目标

- 不在本轮拆分 PostgreSQL 表结构。
- 不重做历史搜索为服务端全文搜索。
- 不改变消息树、variant、图片历史恢复等会话语义。

## 数据契约

### 会话摘要

新增轻量摘要类型，字段来自现有会话记录，但 `messages` 永远为空数组：

```ts
type ChatSessionSummaryPayload = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: [];
  chatInput: string;
  workspaceMode: "chat" | "image";
  generationMode: GenerationMode;
  composerMode: "new-generation" | "edit-selected-result";
  activeResultId: string | null;
  activeMessageId: string | null;
  pinnedAt?: string | null;
  titleLocked?: boolean;
  hasMessages: boolean;
  messageCount: number;
  searchText: string;
};
```

### API 调整

- `GET /api/chat-history?summary=1`
  - 返回 `history.sessions[]` 摘要列表。
  - `sessions[].messages` 为空，避免首屏传输大 payload。
  - `hasMessages/messageCount/searchText` 供前端判断可显示与搜索。
  - 继续使用当前账号 session；兼容调用可继续通过 `user_id` query 指定 namespace。
- `GET /api/chat-history/{session_id}`
  - 返回单个完整 session。
  - 若不存在，返回 404。
  - 继续使用当前账号 session；兼容调用可继续通过 `user_id` query 指定 namespace。
- `GET /api/chat-history`
  - 保持兼容，仍返回完整历史。
- `PUT /api/chat-history`
  - 保持兼容，仍保存完整历史。
  - 如果请求内某个会话是摘要占位（`messages: []` 且 `hasMessages/messageCount` 表示后端已有消息），后端必须先与现有完整 payload 合并，再写入，避免摘要空消息覆盖完整历史。

## 前端策略

1. 启动时先读账号命名空间下的 `localStorage`。
   - 如果有可恢复会话，立即 `applyStoredSessionCollection(...)`。
   - 这只是快速首屏，不代表服务端已同步完成。
2. 后台请求 `loadChatHistorySummary(currentUserId)`。
   - 若服务端有摘要，用摘要合并当前本地会话列表。
   - 当前打开会话若本地已有完整消息，不被摘要覆盖。
   - 若本地没有可用会话但服务端有摘要，选择服务端 `currentSessionId`（或第一条摘要）作为当前会话，并立即懒加载该会话详情；不要新建一个空白对话挡在历史列表前。
3. 打开历史会话时执行懒加载。
   - 如果目标 session 已有完整 `messages`，直接打开。
   - 如果只有摘要或消息为空，调用 `loadChatSession(sessionId, currentUserId)` 拉完整详情，再应用。
4. 保存时继续保存完整可持久化列表。
   - `sessionsForBackendSave(...)` 将摘要会话作为摘要占位发送，不把它伪装成完整空会话。
   - 前端合并服务端摘要时用 `mergeSessionPreservingDetail(...)` 保留本地已有完整 `messages`。
   - 后端 `save_chat_history(...)` 再用现有 payload 合并摘要占位，形成第二道保护。
5. 搜索策略。
   - 摘要列表使用 `searchText/title/chatInput` 搜索。
   - 完整会话仍可使用消息内容搜索。

## 后端策略

1. 在 `chat_history_store.py` 增加：
   - `load_chat_history_summary(user_id)`
   - `load_chat_session(session_id, user_id)`
   - 摘要构建函数 `_summarize_session(...)`
   - 摘要保存保护 `_merge_summary_payload_with_existing(...)`
2. `load_chat_history_summary` 仍读取现有完整 payload，但只返回轻量字段。
3. `load_chat_session` 从完整 payload 查找单个会话。
4. 摘要生成保留排序、最大会话数、账号隔离现有逻辑。
5. `GET /api/chat-history` 和 `PUT /api/chat-history` 继续维持旧客户端可用；新增能力只扩展查询参数和详情路由。

## 验收标准

- 后端测试证明 `summary=1` 不返回完整消息，但返回 `hasMessages/messageCount/searchText`。
- 后端测试证明 `GET /api/chat-history/{session_id}` 返回完整消息，缺失 session 返回 404。
- 前端静态测试证明启动使用 `loadChatHistorySummary`，打开摘要会话使用 `loadChatSession`。
- 前端静态测试证明本地缓存会在服务端请求前应用为快速首屏。
- 前端静态测试证明摘要列表搜索使用 `searchText`，保存路径经过 `sessionsForBackendSave`，不会把摘要占位当作完整空会话。
- `npm run test:chat-api` 通过。
- `npm run test:chat-sessions` 通过。
- 相关后端 pytest 通过。
- `npm run build` 通过或明确记录失败原因。

## 后续可选优化

- 将 `chat_histories` 拆为 `chat_sessions` 与 `chat_session_payloads/chat_messages`。
- 增加服务端分页：`limit/offset` 或 cursor。
- 增加历史全文搜索接口，避免前端加载所有消息后搜索。
- 保存改为 debounce + 当前 session 增量保存。
- 增加前端性能埋点：本地恢复耗时、摘要接口耗时、单会话懒加载耗时。
