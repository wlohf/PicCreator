# 支持保存并切换多个 API 供应商

## Goal

让用户在“模型与 API”设置中为分析/聊天模型和画图模型分别保存多个供应商档案，并能随时切换当前启用档案，避免每次切换供应商时重复填写 API Key、Base URL、模型名等信息。

## Requirements

* 每个用户的 API 配置支持多个供应商档案。
* 分析/聊天模型与画图模型分别维护自己的供应商档案列表和当前选中项。
* 每个供应商档案至少保存：名称、API 格式、Base URL、API Key、模型名。
* 切换供应商时，设置表单、聊天、生成、图片编辑、模型检测和连通性校验都使用当前选中的档案。
* 现有单供应商配置必须自动兼容，旧的 `llm` / `vision` / `image_gen` 字段继续可读；首次加载时应在 UI 中表现为一个可编辑档案。
* 保存配置时保留旧字段作为当前选中供应商，降低后端现有调用和回滚风险。
* 非默认用户继续只使用自己的显式 API Key，不继承默认工作区 Key。

## Acceptance Criteria

* [ ] 用户可以为分析/聊天模型新增、选择、重命名、删除供应商档案。
* [ ] 用户可以为画图模型新增、选择、重命名、删除供应商档案。
* [ ] 保存后刷新页面，多个供应商档案和当前选中项仍存在。
* [ ] 选择某个供应商后发起聊天、生成或图片编辑，请求传给后端的是该供应商档案的配置。
* [ ] `/api/config/load` 对旧配置和新多供应商配置都能返回可用 UI 数据。
* [ ] 现有配置保存、API 校验、模型检测接口保持向后兼容。
* [ ] 相关前端类型检查和后端测试通过。

## Definition of Done

* Tests added/updated where behavior changes.
* Lint / typecheck / targeted tests green where feasible.
* Docs/spec update considered before wrap-up.
* Existing unrelated dirty files are left untouched.

## Technical Approach

Add a small provider profile model to the existing `ApiConfig` shape:

* `analysisProviders`, `activeAnalysisProviderId`
* `imageProviders`, `activeImageProviderId`

The currently selected profile is mirrored into existing flat fields such as `analysisProviderName`, `analysisBaseUrl`, `imageApiKey`, etc. This keeps existing request builders and backend forms compatible while allowing the UI and persisted config JSON to store multiple profiles.

Backend config JSON will store provider lists under adapter sections, for example `llm.providers` and `image_gen.providers`, with `active_provider_id`. `vision` should continue mirroring the selected analysis provider.

## Decision (ADR-lite)

**Context**: Existing code passes a flat `ApiConfig` through local storage, `/api/config/save`, generation forms, image edit forms, and chat API config. Replacing every call path at once would be risky.

**Decision**: Store provider lists as an additive extension, while keeping the selected profile synchronized into existing flat fields and legacy JSON adapter sections.

**Consequences**: There is some synchronization logic, but it minimizes backend churn and keeps old config files usable.

## Out of Scope

* Global provider marketplace or shared team-level provider catalog.
* Per-project provider assignment.
* Import/export of provider profiles.
* Secure credential vault migration beyond the current config/env behavior.

## Technical Notes

* Inspected `attuno-studio/config.py` for `AdapterConfig` and config JSON loading.
* Inspected `attuno-studio/app_runtime.py` for effective config merging, UI config load/save, model detection, validation, and runtime config building.
* Inspected `attuno-studio/backend/app/routes/config.py`, `chat.py`, generation/image edit schemas and services for flat API config plumbing.
* Inspected `attuno-studio/ui-prototype/src/App.tsx`, `src/types/domain.ts`, `src/data/studioData.ts`, `src/api/config.ts`, `src/api/generation.ts`, `src/api/imageEdits.ts`, and local storage utilities.
