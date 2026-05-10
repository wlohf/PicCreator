import pytest

from agents.floor_analyzer import FloorPlanAnalyzer
from agents import prompt_assets


class TimeoutOnRetryVision:
    def __init__(self):
        self.calls = 0

    async def analyze(self, _image_bytes: bytes, _prompt: str) -> str:
        self.calls += 1
        if self.calls == 2:
            raise TimeoutError("detail retry timed out")
        return '{"readable_summary":"简略摘要"}'


def test_floor_analyzer_normalizes_string_fixtures_in_model_json():
    raw = """
    {
      "space_type": "混合",
      "floor_label": "三层",
      "overall_shape": "横向长方形",
      "spaces": [
        {
          "id": "space_1",
          "name": "品茶区",
          "function": "茶室",
          "position": "左中部",
          "adjacent_to": ["走道"],
          "furniture": [
            {
              "name": "茶椅",
              "quantity": 8,
              "position": "茶桌左右两侧",
              "orientation": "朝向茶桌中心",
              "relative_position": "围绕茶桌"
            }
          ],
          "fixtures": ["墙面挂画"],
          "doors": [{"type": "door", "position": "右侧", "connects_to": "走道"}],
          "windows": [{"type": "window", "position": "北侧外墙", "connects_to": "外部"}]
        }
      ],
      "fixed_structures": ["南侧主要入口门"],
      "readable_summary": "品茶区有八把椅子和墙面挂画。"
    }
    """

    analysis = FloorPlanAnalyzer(object())._build_analysis(raw)

    assert analysis.space_type == "混合"
    assert len(analysis.spaces) == 1
    assert analysis.spaces[0].fixtures[0].name == "墙面挂画"
    assert analysis.fixed_structures[0].name == "南侧主要入口门"


def test_floor_analysis_prompt_demands_precise_p0_symbol_recognition():
    prompt = prompt_assets.FLOOR_ANALYSIS_SYSTEM_PROMPT

    assert "蹲厕" in prompt
    assert "坐便器" in prompt
    assert "不能统一写成坐便器" in prompt
    assert "电视" in prompt
    assert "资料室" in prompt
    assert "不要凭空补椅子" in prompt
    assert "阳台门" in prompt
    assert "不是普通窗" in prompt
    assert "两个木门重叠" in prompt


@pytest.mark.asyncio
async def test_floor_analyzer_keeps_first_result_when_detail_retry_times_out():
    vision = TimeoutOnRetryVision()
    analysis = await FloorPlanAnalyzer(vision).analyze(b"floor-plan")

    assert vision.calls == 2
    assert analysis.readable_summary == "简略摘要"
    assert any("详细平面解析重试失败" in note for note in analysis.prompt_notes)
