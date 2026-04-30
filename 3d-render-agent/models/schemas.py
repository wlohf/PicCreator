from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum


class RoomType(str, Enum):
    LIVING = "客厅"
    BEDROOM = "卧室"
    KITCHEN = "厨房"
    BATHROOM = "卫生间"
    STUDY = "书房"
    OTHER = "其他"


class DesignStyle(str, Enum):
    MODERN = "现代简约"
    NORDIC = "北欧"
    CHINESE = "中式"
    INDUSTRIAL = "工业风"
    LUXURY = "轻奢"
    OTHER = "其他"


class ParsedRequirement(BaseModel):
    room_type: RoomType = RoomType.OTHER
    style: DesignStyle = DesignStyle.MODERN
    color_tone: str = ""
    key_elements: List[str] = Field(default_factory=list)
    forbidden_elements: List[str] = Field(default_factory=list)
    special_requirements: str = ""


class FurnitureItem(BaseModel):
    name: str = ""
    quantity: Optional[int] = None
    position: str = ""
    orientation: str = ""
    wall_relation: str = ""
    relative_position: str = ""
    constraints: List[str] = Field(default_factory=list)


class OpeningItem(BaseModel):
    type: str = ""  # door | window | opening | balcony_edge
    position: str = ""
    connects_to: str = ""
    swing_direction: str = ""
    hinge_side: str = ""
    constraints: List[str] = Field(default_factory=list)


class SpaceAnalysis(BaseModel):
    id: str = ""
    name: str = ""
    function: str = ""
    position: str = ""
    adjacent_to: List[str] = Field(default_factory=list)
    furniture: List[FurnitureItem] = Field(default_factory=list)
    fixtures: List[FurnitureItem] = Field(default_factory=list)
    doors: List[OpeningItem] = Field(default_factory=list)
    windows: List[OpeningItem] = Field(default_factory=list)
    wall_constraints: List[str] = Field(default_factory=list)
    hard_constraints: List[str] = Field(default_factory=list)
    negative_constraints: List[str] = Field(default_factory=list)


