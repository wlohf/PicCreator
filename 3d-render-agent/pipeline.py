import os
import re
from datetime import datetime
from typing import Optional, Callable

from adapters import build_adapter
from agents import RequirementParser, PromptGenerator, ImageEvaluator, ErrorRouter, FloorPlanAnalyzer
from config import AppConfig, clone_adapter_config, adapter_supports_image_inputs
from models.schemas import (
    PipelineResult,
    RoutingAction,
    NormalizedImage,
    GenerationMode,
    PromptSet,
    FloorPlanAnalysis,
    EvaluationResult,
    FailureLabel,
    ValidationArtifactRecord,
)


class BasePipeline:
    def __init__(self, config: AppConfig):
        self.config = config
        llm = build_adapter(config.llm, "llm")
        vision = build_adapter(config.vision, "vision")
        self.image_base_config = config.image_gen
        self.parser = RequirementParser(llm)
        self.prompt_gen = PromptGenerator(llm, config.prompt_strategy_version)
        self.evaluator = ImageEvaluator(vision, config.quality_threshold)
        self.floor_analyzer = FloorPlanAnalyzer(vision)
        self.router = ErrorRouter()

    @property
    def mode(self) -> GenerationMode:
        raise NotImplementedError

    async def build_floor_desc(
        self,
        floor_plan: Optional[bytes],
        progress: Callable[[str, str], None],
    ) -> str:
        return ""

    async def build_floor_analysis(
        self,
        floor_plan: Optional[bytes],
        progress: Callable[[str, str], None],
    ) -> Optional[FloorPlanAnalysis]:
        return None

    async def make_prompt(
        self,
        iteration: int,
        requirement,
        user_requirement_text: str,
        target_model: str,
        feedback: Optional[str],
        floor_desc: str,
        floor_plan: Optional[bytes],
        reference_image: Optional[bytes],
        manual_prompt: Optional[str],
        progress: Callable[[str, str], None],
        floor_analysis: Optional[FloorPlanAnalysis] = None,
    ) -> PromptSet:
        if manual_prompt and iteration == 0:
            progress("生成图像（第1轮）", manual_prompt[:80])
            return PromptSet(
                positive_prompt=manual_prompt,
                negative_prompt="",
                model_target=target_model,
                floor_plan=floor_plan,
                reference_image=reference_image,
                prompt_strategy_version="manual_prompt",
                prompt_sections=["manual_prompt"],
            )

        progress(f"生成提示词（第{iteration + 1}轮）")
        prompt_set = await self.prompt_gen.generate(
            requirement=requirement,
            user_requirement_text=user_requirement_text,
            target_model=target_model,
            feedback=feedback,
            floor_desc=floor_desc,
            mode=self.mode,
            floor_analysis=floor_analysis,
            prompt_strategy_version=self.config.prompt_strategy_version,
        )
        prompt_set.floor_plan = floor_plan
        prompt_set.reference_image = reference_image
        return prompt_set

    async def evaluate(
        self,
        image: NormalizedImage,
        requirement,
        floor_desc: str,
        floor_analysis: Optional[FloorPlanAnalysis] = None,
        prompt_text: str = "",
    ):
        return await self.evaluator.evaluate(
            image,
            requirement,
            mode=self.mode,
            floor_desc=floor_desc,
            floor_analysis=floor_analysis,
            prompt_text=prompt_text,
        )

    def _candidate_image_config(self, model_name: str):
        return clone_adapter_config(self.image_base_config, model=model_name)

    @staticmethod
    def _is_model_compatible_with_inputs(requires_image_inputs: bool, adapter_cfg) -> tuple[bool, str]:
        if requires_image_inputs and not adapter_supports_image_inputs(adapter_cfg, adapter_cfg.model):
            return False, "当前接口不支持平面图/参考图输入约束"
        return True, ""

    @staticmethod
    def _slug(text: str) -> str:
        clean = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(text or "").strip())
        return clean.strip("_") or "run"

    @classmethod
    def _output_dir(cls, record_output_dir: Optional[str] = None) -> str:
        out_dir = record_output_dir or os.path.join(os.path.dirname(__file__), "outputs")
        os.makedirs(out_dir, exist_ok=True)
        return out_dir

    @classmethod
    def _save_output_image(cls, image_bytes: bytes, iteration: int, record_output_dir: Optional[str] = None) -> str:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir = cls._output_dir(record_output_dir)
        out_path = os.path.join(out_dir, f"{ts}_iter{iteration}.png")
        with open(out_path, "wb") as f:
            f.write(image_bytes)
        return out_path

    @classmethod
    def _persist_run_record(
        cls,
        *,
        result: PipelineResult,
        user_requirement: str,
        floor_desc: str,
        record_output_dir: Optional[str] = None,
    ) -> str:
        out_dir = cls._output_dir(record_output_dir)
        prefix = cls._slug(result.sample_id or result.final_model or "run")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(out_dir, f"{ts}_{prefix}_record.json")
        record = ValidationArtifactRecord(
            created_at=datetime.now().isoformat(timespec="seconds"),
            sample_id=result.sample_id,
            mode=result.mode,
            prompt_strategy_version=result.prompt_strategy_version,
            prompt_sections=result.prompt_sections,
            user_requirement=user_requirement,
            floor_desc=floor_desc,
            used_prompt=result.used_prompt,
            used_negative_prompt=result.used_negative_prompt,
            prompt_history=result.prompt_history,
            status=result.status,
            stop_reason=result.stop_reason,
            quality_score=result.quality_score,
            final_model=result.final_model,
            all_scores=result.all_scores,
            failure_labels=result.failure_labels,
            final_image_path=result.final_image_path,
            iteration_image_paths=result.iteration_image_paths,
            skipped_models=result.skipped_models,
            evaluation_report=result.evaluation_report,
            run_record_path=out_path,
        )
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(record.model_dump_json(indent=2, exclude_none=True))
        return out_path

    @staticmethod
    def _infer_failure_labels(evaluation: Optional[EvaluationResult]) -> list[str]:
        if not evaluation or evaluation.passed:
            return []
        texts = [
            evaluation.failure_reason or "",
            evaluation.comparison_summary or "",
            evaluation.prompt_alignment or "",
            evaluation.image_description or "",
            *list(evaluation.issues or []),
        ]
        haystack = " ".join(texts)
        rules = [
            (("布局", "平面", "结构", "房间边界", "空间组织"), FailureLabel.LAYOUT_MISMATCH.value),
            (("卫生间", "阳台", "楼梯", "电梯", "走道", "储物", "缺失", "遗漏"), FailureLabel.MISSING_SMALL_SPACES.value),
            (("门", "窗", "门洞", "窗洞", "开向", "合页"), FailureLabel.DOOR_WINDOW_ERROR.value),
            (("柜体", "家具", "工位", "并排", "对向", "相对位置", "朝向"), FailureLabel.FURNITURE_RELATION_ERROR.value),
            (("风格", "材质", "色调", "氛围"), FailureLabel.STYLE_DRIFT.value),
            (("额外", "多出", "新增"), FailureLabel.EXTRA_ROOM_OR_EXTRA_STRUCTURE.value),
            (("视角", "鸟瞰", "俯视", "isometric", "dollhouse"), FailureLabel.VIEW_ERROR.value),
            (("模糊", "畸变", "低清晰度", "AI瑕疵", "画质", "光影"), FailureLabel.LOW_VISUAL_QUALITY.value),
        ]
        labels = []
        for keywords, label in rules:
            if any(keyword in haystack for keyword in keywords):
                labels.append(label)
        if FailureLabel.LAYOUT_MISMATCH.value in labels and FailureLabel.STYLE_DRIFT.value in labels:
            labels.append(FailureLabel.GOOD_STRUCTURE_BAD_STYLE.value)
        if FailureLabel.STYLE_DRIFT.value not in labels and FailureLabel.LAYOUT_MISMATCH.value in labels:
            labels.append(FailureLabel.GOOD_STYLE_BAD_STRUCTURE.value)
        deduped = []
        for label in labels:
            if label not in deduped:
                deduped.append(label)
        return deduped or [FailureLabel.UNCATEGORIZED.value]

    @staticmethod
    def _build_result(
        *,
        best_result: Optional[NormalizedImage],
        best_eval: Optional[EvaluationResult],
        all_images,
        all_scores,
        iteration_count: int,
        used_prompt: str,
        used_negative_prompt: str,
        prompt_history,
        floor_desc: str,
        mode: GenerationMode,
        status: str,
        stop_reason: str,
        final_model: str,
        skipped_models,
        sample_id: str,
        prompt_strategy_version: str,
        prompt_sections,
        failure_labels,
        final_image_path: str,
        iteration_image_paths,
        run_record_path: str = "",
    ) -> PipelineResult:
        return PipelineResult(
            final_image=best_result.image_bytes if best_result else None,
            all_images=all_images,
            all_scores=all_scores,
            quality_score=best_eval.total_score if best_eval else 0.0,
            iteration_count=iteration_count,
            used_prompt=used_prompt,
            used_negative_prompt=used_negative_prompt,
            prompt_history=prompt_history,
            floor_desc=floor_desc,
            evaluation_report=best_eval,
            mode=mode.value,
            status=status,
            stop_reason=stop_reason,
            final_model=final_model,
            skipped_models=skipped_models,
            sample_id=sample_id,
            prompt_strategy_version=prompt_strategy_version,
            prompt_sections=list(prompt_sections or []),
            failure_labels=list(failure_labels or []),
            final_image_path=final_image_path,
            iteration_image_paths=list(iteration_image_paths or []),
            run_record_path=run_record_path,
        )

    async def run(
        self,
        floor_plan: Optional[bytes],
        reference_image: Optional[bytes],
        user_requirement: str,
        on_progress=None,
        on_event=None,
        manual_prompt: Optional[str] = None,
        sample_id: str = "",
        record_output_dir: Optional[str] = None,
    ) -> PipelineResult:
        cfg = self.config

        def progress(step, detail=""):
            if on_progress:
                on_progress(step, detail)

        def finalize(result: PipelineResult) -> PipelineResult:
            result.run_record_path = self._persist_run_record(
                result=result,
                user_requirement=user_requirement,
                floor_desc=floor_desc,
                record_output_dir=record_output_dir,
            )
            return result

        model_queue = [cfg.image_gen.model] + list(cfg.image_model_fallbacks or [])
        model_idx = 0
        target_model = model_queue[model_idx]
        requires_image_inputs = bool(floor_plan or reference_image)
        feedback: Optional[str] = None
        best_result: Optional[NormalizedImage] = None
        best_eval: Optional[EvaluationResult] = None
        all_images = []
        all_scores = []
        prompt_history = []
        floor_desc = ""
        floor_analysis: Optional[FloorPlanAnalysis] = None
        requirement = None
        last_prompt = ""
        last_negative_prompt = ""
        last_prompt_strategy_version = ""
        last_prompt_sections = []
        last_failure_labels = []
        failed_with_current_model = 0
        skipped_models = []
        actual_iterations = 0
        image_paths = []
        best_image_path = ""
        switch_after = max(1, int(getattr(cfg, "model_switch_after_failures", 2)))
        stop_after_last = max(1, int(getattr(cfg, "stop_after_last_model_failures", 2)))

        while actual_iterations < cfg.max_iterations:
            candidate_cfg = self._candidate_image_config(target_model)
            compatible, incompatible_reason = self._is_model_compatible_with_inputs(requires_image_inputs, candidate_cfg)
            if not compatible:
                skip_text = f"{target_model}：{incompatible_reason}"
                skipped_models.append(skip_text)
                progress("跳过生图模型", skip_text)
                has_next_model = model_idx < len(model_queue) - 1
                if has_next_model:
                    model_idx += 1
                    target_model = model_queue[model_idx]
                    failed_with_current_model = 0
                    progress("切换生图模型", f"切换到 {target_model}")
                    continue
                return finalize(
                    self._build_result(
                        best_result=best_result,
                        best_eval=best_eval,
                        all_images=all_images,
                        all_scores=all_scores,
                        iteration_count=actual_iterations,
                        used_prompt=last_prompt,
                        used_negative_prompt=last_negative_prompt,
                        prompt_history=prompt_history,
                        floor_desc=floor_desc,
                        mode=self.mode,
                        status="failed",
                        stop_reason="no_compatible_model",
                        final_model=best_result.source_model if best_result else target_model,
                        skipped_models=skipped_models,
                        sample_id=sample_id,
                        prompt_strategy_version=last_prompt_strategy_version or cfg.prompt_strategy_version,
                        prompt_sections=last_prompt_sections,
                        failure_labels=last_failure_labels,
                        final_image_path=best_image_path,
                        iteration_image_paths=image_paths,
                    )
                )

            if requirement is None:
                floor_analysis = await self.build_floor_analysis(floor_plan, progress)
                floor_desc = floor_analysis.to_prompt_context() if floor_analysis else await self.build_floor_desc(floor_plan, progress)
                if on_event:
                    on_event("floor_desc", {"text": floor_desc})
                progress("解析需求")
                requirement = await self.parser.parse(user_requirement, floor_desc)

            prompt_set = await self.make_prompt(
                iteration=actual_iterations,
                requirement=requirement,
                user_requirement_text=user_requirement,
                target_model=target_model,
                feedback=feedback,
                floor_desc=floor_desc,
                floor_plan=floor_plan,
                reference_image=reference_image,
                manual_prompt=manual_prompt,
                progress=progress,
                floor_analysis=floor_analysis,
            )
            last_prompt = prompt_set.positive_prompt
            last_negative_prompt = prompt_set.negative_prompt
            last_prompt_strategy_version = prompt_set.prompt_strategy_version
            last_prompt_sections = list(prompt_set.prompt_sections or [])
            prompt_history.append(prompt_set.positive_prompt)
            if on_event:
                on_event("prompt", {
                    "iteration": actual_iterations + 1,
                    "positive_prompt": prompt_set.positive_prompt,
                    "negative_prompt": prompt_set.negative_prompt,
                })

            image_adapter = build_adapter(candidate_cfg, "image")
            progress(f"生成图像（第{actual_iterations + 1}轮）", prompt_set.positive_prompt[:80])
            image = await image_adapter.generate(prompt_set)
            image.iteration = actual_iterations
            image_path = self._save_output_image(image.image_bytes, actual_iterations + 1, record_output_dir)
            image_paths.append(image_path)
            if on_event:
                on_event("image", {
                    "iteration": actual_iterations + 1,
                    "image_bytes": image.image_bytes,
                    "mode": self.mode.value,
                })

            actual_iterations += 1
            progress(f"评估图像（第{actual_iterations}轮）")
            evaluation = await self.evaluate(image, requirement, floor_desc, floor_analysis, prompt_set.positive_prompt)
            all_images.append(image.image_bytes)
            all_scores.append(evaluation.total_score)
            last_failure_labels = self._infer_failure_labels(evaluation)
            if on_event:
                on_event("evaluation", {
                    "iteration": actual_iterations,
                    "evaluation": evaluation,
                })

            if best_eval is None or evaluation.total_score > best_eval.total_score:
                best_result = image
                best_eval = evaluation
                best_image_path = image_path

            if evaluation.passed:
                return finalize(
                    self._build_result(
                        best_result=image,
                        best_eval=evaluation,
                        all_images=all_images,
                        all_scores=all_scores,
                        iteration_count=actual_iterations,
                        used_prompt=prompt_set.positive_prompt,
                        used_negative_prompt=prompt_set.negative_prompt,
                        prompt_history=prompt_history,
                        floor_desc=floor_desc,
                        mode=self.mode,
                        status="success",
                        stop_reason="passed_quality_threshold",
                        final_model=image.source_model or target_model,
                        skipped_models=skipped_models,
                        sample_id=sample_id,
                        prompt_strategy_version=prompt_set.prompt_strategy_version,
                        prompt_sections=prompt_set.prompt_sections,
                        failure_labels=[],
                        final_image_path=image_path,
                        iteration_image_paths=image_paths,
                    )
                )

            failed_with_current_model += 1
            decision = self.router.route(evaluation, actual_iterations - 1, cfg.max_iterations)
            feedback = decision.feedback

            has_next_model = model_idx < len(model_queue) - 1
            if failed_with_current_model >= switch_after and has_next_model:
                model_idx += 1
                target_model = model_queue[model_idx]
                failed_with_current_model = 0
                progress("切换生图模型", f"切换到 {target_model}")
                feedback = (feedback or "") + f"\n当前模型未达标，切换到 {target_model} 继续尝试。"
            elif failed_with_current_model >= stop_after_last and not has_next_model:
                progress("停止迭代", f"最后一个模型连续失败 {failed_with_current_model} 次，提前停止")
                return finalize(
                    self._build_result(
                        best_result=best_result,
                        best_eval=best_eval,
                        all_images=all_images,
                        all_scores=all_scores,
                        iteration_count=actual_iterations,
                        used_prompt=last_prompt,
                        used_negative_prompt=last_negative_prompt,
                        prompt_history=prompt_history,
                        floor_desc=floor_desc,
                        mode=self.mode,
                        status="stopped_early",
                        stop_reason="last_model_failure_limit",
                        final_model=best_result.source_model if best_result else target_model,
                        skipped_models=skipped_models,
                        sample_id=sample_id,
                        prompt_strategy_version=last_prompt_strategy_version or cfg.prompt_strategy_version,
                        prompt_sections=last_prompt_sections,
                        failure_labels=last_failure_labels,
                        final_image_path=best_image_path,
                        iteration_image_paths=image_paths,
                    )
                )

            if decision.action == RoutingAction.TERMINATE:
                return finalize(
                    self._build_result(
                        best_result=best_result,
                        best_eval=best_eval,
                        all_images=all_images,
                        all_scores=all_scores,
                        iteration_count=actual_iterations,
                        used_prompt=last_prompt,
                        used_negative_prompt=last_negative_prompt,
                        prompt_history=prompt_history,
                        floor_desc=floor_desc,
                        mode=self.mode,
                        status="stopped_early",
                        stop_reason="router_terminate",
                        final_model=best_result.source_model if best_result else target_model,
                        skipped_models=skipped_models,
                        sample_id=sample_id,
                        prompt_strategy_version=last_prompt_strategy_version or cfg.prompt_strategy_version,
                        prompt_sections=last_prompt_sections,
                        failure_labels=last_failure_labels,
                        final_image_path=best_image_path,
                        iteration_image_paths=image_paths,
                    )
                )

            if decision.action == RoutingAction.SWITCH_MODEL and decision.suggested_model:
                target_model = decision.suggested_model
                failed_with_current_model = 0
                if decision.suggested_model in model_queue:
                    model_idx = model_queue.index(decision.suggested_model)

        return finalize(
            self._build_result(
                best_result=best_result,
                best_eval=best_eval,
                all_images=all_images,
                all_scores=all_scores,
                iteration_count=actual_iterations,
                used_prompt=last_prompt,
                used_negative_prompt=last_negative_prompt,
                prompt_history=prompt_history,
                floor_desc=floor_desc,
                mode=self.mode,
                status="max_iterations_reached",
                stop_reason="max_iterations_reached",
                final_model=best_result.source_model if best_result else target_model,
                skipped_models=skipped_models,
                sample_id=sample_id,
                prompt_strategy_version=last_prompt_strategy_version or cfg.prompt_strategy_version,
                prompt_sections=last_prompt_sections,
                failure_labels=last_failure_labels,
                final_image_path=best_image_path,
                iteration_image_paths=image_paths,
            )
        )


