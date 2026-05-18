import json
import re
from adapters.base import BaseVisionAdapter
from models.schemas import (
    ParsedRequirement,
    NormalizedImage,
    EvaluationResult,
    DimensionScore,
    GenerationMode,
    FloorPlanAnalysis,
)

EVAL_PROMPT_TEMPLATE = """你是一个室内设计 3D 效果图质检专家。请先描述生成图，再按以下5个维度打分（0-10分），并给出简短评语。

设计要求：
- 房间类型：{room_type}
- 设计风格：{style}
- 色调：{color_tone}
- 必须包含：{key_elements}
- 禁止出现：{forbidden_elements}
- 特殊要求：{special_requirements}

评分维度：
1. 空间合理性（权重25%）：3D空间布局是否符合房间逻辑
2. 风格一致性（权重25%）：是否匹配指定风格
3. 视觉质量（权重20%）：清晰度、光影、材质表现
4. 需求符合度（权重20%）：色调、元素是否体现
5. 无明显错误（权重10%）：无畸变、无AI瑕疵

严格按以下 JSON 格式输出：
{{
  "image_description": "先客观描述图中看到了什么",
  "prompt_alignment": "图像与需求的主要符合点和偏差",
  "comparison_summary": "一句话总结最关键的偏差",
  "dimensions": [
    {{"name": "空间合理性", "score": 0-10, "comment": "评语"}},
    {{"name": "风格一致性", "score": 0-10, "comment": "评语"}},
    {{"name": "视觉质量", "score": 0-10, "comment": "评语"}},
    {{"name": "需求符合度", "score": 0-10, "comment": "评语"}},
    {{"name": "无明显错误", "score": 0-10, "comment": "评语"}}
  ],
  "failure_reason": "不通过时的主要原因，通过则为null"
}}"""

WEIGHTS = [0.25, 0.25, 0.20, 0.20, 0.10]

CONSISTENCY_TEMPLATE = """你是室内设计一致性审查专家。请先客观描述生成图，再把生成图与最终提示词、结构化平面图约束做逐项对比，输出可操作反馈。

输入信息：
- 最终生图提示词：
{prompt_text}
- 平面图结构化约束：
{floor_context}
- 用户需求：
  房间类型：{room_type}
  设计风格：{style}
  色调：{color_tone}
  必须包含：{key_elements}
  禁止出现：{forbidden_elements}
  特殊要求：{special_requirements}

重点核查以下高优先级约束：
1. 每个门的位置、连接空间、开向、合页侧是否正确。
2. 柜体是贴墙、离墙、嵌入还是独立摆放，是否与提示词一致。
3. 多个家具之间的相对位置关系是否正确，例如并排、对向、居中、围合、左右前后顺序。
4. 是否遗漏小空间、固定结构、走道、楼梯、电梯、阳台、卫生间设备。
5. 生成图中实际看到的内容与最终提示词相比，具体偏差在哪里。

硬失败规则（P0）：以下问题必须单独写入 hard_failures；只要存在任一硬失败，就不能判通过，平面一致性最高 7 分：
- 房间边界、房间数量、相邻关系明显错误，例如办公室和资料室合并、走道比例/位置错误、裁切区域被擅自补全。
- 家具数量、类型、摆放位置或朝向明显错误，例如资料室没有凳子却多出凳子、床铺位置错误、靠墙电视/鱼缸/固定柜体遗漏。
- 洁具类型错误必须分开说明，例如蹲厕画成马桶、马桶画成蹲厕、淋浴区和台盆混淆。
- 门洞和门扇错误，例如门开向/合页侧明显不符、两个木门异常重叠、双开门/单开门类型错误、门被画成窗户。
- 阳台与室内之间的门窗界面错误，例如财务室到阳台、品茶区到阳台的门被画成普通窗户。
- 结构硬对象遗漏或移动，例如电梯、楼梯、两间卫生间、双阳台、结构柱。

评分必须严格：结构保真比视觉质量重要。即使画面好看，只要 hard_failures 非空，总分最高 7.0，并且 passed 必须为 false。

请严格输出 JSON：
{{
  "image_description": "先客观描述图中实际生成了什么，按空间和家具展开",
  "prompt_alignment": "把生成图与最终提示词、平面图约束逐项对比后的总结",
  "comparison_summary": "一句话总结本轮最关键的结构偏差",
  "dimensions": [
    {{"name": "平面一致性", "score": 0-10, "comment": "空间结构与门窗/家具位置是否一致"}},
    {{"name": "风格一致性", "score": 0-10, "comment": "风格和材质是否匹配"}},
    {{"name": "视觉质量", "score": 0-10, "comment": "清晰度、光影、材质表现"}},
    {{"name": "需求符合度", "score": 0-10, "comment": "色调和元素是否满足"}},
    {{"name": "无明显错误", "score": 0-10, "comment": "是否有明显AI瑕疵"}}
  ],
  "hard_failures": [
    "列出P0硬失败；必须逐条分开，例如：左上卫生间应为蹲厕但被画成马桶；资料室不应有凳子但多出2把；财务室到阳台的门被画成窗户；多处木门重叠"
  ],
  "issues": [
    "列出具体问题，必须尽量引用空间名、位置、门开向、柜体贴墙关系、家具相对位置等细节，例如：左上角卫生间门应向内开但被画成向外开；办公室右侧打印柜应贴北墙但被画成离墙悬空；三张工位应沿东墙并排但被散乱摆放"
  ],
  "failure_reason": "不通过时写核心不一致点，通过则为null"
}}"""


