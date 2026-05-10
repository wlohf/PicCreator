from __future__ import annotations

from typing import Iterable, Optional

from models.schemas import FloorPlanAnalysis, FurnitureItem, ParsedRequirement, PromptSet


COMPILED_RENDER3D_FLOOR_VERSION_SUFFIX = "+dense_floor_v2"
POSITIVE_PROMPT_SOFT_BUDGET = 2600
FEEDBACK_CHAR_BUDGET = 260
DIRECTION_STACK_CHAR_BUDGET = 160
CONSTRAINT_CHAR_BUDGET = 120
GLOBAL_CONSTRAINT_LIMIT = 8

PROMPT_SECTION_NAMES = [
    "生成目标 | P0",
    "硬约束总则 | P0",
    "关键空间合同 | P0",
    "门窗墙/固定结构 | P0",
    "家具拓扑与朝向 | P0",
    "风格边界 | P1",
]

RISK_KEYWORDS = ["卫生间", "厕所", "楼梯", "财务室", "办公室", "卧室", "总经理室", "总经理", "general manager"]

STYLE_BOUNDARY = "风格只作用于材质与造型，不得改变平面逻辑、房间用途、家具数量、家具朝向或门窗墙体关系。"


def compile_render3d_floor_prompt(
    *,
    iteration: int,
    requirement: ParsedRequirement,
    user_requirement_text: str,
    direction_stack_text: str,
    feedback: Optional[str],
    floor_analysis: FloorPlanAnalysis,
    target_model: str,
    strategy_version: str,
    learned_preferences_text: str = "",
) -> PromptSet:
    """Compile a deterministic, structure-first prompt from FloorPlanAnalysis.

    The compiler is intentionally dense rather than terse: it removes repeated prose and weak
    wording, but it must not silently drop room facts such as furniture count, opening position,
    orientation, wall relation, or actionable evaluator feedback.
    """

    positive_sections = _positive_sections(
        iteration=iteration,
        requirement=requirement,
        user_requirement_text=user_requirement_text,
        direction_stack_text=direction_stack_text,
        feedback=feedback,
        floor_analysis=floor_analysis,
        room_detail="full",
        include_style_detail=True,
        learned_preferences_text=learned_preferences_text,
    )
    positive_prompt = "\n".join(section for section in positive_sections if section).strip()
    if len(positive_prompt) > POSITIVE_PROMPT_SOFT_BUDGET:
        positive_sections = _positive_sections(
            iteration=iteration,
            requirement=requirement,
            user_requirement_text=user_requirement_text,
            direction_stack_text=direction_stack_text,
            feedback=feedback,
            floor_analysis=floor_analysis,
            room_detail="compact",
            include_style_detail=False,
            learned_preferences_text=learned_preferences_text,
        )
        positive_prompt = "\n".join(section for section in positive_sections if section).strip()
    if len(positive_prompt) > POSITIVE_PROMPT_SOFT_BUDGET:
        positive_sections = _positive_sections(
            iteration=iteration,
            requirement=requirement,
            user_requirement_text=user_requirement_text,
            direction_stack_text=direction_stack_text,
            feedback=feedback,
            floor_analysis=floor_analysis,
            room_detail="ultra",
            include_style_detail=False,
            learned_preferences_text=learned_preferences_text,
        )
        positive_prompt = "\n".join(section for section in positive_sections if section).strip()

    negative_prompt = _negative_prompt(floor_analysis)

    return PromptSet(
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        model_target=target_model,
        prompt_strategy_version=_compiled_strategy_version(strategy_version),
        prompt_sections=list(PROMPT_SECTION_NAMES),
    )


def _positive_sections(
    *,
    iteration: int,
    requirement: ParsedRequirement,
    user_requirement_text: str,
    direction_stack_text: str,
    feedback: Optional[str],
    floor_analysis: FloorPlanAnalysis,
    room_detail: str,
    include_style_detail: bool,
    learned_preferences_text: str,
) -> list[str]:
    return [
        _section("生成目标 | P0", _goal_lines(iteration, requirement, user_requirement_text, floor_analysis)),
        _section("硬约束总则 | P0", _hard_rule_lines(floor_analysis, direction_stack_text, feedback)),
        _section("关键空间合同 | P0", _room_contract_lines(floor_analysis, room_detail)),
        _section("门窗墙/固定结构 | P0", _structure_lines(floor_analysis, room_detail)),
        _section("家具拓扑与朝向 | P0", _furniture_topology_lines(floor_analysis)),
        _section("风格边界 | P1", _style_lines(requirement, learned_preferences_text, include_detail=include_style_detail)),
    ]


