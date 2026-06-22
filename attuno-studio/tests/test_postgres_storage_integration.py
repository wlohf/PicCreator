import json
import os
from pathlib import Path
from uuid import uuid4

import pytest

from backend.app.services import db
from backend.app.services import auth_service
from backend.app.services import chat_history_store
from backend.app.services import preferences_store
from backend.app.services import result_store


def _test_database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "").strip()


pytestmark = pytest.mark.skipif(
    not _test_database_url(),
    reason="TEST_DATABASE_URL is not configured",
)


def _cleanup_user(user_id: str) -> None:
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM search_events WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM tavily_key_state WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM user_runtime_state WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM user_preferences WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM result_records WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM chat_histories WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM auth_sessions WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
        conn.commit()


def _fetch_one(sql: str, params: tuple[str, ...]) -> dict | None:
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def _write_png(path: Path) -> None:
    path.write_bytes(
        bytes.fromhex(
            "89504E470D0A1A0A0000000D4948445200000001000000010802000000907753DE"
            "0000000C4944415408D763F8FFFF3F0005FE02FEA73581E20000000049454E44AE426082"
        )
    )


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


@pytest.fixture()
def postgres_storage(monkeypatch, tmp_path):
    user_id = result_store.normalize_user_id(f"pg-migration-{uuid4().hex[:10]}")
    monkeypatch.setenv("DATABASE_URL", _test_database_url())
    monkeypatch.setenv("ATTUNO_ENV", "test")
    monkeypatch.setenv("ATTUNO_STUDIO_DATA_DIR", str(tmp_path / "data"))
    db.reset_database_state_for_tests()
    status = db.initialize_database()
    if not status.get("ok"):
        pytest.skip(f"TEST_DATABASE_URL is not usable: {status.get('error')}")
    _cleanup_user(user_id)
    yield user_id, tmp_path
    _cleanup_user(user_id)
    db.reset_database_state_for_tests()


def test_accounts_chat_results_and_preferences_use_postgres(postgres_storage):
    user_id, tmp_path = postgres_storage
    password = "password123"
    image_path = tmp_path / "source.png"
    _write_png(image_path)

    registered = auth_service.register_user(user_id, password)
    authenticated = auth_service.authenticate_user(user_id, password)
    session_id = auth_service.create_session(authenticated)

    history = chat_history_store.save_chat_history(
        {
            "currentSessionId": "session-a",
            "sessions": [
                {
                    "id": "session-a",
                    "title": "Postgres chat",
                    "messages": [{"role": "user", "content": "hello db"}],
                }
            ],
        },
        user_id,
    )

    result = result_store.create_result(
        title="DB result",
        status="success",
        image_path=str(image_path),
        image_label="db-image",
        prompt="A database backed result",
        evaluation="ok",
        logs="",
        notes="initial note",
        user_id=user_id,
    )
    updated_result = result_store.update_result_notes(result["id"], "updated note", user_id)
    deleted = result_store.delete_result(result["id"], user_id)

    shortcuts = preferences_store.save_shortcuts(
        [{"id": "warm", "zh": "暖色木质", "en": "warm wood"}],
        user_id,
    )
    skills = preferences_store.save_prompt_skills(
        [{"id": "landscape", "name": "风景图", "prompt": "扩展：{prompt}"}],
        user_id,
    )
    memory = preferences_store.create_memory_item("喜欢浅色木材", user_id=user_id)

    assert registered["user_id"] == user_id
    assert session_id
    assert history["currentSessionId"] == "session-a"
    assert updated_result and updated_result["notes"] == "updated note"
    assert deleted is True
    assert shortcuts[0]["id"] == "warm"
    assert skills[0]["id"] == "landscape"
    assert memory["sections"][1]["items"][0]["text"] == "喜欢浅色木材"

    user_row = _fetch_one(
        "SELECT username, password_salt, password_hash FROM users WHERE user_id = %s",
        (user_id,),
    )
    session_row = _fetch_one("SELECT user_id FROM auth_sessions WHERE session_id = %s", (session_id,))
    chat_row = _fetch_one("SELECT payload FROM chat_histories WHERE user_id = %s", (user_id,))
    result_row = _fetch_one(
        "SELECT payload, deleted_at FROM result_records WHERE user_id = %s AND result_id = %s",
        (user_id, result["id"]),
    )
    preferences_row = _fetch_one("SELECT payload FROM user_preferences WHERE user_id = %s", (user_id,))

    assert user_row and user_row["username"] == user_id
    assert user_row["password_salt"]
    assert user_row["password_hash"]
    assert password not in str(user_row)
    assert session_row == {"user_id": user_id}
    assert chat_row and chat_row["payload"]["currentSessionId"] == "session-a"
    assert result_row and result_row["payload"]["notes"] == "updated note"
    assert result_row["deleted_at"] is not None
    assert preferences_row and preferences_row["payload"]["shortcuts"][0]["id"] == "warm"
    assert preferences_row["payload"]["prompt_skills"][0]["id"] == "landscape"
    assert preferences_row["payload"]["user_style_preferences"]["explicit"][0] == "喜欢浅色木材"

    assert not auth_service._users_path().exists()
    assert not auth_service._sessions_path().exists()
    assert not chat_history_store.get_chat_history_path(user_id).exists()
    assert not result_store.get_index_path(user_id).exists()
    assert not preferences_store.get_preferences_path(user_id).exists()


