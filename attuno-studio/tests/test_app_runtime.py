import json
from pathlib import Path

import pytest

import app_runtime
from models.schemas import GenerationMode, NormalizedImage, PipelineResult


def test_extract_model_ids_deduplicates_and_supports_common_shapes():
    models = app_runtime._extract_model_ids({
        "data": [
            {"id": "gpt-5.5"},
            {"id": "gpt-5.5"},
            {"name": "models/gemini-pro"},
            {"model": "custom-image"},
        ]
    })

    assert models == ["custom-image", "gemini-pro", "gpt-5.5"]


def test_openai_model_detection_builds_models_url_from_endpoint_base_url():
    cfg = app_runtime.AdapterConfig(
        provider="openai_chat",
        api_format="openai_chat",
        base_url="https://api.example/v1/chat/completions",
        api_key="test-key",
        model="gpt-5.5",
    )

    requests = app_runtime._model_list_requests(cfg)

    assert requests == [("https://api.example/v1/models", {"Authorization": "Bearer test-key"})]


def test_openai_model_detection_adds_v1_fallback_for_host_base_url():
    cfg = app_runtime.AdapterConfig(
        provider="openai_chat",
        api_format="openai_chat",
        base_url="https://api.example",
        api_key="test-key",
        model="gpt-5.5",
    )

    requests = app_runtime._model_list_requests(cfg)

    assert requests == [
        ("https://api.example/models", {"Authorization": "Bearer test-key"}),
        ("https://api.example/v1/models", {"Authorization": "Bearer test-key"}),
    ]


def test_legacy_ollama_format_collapses_to_completion_model_detection():
    cfg = app_runtime.AdapterConfig(
        provider="ollama",
        api_format="ollama",
        base_url="http://localhost:11434",
        api_key="test-key",
        model="llama3.2",
    )

    app_runtime._validate_model_list_config("分析模型", cfg)
    assert app_runtime._model_list_requests(cfg) == [
        ("http://localhost:11434/models", {"Authorization": "Bearer test-key"}),
        ("http://localhost:11434/v1/models", {"Authorization": "Bearer test-key"}),
    ]


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


def test_run_pipeline_allows_render3d_without_floor_plan(monkeypatch):
    class FakePipeline:
        async def run(self, floor_plan_bytes, _reference_image, user_requirement, *_args, **_kwargs):
            assert floor_plan_bytes is None
            assert user_requirement == "现代简约客厅"
            return PipelineResult(
                mode=GenerationMode.RENDER3D.value,
                status="success",
                stop_reason="quality_evaluation_disabled",
                final_model="gpt-image-2",
                iteration_count=1,
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
            [],
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
            "gpt-image-2",
            "",
            2,
            2,
            False,
        )
    )

    final_status = snapshots[-1][2]
    assert "请至少上传一张平面图" not in final_status
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
    assert "文生图调用失败" in message
    assert "gpt-image-test" in message
    assert "https://image.example.invalid/v1" in message
    assert "image route rejected" in message


def test_verify_image_api_runs_text_and_edit_probe_when_supported(monkeypatch):
    prompts = []

    class RecordingImage:
        async def generate(self, prompt):
            prompts.append(prompt)
            if prompt.reference_image:
                return NormalizedImage(
                    image_bytes=b"edit-bytes",
                    source_model=prompt.model_target,
                    generation_params={"endpoint": "images.edit"},
                )
            return NormalizedImage(
                image_bytes=b"text-bytes",
                source_model=prompt.model_target,
                generation_params={
                    "endpoint": "images.generate",
                    "negative_prompt_mode": "embedded_text",
                },
            )

    monkeypatch.setattr(app_runtime, "build_adapter", lambda *_args, **_kwargs: RecordingImage())

    message = app_runtime.verify_image_api(
        "Test Image",
        "openai_image",
        "https://image.example.invalid/v1",
        "image-key",
        "gpt-image-2",
    )

    assert len(prompts) == 2
    assert prompts[0].reference_image is None
    assert prompts[1].reference_image
    assert "文生图可用" in message
    assert "图生图/参考图可用" in message
    assert "文生图返回图片字节：10" in message
    assert "图生图/参考图返回图片字节：10" in message


