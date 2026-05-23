from pathlib import Path
import json

from fastapi.testclient import TestClient

from backend.app.main import create_app


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _patch_runtime_files(monkeypatch, tmp_path):
    import app_runtime

    config_path = tmp_path / "config.json"
    config_example_path = tmp_path / "config.example.json"
    env_path = tmp_path / ".env"
    config_example_path.write_text((PROJECT_ROOT / "config.example.json").read_text(encoding="utf-8"), encoding="utf-8")
    if not config_path.exists():
        config_path.write_text(config_example_path.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(app_runtime, "CONFIG_PATH", config_path)
    monkeypatch.setattr(app_runtime, "CONFIG_EXAMPLE_PATH", config_example_path)
    monkeypatch.setattr(app_runtime, "ENV_PATH", env_path)
    return config_path, env_path


def _auth_client(username: str = "tester", password: str = "password123"):
    client = TestClient(create_app())
    response = client.post("/api/auth/register", json={"username": username, "password": password})
    if response.status_code == 409:
        response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return client


def test_register_rejects_reserved_default_user(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app())

    response = client.post("/api/auth/register", json={"username": "default", "password": "password123"})

    assert response.status_code == 400
    assert "不可用" in response.json()["detail"]


def test_health_endpoint_reports_api_status():
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["service"] == "attuno-studio-api"
    assert payload["build"]

def test_cors_allows_localhost_development_ports():
    client = TestClient(create_app())

    response = client.options(
        "/api/generate/stream",
        headers={
            "Origin": "http://localhost:42958",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:42958"


def test_generate_rejects_unsupported_mode():
    client = _auth_client("pref-event-user")

    response = client.post("/api/generate", data={"mode": "invalid"})

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "generation"
    assert "不支持的生成模式 invalid" in payload["error"]


def test_chat_endpoint_returns_structured_action(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("verify-analysis-user")

    response = client.post(
        "/api/chat",
        json={
            "message": "这个风格太厚重，改成轻盈温馨一点",
            "project_id": "p-chat",
            "active_result_id": "result-1",
            "context": {"room_type": "会客厅"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["intent"] == "revise_style"
    assert payload["suggested_action"] == "image_edit"
    assert "draft_instruction" in payload
    assert payload["ui_hints"]["collapse_long_prompt"] is True
    assert payload["ui_hints"]["apply_to_composer"] is True
    assert payload["ui_hints"]["switch_to_edit"] is True


def test_daily_chat_endpoint_uses_configured_analysis_model(tmp_path, monkeypatch):
    import app_runtime

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("daily-chat-user")
    calls = []

    class FakeChatAdapter:
        async def chat(self, messages, **kwargs):
            calls.append({"messages": messages, "kwargs": kwargs, "cfg": self.cfg})
            return "后端模型返回的真实回复"

    def fake_build_adapter(cfg, role):
        assert role == "llm"
        adapter = FakeChatAdapter()
        adapter.cfg = cfg
        return adapter

    monkeypatch.setattr(app_runtime, "build_adapter", fake_build_adapter)

    response = client.post(
        "/api/chat",
        json={
            "message": "今天先正常聊聊项目节奏",
            "project_id": "p-chat",
            "context": {"workspace_mode": "chat"},
            "reasoning_effort": "low",
            "api_config": {
                "analysisProviderName": "Configured Chat",
                "analysisApiFormat": "openai",
                "analysisBaseUrl": "https://chat.example/v1",
                "analysisApiKey": "chat-key",
                "analysisModel": "chat-model",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["intent"] == "daily_chat"
    assert payload["reply"] == "后端模型返回的真实回复"
    assert calls
    assert calls[0]["cfg"].provider_name == "Configured Chat"
    assert calls[0]["cfg"].model == "chat-model"
    assert calls[0]["kwargs"]["max_tokens"] == 900


def test_chat_endpoint_does_not_call_analysis_model_for_image_actions(tmp_path, monkeypatch):
    import app_runtime

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("image-chat-router-user")

    def fail_build_adapter(*_args, **_kwargs):
        raise AssertionError("image intent routing should not call the daily chat model")

    monkeypatch.setattr(app_runtime, "build_adapter", fail_build_adapter)

    response = client.post(
        "/api/chat",
        json={
            "message": "把这个空间画成温馨一点的效果图",
            "project_id": "p-chat",
            "context": {"workspace_mode": "chat"},
            "api_config": {
                "analysisProviderName": "Configured Chat",
                "analysisApiFormat": "openai",
                "analysisBaseUrl": "https://chat.example/v1",
                "analysisApiKey": "chat-key",
                "analysisModel": "chat-model",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["suggested_action"] != "chat"
    assert payload["draft_instruction"]


def test_daily_chat_session_identity_wins_over_namespace_header_for_config(tmp_path, monkeypatch):
    import app_runtime

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    client = _auth_client("daily-chat-session-user")
    spoofed_headers = {"X-Attuno-User-Token": "spoofed-token"}

    save_response = client.post(
        "/api/config/save",
        data={
            "analysis_provider_name": "Session Chat",
            "analysis_api_format": "openai",
            "analysis_base_url": "https://session-chat.example/v1",
            "analysis_api_key": "session-chat-key",
            "analysis_model": "session-chat-model",
            "img_provider_name": "Session Image",
            "img_api_format": "openai_image",
            "img_base_url": "https://session-image.example/v1",
            "img_api_key": "session-image-key",
            "img_model": "gpt-image-2",
        },
        headers=spoofed_headers,
    )
    assert save_response.status_code == 200
    assert app_runtime.get_config("spoofed-token").llm.api_key == ""

    calls = []

    class FakeChatAdapter:
        async def chat(self, messages, **kwargs):
            calls.append({"messages": messages, "kwargs": kwargs, "cfg": self.cfg})
            return "session scoped reply"

    def fake_build_adapter(cfg, role):
        assert role == "llm"
        adapter = FakeChatAdapter()
        adapter.cfg = cfg
        return adapter

    monkeypatch.setattr(app_runtime, "build_adapter", fake_build_adapter)

    response = client.post(
        "/api/chat",
        json={
            "message": "今天正常聊一下",
            "project_id": "p-chat",
            "context": {"workspace_mode": "chat"},
        },
        headers=spoofed_headers,
    )

    assert response.status_code == 200
    assert response.json()["reply"] == "session scoped reply"
    assert calls
    assert calls[0]["cfg"].provider_name == "Session Chat"
    assert calls[0]["cfg"].model == "session-chat-model"
    assert calls[0]["cfg"].api_key == "session-chat-key"


def test_daily_chat_non_default_user_missing_key_does_not_fallback_to_workspace_key(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    config_path, env_path = _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    config_data = json.loads(config_path.read_text(encoding="utf-8"))
    config_data["llm"]["provider_name"] = "Workspace Analysis"
    config_data["llm"]["api_format"] = "openai"
    config_data["llm"]["base_url"] = "https://workspace-analysis.example/v1"
    config_data["llm"]["model"] = "workspace-analysis-model"
    config_path.write_text(json.dumps(config_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    env_path.write_text("LLM_API_KEY=workspace-analysis-key\nVISION_API_KEY=workspace-vision-key\n", encoding="utf-8")
    client = _auth_client("daily-chat-missing-key-user")

    response = client.post(
        "/api/chat",
        json={
            "message": "今天正常聊一下",
            "project_id": "p-chat",
            "context": {"workspace_mode": "chat"},
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "chat"
    assert "请先为当前用户保存自己的 API Key" in payload["error"]
    assert ".env" not in payload["error"]


def test_chat_memory_endpoint_saves_extracted_memory(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("config-save-user")

    chat = client.post(
        "/api/chat",
        json={"message": "记住我喜欢轻盈温馨，避免红金，以后结构还原第一", "project_id": "p-chat"},
    ).json()
    response = client.post("/api/chat/memory", json={"project_id": "p-chat", "memory_candidate": chat["memory_candidate"]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert "轻盈" in payload["preferences"]["user_style_preferences"]["explicit"]
    assert "红金" in payload["preferences"]["user_style_preferences"]["avoid"]
    assert any("结构" in item for item in payload["preferences"]["preference_summary"]["evaluation_standards"])


def test_memory_items_can_be_viewed_edited_and_deleted(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("memory-crud-user")

    chat = client.post(
        "/api/chat",
        json={"message": "记住我喜欢轻盈温馨，避免红金，以后结构还原第一", "project_id": "p-chat"},
    ).json()
    save_response = client.post("/api/chat/memory", json={"project_id": "p-chat", "memory_candidate": chat["memory_candidate"]})
    memory_response = client.get("/api/preferences/memory?project_id=p-chat")

    assert save_response.status_code == 200
    assert memory_response.status_code == 200
    memory = memory_response.json()["memory"]
    sections = {section["id"]: section for section in memory["sections"]}
    assert sections["daily_memories"]["items"]
    assert sections["long_term_preferences"]["items"]
    assert sections["avoid_items"]["items"]
    assert sections["evaluation_standards"]["items"]

    preference_item = sections["long_term_preferences"]["items"][0]
    update_response = client.patch(
        f"/api/preferences/memory/{preference_item['id']}",
        json={"project_id": "p-chat", "text": "轻盈温馨但不要过度装饰"},
    )
    assert update_response.status_code == 200
    updated_texts = [
        item["text"]
        for section in update_response.json()["memory"]["sections"]
        for item in section["items"]
    ]
    assert "轻盈温馨但不要过度装饰" in updated_texts

    delete_response = client.delete(f"/api/preferences/memory/{preference_item['id']}?project_id=p-chat")
    assert delete_response.status_code == 200
    deleted_texts = [
        item["text"]
        for section in delete_response.json()["memory"]["sections"]
        for item in section["items"]
    ]
    assert "轻盈温馨但不要过度装饰" not in deleted_texts


def test_preference_event_endpoint_updates_behavior_summary(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("config-load-user")

    response = client.post(
        "/api/preferences/events",
        json={
            "event_type": "compare",
            "project_id": "p-pref",
            "result_id": "result-123",
            "payload": {"edit_instruction": "保留结构，灯光更暖一点"},
        },
    )
    profile = client.get("/api/preferences/style-profile?project_id=p-pref")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert profile.status_code == 200
    payload = profile.json()["profile"]
    assert "behavior_summary" in payload
    assert payload["behavior_summary"]["frequent_edit_requests"] == []


def test_config_verify_analysis_returns_validation_error_for_unsupported_format(tmp_path, monkeypatch):
    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    client = _auth_client("results-user")

    response = client.post(
        "/api/config/verify-analysis",
        data={"api_format": "unsupported_format", "api_key": "x", "model": "demo-model"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "verify-analysis"
    assert "暂未实现" in payload["error"]


def test_default_workspace_config_save_persists_analysis_image_config_and_env(tmp_path, monkeypatch):
    _patch_runtime_files(monkeypatch, tmp_path)
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


def test_config_load_returns_saved_project_config(tmp_path, monkeypatch):
    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    client = _auth_client("colored-user")

    response = client.get("/api/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["config"]["imageModel"] == "gpt-image-2"
    assert "analysisApiFormat" in payload["config"]


def test_image_api_format_save_and_load_preserves_openai_image_option(tmp_path, monkeypatch):
    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    client = _auth_client("openai-image-format-user")

    response = client.post(
        "/api/config/save",
        data={
            "analysis_provider_name": "Analysis",
            "analysis_api_format": "openai",
            "analysis_base_url": "https://analysis.example/v1",
            "analysis_api_key": "analysis-key",
            "analysis_model": "gpt-4o",
            "img_provider_name": "Image",
            "img_api_format": "openai_image",
            "img_base_url": "https://image.example/v1",
            "img_api_key": "image-key",
            "img_model": "gpt-image-2",
        },
    )
    load_response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert load_response.status_code == 200
    payload = load_response.json()
    assert payload["ok"] is True
    assert payload["config"]["analysisApiFormat"] == "openai"
    assert payload["config"]["imageApiFormat"] == "openai_image"


def test_image_api_format_save_and_load_preserves_custom_openai_image_option(tmp_path, monkeypatch):
    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    client = _auth_client("custom-openai-image-format-user")

    response = client.post(
        "/api/config/save",
        data={
            "analysis_provider_name": "Analysis",
            "analysis_api_format": "custom",
            "analysis_base_url": "https://analysis.example/v1",
            "analysis_api_key": "analysis-key",
            "analysis_model": "gpt-4o",
            "img_provider_name": "Image",
            "img_api_format": "custom_openai_image",
            "img_base_url": "https://image.example/v1",
            "img_api_key": "image-key",
            "img_model": "gpt-image-2",
        },
    )
    load_response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert load_response.status_code == 200
    payload = load_response.json()
    assert payload["ok"] is True
    assert payload["config"]["analysisApiFormat"] == "custom"
    assert payload["config"]["imageApiFormat"] == "custom_openai_image"


def test_fresh_token_namespace_load_inherits_default_config_without_exposing_keys(tmp_path, monkeypatch):
    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    config_data = json.loads(Path("config.json").read_text(encoding="utf-8"))
    config_data["llm"]["provider_name"] = "Workspace Analysis"
    config_data["llm"]["base_url"] = "https://analysis.workspace/v1"
    config_data["llm"]["model"] = "workspace-analysis-model"
    config_data["image_gen"]["provider_name"] = "Workspace Image"
    config_data["image_gen"]["base_url"] = "https://image.workspace/v1"
    config_data["image_gen"]["model"] = "workspace-image-model"
    Path("config.json").write_text(json.dumps(config_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(".env").write_text("LLM_API_KEY=workspace-analysis-key\nVISION_API_KEY=workspace-vision-key\nIMAGE_API_KEY=workspace-image-key\n", encoding="utf-8")
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app())

    response = client.get("/api/config", headers={"X-Attuno-User-Token": "fresh-token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["config"]["analysisProviderName"] == "Workspace Analysis"
    assert payload["config"]["analysisBaseUrl"] == "https://analysis.workspace/v1"
    assert payload["config"]["analysisModel"] == "workspace-analysis-model"
    assert payload["config"]["analysisApiKey"] == ""
    assert payload["config"]["imageProviderName"] == "Workspace Image"
    assert payload["config"]["imageBaseUrl"] == "https://image.workspace/v1"
    assert payload["config"]["imageModel"] == "workspace-image-model"
    assert payload["config"]["imageApiKey"] == ""


def test_token_namespace_config_save_and_load_are_isolated(tmp_path, monkeypatch):
    import app_runtime
    from backend.app.services.result_store import get_user_data_dir

    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app())

    alpha_headers = {"X-Attuno-User-Token": "alpha-token"}
    beta_headers = {"X-Attuno-User-Token": "beta-token"}
    response = client.post(
        "/api/config/save",
        headers=alpha_headers,
        data={
            "analysis_provider_name": "Alpha Analysis",
            "analysis_api_format": "openai_chat",
            "analysis_base_url": "https://alpha.example/v1",
            "analysis_api_key": "alpha-analysis-key",
            "analysis_model": "alpha-analysis-model",
            "img_provider_name": "Alpha Image",
            "img_api_format": "openai_chat",
            "img_base_url": "https://alpha-image.example/v1",
            "img_api_key": "alpha-image-key",
            "img_model": "alpha-image-model",
            "fallback_models_text": "alpha-fallback",
        },
    )
    alpha_load = client.get("/api/config", headers=alpha_headers)
    beta_load = client.get("/api/config", headers=beta_headers)

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert alpha_load.status_code == 200
    assert alpha_load.json()["config"]["analysisApiKey"] == "alpha-analysis-key"
    assert alpha_load.json()["config"]["imageApiKey"] == "alpha-image-key"
    assert beta_load.status_code == 200
    assert beta_load.json()["config"]["analysisApiKey"] == ""
    assert beta_load.json()["config"]["imageApiKey"] == ""
    legacy_config = json.loads(Path("config.json").read_text(encoding="utf-8"))
    assert legacy_config["llm"].get("api_key") != "alpha-analysis-key"
    assert legacy_config["image_gen"].get("api_key") != "alpha-image-key"
    assert not Path(".env").exists()

    saved_path = get_user_data_dir("alpha-token") / "config" / "config.json"
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    assert saved["llm"]["api_key"] == "alpha-analysis-key"
    assert saved["llm"]["api_key_env"] == ""
    assert saved["image_gen"]["api_key"] == "alpha-image-key"

    cfg = app_runtime._build_runtime_config(
        1,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        2,
        2,
        validate_analysis=False,
        user_id="alpha-token",
    )
    assert cfg.image_gen.api_key == "alpha-image-key"
    assert cfg.image_gen.model == "alpha-image-model"


def test_authenticated_user_config_save_and_load_are_isolated(tmp_path, monkeypatch):
    import app_runtime
    from backend.app.services.result_store import get_user_data_dir

    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    alice_client = _auth_client("alice-user")
    bob_client = _auth_client("bob-user")

    response = alice_client.post(
        "/api/config/save",
        data={
            "analysis_provider_name": "Alice Analysis",
            "analysis_api_format": "openai_chat",
            "analysis_base_url": "https://alice-analysis.example/v1",
            "analysis_api_key": "alice-analysis-key",
            "analysis_model": "alice-analysis-model",
            "img_provider_name": "Alice Image",
            "img_api_format": "openai_chat",
            "img_base_url": "https://alice-image.example/v1",
            "img_api_key": "alice-image-key",
            "img_model": "alice-image-model",
            "fallback_models_text": "alice-fallback",
        },
    )
    alice_load = alice_client.get("/api/config")
    bob_load = bob_client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert alice_load.status_code == 200
    assert alice_load.json()["config"]["analysisApiKey"] == "alice-analysis-key"
    assert alice_load.json()["config"]["imageApiKey"] == "alice-image-key"
    assert bob_load.status_code == 200
    assert bob_load.json()["config"]["analysisApiKey"] == ""
    assert bob_load.json()["config"]["imageApiKey"] == ""

    legacy_config = json.loads(Path("config.json").read_text(encoding="utf-8"))
    assert legacy_config["llm"].get("api_key") != "alice-analysis-key"
    assert legacy_config["image_gen"].get("api_key") != "alice-image-key"
    assert not Path(".env").exists()

    saved_path = get_user_data_dir("alice-user") / "config" / "config.json"
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    assert saved["llm"]["api_key"] == "alice-analysis-key"
    assert saved["llm"]["api_key_env"] == ""
    assert saved["image_gen"]["api_key"] == "alice-image-key"
    assert saved["image_gen"]["api_key_env"] == ""

    cfg = app_runtime._build_runtime_config(
        1,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        2,
        2,
        validate_analysis=False,
        user_id="alice-user",
    )
    assert cfg.llm.api_key == "alice-analysis-key"
    assert cfg.llm.model == "alice-analysis-model"
    assert cfg.image_gen.api_key == "alice-image-key"
    assert cfg.image_gen.model == "alice-image-model"


def test_fresh_non_default_user_cannot_fallback_to_workspace_keys_at_runtime(tmp_path, monkeypatch):
    import app_runtime

    _patch_runtime_files(monkeypatch, tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    config_data = json.loads(Path("config.json").read_text(encoding="utf-8"))
    config_data["llm"]["provider_name"] = "Workspace Analysis"
    config_data["llm"]["base_url"] = "https://analysis.workspace/v1"
    config_data["llm"]["model"] = "workspace-analysis-model"
    config_data["image_gen"]["provider_name"] = "Workspace Image"
    config_data["image_gen"]["base_url"] = "https://image.workspace/v1"
    config_data["image_gen"]["model"] = "workspace-image-model"
    Path("config.json").write_text(json.dumps(config_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(".env").write_text(
        "LLM_API_KEY=workspace-analysis-key\nVISION_API_KEY=workspace-vision-key\nIMAGE_API_KEY=workspace-image-key\n",
        encoding="utf-8",
    )
    client = TestClient(create_app())

    config_response = client.get("/api/config", headers={"X-Attuno-User-Token": "fresh-token"})
    assert config_response.status_code == 200
    config_payload = config_response.json()
    assert config_payload["config"]["analysisProviderName"] == "Workspace Analysis"
    assert config_payload["config"]["analysisModel"] == "workspace-analysis-model"
    assert config_payload["config"]["analysisApiKey"] == ""
    assert config_payload["config"]["imageProviderName"] == "Workspace Image"
    assert config_payload["config"]["imageModel"] == "workspace-image-model"
    assert config_payload["config"]["imageApiKey"] == ""

    cfg = app_runtime.get_config("fresh-token")
    assert cfg.llm.provider_name == "Workspace Analysis"
    assert cfg.llm.model == "workspace-analysis-model"
    assert cfg.llm.api_key == ""
    assert cfg.vision.api_key == ""
    assert cfg.image_gen.provider_name == "Workspace Image"
    assert cfg.image_gen.model == "workspace-image-model"
    assert cfg.image_gen.api_key == ""

    verify_response = client.post(
        "/api/config/verify-image",
        headers={"X-Attuno-User-Token": "fresh-token"},
    )

    assert verify_response.status_code == 400
    verify_payload = verify_response.json()
    assert verify_payload["ok"] is False
    assert verify_payload["stage"] == "verify-image"
    assert "请先为当前用户保存自己的 API Key" in verify_payload["error"]
    assert ".env" not in verify_payload["error"]

    response = client.post(
        "/api/generate",
        data={"mode": "standard", "requirement": "make a room"},
        headers={"X-Attuno-User-Token": "fresh-token"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "generation"
    assert "画图模型 配置缺少 API Key" in payload["error"]
    assert "请先为当前用户保存自己的 API Key" in payload["error"]
    assert ".env" not in payload["error"]


def _write_test_png(path: Path):
    path.write_bytes(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
            "0000000c49444154789c6360f8cf000003010100c9fe92ef0000000049454e44ae426082"
        )
    )


def test_results_endpoints_persist_serve_and_delete_images(tmp_path, monkeypatch):
    from backend.app.services.result_store import create_result

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)

    created = create_result(
        title="Demo render",
        status="生成成功",
        image_path=str(image_path),
        image_label="demo-label",
        prompt="prompt text",
        evaluation="evaluation text",
        logs="log text",
        user_id="results-user",
    )
    client = _auth_client("results-user")

    response = client.get("/api/results")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["results"][0]["id"] == created["id"]
    assert payload["results"][0]["image_url"] == f"/api/results/{created['id']}/image"

    image_response = client.get(payload["results"][0]["image_url"])
    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == "image/png"

    delete_response = client.delete(f"/api/results/{created['id']}")
    assert delete_response.status_code == 200
    assert client.get("/api/results").json()["results"] == []


def test_result_notes_can_be_saved_without_blocking_generation_workspace(tmp_path, monkeypatch):
    from backend.app.services.result_store import create_result

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)
    created = create_result(
        title="Demo render",
        status="生成成功",
        image_path=str(image_path),
        image_label="demo-label",
        prompt="prompt text",
        evaluation="",
        logs="",
        user_id="default",
    )
    client = TestClient(create_app())

    response = client.patch(f"/api/results/{created['id']}/notes", json={"notes": "圈出区域下次改浅色"})
    listed = client.get("/api/results")

    assert response.status_code == 200
    assert response.json()["result"]["notes"] == "圈出区域下次改浅色"
    assert listed.json()["results"][0]["notes"] == "圈出区域下次改浅色"


def test_relative_data_dir_is_project_root_based(monkeypatch):
    from backend.app.services.result_store import get_data_dir

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", "relative-data")
    project_root = Path(__file__).resolve().parents[1]

    assert get_data_dir() == (project_root / "relative-data").resolve()


def test_legacy_render_agent_data_dir_env_alias_is_supported(tmp_path, monkeypatch):
    from backend.app.services.result_store import get_data_dir

    monkeypatch.delenv("ATTUNO_STUDIO_DATA_DIR", raising=False)
    monkeypatch.setenv("RENDER_AGENT_DATA_DIR", str(tmp_path / "legacy-data"))

    assert get_data_dir() == (tmp_path / "legacy-data").resolve()


def test_generate_endpoint_returns_persisted_result_urls(tmp_path, monkeypatch):
    from backend.app.services import generation_service

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)

    def fake_run_pipeline(*_args, **_kwargs):
        yield (
            str(image_path),
            [(str(image_path), "demo render")],
            "生成成功",
            "floor desc",
            "prompt text",
            "evaluation text",
            "log text",
        )

    monkeypatch.setattr(generation_service, "run_pipeline", fake_run_pipeline)
    client = _auth_client("annotated-user")

    response = client.post("/api/generate", data={"requirement": "make a room"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["results"][0]["image_url"].startswith("/api/results/result-")
    assert payload["results"][0]["download_url"].endswith("/download")
    assert payload["results"][0]["floor_desc"] == "floor desc"
    assert payload["results"][0]["generation_mode"] == "standard"
    assert payload["images"][0]["url"] == payload["results"][0]["image_url"]
    assert client.get(payload["results"][0]["image_url"]).status_code == 200


def test_unauthenticated_core_endpoints_use_default_workspace(tmp_path, monkeypatch):
    from backend.app.services import generation_service

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)

    def fake_run_pipeline(*_args, **_kwargs):
        yield (
            str(image_path),
            [(str(image_path), "default workspace render")],
            "生成成功",
            "floor desc",
            "prompt text",
            "",
            "",
        )

    monkeypatch.setattr(generation_service, "run_pipeline", fake_run_pipeline)
    client = TestClient(create_app())

    me_response = client.get("/api/auth/me")
    generate_response = client.post("/api/generate", data={"requirement": "make a room"})
    results_response = client.get("/api/results")
    shortcuts_response = client.get("/api/preferences/shortcuts")
    chat_response = client.post("/api/chat", json={"message": "把空间改得更温馨"})
    logout_response = client.post("/api/auth/logout")

    assert me_response.status_code == 200
    assert me_response.json()["authenticated"] is False
    assert generate_response.status_code == 200
    generated = generate_response.json()["results"][0]
    assert generated["user_id"] == "default"
    assert results_response.status_code == 200
    assert results_response.json()["results"][0]["id"] == generated["id"]
    assert shortcuts_response.status_code == 200
    assert shortcuts_response.json()["ok"] is True
    assert chat_response.status_code == 200
    assert chat_response.json()["ok"] is True
    assert logout_response.status_code == 200
    assert logout_response.json()["ok"] is True


def test_authenticated_results_do_not_include_default_workspace_items(tmp_path, monkeypatch):
    from backend.app.services.result_store import create_result

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)

    default_item = create_result(
        title="Default render",
        status="生成成功",
        image_path=str(image_path),
        image_label="default-label",
        prompt="prompt text",
        evaluation="",
        logs="",
        user_id="default",
    )
    user_item = create_result(
        title="User render",
        status="生成成功",
        image_path=str(image_path),
        image_label="user-label",
        prompt="prompt text",
        evaluation="",
        logs="",
        user_id="private-user",
    )
    client = _auth_client("private-user")

    response = client.get("/api/results")

    assert response.status_code == 200
    ids = [item["id"] for item in response.json()["results"]]
    assert user_item["id"] in ids
    assert default_item["id"] not in ids


def test_token_namespace_isolates_unauthenticated_results(tmp_path, monkeypatch):
    from backend.app.services.result_store import create_result

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)
    alpha_item = create_result(
        title="Alpha render",
        status="生成成功",
        image_path=str(image_path),
        image_label="alpha-label",
        prompt="prompt text",
        evaluation="",
        logs="",
        user_id="alpha-token",
    )
    beta_item = create_result(
        title="Beta render",
        status="生成成功",
        image_path=str(image_path),
        image_label="beta-label",
        prompt="prompt text",
        evaluation="",
        logs="",
        user_id="beta-token",
    )
    client = TestClient(create_app())

    alpha_response = client.get("/api/results", headers={"X-Attuno-User-Token": "alpha-token"})
    beta_image_response = client.get(f"/api/results/{beta_item['id']}/image?user_id=beta-token")
    alpha_image_response = client.get(f"/api/results/{alpha_item['id']}/image?user_id=beta-token")

    assert alpha_response.status_code == 200
    ids = [item["id"] for item in alpha_response.json()["results"]]
    assert alpha_item["id"] in ids
    assert beta_item["id"] not in ids
    assert beta_image_response.status_code == 200
    assert alpha_image_response.status_code == 404


def test_token_namespace_isolates_shortcuts_and_generated_results(tmp_path, monkeypatch):
    from backend.app.services import generation_service

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    _write_test_png(image_path)
    captured = {}

    def fake_run_pipeline(*_args, **kwargs):
        captured["user_id"] = kwargs.get("user_id")
        yield (
            str(image_path),
            [(str(image_path), "token render")],
            "生成成功",
            "",
            "prompt text",
            "",
            "",
        )

    monkeypatch.setattr(generation_service, "run_pipeline", fake_run_pipeline)
    client = TestClient(create_app())

    alpha_headers = {"X-Attuno-User-Token": "alpha-token"}
    beta_headers = {"X-Attuno-User-Token": "beta-token"}
    shortcuts = [{"id": "custom-alpha", "zh": "暖色木质", "en": "warm wood"}]

    save_shortcuts = client.put("/api/preferences/shortcuts", json={"shortcuts": shortcuts}, headers=alpha_headers)
    alpha_shortcuts = client.get("/api/preferences/shortcuts", headers=alpha_headers)
    beta_shortcuts = client.get("/api/preferences/shortcuts", headers=beta_headers)
    generate_response = client.post(
        "/api/generate",
        data={"mode": "standard", "requirement": "make a room"},
        headers=alpha_headers,
    )
    alpha_results = client.get("/api/results", headers=alpha_headers)
    beta_results = client.get("/api/results", headers=beta_headers)

    assert save_shortcuts.status_code == 200
    assert alpha_shortcuts.json()["shortcuts"] == shortcuts
    assert beta_shortcuts.json()["shortcuts"] == []
    assert generate_response.status_code == 200
    generated = generate_response.json()["results"][0]
    assert generated["user_id"] == "alpha-token"
    assert captured["user_id"] == "alpha-token"
    assert [item["id"] for item in alpha_results.json()["results"]] == [generated["id"]]
    assert beta_results.json()["results"] == []


def test_legacy_render_agent_namespace_header_is_supported(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app())
    legacy_headers = {"X-Render-Agent-User-Token": "legacy-token"}
    attuno_headers = {"X-Attuno-User-Token": "legacy-token"}
    shortcuts = [{"id": "legacy-shortcut", "zh": "旧调用兼容", "en": "legacy compatibility"}]

    save_response = client.put("/api/preferences/shortcuts", json={"shortcuts": shortcuts}, headers=legacy_headers)
    attuno_response = client.get("/api/preferences/shortcuts", headers=attuno_headers)

    assert save_response.status_code == 200
    assert attuno_response.status_code == 200
    assert attuno_response.json()["shortcuts"] == shortcuts


def test_authenticated_session_takes_priority_over_namespace_header(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("session-priority-user")
    namespace_headers = {"X-Attuno-User-Token": "spoofed-token"}
    shortcuts = [{"id": "session-shortcut", "zh": "账号内短语", "en": "account phrase"}]

    save_response = client.put("/api/preferences/shortcuts", json={"shortcuts": shortcuts}, headers=namespace_headers)
    session_response = client.get("/api/preferences/shortcuts")
    anonymous_namespace_response = TestClient(create_app()).get("/api/preferences/shortcuts", headers=namespace_headers)
    me_response = client.get("/api/auth/me", headers=namespace_headers)

    assert save_response.status_code == 200
    assert session_response.json()["shortcuts"] == shortcuts
    assert anonymous_namespace_response.json()["shortcuts"] == []
    assert me_response.status_code == 200
    assert me_response.json()["authenticated"] is True
    assert me_response.json()["user"]["user_id"] == "session-priority-user"


def test_generate_endpoint_passes_colored_floor_plan_mode_to_runtime(tmp_path, monkeypatch):
    from backend.app.services import generation_service

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    floor_plan = tmp_path / "floor.png"
    _write_test_png(image_path)
    _write_test_png(floor_plan)
    captured = {}

    def fake_run_pipeline(mode, floor_plan_paths, reference_path, *_args, **_kwargs):
        captured["mode"] = mode
        captured["floor_plan_count"] = len(floor_plan_paths)
        captured["reference_path"] = reference_path
        yield (
            str(image_path),
            [(str(image_path), "colored plan")],
            "生成成功",
            "floor desc",
            "prompt text",
            "",
            "",
        )

    monkeypatch.setattr(generation_service, "run_pipeline", fake_run_pipeline)
    client = _auth_client("shortcuts-user")

    response = client.post(
        "/api/generate",
        data={"mode": "colored_floor_plan", "requirement": "清晰分区配色"},
        files={"floor_plans": ("floor.png", floor_plan.read_bytes(), "image/png")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert captured == {"mode": "colored_floor_plan", "floor_plan_count": 1, "reference_path": None}
    assert payload["results"][0]["generation_mode"] == "colored_floor_plan"
    assert payload["results"][0]["floor_plan_url"].endswith("/floor-plan")
    assert client.get(payload["results"][0]["floor_plan_url"]).status_code == 200


def test_generate_endpoint_passes_project_memory_context_to_runtime(tmp_path, monkeypatch):
    from backend.app.services import generation_service

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    image_path = tmp_path / "render.png"
    floor_plan = tmp_path / "floor.png"
    _write_test_png(image_path)
    _write_test_png(floor_plan)
    client = _auth_client("reference-user")
    client.put(
        "/api/preferences/style-profile",
        json={
            "project_id": "p-memory",
            "user_style_preferences": {"explicit": ["轻盈温馨"], "avoid": ["红金"]},
            "project_style_memory": {"structure": ["结构还原优先"], "materials": ["胡桃木"]},
        },
    )
    captured = {}

    def fake_run_pipeline(mode, floor_plan_paths, reference_path, *_args, **kwargs):
        captured["mode"] = mode
        captured["project_id"] = kwargs.get("project_id")
        captured["learned_preferences_text"] = kwargs.get("learned_preferences_text", "")
        yield (
            str(image_path),
            [(str(image_path), "demo render")],
            "生成成功",
            "floor desc",
            "prompt text",
            "",
            "",
        )

    monkeypatch.setattr(generation_service, "run_pipeline", fake_run_pipeline)

    response = client.post(
        "/api/generate",
        data={"project_id": "p-memory", "mode": "render3d", "requirement": "现代轻盈客厅"},
        files={"floor_plans": ("floor.png", floor_plan.read_bytes(), "image/png")},
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert captured["mode"] == "render3d"
    assert captured["project_id"] == "p-memory"
    assert "轻盈温馨" in captured["learned_preferences_text"]
    assert "结构还原优先" in captured["learned_preferences_text"]


def test_render3d_mode_requires_floor_plan(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("render3d-floor-required-user")

    response = client.post(
        "/api/generate",
        data={"mode": "render3d", "requirement": "现代轻盈客厅"},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["stage"] == "generation"
    assert "3D 效果图模式请至少上传一张平面图" in payload["error"]


def test_annotated_edit_persists_annotation_and_version_metadata(tmp_path, monkeypatch):
    from backend.app.services.result_store import create_result
    from backend.app.services import image_edit_service

    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    source_image = tmp_path / "source.png"
    edited_image = tmp_path / "edited.png"
    annotation_image = tmp_path / "annotation.png"
    _write_test_png(source_image)
    _write_test_png(edited_image)
    _write_test_png(annotation_image)
    source = create_result(
        title="Demo render",
        status="生成成功",
        image_path=str(source_image),
        image_label="demo-label",
        prompt="original prompt",
        evaluation="original evaluation",
        logs="original logs",
        user_id="annotated-user",
    )

    async def fake_analyze_annotation(*_args, **_kwargs):
        return {
            "marked_region": "沙发",
            "user_intent": "换成浅灰色",
            "preserve_regions": ["墙面", "窗户"],
            "edit_prompt": "只把沙发换成浅灰色，其他不变",
            "negative_prompt": "不要红圈、箭头、涂鸦",
        }

    def fake_run_edit_pipeline(*_args, **_kwargs):
        return (
            str(edited_image),
            [(str(edited_image), "edited render")],
            "生成成功",
            "",
            "edited prompt",
            "edited evaluation",
            "edited logs",
        )

    monkeypatch.setattr(image_edit_service, "_analyze_annotation", fake_analyze_annotation)
    monkeypatch.setattr(image_edit_service, "_resolve_reference_path", lambda _form, path: (str(path), "", "gpt-image-test"))
    monkeypatch.setattr(image_edit_service, "_run_edit_pipeline", fake_run_edit_pipeline)
    client = _auth_client("annotated-user")

    response = client.post(
        f"/api/results/{source['id']}/annotated-edit",
        data={"edit_instruction": "沙发换浅灰色"},
        files={"annotation_image": ("annotation.png", annotation_image.read_bytes(), "image/png")},
    )

    assert response.status_code == 200
    payload = response.json()
    result = payload["result"]
    assert result["parent_id"] == source["id"]
    assert result["generation_type"] == "edit"
    assert result["edit_mode"] == "annotation"
    assert result["version_index"] == 2
    assert result["annotation_url"].endswith("/annotation")
    assert result["annotation_analysis"]["marked_region"] == "沙发"
    assert result["source_prompt"] == "original prompt"
    assert client.get(result["annotation_url"]).status_code == 200


def test_progress_payload_exposes_stage_and_iteration_for_timeline():
    from backend.app.services.generation_service import build_progress_payload

    snapshot = (
        None,
        [],
        "第2轮：提示词已生成，开始出图",
        "floor desc",
        "第2轮正向提示词：\nmodern room",
        "",
        "[提示词已生成] 第2轮提示词已输出到右侧。",
    )

    payload = build_progress_payload(snapshot, max_iterations=5)

    assert payload["stage"] == "rendering"
    assert payload["iteration"] == 2
    assert payload["max_iterations"] == 5

    evaluating_snapshot = (
        object(),
        [],
        "第2轮：提示词已生成，开始出图",
        "floor desc",
        "第2轮正向提示词：\nmodern room",
        "",
        "[图片已生成] 第2轮图片已生成，等待评估。",
    )

    evaluating_payload = build_progress_payload(evaluating_snapshot, max_iterations=5)

    assert evaluating_payload["stage"] == "evaluating"
    assert evaluating_payload["has_images"] is True


def test_shortcut_preferences_are_persisted_in_backend_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = _auth_client("shortcut-user")
    shortcuts = [
        {"id": "custom-1", "zh": "暖色木质", "en": "warm wood"},
        {"id": "custom-2", "zh": "低机位", "en": "low camera"},
    ]

    save_response = client.put("/api/preferences/shortcuts", json={"shortcuts": shortcuts})
    load_response = client.get("/api/preferences/shortcuts")

    assert save_response.status_code == 200
    assert save_response.json()["ok"] is True
    assert load_response.status_code == 200
    assert load_response.json() == {"ok": True, "shortcuts": shortcuts}


def test_reference_image_preference_endpoints_are_removed(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(create_app())

    analysis_response = client.post(
        "/api/preferences/reference-analysis",
        files={"reference_image": ("large.png", b"0", "image/png")},
    )
    memory_response = client.post("/api/preferences/reference-memory", json={"analysis": {"style": "warm"}})

    assert analysis_response.status_code == 404
    assert memory_response.status_code == 404
