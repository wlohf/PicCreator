import pytest
import httpx

import pipeline as pipeline_module
from agents.prompt_compiler import compile_render3d_floor_prompt
from config import AdapterConfig, AppConfig
from models.schemas import (
    DesignStyle,
    DimensionScore,
    EvaluationResult,
    FloorPlanAnalysis,
    GenerationMode,
    NormalizedImage,
    ParsedRequirement,
    PromptSet,
    RoomType,
    SpaceAnalysis,
    FurnitureItem,
)


def _make_config(model: str, fallbacks=None, *, max_iterations: int = 3, stop_after_last: int = 2) -> AppConfig:
    return AppConfig(
        llm=AdapterConfig(provider="openai_chat", api_key="x", model="llm", api_format="openai_chat"),
        image_gen=AdapterConfig(provider="openai_chat", api_key="x", model=model, api_format="openai_chat"),
        vision=AdapterConfig(provider="openai_chat", api_key="x", model="vision", api_format="openai_chat"),
        max_iterations=max_iterations,
        quality_threshold=6.5,
        image_model_fallbacks=fallbacks or [],
        model_switch_after_failures=1,
        stop_after_last_model_failures=stop_after_last,
    )


def _make_requirement() -> ParsedRequirement:
    return ParsedRequirement(room_type=RoomType.LIVING, style=DesignStyle.MODERN, color_tone="暖灰")


def _make_floor_analysis() -> FloorPlanAnalysis:
    return FloorPlanAnalysis(
        space_type="住宅",
        floor_label="一层",
        overall_shape="矩形",
        readable_summary="客厅与走道清晰可见" * 20,
        fixed_structures=[FurnitureItem(name="楼梯", position="中部", orientation="直跑")],
        spaces=[SpaceAnalysis(name="客厅", function="起居", position="中部")],
    )


def _make_eval(score: float, passed: bool, reason: str = "") -> EvaluationResult:
    return EvaluationResult(
        total_score=score,
        dimensions=[
            DimensionScore(name="平面一致性", score=score, comment=""),
            DimensionScore(name="风格一致性", score=score, comment=""),
            DimensionScore(name="视觉质量", score=score, comment=""),
            DimensionScore(name="需求符合度", score=score, comment=""),
            DimensionScore(name="无明显错误", score=score, comment=""),
        ],
        passed=passed,
        failure_reason=reason or (None if passed else "未通过"),
        issues=[],
    )


def _patch_pipeline(monkeypatch, evaluation_results):
    models_used = []

    class DummyRequirementParser:
        def __init__(self, llm):
            self.llm = llm

        async def parse(self, user_text: str, floor_plan_desc: str = "") -> ParsedRequirement:
            return _make_requirement()

    class DummyPromptGenerator:
        def __init__(self, llm, strategy_version=""):
            self.llm = llm
            self.strategy_version = strategy_version

        async def generate(self, **kwargs) -> PromptSet:
            return PromptSet(
                positive_prompt=f"prompt for {kwargs['target_model']}",
                negative_prompt="blurry",
                model_target=kwargs["target_model"],
                prompt_strategy_version=kwargs.get("prompt_strategy_version") or self.strategy_version or "layered_constraints_v1",
                prompt_sections=["生成目标 | P0", "结构主骨架 | P0"],
            )

    class DummyEvaluator:
        def __init__(self, vision, quality_threshold: float = 6.5):
            self.results = list(evaluation_results)

        async def evaluate(self, *args, **kwargs) -> EvaluationResult:
            return self.results.pop(0)

    class DummyFloorAnalyzer:
        def __init__(self, vision):
            self.vision = vision

        async def analyze(self, image_bytes: bytes) -> FloorPlanAnalysis:
            return _make_floor_analysis()

    class DummyImageAdapter:
        def __init__(self, cfg):
            self.cfg = cfg

        async def generate(self, prompt: PromptSet) -> NormalizedImage:
            models_used.append(prompt.model_target)
            return NormalizedImage(
                image_bytes=f"image-{prompt.model_target}".encode("utf-8"),
                source_model=prompt.model_target,
                generation_params={},
            )

    def fake_build_adapter(cfg, role: str):
        if role == "image":
            return DummyImageAdapter(cfg)
        return object()

    monkeypatch.setattr(pipeline_module, "RequirementParser", DummyRequirementParser)
    monkeypatch.setattr(pipeline_module, "PromptGenerator", DummyPromptGenerator)
    monkeypatch.setattr(pipeline_module, "ImageEvaluator", DummyEvaluator)
    monkeypatch.setattr(pipeline_module, "FloorPlanAnalyzer", DummyFloorAnalyzer)
    monkeypatch.setattr(pipeline_module, "build_adapter", fake_build_adapter)
    return models_used