class StandardPipeline(BasePipeline):
    @property
    def mode(self) -> GenerationMode:
        return GenerationMode.STANDARD


class Render3DPipeline(BasePipeline):
    @property
    def mode(self) -> GenerationMode:
        return GenerationMode.RENDER3D

    async def build_floor_desc(
        self,
        floor_plan: Optional[bytes],
        progress: Callable[[str, str], None],
    ) -> str:
        if not floor_plan:
            return ""
        progress("解析平面图")
        vision = build_adapter(self.config.vision, "vision")
        prompt = """请对这张平面图进行4步深度结构化分析，输出详细的中文分析报告：

【第1步：整体属性分析】
- 楼层类型（住宅/办公/商业/混合）
- 功能属性（各区域用途）
- 空间主逻辑（动线、分区逻辑）
- 核心难点（容易出错的地方）

【第2步：逐空间精细分析】
对每个房间/区域逐一分析：
- 空间名称、所在位置（上/下/左/右/中）
- 功能属性
- 家具组成与数量
- 家具摆放关系
- 门窗逻辑
- 必须保留的元素
- 强约束说明

【第3步：结构总结】
- 外墙与内墙关系
- 门的位置与朝向
- 窗的位置
- 柜体/固定家具位置
- 楼梯/电梯/阳台等特殊结构约束

【第4步：生图关键约束清单】
列出生成效果图时必须严格遵守的约束条目（每条一行，用"-"开头）"""
        return await vision.analyze(floor_plan, prompt)

    async def build_floor_analysis(
        self,
        floor_plan: Optional[bytes],
        progress: Callable[[str, str], None],
    ) -> Optional[FloorPlanAnalysis]:
        if not floor_plan:
            return None
        progress("结构化分析平面图")
        return await self.floor_analyzer.analyze(floor_plan)


class PipelineFactory:
    @staticmethod
    def create(mode: GenerationMode, config: AppConfig) -> BasePipeline:
        if mode == GenerationMode.STANDARD:
            return StandardPipeline(config)
        if mode == GenerationMode.RENDER3D:
            return Render3DPipeline(config)
        raise ValueError(f"Unsupported generation mode: {mode}")
