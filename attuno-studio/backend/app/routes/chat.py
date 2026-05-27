import asyncio
import json
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

import app_runtime
from backend.app.services.auth_service import get_current_or_default_user, resolve_config_user_id
from backend.app.services.design_chat_agent import DesignChatAgent
from backend.app.services.preferences_store import apply_chat_memory
from backend.app.services.web_search import build_web_search_context, should_use_web_search
from config import adapter_supports_image_inputs

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


def _payload_web_search_context(payload: ChatPayload) -> str:
    context = payload.context if isinstance(payload.context, dict) else {}
    return str(context.get("web_search_context") or "").strip()


def _chat_image_attachments(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    attachments: list[dict[str, str]] = []
    for item in value[:8]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("dataUrl") or item.get("data_url") or item.get("url") or "").strip()
        if not (url.startswith("data:image/") or url.startswith("http://") or url.startswith("https://")):
            continue
        attachments.append({
            "name": str(item.get("name") or "").strip()[:120],
            "url": url,
        })
    return attachments


def _content_with_images(text: str, attachments: list[dict[str, str]]) -> str | list[dict[str, Any]]:
    if not attachments:
        return text
    parts: list[dict[str, Any]] = [{"type": "text", "text": text or "请描述这张图片。"}]
    for attachment in attachments:
        parts.append({"type": "image_url", "image_url": {"url": attachment["url"]}})
    return parts


def _payload_has_image_attachments(payload: ChatPayload) -> bool:
    context = payload.context if isinstance(payload.context, dict) else {}
    linear_messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    return any(isinstance(item, dict) and _chat_image_attachments(item.get("attachments")) for item in linear_messages)


def _daily_chat_messages(payload: ChatPayload, routed: dict[str, Any]) -> list[dict[str, Any]]:
    context = payload.context if isinstance(payload.context, dict) else {}
    active_result = context.get("activeResult") if isinstance(context.get("activeResult"), dict) else {}
    linear_messages = context.get("messages") if isinstance(context.get("messages"), list) else []
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

    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "你是 Attuno 的日常聊天助手。默认只进行普通对话，不直接生成图片；"
                "如果用户表达了明确的出图需求，可以用简短文字说明可切换到图像模式继续。"
                "不要声称已经生成图片，不要虚构后台执行结果。"
                f"{_effort_instruction(payload.reasoning_effort)}"
            ),
        }
    ]
    if context_bits:
        messages.append({
            "role": "system",
            "content": "\n".join(context_bits),
        })
    web_search_context = _payload_web_search_context(payload)
    if web_search_context:
        messages.append({
            "role": "system",
            "content": web_search_context,
        })
    for item in linear_messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        attachments = _chat_image_attachments(item.get("attachments"))
        if role not in {"user", "assistant"} or not (content or attachments):
            continue
        messages.append({
            "role": role,
            "content": _content_with_images(content[:4000], attachments),
        })
    payload_message = str(payload.message or "").strip()
    valid_context_messages = [
        item
        for item in linear_messages
        if isinstance(item, dict)
        and str(item.get("role") or "").strip() in {"user", "assistant"}
        and (str(item.get("content") or "").strip() or _chat_image_attachments(item.get("attachments")))
    ]
    last_context_message = valid_context_messages[-1] if valid_context_messages else {}
    has_current_message = (
        str(last_context_message.get("role") or "").strip() == "user"
        and str(last_context_message.get("content") or "").strip() == payload_message
    )
    if not has_current_message:
        messages.append({
            "role": "user",
            "content": payload_message,
        })
    return messages


def _build_daily_chat_adapter(payload: ChatPayload, user: dict[str, Any]):
    config_user_id = resolve_config_user_id(user)
    analysis_cfg = app_runtime._build_analysis_adapter_config(*_chat_config_values(payload.api_config), user_id=config_user_id)
    if _payload_has_image_attachments(payload) and not adapter_supports_image_inputs(analysis_cfg, analysis_cfg.model):
        raise ValueError("当前聊天模型/供应商不支持图片输入，请切换到支持视觉输入的分析模型后重试。")
    return app_runtime.build_adapter(analysis_cfg, "llm")


async def _run_configured_daily_chat_async(payload: ChatPayload, routed: dict[str, Any], user: dict[str, Any]) -> str:
    llm = _build_daily_chat_adapter(payload, user)
    reply = await llm.chat(
        _daily_chat_messages(payload, routed),
        max_tokens=900,
    )
    reply_text = str(reply or "").strip()
    if not reply_text:
        raise RuntimeError("聊天模型返回为空")
    return reply_text


