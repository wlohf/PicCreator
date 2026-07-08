# GitHub Release 更新研究

## 结论

GitHub 官方 REST API 提供 `GET /repos/{owner}/{repo}/releases/latest` 用于读取 latest release。该接口返回最新的非 draft、非 prerelease release，其中 `tag_name` 是最适合服务器更新流程消费的稳定字段。

## 适配本项目

本项目现有更新路径已经是 Ubuntu VPS + Git checkout + `deploy/update.sh`：

- 后端已有 `/api/system/update/status|check|apply`，并通过 Basic Auth 保护。
- `deploy/update.sh` 已负责依赖安装、数据库迁移、前端构建、systemd 重启、健康检查和 Nginx reload。
- 因此 release 更新不应下载并执行任意 release asset；更安全的方式是检测 latest release 的 tag，fetch tags，checkout 到该 tag 对应 commit，然后复用现有更新脚本。

## 设计约束

- 只允许 GitHub release tag 驱动更新，不接受前端传入任意 tag、分支或 shell 命令。
- 默认使用 `origin` 远端推导 `owner/repo`，也允许用 `ATTUNO_GITHUB_REPOSITORY=owner/repo` 显式配置。
- 私有仓库或提高 API rate limit 时可配置 `ATTUNO_GITHUB_TOKEN`，该 token 只在后端使用，日志中要脱敏。
- 保留旧的 `origin/main` fast-forward 更新作为兼容模式，便于没有 release 的部署临时回退。

## 来源

- GitHub REST API docs: https://docs.github.com/en/rest/releases/releases#get-the-latest-release
