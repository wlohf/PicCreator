from models.schemas import EvaluationResult, RoutingDecision, RoutingAction


class ErrorRouter:
    def route(self, evaluation: EvaluationResult, iteration: int, max_iterations: int) -> RoutingDecision:
        if iteration >= max_iterations - 1:
            return RoutingDecision(action=RoutingAction.TERMINATE, feedback="已达最大迭代次数")

        if evaluation.passed:
            return RoutingDecision(action=RoutingAction.TERMINATE, feedback="质检通过")

        # 找出最低分维度
        dims = {d.name: d.score for d in evaluation.dimensions}
        worst = min(dims, key=dims.get) if dims else ""
        worst_score = dims.get(worst, 0.0)
        failure = evaluation.failure_reason or ""
        issue_text = "；".join(evaluation.issues[:6]) if evaluation.issues else ""
        summary = evaluation.comparison_summary or ""
        detail = " ".join([part for part in [failure, summary, issue_text] if part]).strip()

        if worst in ("平面一致性", "空间合理性"):
            return RoutingDecision(
                action=RoutingAction.ADJUST_PROMPT,
                feedback=f"{worst}不足（{worst_score:.1f}），请严格对齐平面图结构与门窗/家具关系，重点修正门开向、柜体贴墙关系和多家具相对位置。{detail}",
            )

        if worst == "视觉质量":
            return RoutingDecision(
                action=RoutingAction.ADJUST_PROMPT,
                feedback=f"视觉质量不足（{worst_score:.1f}），请加强光照、材质细节与清晰度。{detail}",
            )

        # 默认调整提示词
        return RoutingDecision(
            action=RoutingAction.ADJUST_PROMPT,
            feedback=f"主要问题：{worst}（{worst_score:.1f}）。{detail}",
        )
