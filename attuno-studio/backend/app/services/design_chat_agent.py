from __future__ import annotations

from typing import Any


MEMORY_TEMPLATE = {"likes": [], "avoids": [], "project": [], "evaluation_standards": []}


class DesignChatAgent:
    """Deterministic MVP chat agent for design intent routing and draft generation."""

    intent_keywords: list[tuple[str, tuple[str, ...]]] = [
        ("remember_preference", ("记住", "以后都", "我喜欢", "不要再", "不喜欢")),
        ("revise_structure", ("结构", "布局", "户型", "楼梯", "电梯", "卫生间", "阳台", "门窗", "墙体", "房间", "错乱")),
        ("revise_furniture", ("家具", "数量", "朝向", "摆放", "工位", "桌", "椅", "床", "柜", "沙发", "茶桌")),
        ("revise_style", ("风格", "太商务", "太厚重", "温馨", "轻一点", "高级", "材质", "灯光")),
        ("analyze_result", ("分析", "为什么", "原因", "打分", "多少分", "哪里的问题")),
    ]

    like_terms = ("喜欢", "以后就", "轻盈", "温馨", "新中式", "暖白", "胡桃木", "柔和暖光")
    avoid_terms = ("不喜欢", "不要再", "避免", "太厚重", "红金", "宫廷", "欧式", "美式", "工业", "冷白", "科幻", "过度装饰")
    evaluation_phrases = (
        "结构还原第一",
        "结构一致性优先",
        "结构准确优先",
        "家具数量和朝向第二",
        "家具数量第二",
        "家具朝向第二",
        "家具拓扑优先",
        "结构第一",
        "家具第二",
    )
    structure_project_terms = ("办公室", "财务室", "卧室", "卫生间", "厕所", "楼梯", "电梯", "总经理", "房间", "阳台", "门窗", "墙体")
    image_request_terms = (
        "帮我画",
        "画一张",
        "画个",
        "画成",
        "出图",
        "生成图片",
        "生成一张图",
        "生成效果图",
        "效果图",
        "平面图",
        "渲染",
        "设计图",
        "改图",
        "image",
        "render",
        "draw",
        "picture",
    )
    image_question_terms = ("什么", "看", "讲", "描述", "分析", "识别", "里面", "内容", "what", "describe", "analyze")

    def respond(self, payload: dict[str, Any]) -> dict[str, Any]:
        message = str(payload.get("message") or "").strip()
        project_id = str(payload.get("project_id") or "default").strip() or "default"
        active_result_id = str(payload.get("active_result_id") or "").strip()
        context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
        intent = self.classify_intent(message, context)
        memory_candidate = self.extract_memory_candidate(message)
        suggested_action = self.suggest_action(intent, active_result_id)
        draft_instruction = self.build_draft_instruction(message, intent, active_result_id, context)
        context_summary = self.summarize_context(project_id, active_result_id, context)

        return {
            "ok": True,
            "reply": self.build_reply(intent, suggested_action, bool(active_result_id), bool(draft_instruction)),
            "intent": intent,
            "suggested_action": suggested_action,
            "draft_instruction": draft_instruction,
            "memory_candidate": memory_candidate,
            "context_summary": context_summary,
            "ui_hints": {
                "collapse_long_prompt": True,
                "apply_to_composer": suggested_action in {"generate", "image_edit"},
                "switch_to_edit": suggested_action == "image_edit",
            },
        }

    def classify_intent(self, message: str, context: dict[str, Any] | None = None) -> str:
        if self._is_chat_image_question(message, context):
            return "daily_chat"
        if isinstance(context, dict) and context.get("workspace_mode") == "chat":
            normalized = message.lower()
            explicit_image_request = any(keyword in normalized or keyword in message for keyword in self.image_request_terms)
            if explicit_image_request:
                return "new_generation"
            return "daily_chat"
        for intent, keywords in self.intent_keywords:
            if any(keyword in message for keyword in keywords):
                return intent
        return "new_generation"

    def _is_chat_image_question(self, message: str, context: dict[str, Any] | None = None) -> bool:
        if not isinstance(context, dict) or context.get("workspace_mode") != "chat":
            return False
        if not _context_has_image_attachment(context):
            return False
        normalized = message.lower()
        if any(term in normalized or term in message for term in self.image_question_terms):
            return True
        return not any(term in normalized or term in message for term in ("画", "出图", "生成", "渲染", "改图", "draw", "render", "generate"))

    def suggest_action(self, intent: str, active_result_id: str) -> str:
        if intent in {"revise_style", "revise_structure", "revise_furniture"}:
            return "image_edit" if active_result_id else "new_generation"
        if intent == "analyze_result":
            return "analyze"
        if intent == "remember_preference":
            return "remember"
        if intent == "daily_chat":
            return "chat"
        return "generate"

    def extract_memory_candidate(self, message: str) -> dict[str, list[str]]:
        memory = {key: [] for key in MEMORY_TEMPLATE}
        for term in self.like_terms:
            if term in message:
                memory["likes"].append(term)
        for term in self.avoid_terms:
            if term in message:
                memory["avoids"].append(term)
        for phrase in self.evaluation_phrases:
            if phrase in message:
                memory["evaluation_standards"].append(phrase)
        if "结构" in message and not any("结构" in item for item in memory["evaluation_standards"]):
            memory["evaluation_standards"].append("结构还原优先")
        if "家具" in message and ("数量" in message or "朝向" in message or "拓扑" in message):
            memory["evaluation_standards"].append("家具数量和朝向需要准确")
        for term in self.structure_project_terms:
            if term in message and ("保留" in message or "必须" in message or "不要改" in message):
                memory["project"].append(f"保留{term}相关结构")
        return {key: _dedupe(values) for key, values in memory.items()}

    def build_draft_instruction(self, message: str, intent: str, active_result_id: str, context: dict[str, Any]) -> str:
        clean_message = _compact(message)
        context_bits = _context_bits(context)
        prefix = "保留原有结构和视角，" if active_result_id else "按当前需求生成，"
        if intent == "revise_style":
            return _compact(f"{prefix}仅调整风格、材质与灯光：{clean_message}。{context_bits}")
        if intent == "revise_structure":
            return _compact(f"{prefix}优先修正结构/布局硬约束，确保房间、墙体、门窗、楼梯等位置准确：{clean_message}。{context_bits}")
        if intent == "revise_furniture":
            return _compact(f"{prefix}修正家具拓扑、数量、朝向和摆放关系，不改变户型逻辑：{clean_message}。{context_bits}")
        if intent == "new_generation":
            return _compact(f"生成室内设计图：{clean_message}。{context_bits}")
        if intent == "remember_preference":
            return ""
        if intent == "daily_chat":
            return ""
        if intent == "analyze_result":
            return _compact(f"分析当前结果的问题，重点检查结构一致性、家具拓扑和风格匹配：{clean_message}。")
        return clean_message

    def build_reply(self, intent: str, suggested_action: str, has_active_result: bool, has_draft: bool) -> str:
        if intent == "remember_preference":
            return "我已识别到可记忆的偏好；确认后会合并到偏好库，并保持已有数据不变。"
        if intent == "analyze_result":
            return "我会先分析当前结果，重点看结构一致性、家具拓扑和风格偏差，不会直接展开长提示词。"
        if intent == "daily_chat":
            return "可以，我们先按普通聊天继续。需要画图时，我会帮你把想法整理成草稿，再由你决定是否切到图像模式。"
        if intent in {"revise_structure", "revise_furniture"}:
            action = "基于当前图改图" if suggested_action == "image_edit" else "生成新的方案"
            return f"收到，我会{action}。会保留已有视角和可用内容，优先修正结构一致性与家具拓扑，再处理风格细节。"
        if intent == "revise_style":
            action = "基于当前图改图" if has_active_result else "生成新的方案"
            return f"收到，我会{action}。会保留原有结构、布局和视角，只调整风格、材质、灯光与氛围。"
        return "收到，我会整理成简洁的生成指令，优先保证空间结构、家具关系和整体风格一致，不默认展开长提示词。"

    def summarize_context(self, project_id: str, active_result_id: str, context: dict[str, Any]) -> str:
        parts = [f"项目：{project_id}"]
        if active_result_id:
            parts.append(f"当前结果：{active_result_id}")
        for key in ("room_type", "view", "floor"):
            if context.get(key):
                parts.append(f"{key}：{context[key]}")
        return "；".join(parts)


def _dedupe(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = str(item or "").strip()
        if text and text not in seen:
            result.append(text)
            seen.add(text)
    return result


def _compact(text: str, limit: int = 210) -> str:
    compact = " ".join(str(text or "").replace("\n", " ").split())
    return compact[: limit - 1] + "…" if len(compact) > limit else compact


def _context_bits(context: dict[str, Any]) -> str:
    bits = []
    if context.get("room_type"):
        bits.append(f"空间类型：{context['room_type']}")
    if context.get("view"):
        bits.append(f"视角：{context['view']}")
    if context.get("floor"):
        bits.append(f"楼层：{context['floor']}")
    return "；".join(bits)


def _context_has_image_attachment(context: dict[str, Any]) -> bool:
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    for message in messages:
        if not isinstance(message, dict):
            continue
        attachments = message.get("attachments")
        if isinstance(attachments, list) and any(isinstance(item, dict) and item.get("dataUrl") for item in attachments):
            return True
    return False
