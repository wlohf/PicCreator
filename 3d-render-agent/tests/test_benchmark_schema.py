from models.schemas import BenchmarkSample, BenchmarkResultRecord


def test_benchmark_sample_schema_accepts_expected_fields():
    sample = BenchmarkSample(
        sample_id="office_floorplan_modern_cn",
        mode="render3d",
        floor_plan_path="outputs/floorplan_test.jpg",
        user_requirement="现代简约办公空间",
        expected_style="现代简约",
        expected_spaces=["办公室", "卫生间"],
        critical_constraints=["卫生间不能丢失"],
        expected_view="southwest 45-degree axonometric dollhouse cutaway, roof removed",
    )

    assert sample.sample_id == "office_floorplan_modern_cn"
    assert sample.expected_spaces == ["办公室", "卫生间"]


def test_benchmark_result_schema_keeps_failure_labels():
    result = BenchmarkResultRecord(
        sample_id="office_floorplan_modern_cn",
        prompt_strategy_version="layered_constraints_v1",
        mode="render3d",
        quality_score=7.8,
        status="stopped_early",
        stop_reason="last_model_failure_limit",
        final_model="gpt-image-2",
        failure_labels=["layout_mismatch", "door_window_error"],
    )

    assert result.failure_labels == ["layout_mismatch", "door_window_error"]
    assert result.status == "stopped_early"
