from pathlib import Path
import json

from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_health_endpoint_reports_api_status():
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "service": "3d-render-agent-api"}


def test_generate_rejects_unsupported_mode():
    client = TestClient(create_app())

    response = client.post("/api/generate", data={"mode": "invalid"})

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "generation"
    assert "不支持的生成模式 invalid" in payload["error"]


def test_config_verify_analysis_returns_validation_error_for_unsupported_format(tmp_path, monkeypatch):
    Path(tmp_path / "config.json").write_text(Path("config.example.json").read_text(), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    client = TestClient(create_app())

    response = client.post(
        "/api/config/verify-analysis",
        data={"api_format": "unsupported_format", "api_key": "x", "model": "demo-model"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "verify-analysis"
    assert "暂未实现" in payload["error"]


def test_config_save_persists_analysis_image_config_and_env(tmp_path, monkeypatch):
    Path(tmp_path / "config.json").write_text(Path("config.example.json").read_text(), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    client = TestClient(create_app())

    response = client.post(
        "/api/config/save",
        data={
            "analysis_provider_name": "BLTCY",
            "analysis_api_format": "openai_chat",
            "analysis_base_url": "https://api.bltcy.ai/v1",
            "analysis_api_key": "analysis-key",
            "analysis_model": "gpt-4o",
            "img_provider_name": "BLTCY",
            "img_api_format": "openai_chat",
            "img_base_url": "https://api.bltcy.ai/v1",
            "img_api_key": "image-key",
            "img_model": "gpt-image-2",
            "fallback_models_text": "dall-e-3\nbackup-image",
            "model_switch_after_failures": "3",
            "stop_after_last_model_failures": "4",
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    saved = json.loads(Path("config.json").read_text(encoding="utf-8"))
    assert saved["llm"]["provider_name"] == "BLTCY"
    assert saved["llm"]["base_url"] == "https://api.bltcy.ai/v1"
    assert saved["llm"]["model"] == "gpt-4o"
    assert saved["vision"]["provider_name"] == "BLTCY"
    assert saved["vision"]["model"] == "gpt-4o"
    assert saved["image_gen"]["model"] == "gpt-image-2"
    assert saved["image_model_fallbacks"] == ["dall-e-3", "backup-image"]
    assert saved["model_switch_after_failures"] == 3
    assert saved["stop_after_last_model_failures"] == 4
    env_text = Path(".env").read_text(encoding="utf-8")
    assert "LLM_API_KEY=analysis-key" in env_text
    assert "VISION_API_KEY=analysis-key" in env_text
    assert "IMAGE_API_KEY=image-key" in env_text