def test_verify_image_api_fails_when_supported_edit_probe_fails(monkeypatch):
    class EditFailingImage:
        async def generate(self, prompt):
            if prompt.reference_image:
                raise RuntimeError("edit route rejected")
            return NormalizedImage(
                image_bytes=b"text-bytes",
                source_model=prompt.model_target,
                generation_params={"endpoint": "images.generate"},
            )

    monkeypatch.setattr(app_runtime, "build_adapter", lambda *_args, **_kwargs: EditFailingImage())

    with pytest.raises(RuntimeError) as excinfo:
        app_runtime.verify_image_api(
            "Test Image",
            "openai_image",
            "https://image.example.invalid/v1",
            "image-key",
            "gpt-image-2",
        )

    message = str(excinfo.value)
    assert "图生图/参考图调用失败" in message
    assert "gpt-image-2" in message
    assert "edit route rejected" in message


def test_ui_api_format_collapses_legacy_options_to_three_choices():
    assert app_runtime._ui_api_format("") == "openai_chat"
    assert app_runtime._ui_api_format("openai_image") == "openai_chat"
    assert app_runtime._ui_api_format("custom_openai_image") == "openai_chat"
    assert app_runtime._ui_api_format("openai_chat") == "openai_chat"
    assert app_runtime._ui_api_format("custom_openai_chat") == "openai_chat"
    assert app_runtime._ui_api_format("openai") == "openai_chat"
    assert app_runtime._ui_api_format("custom") == "openai_chat"
    assert app_runtime._ui_api_format("openai_responses") == "openai_responses"
    assert app_runtime._ui_api_format("messages") == "anthropic"


def test_ui_api_format_choices_expose_only_three_protocols():
    choices = dict(app_runtime.UI_API_FORMAT_CHOICES)

    assert choices == {
        "response": "openai_responses",
        "completion": "openai_chat",
        "message": "anthropic",
    }


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


def test_load_model_config_for_ui_wraps_legacy_sections_as_provider_profiles(tmp_path, monkeypatch):
    default_config = {
        "llm": {
            "provider_name": "Default Analysis",
            "api_format": "openai_chat",
            "api_key": "analysis-key",
            "base_url": "https://analysis.example/v1",
            "model": "analysis-model",
        },
        "vision": {
            "provider_name": "Default Analysis",
            "api_format": "openai_chat",
            "api_key": "analysis-key",
            "base_url": "https://analysis.example/v1",
            "model": "analysis-model",
        },
        "image_gen": {
            "provider_name": "Default Image",
            "api_format": "openai_image",
            "api_key": "image-key",
            "base_url": "https://image.example/v1",
            "model": "image-model",
        },
    }
    config_path = tmp_path / "config.json"
    config_example_path = tmp_path / "config.example.json"
    env_path = tmp_path / ".env"
    config_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config_example_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(app_runtime, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_runtime, "CONFIG_EXAMPLE_PATH", config_example_path)
    monkeypatch.setattr(app_runtime, "ENV_PATH", env_path)

    config = app_runtime.load_model_config_for_ui()

    assert config["activeAnalysisProviderId"] == "analysis-default"
    assert config["analysisProviders"] == [{
        "id": "analysis-default",
        "providerName": "Default Analysis",
        "apiFormat": "openai_chat",
        "baseUrl": "https://analysis.example/v1",
        "apiKey": "analysis-key",
        "model": "analysis-model",
    }]
    assert config["activeImageProviderId"] == "image-default"
    assert config["imageProviders"][0]["apiFormat"] == "openai_chat"


