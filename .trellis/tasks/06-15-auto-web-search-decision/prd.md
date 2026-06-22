# 自动判断聊天是否需要联网搜索

## Goal

让 Attuno 日常聊天在用户提出时间敏感、版本发布、当前能力、模型对比、新闻/资料核查等问题时，自动触发后端联网搜索；如果没有明显关键词，也要由 AI 先判断是否需要联网，而不是直接让模型回答“我不能联网”。目标是以解决问题为导向：能搜就搜，搜不到也要告诉用户具体原因和可执行修复方式。

## What I Already Know

* 当前联网搜索位于 `attuno-studio/backend/app/services/web_search.py`，由 `should_use_web_search(message, context)` 根据关键词触发。
* 后端聊天路由 `attuno-studio/backend/app/routes/chat.py` 只在 `suggested_action == "chat"` 且 `should_use_web_search(...)` 为真时调用 `build_web_search_context(...)`。
* 主聊天前端走 `/api/chat/stream`，会显示 `联网搜索 · Tavily / DuckDuckGo` 进度。
* `xyleisure` 账号已有 Tavily key，搜索服务本身可用；问题主要在触发判断和上下文继承。
* 典型失败链路：用户先说“请你联网搜索一下”，下一句只说“三项都查”，当前实现不会继承上一轮联网意图。

## Requirements

* 增强联网搜索触发链路，分为两层：
  * 第一层：关键词/话术命中时直接搜索，包括“查找、搜索、访问、联网、搜一下、查一下、什么时候发布、目前能力、最新、现在、能否识图、和某模型比、发布了吗、有没有、多模态、价格、榜单”等搜索相关近义词和常见问法。
  * 第二层：第一层没有命中时，调用当前聊天模型做轻量分类，判断问题是否需要实时信息、网页资料、第三方事实核验或当前状态，再决定是否搜索。
* 自动触发应覆盖：
  * 发布时间、发布日期、上线时间、发布公告等问题。
  * “目前/当前/现在/最新/最近/今天/今年”等时间敏感问题。
  * 现代模型、公司、产品、版本、框架、价格、能力、榜单、新闻等可能变化的信息。
  * 用户上一轮明确要求联网搜索后，下一轮短回复如“三项都查/都查/继续查/第一项”等应继承联网意图。
* 对明显不需要联网的闲聊、写作、总结、翻译、代码解释等普通任务，不应过度触发搜索。
* 搜索失败时不能只说“没有返回结果”或“我不能联网”。需要给出具体原因分类和可执行引导，例如：
  * 当前账号未配置 Tavily key，并且 DuckDuckGo fallback 也不可用。
  * Tavily key 可能失效、额度耗尽、被限流或请求超时。
  * 网络出口无法访问 Tavily/DuckDuckGo。
  * 搜索词过短或过空，需要结合上下文生成更明确查询。
  * 引导用户到设置里配置/检查 Tavily API keys，或换更明确的问题继续查。

## Acceptance Criteria

* [ ] `GLM-5.2是什么时候发布的呢？它目前的编程水平可以和gpt-5.4一样了么？还是要差一点？能否识图呢` 会触发联网搜索。
* [ ] 上一轮用户消息包含“请你联网搜索一下”，下一轮 `三项都查` 会触发联网搜索，并结合上一轮上下文生成可用查询。
* [ ] 没有明显关键词但 AI 分类判断需要实时事实的问题，会触发联网搜索。
* [ ] `帮我写一段中文产品介绍` 这类非实时创作任务不触发联网搜索。
* [ ] `/api/chat/stream` 仍会在触发搜索时发出 `web_search` progress/meta。
* [ ] 搜索失败时，回复包含可行动诊断，而不是“我无法联网”或泛泛“没有结果”。
* [ ] 更新或新增后端测试覆盖上述行为。

## Definition of Done

* 相关后端测试通过。
* 行为保持账号级 Tavily key 逻辑不变。
* 不引入前端数据结构破坏性变更。
* 不打印或泄露 API key。

## Technical Approach

采用“规则优先 + AI 判断兜底 + 失败诊断”的链路：

1. 保留并扩展显式关键词触发。
2. 第一层未命中时，在聊天路由中用当前分析/聊天模型发起一个短分类请求，输出是否需要联网和推荐搜索查询。
3. 从 `context.messages` 读取最近几轮用户消息，支持“上一轮要求联网 + 当前短回复”的意图继承。
4. 搜索服务返回结构化诊断，包括 Tavily key 是否存在、Tavily 请求失败类型、DuckDuckGo fallback 状态、查询是否为空。
5. 将搜索结果或失败诊断注入 system context，要求模型面向用户给出下一步，而不是宣称能力不存在。

## Decision (ADR-lite)

**Context**: 当前 Tavily/DuckDuckGo 搜索链路可用，但触发逻辑只看当前消息关键词，导致上下文续问和隐含实时问题漏搜。

**Decision**: 先做规则命中直接搜索；规则未命中时，用当前聊天模型做轻量联网必要性分类。这样既能覆盖明确搜索话术，也能覆盖用户没说“搜索”但问题本身明显需要最新信息的场景。

**Consequences**: 非关键词问题会增加一次小模型调用，但只在规则未命中时发生；可换来更符合用户预期的自动联网行为。失败诊断需要搜索服务保留错误原因，不能继续全部吞掉异常。

## Out of Scope

* 不新增独立“联网开关”UI。
* 不引入新搜索供应商。
* 不实现来源引用卡片 UI。
* 不做每条消息都调用 LLM 分类器的高成本方案；仅在关键词/规则未命中时兜底判断。

## Technical Notes

* 重点文件：`attuno-studio/backend/app/services/web_search.py`、`attuno-studio/backend/app/routes/chat.py`、`attuno-studio/tests/test_web_search.py`、`attuno-studio/tests/test_backend_api.py`。
* 相关现有测试：`test_daily_chat_endpoint_injects_web_search_context`、`test_daily_chat_stream_endpoint_emits_web_search_meta`。
* 从 `attuno-studio` 目录运行测试，仓库根目录直接跑会缺少 `backend` import 路径。
