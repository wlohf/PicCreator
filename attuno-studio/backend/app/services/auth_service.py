import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import HTTPException, Request, Response, status

from backend.app.services import db
from backend.app.services.result_store import get_data_dir, normalize_user_id


SESSION_COOKIE_NAME = "attuno_session"
LEGACY_SESSION_COOKIE_NAME = "render_agent_session"
USER_NAMESPACE_HEADER = "x-attuno-user-token"
LEGACY_USER_NAMESPACE_HEADER = "x-render-agent-user-token"
SESSION_TTL_DAYS = 14
PBKDF2_ITERATIONS = 200_000
DEFAULT_LOCAL_USER_ID = "default"
DEFAULT_LOCAL_USERNAME = "Local workspace"

_lock = Lock()


def _auth_dir() -> Path:
    return get_data_dir() / "auth"


def _users_path() -> Path:
    return _auth_dir() / "users.json"


def _sessions_path() -> Path:
    return _auth_dir() / "sessions.json"


def _ensure_auth_storage() -> None:
    _auth_dir().mkdir(parents=True, exist_ok=True)
    for path, empty in ((_users_path(), []), (_sessions_path(), {})):
        if not path.exists():
            path.write_text(json.dumps(empty, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_json(path: Path, default: Any):
    _ensure_auth_storage()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default
    return parsed if isinstance(parsed, type(default)) else default


def _write_json(path: Path, value: Any) -> None:
    _ensure_auth_storage()
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_users() -> list[dict[str, Any]]:
    return _read_json(_users_path(), [])


def _write_users(users: list[dict[str, Any]]) -> None:
    _write_json(_users_path(), users)


def _read_sessions() -> dict[str, dict[str, Any]]:
    return _read_json(_sessions_path(), {})


def _write_sessions(sessions: dict[str, dict[str, Any]]) -> None:
    _write_json(_sessions_path(), sessions)


def _use_database_storage() -> bool:
    return db.structured_storage_enabled()


def _row_to_user(row: dict[str, Any]) -> dict[str, Any]:
    created_at = row.get("created_at")
    return {
        "user_id": str(row.get("user_id") or ""),
        "username": str(row.get("username") or row.get("user_id") or ""),
        "password_salt": str(row.get("password_salt") or ""),
        "password_hash": str(row.get("password_hash") or ""),
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at or ""),
    }


def _import_json_auth_to_db(include_sessions: bool = False) -> None:
    users = _read_users()
    sessions = _read_sessions() if include_sessions else {}
    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        with conn.cursor() as cur:
            for user in users:
                if not isinstance(user, dict):
                    continue
                user_id = normalize_user_id(user.get("user_id") or user.get("username"))
                username = str(user.get("username") or user_id)
                password_salt = str(user.get("password_salt") or "")
                password_hash = str(user.get("password_hash") or "")
                if not user_id or not password_salt or not password_hash:
                    continue
                cur.execute(
                    """
                    INSERT INTO users (user_id, username, password_salt, password_hash, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO NOTHING
                    """,
                    (
                        user_id,
                        username,
                        password_salt,
                        password_hash,
                        str(user.get("created_at") or datetime.now(timezone.utc).isoformat()),
                    ),
                )
            if include_sessions:
                known_users = {
                    normalize_user_id(user.get("user_id") or user.get("username"))
                    for user in users
                    if isinstance(user, dict)
                }
                for token, session in sessions.items():
                    if not isinstance(session, dict):
                        continue
                    user_id = normalize_user_id(session.get("user_id"))
                    if user_id not in known_users:
                        continue
                    try:
                        expires_at = datetime.fromisoformat(str(session.get("expires_at") or ""))
                    except ValueError:
                        continue
                    if expires_at <= now:
                        continue
                    cur.execute(
                        """
                        INSERT INTO auth_sessions (session_id, user_id, username, expires_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (session_id) DO NOTHING
                        """,
                        (
                            str(token),
                            user_id,
                            str(session.get("username") or user_id),
                            expires_at,
                        ),
                    )
        conn.commit()


def _read_users_db() -> list[dict[str, Any]]:
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT user_id, username, password_salt, password_hash, created_at
                FROM users
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
    if not rows and _users_path().exists():
        _import_json_auth_to_db()
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT user_id, username, password_salt, password_hash, created_at
                    FROM users
                    ORDER BY created_at ASC
                    """
                )
                rows = cur.fetchall()
    return [_row_to_user(dict(row)) for row in rows]


def _read_user_db(user_id: str) -> dict[str, Any] | None:
    normalized_user_id = normalize_user_id(user_id)
    for attempt in range(2):
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT user_id, username, password_salt, password_hash, created_at
                    FROM users
                    WHERE user_id = %s
                    """,
                    (normalized_user_id,),
                )
                row = cur.fetchone()
                if row:
                    return _row_to_user(dict(row))
        if attempt == 0 and _users_path().exists():
            _import_json_auth_to_db()
    return None


def _create_user_db(user: dict[str, Any]) -> None:
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (user_id, username, password_salt, password_hash, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    user["user_id"],
                    user["username"],
                    user["password_salt"],
                    user["password_hash"],
                    user["created_at"],
                ),
            )
        conn.commit()


def _create_session_db(session_id: str, session: dict[str, Any]) -> None:
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth_sessions (session_id, user_id, username, expires_at)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    session_id,
                    session["user_id"],
                    session["username"],
                    session["expires_at"],
                ),
            )
        conn.commit()


