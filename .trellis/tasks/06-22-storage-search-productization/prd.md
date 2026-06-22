# PostgreSQL 存储与联网搜索产品化改进

## Goal

把 Attuno Studio 从分散 JSON 文件存储推进到 PostgreSQL-first 的可部署产品形态，同时完善联网搜索来源展示、Tavily key 健康状态和主路径回归验证。图片、上传文件、生成产物继续保存在 `ATTUNO_STUDIO_DATA_DIR` 文件系统中，PostgreSQL 存储账号、配置、聊天、结果索引、偏好/记忆、搜索 key 状态等结构化元数据。

## What I already know

* 用户倾向“一步到位”使用 PostgreSQL，而不是先 SQLite。
* 当前数据分散在多处 JSON/文件：
  * `attuno-studio/config.json` 和 per-user `config/config.json` 保存模型供应商与 Tavily key 配置。
  * `backend/app/services/result_store.py` 使用 per-user `index.json` 保存结果资产索引，图片文件仍在用户运行目录下。
  * `backend/app/services/chat_history_store.py` 使用 per-user `chat-history.json` 保存聊天历史。
  * `backend/app/services/preferences_store.py` 使用 per-user `preferences.json` 保存快捷短语、提示词、风格画像和记忆。
  * `backend/app/services/auth_service.py` 使用 JSON 保存用户和 session。
* 当前联网搜索后端已返回结构化 `web_search` metadata：`query`, `results`, `ok`, `provider`, `answer`, `search_profile`, `search_parameters`, `diagnostics`, `decision`。
* 当前部署脚本只安装 Git、Python、Nginx、curl、ca-certificates，没有安装 PostgreSQL 客户端/服务端。
* 当前 `requirements.txt` 没有 DB 驱动或 ORM。
* 当前生产规范要求运行数据放在 `ATTUNO_STUDIO_DATA_DIR=/var/lib/attuno`，后端由 systemd 运行，前端由 Nginx 托管。
* 用户确认兼容策略为方案三：生产部署必须配置 PostgreSQL，本地开发/测试允许 JSON fallback。
* 用户希望 Web 端提供更新检测按钮，可手动或自动检测 GitHub 是否有新版，并从 Web 端触发更新。
* 当前只有普通账号登录/注册，没有 admin 角色模型；Web 更新功能必须新增部署管理员保护，不能让任意登录用户触发服务器命令。
* 用户选择部署管理员密钥方案，并希望管理员用户名为 `admin`。管理员密码属于部署 secret，不写入 PRD、源码或 Git，只通过服务器 `.env`/systemd 环境变量配置。

## Storage Decision

**选择 PostgreSQL-first。**

### Rationale

* 目标是产品化和可部署，而不是只服务单机本地运行。PostgreSQL 更适合后续多用户、多设备、多进程、远程备份和数据分析。
* 用户希望一步到位，避免先 SQLite 后 PostgreSQL 的二次迁移。
* 当前最重要的设计边界不是“能不能用 PostgreSQL”，而是避免一次性重写所有 store 造成不可验证的大爆炸。应先引入稳定 DB 基础设施和 repository 边界，再分阶段迁移业务数据。

### Consequences

* 需要新增 Python PostgreSQL 依赖和数据库初始化/迁移脚本。
* 部署文档、systemd 环境和 install/update 流程需要说明 `DATABASE_URL`。
* 生产环境必须配置 PostgreSQL；本地开发和测试允许在没有 `DATABASE_URL` 时继续走 JSON fallback。
* 文件系统仍然是图片/附件/生成产物的存储位置，DB 只保存路径、URL、元数据和业务状态。

## Requirements

### PostgreSQL Foundation