def _patch_pipeline_with_image_failures(monkeypatch, failures_by_model):
    models_used = []

    class DummyRequirementParser:
        def __init__(self, llm):
            self.llm = llm

        async def parse(self, user_text: str, floor_plan_desc: str = "") -> ParsedRequirement:
            return _make_requirement()

    class DummyPromptGenerator:
        def __init__(self, llm, strategy_version=""):
            self.llm = llm
            self.strategy_version = strategy_version

        async def generate(self, **kwargs) -> PromptSet:
            return PromptSet(
                positive_prompt=f"prompt for {kwargs['target_model']}",
                negative_prompt="blurry",
                model_target=kwargs["target_model"],
                prompt_strategy_version=kwargs.get("prompt_strategy_version") or "layered_constraints_v1",
                prompt_sections=["生成目标 | P0"],
            )

    class DummyEvaluator:
        def __init__(self, vision, quality_threshold: float = 6.5):
            pass

        async def evaluate(self, *args, **kwargs) -> EvaluationResult:
            return _make_eval(8.0, True)

    class DummyFloorAnalyzer:
        def __init__(self, vision):
            self.vision = vision

        async def analyze(self, image_bytes: bytes) -> FloorPlanAnalysis:
            return _make_floor_analysis()

    class FailingImageAdapter:
        def __init__(self, cfg):
            self.cfg = cfg

        async def generate(self, prompt: PromptSet) -> NormalizedImage:
            models_used.append(prompt.model_target)
            failure = failures_by_model.get(prompt.model_target)
            if failure:
                raise failure
            return NormalizedImage(
                image_bytes=f"image-{prompt.model_target}".encode("utf-8"),
                source_model=prompt.model_target,
                generation_params={},
            )

    def fake_build_adapter(cfg, role: str):
        if role == "image":
            return FailingImageAdapter(cfg)
        return object()

    monkeypatch.setattr(pipeline_module, "RequirementParser", DummyRequirementParser)
    monkeypatch.setattr(pipeline_module, "PromptGenerator", DummyPromptGenerator)
    monkeypatch.setattr(pipeline_module, "ImageEvaluator", DummyEvaluator)
    monkeypatch.setattr(pipeline_module, "FloorPlanAnalyzer", DummyFloorAnalyzer)
    monkeypatch.setattr(pipeline_module, "build_adapter", fake_build_adapter)
    return models_used


