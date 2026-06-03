from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.auth_service import get_current_or_default_user
from backend.app.services.preferences_store import (
    delete_memory_item,
    load_memory_view,
    load_prompt_skills,
    load_shortcuts,
    load_style_profile,
    record_behavior_signal,
    save_prompt_skills,
    save_shortcuts,
    save_style_profile,
    update_memory_item,
)

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


class ShortcutPreferences(BaseModel):
    user_id: str = "default"
    shortcuts: list[dict[str, str]] = Field(default_factory=list)


class PromptSkillPreferences(BaseModel):
    user_id: str = "default"
    prompt_skills: list[dict[str, str]] = Field(default_factory=list)


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


class MemoryItemPayload(BaseModel):
    text: str = ""
    project_id: str = "default"


@router.get("/shortcuts")
def get_shortcuts(user=Depends(get_current_or_default_user)):
    return {"ok": True, "shortcuts": load_shortcuts(user["user_id"])}


@router.put("/shortcuts")
def put_shortcuts(payload: ShortcutPreferences, user=Depends(get_current_or_default_user)):
    return {"ok": True, "shortcuts": save_shortcuts(payload.shortcuts, user["user_id"])}


@router.get("/prompt-skills")
def get_prompt_skills(user=Depends(get_current_or_default_user)):
    return {"ok": True, "prompt_skills": load_prompt_skills(user["user_id"])}


@router.put("/prompt-skills")
def put_prompt_skills(payload: PromptSkillPreferences, user=Depends(get_current_or_default_user)):
    return {"ok": True, "prompt_skills": save_prompt_skills(payload.prompt_skills, user["user_id"])}


@router.get("/style-profile")
def get_style_profile(project_id: str = "default", user=Depends(get_current_or_default_user)):
    return {"ok": True, "profile": load_style_profile(project_id, user["user_id"])}


@router.put("/style-profile")
def put_style_profile(payload: StyleProfilePayload, user=Depends(get_current_or_default_user)):
    return {"ok": True, "profile": save_style_profile(payload.project_id, payload.model_dump(), user["user_id"])}


@router.get("/memory")
def get_memory(project_id: str = "default", user=Depends(get_current_or_default_user)):
    return {
        "ok": True,
        "memory": load_memory_view(project_id, user["user_id"]),
        "profile": load_style_profile(project_id, user["user_id"]),
    }


@router.patch("/memory/{item_id}")
def patch_memory_item(item_id: str, payload: MemoryItemPayload, user=Depends(get_current_or_default_user)):
    try:
        memory = update_memory_item(item_id, payload.text, payload.project_id, user["user_id"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "ok": True,
        "memory": memory,
        "profile": load_style_profile(payload.project_id, user["user_id"]),
    }


@router.delete("/memory/{item_id}")
def remove_memory_item(item_id: str, project_id: str = "default", user=Depends(get_current_or_default_user)):
    try:
        memory = delete_memory_item(item_id, project_id, user["user_id"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "ok": True,
        "memory": memory,
        "profile": load_style_profile(project_id, user["user_id"]),
    }


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