def _compiled_strategy_version(strategy_version: str) -> str:
    base = strategy_version or "prompt_compiler"
    if COMPILED_RENDER3D_FLOOR_VERSION_SUFFIX in base:
        return base
    return f"{base}{COMPILED_RENDER3D_FLOOR_VERSION_SUFFIX}"


def _section(title: str, lines: Iterable[str]) -> str:
    body = [line.strip() for line in lines if line and line.strip()]
    if not body:
        return f"[{title}]"
    return f"[{title}]\n" + "\n".join(body)


def _goal_lines(
    iteration: int,
    requirement: ParsedRequirement,
    user_requirement_text: str,
    analysis: FloorPlanAnalysis,
) -> list[str]:
    style = _enum_value(requirement.style) or "既定风格"
    tone = f"；色调={requirement.color_tone}" if requirement.color_tone else ""
    base = f"第{iteration + 1}轮：按平面图生成切顶式3D空间，结构保真优先；风格={style}{tone}。"
    shape_parts = [analysis.floor_label, analysis.space_type, analysis.overall_shape, analysis.dimensions]
    shape = " / ".join(_clean(part) for part in shape_parts if _clean(part))
    lines = [base]
    if shape:
        lines.append(f"平面概况：{shape}。")
    if analysis.circulation:
        lines.append(f"动线：{analysis.circulation}。")
    risks = _risk_focus(user_requirement_text, analysis)
    if risks:
        lines.append("风险空间重点复核：" + "、".join(risks) + "。")
    return lines


def _hard_rule_lines(analysis: FloorPlanAnalysis, direction_stack_text: str, feedback: Optional[str]) -> list[str]:
    lines = [
        "P0顺序：外轮廓/墙体/门窗/固定结构 > 房间用途与相邻关系 > 家具数量/朝向/相对位置 > 材质风格。",
        "不得镜像、旋转、打通、合并或改名房间；不确定装饰可省略，不得补造结构。",
        "门规则：单门洞只画一套门扇；不得两个木门重叠；不得把可通行阳台门/推拉门画成普通窗。",
        "洁具规则：蹲厕、坐便器/马桶、小便器、洗手台、淋浴区必须按解析类型分别绘制，不得互相替换。",
    ]
    lines.extend(_limit(analysis.hard_constraints, GLOBAL_CONSTRAINT_LIMIT, CONSTRAINT_CHAR_BUDGET))
    if direction_stack_text:
        lines.append(f"指令栈：{_compact_text(direction_stack_text, DIRECTION_STACK_CHAR_BUDGET)}")
    if feedback:
        lines.append(f"纠偏重点：{_feedback_text(feedback, FEEDBACK_CHAR_BUDGET)}")
    return lines


def _room_contract_lines(analysis: FloorPlanAnalysis, detail_level: str = "full") -> list[str]:
    lines: list[str] = []
    if not analysis.spaces:
        if analysis.readable_summary:
            return [f"- 可读平面分析：{_compact_text(analysis.readable_summary, 1400)}"]
        return ["- 未提供逐空间结构；以平面图可见墙体、门窗和固定结构为准。"]

    for space in analysis.spaces:
        name = space.name or space.id
        if not name:
            continue
        descriptors: list[str] = []
        if space.function or space.position:
            descriptors.append(f"{space.function or '空间'}@{space.position or '原位'}")
        if detail_level != "ultra" and space.adjacent_to:
            descriptors.append("邻=" + "/".join(_dedupe(space.adjacent_to)))
        opening_summary = _openings_summary([*space.doors, *space.windows], detail_level=detail_level)
        if opening_summary:
            descriptors.append("门窗=" + opening_summary)
        item_summary = _items_summary([*space.furniture, *space.fixtures], detail_level=detail_level)
        if item_summary:
            descriptors.append("家具=" + item_summary)
        constraints = []
        if detail_level == "full":
            constraints = _limit([*space.wall_constraints, *space.hard_constraints], 4, CONSTRAINT_CHAR_BUDGET)
        if constraints:
            descriptors.append("约束=" + "｜".join(constraints))
        policy_constraints = _space_policy_constraints(space)
        if policy_constraints:
            descriptors.append("P0=" + "｜".join(policy_constraints))
        if detail_level == "ultra":
            lines.append(f"- {name}[" + ";".join(descriptors) + "]")
        else:
            lines.append(f"- {name}" + ("：" + "；".join(descriptors) if descriptors else "：保持原功能与原位置"))
    return lines


