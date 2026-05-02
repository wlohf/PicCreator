from typing import Optional

from adapters.base import BaseLLMAdapter
from agents.prompt_assets import PROMPT_GEN_SYSTEM_3D_CN, PROMPT_GEN_SYSTEM_STANDARD_CN
from models.schemas import ParsedRequirement, PromptSet, GenerationMode, FloorPlanAnalysis, DesignStyle
from prompt_strategies import (
    DEFAULT_PROMPT_STRATEGY,
    PROMPT_STRATEGY_BASELINE_V0,
    PROMPT_STRATEGY_LAYERED_V1,
    get_prompt_strategy_spec,
)


PROMPT_DETAIL_RETRY_SUFFIX = """

补充要求：
1. 上一次输出如果偏短或偏概括，这一次必须显著展开。
2. 正向提示词必须逐空间详细描述，不要省略边角空间、走道、阳台、卫生间、柜体、楼梯、电梯。
3. 必须保留用户原始需求中的视角、风格、功能、限制条件。
4. 正向提示词不少于1200字，负向提示词不少于180字。
5. 不要只写总体总结，必须写成可直接给画图模型使用的长篇中文提示词。
6. 如果是结构化 3D 提示词，必须按 P0/P1/P2 层级组织，而不是把所有信息堆成一个自然段。
"""