class FloorPlanAnalysis(BaseModel):
    space_type: str = ""
    floor_label: str = ""
    overall_shape: str = ""
    dimensions: str = ""
    view_recommendation: str = "axonometric dollhouse cutaway, roof removed"
    circulation: str = ""
    core_summary: str = ""
    spaces: List[SpaceAnalysis] = Field(default_factory=list)
    fixed_structures: List[FurnitureItem] = Field(default_factory=list)
    global_wall_constraints: List[str] = Field(default_factory=list)
    global_window_constraints: List[str] = Field(default_factory=list)
    global_door_constraints: List[str] = Field(default_factory=list)
    hard_constraints: List[str] = Field(default_factory=list)
    negative_constraints: List[str] = Field(default_factory=list)
    prompt_notes: List[str] = Field(default_factory=list)
    readable_summary: str = ""
    final_prompt: str = ""
    negative_prompt: str = ""

    def to_prompt_context(self) -> str:
        lines = [
            "【结构化平面图分析】",
            f"- 空间类型：{self.space_type or '未知'}",
            f"- 楼层/层级：{self.floor_label or '未知'}",
            f"- 外轮廓/尺寸：{self.overall_shape or '未知'} {self.dimensions or ''}".strip(),
            f"- 推荐视角：{self.view_recommendation}",
            f"- 动线：{self.circulation or '未知'}",
            f"- 核心摘要：{self.core_summary or '无'}",
        ]

        if self.spaces:
            lines.append("\n【逐空间约束】")
            for idx, space in enumerate(self.spaces, 1):
                lines.append(f"{idx}. 空间名称：{space.name or space.id}")
                lines.append(f"   - 功能：{space.function or '未识别'}")
                lines.append(f"   - 位置：{space.position or '未识别'}")
                if space.adjacent_to:
                    lines.append(f"   - 相邻关系：{', '.join(space.adjacent_to)}")
                else:
                    lines.append("   - 相邻关系：未识别")
                for item in space.furniture + space.fixtures:
                    qty = f" x{item.quantity}" if item.quantity is not None else ""
                    detail = f"{item.name}{qty}，位置：{item.position or '未识别'}，朝向：{item.orientation or '未识别'}"
                    if item.wall_relation:
                        detail += f"，墙体关系：{item.wall_relation}"
                    if item.relative_position:
                        detail += f"，相对关系：{item.relative_position}"
                    if item.constraints:
                        detail += f"，约束：{'; '.join(item.constraints)}"
                    lines.append(f"   - 家具/设备：{detail}")
                if not (space.furniture or space.fixtures):
                    lines.append("   - 家具/设备：未识别")
                for opening in space.doors + space.windows:
                    detail = f"{opening.type}，位置：{opening.position or '未识别'}"
                    if opening.connects_to:
                        detail += f"，连接：{opening.connects_to}"
                    if opening.swing_direction:
                        detail += f"，开向：{opening.swing_direction}"
                    if opening.hinge_side:
                        detail += f"，合页侧：{opening.hinge_side}"
                    if opening.constraints:
                        detail += f"，约束：{'; '.join(opening.constraints)}"
                    lines.append(f"   - 门窗/开口：{detail}")
                if not (space.doors or space.windows):
                    lines.append("   - 门窗/开口：未识别")
                for constraint in space.hard_constraints + space.wall_constraints:
                    lines.append(f"   - 硬约束：{constraint}")
                if not (space.hard_constraints or space.wall_constraints):
                    lines.append("   - 硬约束：未识别")
                for constraint in space.negative_constraints:
                    lines.append(f"   - 禁止：{constraint}")
                if not space.negative_constraints:
                    lines.append("   - 禁止：未识别")
        else:
            lines.append("\n【逐空间约束】\n- 未识别到明确空间，请结合 readable_summary 谨慎使用。")

        for title, values in [
            ("固定结构", self.fixed_structures),
            ("全局墙体约束", self.global_wall_constraints),
            ("全局窗户约束", self.global_window_constraints),
            ("全局门洞约束", self.global_door_constraints),
            ("全局硬约束", self.hard_constraints),
            ("全局禁止项", self.negative_constraints),
            ("绘图提示重点", self.prompt_notes),
        ]:
            if not values:
                continue
            lines.append(f"\n【{title}】")
            if title == "固定结构":
                for item in values:
                    lines.append(f"- {item.name}：{item.position} {item.orientation}".strip())
            else:
                for value in values:
                    lines.append(f"- {value}")

        lines.append("\n【提示词编译要求】")
        lines.append("- 生成中文提示词时必须逐空间展开，不要概括压缩。")
        lines.append("- 家具、设备、门窗、楼梯、电梯、阳台、柜体要尽可能逐项保留。")
        lines.append("- 视角、风格、混合功能属性、强限制语句必须明确写入最终提示词。")

        if self.readable_summary:
            lines.append(f"\n【中文分析摘要】\n{self.readable_summary}")
        return "\n".join(lines)


class GenerationMode(str, Enum):
    STANDARD = "standard"
    RENDER3D = "render3d"


class PromptSet(BaseModel):
    positive_prompt: str
    negative_prompt: str
    model_target: str  # "dalle3" | "imagen"
    floor_plan: Optional[bytes] = None  # 平面图原图，传给画图模型
    reference_image: Optional[bytes] = None  # 参考图（图生图）
    prompt_strategy_version: str = ""
    prompt_sections: List[str] = Field(default_factory=list)

    def requires_image_inputs(self) -> bool:
        return bool(self.floor_plan or self.reference_image)

    class Config:
        arbitrary_types_allowed = True


class NormalizedImage(BaseModel):
    image_bytes: bytes
    source_model: str
    generation_params: dict = Field(default_factory=dict)
    iteration: int = 0

    class Config:
        arbitrary_types_allowed = True


class DimensionScore(BaseModel):
    name: str
    score: float  # 0-10
    comment: str = ""


class EvaluationResult(BaseModel):
    total_score: float
    dimensions: List[DimensionScore] = Field(default_factory=list)
    passed: bool
    failure_reason: Optional[str] = None
    issues: List[str] = Field(default_factory=list)
    image_description: str = ""
    prompt_alignment: str = ""
    comparison_summary: str = ""


