from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from backend.app.services.auth_service import get_current_or_default_user
from backend.app.services.design_chat_agent import DesignChatAgent
from backend.app.services.preferences_store import apply_chat_memory

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatPayload(BaseModel):
    message: str
    user_id: str = "default"
    project_id: str = "default"
    active_result_id: str = ""
    context: dict[str, Any] = Field(default_factory=dict)
    remember: bool = False


class ChatMemoryPayload(BaseModel):
    user_id: str = "default"
    project_id: str = "default"
    memory_candidate: dict[str, Any] = Field(default_factory=dict)


@router.post("")
def chat(payload: ChatPayload, user=Depends(get_current_or_default_user)):
    data = payload.model_dump()
    data["user_id"] = user["user_id"]
    result = DesignChatAgent().respond(data)
    if payload.remember:
        result["preferences"] = apply_chat_memory(payload.project_id, result["memory_candidate"], user["user_id"])
    return result


@router.post("/memory")
def save_chat_memory(payload: ChatMemoryPayload, user=Depends(get_current_or_default_user)):
    preferences = apply_chat_memory(payload.project_id, payload.memory_candidate, user["user_id"])
    return {"ok": True, "project_id": payload.project_id or "default", "preferences": preferences}
