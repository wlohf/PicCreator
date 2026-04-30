import pytest

from agents.evaluator import ImageEvaluator
from models.schemas import DesignStyle, GenerationMode, NormalizedImage, ParsedRequirement, RoomType


class DummyVision:
    def __init__(self, response: str):
        self.response = response

    async def analyze(self, image_bytes: bytes, prompt: str) -> str:
        return self.response


def _make_requirement() -> ParsedRequirement:
    return ParsedRequirement(room_type=RoomType.LIVING, style=DesignStyle.MODERN, color_tone="暖灰")


def _make_image() -> NormalizedImage:
    return NormalizedImage(image_bytes=b"image", source_model="gpt-image-2")


@pytest.mark.asyncio
async def test_evaluator_uses_injected_quality_threshold():
    vision = DummyVision(
        '{"dimensions":[{"name":"空间合理性","score":7.0,"comment":""},{"name":"风格一致性","score":7.0,"comment":""},{"name":"视觉质量","score":7.0,"comment":""},{"name":"需求符合度","score":7.0,"comment":""},{"name":"无明显错误","score":7.0,"comment":""}],"failure_reason":"阈值不足"}'
    )
    evaluator = ImageEvaluator(vision, quality_threshold=7.5)

    result = await evaluator.evaluate(_make_image(), _make_requirement(), mode=GenerationMode.STANDARD)

    assert result.total_score == 7.0
    assert result.passed is False
    assert result.failure_reason == "阈值不足"


@pytest.mark.asyncio
async def test_evaluator_handles_json_fallback_extraction():
    vision = DummyVision(
        'prefix {"dimensions":[{"name":"空间合理性","score":8.0,"comment":""},{"name":"风格一致性","score":8.0,"comment":""},{"name":"视觉质量","score":8.0,"comment":""},{"name":"需求符合度","score":8.0,"comment":""},{"name":"无明显错误","score":8.0,"comment":""}],"failure_reason":null,"comparison_summary":"结构正确"} suffix'
    )
    evaluator = ImageEvaluator(vision, quality_threshold=6.5)

    result = await evaluator.evaluate(_make_image(), _make_requirement(), mode=GenerationMode.STANDARD)

    assert result.total_score == 8.0
    assert result.passed is True
    assert result.comparison_summary == "结构正确"
