import json
from adapters.base import BaseLLMAdapter
from models.schemas import ParsedRequirement, RoomType, DesignStyle

PARSE_PROMPT = """你是一个室内设计需求分析师。根据用户的自然语言描述和平面图说明，提取结构化设计规范。

请严格按以下 JSON 格式输出，不要有多余文字：
{
  "room_type": "客厅|卧室|厨房|卫生间|书房|其他",
  "style": "现代简约|北欧|中式|工业风|轻奢|其他",
  "color_tone": "色调描述",
  "key_elements": ["必须包含的元素列表"],
  "forbidden_elements": ["禁止出现的元素列表"],
  "special_requirements": "其他特殊要求"
}"""


class RequirementParser:
    def __init__(self, llm: BaseLLMAdapter):
        self.llm = llm

    async def parse(self, user_text: str, floor_plan_desc: str = "") -> ParsedRequirement:
        context = f"平面图描述：{floor_plan_desc}\n\n用户需求：{user_text}" if floor_plan_desc else f"用户需求：{user_text}"
        messages = [
            {"role": "system", "content": PARSE_PROMPT},
            {"role": "user", "content": context},
        ]
        raw = await self.llm.chat(messages)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # 容错：提取 JSON 块
            import re
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            data = json.loads(match.group()) if match else {}

        def safe(cls, val, default):
            try:
                return cls(val)
            except ValueError:
                return cls(default)

        return ParsedRequirement(
            room_type=safe(RoomType, data.get("room_type", "其他"), "其他"),
            style=safe(DesignStyle, data.get("style", "现代简约"), "现代简约"),
            color_tone=data.get("color_tone", ""),
            key_elements=data.get("key_elements", []),
            forbidden_elements=data.get("forbidden_elements", []),
            special_requirements=data.get("special_requirements", ""),
        )