class ImageEvaluator:
    def __init__(self, vision: BaseVisionAdapter, quality_threshold: float = 6.5):
        self.vision = vision
        self.quality_threshold = float(quality_threshold)

    @staticmethod
    def _build_requirement_text(requirement: ParsedRequirement) -> dict:
        return {
            "room_type": requirement.room_type,
            "style": requirement.style,
            "color_tone": requirement.color_tone,
            "key_elements": ", ".join(requirement.key_elements) or "无",
            "forbidden_elements": ", ".join(requirement.forbidden_elements) or "无",
            "special_requirements": requirement.special_requirements or "无",
        }

    async def evaluate(
        self,
        image: NormalizedImage,
        requirement: ParsedRequirement,
        mode: GenerationMode = GenerationMode.RENDER3D,
        floor_desc: str = "",
        floor_analysis: FloorPlanAnalysis | None = None,
        prompt_text: str = "",
        learned_preferences_text: str = "",
    ) -> EvaluationResult:
        req = self._build_requirement_text(requirement)
        if mode in {GenerationMode.RENDER3D, GenerationMode.COLORED_FLOOR_PLAN}:
            floor_context = floor_analysis.to_prompt_context() if floor_analysis else (floor_desc or "无")
            prompt = CONSISTENCY_TEMPLATE.format(prompt_text=prompt_text or "无", floor_context=floor_context, **req)
            if learned_preferences_text:
                prompt += f"\n\n已学习偏好与评判基线：\n{learned_preferences_text}"
        else:
            prompt = EVAL_PROMPT_TEMPLATE.format(**req)
            if learned_preferences_text:
                prompt += f"\n\n已学习偏好与评判基线：\n{learned_preferences_text}"
        raw = await self.vision.analyze(image.image_bytes, prompt)

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            data = json.loads(match.group()) if match else {"dimensions": []}

        dims = [DimensionScore(**d) for d in data.get("dimensions", [])]
        weights = WEIGHTS[: len(dims)]
        hard_failures = [str(item) for item in data.get("hard_failures", []) if str(item or "").strip()]
        total = sum(d.score * w for d, w in zip(dims, weights)) if dims else 0.0
        if hard_failures:
            total = min(total, 7.0)
        threshold = self.quality_threshold
        passed = total >= threshold and not hard_failures

        return EvaluationResult(
            total_score=round(total, 2),
            dimensions=dims,
            passed=passed,
            failure_reason=data.get("failure_reason") if not passed else None,
            hard_failures=hard_failures,
            issues=data.get("issues", []),
            image_description=str(data.get("image_description", "") or ""),
            prompt_alignment=str(data.get("prompt_alignment", "") or ""),
            comparison_summary=str(data.get("comparison_summary", "") or ""),
        )
