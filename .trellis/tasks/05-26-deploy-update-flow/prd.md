# 完善服务器部署与更新流程

## Goal

为 Attuno 增加一套面向 Ubuntu VPS 的部署与更新流程，让项目可以稳定运行在服务器上，并且后续更新时只需要拉取代码、安装依赖、重建前端、重启后端/重载 Nginx，避免本地开发启动脚本被误用到生产环境。

## What I already know

* 当前 README 只有本地 Windows 一键启动、手动启动、前端构建和简略部署建议。
* 现有 `start_attuno_studio.bat` 启动 FastAPI 与 Vite dev server，适合本地调试，不适合生产。
* 后端入口是 `attuno-studio/api_server.py`，内部运行 FastAPI app。
* 后端支持通过 `API_HOST` / `APP_HOST` 与 `API_PORT` / `APP_PORT` 配置监听地址和端口。
* 后端 CORS 支持 `CORS_ORIGINS` 与 `CORS_ORIGIN_REGEX`。
* 前端支持 `npm run build`，构建输出在 `attuno-studio/ui-prototype/dist`。
* 前端 API 客户端默认使用同域 `/api`，也可通过 `VITE_API_BASE_URL` 覆盖。
* 用户运行数据支持 `ATTUNO_STUDIO_DATA_DIR` 或旧变量 `RENDER_AGENT_DATA_DIR`，默认落在代码目录下 `.attuno-studio-data` / `.render-agent-data`。
* `.env`、`config.json`、数据目录、`outputs/` 已被 gitignore 忽略，适合服务器本地维护。

## Assumptions

* 目标服务器按 Ubuntu VPS 处理，使用 systemd + Nginx，不兼容 Windows Server/IIS。
* 项目通过 Git 拉代码部署，不做 Docker 化。
* 后端只监听 `127.0.0.1:8787`，由 Nginx 对外暴露。
* 前端使用 Nginx 静态托管 `dist`，不用 Vite dev server 或 `vite preview` 作为生产服务。
* 运行数据应该放到 `/var/lib/attuno`，代码目录可随 `git pull` 更新。

## Open Questions

* 已确认：服务器是 Ubuntu 系统，本次 MVP 按 Ubuntu + systemd + Nginx + Git 更新脚本实现，不做 Docker。

## Requirements

* 增加生产部署脚本，支持在服务器上安装/刷新 Python 与 Node 依赖、准备配置文件、构建前端。
* 增加更新脚本，支持安全执行 `git pull`、依赖安装、前端构建、后端重启、Nginx 配置检查与 reload。
* 增加 systemd service 示例，后端以长期服务方式运行。
* 增加 Nginx 示例配置，静态托管前端并反代 `/api` 到 FastAPI。
* 增加部署文档，说明首次部署、更新、配置、数据目录、健康检查和回滚注意事项。
* 脚本应尽量幂等，可重复执行，不覆盖已有 `.env` / `config.json`。
* 脚本应避免把运行数据放在 Git 工作树内，优先设置 `ATTUNO_STUDIO_DATA_DIR=/var/lib/attuno`。

## Acceptance Criteria

* [x] 仓库新增 `deploy/` 目录，包含 install/update/service/nginx 示例。
* [x] README 或部署文档明确区分本地开发启动和服务器生产部署。
* [x] 更新路径清晰：`git pull` 后能安装依赖、构建前端、重启后端、reload Nginx。
* [x] 配置与数据不被更新脚本覆盖。
* [x] 后端健康检查路径 `/api/health` 在文档和脚本中体现。
* [x] 不引入 Docker 或额外运行时依赖。

## Definition of Done

* 文档更新完成。
* 脚本语法可静态检查。
* 前端构建命令可运行或说明无法运行原因。
* 后端测试或轻量检查可运行或说明无法运行原因。
* 不修改用户本地密钥、配置和运行数据。

## Technical Approach

新增 `deploy/` 目录，采用“示例配置 + 可重复执行脚本”的方式：

* `deploy/install.sh`：首次部署/重建依赖，创建 venv，安装 pip 依赖，运行 npm ci/install，构建前端，创建数据目录，提示复制 systemd/nginx 示例。
* `deploy/update.sh`：服务器更新入口，默认执行 git pull、pip install、npm ci/install、npm run build、systemctl restart、nginx -t + reload，可通过环境变量覆盖服务名和是否跳过 git pull。
* `deploy/attuno-api.service.example`：systemd 服务模板，设置工作目录、venv Python、`APP_HOST=127.0.0.1`、`APP_PORT=8787`、`ATTUNO_STUDIO_DATA_DIR=/var/lib/attuno`。
* `deploy/nginx.attuno.conf.example`：Nginx server 示例，root 指向前端 dist，`/api/` 反代到后端，并保留长连接/流式响应配置。
* `docs/deployment.md` 或 README 部署章节：提供首次部署、更新、常见故障、回滚与数据备份说明。

## Decision (ADR-lite)

**Context**: 当前项目已有本地启动脚本，但生产环境需要服务守护、静态前端托管、反向代理和可重复更新流程。

**Decision**: 采用 Ubuntu VPS + Git + systemd + Nginx 的轻量部署方案，并把运行数据通过 `ATTUNO_STUDIO_DATA_DIR` 放到代码目录之外。

**Consequences**: 部署门槛低、更新简单；但不包含 Docker 镜像、蓝绿发布、多实例、数据库迁移、CI/CD 自动部署。

## Out of Scope

* Docker / docker-compose 部署。
* 云厂商专用部署模板。
* 自动申请 HTTPS 证书。
* 数据库化或对象存储改造。
* 多机器部署、滚动发布、蓝绿发布。
* 修改现有业务代码。

## Technical Notes

* `README.md`：已有本地启动、测试和部署建议章节。
* `start_attuno_studio.bat`：本地开发启动脚本，不作为生产入口。
* `attuno-studio/api_server.py`：后端启动入口。
* `attuno-studio/backend/app/settings.py`：后端 host/port/CORS 环境变量。
* `attuno-studio/backend/app/services/result_store.py`：数据目录环境变量。
* `attuno-studio/ui-prototype/package.json`：前端 `build` 脚本。
* `attuno-studio/ui-prototype/src/api/client.ts`：前端默认同域 API base。

## Verification

* `E:\Software\Git\Git\usr\bin\bash.exe -n deploy/install.sh`
* `E:\Software\Git\Git\usr\bin\bash.exe -n deploy/update.sh`
* `npm run build` in `attuno-studio/ui-prototype`
* `python -m pytest tests/test_backend_api.py -q` in `attuno-studio` — 48 passed
