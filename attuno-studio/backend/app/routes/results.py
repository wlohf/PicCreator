from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.app.services.auth_service import get_current_or_default_user
from backend.app.services.result_store import (
    clear_results,
    delete_result,
    get_result,
    get_result_annotation_path,
    get_result_floor_plan_path,
    get_result_image_path,
    list_results,
    update_result_notes,
)
from backend.app.services.preferences_store import record_behavior_signal

router = APIRouter(prefix="/api/results", tags=["results"])


class ResultNotesPayload(BaseModel):
    notes: str = ""


@router.get("")
def get_results(user=Depends(get_current_or_default_user)):
    return {"ok": True, "results": list_results(user_id=user["user_id"])}


@router.delete("")
def delete_all_results(user=Depends(get_current_or_default_user)):
    deleted = clear_results(user["user_id"])
    return {"ok": True, "deleted": deleted}


@router.delete("/{result_id}")
def remove_result(result_id: str, user=Depends(get_current_or_default_user)):
    item = get_result(result_id, user["user_id"])
    if item is None or not delete_result(result_id, user["user_id"]):
        raise HTTPException(status_code=404, detail="result not found")
    record_behavior_signal(
        "delete",
        result_id=result_id,
        project_id=str(item.get("project_id") or "default"),
        user_id=user["user_id"],
        payload={"title": item.get("title") or ""},
    )
    return {"ok": True}


@router.patch("/{result_id}/notes")
def save_result_notes(result_id: str, payload: ResultNotesPayload, user=Depends(get_current_or_default_user)):
    item = update_result_notes(result_id, payload.notes, user["user_id"])
    if item is None:
        raise HTTPException(status_code=404, detail="result not found")
    record_behavior_signal(
        "note",
        result_id=result_id,
        project_id=str(item.get("project_id") or "default"),
        user_id=user["user_id"],
        payload={"has_notes": bool(payload.notes.strip())},
    )
    return {"ok": True, "result": item}


@router.get("/{result_id}/image")
def get_result_image(result_id: str, user=Depends(get_current_or_default_user)):
    path = get_result_image_path(result_id, user["user_id"])
    if path is None:
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(path)


@router.get("/{result_id}/floor-plan")
def get_result_floor_plan(result_id: str, user=Depends(get_current_or_default_user)):
    path = get_result_floor_plan_path(result_id, user["user_id"])
    if path is None:
        raise HTTPException(status_code=404, detail="floor plan not found")
    return FileResponse(path)


@router.get("/{result_id}/annotation")
def get_result_annotation(result_id: str, user=Depends(get_current_or_default_user)):
    path = get_result_annotation_path(result_id, user["user_id"])
    if path is None:
        raise HTTPException(status_code=404, detail="annotation not found")
    return FileResponse(path)


@router.get("/{result_id}/download")
def download_result_image(result_id: str, user=Depends(get_current_or_default_user)):
    item = get_result(result_id, user["user_id"])
    path = get_result_image_path(result_id, user["user_id"])
    if item is None or path is None:
        raise HTTPException(status_code=404, detail="image not found")
    record_behavior_signal(
        "download",
        result_id=result_id,
        project_id=str(item.get("project_id") or "default"),
        user_id=user["user_id"],
        payload={"title": item.get("title") or "", "version_index": item.get("version_index") or 1},
    )
    download_name = item.get("image_label") or item.get("title") or path.name
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in str(download_name)).strip("-") or path.stem
    return FileResponse(path, filename=f"{safe_name}{path.suffix}")