* 新增数据库配置入口：
  * `DATABASE_URL` 指向 PostgreSQL，例如 `postgresql://attuno:password@127.0.0.1:5432/attuno`。
  * 生产模式未配置 `DATABASE_URL` 时启动或健康检查必须给出明确错误。
  * 本地开发/测试未配置 `DATABASE_URL` 时继续使用现有 JSON fallback。
  * 生产/本地判断可以由 `ATTUNO_ENV=production|development|test` 或同等环境变量控制；默认本地兼容，部署文档要求生产显式配置。
* 新增 DB 模块，提供：
  * 连接管理。
  * schema 初始化。
  * 幂等迁移。
  * health check / startup diagnostic。
* 新增部署文档和示例环境变量：
  * PostgreSQL 安装/创建数据库/创建用户。
  * systemd `Environment=DATABASE_URL=...` 示例。
  * 更新脚本执行迁移或提示手动迁移。
* 新增测试策略：
  * 没有 `TEST_DATABASE_URL` 时，DB 集成测试可跳过或使用 fake connection。
  * 有 `TEST_DATABASE_URL` 时，运行真实 PostgreSQL schema/migration 测试。

### First Migration Slice

* 先迁移 Tavily key 运行状态和搜索审计元数据：
  * 每个用户保存 key fingerprint、轮询指针、最近失败状态、失败次数、最近使用时间、冷却到期时间。
  * 不在日志、诊断、前端 metadata 中暴露 raw API key。
  * `claim_tavily_api_keys(user_id)` 保持现有配置读取能力，但 key 排序/健康状态优先走 PostgreSQL。
  * 搜索尝试成功/失败后写入 PostgreSQL 状态。
* 新增 `search_events` 或同等表：
  * 保存 user_id、query、provider、status、diagnostics 摘要、result count、created_at。
  * 不保存 raw key 或敏感 headers。
  * 用于后续调试、质量分析和 UI 扩展。

### Search Source UI

* 前端在 assistant 回复下展示搜索来源卡片或折叠区。
* 展示 provider、query、搜索策略、Tavily answer（如果有）、来源标题、URL、snippet、published date、score（如果有）。
* 搜索失败时展示可行动诊断，不泄露 API key。
* SSE 流式响应和普通响应都要保留同样的 `web_search` metadata。

### Web Update Detection & Update Flow

* 新增“系统维护/更新”设置分区或同等入口，只对部署管理员可见。
* 后端新增安全的更新 API：
  * `GET /api/system/update/status`：返回当前提交、远端提交、是否有新版、上次检测时间、上次更新状态。
  * `POST /api/system/update/check`：手动检测 GitHub `origin/main` 是否有新版。
  * `POST /api/system/update/apply`：触发受控更新流程。
* 自动检测：
  * 前端可在管理员打开设置时触发一次检测。
  * 后端可缓存检测结果，避免频繁访问 GitHub。
  * 可选增加 `ATTUNO_UPDATE_AUTO_CHECK_INTERVAL_SECONDS`，默认不开后台循环。
* 安全边界：
  * 默认禁用更新执行，必须设置 `ATTUNO_UPDATE_ENABLED=1`。
  * 更新 API 必须要求部署管理员授权。第一阶段使用环境变量配置的管理员凭据：
    * `ATTUNO_UPDATE_ADMIN_USERNAME=admin`
    * `ATTUNO_UPDATE_ADMIN_PASSWORD_HASH=<password-hash>` 优先。
    * 可选本地开发 fallback：`ATTUNO_UPDATE_ADMIN_PASSWORD=<raw-password>`，但部署文档应推荐 hash，不推荐生产明文。
  * 管理员密码不得写入 tracked files、前端 bundle、日志、测试快照或 API 响应。
  * 更新执行不得接受任意 shell 命令或任意分支参数；只允许固定仓库当前工作树执行受控脚本。
  * 更新日志不能泄露 `.env`、API key、数据库 URL 密码。
