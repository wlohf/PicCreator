import json
import mimetypes
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

_lock = Lock()
_MAX_RESULTS = 50
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

from backend.app.services.file_service import image_record


def get_data_dir() -> Path:
    raw_path = os.environ.get("ATTUNO_STUDIO_DATA_DIR") or os.environ.get("RENDER_AGENT_DATA_DIR")
    if raw_path:
        path = Path(raw_path).expanduser()
        return (path if path.is_absolute() else _PROJECT_ROOT / path).resolve()
    attuno_dir = (_PROJECT_ROOT / ".attuno-studio-data").resolve()
    legacy_dir = (_PROJECT_ROOT / ".render-agent-data").resolve()
    if legacy_dir.exists() and not attuno_dir.exists():
        return legacy_dir
    return attuno_dir


def normalize_user_id(user_id: str | None) -> str:
    text = str(user_id or "").strip()
    if not text:
        return "default"
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in text)
    return safe[:80] or "default"


def get_user_data_dir(user_id: str = "default") -> Path:
    return get_data_dir() / "users" / normalize_user_id(user_id)


def get_images_dir(user_id: str = "default") -> Path:
    if str(user_id or "default") == "default":
        legacy = get_data_dir() / "images"
        namespaced = get_user_data_dir(user_id) / "images"
        if legacy.exists() and not namespaced.exists():
            return legacy
    return get_user_data_dir(user_id) / "images"


def get_index_path(user_id: str = "default") -> Path:
    if str(user_id or "default") == "default":
        legacy = get_data_dir() / "results.json"
        namespaced = get_user_data_dir(user_id) / "results.json"
        if legacy.exists() and not namespaced.exists():
            return legacy
    return get_user_data_dir(user_id) / "results.json"


def _ensure_storage(user_id: str = "default"):
    get_images_dir(user_id).mkdir(parents=True, exist_ok=True)
    index_path = get_index_path(user_id)
    if not index_path.exists():
        index_path.write_text("[]\n", encoding="utf-8")


