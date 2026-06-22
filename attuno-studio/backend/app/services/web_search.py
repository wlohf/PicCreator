from html.parser import HTMLParser
from typing import Any
from urllib.parse import unquote, urlencode, urlparse, parse_qs

import httpx

from app_runtime import DEFAULT_CONFIG_USER_ID, claim_tavily_api_keys
from backend.app.services.search_state_store import (
    order_tavily_keys,
    record_search_event,
    record_tavily_key_failure,
    record_tavily_key_success,
)


SEARCH_INTENT_MARKERS = (
    "联网",
    "搜索",
    "查一下",
    "查找",
    "搜一下",
    "搜",
    "访问",
    "打开网页",
    "浏览网页",
    "网上",
    "最新",
    "新闻",
    "资料",
    "什么时候发布",
    "何时发布",
    "发布时间",
    "发布日期",
    "发布了吗",
    "目前能力",
    "当前能力",
    "现在能力",
    "能否识图",
    "能不能识图",
    "是否支持识图",
    "支持识图",
    "多模态",
    "和某模型比",
    "对比",
    "web search",
    "search web",
    "search online",
    "look up",
    "browse",
    "visit",
    "access",
    "latest",
    "news",
    "release date",
    "released",
    "current",
)
TIME_SENSITIVE_MARKERS = (
    "什么时候",
    "何时",
    "发布时间",
    "发布日期",
    "发布",
    "上线",
    "开放",
    "开源",
    "目前",
    "当前",
    "现在",
    "最新",
    "最近",
    "今年",
    "能否",
    "能不能",
    "是否支持",
    "支持",
    "对比",
    "比",
    "current",
    "latest",
    "recent",
    "released",
    "release",
    "launch",
    "launched",
    "compare",
    "vs",
)
CHANGEABLE_FACT_HINTS = (
    "模型",
    "model",
    "gpt",
    "glm",
    "claude",
    "gemini",
    "kimi",
    "deepseek",
    "openai",
    "zhipu",
    "智谱",
    "发布",
    "版本",
    "能力",
    "编程",
    "识图",
    "视觉",
    "多模态",
    "价格",
    "榜单",
    "新闻",
    "开源",
    "公司",
    "产品",
    "框架",
    "库",
    "api",
)
SHORT_FOLLOWUP_MARKERS = (
    "都查",
    "三项都查",
    "全部查",
    "继续查",
    "继续搜",
    "查这几个",
    "查这些",
    "第一项",
    "第二项",
    "第三项",
    "第一个",
    "第二个",
    "第三个",
    "这项",
    "这个也查",
)
SEARCH_COMMAND_MARKERS = (
    "联网搜索",
    "联网",
    "搜索一下",
    "搜一下",
    "帮我搜",
    "帮我查",
    "查一下",
    "查找",
    "搜索",
    "网上",
    "访问",
)
RECENT_NEWS_MARKERS = (
    "发布时间",
    "发布日期",
    "什么时候发布",
    "何时发布",
    "发布了吗",
    "发布",
    "上线",
    "开放",
    "开源",
    "最新",
    "最近",
    "新闻",
    "release date",
    "released",
    "release",
    "launch",
    "launched",
    "latest",
    "news",
)
DEFAULT_TAVILY_RESULT_LIMIT = 5
ENHANCED_TAVILY_RESULT_LIMIT = 8
TAVILY_SNIPPET_LIMIT = 700
TAVILY_RAW_CONTENT_LIMIT = 1400
TAVILY_ANSWER_LIMIT = 1600
TAVILY_SEARCH_URL = "https://api.tavily.com/search"


class SearchResultParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._active_anchor: dict[str, str] | None = None
        self._active_snippet: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}
        class_name = attrs_dict.get("class", "")
        if tag == "a" and ("result-link" in class_name or "result__a" in class_name):
            self._active_anchor = {"title": "", "url": attrs_dict.get("href", "")}
            return
        if tag in {"a", "div"} and ("result-snippet" in class_name or "result__snippet" in class_name):
            self._active_snippet = []

    def handle_data(self, data: str) -> None:
        text = " ".join(str(data or "").split())
        if not text:
            return
        if self._active_anchor is not None:
            self._active_anchor["title"] = f"{self._active_anchor['title']} {text}".strip()
        if self._active_snippet is not None:
            self._active_snippet.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._active_anchor is not None:
            title = self._active_anchor["title"].strip()
            url = _normalize_duckduckgo_url(self._active_anchor["url"])
            if title and url:
                self.results.append({"title": title, "url": url, "snippet": ""})
            self._active_anchor = None
            return
        if tag in {"a", "div"} and self._active_snippet is not None:
            snippet = " ".join(self._active_snippet).strip()
            if snippet and self.results:
                self.results[-1]["snippet"] = snippet
            self._active_snippet = None


