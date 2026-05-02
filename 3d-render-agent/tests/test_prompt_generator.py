from agents.prompt_gen import PromptGenerator
from models.schemas import DesignStyle, FloorPlanAnalysis, FurnitureItem, OpeningItem, ParsedRequirement, SpaceAnalysis
from prompt_strategies import PROMPT_STRATEGY_BASELINE_V0, PROMPT_STRATEGY_LAYERED_V1


def _make_generator() -> PromptGenerator:
    return PromptGenerator(object())


def _make_floor_analysis() -> FloorPlanAnalysis:
    return FloorPlanAnalysis(
        space_type="住宅",
        floor_label="一层",
        overall_shape="矩形",
        readable_summary="客厅、餐厅、阳台清晰可见",
        fixed_structures=[FurnitureItem(name="楼梯", position="中部", orientation="直跑")],
        spaces=[SpaceAnalysis(name="客厅", function="起居", position="中部")],
    )


def test_modern_style_prompt_does_not_force_new_chinese_elements():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.MODERN, color_tone="暖灰")

    prompt, sections = generator._compile_3d_prompt_cn(
        requirement,
        "现代简约客厅，大落地窗",
        "",
        _make_floor_analysis(),
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )

    assert "整体风格：现代简约" in prompt
    assert "东方格栅" not in prompt
    assert "不要做成欧式、现代极简、工业风" not in prompt
    assert sections[0].startswith("生成目标")


def test_industrial_style_prompt_keeps_industrial_direction():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.INDUSTRIAL, color_tone="水泥灰")

    prompt, _ = generator._compile_3d_prompt_cn(
        requirement,
        "工业风 loft 客厅",
        "",
        _make_floor_analysis(),
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )
    negative = generator._compile_3d_negative_cn(
        requirement,
        _make_floor_analysis(),
        "工业风 loft 客厅",
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )

    assert "整体风格：工业风" in prompt
    assert "材质以水泥、金属、深色木材、裸露结构和明确灯具为主" in prompt
    assert "禁止中式格栅" in negative


def test_chinese_style_prompt_keeps_chinese_material_guidance():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.CHINESE, color_tone="木色与米白")

    prompt, _ = generator._compile_3d_prompt_cn(
        requirement,
        "新中式别墅客厅",
        "",
        _make_floor_analysis(),
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )
    negative = generator._compile_3d_negative_cn(
        requirement,
        _make_floor_analysis(),
        "新中式别墅客厅",
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )

    assert "整体风格：中式" in prompt
    assert "胡桃木" in prompt
    assert "禁止工业风" in negative


def test_unspecified_style_uses_neutral_fallback_copy():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.MODERN, color_tone="")

    prompt, _ = generator._compile_3d_prompt_cn(
        requirement,
        "大落地窗，暖色调，空间通透",
        "",
        _make_floor_analysis(),
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )

    assert "整体风格：优先遵循用户原始需求" in prompt
    assert "东方格栅" not in prompt


def test_baseline_strategy_keeps_dense_legacy_shape():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.MODERN, color_tone="暖灰")

    prompt, sections = generator._compile_3d_prompt_cn(
        requirement,
        "现代简约办公空间",
        "",
        _make_floor_analysis(),
        strategy_version=PROMPT_STRATEGY_BASELINE_V0,
    )

    assert "以下空间必须逐一保留并尽量细化" in prompt
    assert sections[0] == "生成目标"


def test_layered_prompt_expands_room_counts_orientation_and_door_window_rules():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.CHINESE, color_tone="木色与米白")
    floor_analysis = FloorPlanAnalysis(
        space_type="混合",
        floor_label="三层",
        overall_shape="横向长方形",
        spaces=[
            SpaceAnalysis(
                name="品茶区",
                function="茶室",
                position="左中部，两个卫生间右侧",
                adjacent_to=["左上阳台", "中部走道"],
                furniture=[
                    FurnitureItem(
                        name="茶椅",
                        quantity=8,
                        position="长方形茶桌左右两侧及端部",
                        orientation="朝向茶桌中心",
                        relative_position="围绕茶桌对称分布",
                    ),
                    FurnitureItem(name="墙面挂画", quantity=1, position="南侧墙面", wall_relation="贴墙"),
                ],
                doors=[OpeningItem(type="door", position="右侧", connects_to="中部走道")],
                windows=[OpeningItem(type="window", position="北侧外墙", connects_to="外部")],
            )
        ],
    )

    prompt, _ = generator._compile_3d_prompt_cn(
        requirement,
        "基于平面图生成东南角45度俯视的新中式3D效果图",
        "",
        floor_analysis,
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )

    assert "茶椅8个/组" in prompt
    assert "朝向茶桌中心" in prompt
    assert "围绕茶桌对称分布" in prompt
    assert "门位于右侧" in prompt
    assert "窗位于北侧外墙" in prompt
    assert "单门洞只生成一扇门板" in prompt


def test_layered_prompt_uses_readable_summary_when_structured_spaces_are_missing():
    generator = _make_generator()
    requirement = ParsedRequirement(style=DesignStyle.CHINESE, color_tone="木色与米白")
    summary = (
        "整体属性：三层混合功能空间，中央大走道连接卧室、品茶区、办公室、财务室和资料室。"
        "逐空间：品茶区位于左中部，有一张南北向长茶桌，八把茶椅围绕茶桌且朝向茶桌中心；"
        "卧室位于左下角，有一张双人床、两个床头柜和一个贴墙衣柜；"
        "财务室有一张办公桌、两把办公椅、一张靠墙沙发和文件柜。"
        "结构约束：门洞连接走道，窗户位于外墙，单门洞不要画成双开门，家具数量和朝向必须保持。"
    )
    floor_analysis = FloorPlanAnalysis(
        space_type="混合",
        floor_label="三层",
        overall_shape="横向长方形",
        readable_summary=summary,
        spaces=[],
    )

    prompt, _ = generator._compile_3d_prompt_cn(
        requirement,
        "基于平面图生成东南角45度俯视的新中式3D效果图",
        "",
        floor_analysis,
        strategy_version=PROMPT_STRATEGY_LAYERED_V1,
    )

    assert "平面解析可读性总结（作为画图主体约束，必须直接遵守）" in prompt
    assert "八把茶椅围绕茶桌且朝向茶桌中心" in prompt
    assert "单门洞不要画成双开门" in prompt
    assert "如果平面解析已经给出可读性总结或最终提示词" in prompt