class RoutingAction(str, Enum):
    RETRY_SAME = "retry_same"
    ADJUST_PROMPT = "adjust_prompt"
    SWITCH_MODEL = "switch_model"
    TERMINATE = "terminate"


class RoutingDecision(BaseModel):
    action: RoutingAction
    feedback: str = ""
    suggested_model: Optional[str] = None


class FailureLabel(str, Enum):
    LAYOUT_MISMATCH = "layout_mismatch"
    MISSING_SMALL_SPACES = "missing_small_spaces"
    STYLE_DRIFT = "style_drift"
    DOOR_WINDOW_ERROR = "door_window_error"
    FURNITURE_RELATION_ERROR = "furniture_relation_error"
    EXTRA_ROOM_OR_EXTRA_STRUCTURE = "extra_room_or_extra_structure"
    VIEW_ERROR = "view_error"
    LOW_VISUAL_QUALITY = "low_visual_quality"
    GOOD_STRUCTURE_BAD_STYLE = "good_structure_but_bad_style"
    GOOD_STYLE_BAD_STRUCTURE = "good_style_but_bad_structure"
    UNCATEGORIZED = "uncategorized"


class PipelineResult(BaseModel):
    final_image: Optional[bytes] = None
    all_images: List[bytes] = Field(default_factory=list)   # 每轮迭代的图片
    all_scores: List[float] = Field(default_factory=list)   # 每轮迭代的评分
    quality_score: float = 0.0
    iteration_count: int = 0
    used_prompt: str = ""
    used_negative_prompt: str = ""
    prompt_history: List[str] = Field(default_factory=list)
    floor_desc: str = ""          # 平面图解析结果，显示给用户
    evaluation_report: Optional[EvaluationResult] = None
    mode: str = GenerationMode.RENDER3D.value
    status: str  # "success" | "failed" | "stopped_early" | "max_iterations_reached"
    stop_reason: str = ""
    final_model: str = ""
    skipped_models: List[str] = Field(default_factory=list)
    sample_id: str = ""
    prompt_strategy_version: str = ""
    prompt_sections: List[str] = Field(default_factory=list)
    failure_labels: List[str] = Field(default_factory=list)
    final_image_path: str = ""
    iteration_image_paths: List[str] = Field(default_factory=list)
    run_record_path: str = ""

    class Config:
        arbitrary_types_allowed = True


class ValidationArtifactRecord(BaseModel):
    created_at: str = ""
    sample_id: str = ""
    mode: str = GenerationMode.RENDER3D.value
    prompt_strategy_version: str = ""
    prompt_sections: List[str] = Field(default_factory=list)
    user_requirement: str = ""
    floor_desc: str = ""
    used_prompt: str = ""
    used_negative_prompt: str = ""
    prompt_history: List[str] = Field(default_factory=list)
    status: str = ""
    stop_reason: str = ""
    quality_score: float = 0.0
    final_model: str = ""
    all_scores: List[float] = Field(default_factory=list)
    failure_labels: List[str] = Field(default_factory=list)
    final_image_path: str = ""
    iteration_image_paths: List[str] = Field(default_factory=list)
    skipped_models: List[str] = Field(default_factory=list)
    evaluation_report: Optional[EvaluationResult] = None
    run_record_path: str = ""


class BenchmarkSample(BaseModel):
    sample_id: str
    mode: str = GenerationMode.RENDER3D.value
    floor_plan_path: str = ""
    reference_image_path: str = ""
    user_requirement: str
    expected_style: str = ""
    expected_spaces: List[str] = Field(default_factory=list)
    critical_constraints: List[str] = Field(default_factory=list)
    expected_view: str = ""
    notes: str = ""


class BenchmarkResultRecord(BaseModel):
    sample_id: str
    prompt_strategy_version: str
    mode: str
    quality_score: float = 0.0
    status: str = ""
    stop_reason: str = ""
    final_model: str = ""
    failure_labels: List[str] = Field(default_factory=list)
    run_record_path: str = ""
    final_image_path: str = ""
    expected_style: str = ""
    expected_spaces: List[str] = Field(default_factory=list)
    critical_constraints: List[str] = Field(default_factory=list)
    expected_view: str = ""
    notes: str = ""
    manual_score: Optional[float] = None
    manual_notes: str = ""