def should_use_web_search(message: str, context: dict[str, Any] | None = None) -> bool:
    text = f"{message or ''} {context.get('chatInput', '') if isinstance(context, dict) else ''}".lower()
    if any(marker.lower() in text for marker in SEARCH_INTENT_MARKERS):
        return True
    if _looks_time_sensitive_fact_question(text):
        return True
    return _inherits_recent_search_intent(message, context)


def build_search_query(message: str) -> str:
    query = " ".join(str(message or "").split())
    for marker in SEARCH_COMMAND_MARKERS:
        query = query.replace(marker, " ")
    return " ".join(query.split())[:240]


def build_contextual_search_query(message: str, context: dict[str, Any] | None = None, suggested_query: str = "") -> str:
    suggested = build_search_query(suggested_query)
    if _is_usable_search_query(suggested):
        return suggested

    query = build_search_query(message)
    if _is_usable_search_query(query) and not _is_short_followup(query):
        return query

    previous = _last_substantive_user_message(context, current_message=message)
    if previous:
        combined = build_search_query(f"{previous} {query}".strip())
        if _is_usable_search_query(combined):
            return combined
    return query


def _compact_text(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    if limit <= 0:
        return text
    return text[:limit]


def _is_enhanced_search_query(query: str) -> bool:
    return _looks_time_sensitive_fact_question(query)


def _looks_recent_news_query(query: str) -> bool:
    normalized = str(query or "").lower()
    return any(marker.lower() in normalized for marker in RECENT_NEWS_MARKERS)


def _tavily_search_profile(query: str, limit: int) -> dict[str, Any]:
    enhanced = _is_enhanced_search_query(query)
    requested_limit = max(1, int(limit or DEFAULT_TAVILY_RESULT_LIMIT))
    if not enhanced:
        return {
            "name": "basic",
            "result_limit": requested_limit,
            "payload": {
                "query": query,
                "search_depth": "basic",
                "max_results": requested_limit,
                "include_answer": False,
                "include_raw_content": False,
                "include_images": False,
            },
        }

    result_limit = max(requested_limit, ENHANCED_TAVILY_RESULT_LIMIT)
    payload: dict[str, Any] = {
        "query": query,
        "search_depth": "advanced",
        "chunks_per_source": 3,
        "max_results": result_limit,
        "topic": "general",
        "time_range": "month",
        "include_answer": "advanced",
        "include_raw_content": "markdown",
        "include_images": False,
    }
    if _looks_recent_news_query(query):
        payload["topic"] = "news"
    return {
        "name": "enhanced_recent",
        "result_limit": result_limit,
        "payload": payload,
    }


def _public_search_parameters(payload: dict[str, Any]) -> dict[str, Any]:
    public_keys = (
        "search_depth",
        "chunks_per_source",
        "max_results",
        "topic",
        "time_range",
        "include_answer",
        "include_raw_content",
    )
    return {key: payload[key] for key in public_keys if key in payload}


def _ordered_tavily_keys(user_id: str, attempt_count: int | None = None) -> list[str]:
    keys, start_index = claim_tavily_api_keys(user_id)
    if not keys:
        return []
    ordered = order_tavily_keys(user_id, keys, start_index)
    if attempt_count is None:
        return ordered
    return ordered[:max(0, attempt_count)]


def _ordered_tavily_key_attempts(user_id: str) -> tuple[list[str], list[tuple[str, int]]]:
    keys, start_index = claim_tavily_api_keys(user_id)
    if not keys:
        return [], []
    ordered = order_tavily_keys(user_id, keys, start_index)
    first_indexes: dict[str, int] = {}
    for index, key in enumerate(keys):
        first_indexes.setdefault(key, index)
    return keys, [(key, first_indexes.get(key, 0)) for key in ordered]


def _normalize_tavily_results(data: Any, limit: int) -> list[dict[str, Any]]:
    raw_results = data.get("results") if isinstance(data, dict) else []
    if not isinstance(raw_results, list):
        return []
    unique: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        item_url = str(item.get("url") or "").strip()
        if not item_url or item_url in seen_urls:
            continue
        seen_urls.add(item_url)
        normalized: dict[str, Any] = {
            "title": str(item.get("title") or item_url).strip()[:180],
            "url": item_url,
            "snippet": _compact_text(item.get("content") or item.get("snippet") or "", TAVILY_SNIPPET_LIMIT),
        }
        raw_content = _compact_text(item.get("raw_content") or "", TAVILY_RAW_CONTENT_LIMIT)
        if raw_content:
            normalized["raw_content"] = raw_content
        published_date = _compact_text(
            item.get("published_date") or item.get("date") or item.get("published") or "",
            80,
        )
        if published_date:
            normalized["published_date"] = published_date
        score = item.get("score")
        if isinstance(score, int | float):
            normalized["score"] = round(float(score), 4)
        unique.append(normalized)
        if len(unique) >= limit:
            break
    return unique


def _normalize_tavily_response(data: Any, profile: dict[str, Any]) -> dict[str, Any]:
    limit = int(profile.get("result_limit") or DEFAULT_TAVILY_RESULT_LIMIT)
    normalized = {
        "results": _normalize_tavily_results(data, limit),
        "answer": "",
        "response_time": "",
        "auto_parameters": {},
    }
    if not isinstance(data, dict):
        return normalized
    normalized["answer"] = _compact_text(data.get("answer") or "", TAVILY_ANSWER_LIMIT)
    normalized["response_time"] = _compact_text(data.get("response_time") or "", 60)
    auto_parameters = data.get("auto_parameters")
    if isinstance(auto_parameters, dict):
        normalized["auto_parameters"] = auto_parameters
    return normalized


async def _search_tavily_with_key(client: httpx.AsyncClient, api_key: str, query: str, limit: int) -> dict[str, Any]:
    profile = _tavily_search_profile(query, limit)
    payload = profile["payload"]
    response = await client.post(
        TAVILY_SEARCH_URL,
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
    )
    response.raise_for_status()
    normalized = _normalize_tavily_response(response.json(), profile)
    normalized["search_profile"] = profile["name"]
    normalized["search_parameters"] = _public_search_parameters(payload)
    return normalized


async def search_tavily(query: str, limit: int = 5, user_id: str = DEFAULT_CONFIG_USER_ID) -> list[dict[str, Any]]:
    detail = await search_tavily_detailed(query, limit=limit, user_id=user_id)
    return list(detail.get("results") or [])


async def search_tavily_detailed(query: str, limit: int = 5, user_id: str = DEFAULT_CONFIG_USER_ID) -> dict[str, Any]:
    normalized_query = build_search_query(query)
    detail = _search_detail("tavily", normalized_query)
    profile = _tavily_search_profile(normalized_query, limit)
    detail["search_profile"] = profile["name"]
    detail["search_parameters"] = _public_search_parameters(profile["payload"])
    if not normalized_query:
        detail.update({"status": "query_empty", "message": "搜索词为空或过短，需要结合上下文生成更明确的查询。"})
        return detail
    raw_keys, attempts = _ordered_tavily_key_attempts(user_id)
    detail["key_count"] = len(raw_keys)
    if not attempts:
        detail.update({
            "status": "missing_api_key",
            "message": "当前账号未配置 Tavily API key；请在设置里添加 Tavily API Keys，系统会继续尝试 DuckDuckGo fallback。",
        })
        return detail

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        for key, key_index in attempts:
            detail["attempts"] = int(detail.get("attempts") or 0) + 1
            try:
                search_response = await _search_tavily_with_key(client, key, normalized_query, limit)
            except Exception as exc:
                failure_detail = _provider_exception_detail("tavily", exc)
                detail["attempt_details"].append(failure_detail)
                record_tavily_key_failure(user_id, key, key_index, failure_detail)
                continue
            results = list(search_response.get("results") or [])
            if results:
                record_tavily_key_success(user_id, key, key_index)
                detail.update({
                    "ok": True,
                    "status": "ok",
                    "message": "Tavily 搜索成功。",
                    "results": results,
                    "answer": search_response.get("answer") or "",
                    "response_time": search_response.get("response_time") or "",
                    "auto_parameters": search_response.get("auto_parameters") or {},
                    "search_profile": search_response.get("search_profile") or detail["search_profile"],
                    "search_parameters": search_response.get("search_parameters") or detail["search_parameters"],
                })
                return detail
            empty_detail = {
                "provider": "tavily",
                "status": "empty_results",
                "message": "Tavily 请求成功但没有返回可用搜索结果。",
            }
            detail["attempt_details"].append(empty_detail)
            record_tavily_key_failure(user_id, key, key_index, empty_detail)
    detail.update(_summarize_failed_attempts(detail, fallback_message="Tavily 已尝试所有 key，但没有取得可用结果。"))
    return detail


async def search_duckduckgo(query: str, limit: int = 5) -> list[dict[str, str]]:
    detail = await search_duckduckgo_detailed(query, limit=limit)
    return list(detail.get("results") or [])


async def search_duckduckgo_detailed(query: str, limit: int = 5) -> dict[str, Any]:
    normalized_query = build_search_query(query)
    detail = _search_detail("duckduckgo", normalized_query)
    if not normalized_query:
        detail.update({"status": "query_empty", "message": "搜索词为空或过短，DuckDuckGo fallback 未执行。"})
        return detail
    params = urlencode({"q": normalized_query, "kl": "wt-wt"})
    url = f"https://duckduckgo.com/html/?{params}"
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 AttunoStudio/1.0"})
            response.raise_for_status()
    except Exception as exc:
        detail["attempts"] = 1
        detail["attempt_details"].append(_provider_exception_detail("duckduckgo", exc))
        detail.update(_summarize_failed_attempts(detail, fallback_message="DuckDuckGo fallback 请求失败。"))
        return detail

    parser = SearchResultParser()
    parser.feed(response.text)
    unique: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for item in parser.results:
        item_url = item.get("url", "").strip()
        if not item_url or item_url in seen_urls:
            continue
        seen_urls.add(item_url)
        unique.append({
            "title": item.get("title", "").strip()[:180],
            "url": item_url,
            "snippet": item.get("snippet", "").strip()[:400],
        })
        if len(unique) >= limit:
            break
    if unique:
        detail.update({"ok": True, "status": "ok", "message": "DuckDuckGo fallback 搜索成功。", "results": unique})
        return detail
    detail.update({"status": "empty_results", "message": "DuckDuckGo fallback 请求成功但没有解析到可用结果。"})
    return detail


async def search_web(query: str, limit: int = 5, user_id: str = DEFAULT_CONFIG_USER_ID) -> list[dict[str, Any]]:
    detail = await search_web_detailed(query, limit=limit, user_id=user_id)
    return list(detail.get("results") or [])


async def search_web_detailed(query: str, limit: int = 5, user_id: str = DEFAULT_CONFIG_USER_ID) -> dict[str, Any]:
    normalized_query = build_search_query(query)
    detail = {
        "query": normalized_query,
        "ok": False,
        "provider": "",
        "results": [],
        "diagnostics": [],
        "status": "not_started",
        "message": "",
    }
    tavily = await search_tavily_detailed(normalized_query, limit=limit, user_id=user_id)
    detail["diagnostics"].append(_public_diagnostic(tavily))
    if tavily.get("ok"):
        detail.update({
            "ok": True,
            "provider": "tavily",
            "results": tavily.get("results") or [],
            "answer": tavily.get("answer") or "",
            "response_time": tavily.get("response_time") or "",
            "auto_parameters": tavily.get("auto_parameters") or {},
            "search_profile": tavily.get("search_profile") or "",
            "search_parameters": tavily.get("search_parameters") or {},
            "status": "ok",
            "message": "Tavily 搜索成功。",
        })
        _record_search_event_from_detail(user_id, detail)
        return detail

    duckduckgo = await search_duckduckgo_detailed(normalized_query, limit=limit)
    detail["diagnostics"].append(_public_diagnostic(duckduckgo))
    if duckduckgo.get("ok"):
        detail.update({
            "ok": True,
            "provider": "duckduckgo",
            "results": duckduckgo.get("results") or [],
            "status": "ok",
            "message": "Tavily 未返回结果，DuckDuckGo fallback 搜索成功。",
        })
        _record_search_event_from_detail(user_id, detail)
        return detail

    detail.update({
        "status": "all_providers_failed",
        "message": "Tavily 和 DuckDuckGo fallback 都未取得可用结果。",
    })
    _record_search_event_from_detail(user_id, detail)
    return detail


async def build_web_search_context(message: str, user_id: str = DEFAULT_CONFIG_USER_ID) -> tuple[str, list[dict[str, Any]], str]:
    detail = await build_web_search_context_detailed(message, user_id=user_id)
    return detail["query"], list(detail.get("results") or []), str(detail.get("context") or "")


async def build_web_search_context_detailed(
    message: str,
    user_id: str = DEFAULT_CONFIG_USER_ID,
    context: dict[str, Any] | None = None,
    suggested_query: str = "",
) -> dict[str, Any]:
    query = build_contextual_search_query(message, context=context, suggested_query=suggested_query)
    detail = await search_web_detailed(query, user_id=user_id)
    detail["query"] = query
    if not detail.get("results"):
        detail["context"] = _build_failure_context(query, detail)
        return detail
    lines = [
        "联网搜索结果（按相关性排序，回答中需要说明信息来自联网搜索）：",
        f"搜索词：{query}",
    ]
    search_profile = str(detail.get("search_profile") or "").strip()
    search_parameters = detail.get("search_parameters") if isinstance(detail.get("search_parameters"), dict) else {}
    if search_profile or search_parameters:
        parameter_bits = [f"{key}={value}" for key, value in search_parameters.items()]
        strategy = search_profile or "default"
        if parameter_bits:
            strategy = f"{strategy}（{', '.join(parameter_bits)}）"
        lines.append(f"搜索策略：{strategy}")
    answer = _compact_text(detail.get("answer") or "", TAVILY_ANSWER_LIMIT)
    if answer:
        lines.append(f"Tavily 综合回答：{answer}")
    for index, item in enumerate(detail["results"], start=1):
        entry_lines = [
            f"{index}. {item['title']}",
            f"URL: {item['url']}",
        ]
        published_date = str(item.get("published_date") or "").strip()
        if published_date:
            entry_lines.append(f"发布时间/更新：{published_date}")
        score = item.get("score")
        if isinstance(score, int | float):
            entry_lines.append(f"相关性：{score}")
        entry_lines.append(f"摘要: {item.get('snippet') or '无摘要'}")
        raw_content = str(item.get("raw_content") or "").strip()
        if raw_content:
            entry_lines.append(f"正文摘录: {raw_content}")
        lines.append("\n".join(entry_lines))
    lines.append("回答要求：优先依据上述联网证据回答；涉及发布时间、当前能力、价格、版本时给出具体日期或说明证据不足。")
    detail["context"] = "\n".join(lines)
    return detail


def _search_detail(provider: str, query: str) -> dict[str, Any]:
    return {
        "provider": provider,
        "query": query,
        "ok": False,
        "status": "not_started",
        "message": "",
        "results": [],
        "attempts": 0,
        "attempt_details": [],
        "key_count": None,
        "answer": "",
        "search_profile": "",
        "search_parameters": {},
    }


def _provider_exception_detail(provider: str, exc: Exception) -> dict[str, str]:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code in {401, 403}:
            status = "auth_failed"
            message = f"{provider} 鉴权失败，API key 可能无效或无权限。HTTP {status_code}"
        elif status_code == 429:
            status = "rate_limited"
            message = f"{provider} 请求被限流或额度耗尽。HTTP {status_code}"
        elif 500 <= status_code:
            status = "provider_error"
            message = f"{provider} 服务端返回错误。HTTP {status_code}"
        else:
            status = "http_error"
            message = f"{provider} 返回 HTTP {status_code}。"
        body = str(exc.response.text or "").strip()
        if body:
            message = f"{message} 响应片段：{body[:180]}"
        return {"provider": provider, "status": status, "message": message}
    if isinstance(exc, httpx.TimeoutException):
        return {"provider": provider, "status": "timeout", "message": f"{provider} 请求超时，请稍后重试或检查网络出口。"}
    if isinstance(exc, httpx.RequestError):
        return {"provider": provider, "status": "network_error", "message": f"{provider} 网络请求失败：{exc}"[:240]}
    return {"provider": provider, "status": "unexpected_error", "message": f"{provider} 搜索异常：{exc}"[:240]}


def _summarize_failed_attempts(detail: dict[str, Any], fallback_message: str) -> dict[str, str]:
    attempts = detail.get("attempt_details") if isinstance(detail.get("attempt_details"), list) else []
    if attempts:
        last = attempts[-1]
        return {
            "status": str(last.get("status") or "failed"),
            "message": str(last.get("message") or fallback_message),
        }
    return {"status": "failed", "message": fallback_message}


def _public_diagnostic(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": detail.get("provider") or "",
        "ok": bool(detail.get("ok")),
        "status": detail.get("status") or "",
        "message": detail.get("message") or "",
        "attempts": int(detail.get("attempts") or 0),
        "key_count": detail.get("key_count"),
    }


def _record_search_event_from_detail(user_id: str, detail: dict[str, Any]) -> None:
    diagnostics = detail.get("diagnostics") if isinstance(detail.get("diagnostics"), list) else []
    search_parameters = detail.get("search_parameters") if isinstance(detail.get("search_parameters"), dict) else {}
    record_search_event(
        user_id=user_id,
        query=str(detail.get("query") or ""),
        provider=str(detail.get("provider") or ""),
        status=str(detail.get("status") or ""),
        result_count=len(detail.get("results") or []),
        diagnostics=diagnostics,
        search_profile=str(detail.get("search_profile") or ""),
        search_parameters=search_parameters,
    )


def _build_failure_context(query: str, detail: dict[str, Any]) -> str:
    lines = [
        "联网搜索已触发，但本次没有拿到可用网页结果。",
        f"搜索词：{query or '空'}",
        "诊断：",
    ]
    diagnostics = detail.get("diagnostics") if isinstance(detail.get("diagnostics"), list) else []
    for item in diagnostics:
        provider = str(item.get("provider") or "search")
        status = str(item.get("status") or "unknown")
        message = str(item.get("message") or "没有提供错误详情")
        lines.append(f"- {provider}: {status}；{message}")
    lines.append(
        "请面向用户说明具体原因和下一步：如果是 Tavily key 缺失/失效/限流，指引用户到设置里配置或更换 Tavily API Keys；"
        "如果是网络或 fallback 失败，建议稍后重试或换更明确的问题。不要说你没有联网能力。"
    )
    return "\n".join(lines)


def _looks_time_sensitive_fact_question(text: str) -> bool:
    normalized = str(text or "").lower()
    if not any(marker.lower() in normalized for marker in TIME_SENSITIVE_MARKERS):
        return False
    return any(marker.lower() in normalized for marker in CHANGEABLE_FACT_HINTS)


def _inherits_recent_search_intent(message: str, context: dict[str, Any] | None) -> bool:
    if not _is_short_followup(message):
        return False
    recent_users = _recent_user_messages(context)
    if not recent_users:
        return False
    previous_users = [text for text in recent_users if text.strip() != str(message or "").strip()]
    return any(_has_explicit_search_marker(text) for text in previous_users[-3:])


def _recent_user_messages(context: dict[str, Any] | None) -> list[str]:
    if not isinstance(context, dict):
        return []
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    results: list[str] = []
    for item in messages:
        if not isinstance(item, dict):
            continue
        if str(item.get("role") or "").strip() != "user":
            continue
        text = " ".join(str(item.get("content") or "").split())
        if text:
            results.append(text)
    return results


def _last_substantive_user_message(context: dict[str, Any] | None, current_message: str = "") -> str:
    current = str(current_message or "").strip()
    for text in reversed(_recent_user_messages(context)):
        if text.strip() == current:
            continue
        if _is_search_command_only(text):
            continue
        if _is_usable_search_query(build_search_query(text)):
            return text
    return ""


def _has_explicit_search_marker(text: str) -> bool:
    normalized = str(text or "").lower()
    return any(marker.lower() in normalized for marker in SEARCH_COMMAND_MARKERS)


def _is_search_command_only(text: str) -> bool:
    compact = " ".join(str(text or "").split())
    return _has_explicit_search_marker(compact) and not _is_usable_search_query(build_search_query(compact))


def _is_short_followup(text: str) -> bool:
    compact = " ".join(str(text or "").split())
    if not compact:
        return False
    if any(marker in compact for marker in SHORT_FOLLOWUP_MARKERS):
        return True
    return len(compact) <= 8 and any(word in compact for word in ("查", "搜", "项", "个", "继续", "都"))


def _is_usable_search_query(query: str) -> bool:
    compact = " ".join(str(query or "").split())
    if len(compact) < 6:
        return False
    generic = {"请你一下", "一下", "都查", "三项都查", "全部查", "继续查", "继续搜"}
    return compact not in generic


def _normalize_duckduckgo_url(url: str) -> str:
    raw = str(url or "").strip()
    if raw.startswith("//"):
        raw = f"https:{raw}"
    if raw.startswith("/"):
        raw = f"https://duckduckgo.com{raw}"
    parsed = urlparse(raw)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target) if target else raw
    return raw
