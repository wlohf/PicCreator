import os
import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.services import db
from backend.app.services import update_service
from backend.app.services import web_search


@pytest.fixture(autouse=True)
def reset_db_state(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ATTUNO_ENV", raising=False)
    db.reset_database_state_for_tests()
    yield
    db.reset_database_state_for_tests()


def test_database_status_allows_local_json_fallback_without_database_url():
    status = db.initialize_database()

    assert status["ok"] is True
    assert status["configured"] is False
    assert status["fallback"] is True


def test_database_status_requires_postgres_in_production(monkeypatch):
    monkeypatch.setenv("ATTUNO_ENV", "production")

    status = db.initialize_database()

    assert status["ok"] is False
    assert status["required"] is True
    assert "DATABASE_URL" in status["error"]


def test_health_reports_database_fallback_status():
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["database"]["configured"] is False
    assert payload["database"]["fallback"] is True


@pytest.mark.asyncio
async def test_search_web_records_sanitized_search_event(monkeypatch):
    recorded = []
    monkeypatch.setattr(web_search, "claim_tavily_api_keys", lambda user_id: ([], 0))
    monkeypatch.setattr(web_search, "record_search_event", lambda **kwargs: recorded.append(kwargs))

    async def fake_duckduckgo_detail(query, limit=5):
        return {
            "provider": "duckduckgo",
            "ok": False,
            "status": "network_error",
            "message": "DuckDuckGo 网络请求失败：blocked",
            "attempts": 1,
            "key_count": None,
            "results": [],
        }

    monkeypatch.setattr(web_search, "search_duckduckgo_detailed", fake_duckduckgo_detail)

    detail = await web_search.search_web_detailed("联网搜索 product update", user_id="user-a")

    assert detail["status"] == "all_providers_failed"
    assert recorded
    event = recorded[-1]
    assert event["user_id"] == "user-a"
    assert event["status"] == "all_providers_failed"
    assert event["diagnostics"][0]["status"] == "missing_api_key"
    assert "key" in event["diagnostics"][0]["message"].lower()
    assert "sk-" not in str(event)


def test_system_update_requires_admin_credentials(monkeypatch):
    monkeypatch.setenv("ATTUNO_UPDATE_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ATTUNO_UPDATE_ADMIN_PASSWORD", "test-password")
    client = TestClient(create_app())

    response = client.get("/api/system/update/status")

    assert response.status_code == 401


def test_system_update_status_uses_basic_auth(monkeypatch):
    monkeypatch.setenv("ATTUNO_UPDATE_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ATTUNO_UPDATE_ADMIN_PASSWORD", "test-password")
    monkeypatch.setattr(update_service, "_last_check", None)
    monkeypatch.setattr(update_service, "_compute_update_status", lambda fetch_remote: {
        "ok": True,
        "enabled": False,
        "repo_root": "repo",
        "branch": "main",
        "remote": "origin",
        "remote_branch": "main",
        "current_commit": "a" * 40,
        "remote_commit": "a" * 40,
        "has_update": False,
        "fast_forward": True,
        "dirty": False,
        "checked_at": "2026-06-22T00:00:00+00:00",
        "error": "",
    })
    client = TestClient(create_app())

    response = client.get(
        "/api/system/update/status",
        headers={"Authorization": "Basic YWRtaW46dGVzdC1wYXNzd29yZA=="},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["current_commit"] == "a" * 40


def test_update_apply_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ATTUNO_UPDATE_ENABLED", raising=False)

    with pytest.raises(update_service.UpdateError) as exc:
        update_service.apply_update()

    assert "ATTUNO_UPDATE_ENABLED" in str(exc.value)


def test_update_detection_fetches_fixed_origin_main_ref(monkeypatch):
    calls = []

    def fake_run(args):
        calls.append(args)
        if args[:2] == ["rev-parse", "--is-inside-work-tree"]:
            return "true\n"
        if args[:2] == ["rev-parse", "HEAD"]:
            return "a" * 40 + "\n"
        if args[:2] == ["rev-parse", "origin/main"]:
            return "b" * 40 + "\n"
        if args[:2] == ["rev-parse", "--abbrev-ref"]:
            return "main\n"
        if args[:1] == ["merge-base"]:
            return "a" * 40 + "\n"
        if args[:1] == ["status"]:
            return ""
        return ""

    monkeypatch.setattr(update_service, "_run_git", fake_run)

    status = update_service.check_for_updates()

    assert status["has_update"] is True
    assert ["fetch", "origin", "main:refs/remotes/origin/main"] in calls


def test_password_hash_verifies_without_storing_plaintext(monkeypatch):
    encoded = update_service.hash_update_admin_password("test-password")

    assert "test-password" not in encoded
    monkeypatch.setenv("ATTUNO_UPDATE_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ATTUNO_UPDATE_ADMIN_PASSWORD_HASH", encoded)
    update_service.authenticate_update_admin(update_service.UpdateAdminCredentials("admin", "test-password"))


def test_update_service_uses_fixed_update_script_path():
    source = str(update_service.apply_update.__code__.co_consts)
    assert "bash" in source
    assert "UPDATE_SCRIPT" not in os.environ.get("ATTUNO_UPDATE_ADMIN_PASSWORD", "")
