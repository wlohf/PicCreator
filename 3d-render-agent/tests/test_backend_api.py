from pathlib import Path

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