def test_existing_json_payloads_are_lazily_imported_to_postgres(postgres_storage):
    user_id, tmp_path = postgres_storage
    password = "password123"
    salt, password_hash = auth_service._hash_password(password)
    expires_at = "2099-01-01T00:00:00+00:00"
    result_id = "legacy-result-1"

    _write_json(
        auth_service._users_path(),
        [
            {
                "user_id": user_id,
                "username": user_id,
                "password_salt": salt,
                "password_hash": password_hash,
                "created_at": "2026-06-22T00:00:00+00:00",
            }
        ],
    )
    _write_json(
        auth_service._sessions_path(),
        {
            "legacy-session": {
                "user_id": user_id,
                "username": user_id,
                "expires_at": expires_at,
            }
        },
    )
    _write_json(
        chat_history_store.get_chat_history_path(user_id),
        {
            "currentSessionId": "legacy-chat",
            "sessions": [{"id": "legacy-chat", "title": "Legacy chat", "messages": []}],
        },
    )
    _write_json(
        result_store.get_index_path(user_id),
        [
            {
                "id": result_id,
                "title": "Legacy result",
                "status": "success",
                "filename": "legacy.png",
                "created_at": "2026-06-22T00:00:00+00:00",
                "user_id": user_id,
            }
        ],
    )
    _write_json(
        preferences_store.get_preferences_path(user_id),
        {
            "shortcuts": [{"id": "legacy-shortcut", "zh": "旧快捷词", "en": "legacy"}],
            "prompt_skills": [{"id": "legacy-skill", "name": "旧技能", "prompt": "旧模板 {prompt}"}],
        },
    )

    assert auth_service.authenticate_user(user_id, password)["user_id"] == user_id
    assert auth_service._prune_and_get_session("legacy-session")["user_id"] == user_id
    assert chat_history_store.load_chat_history(user_id)["currentSessionId"] == "legacy-chat"
    assert result_store.get_result(result_id, user_id)["title"] == "Legacy result"
    assert preferences_store.load_shortcuts(user_id)[0]["id"] == "legacy-shortcut"
    assert preferences_store.load_prompt_skills(user_id)[0]["id"] == "legacy-skill"

    assert _fetch_one("SELECT username FROM users WHERE user_id = %s", (user_id,)) == {"username": user_id}
    assert _fetch_one("SELECT user_id FROM auth_sessions WHERE session_id = %s", ("legacy-session",)) == {"user_id": user_id}
    assert _fetch_one("SELECT payload FROM chat_histories WHERE user_id = %s", (user_id,))["payload"]["currentSessionId"] == "legacy-chat"
    assert _fetch_one(
        "SELECT payload FROM result_records WHERE user_id = %s AND result_id = %s",
        (user_id, result_id),
    )["payload"]["title"] == "Legacy result"
    assert _fetch_one("SELECT payload FROM user_preferences WHERE user_id = %s", (user_id,))["payload"]["shortcuts"][0]["id"] == "legacy-shortcut"

    assert auth_service._users_path().exists()
    assert auth_service._sessions_path().exists()
    assert chat_history_store.get_chat_history_path(user_id).exists()
    assert result_store.get_index_path(user_id).exists()
    assert preferences_store.get_preferences_path(user_id).exists()
