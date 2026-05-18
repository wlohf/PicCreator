import json
from pathlib import Path

import pytest

import app_runtime
from models.schemas import GenerationMode, PipelineResult


def test_run_pipeline_allows_floor_plan_with_text_only_image_model(tmp_path, monkeypatch):
    floor_plan = tmp_path / "floor.png"
    floor_plan.write_bytes(b"not-a-real-image-but-readable")

    class FakePipeline:
        async def run(self, floor_plan_bytes, *_args, **_kwargs):
            assert floor_plan_bytes == floor_plan.read_bytes()
            return PipelineResult(
                mode=GenerationMode.RENDER3D.value,
                status="success",
                stop_reason="passed_quality_threshold",
                final_model="dall-e-3",
                iteration_count=0,
            )

    class FakePipelineFactory:
        @staticmethod
        def create(mode, config):
            assert mode == GenerationMode.RENDER3D
            return FakePipeline()

    monkeypatch.setattr(app_runtime, "PipelineFactory", FakePipelineFactory)

    snapshots = list(
        app_runtime.run_pipeline(
            GenerationMode.RENDER3D.value,
            [str(floor_plan)],
            None,
            "现代简约客厅",
            "",
            "",
            1,
            "Test Analysis",
            "openai_chat",
            "https://example.invalid/v1",
            "analysis-key",
            "gpt-4o-mini",
            "Test Image",
            "openai_image",
            "https://example.invalid/v1",
            "image-key",
            "dall-e-3",
            "",
            2,
            2,
        )
    )

    final_status = snapshots[-1][2]
    assert "没有兼容当前输入约束的模型" not in final_status
    assert "生成成功" in final_status


def test_run_pipeline_allows_colored_floor_plan_without_text_prompt(tmp_path, monkeypatch):
    floor_plan = tmp_path / "floor.png"
    floor_plan.write_bytes(b"not-a-real-image-but-readable")

    class FakePipeline:
        async def run(self, floor_plan_bytes, _reference_image, user_requirement, *_args, **_kwargs):
            assert floor_plan_bytes == floor_plan.read_bytes()
            assert user_requirement == ""
            return PipelineResult(
                mode=GenerationMode.COLORED_FLOOR_PLAN.value,
                status="success",
                stop_reason="quality_evaluation_disabled",
                final_model="gpt-image-2",
                iteration_count=1,
            )

    class FakePipelineFactory:
        @staticmethod
        def create(mode, config):
            assert mode == GenerationMode.COLORED_FLOOR_PLAN
            return FakePipeline()

    monkeypatch.setattr(app_runtime, "PipelineFactory", FakePipelineFactory)

    snapshots = list(
        app_runtime.run_pipeline(
            GenerationMode.COLORED_FLOOR_PLAN.value,
            [str(floor_plan)],
            None,
            "",
            "",
            "",
            1,
            "Test Analysis",
            "openai_chat",
            "https://example.invalid/v1",
            "analysis-key",
            "gpt-4o-mini",
            "Test Image",
            "openai_image",
            "https://example.invalid/v1",
            "image-key",
            "gpt-image-2",
            "",
            2,
            2,
            False,
        )
    )

    final_status = snapshots[-1][2]
    assert "请输入设计需求" not in final_status
    assert "生成成功" in final_status


def test_verify_analysis_api_fails_when_vision_image_probe_fails(monkeypatch):
    class FakeLLM:
        async def chat(self, *_args, **_kwargs):
            return "OK"

    class FailingVision:
        async def analyze(self, *_args, **_kwargs):
            raise RuntimeError("image input rejected")

    def fake_build_adapter(_cfg, role):
        return FakeLLM() if role == "llm" else FailingVision()

    monkeypatch.setattr(app_runtime, "build_adapter", fake_build_adapter)

    with pytest.raises(RuntimeError) as excinfo:
        app_runtime.verify_analysis_api(
            "Test Provider",
            "openai_chat",
            "https://example.invalid/v1",
            "analysis-key",
            "gpt-vision-test",
        )

    message = str(excinfo.value)
    assert "平面图视觉分析调用失败" in message
    assert "gpt-vision-test" in message
    assert "https://example.invalid/v1" in message
    assert "image input rejected" in message


def test_verify_image_api_raises_on_generation_failure(monkeypatch):
    class FailingImage:
        async def generate(self, *_args, **_kwargs):
            raise RuntimeError("image route rejected")

    monkeypatch.setattr(app_runtime, "build_adapter", lambda *_args, **_kwargs: FailingImage())

    with pytest.raises(RuntimeError) as excinfo:
        app_runtime.verify_image_api(
            "Test Image",
            "openai_chat",
            "https://image.example.invalid/v1",
            "image-key",
            "gpt-image-test",
        )

    message = str(excinfo.value)
    assert "画图模型调用失败" in message
    assert "gpt-image-test" in message
    assert "https://image.example.invalid/v1" in message
    assert "image route rejected" in message


def test_get_config_inherits_default_runtime_config_without_keys_for_fresh_token_namespace(tmp_path, monkeypatch):
    default_config = {
        "llm": {
            "provider": "openai_compat",
            "provider_name": "Default Analysis",
            "api_format": "openai_chat",
            "api_key_env": "LLM_API_KEY",
            "api_key": "",
            "base_url": "https://analysis.example/v1",
            "model": "analysis-model",
        },
        "vision": {
            "provider": "openai_compat",
            "provider_name": "Default Vision",
            "api_format": "openai_chat",
            "api_key_env": "VISION_API_KEY",
            "api_key": "",
            "base_url": "https://vision.example/v1",
            "model": "vision-model",
        },
        "image_gen": {
            "provider": "openai_compat",
            "provider_name": "Default Image",
            "api_format": "openai_chat",
            "api_key_env": "IMAGE_API_KEY",
            "api_key": "",
            "base_url": "https://image.example/v1",
            "model": "image-model",
        },
    }
    config_path = tmp_path / "config.json"
    config_example_path = tmp_path / "config.example.json"
    env_path = tmp_path / ".env"
    config_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config_example_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env_path.write_text("LLM_API_KEY=analysis-env\nVISION_API_KEY=vision-env\nIMAGE_API_KEY=image-env\n", encoding="utf-8")
    monkeypatch.setattr(app_runtime, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_runtime, "CONFIG_EXAMPLE_PATH", config_example_path)
    monkeypatch.setattr(app_runtime, "ENV_PATH", env_path)
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    monkeypatch.delenv("IMAGE_API_KEY", raising=False)

    cfg = app_runtime.get_config("fresh-token")

    assert cfg.llm.provider_name == "Default Analysis"
    assert cfg.llm.base_url == "https://analysis.example/v1"
    assert cfg.llm.model == "analysis-model"
    assert cfg.llm.api_key == ""
    assert cfg.vision.api_key == ""
    assert cfg.image_gen.provider_name == "Default Image"
    assert cfg.image_gen.base_url == "https://image.example/v1"
    assert cfg.image_gen.model == "image-model"
    assert cfg.image_gen.api_key == ""