def _get_session_db(session_id: str) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    row = None
    for attempt in range(2):
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM auth_sessions WHERE expires_at <= %s", (now,))
                cur.execute(
                    """
                    SELECT user_id, username, expires_at
                    FROM auth_sessions
                    WHERE session_id = %s
                    """,
                    (session_id,),
                )
                row = cur.fetchone()
            conn.commit()
        if row or attempt > 0 or not _sessions_path().exists():
            break
        _import_json_auth_to_db(include_sessions=True)
    if not row:
        return None
    expires_at = row["expires_at"]
    return {
        "user_id": str(row.get("user_id") or ""),
        "username": str(row.get("username") or ""),
        "expires_at": expires_at.isoformat() if hasattr(expires_at, "isoformat") else str(expires_at or ""),
    }


def _delete_session_db(session_id: str) -> None:
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM auth_sessions WHERE session_id = %s", (session_id,))
        conn.commit()


def has_users() -> bool:
    with _lock:
        if _use_database_storage():
            return len(_read_users_db()) > 0
        return len(_read_users()) > 0


def _hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def register_user(username: str, password: str) -> dict[str, Any]:
    display_name = username.strip()
    user_id = normalize_user_id(display_name)
    if not display_name or user_id == DEFAULT_LOCAL_USER_ID:
        raise HTTPException(status_code=400, detail="该用户名不可用")
    if len(password.strip()) < 8:
        raise HTTPException(status_code=400, detail="密码至少需要 8 位")
    with _lock:
        salt_hex, password_hash = _hash_password(password)
        user = {
            "user_id": user_id,
            "username": display_name,
            "password_salt": salt_hex,
            "password_hash": password_hash,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if _use_database_storage():
            if _read_user_db(user_id):
                raise HTTPException(status_code=409, detail="该用户名已存在")
            _create_user_db(user)
        else:
            users = _read_users()
            if any(str(item.get("user_id") or "") == user_id for item in users):
                raise HTTPException(status_code=409, detail="该用户名已存在")
            users.append(user)
            _write_users(users)
        return {"user_id": user_id, "username": user["username"]}


def authenticate_user(username: str, password: str) -> dict[str, Any]:
    user_id = normalize_user_id(username)
    with _lock:
        if _use_database_storage():
            user = _read_user_db(user_id)
        else:
            users = _read_users()
            user = next((item for item in users if str(item.get("user_id") or "") == user_id), None)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    _salt_hex, digest_hex = _hash_password(password, str(user.get("password_salt") or ""))
    if digest_hex != str(user.get("password_hash") or ""):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return {"user_id": user_id, "username": str(user.get("username") or user_id)}


def create_session(user: dict[str, Any]) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    with _lock:
        session = {
            "user_id": user["user_id"],
            "username": user["username"],
            "expires_at": expires_at,
        }
        if _use_database_storage():
            _create_session_db(token, session)
        else:
            sessions = _read_sessions()
            sessions[token] = session
            _write_sessions(sessions)
    return token


def _prune_and_get_session(session_id: str) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    with _lock:
        if _use_database_storage():
            return _get_session_db(session_id)
        sessions = _read_sessions()
        stale = [
            key for key, value in sessions.items()
            if datetime.fromisoformat(str(value.get("expires_at"))) <= now
        ]
        for key in stale:
            sessions.pop(key, None)
        if stale:
            _write_sessions(sessions)
        return sessions.get(session_id)


def delete_session(session_id: str) -> None:
    if not session_id:
        return
    with _lock:
        if _use_database_storage():
            _delete_session_db(session_id)
            return
        sessions = _read_sessions()
        if session_id in sessions:
            sessions.pop(session_id, None)
            _write_sessions(sessions)


def apply_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )
    response.delete_cookie(LEGACY_SESSION_COOKIE_NAME, path="/")


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(LEGACY_SESSION_COOKIE_NAME, path="/")


def get_current_user(request: Request) -> dict[str, Any]:
    session_id = request.cookies.get(SESSION_COOKIE_NAME, "") or request.cookies.get(LEGACY_SESSION_COOKIE_NAME, "")
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    session = _prune_and_get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效")
    return {
        "user_id": str(session.get("user_id") or "default"),
        "username": str(session.get("username") or session.get("user_id") or "default"),
    }


def get_default_local_user() -> dict[str, Any]:
    return {
        "user_id": DEFAULT_LOCAL_USER_ID,
        "username": DEFAULT_LOCAL_USERNAME,
        "authenticated": False,
    }


def get_request_namespace_user(request: Request) -> dict[str, Any] | None:
    raw_token = (
        request.headers.get(USER_NAMESPACE_HEADER)
        or request.headers.get(LEGACY_USER_NAMESPACE_HEADER)
        or request.query_params.get("user_id")
        or ""
    )
    user_id = normalize_user_id(raw_token)
    if user_id == DEFAULT_LOCAL_USER_ID and not raw_token.strip():
        return None
    return {
        "user_id": user_id,
        "username": user_id,
        "authenticated": False,
        "auth_scheme": "token_namespace",
    }


def get_current_or_default_user(request: Request) -> dict[str, Any]:
    try:
        user = get_current_user(request)
    except HTTPException:
        namespace_user = get_request_namespace_user(request)
        if namespace_user is not None:
            return namespace_user
        return get_default_local_user()
    return {**user, "authenticated": True}


def get_current_or_namespace_user(request: Request) -> dict[str, Any]:
    try:
        user = get_current_user(request)
    except HTTPException as exc:
        namespace_user = get_request_namespace_user(request)
        if namespace_user is not None:
            return namespace_user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc.detail or "未登录")) from exc
    return {**user, "authenticated": True}


def resolve_config_user_id(user: dict[str, Any] | None) -> str:
    normalized = normalize_user_id((user or {}).get("user_id"))
    return normalized or DEFAULT_LOCAL_USER_ID
