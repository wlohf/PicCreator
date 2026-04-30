import json
import re

from adapters.base import BaseVisionAdapter
from models.schemas import FloorPlanAnalysis
from agents.prompt_assets import FLOOR_ANALYSIS_SYSTEM_PROMPT


DETAIL_RETRY_SUFFIX = """

补充要求：
1. 上一次结果如果过于简略，这一次必须显著展开细节。
2. 尽量穷举所有空间，不要漏掉角落空间、走道、阳台、卫生间、柜体、楼梯、电梯、资料区、财务室、卧室、总经理室、办公室、茶区等。
3. 每个空间都尽量补充家具数量、位置、朝向、门窗、相邻关系和禁止项。
4. 不允许只给出概括性摘要，必须把 JSON 的 spaces、fixed_structures、global constraints 尽量写完整。
"""


class FloorPlanAnalyzer:
    def __init__(self, vision: BaseVisionAdapter):
        self.vision = vision

    async def analyze(self, image_bytes: bytes) -> FloorPlanAnalysis:
        raw = await self.vision.analyze(image_bytes, FLOOR_ANALYSIS_SYSTEM_PROMPT)
        result = self._build_analysis(raw)
        if self._looks_too_sparse(result):
            retry_raw = await self.vision.analyze(image_bytes, FLOOR_ANALYSIS_SYSTEM_PROMPT + DETAIL_RETRY_SUFFIX)
            retry_result = self._build_analysis(retry_raw)
            if self._analysis_score(retry_result) >= self._analysis_score(result):
                result = retry_result
        return result

    def _build_analysis(self, raw: str) -> FloorPlanAnalysis:
        data = self._extract_json(raw)
        if not data:
            return FloorPlanAnalysis(readable_summary=raw.strip())
        try:
            analysis = FloorPlanAnalysis(**data)
            if raw.strip() and not analysis.readable_summary:
                analysis.readable_summary = raw.strip()
            return analysis
        except Exception:
            return FloorPlanAnalysis(readable_summary=raw.strip())

    @staticmethod
    def _analysis_score(analysis: FloorPlanAnalysis) -> int:
        space_score = len(analysis.spaces) * 5
        furniture_score = sum(len(space.furniture) + len(space.fixtures) for space in analysis.spaces)
        opening_score = sum(len(space.doors) + len(space.windows) for space in analysis.spaces)
        structure_score = len(analysis.fixed_structures) * 3
        constraint_score = (
            len(analysis.global_wall_constraints)
            + len(analysis.global_window_constraints)
            + len(analysis.global_door_constraints)
            + len(analysis.hard_constraints)
            + len(analysis.negative_constraints)
        )
        summary_score = min(len(analysis.readable_summary or ""), 600) // 40
        return space_score + furniture_score + opening_score + structure_score + constraint_score + summary_score

    @staticmethod
    def _looks_too_sparse(analysis: FloorPlanAnalysis) -> bool:
        if len(analysis.spaces) < 5:
            return True
        if sum(len(space.furniture) + len(space.fixtures) for space in analysis.spaces) < 8:
            return True
        if len(analysis.fixed_structures) < 1:
            return True
        if len((analysis.readable_summary or "").strip()) < 180:
            return True
        return False

    @staticmethod
    def _extract_json(raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return {}
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            return {}