def test_save_model_config_to_files_persists_multiple_provider_profiles(tmp_path, monkeypatch):
    default_config = {
        "llm": {
            "provider_name": "Old Analysis",
            "api_format": "openai_chat",
            "api_key": "",
            "base_url": "https://old-analysis.example/v1",
            "model": "old-analysis-model",
        },
        "vision": {
            "provider_name": "Old Analysis",
            "api_format": "openai_chat",
            "api_key": "",
            "base_url": "https://old-analysis.example/v1",
            "model": "old-analysis-model",
        },
        "image_gen": {
            "provider_name": "Old Image",
            "api_format": "openai_image",
            "api_key": "",
            "base_url": "https://old-image.example/v1",
            "model": "old-image-model",
        },
    }
    config_path = tmp_path / "config.json"
    config_example_path = tmp_path / "config.example.json"
    env_path = tmp_path / ".env"
    config_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config_example_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(app_runtime, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_runtime, "CONFIG_EXAMPLE_PATH", config_example_path)
    monkeypatch.setattr(app_runtime, "ENV_PATH", env_path)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    monkeypatch.delenv("IMAGE_API_KEY", raising=False)

    analysis_profiles = [
        {
            "id": "analysis-a",
            "providerName": "Analysis A",
            "apiFormat": "openai_chat",
            "baseUrl": "https://analysis-a.example/v1",
            "apiKey": "analysis-a-key",
            "model": "analysis-a-model",
        },
        {
            "id": "analysis-b",
            "providerName": "Analysis B",
            "apiFormat": "anthropic",
            "baseUrl": "https://analysis-b.example/v1",
            "apiKey": "analysis-b-key",
            "model": "analysis-b-model",
        },
    ]
    image_profiles = [
        {
            "id": "image-a",
            "providerName": "Image A",
            "apiFormat": "openai_image",
            "baseUrl": "https://image-a.example/v1",
            "apiKey": "image-a-key",
            "model": "image-a-model",
        },
        {
            "id": "image-b",
            "providerName": "Image B",
            "apiFormat": "custom_openai_image",
            "baseUrl": "https://image-b.example/v1",
            "apiKey": "image-b-key",
            "model": "image-b-model",
        },
    ]

    app_runtime.save_model_config_to_files(
        "Analysis B",
        "anthropic",
        "https://analysis-b.example/v1",
        "analysis-b-key",
        "analysis-b-model",
        "Image B",
        "custom_openai_image",
        "https://image-b.example/v1",
        "image-b-key",
        "image-b-model",
        analysis_providers_json=json.dumps(analysis_profiles),
        active_analysis_provider_id="analysis-b",
        image_providers_json=json.dumps(image_profiles),
        active_image_provider_id="image-b",
    )

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["llm"]["active_provider_id"] == "analysis-b"
    assert saved["vision"]["active_provider_id"] == "analysis-b"
    assert saved["llm"]["provider_name"] == "Analysis B"
    assert saved["llm"]["api_format"] == "anthropic"
    assert saved["llm"]["api_key"] == "analysis-b-key"
    assert saved["llm"]["providers"][0]["provider_name"] == "Analysis A"
    assert saved["image_gen"]["active_provider_id"] == "image-b"
    assert saved["image_gen"]["provider_name"] == "Image B"
    assert saved["image_gen"]["api_format"] == "openai_chat"
    assert saved["image_gen"]["providers"][0]["api_format"] == "openai_chat"
    assert saved["image_gen"]["providers"][1]["api_format"] == "openai_chat"
    assert saved["image_gen"]["providers"][1]["api_key"] == "image-b-key"


def test_tavily_keys_are_normalized_and_saved_per_user(tmp_path, monkeypatch):
    default_config = {
        "llm": {"provider_name": "Analysis", "api_format": "openai_chat", "api_key": "", "base_url": "", "model": ""},
        "vision": {"provider_name": "Analysis", "api_format": "openai_chat", "api_key": "", "base_url": "", "model": ""},
        "image_gen": {"provider_name": "Image", "api_format": "openai_image", "api_key": "", "base_url": "", "model": ""},
    }
    config_path = tmp_path / "config.json"
    config_example_path = tmp_path / "config.example.json"
    env_path = tmp_path / ".env"
    config_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config_example_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(app_runtime, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_runtime, "CONFIG_EXAMPLE_PATH", config_example_path)
    monkeypatch.setattr(app_runtime, "ENV_PATH", env_path)
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))

    app_runtime.save_model_config_to_files(
        "", "", "", "", "",
        "", "", "", "", "",
        tavily_api_keys=" tvly-test-a, tvly-test-b\ntvly-test-a；tvly-test-c ",
        user_id="xyleisure",
    )

    loaded = app_runtime.load_model_config_for_ui("xyleisure")
    assert loaded["tavilyApiKeys"] == "tvly-test-a\ntvly-test-b\ntvly-test-c"

    app_runtime.save_model_config_to_files(
        "", "", "", "", "",
        "", "", "", "", "",
        tavily_api_keys="",
        user_id="xyleisure",
    )

    assert app_runtime.load_model_config_for_ui("xyleisure")["tavilyApiKeys"] == ""