@pytest.mark.asyncio
async def test_standard_pipeline_direct_passthrough_skips_analysis_prompt_and_eval(monkeypatch, tmp_path):
    captured_prompts = []

    class ExplodingRequirementParser:
        def __init__(self, llm):
            pass

        async def parse(self, *_args, **_kwargs):
            raise AssertionError("standard mode must not parse requirements")

    class ExplodingPromptGenerator:
        def __init__(self, llm, strategy_version=""):
            pass

        async def generate(self, **_kwargs):
            raise AssertionError("standard mode must not generate prompts")

    class ExplodingEvaluator:
        def __init__(self, vision, quality_threshold: float = 6.5):
            pass

        async def evaluate(self, *_args, **_kwargs):
            raise AssertionError("standard mode must not run quality evaluation")

    class ExplodingFloorAnalyzer:
        def __init__(self, vision):
            pass

        async def analyze(self, *_args, **_kwargs):
            raise AssertionError("standard mode must not analyze floor plans")

    class CapturingImageAdapter:
        async def generate(self, prompt: PromptSet) -> NormalizedImage:
            captured_prompts.append(prompt)
            return NormalizedImage(
                image_bytes=b"direct-image",
                source_model=prompt.model_target,
                generation_params={},
            )

    def fake_build_adapter(_cfg, role: str):
        if role == "image":
            return CapturingImageAdapter()
        return object()

    monkeypatch.setattr(pipeline_module, "RequirementParser", ExplodingRequirementParser)
    monkeypatch.setattr(pipeline_module, "PromptGenerator", ExplodingPromptGenerator)
    monkeypatch.setattr(pipeline_module, "ImageEvaluator", ExplodingEvaluator)
    monkeypatch.setattr(pipeline_module, "FloorPlanAnalyzer", ExplodingFloorAnalyzer)
    monkeypatch.setattr(pipeline_module, "build_adapter", fake_build_adapter)

    cfg = _make_config("gpt-image-2")
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.STANDARD, cfg)

    result = await pipeline.run(b"floor-plan", None, "raw image prompt", record_output_dir=str(tmp_path))

    assert result.status == "success"
    assert result.mode == GenerationMode.STANDARD.value
    assert result.used_prompt == "raw image prompt"
    assert result.floor_desc == ""
    assert result.evaluation_report is None
    assert result.prompt_strategy_version == "standard_passthrough"
    assert captured_prompts[0].positive_prompt == "raw image prompt"
    assert captured_prompts[0].floor_plan == b"floor-plan"


def test_pipeline_factory_supports_colored_floor_plan_mode():
    cfg = _make_config("gpt-image-2")

    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.COLORED_FLOOR_PLAN, cfg)

    assert isinstance(pipeline, pipeline_module.ColoredFloorPlanPipeline)
    assert pipeline.mode == GenerationMode.COLORED_FLOOR_PLAN


@pytest.mark.asyncio
async def test_colored_floor_plan_prompt_keeps_2d_floor_plan_contract():
    cfg = _make_config("gpt-image-2")
    pipeline = pipeline_module.ColoredFloorPlanPipeline(cfg)

    prompt = await pipeline.make_prompt(
        iteration=0,
        requirement=_make_requirement(),
        user_requirement_text="清晰区分客餐厅和走道",
        direction_stack_text="用克制柔和配色",
        target_model="gpt-image-2",
        feedback=None,
        floor_desc="",
        floor_plan=b"floor-plan",
        reference_image=b"unused-reference",
        manual_prompt=None,
        progress=lambda *_args, **_kwargs: None,
        floor_analysis=_make_floor_analysis(),
        learned_preferences_text="长期偏好：轻盈温馨；避免：红金",
    )

    assert prompt.floor_plan == b"floor-plan"
    assert prompt.reference_image is None
    assert "生成一张彩色平面图" in prompt.positive_prompt
    assert "正交俯视彩色平面图" in prompt.positive_prompt
    assert "不要做3D透视" in prompt.positive_prompt
    assert "不得改户型" in prompt.positive_prompt
    assert "清晰区分客餐厅和走道" in prompt.positive_prompt
    assert "用克制柔和配色" in prompt.positive_prompt
    assert "长期偏好：轻盈温馨；避免：红金" in prompt.positive_prompt
    assert "不要3D效果图" in prompt.negative_prompt
    assert prompt.prompt_sections == ["colored_floor_plan", "floor_plan_consistency", "color_coding"]


