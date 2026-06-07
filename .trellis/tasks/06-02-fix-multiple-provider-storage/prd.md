# 修复供应商配置只能保存一个

## Goal

修复“模型与 API”设置中供应商档案保存/刷新后只剩一个或只能回到第一个供应商的问题，让分析供应商和画图供应商的多个档案都能稳定持久化、加载和切换。

## Requirements

* 保存配置时保留 `analysisProviders` / `imageProviders` 的完整列表。
* 加载配置时保留每个供应商档案原始 `id`，确保 `activeAnalysisProviderId` / `activeImageProviderId` 能匹配到保存时选中的档案。
* 旧的平铺配置仍可被归一化为单个供应商档案。
* `llm` 与 `vision` 的分析供应商档案保持同步；`image_gen` 独立保存画图供应商档案。
* 非默认用户仍不能继承默认工作区 API Key。

## Acceptance Criteria

* [ ] 后端 `/api/config/save` 接收多个分析供应商和多个画图供应商后，配置文件中保留完整 `providers` 数组和活动 id。
* [ ] 后端 `/api/config` 再次加载时返回完整列表，并且活动 id 仍指向保存时选中的供应商。
* [ ] 刷新页面后前端设置下拉不会因为 id 改写退回第一个供应商。
* [ ] 旧配置没有 `providers` 时仍返回一个可编辑供应商档案。
* [ ] 针对配置 round-trip 的后端测试通过。

## Definition of Done

* Tests added/updated where behavior changes.
* Focused backend test passes.
* Frontend type/build impact considered.
* Existing unrelated dirty files are left untouched.

## Technical Approach

The existing multi-provider design stores provider lists under adapter sections (`llm.providers`, `vision.providers`, `image_gen.providers`) and mirrors the active profile into flat adapter fields for compatibility. The bug is in the load-side conversion: provider ids are currently replaced with generated fallback ids such as `analysis-default-1`, which can break `active_provider_id` matching and make the UI select the first provider after reload.

Fix the backend adapter-section-to-UI conversion so fallback ids are only used when a stored provider lacks an id. Add a round-trip test through `/api/config/save` and `/api/config` that proves multiple providers and active ids survive.

## Decision (ADR-lite)

**Context**: The current additive provider-list model is already present and minimizes call-path churn.

**Decision**: Preserve stored provider ids during load and keep flat-field mirroring unchanged.

**Consequences**: This is a focused persistence contract fix. It does not redesign the provider UI or credential storage.

## Out of Scope

* Import/export of provider profiles.
* Shared provider marketplace/catalog.
* Replacing flat config fields across generation/chat routes.
* Credential vault migration.

## Technical Notes

* Relevant specs: `.trellis/spec/backend/index.md`, `.trellis/spec/backend/quality-guidelines.md`, `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/state-management.md`, `.trellis/spec/frontend/type-safety.md`, `.trellis/spec/guides/cross-layer-thinking-guide.md`.
* Existing historical task: `.trellis/tasks/05-24-multi-api-providers/prd.md`.
* Key files inspected: `attuno-studio/app_runtime.py`, `attuno-studio/config.py`, `attuno-studio/backend/app/routes/config.py`, `attuno-studio/ui-prototype/src/App.tsx`, `attuno-studio/ui-prototype/src/api/config.ts`, `attuno-studio/tests/test_backend_api.py`.
* Trellis sub-agent tools are not available in this session (`tool_search` found none), so implementation/check run in the main session.
