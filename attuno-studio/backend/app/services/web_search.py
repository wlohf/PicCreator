from html.parser import HTMLParser
from typing import Any
from urllib.parse import unquote, urlencode, urlparse, parse_qs

import httpx


SEARCH_INTENT_MARKERS = (
    "联网",
    "搜索",
    "查一下",
    "查找",
    "搜一下",
    "网上",
    "最新",
    "新闻",
    "资料",
    "web search",
    "search web",
    "search online",
    "look up",
    "latest",
    "news",
)


class SearchResultParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._active_anchor: dict[str, str] | None = None
        self._active_snippet: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}
        class_name = attrs_dict.get("class", "")
        if tag == "a" and "result-link" in class_name:
            self._active_anchor = {"title": "", "url": attrs_dict.get("href", "")}
            return
        if tag in {"a", "div"} and "result-snippet" in class_name:
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
    return any(marker.lower() in text for marker in SEARCH_INTENT_MARKERS)


def build_search_query(message: str) -> str:
    query = " ".join(str(message or "").split())
    for marker in ("联网搜索", "联网", "搜索一下", "搜一下", "帮我搜", "查一下", "查找", "网上"):
        query = query.replace(marker, " ")
    return " ".join(query.split())[:240]


async def search_web(query: str, limit: int = 5) -> list[dict[str, str]]:
    normalized_query = build_search_query(query)
    if not normalized_query:
        return []
    params = urlencode({"q": normalized_query, "kl": "wt-wt"})
    url = f"https://duckduckgo.com/html/?{params}"
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 AttunoStudio/1.0"})
        response.raise_for_status()
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
    return unique


async def build_web_search_context(message: str) -> tuple[str, list[dict[str, str]], str]:
    query = build_search_query(message)
    results = await search_web(query)
    if not results:
        return query, [], "联网搜索没有返回可用结果。请告诉用户搜索失败，并基于已有上下文回答。"
    lines = ["联网搜索结果（按相关性排序，回答中需要说明信息来自联网搜索）："]
    for index, item in enumerate(results, start=1):
        lines.append(
            f"{index}. {item['title']}\nURL: {item['url']}\n摘要: {item.get('snippet') or '无摘要'}"
        )
    return query, results, "\n".join(lines)


def _normalize_duckduckgo_url(url: str) -> str:
    raw = str(url or "").strip()
    if raw.startswith("//"):
        raw = f"https:{raw}"
    parsed = urlparse(raw)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target) if target else raw
    return raw
