import argparse
from collections import Counter, defaultdict
from pathlib import Path

from models.schemas import BenchmarkResultRecord


def _load_records(result_dir: Path) -> list[BenchmarkResultRecord]:
    records = []
    for path in result_dir.rglob("*_benchmark.json"):
        records.append(BenchmarkResultRecord.model_validate_json(path.read_text(encoding="utf-8")))
    return records


def _build_report(records: list[BenchmarkResultRecord]) -> str:
    if not records:
        return "# Benchmark Summary\n\n没有找到 benchmark 结果。"

    grouped: dict[str, list[BenchmarkResultRecord]] = defaultdict(list)
    for record in records:
        grouped[record.prompt_strategy_version].append(record)

    lines = ["# Benchmark Summary"]
    for strategy_version, items in grouped.items():
        avg_score = sum(item.quality_score for item in items) / max(1, len(items))
        status_counter = Counter(item.status for item in items)
        label_counter = Counter(label for item in items for label in item.failure_labels)
        lines.append(f"\n## {strategy_version}")
        lines.append(f"- runs: {len(items)}")
        lines.append(f"- avg_score: {avg_score:.2f}")
        lines.append("- status_counts: " + ", ".join(f"{k}={v}" for k, v in sorted(status_counter.items())))
        if label_counter:
            lines.append("- failure_labels: " + ", ".join(f"{k}={v}" for k, v in label_counter.most_common()))
        else:
            lines.append("- failure_labels: none")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Summarize benchmark result JSON files.")
    parser.add_argument("--result-dir", default="benchmarks/results")
    args = parser.parse_args()

    result_dir = Path(args.result_dir)
    records = _load_records(result_dir)
    report = _build_report(records)
    out_path = result_dir / "summary.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(report)
    print(f"\n[report] saved to {out_path}")


if __name__ == "__main__":
    main()
