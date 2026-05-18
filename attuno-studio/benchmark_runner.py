import argparse
import asyncio
import json
from datetime import datetime
from pathlib import Path

from config import load_config
from models.schemas import BenchmarkSample, BenchmarkResultRecord, GenerationMode
from pipeline import PipelineFactory


def _load_samples(path: Path) -> list[BenchmarkSample]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [BenchmarkSample.model_validate(item) for item in data]


def _resolve_bytes(project_root: Path, maybe_relative_path: str) -> bytes | None:
    if not maybe_relative_path:
        return None
    candidate = Path(maybe_relative_path)
    full_path = candidate if candidate.is_absolute() else (project_root / candidate)
    return full_path.read_bytes()


async def _run_sample(project_root: Path, sample: BenchmarkSample, strategy_version: str, config_path: Path, out_dir: Path):
    cfg = load_config(str(config_path))
    cfg.prompt_strategy_version = strategy_version
    pipeline = PipelineFactory.create(GenerationMode(sample.mode), cfg)
    floor_plan = _resolve_bytes(project_root, sample.floor_plan_path)
    reference_image = _resolve_bytes(project_root, sample.reference_image_path)
    result = await pipeline.run(
        floor_plan,
        reference_image,
        sample.user_requirement,
        sample_id=sample.sample_id,
        record_output_dir=str(out_dir),
    )
    benchmark_record = BenchmarkResultRecord(
        sample_id=sample.sample_id,
        prompt_strategy_version=strategy_version,
        mode=sample.mode,
        quality_score=result.quality_score,
        status=result.status,
        stop_reason=result.stop_reason,
        final_model=result.final_model,
        failure_labels=result.failure_labels,
        run_record_path=result.run_record_path,
        final_image_path=result.final_image_path,
        expected_style=sample.expected_style,
        expected_spaces=sample.expected_spaces,
        critical_constraints=sample.critical_constraints,
        expected_view=sample.expected_view,
        notes=sample.notes,
    )
    out_path = out_dir / f"{sample.sample_id}_{strategy_version}_benchmark.json"
    out_path.write_text(benchmark_record.model_dump_json(indent=2, exclude_none=True), encoding="utf-8")
    return benchmark_record


async def main():
    parser = argparse.ArgumentParser(description="Run prompt strategy benchmarks for fixed samples.")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--samples", default="benchmarks/samples.json")
    parser.add_argument("--strategies", nargs="+", default=["llm_prompt_v1"])
    parser.add_argument("--out-dir", default="")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    config_path = project_root / args.config
    samples_path = project_root / args.samples
    samples = _load_samples(samples_path)
    if not samples:
        raise RuntimeError(f"未读取到 benchmark 样本：{samples_path}")

    run_root = Path(args.out_dir) if args.out_dir else project_root / "benchmarks" / "results" / datetime.now().strftime("%Y%m%d_%H%M%S")
    run_root.mkdir(parents=True, exist_ok=True)

    summary = []
    for strategy_version in args.strategies:
        strategy_dir = run_root / strategy_version
        strategy_dir.mkdir(parents=True, exist_ok=True)
        for sample in samples:
            print(f"[benchmark] sample={sample.sample_id} strategy={strategy_version}")
            record = await _run_sample(project_root, sample, strategy_version, config_path, strategy_dir)
            summary.append(record)
            print(
                f"  -> status={record.status} score={record.quality_score:.2f} "
                f"stop_reason={record.stop_reason} labels={','.join(record.failure_labels) or 'none'}"
            )
    print(f"[benchmark] completed {len(summary)} runs. results_dir={run_root}")


if __name__ == "__main__":
    asyncio.run(main())
