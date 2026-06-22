# Database Guidelines

## Overview

Attuno 的结构化元数据采用 PostgreSQL-first 策略。生产环境必须配置 `DATABASE_URL` 并设置 `ATTUNO_ENV=production`；本地开发和自动化测试在没有 `DATABASE_URL` 时允许继续使用现有 JSON fallback。

图片、上传文件、生成结果等二进制资产仍存放在 `ATTUNO_STUDIO_DATA_DIR` 文件系统命名空间中，数据库只保存账号、运行状态、索引、审计和后续可迁移的结构化字段。

当前数据库基础设施位于 `attuno-studio/backend/app/services/db.py`，直接使用 `psycopg` 执行 SQL，不引入 ORM。

## Scenario: PostgreSQL Foundation And Search State

### 1. Scope / Trigger

- Trigger: 新增或修改 PostgreSQL 连接、迁移、结构化运行状态、搜索审计或生产部署数据库要求。
- Applies when changing `backend/app/services/db.py`, `backend/app/db/migrations/*.sql`, 搜索 key 状态仓储、`/api/health` 数据库诊断或部署脚本中的数据库初始化。

### 2. Signatures

- Env:
  - `ATTUNO_ENV=production|development|test`
  - `DATABASE_URL=postgresql://user:password@host:port/db`
- Service:
  - `initialize_database() -> dict`
  - `get_database_status() -> dict`
  - `ensure_database_ready() -> bool`
- DB:
  - `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`
  - `user_runtime_state(user_id TEXT PRIMARY KEY, tavily_next_key_index INTEGER, updated_at TIMESTAMPTZ)`
  - `tavily_key_state(user_id TEXT, key_fingerprint TEXT, key_index INTEGER, failure_count INTEGER, cooldown_until TIMESTAMPTZ, ...)`
  - `search_events(id BIGSERIAL PRIMARY KEY, user_id TEXT, query TEXT, provider TEXT, status TEXT, diagnostics JSONB, ...)`

### 3. Contracts

- Production (`ATTUNO_ENV=production`) requires a configured and reachable PostgreSQL database. Missing or failed DB initialization must fail startup and report a clear health error.
- Development/test without `DATABASE_URL` may use JSON fallback and must not delete or rewrite existing JSON data.
- Tavily raw API keys remain in account config for now; database stores only key fingerprints and operational health.
- Search event diagnostics must be sanitized and must not contain raw API keys, Authorization headers, database passwords, or full provider secret-bearing payloads.
- Migrations must be idempotent and tracked through `schema_migrations`.

### 4. Validation & Error Matrix

- Missing `DATABASE_URL` in production -> health `ok=false`, startup error naming `DATABASE_URL`.
- Missing `DATABASE_URL` outside production -> health `ok=true`, `database.fallback=true`.
- `psycopg` unavailable with `DATABASE_URL` configured -> health `ok=false`, message says install `psycopg[binary]`.
- Migration SQL failure -> health `ok=false`, error contains migration failure summary.
- Tavily provider failure -> update `tavily_key_state` by fingerprint and set cooldown; do not expose raw key.

### 5. Good/Base/Bad Cases

- Good: production service starts with `DATABASE_URL`, migrations run, `/api/health` includes `database.ok=true`.
- Base: local developer runs without PostgreSQL; app still works through JSON fallback and health shows `database.fallback=true`.
- Bad: production silently falls back to JSON after DB failure.
- Bad: `search_events.diagnostics` stores `sk-...`, bearer tokens, or database URLs with passwords.

### 6. Tests Required

- Unit/API test for local fallback status without `DATABASE_URL`.
- Unit/API test for production missing DB error.
- Migration/status tests with `TEST_DATABASE_URL` when real PostgreSQL integration is available.
- Web search tests proving failures record sanitized search events and do not leak raw keys.
- Health endpoint tests asserting database status shape.

### 7. Wrong vs Correct

#### Wrong

```python
if not os.environ.get("DATABASE_URL"):
    return {"ok": True}
```

#### Correct

```python
status = initialize_database()
if database_required() and not status["ok"]:
    raise RuntimeError(f"PostgreSQL is required in production: {status['error']}")
```

#### Wrong

```python
record_tavily_key_failure(user_id, raw_api_key, message)
```

#### Correct

```python
fingerprint = tavily_key_fingerprint(api_key)
# Store only fingerprint + status/cooldown metadata.
```

## Query Patterns

- 通过 `backend.app.services.db.connect()` 获取连接，使用 `with conn.cursor()` 执行查询。
- 业务仓储应集中在 `backend/app/services/*_store.py` 或等价 service 模块里；路由层不要散落 SQL。
- 搜索 key 状态只保存 `sha256` 指纹，禁止保存 raw Tavily key、HTTP headers 或完整 secret。
- 写入审计事件前先做摘要和脱敏，诊断 message 要截断，避免将供应商响应中的敏感内容长期保存。
- 本地 fallback 路径不得因为数据库不可用而破坏现有 JSON 数据；生产路径则必须清晰报错。

## Migrations

迁移 SQL 放在：

```text
attuno-studio/backend/app/db/migrations/*.sql
```

`initialize_database()` 会创建 `schema_migrations` 并按文件名顺序幂等执行。新增表或索引时添加新的 `NNN_name.sql` 文件，不要修改已发布迁移的语义。

部署更新脚本 `deploy/update.sh` 在安装 Python 依赖后、构建前执行迁移；生产环境缺少 `DATABASE_URL` 时更新失败。

## Naming Conventions