* 执行方式：
  * 检测使用 Git 命令或 GitHub API 比较本地 `HEAD` 与 `origin/main`。
  * 应复用或包装 `deploy/update.sh` 的逻辑，而不是在路由里散落执行 `git pull`、`pip install`、`npm build`。
  * 更新过程可能重启 API 服务；前端应显示“更新中/服务可能短暂断开”，并在健康检查恢复后提示刷新。
  * 如果工作树有未提交改动、非 fast-forward、测试/构建失败或健康检查失败，应停止并返回可读错误。
* UI 行为：
  * 显示当前版本、GitHub 最新版本、是否有更新、检测时间。
  * 提供“检查更新”按钮。
  * 有新版时提供“开始更新”按钮，并二次确认。
  * 显示最近更新日志摘要和失败原因。

### Compatibility / Migration

* 现有 JSON 数据不能被删除或覆盖。
* 第一阶段不强制把所有历史 JSON 迁移到 PostgreSQL，除非用户选择“全量迁移”路线。
* 应提供至少一个迁移/检查命令或脚本，用于验证 PostgreSQL 可连接并初始化表。
* 本地开发/测试保持当前账号配置、聊天历史、结果资产在未迁移前可继续使用。
* 生产部署以 PostgreSQL 为必需依赖；如果旧 JSON 数据仍需使用，应通过迁移脚本或明确的 fallback 开关处理。

### Git Remote Cleanup

* 修复本地 `origin.fetch` 里不存在分支导致 `git fetch --all` 失败的问题。
* 不修改 `vps` SSH 权限配置，除非用户明确要求。

## Acceptance Criteria

* [ ] 配置 `DATABASE_URL` 后，应用能初始化 PostgreSQL schema。
* [ ] 生产模式数据库不可连接或未配置时，API 健康检查/启动诊断返回明确错误；本地/测试模式可继续 JSON fallback。
* [ ] Tavily key 状态按用户隔离写入 PostgreSQL。
* [ ] Tavily key 失败时记录失败类型/时间/次数，并避免短时间内反复优先使用明显失败的 key。
* [ ] 搜索事件写入 PostgreSQL，且不包含 raw API key。
* [ ] 聊天触发联网搜索后，前端可展示来源列表和搜索诊断。
* [ ] 管理员可在 Web 端查看当前版本和 GitHub 最新版本。
* [ ] 管理员可手动检测更新；检测结果有缓存，失败时返回明确原因。
* [ ] 更新执行默认禁用；启用后必须通过管理员授权，并只运行受控更新流程。
* [ ] 更新管理员凭据只从环境变量读取；源码、PRD、测试夹具和前端 bundle 中不包含真实密码。
* [ ] 有未提交改动、非 fast-forward、构建失败或健康检查失败时，Web 更新流程不会静默覆盖代码或报告成功。
* [ ] `git fetch --all` 不再因本地 origin 的无效 fetch ref 失败；`vps` 权限失败只作为外部远端权限问题存在。
* [ ] 后端与前端相关测试通过。
* [ ] 部署文档说明 PostgreSQL 准备、`DATABASE_URL` 配置、更新检测/执行开关和权限策略。

## Definition of Done

* Tests added/updated for backend DB foundation, Tavily key state, search metadata, and frontend source rendering.
* Frontend static/build checks pass.
* Existing JSON config/data compatibility considered and covered by tests where feasible.
* `.trellis/spec/backend/database-guidelines.md` 更新为项目实际 PostgreSQL 约定。
* Deployment docs/scripts updated if runtime prerequisites change.
* Changes committed and pushed after verification.

## Technical Approach

### Recommended First Slice

1. Add dependency:
   * Prefer `psycopg[binary]` or `psycopg2-binary` for direct SQL access.
   * Avoid introducing a full ORM unless later migrations justify it.
2. Add `backend/app/services/db.py`:
   * `database_url()`
   * `connect()`
   * `initialize_database()`
   * `run_migrations()`
   * short transaction helper.
