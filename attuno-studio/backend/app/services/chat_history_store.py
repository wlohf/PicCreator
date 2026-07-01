import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from backend.app.services import db
from backend.app.services.result_store import get_data_dir, get_user_data_dir, normalize_user_id


_lock = Lock()
_MAX_SESSIONS = 100


def get_chat_history_path(user_id: str = "default") -> Path:
    if str(user_id or "default") == "default":
        legacy = get_data_dir() / "chat_history.json"
        namespaced = get_user_data_dir(user_id) / "chat_history.json"
        if legacy.exists() and not namespaced.exists():
            return legacy
    return get_user_data_dir(user_id) / "chat_history.json"


def _empty_chat_history() -> dict[str, Any]:
    return {
        "currentSessionId": "",
        "sessions": [],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _ensure_chat_history(user_id: str = "default") -> None:
    get_user_data_dir(user_id).mkdir(parents=True, exist_ok=True)
    path = get_chat_history_path(user_id)
    if not path.exists():
        path.write_text(json.dumps(_empty_chat_history(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _use_database_storage() -> bool:
    return db.structured_storage_enabled()


def _read_chat_history_json(user_id: str = "default", *, create: bool = True) -> dict[str, Any]:
    if create:
        _ensure_chat_history(user_id)
    path = get_chat_history_path(user_id)
    if not path.exists():
        return _empty_chat_history()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def _load_chat_history_db(user_id: str = "default") -> dict[str, Any]:
    normalized_user = normalize_user_id(user_id)
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT payload FROM chat_histories WHERE user_id = %s", (normalized_user,))
            row = cur.fetchone()
    if row:
        return _normalize_chat_history(row.get("payload"))
    if get_chat_history_path(user_id).exists():
        imported = _normalize_chat_history(_read_chat_history_json(user_id, create=False))
        _save_chat_history_db(imported, user_id)
        return imported
    return _normalize_chat_history(_empty_chat_history())


def _save_chat_history_db(payload: dict[str, Any], user_id: str = "default") -> None:
    normalized_user = normalize_user_id(user_id)
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_histories (user_id, payload, updated_at)
                VALUES (%s, %s::jsonb, now())
                ON CONFLICT (user_id) DO UPDATE
                SET payload = EXCLUDED.payload,
                    updated_at = now()
                """,
                (normalized_user, json.dumps(payload, ensure_ascii=False)),
            )
        conn.commit()


def _normalize_session(value: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    session_id = str(value.get("id") or "").strip()
    if not session_id:
        return None
    messages = value.get("messages")
    if not isinstance(messages, list):
        messages = []
    now = datetime.now(timezone.utc).isoformat()
    active_message_id = value.get("activeMessageId", value.get("active_message_id"))
    return {
        "id": session_id,
        "title": str(value.get("title") or "新对话"),
        "createdAt": str(value.get("createdAt") or value.get("created_at") or now),
        "updatedAt": str(value.get("updatedAt") or value.get("updated_at") or value.get("createdAt") or now),
        "messages": [item for item in messages if isinstance(item, dict)],
        "activeMessageId": str(active_message_id) if active_message_id else None,
        "chatInput": str(value.get("chatInput") or value.get("chat_input") or ""),
        "workspaceMode": str(value.get("workspaceMode") or "chat"),
        "generationMode": str(value.get("generationMode") or "standard"),
        "promptModeId": str(value.get("promptModeId") or value.get("prompt_mode_id") or ""),
        "composerMode": str(value.get("composerMode") or "new-generation"),
        "activeResultId": value.get("activeResultId") if value.get("activeResultId") is None else str(value.get("activeResultId") or ""),
        "pinnedAt": str(value.get("pinnedAt")) if value.get("pinnedAt") else None,
        "titleLocked": bool(value.get("titleLocked")),
        "_index": index,
    }


def _text_from_localized(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return " ".join(str(item) for item in value.values() if isinstance(item, str))
    if isinstance(value, list):
        return " ".join(str(item) for item in value if isinstance(item, str))
    return ""


def _message_search_text(message: dict[str, Any]) -> str:
    parts = [
        _text_from_localized(message.get("content")),
        _text_from_localized(message.get("bullets", {}).get("zh") if isinstance(message.get("bullets"), dict) else None),
        _text_from_localized(message.get("bullets", {}).get("en") if isinstance(message.get("bullets"), dict) else None),
        str(message.get("promptText") or ""),
        str(message.get("imageLabel") or ""),
        str(message.get("draftInstruction") or ""),
    ]
    variants = message.get("variants")
    if isinstance(variants, list):
        for variant in variants[:5]:
            if not isinstance(variant, dict):
                continue
            parts.extend([
                _text_from_localized(variant.get("content")),
                _text_from_localized(variant.get("bullets", {}).get("zh") if isinstance(variant.get("bullets"), dict) else None),
                _text_from_localized(variant.get("bullets", {}).get("en") if isinstance(variant.get("bullets"), dict) else None),
                str(variant.get("promptText") or ""),
                str(variant.get("imageLabel") or ""),
                str(variant.get("draftInstruction") or ""),
            ])
    return " ".join(part for part in parts if part).strip()


def _summarize_session(session: dict[str, Any]) -> dict[str, Any]:
    messages = session.get("messages") if isinstance(session.get("messages"), list) else []
    search_text = " ".join([
        str(session.get("title") or ""),
        str(session.get("chatInput") or ""),
        " ".join(_message_search_text(message) for message in messages if isinstance(message, dict)),
    ]).strip()
    if len(search_text) > 2048:
        search_text = search_text[:2048]
    return {
        **session,
        "messages": [],
        "hasMessages": len(messages) > 0,
        "messageCount": len(messages),
        "searchText": search_text,
    }


def _normalize_chat_history(value: Any) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    raw_sessions = payload.get("sessions")
    if not isinstance(raw_sessions, list):
        raw_sessions = []
    sessions = [
        normalized
        for index, session in enumerate(raw_sessions)
        if (normalized := _normalize_session(session, index)) is not None
    ]
    sessions.sort(key=lambda item: (str(item.get("updatedAt") or ""), -int(item.pop("_index", 0))), reverse=True)
    sessions = sessions[:_MAX_SESSIONS]
    session_ids = {session["id"] for session in sessions}
    current_session_id = str(payload.get("currentSessionId") or "").strip()
    if current_session_id not in session_ids:
        current_session_id = sessions[0]["id"] if sessions else ""
    return {
        "currentSessionId": current_session_id,
        "sessions": sessions,
        "updatedAt": str(payload.get("updatedAt") or datetime.now(timezone.utc).isoformat()),
    }


def _load_chat_history_unlocked(user_id: str = "default") -> dict[str, Any]:
    if _use_database_storage():
        return _load_chat_history_db(user_id)
    data = _read_chat_history_json(user_id)
    return _normalize_chat_history(data)


def load_chat_history(user_id: str = "default") -> dict[str, Any]:
    with _lock:
        return _load_chat_history_unlocked(user_id)


def load_chat_history_summary(user_id: str = "default") -> dict[str, Any]:
    with _lock:
        history = _load_chat_history_unlocked(user_id)
    return {
        **history,
        "sessions": [_summarize_session(session) for session in history["sessions"]],
    }


def load_chat_session(session_id: str, user_id: str = "default") -> dict[str, Any] | None:
    target_id = str(session_id or "").strip()
    if not target_id:
        return None
    with _lock:
        history = _load_chat_history_unlocked(user_id)
    return next((session for session in history["sessions"] if session["id"] == target_id), None)


def _is_summary_only_payload_session(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    messages = value.get("messages")
    if not isinstance(messages, list) or len(messages) > 0:
        return False
    try:
        message_count = int(value.get("messageCount") or 0)
    except (TypeError, ValueError):
        message_count = 0
    return bool(value.get("hasMessages")) or message_count > 0


def _merge_summary_payload_with_existing(payload: dict[str, Any], existing: dict[str, Any]) -> dict[str, Any]:
    raw_sessions = payload.get("sessions")
    if not isinstance(raw_sessions, list):
        return payload
    existing_by_id = {
        session["id"]: session
        for session in existing.get("sessions", [])
        if isinstance(session, dict) and session.get("id")
    }
    merged_sessions: list[Any] = []
    for session in raw_sessions:
        if _is_summary_only_payload_session(session):
            session_id = str(session.get("id") or "")
            previous = existing_by_id.get(session_id)
            previous_messages = previous.get("messages") if isinstance(previous, dict) else None
            if isinstance(previous_messages, list) and previous_messages:
                merged_sessions.append({
                    **session,
                    "messages": previous_messages,
                    "activeMessageId": session.get("activeMessageId") or previous.get("activeMessageId"),
                })
                continue
        merged_sessions.append(session)
    return {
        **payload,
        "sessions": merged_sessions,
    }


def save_chat_history(payload: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    with _lock:
        existing = _load_chat_history_unlocked(user_id)
        merged_payload = _merge_summary_payload_with_existing(payload, existing)
        normalized = _normalize_chat_history({**merged_payload, "updatedAt": datetime.now(timezone.utc).isoformat()})
        if _use_database_storage():
            _save_chat_history_db(normalized, user_id)
            return normalized
        _ensure_chat_history(user_id)
        get_chat_history_path(user_id).write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return normalized
