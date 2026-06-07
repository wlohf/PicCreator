import json
import logging
import re

from adapters.base import BaseVisionAdapter
from models.schemas import FloorPlanAnalysis
from agents import prompt_assets


DETAIL_RETRY_SUFFIX = """

补充要求：
1. 上一次结果如果过于简略，这一次必须显著展开细节。
2. 尽量穷举所有空间，不要漏掉角落空间、走道、阳台、卫生间、柜体、楼梯、电梯、资料区、财务室、卧室、总经理室、办公室、茶区等。
3. 每个空间都尽量补充家具数量、位置、朝向、门窗、相邻关系和禁止项。
4. 不允许只给出概括性摘要，必须把 JSON 的 spaces、fixed_structures、global constraints 尽量写完整。
"""

logger = logging.getLogger(__name__)


class FloorPlanAnalyzer:
    def __init__(self, vision: BaseVisionAdapter):
        self.vision = vision

    async def analyze(self, image_bytes: bytes) -> FloorPlanAnalysis:
        system_prompt = prompt_assets.get_floor_analysis_system_prompt()
        raw = await self.vision.analyze(image_bytes, system_prompt)
        result = self._build_analysis(raw)
        if self.is_sparse(result):
            try:
                retry_raw = await self.vision.analyze(image_bytes, system_prompt + DETAIL_RETRY_SUFFIX)
                retry_result = self._build_analysis(retry_raw)
                if self._analysis_score(retry_result) >= self._analysis_score(result):
                    result = retry_result
            except Exception as exc:
                logger.warning("Floor analysis detail retry failed; using first pass result: %s", exc)
                result.prompt_notes.append(
                    f"详细平面解析重试失败，已使用第一轮解析继续生成；错误类型：{type(exc).__name__}"
                )
        return result

    def _build_analysis(self, raw: str) -> FloorPlanAnalysis:
        data = self._extract_json(raw)
        if not data:
            return FloorPlanAnalysis(readable_summary=raw.strip())
        try:
            data = self._normalize_analysis_data(data)
            analysis = FloorPlanAnalysis(**data)
            if raw.strip() and not analysis.readable_summary:
                analysis.readable_summary = raw.strip()
            return analysis
        except Exception:
            return FloorPlanAnalysis(readable_summary=raw.strip())

    @classmethod
    def _normalize_analysis_data(cls, data: dict) -> dict:
        normalized = dict(data)
        normalized["spaces"] = [cls._normalize_space(space) for space in normalized.get("spaces") or [] if isinstance(space, dict)]
        normalized["fixed_structures"] = [
            cls._normalize_item(item) for item in normalized.get("fixed_structures") or []
        ]
        for key in (
            "global_wall_constraints",
            "global_window_constraints",
            "global_door_constraints",
            "hard_constraints",
            "negative_constraints",
            "prompt_notes",
        ):
            normalized[key] = cls._normalize_text_list(normalized.get(key))
        return normalized

    @classmethod
    def _normalize_space(cls, space: dict) -> dict:
        normalized = dict(space)
        normalized["adjacent_to"] = cls._normalize_text_list(normalized.get("adjacent_to"))
        normalized["furniture"] = [cls._normalize_item(item) for item in normalized.get("furniture") or []]
        normalized["fixtures"] = [cls._normalize_item(item) for item in normalized.get("fixtures") or []]
        normalized["doors"] = [cls._normalize_opening(item, "door") for item in normalized.get("doors") or []]
        normalized["windows"] = [cls._normalize_opening(item, "window") for item in normalized.get("windows") or []]
        normalized["wall_constraints"] = cls._normalize_text_list(normalized.get("wall_constraints"))
        normalized["hard_constraints"] = cls._normalize_text_list(normalized.get("hard_constraints"))
        normalized["negative_constraints"] = cls._normalize_text_list(normalized.get("negative_constraints"))
        return normalized

    @staticmethod
    def _normalize_item(item) -> dict:
        if isinstance(item, str):
            return {"name": item}
        if isinstance(item, dict):
            normalized = dict(item)
            constraints = normalized.get("constraints")
            if constraints is not None:
                normalized["constraints"] = FloorPlanAnalyzer._normalize_text_list(constraints)
            return normalized
        return {"name": str(item)}

    @staticmethod
    def _normalize_opening(item, opening_type: str) -> dict:
        if isinstance(item, str):
            return {"type": opening_type, "position": item}
        if isinstance(item, dict):
            normalized = dict(item)
            normalized.setdefault("type", opening_type)
            constraints = normalized.get("constraints")
            if constraints is not None:
                normalized["constraints"] = FloorPlanAnalyzer._normalize_text_list(constraints)
            return normalized
        return {"type": opening_type, "position": str(item)}

    @staticmethod
    def _normalize_text_list(value) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [str(item) for item in value if str(item or "").strip()]
        return [str(value)]

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

    @classmethod
    def is_sparse(cls, analysis: FloorPlanAnalysis) -> bool:
        return cls._looks_too_sparse(analysis)

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
