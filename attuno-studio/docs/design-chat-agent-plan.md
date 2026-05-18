# DesignChatAgent MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn Attuno from a “prompt box + generator” into a design assistant that understands current project context, remembers user preferences, classifies chat intent, and produces executable generation/edit instructions.

**Architecture:** Add a backend DesignChatAgent service and `/api/chat` route that reads existing result/profile data, classifies user messages with deterministic rules plus optional future LLM hook, returns a conversational reply, structured intent/action, memory candidates, and a compact prompt/edit instruction. Reuse existing preferences storage for user/project memory. Then add a lightweight frontend chat-assistant panel near the composer, with buttons to apply the assistant draft to the composer, remember preference, or switch to edit mode.

**Tech Stack:** FastAPI, Pydantic-style dict payloads, existing JSON preference store, React + TypeScript.

---

## Key requirements extracted from Codex conversation

- User wants the product to “越用越懂我，越用越好用”.
- Chat should feel closer to ChatGPT/Claude: natural conversation, context-aware, not just a raw prompt box.
- Long prompts should be collapsible/summary-first in the UI; do not flood the conversation.
- Persistent preferences should capture:
  - likes: light/modern new Chinese, warm white walls, beige/light gray floor, walnut wood, restrained elegance
  - avoids: heavy palace/red-gold, European/American/industrial, cold sci-fi, over-decoration
  - evaluation standards: structure fidelity first, furniture count/orientation second, style third
- For floor-plan image generation, the first analysis must be a controllable spatial spec, not generic description:
  - room type and task focus first
  - each room has function + minimal topology formula
  - distinguish wall/window/door/railing
  - distinguish fixed cabinets vs movable furniture
  - stairs/elevator/balcony/railings/columns are hard constraints
  - style only changes material/form and cannot alter plan logic/furniture count
- User repeatedly disliked output because furniture quantity/orientation and key rooms were wrong: right-lower office, finance room, left-lower bedroom, left toilets, stairs, general manager room.

---

## Task 1: Backend chat schemas + deterministic DesignChatAgent

**Objective:** Add pure backend chat intent classification and response generation.

**Files:**
- Create: `backend/app/services/design_chat_agent.py`
- Create: `backend/app/routes/chat.py`
- Modify: `backend/app/main.py`
- Test: `tests/test_design_chat_agent.py`
- Test: `tests/test_backend_api.py`

**Behavior:**
- POST `/api/chat`
- Request fields:
  - `message: str`
  - `project_id: str = "default"`
  - `active_result_id: str = ""`
  - `context: dict = {}`
- Response fields:
  - `ok: true`
  - `reply: str`
  - `intent: str`
  - `suggested_action: str`
  - `draft_instruction: str`
  - `memory_candidate: {likes: [], avoids: [], project: [], evaluation_standards: []}`
  - `context_summary: str`
  - `ui_hints: {collapse_long_prompt: true, apply_to_composer: true/false, switch_to_edit: true/false}`

**Intent rules:**
- `remember_preference`: contains “记住/以后都/我喜欢/不要再/不喜欢”.
- `revise_style`: contains “风格/太商务/太厚重/温馨/轻一点/高级/材质/灯光”.
- `revise_structure`: contains “结构/布局/户型/楼梯/电梯/卫生间/阳台/门窗/墙体/房间/错乱”.
- `revise_furniture`: contains “家具/数量/朝向/摆放/工位/桌/椅/床/柜/沙发/茶桌”.
- `analyze_result`: contains “分析/为什么/原因/打分/多少分/哪里的问题”.
- default `new_generation`.

**Reply requirements:**
- Chinese.
- Acknowledge intent.
- Say what will be preserved and what will be changed.
- For structure/furniture issues, emphasize structure fidelity and furniture topology.
- Never dump long prompt by default.

**Tests first:**
- `test_design_chat_agent_classifies_style_revision_and_builds_draft`
- `test_design_chat_agent_classifies_furniture_topology_feedback`
- `test_design_chat_agent_extracts_memory_candidate`
- `test_chat_endpoint_returns_structured_action`

