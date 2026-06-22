from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import subprocess
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
UPDATE_SCRIPT = REPO_ROOT / "deploy" / "update.sh"
DEFAULT_REMOTE = "origin"
DEFAULT_BRANCH = "main"
CHECK_CACHE_TTL_SECONDS = 60
APPLY_TIMEOUT_SECONDS = 20 * 60
LOG_LIMIT = 16000
_last_check: dict[str, Any] | None = None


@dataclass(frozen=True)
class UpdateAdminCredentials:
    username: str
    password: str


class UpdateAuthError(RuntimeError):
    pass


class UpdateError(RuntimeError):
    pass


def update_enabled() -> bool:
    return os.environ.get("ATTUNO_UPDATE_ENABLED", "").strip() == "1"


def get_update_admin_username() -> str:
    return os.environ.get("ATTUNO_UPDATE_ADMIN_USERNAME", "admin").strip() or "admin"


def hash_update_admin_password(password: str, *, iterations: int = 260000) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def authenticate_update_admin(credentials: UpdateAdminCredentials) -> None:
    expected_username = get_update_admin_username()
    if not hmac.compare_digest(credentials.username.strip(), expected_username):
        raise UpdateAuthError("管理员凭据无效")

    configured_hash = os.environ.get("ATTUNO_UPDATE_ADMIN_PASSWORD_HASH", "").strip()
    raw_password = os.environ.get("ATTUNO_UPDATE_ADMIN_PASSWORD", "")
    if configured_hash:
        if not _verify_password_hash(credentials.password, configured_hash):
            raise UpdateAuthError("管理员凭据无效")
        return
    if raw_password:
        if not hmac.compare_digest(credentials.password, raw_password):
            raise UpdateAuthError("管理员凭据无效")
        return
    raise UpdateAuthError("未配置更新管理员密码")


def credentials_from_basic_authorization(header: str) -> UpdateAdminCredentials:
    value = str(header or "").strip()
    if not value.lower().startswith("basic "):
        raise UpdateAuthError("缺少更新管理员授权")
    try:
        decoded = base64.b64decode(value.split(" ", 1)[1], validate=True).decode("utf-8")
    except Exception as exc:
        raise UpdateAuthError("更新管理员授权格式无效") from exc
    username, separator, password = decoded.partition(":")
    if not separator:
        raise UpdateAuthError("更新管理员授权格式无效")
    return UpdateAdminCredentials(username=username, password=password)


def update_status(use_cache: bool = True) -> dict[str, Any]:
    global _last_check
    cached = _last_check
    if use_cache and cached:
        checked_at = _parse_datetime(cached.get("checked_at"))
        if checked_at and datetime.now(timezone.utc) - checked_at < timedelta(seconds=CHECK_CACHE_TTL_SECONDS):
            return _base_status(cached)

    status = _compute_update_status(fetch_remote=False)
    if status.get("ok"):
        _last_check = status
    return _base_status(status)


def check_for_updates() -> dict[str, Any]:
    global _last_check
    status = _compute_update_status(fetch_remote=True)
    if status.get("ok"):
        _last_check = status
    return status


def apply_update() -> dict[str, Any]:
    if not update_enabled():
        raise UpdateError("更新执行未启用：请设置 ATTUNO_UPDATE_ENABLED=1")
    _require_git_repo()
    _require_clean_worktree()
    status = check_for_updates()
    if not status.get("ok"):
        raise UpdateError(status.get("error") or "更新检测失败")
    if not status.get("has_update"):
        return {**status, "applied": False, "message": "当前已经是最新版本。"}
    if not _is_fast_forward(status.get("current_commit", ""), status.get("remote_commit", "")):
        raise UpdateError("远端版本不是当前提交的 fast-forward 更新，已停止。")
    if not UPDATE_SCRIPT.exists():
        raise UpdateError(f"更新脚本不存在：{UPDATE_SCRIPT}")

    env = dict(os.environ)
    env.pop("ATTUNO_UPDATE_ADMIN_PASSWORD", None)
    env.pop("ATTUNO_UPDATE_ADMIN_PASSWORD_HASH", None)
    command = ["bash", str(UPDATE_SCRIPT)]
    result = subprocess.run(
        command,
        cwd=str(REPO_ROOT),
        text=True,
        capture_output=True,
        timeout=APPLY_TIMEOUT_SECONDS,
        env=env,
        check=False,
    )
    output = _redact_output("\n".join([result.stdout or "", result.stderr or ""]).strip())
    if result.returncode != 0:
        raise UpdateError(f"更新脚本失败，退出码 {result.returncode}。\n{output[-LOG_LIMIT:]}")
    next_status = _compute_update_status(fetch_remote=False)
    return {
        **next_status,
        "applied": True,
        "message": "更新脚本已执行完成，服务可能已经重启。",
        "log": output[-LOG_LIMIT:],
    }