@pytest.mark.asyncio
async def test_compiled_render3d_prompt_includes_learned_preferences():
    prompt = compile_render3d_floor_prompt(
        iteration=0,
        requirement=_make_requirement(),
        user_requirement_text="保留结构，做温馨现代客厅",
        direction_stack_text="镜头克制",
        feedback=None,
        floor_analysis=_make_floor_analysis(),
        target_model="gpt-image-2",
        strategy_version="dense_test",
        learned_preferences_text="long_term_preferences: 轻盈温馨\navoid_items: 红金\nevaluation_standards: 结构还原优先",
    )

    assert "已学习偏好" in prompt.positive_prompt
    assert "轻盈温馨" in prompt.positive_prompt
    assert "结构还原优先" in prompt.positive_prompt


@pytest.mark.asyncio
async def test_pipeline_uses_compatible_primary_model(monkeypatch, tmp_path):
    models_used = _patch_pipeline(monkeypatch, [_make_eval(8.0, True)])
    cfg = _make_config("gpt-image-2", ["dall-e-3"])
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代简约客厅", record_output_dir=str(tmp_path))

    assert result.status == "success"
    assert result.final_model == "gpt-image-2"
    assert result.skipped_models == []
    assert result.iteration_count == 1
    assert result.prompt_strategy_version == cfg.prompt_strategy_version
    assert models_used == ["gpt-image-2"]


@pytest.mark.asyncio
async def test_pipeline_passes_floor_plan_to_image_model_when_supported(monkeypatch, tmp_path):
    captured_prompt_sets = []
    models_used = _patch_pipeline(monkeypatch, [_make_eval(8.0, True)])

    class CapturingImageAdapter:
        def __init__(self, cfg):
            self.cfg = cfg

        async def generate(self, prompt: PromptSet) -> NormalizedImage:
            captured_prompt_sets.append(prompt)
            models_used.append(prompt.model_target)
            return NormalizedImage(
                image_bytes=f"image-{prompt.model_target}".encode("utf-8"),
                source_model=prompt.model_target,
                generation_params={},
            )

    def fake_build_adapter(cfg, role: str):
        if role == "image":
            return CapturingImageAdapter(cfg)
        return object()

    monkeypatch.setattr(pipeline_module, "build_adapter", fake_build_adapter)
    cfg = _make_config("gpt-image-2", ["dall-e-3"])
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代简约客厅", record_output_dir=str(tmp_path))

    assert result.status == "success"
    assert result.final_model == "gpt-image-2"
    assert result.skipped_models == []
    assert models_used == ["gpt-image-2"]
    assert captured_prompt_sets[0].floor_plan == b"floor-plan"


@pytest.mark.asyncio
async def test_pipeline_still_requires_image_input_support_for_reference_image(monkeypatch, tmp_path):
    models_used = _patch_pipeline(monkeypatch, [])
    cfg = _make_config("dall-e-3", ["dall-e-2"])
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", b"reference-image", "现代简约客厅", record_output_dir=str(tmp_path))

    assert result.status == "failed"
    assert result.stop_reason == "no_compatible_model"
    assert result.iteration_count == 0
    assert models_used == []


@pytest.mark.asyncio
async def test_pipeline_stops_early_after_last_model_failure_limit(monkeypatch, tmp_path):
    models_used = _patch_pipeline(monkeypatch, [_make_eval(5.0, False, "第一次失败"), _make_eval(5.2, False, "第二次失败")])
    cfg = _make_config("gpt-image-2", [], max_iterations=5, stop_after_last=2)
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代简约客厅", record_output_dir=str(tmp_path))

    assert result.status == "stopped_early"
    assert result.stop_reason == "last_model_failure_limit"
    assert result.iteration_count == 2
    assert len(result.all_images) == 2
    assert result.failure_labels
    assert models_used == ["gpt-image-2", "gpt-image-2"]


@pytest.mark.asyncio
async def test_pipeline_returns_structured_failure_on_image_read_timeout(monkeypatch, tmp_path):
    models_used = _patch_pipeline_with_image_failures(
        monkeypatch,
        {"gpt-image-2": httpx.ReadTimeout("timed out")},
    )
    cfg = _make_config("gpt-image-2", [], max_iterations=3, stop_after_last=1)
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代新中式办公室", record_output_dir=str(tmp_path))

    assert result.status == "failed"
    assert "image_generation_error" in result.stop_reason
    assert "ReadTimeout" in result.stop_reason
    assert result.used_prompt == "prompt for gpt-image-2"
    assert result.iteration_count == 0
    assert models_used == ["gpt-image-2"]