def _run_configured_daily_chat(payload: ChatPayload, routed: dict[str, Any], user: dict[str, Any]) -> str:
    return app_runtime._run_async(_run_configured_daily_chat_async(payload, routed, user))


def _fallback_stream_chunks(text: str, chunk_size: int = 18) -> list[str]:
    compact = str(text or "")
    if not compact:
        return []
    return [compact[index:index + chunk_size] for index in range(0, len(compact), chunk_size)]


async def _stream_configured_daily_chat(payload: ChatPayload, routed: dict[str, Any], user: dict[str, Any]) -> AsyncIterator[str]:
    llm = _build_daily_chat_adapter(payload, user)
    messages = _daily_chat_messages(payload, routed)
    stream_chat = getattr(llm, "stream_chat", None)
    if callable(stream_chat):
        saw_chunk = False
        async for chunk in stream_chat(messages, max_tokens=900):
            text = str(chunk or "")
            if not text:
                continue
            saw_chunk = True
            yield text
        if not saw_chunk:
            raise RuntimeError("聊天模型返回为空")
        return

    reply = await llm.chat(
        messages,
        max_tokens=900,
    )
    reply_text = str(reply or "").strip()
    if not reply_text:
        raise RuntimeError("聊天模型返回为空")
    for chunk in _fallback_stream_chunks(reply_text):
        yield chunk
        await asyncio.sleep(0)


async def _with_web_search_context(payload: ChatPayload, routed: dict[str, Any]) -> tuple[ChatPayload, dict[str, Any]]:
    if routed.get("suggested_action") != "chat":
        return payload, routed
    if not should_use_web_search(payload.message, payload.context):
        return payload, routed

    query, results, search_context = await build_web_search_context(payload.message)
    next_context = dict(payload.context or {})
    next_context["web_search_context"] = search_context
    next_context["web_search_query"] = query
    next_payload = payload.model_copy(update={"context": next_context})
    next_routed = dict(routed)
    next_routed["web_search"] = {
        "query": query,
        "results": results,
        "ok": bool(results),
    }
    return next_payload, next_routed


def _chat_sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _route_chat_payload(payload: ChatPayload, user: dict[str, Any]) -> dict[str, Any]:
    data = payload.model_dump()
    data["user_id"] = user["user_id"]
    return DesignChatAgent().respond(data)


@router.post("")
def chat(payload: ChatPayload, user=Depends(get_current_or_default_user)):
    result = _route_chat_payload(payload, user)
    if result.get("suggested_action") == "chat":
        try:
            payload, result = app_runtime._run_async(_with_web_search_context(payload, result))
            result["reply"] = _run_configured_daily_chat(payload, result, user)
        except Exception as exc:
            return _chat_error_response("chat", str(exc))
    if payload.remember:
        result["preferences"] = apply_chat_memory(payload.project_id, result["memory_candidate"], user["user_id"])
    return result


@router.post("/stream")
async def chat_stream(payload: ChatPayload, user=Depends(get_current_or_default_user)):
    routed = _route_chat_payload(payload, user)

    async def event_generator():
        try:
            if routed.get("suggested_action") != "chat":
                result = dict(routed)
                if payload.remember:
                    result["preferences"] = apply_chat_memory(payload.project_id, result["memory_candidate"], user["user_id"])
                yield _chat_sse_event("complete", result)
                return

            stream_payload, stream_routed = await _with_web_search_context(payload, routed)
            yield _chat_sse_event("meta", {**stream_routed, "reply": ""})
            chunks: list[str] = []
            async for chunk in _stream_configured_daily_chat(stream_payload, stream_routed, user):
                chunks.append(chunk)
                yield _chat_sse_event("delta", {"text": chunk})

            result = dict(stream_routed)
            result["reply"] = "".join(chunks).strip()
            if not result["reply"]:
                raise RuntimeError("聊天模型返回为空")
            if payload.remember:
                result["preferences"] = apply_chat_memory(payload.project_id, result["memory_candidate"], user["user_id"])
            yield _chat_sse_event("complete", result)
        except Exception as exc:
            yield _chat_sse_event("error", {"ok": False, "stage": "chat", "error": str(exc)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/memory")
def save_chat_memory(payload: ChatMemoryPayload, user=Depends(get_current_or_default_user)):
    preferences = apply_chat_memory(payload.project_id, payload.memory_candidate, user["user_id"])
    return {"ok": True, "project_id": payload.project_id or "default", "preferences": preferences}
