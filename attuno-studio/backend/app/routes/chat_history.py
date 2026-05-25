from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.app.services.auth_service import get_current_or_default_user
from backend.app.services.chat_history_store import load_chat_history, save_chat_history


router = APIRouter(prefix="/api/chat-history", tags=["chat-history"])


class ChatHistoryPayload(BaseModel):
    currentSessionId: str = ""
    sessions: list[dict] = Field(default_factory=list)


@router.get("")
def get_chat_history(user=Depends(get_current_or_default_user)):
    return {"ok": True, "history": load_chat_history(user["user_id"])}


@router.put("")
def put_chat_history(payload: ChatHistoryPayload, user=Depends(get_current_or_default_user)):
    history = save_chat_history(payload.model_dump(), user["user_id"])
    return {"ok": True, "history": history}