def _compute_update_status(fetch_remote: bool) -> dict[str, Any]:
    try:
        _require_git_repo()
        if fetch_remote:
            _run_git(["fetch", DEFAULT_REMOTE, f"{DEFAULT_BRANCH}:refs/remotes/{DEFAULT_REMOTE}/{DEFAULT_BRANCH}"])
        current_commit = _run_git(["rev-parse", "HEAD"]).strip()
        remote_ref = f"{DEFAULT_REMOTE}/{DEFAULT_BRANCH}"
        remote_commit = _run_git(["rev-parse", remote_ref]).strip()
        return {
            "ok": True,
            "enabled": update_enabled(),
            "repo_root": str(REPO_ROOT),
            "branch": _run_git(["rev-parse", "--abbrev-ref", "HEAD"]).strip(),
            "remote": DEFAULT_REMOTE,
            "remote_branch": DEFAULT_BRANCH,
            "current_commit": current_commit,
            "remote_commit": remote_commit,
            "has_update": current_commit != remote_commit and _is_fast_forward(current_commit, remote_commit),
            "fast_forward": _is_fast_forward(current_commit, remote_commit),
            "dirty": _is_worktree_dirty(),
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "error": "",
        }
    except Exception as exc:
        return {
            "ok": False,
            "enabled": update_enabled(),
            "repo_root": str(REPO_ROOT),
            "branch": "",
            "remote": DEFAULT_REMOTE,
            "remote_branch": DEFAULT_BRANCH,
            "current_commit": "",
            "remote_commit": "",
            "has_update": False,
            "fast_forward": False,
            "dirty": False,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }


def _base_status(status: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in status.items()
        if key != "log"
    }


def _verify_password_hash(password: str, encoded: str) -> bool:
    if encoded.startswith("pbkdf2_sha256$"):
        try:
            _scheme, iterations_raw, salt, digest = encoded.split("$", 3)
            iterations = int(iterations_raw)
        except ValueError:
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
        return hmac.compare_digest(candidate, digest)
    candidate = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return hmac.compare_digest(candidate, encoded)


def _require_git_repo() -> None:
    value = _run_git(["rev-parse", "--is-inside-work-tree"]).strip()
    if value != "true":
        raise UpdateError("当前目录不是 Git 工作树")


def _require_clean_worktree() -> None:
    if _is_worktree_dirty():
        raise UpdateError("工作树存在未提交改动，更新已停止以避免覆盖本地修改。")


def _is_worktree_dirty() -> bool:
    return bool(_run_git(["status", "--porcelain"]).strip())


def _is_fast_forward(current_commit: str, remote_commit: str) -> bool:
    if not current_commit or not remote_commit:
        return False
    merge_base = _run_git(["merge-base", "HEAD", f"{DEFAULT_REMOTE}/{DEFAULT_BRANCH}"]).strip()
    return merge_base == current_commit


def _run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(REPO_ROOT),
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        detail = _redact_output((result.stderr or result.stdout or "").strip())
        raise UpdateError(detail or f"git {' '.join(args)} failed")
    return result.stdout


def _parse_datetime(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or ""))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _redact_output(output: str) -> str:
    text = str(output or "")
    text = re.sub(r"(postgresql://[^:\s]+:)[^@\s]+(@)", r"\1***\2", text)
    text = re.sub(r"(ATTUNO_UPDATE_ADMIN_PASSWORD(?:_HASH)?=)[^\s]+", r"\1***", text)
    text = re.sub(r"(DATABASE_URL=postgresql://[^:\s]+:)[^@\s]+(@)", r"\1***\2", text)
    return text[-LOG_LIMIT:]
