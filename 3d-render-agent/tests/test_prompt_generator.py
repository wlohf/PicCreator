from agents.prompt_gen import PromptGenerator
from models.schemas import DesignStyle, FloorPlanAnalysis, FurnitureItem, ParsedRequirement, SpaceAnalysis
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
        _make_floor_analysis(),
        strategy_version=PROMPT_STRATEGY_BASELINE_V0,
    )

    assert "以下空间必须逐一保留并尽量细化" in prompt
    assert sections[0] == "生成目标"
