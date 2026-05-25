# 上线前整理未提交改动并发布 GitHub

## Goal

把当前可运行的 Attuno 项目整理成可复现的最终提交，清理不应进入仓库的临时产物，验证后推送到 GitHub，为后续服务器部署提供干净基线。

## Requirements

* 保留并提交当前应上线的后端、前端、测试、配置示例和 Trellis 记录改动。
* 将关键未跟踪源码纳入版本控制，避免服务器从 GitHub 拉取后缺文件。
* 清理或忽略临时依赖、测试缓存、开发服务器 pid、备份配置和临时 patch。
* 运行后端测试、前端构建和现有前端脚本测试，确认最终状态可部署。
* 提交整理后的最终版本，并推送到 `origin` GitHub 远端。

## Acceptance Criteria

* [ ] `git status` 中不再出现需要上线但未跟踪的源码文件。
* [ ] 临时目录和本地缓存不会进入提交。
* [ ] 后端 pytest 通过。
* [ ] 前端 production build 通过。
* [ ] 前端 package.json 中列出的测试脚本通过。
* [ ] 最终提交已推送到 GitHub `origin`。

## Definition of Done

* 保留用户已有业务改动，不做无关回退。
* 提交前给出改动分组，提交后报告 commit 和 push 结果。
* 如发现阻塞项，先修复并复跑验证。

## Technical Approach

先通过 Git 状态和 diff 将改动分为业务源码、测试、Trellis/规范、临时产物和个人配置；只清理明确不应上传的临时产物，补充 ignore 规则，随后运行验证、提交并推送。

## Out of Scope

* 不做服务器部署本身。
* 不重构当前业务功能。
* 不迁移本地 JSON 存储到数据库。

## Technical Notes

* GitHub 远端：`origin https://github.com/wlohf/PicCreator.git`
* 当前分支：`refine-3d-render-agent-frontend-backend`
* 上一轮部署前检查显示后端 pytest、前端 build 和前端脚本测试通过。
