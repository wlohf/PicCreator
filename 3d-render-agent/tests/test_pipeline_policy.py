import pytest

import pipeline as pipeline_module
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
async def test_pipeline_skips_incompatible_fallback_candidate(monkeypatch, tmp_path):
    models_used = _patch_pipeline(monkeypatch, [_make_eval(8.0, True)])
    cfg = _make_config("dall-e-3", ["gpt-image-2"])
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代简约客厅", record_output_dir=str(tmp_path))

    assert result.status == "success"
    assert result.final_model == "gpt-image-2"
    assert result.skipped_models == ["dall-e-3：当前接口不支持平面图/参考图输入约束"]
    assert models_used == ["gpt-image-2"]


@pytest.mark.asyncio
async def test_pipeline_fails_when_all_models_are_incompatible(monkeypatch, tmp_path):
    models_used = _patch_pipeline(monkeypatch, [])
    cfg = _make_config("dall-e-3", ["dall-e-2"])
    pipeline = pipeline_module.PipelineFactory.create(GenerationMode.RENDER3D, cfg)

    result = await pipeline.run(b"floor-plan", None, "现代简约客厅", record_output_dir=str(tmp_path))

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
