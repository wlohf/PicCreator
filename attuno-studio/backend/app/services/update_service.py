from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
from typing import Any
import urllib.error
import urllib.parse
import urllib.request


REPO_ROOT = Path(__file__).resolve().parents[4]
UPDATE_SCRIPT = REPO_ROOT / "deploy" / "update.sh"
DEFAULT_REMOTE = "origin"
DEFAULT_BRANCH = "main"
DEFAULT_UPDATE_SOURCE = "release"
RELEASE_UPDATE_SOURCE = "release"
BRANCH_UPDATE_SOURCE = "branch"
DEFAULT_GITHUB_API_VERSION = "2022-11-28"
CHECK_CACHE_TTL_SECONDS = 60
APPLY_TIMEOUT_SECONDS = 20 * 60
GITHUB_API_TIMEOUT_SECONDS = 15
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
        if (
            checked_at
            and cached.get("update_source") == _safe_update_source()
            and datetime.now(timezone.utc) - checked_at < timedelta(seconds=CHECK_CACHE_TTL_SECONDS)
        ):
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
    update_source = get_update_source()
    _require_git_repo()
    _require_clean_worktree()
    status = check_for_updates()
    if not status.get("ok"):
        raise UpdateError(status.get("error") or "更新检测失败")
    if not status.get("has_update"):
        return {**status, "applied": False, "message": "当前已经是最新版本。"}
    blockers = [str(item) for item in status.get("apply_blockers") or [] if str(item).strip()]
    if blockers:
        raise UpdateError(blockers[0])
    if not status.get("fast_forward"):
        raise UpdateError("远端版本不是当前提交的 fast-forward 更新，已停止。")
    if not UPDATE_SCRIPT.exists():
        raise UpdateError(f"更新脚本不存在：{UPDATE_SCRIPT}")

    if update_source == RELEASE_UPDATE_SOURCE:
        _checkout_release_status(status)
        if not UPDATE_SCRIPT.exists():
            raise UpdateError(f"release 版本中更新脚本不存在：{UPDATE_SCRIPT}")

    env = dict(os.environ)
    env.pop("ATTUNO_UPDATE_ADMIN_PASSWORD", None)
    env.pop("ATTUNO_UPDATE_ADMIN_PASSWORD_HASH", None)
    env.pop("ATTUNO_GITHUB_TOKEN", None)
    if update_source == RELEASE_UPDATE_SOURCE:
        env["SKIP_GIT_PULL"] = "1"
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
    update_source = _safe_update_source()
    try:
        update_source = get_update_source()
        if update_source == BRANCH_UPDATE_SOURCE:
            return _compute_branch_update_status(fetch_remote)
        return _compute_release_update_status(fetch_remote)
    except Exception as exc:
        return _error_status(str(exc), update_source)


