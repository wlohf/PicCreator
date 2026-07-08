# GitHub release 自动更新

## Goal

当 Attuno/PicCreator 在 GitHub 发布新的 latest release 后，服务器端部署可以在 Web 管理页检测到新版本，管理员点击更新后自动切换到 release 对应版本，复用现有部署脚本完成构建、服务重启和健康检查。

## What I already know

- 当前项目是 Ubuntu VPS 部署形态，不是 Electron/Tauri 桌面安装包。
- 已有后端 `/api/system/update/status`、`/api/system/update/check`、`/api/system/update/apply` 接口，并使用更新管理员 Basic Auth。
- 已有 `attuno-studio/backend/app/services/update_service.py`，当前检测 `origin/main` 提交差异，执行更新时调用 `deploy/update.sh`。
- 已有前端“设置 -> 系统维护”面板，可输入管理员凭据、检查更新、开始更新，并显示当前提交/远端提交/状态/工作树/日志。
- `deploy/update.sh` 已执行依赖安装、PostgreSQL migration、前端构建、systemd restart、健康检查和 Nginx reload。
- 部署规范要求更新脚本不能覆盖本地 `.env` / `config.json`，工作树有未提交改动时应停止。

## Requirements

- 后端更新检测支持 GitHub latest release：
  - 读取 latest release 的 `tag_name`、名称、URL、发布时间等版本信息。
  - fetch release tags，并解析 latest release tag 对应的 commit。
  - 如果当前 commit 是 latest release commit 的祖先，则判定可更新；如果已经相同则显示已是最新。
- 更新状态需要区分“发现新版本”和“当前是否能安全执行更新”：返回 `has_update`、`can_apply` 与 `apply_blockers`。
- 执行更新时，在工作树干净、release tag 可解析、更新开关启用后，checkout 到 latest release 对应 commit，再复用 `deploy/update.sh` 构建并重启服务。
- release 模式不接受前端传入任意 tag、分支、asset URL 或 shell 命令。
- 保留旧 `origin/main` 分支检测/更新作为兼容模式，可通过环境变量回退。
- 前端系统维护面板显示 release 语义字段，包括当前版本、最新 release、更新来源和 release 链接/发布时间。
- 系统维护面板提供“系统状态”诊断，聚合数据库、数据目录可写性和更新状态，方便上线前自查。
- 文档说明 GitHub release 更新的配置、私有仓库 token、兼容分支模式和回滚注意事项。

## Acceptance Criteria

- [x] `check` 能返回 latest release tag/name/url/published_at，并正确设置 `has_update`。
- [x] `apply` 在 release 模式下 checkout latest release commit，并以 `SKIP_GIT_PULL=1` 复用现有 update 脚本。
- [x] 工作树 dirty、release tag 不可解析、当前 commit 不是 latest release 的祖先时，更新停止并返回明确错误。
- [x] 有新版本但执行开关未启用、工作树 dirty 或不是 fast-forward 时，状态返回 `can_apply=false` 和可读 blocker，前端禁用更新按钮。
- [x] 部署管理员可查看系统状态，包含数据库 fallback/配置状态、数据目录可写性和更新摘要。
- [x] 前端按钮仍然是“检查更新 / 开始更新”，但版本状态显示 release tag 而不只是 commit。
- [x] 旧分支模式可通过环境变量保留，现有部署更新测试继续覆盖。
- [x] 后端测试覆盖 release 检测和 release apply 的关键路径。
- [x] 前端 `npm run build` 通过；后端相关 pytest 通过。

## Definition of Done

- 后端实现与测试完成。
- 前端类型和 UI 展示更新完成。
- 部署文档更新完成。
- `deploy/update.sh` 语法检查通过。
- 相关后端测试、前端 build/typecheck 通过，或记录无法运行原因。

## Technical Approach

默认采用 `release` 更新来源：

- 后端通过 GitHub REST API latest release endpoint 获取 release 元数据。
- `ATTUNO_GITHUB_REPOSITORY=owner/repo` 可显式指定仓库；未配置时从 `origin` remote URL 推导。
- `ATTUNO_GITHUB_TOKEN` 可选，仅后端使用，用于私有仓库或提高 rate limit。
- `ATTUNO_UPDATE_SOURCE=branch` 可回退旧的 `origin/main` fast-forward 更新行为。
- release 模式只消费 `tag_name`，再由本地 Git fetch/checkout 进入对应 commit，避免执行来自 release asset 的任意内容。
- 更新脚本继续负责依赖、构建、迁移、重启和健康检查；release checkout 后执行脚本时设置 `SKIP_GIT_PULL=1`，避免 detached HEAD 下再 `git pull`。

## Decision (ADR-lite)

**Context**: 用户希望发布 GitHub latest release 后，项目能识别新版本并点击更新重启。项目现有生产部署是服务器 Git checkout，不是桌面安装器。

**Decision**: 使用 GitHub latest release tag 作为版本来源，服务器 checkout 到 release tag 对应 commit，再复用现有 `deploy/update.sh`。不下载或执行 release asset。

**Consequences**: 发布节奏由 GitHub Release 控制，更符合“最新版 release”语义；同时保持现有 VPS 部署链路。代价是服务器部署会处于 detached HEAD，后续继续通过 release 更新；需要用环境变量切回 branch 模式才能继续追 `origin/main`。

## Out of Scope

- Electron/Tauri 桌面应用自动更新器。
- 下载、校验、安装 GitHub release asset。
- 自动后台轮询或强制更新。
- 蓝绿发布、多实例滚动发布和自动回滚。
- GitHub webhook 推送更新。

## Technical Notes

- 后端：`attuno-studio/backend/app/services/update_service.py`
- 后端路由：`attuno-studio/backend/app/routes/system.py`
- 系统状态聚合：`attuno-studio/backend/app/services/system_status_service.py`
- 前端 API：`attuno-studio/ui-prototype/src/api/system.ts`
- 前端类型：`attuno-studio/ui-prototype/src/types/domain.ts`
- 前端面板：`attuno-studio/ui-prototype/src/App.tsx`
- 部署脚本：`deploy/update.sh`
- 部署文档：`attuno-studio/docs/deployment.md`
- 研究记录：`research/github-release-update.md`

## Verification

- `python -m pytest tests/test_productization.py tests/test_backend_api.py -q` in `attuno-studio` — 76 passed
- `npm run build` in `attuno-studio/ui-prototype` — passed
- `bash -n deploy/update.sh` — passed
- `git diff --check` — passed
