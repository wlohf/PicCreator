from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any

from backend.app.services import db
from backend.app.services.result_store import normalize_user_id


COOLDOWN_BY_STATUS_SECONDS = {
    "auth_failed": 24 * 60 * 60,
    "rate_limited": 15 * 60,
    "timeout": 2 * 60,
    "network_error": 2 * 60,
    "provider_error": 5 * 60,
}


def tavily_key_fingerprint(api_key: str) -> str:
    return hashlib.sha256(str(api_key or "").encode("utf-8")).hexdigest()[:24]


def order_tavily_keys(user_id: str, keys: list[str], start_index: int) -> list[str]:
    if not keys:
        return []
    ordered = keys[start_index:] + keys[:start_index]
    if not db.ensure_database_ready():
        return ordered

    normalized_user = normalize_user_id(user_id)
    fingerprints = [tavily_key_fingerprint(key) for key in keys]
    try:
        with db.connect() as conn:
            with conn.cursor() as cur:
                _ensure_runtime_state(cur, normalized_user, start_index)
                cur.execute(
                    """
                    SELECT key_fingerprint, cooldown_until
                    FROM tavily_key_state
                    WHERE user_id = %s AND key_fingerprint = ANY(%s)
                    """,
                    (normalized_user, fingerprints),
                )
                cooldowns = {
                    str(row["key_fingerprint"]): row["cooldown_until"]
                    for row in cur.fetchall()
                }
            conn.commit()
    except Exception:
        return ordered

    now = datetime.now(timezone.utc)
    available: list[str] = []
    cooling: list[str] = []
    for key in ordered:
        cooldown_until = cooldowns.get(tavily_key_fingerprint(key))
        if cooldown_until and cooldown_until > now:
            cooling.append(key)
        else:
            available.append(key)
    return available + cooling


def claim_tavily_start_index(user_id: str, key_count: int, fallback_start_index: int) -> int | None:
    if key_count <= 0 or not db.ensure_database_ready():
        return None
    normalized_user = normalize_user_id(user_id)
    fallback = int(fallback_start_index or 0) % key_count
    try:
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_runtime_state (user_id, tavily_next_key_index, updated_at)
                    VALUES (%s, %s, now())
                    ON CONFLICT (user_id) DO NOTHING
                    """,
                    (normalized_user, fallback),
                )
                cur.execute(
                    """
                    SELECT tavily_next_key_index
                    FROM user_runtime_state
                    WHERE user_id = %s
                    FOR UPDATE
                    """,
                    (normalized_user,),
                )
                row = cur.fetchone() or {}
                start_index = int(row.get("tavily_next_key_index") or 0) % key_count
                cur.execute(
                    """
                    UPDATE user_runtime_state
                    SET tavily_next_key_index = %s,
                        updated_at = now()
                    WHERE user_id = %s
                    """,
                    ((start_index + 1) % key_count, normalized_user),
                )
            conn.commit()
        return start_index
    except Exception:
        return None


def record_tavily_key_success(user_id: str, api_key: str, key_index: int) -> None:
    _record_tavily_key_state(
        user_id=user_id,
        api_key=api_key,
        key_index=key_index,
        status="ok",
        message="Tavily search succeeded.",
        failed=False,
    )


def record_tavily_key_failure(user_id: str, api_key: str, key_index: int, detail: dict[str, Any]) -> None:
    _record_tavily_key_state(
        user_id=user_id,
        api_key=api_key,
        key_index=key_index,
        status=str(detail.get("status") or "failed"),
        message=str(detail.get("message") or "")[:500],
        failed=True,
    )


def _record_tavily_key_state(
    *,
    user_id: str,
    api_key: str,
    key_index: int,
    status: str,
    message: str,
    failed: bool,
) -> None:
    if not api_key or not db.ensure_database_ready():
        return
    normalized_user = normalize_user_id(user_id)
    fingerprint = tavily_key_fingerprint(api_key)
    cooldown_until = None
    if failed:
        seconds = COOLDOWN_BY_STATUS_SECONDS.get(status, 60)
        cooldown_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    try:
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO tavily_key_state (
                        user_id, key_fingerprint, key_index, failure_count, last_status,
                        last_message, last_used_at, last_failed_at, cooldown_until, updated_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, now(),
                        CASE WHEN %s THEN now() ELSE NULL END,
                        %s,
                        now()
                    )
                    ON CONFLICT (user_id, key_fingerprint) DO UPDATE
                    SET key_index = EXCLUDED.key_index,
                        failure_count = CASE WHEN %s THEN tavily_key_state.failure_count + 1 ELSE 0 END,
                        last_status = EXCLUDED.last_status,
                        last_message = EXCLUDED.last_message,
                        last_used_at = now(),
                        last_failed_at = CASE WHEN %s THEN now() ELSE tavily_key_state.last_failed_at END,
                        cooldown_until = EXCLUDED.cooldown_until,
                        updated_at = now()
                    """,
                    (
                        normalized_user,
                        fingerprint,
                        key_index,
                        1 if failed else 0,
                        status,
                        message,
                        failed,
                        cooldown_until,
                        failed,
                        failed,
                    ),
                )
            conn.commit()
    except Exception:
        return


def record_search_event(
    *,
    user_id: str,
    query: str,
    provider: str,
    status: str,
    result_count: int,
    diagnostics: list[dict[str, Any]],
    search_profile: str = "",
    search_parameters: dict[str, Any] | None = None,
) -> None:
    if not db.ensure_database_ready():
        return
    safe_diagnostics = [_sanitize_diagnostic(item) for item in diagnostics[:8] if isinstance(item, dict)]
    try:
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO search_events (
                        user_id, query, provider, status, result_count,
                        diagnostics, search_profile, search_parameters
                    )
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb)
                    """,
                    (
                        normalize_user_id(user_id),
                        str(query or "")[:500],
                        str(provider or "")[:80],
                        str(status or "")[:80],
                        max(0, int(result_count or 0)),
                        json.dumps(safe_diagnostics, ensure_ascii=False),
                        str(search_profile or "")[:120],
                        json.dumps(search_parameters or {}, ensure_ascii=False),
                    ),
                )
            conn.commit()
    except Exception:
        return


def _ensure_runtime_state(cur: Any, user_id: str, start_index: int) -> None:
    cur.execute(
        """
        INSERT INTO user_runtime_state (user_id, tavily_next_key_index, updated_at)
        VALUES (%s, %s, now())
        ON CONFLICT (user_id) DO NOTHING
        """,
        (user_id, max(0, int(start_index or 0))),
    )


def _sanitize_diagnostic(item: dict[str, Any]) -> dict[str, Any]:
    message = str(item.get("message") or "")
    return {
        "provider": str(item.get("provider") or "")[:80],
        "ok": bool(item.get("ok")),
        "status": str(item.get("status") or "")[:80],
        "message": message[:500],
        "attempts": int(item.get("attempts") or 0),
        "key_count": item.get("key_count") if isinstance(item.get("key_count"), int) else None,
    }
