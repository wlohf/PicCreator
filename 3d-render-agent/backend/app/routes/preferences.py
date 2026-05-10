from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.app.services.auth_service import get_current_or_default_user
from backend.app.services.preferences_store import (
    load_shortcuts,
    load_style_profile,
    record_behavior_signal,
    save_shortcuts,
    save_style_profile,
)

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


class ShortcutPreferences(BaseModel):
    user_id: str = "default"
    shortcuts: list[dict[str, str]] = Field(default_factory=list)


class StyleProfilePayload(BaseModel):
    user_id: str = "default"
    project_id: str = "default"
    user_style_preferences: dict = Field(default_factory=dict)
    project_style_memory: dict = Field(default_factory=dict)


class PreferenceEventPayload(BaseModel):
    event_type: str
    user_id: str = "default"
    project_id: str = "default"
    result_id: str = ""
    payload: dict = Field(default_factory=dict)


@router.get("/shortcuts")
def get_shortcuts(user=Depends(get_current_or_default_user)):
    return {"ok": True, "shortcuts": load_shortcuts(user["user_id"])}


@router.put("/shortcuts")
def put_shortcuts(payload: ShortcutPreferences, user=Depends(get_current_or_default_user)):
    return {"ok": True, "shortcuts": save_shortcuts(payload.shortcuts, user["user_id"])}


@router.get("/style-profile")
def get_style_profile(project_id: str = "default", user=Depends(get_current_or_default_user)):
    return {"ok": True, "profile": load_style_profile(project_id, user["user_id"])}


@router.put("/style-profile")
def put_style_profile(payload: StyleProfilePayload, user=Depends(get_current_or_default_user)):
    return {"ok": True, "profile": save_style_profile(payload.project_id, payload.model_dump(), user["user_id"])}


@router.post("/events")
def post_preference_event(payload: PreferenceEventPayload, user=Depends(get_current_or_default_user)):
    signal = record_behavior_signal(
        payload.event_type,
        result_id=payload.result_id,
        project_id=payload.project_id,
        user_id=user["user_id"],
        payload=payload.payload,
    )
    return {"ok": True, "signal": signal}
