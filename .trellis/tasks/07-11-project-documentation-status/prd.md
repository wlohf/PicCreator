# 项目文档与状态梳理

## Goal

建立可持续维护的项目需求、技术架构与进度文档，基于当前代码、Trellis 任务记录和 Git 状态说明 Attuno 所处阶段、交付边界、已知风险及下一步优化顺序。

## Requirements

* 在仓库根目录新增 `docs/` 文档索引及三份长期维护文档：
  * `docs/requirements.md`
  * `docs/technical-architecture.md`
  * `docs/project-status.md`
* 在根目录 `README.md` 增加文档入口。
* 需求文档应说明产品定位、用户主流程、已交付能力、关键约束和后续产品需求。
* 技术文档应说明前后端结构、主要数据流、存储与认证、模型适配、部署、测试边界和技术债。
* 进度文档应明确当前阶段、已交付基线、Trellis 任务台账失真、GitHub/VPS 同步结论、验证信息和优化路线图。
* Git 同步结论必须区分本地远端跟踪引用与本次无法联网实时拉取的限制。
* 用户确认后，运行全量回归检查，提交文档格式修正，推送 `main` 并创建首个 GitHub Release。
* 不修改产品功能、API 契约或部署行为。

## Acceptance Criteria

* [x] 三份文档均使用中文，包含最后核对日期和维护规则。
* [x] README 可导航至文档索引。
* [x] 进度文档明确 `HEAD`、本地 `origin/main`、`vps/main` 的已知关系及其证据边界。
* [x] 文档把“代码交付状态”和“Trellis 历史任务状态”分开表达。
* [x] 文档给出按优先级排列、可拆分为后续任务的优化方向。
* [x] `git diff --check` 通过。
* [x] 后端完整测试通过：179 passed，2 skipped。
* [x] 7 个前端静态测试和生产构建通过。
* [x] 已推送 `main` 并发布 GitHub Release：`v0.1.0`。

## Definition of Done

* 文档可作为后续需求、技术决策和发布检查的单一导航入口。
* 结论只引用本次实际检查到的代码、Git 元数据和已有任务记录。
* 已明确说明任何无法在当前环境实时验证的外部状态。

## Technical Approach

以现有 README、后端/前端目录、Trellis 任务 PRD、最新提交和远端跟踪分支为事实来源，整理为根目录 `docs/`。状态文档采用明确的“核对日期 + 数据来源 + 限制”格式，避免静态文档被误认为实时部署监控。

## Out of Scope

* 逐项归档或关闭全部历史 Trellis 任务。
* 创建 CI 工作流。
* 重构 `App.tsx`、数据存储或生成流程。
* 对 VPS 执行部署、更新或远程修复。

## Technical Notes

* 代码主分支：`main`
* GitHub 远端：`origin`
* VPS 远端：`vps`
* 当前产品入口：`README.md`、`attuno-studio/`
* 已读取的历史材料：`attuno-studio/docs/*.md`、`.trellis/tasks/07-01-attuno/prd.md`、`.trellis/tasks/archive/2026-07/07-08-push-completed-attuno-changes/prd.md`
