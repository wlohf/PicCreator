from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.services.db import get_attuno_env, get_database_status
from backend.app.services.result_store import get_data_dir
from backend.app.services.update_service import update_enabled, update_status
from backend.app.settings import API_BUILD_ID


def get_system_status() -> dict[str, Any]:
    database = get_database_status()
    data_dir = _data_dir_status()
    update = update_status(use_cache=True)
    return {
        "ok": bool(database.get("ok")) and bool(data_dir.get("ok")) and bool(update.get("ok")),
        "service": "attuno-studio-api",
        "build": API_BUILD_ID,
        "environment": get_attuno_env(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "database": database,
        "storage": data_dir,
        "update": {
            "ok": bool(update.get("ok")),
            "enabled": update_enabled(),
            "update_source": update.get("update_source") or "",
            "current_version": update.get("current_version") or "",
            "latest_version": update.get("latest_version") or "",
            "has_update": bool(update.get("has_update")),
            "can_apply": bool(update.get("can_apply")),
            "apply_blockers": list(update.get("apply_blockers") or []),
            "checked_at": update.get("checked_at") or "",
            "error": update.get("error") or "",
        },
    }


def _data_dir_status() -> dict[str, Any]:
    data_dir = get_data_dir()
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        probe = data_dir / ".attuno-write-check"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return {
            "ok": True,
            "data_dir": str(data_dir),
            "writable": True,
            "error": "",
        }
    except Exception as exc:
        return {
            "ok": False,
            "data_dir": str(data_dir),
            "writable": False,
            "error": str(exc),
        }