@pytest.mark.asyncio
async def test_pipeline_identifies_floor_analysis_timeout_as_analysis_model(monkeypatch, tmp_path):
    class FailingFloorAnalyzer:
        def __init__(self, vision):
            self.vision = vision

        async def analyze(self, _image_bytes: bytes) -> FloorPlanAnalysis:
            raise httpx.ReadTimeout("timed out")

    def fake_build_adapter(_cfg, _role: str):
        return object()

    monkeypatch.setattr(pipeline_module, "FloorPlanAnalyzer", FailingFloorAnalyzer)
    monkeypatch.setattr(pipeline_module, "build_adapter", fake_build_adapter)

    cfg = _make_config("gpt-image-2", [], max_iterations=3, stop_after_last=1)
    cfg.vision = AdapterConfig(
        provider="openai_chat",
        provider_name="analysis-provider",
        api_key="x",
        model="vision-model",
        api_format="openai_chat",
        base_url="https://analysis.example/v1",
        timeout=180,
    )
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代新中式办公室", record_output_dir=str(tmp_path))

    assert result.status == "failed"
    assert "analysis_or_requirement_error" in result.stop_reason
    assert "平面图结构化分析失败" in result.stop_reason
    assert "vision-model" in result.stop_reason
    assert "https://analysis.example/v1" in result.stop_reason
    assert "平面图图片+文本" in result.stop_reason
    assert "ReadTimeout" in result.stop_reason
    assert result.iteration_count == 0


@pytest.mark.asyncio
async def test_pipeline_switches_fallback_model_after_image_read_timeout(monkeypatch, tmp_path):
    models_used = _patch_pipeline_with_image_failures(
        monkeypatch,
        {"slow-image-model": httpx.ReadTimeout("timed out")},
    )
    cfg = _make_config("slow-image-model", ["gpt-image-2"], max_iterations=3, stop_after_last=1)
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代新中式办公室", record_output_dir=str(tmp_path))

    assert result.status == "success"
    assert result.final_model == "gpt-image-2"
    assert any("slow-image-model" in item and "ReadTimeout" in item for item in result.skipped_models)
    assert models_used == ["slow-image-model", "gpt-image-2"]


@pytest.mark.asyncio
async def test_render3d_pipeline_uses_textual_floor_fallback_when_structured_analysis_is_sparse(monkeypatch):
    cfg = _make_config("gpt-image-2")
    pipeline = pipeline_module.Render3DPipeline(cfg)
    sparse_analysis = FloorPlanAnalysis(
        space_type="未知",
        floor_label="未知",
        overall_shape="",
        readable_summary="",
        spaces=[],
        fixed_structures=[],
    )

    class SparseAnalyzer:
        async def analyze(self, _image_bytes: bytes) -> FloorPlanAnalysis:
            return sparse_analysis

        @staticmethod
        def is_sparse(_analysis: FloorPlanAnalysis) -> bool:
            return True

    async def fake_build_floor_desc(self, floor_plan: bytes, progress):
        assert floor_plan == b"floor-plan"
        return "整体属性：三层混合功能空间。逐空间：左上为阳台，中部为品茶区，右上为财务室。"

    pipeline.floor_analyzer = SparseAnalyzer()
    monkeypatch.setattr(pipeline_module.Render3DPipeline, "build_floor_desc", fake_build_floor_desc)

    analysis = await pipeline.build_floor_analysis(b"floor-plan", lambda *_args, **_kwargs: None)

    assert analysis is not None
    assert "左上为阳台" in analysis.readable_summary
    assert any("自动补充详细文本平面分析" in note for note in analysis.prompt_notes)
