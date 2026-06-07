import pytest

from agents.prompt_compiler import compile_render3d_floor_prompt
from agents.prompt_gen import PROMPT_ENGINE_VERSION, PromptGenerator
from models.schemas import (
    DesignStyle,
    FloorPlanAnalysis,
    FurnitureItem,
    GenerationMode,
    OpeningItem,
    ParsedRequirement,
    SpaceAnalysis,
)


class StubLlm:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    async def chat(self, messages, **kwargs):
        self.calls += 1
        if not self.responses:
            raise RuntimeError("No more stub responses")
        return self.responses.pop(0)


def _make_floor_analysis() -> FloorPlanAnalysis:
    return FloorPlanAnalysis(
        space_type="混合",
        floor_label="三层",
        overall_shape="横向长方形",
        circulation="中部横向走道串联左右房间",
        readable_summary="三层混合功能空间，北侧双阳台，中部横向走道连接各房间。",
        global_wall_constraints=["外轮廓墙体不可改动", "中部横向走道两侧墙线保持连续"],
        global_window_constraints=["北侧双阳台保留栏杆与落地窗"],
        global_door_constraints=["各房间门洞朝向走道，不得改为开放大通间"],
        hard_constraints=["楼梯、电梯、阳台、卫生间属于结构硬约束"],
        negative_constraints=["不得把卫生间改成储物间", "不得合并财务室和办公室"],
        fixed_structures=[
            FurnitureItem(name="楼梯", quantity=1, position="中部偏右", orientation="直跑向北", wall_relation="贴核心筒"),
            FurnitureItem(name="电梯", quantity=1, position="中部", orientation="门朝南侧走道"),
        ],
        spaces=[
            SpaceAnalysis(
                name="品茶区",
                function="茶室",
                position="中部偏左",
                adjacent_to=["中部走道", "办公室"],
                furniture=[
                    FurnitureItem(
                        name="茶桌",
                        quantity=1,
                        position="空间中心",
                        orientation="东西向",
                        wall_relation="不贴墙",
                        relative_position="四把椅围绕茶桌",
                    ),
                    FurnitureItem(name="茶椅", quantity=4, position="茶桌四周", orientation="朝向茶桌"),
                ],
                doors=[OpeningItem(type="door", position="南侧", connects_to="中部走道")],
            ),
            SpaceAnalysis(
                name="财务室",
                function="独立办公",
                position="右中部",
                furniture=[FurnitureItem(name="办公桌", quantity=2, position="靠北墙", orientation="面向南", wall_relation="贴北墙")],
                windows=[OpeningItem(type="window", position="北墙")],
            ),
            SpaceAnalysis(
                name="右下办公室",
                function="办公室",
                position="右下角",
                furniture=[FurnitureItem(name="工位桌", quantity=4, position="房间中部", orientation="两两相对", relative_position="沿东西向成两排")],
            ),
            SpaceAnalysis(name="左侧卫生间", function="卫生间", position="左侧", fixtures=[FurnitureItem(name="马桶", quantity=2, position="隔间内", orientation="朝门")]),
            SpaceAnalysis(name="左下卧室", function="卧室", position="左下角", furniture=[FurnitureItem(name="床", quantity=1, position="靠西墙", orientation="床头朝西", wall_relation="床头贴西墙")]),
            SpaceAnalysis(name="总经理室", function="独立办公室", position="右上角", furniture=[FurnitureItem(name="经理桌", quantity=1, position="靠北", orientation="面向南")]),
        ],
    )


@pytest.mark.asyncio
async def test_render3d_generate_prefers_llm_prompt_output():
    llm = StubLlm([])
    generator = PromptGenerator(llm)
    requirement = ParsedRequirement(style=DesignStyle.CHINESE, color_tone="木色与米白")

    result = await generator.generate(
        iteration=0,
        requirement=requirement,
        user_requirement_text="基于平面图生成新中式3D效果图",
        target_model="gpt-image-2",
        mode=GenerationMode.RENDER3D,
        floor_analysis=_make_floor_analysis(),
        prompt_strategy_version=PROMPT_ENGINE_VERSION,
    )

    assert result.positive_prompt.startswith("[生成目标 | P0]")
    assert "[关键空间合同 | P0]" in result.positive_prompt
    assert "财务室：独立办公@右中部" in result.positive_prompt
    assert "办公桌x2" in result.positive_prompt
    assert "朝向=面向南" in result.positive_prompt
    assert result.prompt_sections == [
        "生成目标 | P0",
        "硬约束总则 | P0",
        "关键空间合同 | P0",
        "门窗墙/固定结构 | P0",
        "家具拓扑与朝向 | P0",
        "风格边界 | P1",
    ]
    assert llm.calls == 0