---

## Task 2: Preference memory update endpoint/action

**Objective:** Let the chat layer save confirmed preferences to existing preferences store.

**Files:**
- Modify: `backend/app/services/preferences_store.py`
- Modify: `backend/app/routes/chat.py` or `backend/app/routes/preferences.py`
- Test: `tests/test_design_chat_agent.py` or `tests/test_backend_api.py`

**Behavior:**
- Add function `apply_chat_memory(project_id, memory_candidate)`.
- Merge likes into `user_style_preferences.explicit`.
- Merge avoids into `user_style_preferences.avoid`.
- Merge project constraints into `project_style_memories[project_id].structure` or `style`.
- Merge evaluation standards into `preference_summary.evaluation_standards`.
- Add POST `/api/chat/memory` or include `remember=true` in `/api/chat`.

**Tests:**
- Saving memory dedupes repeated items.
- Existing preference data is preserved.

---

## Task 3: Prompt compiler optimization helpers

**Objective:** Reduce long-prompt flooding and make second-stage prompts structure-first, topology-aware.

**Files:**
- Create: `agents/prompt_compiler.py`
- Modify: `agents/prompt_gen.py` to delegate deterministic render3d floor-analysis prompts to compiler when `floor_analysis` exists.
- Test: `tests/test_prompt_generator.py`

**Behavior:**
- Compiler emits sections:
  - `生成目标 | P0`
  - `硬约束总则 | P0`
  - `关键空间合同 | P0`
  - `门窗墙/固定结构 | P0`
  - `家具拓扑与朝向 | P0`
  - `风格边界 | P1`
  - `负向提示词`
- Prompt should prioritize compact “room contract” lines instead of dumping full `to_prompt_context()`.
- Include risk-room emphasis when user/codex context mentions common failures: toilets, stairs, finance room, office, bedroom, general manager room.
- Avoid mandatory 1200+ char inflation. Target compact but complete.
- Return prompt sections for UI collapse.

**Tests:**
- Prompt contains room topology formulas with quantities/orientations.
- Prompt includes “风格只作用于材质/造型，不得改变布局/家具数量”.
- Prompt does not include every raw `未识别` line from `to_prompt_context()`.
- Negative prompt contains structure/furniture prohibitions.

---

## Task 4: Frontend API + assistant panel MVP

**Objective:** Expose chat assistant in UI without large refactor.

**Files:**
- Create: `ui-prototype/src/api/chat.ts`
- Create: `ui-prototype/src/components/DesignAssistantPanel.tsx`
- Modify: `ui-prototype/src/types/domain.ts`
- Modify: `ui-prototype/src/App.tsx`
- Modify: `ui-prototype/src/styles.css`

**Behavior:**
- Add a compact panel near composer or right column:
  - message input “和设计助手说：哪里不满意/想记住什么/怎么改”
  - shows assistant reply
  - shows intent badge and suggested action
  - collapses draft instruction behind `<details>`
  - buttons:
    - “应用到输入框” sets composer text to draft instruction
    - “记住这个偏好” calls memory endpoint
    - if active result exists and action is edit, “切到改图模式”
- Do not replace existing generation flow.

**Tests/build:**
- `npm run build`

---

## Task 5: Verification and smoke tests

**Objective:** Ensure backend and frontend still work.

**Commands:**
- Install deps if needed: `python -m pip install -r requirements.txt`
- Run targeted tests:
  - `python -m pytest tests/test_design_chat_agent.py tests/test_prompt_generator.py tests/test_backend_api.py -q`
- Run frontend build:
  - `cd ui-prototype && npm run build`
- Static smoke:
  - POST `/api/chat` with style/furniture/remember examples using TestClient.

---

## Rollback

Filesystem backup created before implementation:

```text
/mnt/e/xyleisure/PicCreator_backup_20260506_235854
```

Git checkpoint branch created:

```text
checkpoint/design-chat-before-20260506_235854
```
