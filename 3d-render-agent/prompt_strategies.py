from dataclasses import dataclass


PROMPT_STRATEGY_BASELINE_V0 = "dense_legacy_v0"
PROMPT_STRATEGY_LAYERED_V1 = "layered_constraints_v1"
DEFAULT_PROMPT_STRATEGY = PROMPT_STRATEGY_LAYERED_V1


@dataclass(frozen=True)
class PromptSectionSpec:
    key: str
    title: str
    priority: str


@dataclass(frozen=True)
class PromptStrategySpec:
    version: str
    display_name: str
    description: str
    positive_sections: tuple[PromptSectionSpec, ...]
    negative_groups: tuple[str, ...]
    min_positive_length: int = 900
    min_negative_length: int = 100


PROMPT_STRATEGIES = {
    PROMPT_STRATEGY_BASELINE_V0: PromptStrategySpec(
        version=PROMPT_STRATEGY_BASELINE_V0,
        display_name="Dense Legacy Baseline",
        description="基线策略，保留密集说明文风格，适合与新版分层提示词做 A/B 对比。",
        positive_sections=(
            PromptSectionSpec("goal", "生成目标", "P0"),
            PromptSectionSpec("style", "风格与氛围", "P1"),
            PromptSectionSpec("logic", "空间组织逻辑", "P0"),
            PromptSectionSpec("spaces", "逐空间说明", "P0"),
            PromptSectionSpec("constraints", "全局硬约束", "P0"),
            PromptSectionSpec("user", "用户补充要求", "P1"),
            PromptSectionSpec("render", "渲染质量", "P1"),
        ),
        negative_groups=("结构错误", "风格偏移", "画质问题"),
    ),
    PROMPT_STRATEGY_LAYERED_V1: PromptStrategySpec(
        version=PROMPT_STRATEGY_LAYERED_V1,
        display_name="Layered Constraints v1",
        description="分层强约束策略，按 P0/P1/P2 组织结构、空间、关系、风格与禁止项。",
        positive_sections=(
            PromptSectionSpec("goal", "生成目标 | P0", "P0"),
            PromptSectionSpec("structure", "结构主骨架 | P0", "P0"),
            PromptSectionSpec("spaces", "关键空间清单 | P0", "P0"),
            PromptSectionSpec("relations", "门窗与家具关系 | P0", "P0"),
            PromptSectionSpec("style", "风格与材质 | P1", "P1"),
            PromptSectionSpec("user", "用户补充要求 | P1", "P1"),
            PromptSectionSpec("execution", "最终执行约束 | P0", "P0"),
        ),
        negative_groups=("P0 结构禁止项", "P1 风格禁止项", "P2 画质禁止项"),
    ),
}


def get_prompt_strategy_spec(version: str) -> PromptStrategySpec:
    return PROMPT_STRATEGIES.get(version or "", PROMPT_STRATEGIES[DEFAULT_PROMPT_STRATEGY])


def list_prompt_strategy_versions() -> tuple[str, ...]:
    return tuple(PROMPT_STRATEGIES.keys())
