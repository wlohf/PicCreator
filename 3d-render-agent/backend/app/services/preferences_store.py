import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.app.services.result_store import get_data_dir, get_user_data_dir


def get_preferences_path(user_id: str = "default") -> Path:
    if str(user_id or "default") == "default":
        legacy = get_data_dir() / "preferences.json"
        namespaced = get_user_data_dir(user_id) / "preferences.json"
        if legacy.exists() and not namespaced.exists():
            return legacy
    return get_user_data_dir(user_id) / "preferences.json"


def _empty_preferences() -> dict[str, Any]:
    return {
        "shortcuts": [],
        "user_style_preferences": {"explicit": [], "inferred": [], "avoid": []},
        "project_style_memories": {},
        "behavior_signals": [],
        "preference_summary": {
            "long_term_preferences": [],
            "project_preferences": {},
            "avoid_items": [],
            "evaluation_standards": [],
            "frequent_edit_requests": [],
        },
    }


def _ensure_preferences(user_id: str = "default") -> None:
    get_user_data_dir(user_id).mkdir(parents=True, exist_ok=True)
    path = get_preferences_path(user_id)
    if not path.exists():
        path.write_text(json.dumps(_empty_preferences(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_preferences(user_id: str = "default") -> dict[str, Any]:
    _ensure_preferences(user_id)
    try:
        data = json.loads(get_preferences_path(user_id).read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    merged = _empty_preferences()
    merged.update(data)
    merged.pop("reference_memories", None)
    return merged


def _write_preferences(data: dict[str, Any], user_id: str = "default") -> None:
    _ensure_preferences(user_id)
    get_preferences_path(user_id).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _normalize_shortcut(item: Any, index: int) -> dict[str, str] | None:
    if isinstance(item, str):
        phrase = item.strip()
        return {"id": f"legacy-{index}-{phrase}", "zh": phrase, "en": phrase} if phrase else None
    if not isinstance(item, dict):
        return None
    legacy_text = str(item.get("text") or "").strip()
    zh = str(item.get("zh") or legacy_text).strip()
    en = str(item.get("en") or legacy_text).strip()
    if not zh and not en:
        return None
    return {
        "id": str(item.get("id") or f"shortcut-{index}-{zh or en}"),
        "zh": zh or en,
        "en": en or zh,
    }


def _normalize_text_list(value: Any, limit: int = 30) -> list[str]:
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = str(item or "").strip()
        if text and text not in seen:
            normalized.append(text)
            seen.add(text)
    return normalized[:limit]


def _normalize_user_style(value: Any) -> dict[str, list[str]]:
    value = value if isinstance(value, dict) else {}
    return {
        "explicit": _normalize_text_list(value.get("explicit")),
        "inferred": _normalize_text_list(value.get("inferred")),
        "avoid": _normalize_text_list(value.get("avoid")),
    }


def _normalize_project_memory(value: Any) -> dict[str, list[str]]:
    value = value if isinstance(value, dict) else {}
    return {
        "style": _normalize_text_list(value.get("style")),
        "furniture": _normalize_text_list(value.get("furniture")),
        "structure": _normalize_text_list(value.get("structure")),
        "materials": _normalize_text_list(value.get("materials")),
        "lighting": _normalize_text_list(value.get("lighting")),
        "avoid": _normalize_text_list(value.get("avoid")),
    }


def normalize_shortcuts(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    shortcuts: list[dict[str, str]] = []
    for index, item in enumerate(value):
        normalized = _normalize_shortcut(item, index)
        if normalized:
            shortcuts.append(normalized)
    return shortcuts[:20]


def load_shortcuts(user_id: str = "default") -> list[dict[str, str]]:
    data = _read_preferences(user_id)
    return normalize_shortcuts(data.get("shortcuts"))


def save_shortcuts(shortcuts: Any, user_id: str = "default") -> list[dict[str, str]]:
    normalized = normalize_shortcuts(shortcuts)
    data = _read_preferences(user_id)
    _write_preferences({**data, "shortcuts": normalized}, user_id)
    return normalized


def format_style_profile_context(style_profile: dict[str, Any] | None) -> str:
    profile = style_profile if isinstance(style_profile, dict) else {}
    sections: list[str] = []
    user_style = profile.get("user_style_preferences")
    if isinstance(user_style, dict):
        sections.extend(_join_memory_values(user_style, ("explicit", "inferred", "avoid")))
    project_memory = profile.get("project_style_memory")
    if isinstance(project_memory, dict):
        sections.extend(_join_memory_values(project_memory, ("style", "furniture", "structure", "materials", "lighting", "avoid")))
    behavior_summary = profile.get("behavior_summary")
    if isinstance(behavior_summary, dict):
        sections.extend(_join_memory_values(behavior_summary, ("frequent_edit_requests", "downloaded_result_ids", "continued_result_ids")))
    preference_summary = profile.get("preference_summary")
    if isinstance(preference_summary, dict):
        sections.extend(_join_memory_values(preference_summary, ("long_term_preferences", "avoid_items", "evaluation_standards", "frequent_edit_requests")))
    return "\n".join(sections)


def load_style_profile(project_id: str = "default", user_id: str = "default") -> dict[str, Any]:
    data = _read_preferences(user_id)
    project_memories = data.get("project_style_memories") if isinstance(data.get("project_style_memories"), dict) else {}
    behavior_signals = data.get("behavior_signals") if isinstance(data.get("behavior_signals"), list) else []
    preference_summary = data.get("preference_summary") if isinstance(data.get("preference_summary"), dict) else {}
    project_key = project_id or "default"
    return {
        "user_style_preferences": _normalize_user_style(data.get("user_style_preferences")),
        "project_style_memory": _normalize_project_memory(project_memories.get(project_key)),
        "behavior_summary": _summarize_behavior_signals(behavior_signals, project_key),
        "preference_summary": preference_summary,
    }


def save_style_profile(project_id: str, payload: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    data = _read_preferences(user_id)
    project_key = project_id or "default"
    project_memories = data.get("project_style_memories") if isinstance(data.get("project_style_memories"), dict) else {}
    user_style = payload.get("user_style_preferences", data.get("user_style_preferences"))
    project_memory = payload.get("project_style_memory", project_memories.get(project_key))
    next_data = {
        **data,
        "user_style_preferences": _normalize_user_style(user_style),
        "project_style_memories": {**project_memories, project_key: _normalize_project_memory(project_memory)},
    }
    _write_preferences(next_data, user_id)
    return load_style_profile(project_key, user_id)


def apply_chat_memory(project_id: str, memory_candidate: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    data = _read_preferences(user_id)
    project_key = project_id or "default"
    candidate = memory_candidate if isinstance(memory_candidate, dict) else {}

    current_user = _normalize_user_style(data.get("user_style_preferences"))
    current_user["explicit"] = _normalize_text_list(
        [*current_user.get("explicit", []), *_normalize_text_list(candidate.get("likes"))]
    )
    current_user["avoid"] = _normalize_text_list(
        [*current_user.get("avoid", []), *_normalize_text_list(candidate.get("avoids"))]
    )

    project_memories = data.get("project_style_memories") if isinstance(data.get("project_style_memories"), dict) else {}
    current_project = _normalize_project_memory(project_memories.get(project_key))
    project_items = _normalize_text_list(candidate.get("project"))
    current_project["structure"] = _normalize_text_list([*current_project.get("structure", []), *project_items])

    preference_summary = data.get("preference_summary") if isinstance(data.get("preference_summary"), dict) else {}
    evaluation_standards = _normalize_text_list(
        [
            *(_normalize_text_list(preference_summary.get("evaluation_standards"))),
            *_normalize_text_list(candidate.get("evaluation_standards")),
        ]
    )
    preference_summary = {**preference_summary, "evaluation_standards": evaluation_standards}

    next_data = {
        **data,
        "user_style_preferences": current_user,
        "project_style_memories": {**project_memories, project_key: current_project},
        "preference_summary": preference_summary,
    }
    _write_preferences(next_data, user_id)
    return next_data


def record_behavior_signal(
    event_type: str,
    *,
    result_id: str = "",
    project_id: str = "default",
    user_id: str = "default",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = _read_preferences(user_id)
    project_key = project_id or "default"
    signal = {
        "id": f"signal-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "event_type": event_type,
        "result_id": result_id,
        "project_id": project_key,
        "payload": payload or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    signals = data.get("behavior_signals") if isinstance(data.get("behavior_signals"), list) else []
    next_signals = [signal, *signals][:200]
    next_data = {**data, "behavior_signals": next_signals}

    style_tags = [s.strip() for s in str((payload or {}).get("style_tags") or "").split(",") if s.strip()]
    if event_type in {"edit", "annotated_edit"} and style_tags:
        project_memories = next_data.get("project_style_memories") if isinstance(next_data.get("project_style_memories"), dict) else {}
        current = _normalize_project_memory(project_memories.get(project_key))
        current["style"] = _normalize_text_list([*current.get("style", []), *style_tags], limit=20)
        project_memories[project_key] = current
        next_data["project_style_memories"] = project_memories

    next_data["preference_summary"] = _build_preference_summary(next_data, project_key)
    _write_preferences(next_data, user_id)
    return signal


def _join_memory_values(source: dict[str, Any], keys: tuple[str, ...]) -> list[str]:
    lines: list[str] = []
    for key in keys:
        values = _normalize_text_list(source.get(key), limit=12)
        if values:
            lines.append(f"{key}: " + "；".join(values))
    return lines


def _summarize_behavior_signals(signals: list[Any], project_id: str) -> dict[str, Any]:
    project_signals = [
        signal for signal in signals
        if isinstance(signal, dict) and signal.get("project_id") in {project_id, "default"}
    ]
    edit_requests = []
    downloaded_ids = []
    continued_ids = []
    deleted_ids = []
    referenced_ids = []
    for signal in project_signals:
        payload = signal.get("payload") if isinstance(signal.get("payload"), dict) else {}
        event_type = signal.get("event_type")
        if event_type in {"edit", "annotated_edit"}:
            continued_ids.append(str(signal.get("result_id") or ""))
            edit_requests.append(str(payload.get("edit_instruction") or ""))
        if event_type == "download":
            downloaded_ids.append(str(signal.get("result_id") or ""))
        if event_type == "delete":
            deleted_ids.append(str(signal.get("result_id") or ""))
        if event_type == "reference":
            referenced_ids.append(str(signal.get("result_id") or ""))
    return {
        "frequent_edit_requests": _normalize_text_list(edit_requests, limit=12),
        "continued_result_ids": _normalize_text_list(continued_ids, limit=12),
        "downloaded_result_ids": _normalize_text_list(downloaded_ids, limit=12),
        "deleted_result_ids": _normalize_text_list(deleted_ids, limit=12),
        "referenced_result_ids": _normalize_text_list(referenced_ids, limit=12),
    }


def _build_preference_summary(data: dict[str, Any], project_id: str) -> dict[str, Any]:
    user_style = _normalize_user_style(data.get("user_style_preferences"))
    project_memories = data.get("project_style_memories") if isinstance(data.get("project_style_memories"), dict) else {}
    project_memory = _normalize_project_memory(project_memories.get(project_id))
    behavior_summary = _summarize_behavior_signals(
        data.get("behavior_signals") if isinstance(data.get("behavior_signals"), list) else [],
        project_id,
    )
    return {
        "long_term_preferences": _normalize_text_list([*user_style["explicit"], *user_style["inferred"]], limit=20),
        "project_preferences": project_memory,
        "avoid_items": _normalize_text_list([*user_style["avoid"], *project_memory["avoid"]], limit=20),
        "evaluation_standards": _normalize_text_list(
            [*project_memory["structure"], *project_memory["materials"], *project_memory["lighting"]],
            limit=20,
        ),
        "frequent_edit_requests": behavior_summary["frequent_edit_requests"],
    }
