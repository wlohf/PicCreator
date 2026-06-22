# Fix Cross-Account User Data Isolation

## Goal

修复账号隔离失效问题，确保不同登录账号在聊天历史、图片管理结果以及相关恢复流程中不会看到彼此的数据；同时保留对旧匿名 `default` 数据的可控兼容，而不是隐式串用。

## What I already know

* 用户反馈：登录不同账号后，聊天记录和图片管理内容是一样的。
* 后端聊天历史和图片结果存储都支持按 `user_id` 分目录保存。
* 前端聊天本地恢复逻辑会扫描 `default`、旧 key，甚至其他账号的聊天历史 key，并在发现可恢复数据后复制到当前账号的主 key。
* 前端部分接口对用户命名空间的传递不一致，聊天历史接口完全依赖 cookie，结果列表接口仅在 `user_id === "default"` 时显式追加命名空间查询参数。
* 聊天接口客户端在请求体里先写入 `user_id: "default"`，虽然当前调用大多会覆盖，但这属于危险默认值。

## Assumptions (temporary)

* 当前主要问题不是后端文件分目录缺失，而是前端恢复/调用链路把数据错误地落回了 `default` 或跨账号 key。
* 对已登录账号而言，默认应优先保证严格隔离，而不是自动继承匿名或其他账号历史。

## Open Questions

* 旧的匿名 `default` 数据，在用户登录新账号后，是否需要自动迁移到某个账号下，还是保持完全分离？

## Requirements (evolving)

* 已登录账号只能读取自己的聊天历史。
* 已登录账号只能读取自己的图片管理结果和对应资源地址。
* 前端本地恢复逻辑不能再跨账号扫描并注入其他账号的历史数据。
* 用户命名空间在聊天历史、结果列表和资源 URL 上应保持一致传递，避免依赖单一 cookie 路径。

## Acceptance Criteria (evolving)

* [ ] 账号 A 创建聊天记录和图片结果后，切换到账号 B，不会看到 A 的聊天和图片。
* [ ] 账号 B 的空历史不会因为本地 `default` 或其他账号缓存而被自动填充。
* [ ] 结果图片/下载/标注等资源 URL 在切换账号后仍只访问当前账号可见的数据。
* [ ] 相关前端或后端测试覆盖账号隔离与恢复场景。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 不处理跨设备数据同步能力设计。
* 不做完整的用户数据迁移工具，除非本任务明确需要。

## Technical Notes

* 相关文件：
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/api/chat.ts`
  * `attuno-studio/ui-prototype/src/api/chatHistory.ts`
  * `attuno-studio/ui-prototype/src/api/results.ts`
  * `attuno-studio/ui-prototype/src/utils/resultAssetUrls.ts`
  * `attuno-studio/backend/app/services/auth_service.py`
  * `attuno-studio/backend/app/services/chat_history_store.py`
  * `attuno-studio/backend/app/services/result_store.py`
* 当前最明确的串号点：
  * `loadStoredSessions(userId)` 会回收 `default` 和其他账号的 key。
  * `listResults(userId)` 对非 `default` 账号不显式携带命名空间参数。
  * `loadChatHistory()` / `saveChatHistory()` 没有显式用户命名空间兜底。