def _structure_lines(analysis: FloorPlanAnalysis, detail_level: str = "full") -> list[str]:
    lines: list[str] = []
    if detail_level == "ultra":
        fixed = _items_summary(analysis.fixed_structures, detail_level="compact")
        return [f"固定结构：{fixed}"] if fixed else []

    for label, values in (
        ("墙", analysis.global_wall_constraints),
        ("窗/阳台", analysis.global_window_constraints),
        ("门/洞口", analysis.global_door_constraints),
    ):
        limited = _limit(values, GLOBAL_CONSTRAINT_LIMIT, CONSTRAINT_CHAR_BUDGET)
        if limited:
            lines.append(f"{label}：" + "｜".join(limited))
    fixed = _items_summary(analysis.fixed_structures, detail_level=detail_level)
    if fixed:
        lines.append("固定结构：" + fixed)
    return lines


def _furniture_topology_lines(analysis: FloorPlanAnalysis) -> list[str]:
    if any(space.furniture or space.fixtures for space in analysis.spaces):
        return ["逐空间家具数量、朝向、贴墙关系、相对关系已并入空间合同；按合同执行，不增减、不重排。"]
    return ["家具按平面图可见数量、朝向和相对关系摆放，不新增主家具。"]


def _style_lines(requirement: ParsedRequirement, learned_preferences_text: str = "", include_detail: bool = True) -> list[str]:
    lines = [STYLE_BOUNDARY]
    if learned_preferences_text:
        lines.append("已学习偏好：" + _compact_text(learned_preferences_text, 420) + "。")
    if not include_detail:
        return lines
    style = _enum_value(requirement.style)
    style_bits = []
    if style:
        style_bits.append(style)
    if requirement.color_tone:
        style_bits.append(requirement.color_tone)
    if requirement.key_elements:
        style_bits.append("包含=" + "、".join(requirement.key_elements[:5]))
    if requirement.forbidden_elements:
        style_bits.append("避免=" + "、".join(requirement.forbidden_elements[:5]))
    if requirement.special_requirements:
        style_bits.append(_compact_text(requirement.special_requirements, CONSTRAINT_CHAR_BUDGET))
    if style_bits:
        lines.append("风格执行：" + "；".join(style_bits) + "。")
    return lines


def _negative_prompt(analysis: FloorPlanAnalysis) -> str:
    prohibitions = [
        "不得改变外轮廓、承重墙、隔墙、门洞、窗户、阳台栏杆、楼梯、电梯位置",
        "不得镜像、旋转、拉伸平面图；不得打通、合并、拆分或改名房间",
        "不得增减家具数量，不得改变家具朝向、墙体关系、相对位置",
        "不得遗漏门窗、墙体、楼梯、电梯、阳台、卫生间",
        "不得用风格化装饰覆盖或替代结构逻辑",
    ]
    prohibitions.extend(_limit(analysis.negative_constraints, GLOBAL_CONSTRAINT_LIMIT, CONSTRAINT_CHAR_BUDGET))
    for space in analysis.spaces:
        prohibitions.extend(_limit(space.negative_constraints, 4, CONSTRAINT_CHAR_BUDGET))
    return "；".join(_dedupe(prohibitions)) + "。"


def _items_summary(
    items: Iterable[FurnitureItem],
    max_items: Optional[int] = None,
    detail_level: str = "full",
) -> str:
    parts = []
    for item in items:
        if not item.name:
            continue
        qty = f"x{item.quantity}" if item.quantity is not None else ""
        detail = f"{item.name}{qty}"
        if detail_level in ("compact", "ultra"):
            parts.append(detail)
            if max_items is not None and len(parts) >= max_items:
                break
            continue
        attrs = []
        if item.position:
            attrs.append(f"位置={item.position}")
        if item.orientation:
            attrs.append(f"朝向={item.orientation}")
        if item.wall_relation:
            attrs.append(f"墙体关系={item.wall_relation}")
        if item.relative_position:
            attrs.append(f"相对={item.relative_position}")
        if item.constraints:
            attrs.append("约束=" + "、".join(item.constraints[:2]))
        if attrs:
            detail += "(" + ",".join(attrs) + ")"
        parts.append(detail)
        if max_items is not None and len(parts) >= max_items:
            break
    return "、".join(parts)