class PromptGenerator:
    def __init__(self, llm: BaseLLMAdapter, strategy_version: str = DEFAULT_PROMPT_STRATEGY):
        self.llm = llm
        self.strategy_version = strategy_version or DEFAULT_PROMPT_STRATEGY

    STYLE_PROFILES = {
        DesignStyle.MODERN.value: {
            "keywords": ("现代简约", "现代", "简约"),
            "color_tone": "中性木色、米白、暖灰，整体干净克制",
            "materials": "材质以干净木饰面、石材、玻璃和少量金属点缀为主，比例简洁，线条利落。",
            "guardrails": "避免欧式雕花、厚重宫廷感和卡通游戏化表现。",
            "negative_terms": ["禁止厚重宫廷风", "禁止欧式雕花", "禁止卡通游戏化材质"],
        },
        DesignStyle.NORDIC.value: {
            "keywords": ("北欧",),
            "color_tone": "浅木色、米白、浅灰和自然织物色",
            "materials": "材质以浅木、白墙、棉麻织物和柔和自然光为主，强调温暖、轻盈和生活感。",
            "guardrails": "避免厚重红木、欧式雕花和过度奢华金属装饰。",
            "negative_terms": ["禁止厚重红木中式家具", "禁止欧式雕花", "禁止过度奢华金属装饰"],
        },
        DesignStyle.CHINESE.value: {
            "keywords": ("中式", "新中式"),
            "color_tone": "木色、米白、暖灰，强调含蓄东方气质",
            "materials": "材质可使用胡桃木、格栅、石材、宣纸感灯光和克制的东方陈设，但不要堆砌装饰。",
            "guardrails": "避免欧式、美式、工业感和厚重宫廷景区风。",
            "negative_terms": ["禁止欧式风格", "禁止工业风", "禁止厚重宫廷景区风"],
        },
        DesignStyle.INDUSTRIAL.value: {
            "keywords": ("工业风", "工业"),
            "color_tone": "水泥灰、炭黑、深木色和低饱和金属色",
            "materials": "材质以水泥、金属、深色木材、裸露结构和明确灯具为主，保持真实粗粝但不过度脏乱。",
            "guardrails": "避免中式格栅、宫廷装饰、欧式雕花和过度柔美田园化表达。",
            "negative_terms": ["禁止中式格栅", "禁止宫廷装饰", "禁止欧式雕花", "禁止田园甜美风"],
        },
        DesignStyle.LUXURY.value: {
            "keywords": ("轻奢",),
            "color_tone": "暖白、米灰、浅咖和克制金属色",
            "materials": "材质以石材、皮革、木饰面和细腻金属点缀为主，强调精致、整洁和高级感。",
            "guardrails": "避免厚重宫廷风、工业毛坯感和过度卡通化。",
            "negative_terms": ["禁止厚重宫廷风", "禁止工业毛坯感", "禁止卡通化"],
        },
        "default": {
            "keywords": (),
            "color_tone": "中性木色、米白、暖灰，整体真实克制",
            "materials": "材质以真实木饰面、石材、织物和自然光为主，强调建筑可视化真实感，不过度装饰。",
            "guardrails": "避免卡通游戏化、比例失真和夸张主题化陈设。",
            "negative_terms": ["禁止卡通游戏化", "禁止比例失真", "禁止夸张主题化陈设"],
        },
    }

    SPACE_PRIORITY_KEYWORDS = (
        "卫生间",
        "卧室",
        "总经理室",
        "财务室",
        "办公室",
        "资料室",
        "品茶区",
        "楼梯间",
        "电梯间",
        "阳台",
    )

    ITEM_PRIORITY_KEYWORDS = (
        "楼梯",
        "电梯",
        "床",
        "沙发",
        "茶桌",
        "办公桌",
        "班台",
        "电视",
        "电视柜",
        "壁画",
        "墙画",
        "挂画",
        "衣柜",
        "柜",
        "洗手",
        "淋浴",
        "蹲便",
        "马桶",
        "工位",
        "茶椅",
        "冰箱",
        "饮水机",
        "扶手",
        "栏杆",
        "伞",
        "盆栽",
        "摆件",
    )

    async def generate(
        self,
        requirement: ParsedRequirement,
        user_requirement_text: str = "",
        direction_stack_text: str = "",
        target_model: str = "dalle3",
        feedback: Optional[str] = None,
        floor_desc: str = "",
        mode: GenerationMode = GenerationMode.RENDER3D,
        floor_analysis: Optional[FloorPlanAnalysis] = None,
        prompt_strategy_version: Optional[str] = None,
    ) -> PromptSet:
        strategy_version = prompt_strategy_version or self.strategy_version or DEFAULT_PROMPT_STRATEGY
        strategy_spec = get_prompt_strategy_spec(strategy_version)
        direction_stack_text = (direction_stack_text or "").strip()
        if mode == GenerationMode.RENDER3D and floor_analysis:
            positive_prompt, positive_sections = self._compile_3d_prompt_cn(
                requirement=requirement,
                user_requirement_text=user_requirement_text,
                direction_stack_text=direction_stack_text,
                floor_analysis=floor_analysis,
                feedback=feedback,
                strategy_version=strategy_version,
            )
            negative_prompt = self._compile_3d_negative_cn(
                requirement=requirement,
                floor_analysis=floor_analysis,
                user_requirement_text=user_requirement_text,
                direction_stack_text=direction_stack_text,
                feedback=feedback,
                strategy_version=strategy_version,
            )
            return PromptSet(
                positive_prompt=positive_prompt,
                negative_prompt=negative_prompt,
                model_target=target_model,
                prompt_strategy_version=strategy_version,
                prompt_sections=positive_sections + [f"负向约束 | {strategy_spec.version}"],
            )

        req_desc = (
            f"用户原始需求（优先级最高，必须尽量原样保留关键约束）：\n{user_requirement_text or '无'}\n\n"
            f"房间类型：{requirement.room_type}\n"
            f"设计风格：{requirement.style}\n"
            f"色调：{requirement.color_tone}\n"
            f"必须包含：{', '.join(requirement.key_elements) or '无'}\n"
            f"禁止出现：{', '.join(requirement.forbidden_elements) or '无'}\n"
            f"特殊要求：{requirement.special_requirements or '无'}"
        )
        if mode == GenerationMode.RENDER3D:
            if floor_analysis:
                req_desc += f"\n\n结构化平面图约束（必须严格遵守）：\n{floor_analysis.to_prompt_context()}"
            elif floor_desc:
                req_desc += f"\n\n平面图空间信息（必须严格遵守）：\n{floor_desc}"
        if direction_stack_text:
            req_desc += f"\n\n设计指令栈（独立约束，必须遵守）：\n{direction_stack_text}"
        if feedback:
            req_desc += f"\n\n上一轮评估反馈（请针对性修正）：{feedback}"
        if mode == GenerationMode.STANDARD:
            req_desc += "\n\n要求：这是常规生图模式，不需要严格绑定平面图结构，但需满足风格、元素、主体和画质。"

        messages = [
            {
                "role": "system",
                "content": PROMPT_GEN_SYSTEM_3D_CN if mode == GenerationMode.RENDER3D else PROMPT_GEN_SYSTEM_STANDARD_CN,
            },
            {"role": "user", "content": req_desc},
        ]
        raw = await self.llm.chat(messages)
        data = self._extract_json(raw)
        if self._looks_too_short(data, mode, strategy_version):
            retry_messages = messages + [{"role": "user", "content": PROMPT_DETAIL_RETRY_SUFFIX}]
            retry_raw = await self.llm.chat(retry_messages)
            retry_data = self._extract_json(retry_raw)
            if self._prompt_score(retry_data) >= self._prompt_score(data):
                data = retry_data

        return PromptSet(
            positive_prompt=data.get("positive_prompt", req_desc),
            negative_prompt=data.get("negative_prompt", "模糊、畸变、空间错乱、低质量、AI瑕疵"),
            model_target=target_model,
            prompt_strategy_version=strategy_version,
            prompt_sections=[f"llm_generated | {strategy_spec.version}"],
        )

    @staticmethod
    def _extract_json(raw: str) -> dict:
        import json
        import re

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            return json.loads(match.group()) if match else {}

    @staticmethod
    def _prompt_score(data: dict) -> int:
        positive = str(data.get("positive_prompt", "") or "")
        negative = str(data.get("negative_prompt", "") or "")
        summary = str(data.get("analysis_summary", "") or "")
        return len(positive) + min(len(negative), 500) + min(len(summary), 300)

    def _looks_too_short(self, data: dict, mode: GenerationMode, strategy_version: str) -> bool:
        positive = str(data.get("positive_prompt", "") or "").strip()
        negative = str(data.get("negative_prompt", "") or "").strip()
        if mode == GenerationMode.RENDER3D:
            spec = get_prompt_strategy_spec(strategy_version)
            if len(positive) < spec.min_positive_length:
                return True
            if len(negative) < spec.min_negative_length:
                return True
        else:
            if len(positive) < 140:
                return True
        return not negative

    @staticmethod
    def _format_item(item, label: str) -> str:
        qty = f"{item.quantity}个/组" if item.quantity is not None else "数量尽量按平面图保持"
        constraints = f"，约束：{'；'.join(item.constraints)}" if item.constraints else ""
        wall_relation = f"，墙体关系：{item.wall_relation}" if getattr(item, "wall_relation", "") else ""
        relative_position = f"，相对位置：{item.relative_position}" if getattr(item, "relative_position", "") else ""
        return (
            f"{label}：{item.name or '未识别'}，{qty}，位置：{item.position or '尽量按平面图位置'}，"
            f"朝向：{item.orientation or '尽量按平面图朝向'}{wall_relation}{relative_position}{constraints}"
        )

    @classmethod
    def _space_priority(cls, space) -> int:
        name = f"{space.name}{space.function}".strip()
        for idx, keyword in enumerate(cls.SPACE_PRIORITY_KEYWORDS):
            if keyword in name:
                return idx
        return len(cls.SPACE_PRIORITY_KEYWORDS) + 1

    @staticmethod
    def _dedupe_keep_order(values: list[str]) -> list[str]:
        seen = set()
        result = []
        for value in values:
            clean = str(value or "").strip()
            if clean and clean not in seen:
                seen.add(clean)
                result.append(clean)
        return result

    @staticmethod
    def _take(values: list[str], limit: int) -> list[str]:
        return [v for v in values if v][:limit]

    def _item_priority(self, item) -> tuple[int, int]:
        name = str(getattr(item, "name", "") or "")
        for index, keyword in enumerate(self.ITEM_PRIORITY_KEYWORDS):
            if keyword in name:
                return index, -len(name)
        return len(self.ITEM_PRIORITY_KEYWORDS), -len(name)

    def _pick_key_items(self, items, limit: int = 6):
        return sorted(list(items or []), key=self._item_priority)[:limit]

    @staticmethod
    def _is_stair_space(space) -> bool:
        return "楼梯" in f"{getattr(space, 'name', '')}{getattr(space, 'function', '')}"

    def _staircase_completion_lines(self) -> list[str]:
        return [
            "楼梯必须画成当前楼层内完整连续的一整段梯段，不是半截楼梯。",
            "要清楚表现起步踏步、连续踏步、上端到达平台、梯井开口以及扶手/栏杆关系。",
            "楼梯上端不要突然插进墙里或中途消失，要让人能看出它完整通向上层，但不要额外画出其他楼层实体。",
        ]

    def _build_user_priority_lines(self, requirement: ParsedRequirement, user_requirement_text: str) -> list[str]:
        lines = []
        raw_user_text = (user_requirement_text or "").strip()
        if raw_user_text:
            lines.append("原始需求优先级最高：" + raw_user_text)

        compact_key_elements = []
        for item in self._dedupe_keep_order(requirement.key_elements or []):
            clean = str(item or "").strip()
            if not clean:
                continue
            if len(clean) > 24 or clean.count("、") >= 2 or clean.count("，") >= 2:
                continue
            compact_key_elements.append(clean)
        if compact_key_elements:
            lines.append("补充保留项：" + "、".join(self._take(compact_key_elements, 10)))

        if requirement.forbidden_elements:
            lines.append("明确禁止：" + "、".join(self._take(self._dedupe_keep_order(requirement.forbidden_elements), 12)))

        special = (requirement.special_requirements or "").strip()
        if special and special != raw_user_text and len(special) <= 120:
            lines.append("额外特殊要求：" + special)
        return lines

    @staticmethod
    def _style_value(requirement: ParsedRequirement) -> str:
        if hasattr(requirement.style, "value"):
            return requirement.style.value
        return str(requirement.style or DesignStyle.OTHER.value)

    @classmethod
    def _resolve_style_profile(cls, requirement: ParsedRequirement, user_requirement_text: str) -> tuple[str, dict, bool]:
        style_value = cls._style_value(requirement)
        profile = cls.STYLE_PROFILES.get(style_value, cls.STYLE_PROFILES["default"])
        text = str(user_requirement_text or "")
        explicit = any(keyword and keyword in text for keyword in profile.get("keywords", ()))
        if not explicit and style_value not in (DesignStyle.MODERN.value, DesignStyle.OTHER.value):
            explicit = True
        return style_value, profile, explicit

    @classmethod
    def _default_color_tone(cls, style_value: str, explicit: bool) -> str:
        if explicit:
            return cls.STYLE_PROFILES.get(style_value, cls.STYLE_PROFILES["default"]).get("color_tone", "")
        return cls.STYLE_PROFILES["default"]["color_tone"]

    @staticmethod
    def _format_opening(opening) -> str:
        type_label = {
            "door": "门",
            "window": "窗",
            "opening": "开口",
            "balcony_edge": "阳台边界",
        }.get(str(opening.type or "").lower(), opening.type or "开口")
        parts = [
            f"{type_label}位于{opening.position or '原图对应位置'}",
        ]
        if opening.connects_to:
            parts.append(f"连接{opening.connects_to}")
        if getattr(opening, "swing_direction", ""):
            parts.append(f"开向{opening.swing_direction}")
        if getattr(opening, "hinge_side", ""):
            parts.append(f"合页侧{opening.hinge_side}")
        if opening.constraints:
            parts.append("约束" + "；".join(opening.constraints[:2]))
        return "，".join(parts)

    @staticmethod
    def _render_section(title: str, body_lines: list[str]) -> str:
        lines = [line for line in body_lines if str(line or "").strip()]
        if not lines:
            return ""
        return f"[{title}]\n" + "\n".join(lines)

    def _collect_priority_rules(self, floor_analysis: FloorPlanAnalysis) -> list[str]:
        door_rules = []
        window_rules = []
        cabinet_rules = []
        relation_rules = []
        wall_feature_rules = []
        stair_rules = []
        for space in floor_analysis.spaces:
            space_name = space.name or space.id or "未识别空间"
            if self._is_stair_space(space):
                stair_rules.extend(self._staircase_completion_lines())
            for opening in space.doors:
                door_rules.append(
                    f"{space_name}的门位于{opening.position or '原图对应位置'}，"
                    f"连接{opening.connects_to or '相邻空间'}"
                    + (f"，开向{opening.swing_direction}" if getattr(opening, "swing_direction", "") else "")
                    + (f"，合页侧{opening.hinge_side}" if getattr(opening, "hinge_side", "") else "")
                )
            for opening in space.windows:
                window_rules.append(
                    f"{space_name}的窗位于{opening.position or '原图对应位置'}，"
                    f"面向{opening.connects_to or '外部/采光面'}"
                )
            for item in space.furniture + space.fixtures:
                if getattr(item, "wall_relation", "") and ("柜" in (item.name or "") or "鱼缸" in (item.name or "") or "隔断" in (item.name or "")):
                    cabinet_rules.append(
                        f"{space_name}中的{item.name or '柜体'}为{item.wall_relation}，位置在{item.position or '原图对应位置'}"
                    )
                if any(keyword in (item.name or "") for keyword in ("电视", "挂画", "装饰品台座", "冰箱")):
                    wall_feature_rules.append(
                        f"{space_name}中的{item.name or '墙面构件'}位于{item.position or '原图对应位置'}，"
                        + (f"与墙体关系为{item.wall_relation}" if getattr(item, "wall_relation", "") else "必须保留其墙面/角落位置关系")
                    )
                if getattr(item, "relative_position", ""):
                    relation_rules.append(
                        f"{space_name}中{item.name or '家具'}与其他家具关系：{item.relative_position}"
                    )

        rules = []
        if door_rules:
            rules.append(
                "关键门规则："
                + "；".join(self._take(self._dedupe_keep_order(door_rules), 10))
                + "；除非平面分析明确写双开门，否则每个单门洞只生成一扇门板，不要把一个门洞画成双开门。"
            )
        if window_rules:
            rules.append(
                "关键窗规则："
                + "；".join(self._take(self._dedupe_keep_order(window_rules), 10))
                + "；门洞和窗洞必须区分，连接走道/房间的是门或开口，外墙采光面才是窗。"
            )
        if cabinet_rules:
            rules.append("关键柜体规则：" + "；".join(self._take(self._dedupe_keep_order(cabinet_rules), 4)) + "。")
        if wall_feature_rules:
            rules.append("关键墙面构件规则：" + "；".join(self._take(self._dedupe_keep_order(wall_feature_rules), 5)) + "。")
        if relation_rules:
            rules.append("关键多家具关系：" + "；".join(self._take(self._dedupe_keep_order(relation_rules), 6)) + "。")
        if stair_rules:
            rules.append("楼梯完整性规则：" + "；".join(self._take(self._dedupe_keep_order(stair_rules), 4)) + "。")
        return rules

    def _build_space_line(self, space) -> str:
        parts = [
            f"{space.name or space.id or '未识别空间'}：位置{space.position or '按原图'}",
            f"功能{space.function or '按原图表现'}",
        ]
        if space.adjacent_to:
            parts.append(f"相邻{'、'.join(space.adjacent_to[:4])}")

        item_details = []
        for item in self._pick_key_items(space.furniture + space.fixtures, limit=6):
            detail = f"{item.name or '未识别家具'}"
            if item.quantity is not None:
                detail += f"{item.quantity}个/组"
            if item.position:
                detail += f"，位置{item.position}"
            if item.orientation:
                detail += f"，朝向{item.orientation}"
            if getattr(item, "wall_relation", ""):
                detail += f"，墙体关系{item.wall_relation}"
            if getattr(item, "relative_position", ""):
                detail += f"，相对关系{item.relative_position}"
            item_details.append(detail)
        if item_details:
            parts.append("核心家具/设备：" + "；".join(item_details))

        opening_details = []
        for opening in (space.doors + space.windows)[:2]:
            opening_details.append(self._format_opening(opening))
        if opening_details:
            parts.append("关键门窗：" + "；".join(opening_details))

        constraints = self._take(
            self._dedupe_keep_order((space.hard_constraints or []) + (space.wall_constraints or [])),
            2,
        )
        if constraints:
            parts.append("硬约束：" + "；".join(constraints))
        if self._is_stair_space(space):
            parts.append("楼梯完整表现：" + "；".join(self._staircase_completion_lines()))
        return "。".join(parts) + "。"

    def _space_priority_bucket(self, space) -> str:
        priority_index = self._space_priority(space)
        strong_constraints = len((space.hard_constraints or [])) + len((space.wall_constraints or []))
        openings = len((space.doors or [])) + len((space.windows or []))
        item_count = len((space.furniture or [])) + len((space.fixtures or []))
        if priority_index <= 3 or strong_constraints >= 1 or openings >= 2:
            return "P0"
        if priority_index <= 7 or item_count >= 3:
            return "P1"
        return "P2"

    @staticmethod
    def _format_item_compact(item) -> str:
        detail = item.name or "未识别家具"
        if item.quantity is not None:
            detail += f"{item.quantity}个/组"
        if item.position:
            detail += f"，{item.position}"
        if item.orientation:
            detail += f"，朝向{item.orientation}"
        if getattr(item, "relative_position", ""):
            detail += f"，相对{item.relative_position}"
        elif getattr(item, "wall_relation", ""):
            detail += f"，{item.wall_relation}"
        return detail

    def _build_layered_space_entry(self, space, bucket: str, index: int) -> str:
        name = space.name or space.id or "未识别空间"
        parts = [
            f"{bucket}-{index}. {name}：位于{space.position or '原图对应位置'}，功能为{space.function or '按原图表现'}",
        ]
        if space.adjacent_to:
            parts.append("相邻" + "、".join(space.adjacent_to[:5]))

        item_lines = [self._format_item_compact(item) for item in self._pick_key_items(space.furniture + space.fixtures, limit=5)]
        if item_lines:
            parts.append("家具/设备必须按数量和朝向保留：" + "；".join(item_lines))

        opening_lines = [self._format_opening(opening) for opening in (space.doors + space.windows)[:4]]
        if opening_lines:
            parts.append("门窗/开口必须区分：" + "；".join(opening_lines))

        hard_constraints = self._dedupe_keep_order((space.hard_constraints or []) + (space.wall_constraints or []))
        if hard_constraints:
            parts.append("硬约束：" + "；".join(hard_constraints[:3]))
        if space.negative_constraints:
            parts.append("禁止：" + "；".join(space.negative_constraints[:2]))
        if self._is_stair_space(space):
            parts.append("楼梯完整表现：" + "；".join(self._staircase_completion_lines()))
        return "。".join(parts) + "。"

    def _build_layered_space_sections(self, floor_analysis: FloorPlanAnalysis) -> list[str]:
        grouped = {"P0": [], "P1": [], "P2": []}
        for space in sorted(floor_analysis.spaces, key=self._space_priority):
            grouped[self._space_priority_bucket(space)].append(space)

        sections = []
        for bucket in ("P0", "P1", "P2"):
            spaces = grouped[bucket]
            if not spaces:
                continue
            sections.append(f"{bucket} 空间：")
            for idx, space in enumerate(spaces, 1):
                sections.append(self._build_layered_space_entry(space, bucket, idx))
        return sections

    @staticmethod
    def _clean_analysis_text(text: str) -> str:
        return " ".join(str(text or "").replace("\r", "\n").split())

    def _build_readable_analysis_lines(self, floor_analysis: FloorPlanAnalysis) -> list[str]:
        lines = []
        readable_summary = self._clean_analysis_text(floor_analysis.readable_summary)
        final_prompt = self._clean_analysis_text(floor_analysis.final_prompt)
        if readable_summary:
            lines.append("平面解析可读性总结（作为画图主体约束，必须直接遵守）：")
            lines.append(readable_summary)
        elif final_prompt:
            lines.append("平面解析最终提示词（作为画图主体约束，必须直接遵守）：")
            lines.append(final_prompt)
        if final_prompt and final_prompt != readable_summary and len(readable_summary) < 500:
            lines.append("平面解析补充提示词：")
            lines.append(final_prompt)
        return lines

    def _build_prompt_body_from_analysis(self, floor_analysis: FloorPlanAnalysis) -> list[str]:
        lines = self._build_readable_analysis_lines(floor_analysis)
        if floor_analysis.spaces:
            lines.extend(self._build_layered_space_sections(floor_analysis))
        if not lines:
            lines.append("未获得足够的逐空间解析结果，必须严格参考用户上传的平面图原图生成，不得自由发挥布局。")
        return lines

    def _build_layered_execution_constraints(self, floor_analysis: FloorPlanAnalysis) -> list[str]:
        lines = [
            "整张图必须保持 roof removed、dollhouse cutaway、bird's-eye axonometric 的整体展示方式。",
            "不得额外增加楼层、房间、阳台、门窗、楼梯、电梯、柜体或走道。",
            "墙体边界、门洞、窗洞、固定结构必须优先正确，其次才是软装和氛围。",
            "最终提示词必须逐空间描述，每个房间至少说明位置、相邻关系、家具/设备数量、主要朝向、门窗/开口类型。",
            "如果平面解析已经给出可读性总结或最终提示词，画图模型必须把那段文字当作主体提示词执行，不要再压缩成短摘要。",
            "家具样貌不用反复展开，重点锁定数量、朝向、贴墙/独立关系、相对位置，尤其是椅子数量、桌椅围合关系、电视/挂画/壁画所在墙面。",
            "门洞和窗洞必须区分：门连接房间或走道，窗位于外墙或采光界面；除非明确为双开门，单门洞只允许一扇门板。",
            "核心房间、卫生间设备、柜体、工位、茶桌、卧室家具、墙上电视或挂画必须尽可能完整可见。",
            "楼梯必须完整表现为从当前楼层起步到上端平台的连续梯段，保留踏步、平台、梯井开口与扶手，不得只画半截。",
        ]
        if floor_analysis.fixed_structures:
            lines.append(
                "固定结构："
                + "；".join(
                    [
                        f"{item.name or '固定结构'}位于{item.position or '原图位置'}，{item.orientation or '按原图朝向'}"
                        for item in floor_analysis.fixed_structures[:8]
                    ]
                )
            )
        if floor_analysis.global_wall_constraints:
            lines.append("全局墙体约束：" + "；".join(floor_analysis.global_wall_constraints[:6]))
        if floor_analysis.global_window_constraints:
            lines.append("全局窗户约束：" + "；".join(floor_analysis.global_window_constraints[:6]))
        if floor_analysis.global_door_constraints:
            lines.append("全局门洞约束：" + "；".join(floor_analysis.global_door_constraints[:6]))
        if floor_analysis.hard_constraints:
            lines.append("全局硬约束：" + "；".join(floor_analysis.hard_constraints[:8]))
        if floor_analysis.negative_constraints:
            lines.append("全局禁止项：" + "；".join(floor_analysis.negative_constraints[:8]))
        if floor_analysis.prompt_notes:
            lines.append("绘图提示重点：" + "；".join(floor_analysis.prompt_notes[:8]))
        return lines

    def _build_style_lines(self, requirement: ParsedRequirement, user_requirement_text: str) -> list[str]:
        style, style_profile, style_explicit = self._resolve_style_profile(requirement, user_requirement_text)
        color_tone = requirement.color_tone or self._default_color_tone(style, style_explicit)
        if style_explicit:
            return [
                f"整体风格：{style}",
                f"主色调：{color_tone}",
                style_profile["materials"],
                style_profile["guardrails"],
            ]
        return [
            "整体风格：优先遵循用户原始需求；若未明确指定，则采用克制、真实、不过度装饰的现代室内表达。",
            f"主色调：{color_tone}",
            self.STYLE_PROFILES["default"]["materials"],
            self.STYLE_PROFILES["default"]["guardrails"],
        ]

    def _compile_3d_prompt_cn(
        self,
        requirement: ParsedRequirement,
        user_requirement_text: str,
        direction_stack_text: str,
        floor_analysis: FloorPlanAnalysis,
        feedback: Optional[str] = None,
        strategy_version: str = DEFAULT_PROMPT_STRATEGY,
    ) -> tuple[str, list[str]]:
        if strategy_version == PROMPT_STRATEGY_BASELINE_V0:
            return self._compile_3d_prompt_dense_v0(requirement, user_requirement_text, direction_stack_text, floor_analysis, feedback)
        return self._compile_3d_prompt_layered_v1(requirement, user_requirement_text, direction_stack_text, floor_analysis, feedback)

    def _compile_3d_prompt_dense_v0(
        self,
        requirement: ParsedRequirement,
        user_requirement_text: str,
        direction_stack_text: str,
        floor_analysis: FloorPlanAnalysis,
        feedback: Optional[str] = None,
    ) -> tuple[str, list[str]]:
        sections = []
        style, _, style_explicit = self._resolve_style_profile(requirement, user_requirement_text)
        color_tone = requirement.color_tone or self._default_color_tone(style, style_explicit)
        view = floor_analysis.view_recommendation or "西南角45度斜俯视，roof removed，dollhouse cutaway"
        space_type = floor_analysis.space_type or "混合功能空间"
        floor_label = floor_analysis.floor_label or "目标楼层"

        sections.append(
            "请基于平面图生成一张高约束、可检视的3D建筑室内效果图。"
            f" 视角必须采用{view}，优先满足用户原始需求：{user_requirement_text or '未提供额外需求'}。"
            f" 整体空间类型为{space_type}，对应{floor_label}，外轮廓为{floor_analysis.overall_shape or '尽量保持原平面图轮廓'}。"
            " 必须采用去顶的整层 cutaway 表现方式，让主要房间、走道、楼梯、电梯、阳台与办公/居住功能区尽量同时可见。"
        )

        sections.append(
            "整体装修与家具风格应遵循用户需求和结构约束，"
            f"风格以{style if style_explicit else '真实克制的现代室内表达'}为主，色调以{color_tone}为主。 "
            + " ".join(self._build_style_lines(requirement, user_requirement_text)[2:])
        )
        if direction_stack_text:
            sections.append(
                "设计指令栈是独立输入，不得丢失，必须作为强约束执行："
                + direction_stack_text.replace("\n", "；")
                + "。"
            )

        if floor_analysis.circulation or floor_analysis.core_summary:
            sections.append(
                f"整体空间组织必须遵守以下逻辑：动线为“{floor_analysis.circulation or '按平面图走道组织'}”，"
                f"核心空间组织为“{floor_analysis.core_summary or '按平面图的中轴和相邻关系组织'}”。"
                " 走道必须清晰、通畅，不要堵塞交通核心，不要把交通空间误画成客厅或大厅。"
            )

        sections.append(
            "高优先级结构规则：门的位置必须优先正确，关键门尽量遵守开向和合页侧；"
            "独立柜体、隔断柜、鱼缸柜不要误生成墙体；"
            "多件家具同时出现时，优先保留它们的左右、前后、围合、并排、对向关系。"
        )
        sections.extend(self._collect_priority_rules(floor_analysis))

        if floor_analysis.spaces:
            space_lines = ["以下空间必须逐一保留并尽量细化："]
            for idx, space in enumerate(sorted(floor_analysis.spaces, key=self._space_priority), 1):
                space_lines.append(f"{idx}. {self._build_space_line(space)}")
            sections.append("\n".join(space_lines))

        if floor_analysis.fixed_structures:
            structure_lines = ["以下固定结构必须准确保留，不得擅自改变："]
            for item in floor_analysis.fixed_structures[:6]:
                structure_lines.append(self._format_item(item, "固定结构") + "。")
            sections.append("\n".join(structure_lines))

        global_constraints = self._build_layered_execution_constraints(floor_analysis)
        sections.append("\n".join(global_constraints))

        if requirement.key_elements:
            sections.append(
                "用户特别要求保留的关键元素包括："
                + "、".join(self._take(self._dedupe_keep_order(requirement.key_elements), 18))
                + "。这些元素必须在图中清晰可见。"
            )
        if requirement.forbidden_elements:
            sections.append(
                "用户明确禁止出现："
                + "、".join(self._take(self._dedupe_keep_order(requirement.forbidden_elements), 18))
                + "。这些内容不得出现在结果图中。"
            )
        if requirement.special_requirements:
            sections.append("额外特殊要求：" + requirement.special_requirements + "。")

        sections.append(
            "最终画面必须具备建筑可视化质感：空间层级清晰、墙体边界明确、家具摆放关系准确、材质真实、光照柔和、细节清楚。"
            " 不允许随意增加额外楼层、额外阳台、额外窗户、额外房间，不允许把楼梯画错类型，不允许把办公空间和居住空间互相混淆。"
        )
        if feedback:
            sections.append("上一轮反馈需要重点修正：" + feedback + "。这次生成时要优先修复这些问题，同时保持其他区域不变。")
        return "\n\n".join(sections), [spec.title for spec in get_prompt_strategy_spec(PROMPT_STRATEGY_BASELINE_V0).positive_sections]

    def _compile_3d_prompt_layered_v1(
        self,
        requirement: ParsedRequirement,
        user_requirement_text: str,
        direction_stack_text: str,
        floor_analysis: FloorPlanAnalysis,
        feedback: Optional[str] = None,
    ) -> tuple[str, list[str]]:
        spec = get_prompt_strategy_spec(PROMPT_STRATEGY_LAYERED_V1)
        view = floor_analysis.view_recommendation or "southwest 45-degree axonometric dollhouse cutaway, roof removed"
        structure_section = self._render_section(
            spec.positive_sections[1].title,
            [
                f"空间类型：{floor_analysis.space_type or '未知'}；楼层：{floor_analysis.floor_label or '未知'}；外轮廓：{floor_analysis.overall_shape or '尽量保持原平面图轮廓'}。",
                f"推荐视角：{view}。",
                f"动线：{floor_analysis.circulation or '按平面图主走道组织'}。",
                f"核心组织：{floor_analysis.core_summary or '按平面图相邻关系组织各空间'}。",
                "结构优先级：先守住房间边界、门洞窗洞、固定结构，再守住家具朝向与风格细节。",
            ],
        )
        goal_section = self._render_section(
            spec.positive_sections[0].title,
            [
                "输出目标：生成一张 roof removed、dollhouse cutaway、bird's-eye axonometric 的整层 3D 建筑室内效果图。",
                f"用户原始需求：{user_requirement_text or '未提供额外需求，但必须遵守平面图结构。'}",
                "结果要求：整层空间必须同时可检视，不允许退化成普通室内平视图或平面贴图。",
            ],
        )
        space_section = self._render_section(spec.positive_sections[2].title, self._build_prompt_body_from_analysis(floor_analysis))
        relation_lines = self._collect_priority_rules(floor_analysis) or ["关键关系：门开向、柜体贴墙关系、多家具相对位置必须尽量保留。"]
        relation_section = self._render_section(spec.positive_sections[3].title, relation_lines)
        style_section = self._render_section(spec.positive_sections[4].title, self._build_style_lines(requirement, user_requirement_text))

        user_lines = self._build_user_priority_lines(requirement, user_requirement_text)
        if direction_stack_text:
            user_lines.append("设计指令栈（独立约束）：" + direction_stack_text.replace("\n", "；"))
        if feedback:
            user_lines.append("本轮重点修正：" + feedback)
        user_section = self._render_section(spec.positive_sections[5].title, user_lines)

        execution_section = self._render_section(spec.positive_sections[6].title, self._build_layered_execution_constraints(floor_analysis))
        rendered_sections = [
            goal_section,
            structure_section,
            space_section,
            relation_section,
            style_section,
            user_section,
            execution_section,
        ]
        prompt_text = "\n\n".join([section for section in rendered_sections if section])
        return prompt_text, [section.title for section in spec.positive_sections]

    def _compile_3d_negative_cn(
        self,
        requirement: ParsedRequirement,
        floor_analysis: FloorPlanAnalysis,
        user_requirement_text: str = "",
        direction_stack_text: str = "",
        feedback: Optional[str] = None,
        strategy_version: str = DEFAULT_PROMPT_STRATEGY,
    ) -> str:
        if strategy_version == PROMPT_STRATEGY_BASELINE_V0:
            return self._compile_3d_negative_dense_v0(requirement, floor_analysis, user_requirement_text, direction_stack_text, feedback)
        return self._compile_3d_negative_layered_v1(requirement, floor_analysis, user_requirement_text, direction_stack_text, feedback)

    def _compile_3d_negative_dense_v0(
        self,
        requirement: ParsedRequirement,
        floor_analysis: FloorPlanAnalysis,
        user_requirement_text: str = "",
        direction_stack_text: str = "",
        feedback: Optional[str] = None,
    ) -> str:
        negatives = [
            "禁止空间布局错乱",
            "禁止房间缺失或多出房间",
            "禁止随意改动墙体、门洞、窗洞、楼梯、电梯、阳台位置",
            "禁止把单跑直梯画成旋转楼梯或双跑对称楼梯",
            "禁止家具数量错误、家具朝向错误、房间功能错位",
            "禁止把卧室画成办公室，把办公室画成卧室，把阳台画成室内",
            "禁止额外楼层、额外阳台、额外窗户、额外走道、额外柜体",
            "禁止透视畸变、鸟瞰角度错误、低清晰度、模糊、脏乱、AI瑕疵",
        ]
        _, style_profile, style_explicit = self._resolve_style_profile(requirement, user_requirement_text)
        negatives.extend(style_profile["negative_terms"] if style_explicit else self.STYLE_PROFILES["default"]["negative_terms"])
        negatives.extend(floor_analysis.negative_constraints or [])
        for space in floor_analysis.spaces:
            negatives.extend((space.negative_constraints or [])[:2])
        negatives.extend(requirement.forbidden_elements or [])
        if direction_stack_text:
            negatives.append("禁止违背设计指令栈中的独立约束：" + direction_stack_text.replace("\n", "；"))
        if feedback:
            negatives.append("禁止重复上一轮反馈中指出的问题：" + feedback)
        deduped = self._dedupe_keep_order(negatives)
        return "，".join(self._take(deduped, 28)) + "。"

    def _compile_3d_negative_layered_v1(
        self,
        requirement: ParsedRequirement,
        floor_analysis: FloorPlanAnalysis,
        user_requirement_text: str = "",
        direction_stack_text: str = "",
        feedback: Optional[str] = None,
    ) -> str:
        _, style_profile, style_explicit = self._resolve_style_profile(requirement, user_requirement_text)
        p0 = [
            "禁止房间边界、墙体、门洞、窗洞、楼梯、电梯、阳台位置错误",
            "禁止遗漏卫生间、储物间、阳台、走道、电梯间、楼梯间等小空间",
            "禁止额外增加楼层、房间、门窗、走道、柜体或结构",
        ]
        p1 = [
            "禁止家具数量错误、朝向错误、相对位置关系错误",
            "禁止柜体贴墙关系错误、门开向错误、合页侧逻辑错误",
        ]
        p2 = [
            "禁止风格跑偏、材质不符、色调失控",
            "禁止透视畸变、普通平视角、低清晰度、模糊、脏乱、AI瑕疵",
        ]
        if style_explicit:
            p2.extend(style_profile["negative_terms"])
        else:
            p2.extend(self.STYLE_PROFILES["default"]["negative_terms"])
        p0.extend(floor_analysis.negative_constraints or [])
        for space in floor_analysis.spaces:
            p1.extend((space.negative_constraints or [])[:2])
        p2.extend(requirement.forbidden_elements or [])
        if direction_stack_text:
            p2.append("禁止违背设计指令栈中的独立约束：" + direction_stack_text.replace("\n", "；"))
        if feedback:
            p0.append("禁止重复上一轮结构问题：" + feedback)
        return (
            "P0 结构禁止项："
            + "；".join(self._take(self._dedupe_keep_order(p0), 12))
            + "。\nP1 关系禁止项："
            + "；".join(self._take(self._dedupe_keep_order(p1), 10))
            + "。\nP2 风格与画质禁止项："
            + "；".join(self._take(self._dedupe_keep_order(p2), 12))
            + "。"
        )