def _read_results(user_id: str = "default") -> list[dict[str, Any]]:
    _ensure_storage(user_id)
    try:
        data = json.loads(get_index_path(user_id).read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _write_results(results: list[dict[str, Any]], user_id: str = "default"):
    _ensure_storage(user_id)
    get_index_path(user_id).write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_results_locked(user_id: str = "default") -> list[dict[str, Any]]:
    with _lock:
        return _read_results(user_id)


def _write_results_locked(results: list[dict[str, Any]], user_id: str = "default"):
    with _lock:
        _write_results(results, user_id)


def _copy_image(source_path: str, result_id: str, user_id: str = "default") -> tuple[str | None, str | None]:
    return _copy_file_to_images(source_path, result_id, user_id)


def _copy_file_to_images(source_path: str, filename_stem: str, user_id: str = "default") -> tuple[str | None, str | None]:
    if not source_path:
        return None, None
    path = Path(source_path)
    if not path.exists() or not path.is_file():
        return None, None
    suffix = path.suffix or mimetypes.guess_extension(mimetypes.guess_type(str(path))[0] or "") or ".png"
    images_dir = get_images_dir(user_id)
    images_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{filename_stem}{suffix}"
    target = images_dir / filename
    shutil.copyfile(path, target)
    return filename, str(target)


def result_to_response(item: dict[str, Any], user_id: str = "default") -> dict[str, Any]:
    result_id = str(item.get("id") or "")
    response_user_id = str(item.get("user_id") or user_id or "default")
    filename = item.get("filename")
    annotation_filename = item.get("annotation_filename")
    floor_plan_filename = item.get("floor_plan_filename")
    image_url = f"/api/results/{result_id}/image" if result_id and filename else None
    download_url = f"/api/results/{result_id}/download" if result_id and filename else None
    annotation_url = f"/api/results/{result_id}/annotation" if result_id and annotation_filename else None
    floor_plan_url = f"/api/results/{result_id}/floor-plan" if result_id and floor_plan_filename else None
    return {
        "id": result_id,
        "title": item.get("title") or item.get("image_label") or "Render result",
        "status": item.get("status") or "",
        "image_url": image_url,
        "download_url": download_url,
        "annotation_url": annotation_url,
        "floor_plan_url": floor_plan_url,
        "image_label": item.get("image_label") or "",
        "filename": filename or "",
        "annotation_filename": annotation_filename or "",
        "floor_plan_filename": floor_plan_filename or "",
        "floor_plan_name": item.get("floor_plan_name") or "",
        "prompt": item.get("prompt") or "",
        "evaluation": item.get("evaluation") or "",
        "floor_desc": item.get("floor_desc") or "",
        "logs": item.get("logs") or "",
        "notes": item.get("notes") or "",
        "created_at": item.get("created_at") or "",
        "parent_id": item.get("parent_id") or "",
        "generation_type": item.get("generation_type") or "generation",
        "edit_mode": item.get("edit_mode") or ("text" if item.get("generation_type") == "edit" else ""),
        "edit_instruction": item.get("edit_instruction") or "",
        "annotation_analysis": item.get("annotation_analysis") or {},
        "source_prompt": item.get("source_prompt") or "",
        "source_evaluation": item.get("source_evaluation") or "",
        "source_logs": item.get("source_logs") or "",
        "model_used": item.get("model_used") or "",
        "model_warning": item.get("model_warning") or "",
        "generation_mode": item.get("generation_mode") or "",
        "version_index": int(item.get("version_index") or 1),
        "project_id": item.get("project_id") or "default",
        "user_id": response_user_id,
    }


def list_results(limit: int = _MAX_RESULTS, user_id: str = "default") -> list[dict[str, Any]]:
    return [result_to_response(item, user_id=user_id) for item in _read_results_locked(user_id)[:limit]]


def create_result(
    *,
    title: str,
    status: str,
    image_path: str | None,
    image_label: str,
    prompt: str,
    evaluation: str,
    logs: str,
    floor_desc: str = "",
    parent_id: str = "",
    generation_type: str = "generation",
    edit_instruction: str = "",
    edit_mode: str = "",
    annotation_path: str | None = None,
    annotation_analysis: dict[str, Any] | None = None,
    floor_plan_path: str | None = None,
    floor_plan_name: str = "",
    notes: str = "",
    source_prompt: str = "",
    source_evaluation: str = "",
    source_logs: str = "",
    model_used: str = "",
    model_warning: str = "",
    generation_mode: str = "",
    version_index: int = 1,
    project_id: str = "default",
    user_id: str = "default",
) -> dict[str, Any]:
    result_id = f"result-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}"
    filename, stored_path = _copy_image(image_path or "", result_id, user_id)
    annotation_filename, _stored_annotation_path = _copy_file_to_images(annotation_path or "", f"{result_id}-annotation", user_id)
    floor_plan_filename, _stored_floor_plan_path = _copy_file_to_images(floor_plan_path or "", f"{result_id}-floor-plan", user_id)
    item = {
        "id": result_id,
        "title": title or image_label or "Render result",
        "status": status or "",
        "filename": filename or "",
        "annotation_filename": annotation_filename or "",
        "floor_plan_filename": floor_plan_filename or "",
        "floor_plan_name": floor_plan_name or (Path(floor_plan_path).name if floor_plan_path else ""),
        "image_label": image_label or "",
        "prompt": prompt or "",
        "evaluation": evaluation or "",
        "floor_desc": floor_desc or "",
        "logs": logs or "",
        "notes": notes or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "parent_id": parent_id or "",
        "generation_type": generation_type or "generation",
        "edit_mode": edit_mode or ("text" if generation_type == "edit" else ""),
        "edit_instruction": edit_instruction or "",
        "annotation_analysis": annotation_analysis or {},
        "source_prompt": source_prompt or "",
        "source_evaluation": source_evaluation or "",
        "source_logs": source_logs or "",
        "model_used": model_used or "",
        "model_warning": model_warning or "",
        "generation_mode": generation_mode or "",
        "version_index": int(version_index or 1),
        "project_id": project_id or "default",
        "user_id": user_id or "default",
    }
    with _lock:
        results = [item, *_read_results(user_id)]
        _write_results(results[:_MAX_RESULTS], user_id)
    response = result_to_response(item, user_id=user_id)
    if stored_path:
        record = image_record(stored_path, image_label or title or "render")
        if record:
            response["data_url"] = record["data_url"]
    return response


def get_result(result_id: str, user_id: str = "default") -> dict[str, Any] | None:
    for item in _read_results(user_id):
        if item.get("id") == result_id:
            return item
    return None


def get_result_image_path(result_id: str, user_id: str = "default") -> Path | None:
    item = get_result(result_id, user_id)
    if not item or not item.get("filename"):
        return None
    path = get_images_dir(user_id) / str(item["filename"])
    return path if path.exists() else None


def get_result_annotation_path(result_id: str, user_id: str = "default") -> Path | None:
    item = get_result(result_id, user_id)
    if not item or not item.get("annotation_filename"):
        return None
    path = get_images_dir(user_id) / str(item["annotation_filename"])
    return path if path.exists() else None


def get_result_floor_plan_path(result_id: str, user_id: str = "default") -> Path | None:
    item = get_result(result_id, user_id)
    if not item or not item.get("floor_plan_filename"):
        return None
    path = get_images_dir(user_id) / str(item["floor_plan_filename"])
    return path if path.exists() else None


def update_result_notes(result_id: str, notes: str, user_id: str = "default") -> dict[str, Any] | None:
    with _lock:
        results = _read_results(user_id)
        updated = None
        for item in results:
            if item.get("id") == result_id:
                item["notes"] = str(notes or "")
                item["updated_at"] = datetime.now(timezone.utc).isoformat()
                updated = item
                break
        if updated is None:
            return None
        _write_results(results, user_id)
    return result_to_response(updated, user_id=user_id)


def delete_result(result_id: str, user_id: str = "default") -> bool:
    with _lock:
        results = _read_results(user_id)
        kept = []
        removed = None
        for item in results:
            if item.get("id") == result_id:
                removed = item
            else:
                kept.append(item)
        if removed is None:
            return False
        _write_results(kept, user_id)
    if removed.get("filename"):
        try:
            (get_images_dir(user_id) / str(removed["filename"])).unlink(missing_ok=True)
        except OSError:
            pass
    if removed.get("annotation_filename"):
        try:
            (get_images_dir(user_id) / str(removed["annotation_filename"])).unlink(missing_ok=True)
        except OSError:
            pass
    if removed.get("floor_plan_filename"):
        try:
            (get_images_dir(user_id) / str(removed["floor_plan_filename"])).unlink(missing_ok=True)
        except OSError:
            pass
    return True


def clear_results(user_id: str = "default") -> int:
    with _lock:
        results = _read_results(user_id)
        _write_results([], user_id)
    for item in results:
        if item.get("filename"):
            try:
                (get_images_dir(user_id) / str(item["filename"])).unlink(missing_ok=True)
            except OSError:
                pass
        if item.get("annotation_filename"):
            try:
                (get_images_dir(user_id) / str(item["annotation_filename"])).unlink(missing_ok=True)
            except OSError:
                pass
        if item.get("floor_plan_filename"):
            try:
                (get_images_dir(user_id) / str(item["floor_plan_filename"])).unlink(missing_ok=True)
            except OSError:
                pass
    return len(results)