- 表名使用小写 snake_case 复数/状态名，例如 `search_events`、`tavily_key_state`。
- 主键字段使用 `id` 或自然键组合；跨用户数据必须包含 `user_id`。
- 时间字段使用 `TIMESTAMPTZ`，默认 `now()`。
- JSON 数据使用 `JSONB`，但只存前端/诊断需要的结构化摘要。
- 索引命名使用 `idx_<table>_<purpose>`。

## Common Mistakes

- 不要把生产数据库失败静默降级为 JSON fallback；只有非生产环境允许 fallback。
- 不要把 Web 更新、搜索诊断或测试输出里的密码、数据库 URL 密码、Tavily key 写入日志或响应。
- 不要在路由里手写迁移或连接逻辑；使用 `db.initialize_database()` 和 service 层仓储函数。

## Scenario: Structured JSON Store Migration

### 1. Scope / Trigger

- Trigger: 迁移账号、session、聊天历史、结果索引、偏好/记忆等原 JSON 文件数据到 PostgreSQL。
- Applies when changing `auth_service.py`, `chat_history_store.py`, `result_store.py`, `preferences_store.py`, `db.py`, or `backend/app/db/migrations/*.sql` for these domains.

### 2. Signatures

- Env:
  - `DATABASE_URL=postgresql://...` enables PostgreSQL structured storage after migrations pass.
  - No `DATABASE_URL` outside production keeps JSON fallback.
  - `TEST_DATABASE_URL=postgresql://...` runs real PostgreSQL integration tests.
- Service boundary:
  - `db.structured_storage_enabled() -> bool`
  - `register_user(...)`, `authenticate_user(...)`, `create_session(...)`, `delete_session(...)`
  - `load_chat_history(user_id)`, `save_chat_history(payload, user_id)`
  - `create_result(...)`, `list_results(...)`, `get_result(...)`, `update_result_notes(...)`, `delete_result(...)`, `clear_results(...)`
  - `preferences_store` public load/save/memory/event helpers through `_read_preferences` / `_write_preferences`
- DB:
  - `users(user_id, username, password_salt, password_hash, created_at)`
  - `auth_sessions(session_id, user_id, username, expires_at, created_at)`
  - `chat_histories(user_id, payload JSONB, updated_at)`
  - `result_records(user_id, result_id, payload JSONB, created_at, updated_at, deleted_at)`
  - `user_preferences(user_id, payload JSONB, updated_at)`

### 3. Contracts

- Store modules must keep their existing public function signatures so routes and frontend contracts do not change during the first migration slice.
- When `DATABASE_URL` is configured and migrations succeed, these stores read/write PostgreSQL first and must not create or update their old JSON files for new writes.
- When `DATABASE_URL` is absent in development/test, these stores keep the legacy JSON behavior unchanged.
- When PostgreSQL storage is required/configured but unavailable, do not silently fall back to JSON. Raise a clear storage error so production failures are visible.
- Existing JSON data is a lazy import source only: if the matching PostgreSQL row/table is empty, read the old JSON payload, normalize it through the existing store logic, and upsert it into PostgreSQL. Do not delete or rewrite the JSON source.
- Result binaries, annotations, floor plans, and downloads remain in the per-user filesystem namespace. `result_records.payload` stores only index metadata such as filenames, URLs, notes, status, and prompt fields.
- Passwords are never stored in plaintext. PostgreSQL stores the existing PBKDF2 salt/hash fields, not raw credentials.

### 4. Validation & Error Matrix

- No `DATABASE_URL` + development/test -> JSON fallback, no DB writes.
- `DATABASE_URL` configured + migration success -> DB-first read/write for accounts, chat history, result records, and preferences.
- `DATABASE_URL` configured + migration/connection failure -> raise a PostgreSQL structured storage error; do not write JSON as fallback.
- Existing JSON exists + DB table has no row for that user -> lazy import then return normalized DB payload.
- Existing JSON exists + DB already has row for that user -> DB wins; do not merge stale JSON into current DB state.
- Result asset metadata points to a missing file -> existing asset-serving behavior returns not found; do not store binaries in DB to compensate.

### 5. Good/Base/Bad Cases

- Good: configure `DATABASE_URL`, register/login, save chat history, create/delete a result, save shortcuts/prompt skills/memory, then verify rows in `users`, `auth_sessions`, `chat_histories`, `result_records`, and `user_preferences`.
- Base: local developer runs without PostgreSQL; the same calls create/update existing JSON files under `ATTUNO_STUDIO_DATA_DIR`.
- Bad: production DB connection fails and the service silently writes fresh `users.json` or `preferences.json`.
- Bad: moving image bytes into `result_records.payload`, which makes DB backups heavy and breaks the filesystem asset contract.
- Bad: importing old JSON on every read and overriding newer DB data.

### 6. Tests Required

- Existing backend/API tests must keep passing without `DATABASE_URL`, proving JSON fallback compatibility.
- Real PostgreSQL integration test gated by `TEST_DATABASE_URL` must initialize migrations and assert:
  - Account row/session row are written to PostgreSQL.
  - Chat history payload round-trips through `chat_histories`.
  - Result index metadata, notes, and soft delete state round-trip through `result_records`.
  - Shortcuts, prompt skills, and memory write through `user_preferences`.
  - Old JSON files are not created for those new DB-backed writes.
  - Raw password is not stored in the users row.

### 7. Wrong vs Correct

#### Wrong

```python
try:
    write_postgres(payload)
except Exception:
    write_json(payload)
```

This hides production database loss and splits one user's data across two stores.

#### Correct

```python
if db.structured_storage_enabled():
    write_postgres(payload)
else:
    write_json(payload)
```

`structured_storage_enabled()` only returns `False` when no database is configured and JSON fallback is allowed.