3. Add SQL migrations under a dedicated path such as `attuno-studio/backend/app/db/migrations/`.
4. Add tables for schema tracking, user runtime state, Tavily key state, search events.
5. Update `app_runtime.py` / `web_search.py`:
   * Keep raw keys in existing config for now.
   * Store key operational health in PostgreSQL by fingerprint.
   * Record success/failure attempts.
6. Update frontend `App.tsx`, `domain.ts`, `styles.css` to render source/diagnostic cards from `web_search`.
7. Update deploy docs and service example with optional/required `DATABASE_URL` depending on chosen compatibility policy.
8. Clean invalid `origin.fetch` ref.
9. Add `backend/app/services/update_service.py` and `backend/app/routes/system.py` for update status/check/apply.
10. Add a settings “系统维护/更新” panel in the frontend.

### Data Model Sketch

* `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
* `user_runtime_state(user_id TEXT PRIMARY KEY, tavily_next_key_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`
* `tavily_key_state(user_id TEXT NOT NULL, key_fingerprint TEXT NOT NULL, key_index INTEGER NOT NULL, failure_count INTEGER NOT NULL DEFAULT 0, last_status TEXT NOT NULL DEFAULT '', last_message TEXT NOT NULL DEFAULT '', last_used_at TIMESTAMPTZ, last_failed_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id, key_fingerprint))`
* `search_events(id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, query TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, result_count INTEGER NOT NULL DEFAULT 0, diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb, search_profile TEXT NOT NULL DEFAULT '', search_parameters JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`

Future tables, not required in first slice:

* `users`
* `sessions`
* `api_configs`
* `chat_sessions`
* `results`
* `preferences`
* `memory_items`

## Decision (ADR-lite)

**Context**: Current JSON storage is scattered and hard to operate as a product. User prefers a one-step move to PostgreSQL rather than SQLite first.

**Decision**: Adopt PostgreSQL-first for structured metadata. Production deployments must use PostgreSQL; local development and tests may use JSON fallback when `DATABASE_URL` is absent. First slice establishes the database foundation and migrates search/key operational state, while preserving JSON compatibility for existing app data until later tables are implemented.

**Consequences**: This aligns with a more scalable product direction but increases setup complexity. The work must include deployment docs, env configuration, and graceful diagnostics so local development remains workable.

## Out of Scope

* Moving image binaries into PostgreSQL.
* Full migration of all chat history/results/preferences/auth data in the first implementation slice unless explicitly chosen.
* Cloud-managed PostgreSQL provisioning.
* Multi-instance distributed locking.
* New paid third-party search provider beyond current Tavily/DuckDuckGo.
* Arbitrary branch switching or arbitrary command execution from the Web UI.
* Automatic unattended update execution without an administrator action in the first implementation.

## Technical Notes

* Relevant backend files:
  * `attuno-studio/app_runtime.py`
  * `attuno-studio/backend/app/services/web_search.py`
  * `attuno-studio/backend/app/services/result_store.py`
  * `attuno-studio/backend/app/services/chat_history_store.py`
  * `attuno-studio/backend/app/services/preferences_store.py`
  * `attuno-studio/backend/app/services/auth_service.py`
  * `attuno-studio/backend/app/routes/chat.py`
* Relevant frontend files:
  * `attuno-studio/ui-prototype/src/App.tsx`
  * `attuno-studio/ui-prototype/src/types/domain.ts`
  * `attuno-studio/ui-prototype/src/styles.css`
* Relevant deploy files:
  * `deploy/install.sh`
  * `deploy/update.sh`
  * `deploy/attuno-api.service.example`
  * `attuno-studio/docs/deployment.md`
* Relevant specs:
  * `.trellis/spec/backend/database-guidelines.md`
  * `.trellis/spec/backend/deployment-operations.md`
  * `.trellis/spec/backend/error-handling.md`
  * `.trellis/spec/backend/generation-contracts.md`
  * `.trellis/spec/frontend/state-management.md`
