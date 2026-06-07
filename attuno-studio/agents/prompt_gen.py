import json
import re
from typing import Optional

from adapters.base import BaseLLMAdapter
from agents import prompt_assets
from agents.prompt_compiler import compile_render3d_floor_prompt
from models.schemas import ParsedRequirement, PromptSet, GenerationMode, FloorPlanAnalysis


PROMPT_ENGINE_VERSION = "llm_prompt_v1"

PROMPT_DETAIL_RETRY_SUFFIX = """

补充要求：
1. 上一次输出如果偏短或偏概括，这一次必须显著补全。
2. 必须保留整体骨架、关键空间、门窗墙体规则、视角、风格和禁止项。
3. 正向提示词要能直接给画图模型使用，但不要为了凑字数重复堆砌。
4. 负向提示词要覆盖结构错误、关系错误和风格跑偏。
5. 必须严格输出 JSON，字段仍然是 positive_prompt、negative_prompt、analysis_summary。
"""


class PromptGenerator:
    def __init__(self, llm: BaseLLMAdapter, strategy_version: str = PROMPT_ENGINE_VERSION):
        self.llm = llm
        self.strategy_version = strategy_version or PROMPT_ENGINE_VERSION

    async def generate(
        self,
        iteration: int,
        requirement: ParsedRequirement,
        user_requirement_text: str = "",
        direction_stack_text: str = "",
        target_model: str = "dalle3",
        feedback: Optional[str] = None,
        floor_desc: str = "",
        mode: GenerationMode = GenerationMode.RENDER3D,
        floor_analysis: Optional[FloorPlanAnalysis] = None,
        prompt_strategy_version: Optional[str] = None,
        learned_preferences_text: str = "",
    ) -> PromptSet:
        strategy_version = prompt_strategy_version or self.strategy_version or PROMPT_ENGINE_VERSION
        if mode == GenerationMode.RENDER3D and floor_analysis:
            return compile_render3d_floor_prompt(
                iteration=iteration,
                requirement=requirement,
                user_requirement_text=user_requirement_text,
                direction_stack_text=direction_stack_text,
                feedback=feedback,
                floor_analysis=floor_analysis,
                target_model=target_model,
                strategy_version=strategy_version,
                learned_preferences_text=learned_preferences_text,
            )

        req_desc = self._build_request_context(
            iteration=iteration,
            requirement=requirement,
            user_requirement_text=user_requirement_text,
            direction_stack_text=direction_stack_text,
            feedback=feedback,
            floor_desc=floor_desc,
            mode=mode,
            floor_analysis=floor_analysis,
            learned_preferences_text=learned_preferences_text,
        )

        messages = [
            {
                "role": "system",
                "content": (
                    prompt_assets.get_prompt_gen_system_3d_cn()
                    if mode == GenerationMode.RENDER3D
                    else prompt_assets.get_prompt_gen_system_standard_cn()
                ),
            },
            {"role": "user", "content": req_desc},
        ]

        raw = await self.llm.chat(messages)
        data = self._extract_json(raw)
        if self._looks_too_short(data, mode):
            retry_messages = messages + [{"role": "user", "content": PROMPT_DETAIL_RETRY_SUFFIX}]
            try:
                retry_raw = await self.llm.chat(retry_messages)
            except Exception:
                retry_raw = ""
            retry_data = self._extract_json(retry_raw) if retry_raw else {}
            if retry_data and self._prompt_score(retry_data) >= self._prompt_score(data):
                data = retry_data

        positive_prompt = str(data.get("positive_prompt", "") or "").strip()
        negative_prompt = str(data.get("negative_prompt", "") or "").strip()
        if not positive_prompt or not negative_prompt:
            raise ValueError("提示词生成结果缺少 positive_prompt 或 negative_prompt")

        return PromptSet(
            positive_prompt=positive_prompt,
            negative_prompt=negative_prompt,
            model_target=target_model,
            prompt_strategy_version=strategy_version,
            prompt_sections=[f"llm_generated | {strategy_version}"],
        )

    @staticmethod
    def _build_request_context(
        *,
        iteration: int,
        requirement: ParsedRequirement,
        user_requirement_text: str,
        direction_stack_text: str,
        feedback: Optional[str],
        floor_desc: str,
        mode: GenerationMode,
        floor_analysis: Optional[FloorPlanAnalysis],
        learned_preferences_text: str,
    ) -> str:
        req_desc = (
            f"当前轮次：第{iteration + 1}轮\n"
            f"用户原始需求（优先级最高，必须尽量原样保留关键约束）：\n{user_requirement_text or '无'}\n\n"
            f"房间类型：{requirement.room_type}\n"
            f"设计风格：{requirement.style}\n"
            f"色调：{requirement.color_tone}\n"
            f"必须包含：{', '.join(requirement.key_elements) or '无'}\n"
            f"禁止出现：{', '.join(requirement.forbidden_elements) or '无'}\n"
            f"特殊要求：{requirement.special_requirements or '无'}"
        )
        if mode == GenerationMode.RENDER3D:
            if iteration == 0:
                req_desc += (
                    "\n\n本轮目标：这是首轮出图，必须把结构保真放在第一优先级。"
                    "先保证外轮廓、墙体、门洞、窗户、楼梯、电梯、阳台位置正确；"
                    "第二优先级是家具数量、种类、朝向和相对位置正确；"
                    "第三优先级才是风格和材质氛围。"
                    "如果某个低影响装饰或细节不确定，宁可省略，也不要用大量不确定措辞稀释主提示词。"
                )
            else:
                req_desc += (
                    "\n\n本轮目标：在上一轮基础上继续纠偏。"
                    "仍然优先结构和家具关系，其次才是风格、材质和画面氛围。"
                )
        if mode == GenerationMode.RENDER3D:
            if floor_analysis:
                req_desc += f"\n\n结构化平面图约束（必须严格遵守）：\n{floor_analysis.to_prompt_context()}"
            elif floor_desc:
                req_desc += f"\n\n平面图空间信息（必须严格遵守）：\n{floor_desc}"
        if direction_stack_text:
            req_desc += f"\n\n设计指令栈（独立约束，必须遵守）：\n{direction_stack_text}"
        if learned_preferences_text and mode != GenerationMode.STANDARD:
            req_desc += f"\n\n已学习的用户/项目偏好（在不破坏结构和硬约束前提下尽量满足）：\n{learned_preferences_text}"
        if feedback:
            req_desc += f"\n\n上一轮评估反馈（请针对性修正）：{feedback}"
        if mode == GenerationMode.STANDARD:
            req_desc += "\n\n要求：这是常规生图模式，不需要严格绑定平面图结构，但需满足风格、元素、主体和画质。"
        return req_desc

    @staticmethod
    def _extract_json(raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            return json.loads(match.group()) if match else {}

    @staticmethod
    def _prompt_score(data: dict) -> int:
        positive = str(data.get("positive_prompt", "") or "")
        negative = str(data.get("negative_prompt", "") or "")
        summary = str(data.get("analysis_summary", "") or "")
        return len(positive) + min(len(negative), 400) + min(len(summary), 300)

    @staticmethod
    def _looks_too_short(data: dict, mode: GenerationMode) -> bool:
        positive = str(data.get("positive_prompt", "") or "").strip()
        negative = str(data.get("negative_prompt", "") or "").strip()
        if mode == GenerationMode.RENDER3D:
            if len(positive) < 80:
                return True
            if len(negative) < 10:
                return True
        else:
            if len(positive) < 100:
                return True
            if len(negative) < 8:
                return True
        return False