def _openings_summary(
    openings: Iterable,
    max_items: Optional[int] = None,
    detail_level: str = "full",
) -> str:
    parts = []
    for opening in openings:
        kind = _opening_kind(_clean(getattr(opening, "type", "")))
        pos = _clean(getattr(opening, "position", ""))
        connects = _clean(getattr(opening, "connects_to", ""))
        detail = kind + (f"@{pos}" if pos else "")
        if connects:
            detail += f"->{connects}"
        if detail_level == "full":
            swing = _clean(getattr(opening, "swing_direction", ""))
            hinge = _clean(getattr(opening, "hinge_side", ""))
            constraints = _dedupe(getattr(opening, "constraints", []) or [])
            attrs = []
            if swing:
                attrs.append(f"开向={swing}")
            if hinge:
                attrs.append(f"合页={hinge}")
            if constraints:
                attrs.append("约束=" + "、".join(constraints[:2]))
            if "阳台" in connects:
                attrs.append("可通行阳台门/推拉门，不是普通窗")
            if attrs:
                detail += "(" + ",".join(attrs) + ")"
        elif "阳台" in connects:
            detail += "(可通行阳台门/推拉门，不是普通窗)"
        parts.append(detail)
        if max_items is not None and len(parts) >= max_items:
            break
    return "、".join(parts)


def _space_policy_constraints(space) -> list[str]:
    name = _clean(getattr(space, "name", ""))
    function = _clean(getattr(space, "function", ""))
    items = [*getattr(space, "furniture", []), *getattr(space, "fixtures", [])]
    item_names = "、".join(_clean(getattr(item, "name", "")) for item in items)
    policies: list[str] = []

    if "蹲厕" in item_names:
        policies.append("蹲厕不得画成马桶/坐便器")
    if "坐便器" in item_names or "马桶" in item_names:
        policies.append("坐便器/马桶不得画成蹲厕")

    is_archive = any(keyword in f"{name}{function}" for keyword in ("资料室", "档案", "储物"))
    has_chair = any(keyword in item_names for keyword in ("椅", "凳"))
    if is_archive and not has_chair:
        policies.append("资料室禁止新增椅子/凳子")

    if any("电视" in _clean(getattr(item, "name", "")) for item in items):
        policies.append("电视必须保留靠墙位置，不得漏画")
    if any("鱼缸" in _clean(getattr(item, "name", "")) for item in items):
        policies.append("鱼缸必须保留靠墙位置，不得移到床尾或窗下")

    has_balcony_door = any("阳台" in _clean(getattr(opening, "connects_to", "")) for opening in getattr(space, "doors", []))
    if has_balcony_door:
        policies.append("通阳台界面画成可通行阳台门/推拉门，不是普通窗")

    return _dedupe(policies)


def _risk_focus(text: str, analysis: FloorPlanAnalysis) -> list[str]:
    haystack = " ".join([text or "", analysis.readable_summary or "", " ".join(space.name for space in analysis.spaces)])
    found = []
    for keyword in RISK_KEYWORDS:
        if keyword.lower() in haystack.lower():
            normalized = "总经理室" if keyword == "总经理" else keyword
            found.append(normalized)
    return _dedupe(found)


def _limit(values: Iterable[str], count: Optional[int], max_len: int = CONSTRAINT_CHAR_BUDGET) -> list[str]:
    result = [_compact_text(str(value), max_len) for value in values if _clean(str(value))]
    return result if count is None else result[:count]


def _dedupe(values: Iterable[str]) -> list[str]:
    result = []
    seen = set()
    for value in values:
        cleaned = _clean(value)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _compact_text(value: str, max_len: int) -> str:
    cleaned = _clean(value)
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip("，；、 ") + "…"


def _feedback_text(value: str, max_len: int) -> str:
    cleaned = _clean(value)
    if len(cleaned) <= max_len:
        return cleaned
    head_len = max_len // 2
    tail_len = max_len - head_len - 1
    head = cleaned[:head_len].rstrip("，；、 ")
    tail = cleaned[-tail_len:].lstrip("，；、 ")
    return f"{head}…{tail}"


def _opening_kind(value: str) -> str:
    aliases = {
        "door": "门",
        "door/opening": "门/开口",
        "open_passage": "开敞通道",
        "elevator_door": "电梯门",
        "window": "窗",
        "opening": "开口",
        "sliding_door": "移门",
        "balcony_edge": "阳台边界",
    }
    return aliases.get((value or "").strip().lower(), value or "开口")


def _clean(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def _enum_value(value) -> str:
    return str(getattr(value, "value", value) or "")
