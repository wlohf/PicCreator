from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
from threading import Lock
from typing import Any, Iterator


try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - exercised when the optional driver is absent
    psycopg = None
    dict_row = None


MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "db" / "migrations"
_migration_lock = Lock()
_initialized = False
_last_error = ""


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", "").strip()


def get_attuno_env() -> str:
    return (os.environ.get("ATTUNO_ENV") or os.environ.get("APP_ENV") or "development").strip().lower()


def database_required() -> bool:
    return get_attuno_env() == "production"


def database_configured() -> bool:
    return bool(get_database_url())


def database_available() -> bool:
    return bool(psycopg is not None and get_database_url())


def reset_database_state_for_tests() -> None:
    global _initialized, _last_error
    _initialized = False
    _last_error = ""


@contextmanager
def connect() -> Iterator[Any]:
    if psycopg is None:
        raise RuntimeError("PostgreSQL driver is not installed. Install psycopg[binary].")
    database_url = get_database_url()
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured.")
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        yield conn


def initialize_database() -> dict[str, Any]:
    global _initialized, _last_error
    if not database_configured():
        _last_error = "DATABASE_URL is not configured."
        if database_required():
            return get_database_status()
        return get_database_status()
    if psycopg is None:
        _last_error = "PostgreSQL driver is not installed. Install psycopg[binary]."
        return get_database_status()

    with _migration_lock:
        if _initialized:
            return get_database_status()
        try:
            _run_migrations()
            _initialized = True
            _last_error = ""
        except Exception as exc:
            _last_error = str(exc)
        return get_database_status()


def _run_migrations() -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("SELECT version FROM schema_migrations")
            applied = {str(row["version"]) for row in cur.fetchall()}
            for migration_path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = migration_path.stem
                if version in applied:
                    continue
                cur.execute(migration_path.read_text(encoding="utf-8"))
                cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
        conn.commit()


def get_database_status() -> dict[str, Any]:
    configured = database_configured()
    required = database_required()
    if not configured:
        return {
            "ok": not required,
            "required": required,
            "configured": False,
            "fallback": not required,
            "error": "DATABASE_URL is not configured." if required else "",
        }
    if psycopg is None:
        return {
            "ok": False,
            "required": required,
            "configured": True,
            "fallback": False,
            "error": "PostgreSQL driver is not installed. Install psycopg[binary].",
        }
    if _last_error:
        return {
            "ok": False,
            "required": required,
            "configured": True,
            "fallback": False,
            "error": _last_error,
        }
    return {
        "ok": _initialized,
        "required": required,
        "configured": True,
        "fallback": False,
        "error": "" if _initialized else "Database has not been initialized.",
    }


def ensure_database_ready() -> bool:
    status = initialize_database()
    return bool(status.get("ok") and status.get("configured"))