def _compute_branch_update_status(fetch_remote: bool) -> dict[str, Any]:
    _require_git_repo()
    if fetch_remote:
        _run_git(["fetch", DEFAULT_REMOTE, f"{DEFAULT_BRANCH}:refs/remotes/{DEFAULT_REMOTE}/{DEFAULT_BRANCH}"])
    current_commit = _run_git(["rev-parse", "HEAD"]).strip()
    remote_ref = f"{DEFAULT_REMOTE}/{DEFAULT_BRANCH}"
    remote_commit = _run_git(["rev-parse", remote_ref]).strip()
    fast_forward = _is_fast_forward(current_commit, remote_commit)
    return _with_apply_readiness({
        "ok": True,
        "enabled": update_enabled(),
        "update_source": BRANCH_UPDATE_SOURCE,
        "repo_root": str(REPO_ROOT),
        "branch": _current_branch(),
        "remote": DEFAULT_REMOTE,
        "remote_branch": DEFAULT_BRANCH,
        "current_commit": current_commit,
        "remote_commit": remote_commit,
        "current_version": _current_release_tag() or _short_commit(current_commit),
        "latest_version": _short_commit(remote_commit),
        "has_update": current_commit != remote_commit and fast_forward,
        "fast_forward": fast_forward,
        "dirty": _is_worktree_dirty(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "error": "",
    })


def _compute_release_update_status(fetch_remote: bool) -> dict[str, Any]:
    _require_git_repo()
    repository = get_github_repository()
    release = _request_latest_github_release(repository)
    tag = str(release.get("tag_name") or "").strip()
    if not tag:
        raise UpdateError("GitHub latest release 缺少 tag_name")
    _validate_release_tag(tag)
    if fetch_remote:
        _fetch_release_tag(tag)

    current_commit = _run_git(["rev-parse", "HEAD"]).strip()
    latest_commit = _commit_for_tag(tag)
    fast_forward = current_commit == latest_commit or _is_ancestor(current_commit, latest_commit)
    current_tag = _current_release_tag()
    return _with_apply_readiness({
        "ok": True,
        "enabled": update_enabled(),
        "update_source": RELEASE_UPDATE_SOURCE,
        "repo_root": str(REPO_ROOT),
        "branch": _current_branch(),
        "remote": DEFAULT_REMOTE,
        "remote_branch": "",
        "github_repository": repository,
        "current_commit": current_commit,
        "remote_commit": latest_commit,
        "current_version": current_tag or _short_commit(current_commit),
        "latest_version": tag,
        "latest_release_tag": tag,
        "latest_release_name": str(release.get("name") or ""),
        "latest_release_url": str(release.get("html_url") or ""),
        "latest_release_published_at": str(release.get("published_at") or ""),
        "latest_release_commit": latest_commit,
        "has_update": current_commit != latest_commit and fast_forward,
        "fast_forward": fast_forward,
        "dirty": _is_worktree_dirty(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "error": "",
    })


def _error_status(error: str, update_source: str) -> dict[str, Any]:
    return {
        "ok": False,
        "enabled": update_enabled(),
        "update_source": update_source,
        "repo_root": str(REPO_ROOT),
        "branch": "",
        "remote": DEFAULT_REMOTE,
        "remote_branch": DEFAULT_BRANCH if update_source == BRANCH_UPDATE_SOURCE else "",
        "github_repository": "",
        "current_commit": "",
        "remote_commit": "",
        "current_version": "",
        "latest_version": "",
        "latest_release_tag": "",
        "latest_release_name": "",
        "latest_release_url": "",
        "latest_release_published_at": "",
        "latest_release_commit": "",
        "has_update": False,
        "fast_forward": False,
        "can_apply": False,
        "apply_blockers": [error] if error else [],
        "dirty": False,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "error": error,
    }


def _with_apply_readiness(status: dict[str, Any]) -> dict[str, Any]:
    blockers: list[str] = []
    if not status.get("enabled"):
        blockers.append("更新执行未启用：请设置 ATTUNO_UPDATE_ENABLED=1")
    if status.get("dirty"):
        blockers.append("工作树存在未提交改动，更新已停止以避免覆盖本地修改。")
    if status.get("has_update") and not status.get("fast_forward"):
        blockers.append("远端版本不是当前提交的 fast-forward 更新，已停止。")
    if status.get("has_update") and not UPDATE_SCRIPT.exists():
        blockers.append(f"更新脚本不存在：{UPDATE_SCRIPT}")
    return {
        **status,
        "can_apply": bool(status.get("has_update")) and not blockers,
        "apply_blockers": blockers,
    }


def get_update_source() -> str:
    raw_source = _safe_update_source()
    if raw_source in {RELEASE_UPDATE_SOURCE, BRANCH_UPDATE_SOURCE}:
        return raw_source
    raise UpdateError("ATTUNO_UPDATE_SOURCE 只能设置为 release 或 branch")


def _safe_update_source() -> str:
    raw_source = os.environ.get("ATTUNO_UPDATE_SOURCE", DEFAULT_UPDATE_SOURCE).strip().lower()
    if raw_source in {"main", "git"}:
        return BRANCH_UPDATE_SOURCE
    if raw_source in {"tag", "github-release", "github_release"}:
        return RELEASE_UPDATE_SOURCE
    return raw_source or DEFAULT_UPDATE_SOURCE


def get_github_repository() -> str:
    configured = os.environ.get("ATTUNO_GITHUB_REPOSITORY", "").strip()
    if configured:
        return _normalize_github_repository(configured)
    remote_url = _run_git(["config", "--get", f"remote.{DEFAULT_REMOTE}.url"]).strip()
    return _github_repository_from_remote(remote_url)


def _normalize_github_repository(value: str) -> str:
    candidate = value.removeprefix("https://github.com/").removeprefix("http://github.com/").strip("/")
    if candidate.endswith(".git"):
        candidate = candidate[:-4]
    parts = [part for part in candidate.split("/") if part]
    if len(parts) != 2 or not all(re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts):
        raise UpdateError("ATTUNO_GITHUB_REPOSITORY 必须是 owner/repo 格式")
    return "/".join(parts)


def _github_repository_from_remote(remote_url: str) -> str:
    value = remote_url.strip()
    ssh_match = re.fullmatch(r"(?:git@|ssh://git@)github\.com[:/](?P<repo>[^ ]+?)(?:\.git)?", value)
    if ssh_match:
        return _normalize_github_repository(ssh_match.group("repo"))

    parsed = urllib.parse.urlparse(value)
    if parsed.netloc.lower() == "github.com":
        return _normalize_github_repository(parsed.path)
    raise UpdateError("无法从 origin remote 推导 GitHub 仓库，请设置 ATTUNO_GITHUB_REPOSITORY=owner/repo")


def _request_latest_github_release(repository: str) -> dict[str, Any]:
    owner, repo = repository.split("/", 1)
    url = "https://api.github.com/repos/{owner}/{repo}/releases/latest".format(
        owner=urllib.parse.quote(owner, safe=""),
        repo=urllib.parse.quote(repo, safe=""),
    )
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Attuno-Update-Service",
        "X-GitHub-Api-Version": os.environ.get("ATTUNO_GITHUB_API_VERSION", DEFAULT_GITHUB_API_VERSION),
    }
    token = os.environ.get("ATTUNO_GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=GITHUB_API_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read(512).decode("utf-8", errors="replace")
        raise UpdateError(f"GitHub latest release 请求失败：HTTP {exc.code} {detail}".strip()) from exc
    except urllib.error.URLError as exc:
        raise UpdateError(f"GitHub latest release 请求失败：{exc.reason}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise UpdateError("GitHub latest release 响应不是有效 JSON") from exc
    if not isinstance(data, dict):
        raise UpdateError("GitHub latest release 响应格式无效")
    return data


def _validate_release_tag(tag: str) -> None:
    if not tag or any(ord(char) < 32 for char in tag):
        raise UpdateError("GitHub latest release tag 无效")
    try:
        _run_git(["check-ref-format", f"refs/tags/{tag}"])
    except UpdateError as exc:
        raise UpdateError(f"GitHub latest release tag 无效：{tag}") from exc


def _fetch_release_tag(tag: str) -> None:
    _run_git(["fetch", "--force", DEFAULT_REMOTE, f"refs/tags/{tag}:refs/tags/{tag}"])


def _commit_for_tag(tag: str) -> str:
    return _run_git(["rev-parse", f"refs/tags/{tag}^{{commit}}"]).strip()


def _checkout_release_status(status: dict[str, Any]) -> None:
    tag = str(status.get("latest_release_tag") or "").strip()
    target_commit = str(status.get("latest_release_commit") or status.get("remote_commit") or "").strip()
    if not tag or not target_commit:
        raise UpdateError("缺少 latest release tag 或 commit，无法执行更新")
    _validate_release_tag(tag)
    resolved_commit = _commit_for_tag(tag)
    if resolved_commit != target_commit:
        raise UpdateError("latest release tag 对应 commit 已变化，请重新检查更新后再执行。")
    _run_git(["checkout", "--detach", target_commit])


def _current_branch() -> str:
    return _run_git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()


def _current_release_tag() -> str:
    try:
        tags = _run_git(["tag", "--points-at", "HEAD"]).splitlines()
    except UpdateError:
        return ""
    return sorted(tag.strip() for tag in tags if tag.strip())[0] if tags else ""


def _short_commit(value: str) -> str:
    return value[:7] if value else ""


def _is_ancestor(current_commit: str, target_commit: str) -> bool:
    if not current_commit or not target_commit:
        return False
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", current_commit, target_commit],
        cwd=str(REPO_ROOT),
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    detail = _redact_output((result.stderr or result.stdout or "").strip())
    raise UpdateError(detail or "git merge-base --is-ancestor failed")


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
    text = re.sub(r"(ATTUNO_GITHUB_TOKEN=)[^\s]+", r"\1***", text)
    text = re.sub(r"(DATABASE_URL=postgresql://[^:\s]+:)[^@\s]+(@)", r"\1***\2", text)
    return text[-LOG_LIMIT:]
