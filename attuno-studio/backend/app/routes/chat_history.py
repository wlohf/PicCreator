from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.auth_service import get_current_or_namespace_user
from backend.app.services.chat_history_store import (
    load_chat_history,
    load_chat_history_summary,
    load_chat_session,
    save_chat_history,
)


router = APIRouter(prefix="/api/chat-history", tags=["chat-history"])


class ChatHistoryPayload(BaseModel):
    currentSessionId: str = ""
    sessions: list[dict] = Field(default_factory=list)


@router.get("")
def get_chat_history(
    summary: bool = Query(False),
    user=Depends(get_current_or_namespace_user),
):
    history = load_chat_history_summary(user["user_id"]) if summary else load_chat_history(user["user_id"])
    return {"ok": True, "history": history}


@router.get("/{session_id}")
def get_chat_session(session_id: str, user=Depends(get_current_or_namespace_user)):
    session = load_chat_session(session_id, user["user_id"])
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return {"ok": True, "session": session}


@router.put("")
def put_chat_history(payload: ChatHistoryPayload, user=Depends(get_current_or_namespace_user)):
    history = save_chat_history(payload.model_dump(), user["user_id"])
    return {"ok": True, "history": history}
