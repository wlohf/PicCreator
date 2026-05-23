from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import app_runtime
from backend.app.services.auth_service import get_current_or_default_user, resolve_config_user_id
from backend.app.services.design_chat_agent import DesignChatAgent
from backend.app.services.preferences_store import apply_chat_memory

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatApiConfig(BaseModel):
    analysisProviderName: str = ""
    analysisApiFormat: str = ""
    analysisBaseUrl: str = ""
    analysisApiKey: str = ""
    analysisModel: str = ""


class ChatPayload(BaseModel):
    message: str
    user_id: str = "default"
    project_id: str = "default"
    active_result_id: str = ""
    context: dict[str, Any] = Field(default_factory=dict)
    remember: bool = False
    api_config: ChatApiConfig | None = None
    reasoning_effort: str = "medium"


class ChatMemoryPayload(BaseModel):
    user_id: str = "default"
    project_id: str = "default"
    memory_candidate: dict[str, Any] = Field(default_factory=dict)


def _chat_error_response(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})


def _chat_config_values(config: ChatApiConfig | None) -> tuple[str, str, str, str, str]:
    if config is None:
        return "", "", "", "", ""
    return (
        config.analysisProviderName,
        config.analysisApiFormat,
        config.analysisBaseUrl,
        config.analysisApiKey,
        config.analysisModel,
    )


def _effort_instruction(effort: str) -> str:
    normalized = (effort or "medium").strip().lower()
    if normalized == "high":
        return "回答可以更深入，说明关键判断，但避免空泛。"
    if normalized == "low":
        return "回答保持简洁，直接给出可执行结论。"
    return "回答保持清晰、有条理，并优先回应用户当前问题。"


def _daily_chat_messages(payload: ChatPayload, routed: dict[str, Any]) -> list[dict[str, str]]:
    context = payload.context if isinstance(payload.context, dict) else {}
    active_result = context.get("activeResult") if isinstance(context.get("activeResult"), dict) else {}
    context_bits = [
        f"项目ID：{payload.project_id or 'default'}",
        f"意图分类：{routed.get('intent') or 'daily_chat'}",
    ]
    if payload.active_result_id:
        context_bits.append(f"当前结果ID：{payload.active_result_id}")
    if active_result:
        for label, key in (("当前结果提示词", "prompt"), ("当前评估", "evaluation"), ("平面图分析", "floorDesc")):
            value = str(active_result.get(key) or "").strip()
            if value:
                context_bits.append(f"{label}：{value[:800]}")

    return [
        {
            "role": "system",
            "content": (
                "你是 Attuno 的日常聊天助手。默认只进行普通对话，不直接生成图片；"
                "如果用户表达了明确的出图需求，可以用简短文字说明可切换到图像模式继续。"
                "不要声称已经生成图片，不要虚构后台执行结果。"
                f"{_effort_instruction(payload.reasoning_effort)}"
            ),
        },
        {
            "role": "user",
            "content": "\n".join([*context_bits, f"用户消息：{payload.message}"]),
        },
    ]


def _run_configured_daily_chat(payload: ChatPayload, routed: dict[str, Any], user: dict[str, Any]) -> str:
    config_user_id = resolve_config_user_id(user)
    analysis_cfg = app_runtime._build_analysis_adapter_config(*_chat_config_values(payload.api_config), user_id=config_user_id)
    llm = app_runtime.build_adapter(analysis_cfg, "llm")
    reply = app_runtime._run_async(
        llm.chat(
            _daily_chat_messages(payload, routed),
            max_tokens=900,
        )
    )
    reply_text = str(reply or "").strip()
    if not reply_text:
        raise RuntimeError("聊天模型返回为空")
    return reply_text


@router.post("")
def chat(payload: ChatPayload, user=Depends(get_current_or_default_user)):
    data = payload.model_dump()
    data["user_id"] = user["user_id"]
    result = DesignChatAgent().respond(data)
    if result.get("suggested_action") == "chat":
        try:
            result["reply"] = _run_configured_daily_chat(payload, result, user)
        except Exception as exc:
            return _chat_error_response("chat", str(exc))
    if payload.remember:
        result["preferences"] = apply_chat_memory(payload.project_id, result["memory_candidate"], user["user_id"])
    return result


@router.post("/memory")
def save_chat_memory(payload: ChatMemoryPayload, user=Depends(get_current_or_default_user)):
    preferences = apply_chat_memory(payload.project_id, payload.memory_candidate, user["user_id"])
    return {"ok": True, "project_id": payload.project_id or "default", "preferences": preferences}