@pytest.mark.asyncio
async def test_render3d_generate_retries_when_prompt_is_too_short():
    llm = StubLlm([
        '{"positive_prompt":"太短","negative_prompt":"太短","analysis_summary":"short"}',
        '{"positive_prompt":"基于平面图生成整层切顶式3D效果图，西南45度轴测视角，保留墙体，明确楼梯、电梯、双阳台和主要办公生活空间。","negative_prompt":"不要改户型，不要镜像，不要旋转，不要遗漏关键空间。","analysis_summary":"ok"}',
    ])
    generator = PromptGenerator(llm)
    requirement = ParsedRequirement(style=DesignStyle.CHINESE, color_tone="木色与米白")

    result = await generator.generate(
        iteration=0,
        requirement=requirement,
        user_requirement_text="基于平面图生成新中式3D效果图",
        target_model="gpt-image-2",
        mode=GenerationMode.RENDER3D,
        floor_analysis=None,
        floor_desc="现代简约办公空间",
    )

    assert result.positive_prompt.startswith("基于平面图生成整层切顶式3D效果图")
    assert llm.calls == 2


def test_compiler_emits_compact_structure_first_floor_prompt():
    requirement = ParsedRequirement(style=DesignStyle.CHINESE, color_tone="暖白、浅米、胡桃木")

    compiled = compile_render3d_floor_prompt(
        iteration=0,
        requirement=requirement,
        user_requirement_text="请重点避免卫生间、楼梯、财务室、办公室、卧室、总经理室再次错乱",
        direction_stack_text="结构保真第一，家具数量第二",
        feedback="上一轮右下办公室工位朝向错误",
        floor_analysis=_make_floor_analysis(),
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    positive = compiled.positive_prompt
    assert positive.startswith("[生成目标 | P0]")
    for section in (
        "[硬约束总则 | P0]",
        "[关键空间合同 | P0]",
        "[门窗墙/固定结构 | P0]",
        "[家具拓扑与朝向 | P0]",
        "[风格边界 | P1]",
    ):
        assert section in positive
    assert "茶桌x1" in positive and "朝向=东西向" in positive and "相对=四把椅围绕茶桌" in positive
    assert "工位桌x4" in positive and "相对=沿东西向成两排" in positive
    assert "床x1" in positive and "墙体关系=床头贴西墙" in positive
    assert "风险空间重点复核" in positive
    assert "卫生间" in positive and "楼梯" in positive and "财务室" in positive and "总经理室" in positive
    assert "风格只作用于材质与造型，不得改变平面逻辑、房间用途、家具数量、家具朝向或门窗墙体关系" in positive
    assert "逐空间约束" not in positive
    assert positive.count("未识别") <= 1
    assert len(positive) < 1200


def test_compiler_negative_prompt_contains_structure_and_furniture_prohibitions():
    compiled = compile_render3d_floor_prompt(
        iteration=1,
        requirement=ParsedRequirement(style=DesignStyle.CHINESE),
        user_requirement_text="",
        direction_stack_text="",
        feedback=None,
        floor_analysis=_make_floor_analysis(),
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    negative = compiled.negative_prompt
    assert "不得改变外轮廓" in negative
    assert "不得增减家具数量" in negative
    assert "不得改变家具朝向" in negative
    assert "不得遗漏门窗、墙体、楼梯、电梯、阳台、卫生间" in negative
    assert "不得合并财务室和办公室" in negative


def test_compiler_preserves_dense_room_facts_without_item_count_cutoff():
    analysis = FloorPlanAnalysis(
        space_type="办公",
        floor_label="二层",
        overall_shape="L形",
        circulation="东侧走道连接会议室和茶水间",
        global_door_constraints=["会议室东侧双开门连接走道", "会议室南侧移门连接茶水区"],
        global_window_constraints=["会议室北墙长窗保留", "会议室西侧高窗保留"],
        spaces=[
            SpaceAnalysis(
                name="会议室",
                function="会议",
                position="西北角",
                adjacent_to=["东侧走道", "南侧茶水区", "西侧外墙"],
                furniture=[
                    FurnitureItem(name="会议桌", quantity=1, position="房间中心", orientation="东西向"),
                    FurnitureItem(name="会议椅", quantity=10, position="会议桌四周", orientation="朝向桌心"),
                    FurnitureItem(name="投影幕", quantity=1, position="西墙", orientation="朝东"),
                    FurnitureItem(name="白板", quantity=1, position="南墙", orientation="朝北"),
                    FurnitureItem(name="文件柜", quantity=2, position="北墙两端", wall_relation="贴北墙"),
                    FurnitureItem(name="茶水柜", quantity=1, position="东南角", wall_relation="贴东墙"),
                ],
                doors=[
                    OpeningItem(type="door", position="东侧双开门", connects_to="东侧走道"),
                    OpeningItem(type="sliding_door", position="南侧移门", connects_to="茶水区"),
                    OpeningItem(type="opening", position="东北角开口", connects_to="设备间"),
                ],
                windows=[
                    OpeningItem(type="window", position="北墙长窗"),
                    OpeningItem(type="window", position="西侧高窗"),
                ],
            )
        ],
    )

    compiled = compile_render3d_floor_prompt(
        iteration=0,
        requirement=ParsedRequirement(style=DesignStyle.MODERN, color_tone="暖灰"),
        user_requirement_text="会议室结构必须精准",
        direction_stack_text="",
        feedback=None,
        floor_analysis=analysis,
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    positive = compiled.positive_prompt
    for expected in ("会议桌x1", "会议椅x10", "投影幕x1", "白板x1", "文件柜x2", "茶水柜x1"):
        assert expected in positive
    for expected in ("东侧双开门", "南侧移门", "东北角开口", "北墙长窗", "西侧高窗"):
        assert expected in positive
    assert len(positive) <= 2600


def test_compiler_keeps_actionable_feedback_beyond_short_prefix():
    feedback = (
        "上一轮评估：整体风格尚可，但需要继续提升空间一致性、家具关系、光照清晰度和门窗细节。"
        "具体纠偏：北侧双开门被画成单开门，会议椅数量明显不足，投影幕被遗漏。"
    )

    compiled = compile_render3d_floor_prompt(
        iteration=1,
        requirement=ParsedRequirement(style=DesignStyle.MODERN),
        user_requirement_text="",
        direction_stack_text="",
        feedback=feedback,
        floor_analysis=_make_floor_analysis(),
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    assert "北侧双开门被画成单开门" in compiled.positive_prompt
    assert "会议椅数量明显不足" in compiled.positive_prompt
    assert "投影幕被遗漏" in compiled.positive_prompt


def test_compiler_uses_readable_summary_when_structured_spaces_are_missing():
    summary = (
        "整体属性：三层混合功能空间，中央大走道连接卧室、品茶区、办公室、财务室和资料室。"
        "唯一事实标记：西北资料室含四组贴北墙档案柜，南侧单开门连接走道。"
    )

    compiled = compile_render3d_floor_prompt(
        iteration=0,
        requirement=ParsedRequirement(style=DesignStyle.MODERN),
        user_requirement_text="",
        direction_stack_text="",
        feedback=None,
        floor_analysis=FloorPlanAnalysis(readable_summary=summary),
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    assert "西北资料室含四组贴北墙档案柜" in compiled.positive_prompt
    assert "南侧单开门连接走道" in compiled.positive_prompt


def test_compiler_preserves_opening_swing_hinge_and_constraints():
    analysis = FloorPlanAnalysis(
        spaces=[
            SpaceAnalysis(
                name="办公室",
                function="办公",
                position="东南角",
                doors=[
                    OpeningItem(
                        type="door",
                        position="西墙中部",
                        connects_to="走道",
                        swing_direction="向内开启",
                        hinge_side="北侧合页",
                        constraints=["单扇门，不得画成双开门"],
                    )
                ],
            )
        ]
    )

    compiled = compile_render3d_floor_prompt(
        iteration=0,
        requirement=ParsedRequirement(style=DesignStyle.MODERN),
        user_requirement_text="",
        direction_stack_text="",
        feedback=None,
        floor_analysis=analysis,
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    assert "向内开启" in compiled.positive_prompt
    assert "北侧合页" in compiled.positive_prompt
    assert "单扇门，不得画成双开门" in compiled.positive_prompt


def test_compiler_keeps_actionable_feedback_tail_after_generic_prefix():
    feedback = "整体偏差分析：" + "画面质感需要提升，空间关系需要进一步核查。" * 18
    feedback += "最终纠偏：西南角卫生间被遗漏，北侧楼梯方向反了，必须优先修正。"

    compiled = compile_render3d_floor_prompt(
        iteration=1,
        requirement=ParsedRequirement(style=DesignStyle.MODERN),
        user_requirement_text="",
        direction_stack_text="",
        feedback=feedback,
        floor_analysis=_make_floor_analysis(),
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    assert "西南角卫生间被遗漏" in compiled.positive_prompt
    assert "北侧楼梯方向反了" in compiled.positive_prompt


def test_compiler_controls_length_for_large_floor_analysis_while_preserving_room_names():
    spaces = [
        SpaceAnalysis(
            name=f"房间{i:02d}",
            function="办公",
            position=f"走道第{i}段",
            adjacent_to=[f"房间{i - 1:02d}" if i > 1 else "入口", f"房间{i + 1:02d}" if i < 24 else "出口"],
            furniture=[
                FurnitureItem(name=f"桌{i:02d}", quantity=2, position="靠北墙", orientation="面向南"),
                FurnitureItem(name=f"椅{i:02d}", quantity=4, position="桌旁", orientation="朝向桌面"),
                FurnitureItem(name=f"柜{i:02d}", quantity=1, position="东墙", wall_relation="贴东墙"),
            ],
            doors=[OpeningItem(type="door", position="南侧", connects_to="走道")],
            windows=[OpeningItem(type="window", position="北墙")],
        )
        for i in range(1, 25)
    ]

    compiled = compile_render3d_floor_prompt(
        iteration=0,
        requirement=ParsedRequirement(style=DesignStyle.MODERN, color_tone="暖灰"),
        user_requirement_text="",
        direction_stack_text="",
        feedback=None,
        floor_analysis=FloorPlanAnalysis(spaces=spaces, overall_shape="长条形"),
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    assert len(compiled.positive_prompt) <= 2600
    assert "房间01" in compiled.positive_prompt
    assert "房间24" in compiled.positive_prompt
    assert "桌24x2" in compiled.positive_prompt
    assert "窗@北墙" in compiled.positive_prompt


def test_compiler_emits_first_round_p0_corrections_for_doors_fixtures_and_archive_room():
    analysis = FloorPlanAnalysis(
        spaces=[
            SpaceAnalysis(
                name="左上卫生间",
                function="卫生间",
                position="西北角",
                fixtures=[
                    FurnitureItem(name="蹲厕", quantity=1, position="南侧", wall_relation="贴墙"),
                    FurnitureItem(name="洗手台", quantity=1, position="北侧", wall_relation="贴墙"),
                ],
            ),
            SpaceAnalysis(
                name="左中卫生间",
                function="卫生间",
                position="西侧中部",
                fixtures=[FurnitureItem(name="坐便器", quantity=1, position="南侧", wall_relation="贴墙")],
            ),
            SpaceAnalysis(
                name="卧室",
                function="卧室",
                position="西南角",
                furniture=[
                    FurnitureItem(name="双人床", quantity=1, position="南侧", orientation="床头靠南墙"),
                    FurnitureItem(name="电视", quantity=1, position="西侧靠墙", wall_relation="贴西墙"),
                    FurnitureItem(name="鱼缸", quantity=1, position="东侧靠墙", wall_relation="贴东墙"),
                ],
            ),
            SpaceAnalysis(
                name="资料室",
                function="档案存储",
                position="东南角",
                furniture=[
                    FurnitureItem(name="资料桌", quantity=1, position="北侧"),
                    FurnitureItem(name="固定资料柜", quantity=3, position="东墙和南墙", wall_relation="贴墙"),
                ],
            ),
            SpaceAnalysis(
                name="财务室",
                function="财务办公",
                position="东北角",
                doors=[OpeningItem(type="door/opening", position="北侧", connects_to="东北阳台")],
            ),
            SpaceAnalysis(
                name="品茶区",
                function="茶室",
                position="西北中部",
                doors=[OpeningItem(type="door/opening", position="北侧", connects_to="西北阳台")],
            ),
        ]
    )

    compiled = compile_render3d_floor_prompt(
        iteration=0,
        requirement=ParsedRequirement(style=DesignStyle.MODERN),
        user_requirement_text="",
        direction_stack_text="",
        feedback=None,
        floor_analysis=analysis,
        target_model="gpt-image-2",
        strategy_version=PROMPT_ENGINE_VERSION,
    )

    positive = compiled.positive_prompt
    assert "蹲厕x1" in positive
    assert "坐便器x1" in positive
    assert "蹲厕不得画成马桶/坐便器" in positive
    assert "电视x1" in positive and "西侧靠墙" in positive
    assert "鱼缸x1" in positive and "东侧靠墙" in positive
    assert "资料室禁止新增椅子/凳子" in positive
    assert "可通行阳台门/推拉门，不是普通窗" in positive
    assert "不得两个木门重叠" in positive
    assert "单门洞只画一套门扇" in positive


@pytest.mark.asyncio
async def test_generate_raises_when_llm_output_lacks_required_fields():
    llm = StubLlm(['{"analysis_summary":"missing"}'])
    generator = PromptGenerator(llm)
    requirement = ParsedRequirement(style=DesignStyle.MODERN, color_tone="暖灰")

    with pytest.raises(ValueError, match="缺少 positive_prompt 或 negative_prompt"):
        await generator.generate(
            iteration=0,
            requirement=requirement,
            user_requirement_text="现代简约办公空间",
            target_model="gpt-image-2",
            mode=GenerationMode.RENDER3D,
            floor_analysis=None,
            floor_desc="横向长方形平面，中部走道",
        )