def test_claim_tavily_api_keys_rotates_inside_user_namespace(tmp_path, monkeypatch):
    default_config = {
        "llm": {"provider_name": "Analysis", "api_format": "openai_chat", "api_key": "", "base_url": "", "model": ""},
        "vision": {"provider_name": "Analysis", "api_format": "openai_chat", "api_key": "", "base_url": "", "model": ""},
        "image_gen": {"provider_name": "Image", "api_format": "openai_image", "api_key": "", "base_url": "", "model": ""},
        "web_search": {"tavily_api_keys": ["default-key"], "tavily_next_key_index": 0},
    }
    config_path = tmp_path / "config.json"
    config_example_path = tmp_path / "config.example.json"
    env_path = tmp_path / ".env"
    config_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config_example_path.write_text(json.dumps(default_config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(app_runtime, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_runtime, "CONFIG_EXAMPLE_PATH", config_example_path)
    monkeypatch.setattr(app_runtime, "ENV_PATH", env_path)
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))

    assert app_runtime.claim_tavily_api_keys("fresh-user") == ([], 0)

    app_runtime.save_model_config_to_files("", "", "", "", "", "", "", "", "", "", tavily_api_keys="a1\na2", user_id="user-a")
    app_runtime.save_model_config_to_files("", "", "", "", "", "", "", "", "", "", tavily_api_keys="b1", user_id="user-b")

    assert app_runtime.claim_tavily_api_keys("user-a") == (["a1", "a2"], 0)
    assert app_runtime.claim_tavily_api_keys("user-a") == (["a1", "a2"], 1)
    assert app_runtime.claim_tavily_api_keys("user-b") == (["b1"], 0)
    assert app_runtime.load_model_config_for_ui("user-a")["tavilyNextKeyIndex"] == 0
    assert app_runtime.load_model_config_for_ui("user-b")["tavilyNextKeyIndex"] == 0


def test_build_config_from_dict_uses_active_provider_profile():
    cfg = app_runtime.build_config_from_dict({
        "llm": {
            "provider_name": "Flat Analysis",
            "api_format": "openai_chat",
            "api_key": "flat-key",
            "base_url": "https://flat.example/v1",
            "model": "flat-model",
            "active_provider_id": "analysis-b",
            "providers": [
                {
                    "id": "analysis-a",
                    "provider_name": "Analysis A",
                    "api_format": "openai_chat",
                    "api_key": "analysis-a-key",
                    "base_url": "https://analysis-a.example/v1",
                    "model": "analysis-a-model",
                },
                {
                    "id": "analysis-b",
                    "provider_name": "Analysis B",
                    "api_format": "anthropic",
                    "api_key": "analysis-b-key",
                    "base_url": "https://analysis-b.example/v1",
                    "model": "analysis-b-model",
                },
            ],
        },
        "vision": {
            "provider_name": "Flat Vision",
            "api_format": "openai_chat",
            "api_key": "flat-vision-key",
            "base_url": "https://flat-vision.example/v1",
            "model": "flat-vision-model",
        },
        "image_gen": {
            "provider_name": "Flat Image",
            "api_format": "openai_image",
            "api_key": "flat-image-key",
            "base_url": "https://flat-image.example/v1",
            "model": "flat-image-model",
            "active_provider_id": "image-b",
            "providers": [
                {
                    "id": "image-b",
                    "provider_name": "Image B",
                    "api_format": "custom_openai_image",
                    "api_key": "image-b-key",
                    "base_url": "https://image-b.example/v1",
                    "model": "image-b-model",
                },
            ],
        },
    })

    assert cfg.llm.provider_name == "Analysis B"
    assert cfg.llm.api_format == "anthropic"
    assert cfg.llm.api_key == "analysis-b-key"
    assert cfg.llm.base_url == "https://analysis-b.example/v1"
    assert cfg.llm.model == "analysis-b-model"
    assert cfg.image_gen.provider_name == "Image B"
    assert cfg.image_gen.api_format == "openai_chat"
    assert cfg.image_gen.api_key == "image-b-key"
    assert cfg.image_gen.base_url == "https://image-b.example/v1"
    assert cfg.image_gen.model == "image-b-model"
