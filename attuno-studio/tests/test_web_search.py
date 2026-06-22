import httpx
import pytest

from backend.app.services import web_search


def test_duckduckgo_parser_handles_current_result_classes():
    parser = web_search.SearchResultParser()
    parser.feed(
        """
        <div class="result">
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fcurrent">Current result</a>
          <a class="result__snippet">Current snippet text</a>
        </div>
        """
    )

    assert parser.results == [{
        "title": "Current result",
        "url": "https://example.com/current",
        "snippet": "Current snippet text",
    }]


def test_should_use_web_search_detects_time_sensitive_model_question():
    message = "GLM-5.2是什么时候发布的呢？它目前的编程水平可以和gpt-5.4一样了么？还是要差一点？能否识图呢"

    assert web_search.should_use_web_search(message, {"chatInput": message}) is True


def test_should_use_web_search_inherits_recent_search_intent_for_short_followup():
    context = {
        "messages": [
            {"role": "user", "content": "GLM-5.2是什么时候发布的呢？它目前的编程水平怎么样？能否识图呢"},
            {"role": "assistant", "content": "我需要联网确认。"},
            {"role": "user", "content": "请你联网搜索一下"},
            {"role": "assistant", "content": "你想查哪一项？"},
            {"role": "user", "content": "三项都查"},
        ]
    }

    assert web_search.should_use_web_search("三项都查", context) is True
    assert web_search.build_contextual_search_query("三项都查", context).startswith("GLM-5.2")


def test_should_not_use_web_search_for_plain_writing_request():
    assert web_search.should_use_web_search("帮我写一段中文产品介绍", {"chatInput": "帮我写一段中文产品介绍"}) is False


@pytest.mark.asyncio
async def test_search_tavily_rotates_keys_and_continues_after_failure(monkeypatch):
    monkeypatch.setattr(web_search, "claim_tavily_api_keys", lambda user_id: (["key-a", "key-b"], 0))
    calls: list[str] = []
    payloads: list[dict] = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, headers):
            calls.append(headers["Authorization"])
            payloads.append(json)
            request = httpx.Request("POST", url)
            if headers["Authorization"] == "Bearer key-a":
                response = httpx.Response(429, request=request)
                raise httpx.HTTPStatusError("rate limited", request=request, response=response)
            return httpx.Response(
                200,
                request=request,
                json={
                    "results": [
                        {
                            "title": "Fresh result",
                            "url": "https://example.com/fresh",
                            "content": "Fresh Tavily summary",
                        }
                    ]
                },
            )

    monkeypatch.setattr(web_search.httpx, "AsyncClient", FakeAsyncClient)

    results = await web_search.search_tavily("联网搜索 fresh topic", user_id="user-a")

    assert calls == ["Bearer key-a", "Bearer key-b"]
    assert payloads[-1]["search_depth"] == "basic"
    assert payloads[-1]["include_raw_content"] is False
    assert results == [{
        "title": "Fresh result",
        "url": "https://example.com/fresh",
        "snippet": "Fresh Tavily summary",
    }]


@pytest.mark.asyncio
async def test_search_tavily_uses_enhanced_profile_for_recent_model_release(monkeypatch):
    monkeypatch.setattr(web_search, "claim_tavily_api_keys", lambda user_id: (["key-a"], 0))
    payloads: list[dict] = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, headers):
            payloads.append(json)
            request = httpx.Request("POST", url)
            return httpx.Response(
                200,
                request=request,
                json={
                    "answer": "GLM-5.2 于 2026 年 6 月 13 日开放。",
                    "results": [
                        {
                            "title": "智谱:GLM-5.2 将面向 GLM Coding Plan 全量用户开放",
                            "url": "https://example.com/glm-5-2",
                            "content": "IT之家 6 月 13 日消息，智谱今日宣布 GLM-5.2 开放。",
                            "raw_content": "2026年06月13日 14:34。今晚 5:21，GLM-5.2 将面向 GLM Coding Plan 全量用户开放。",
                            "score": 0.923456,
                        }
                    ],
                },
            )

    monkeypatch.setattr(web_search.httpx, "AsyncClient", FakeAsyncClient)

    detail = await web_search.search_tavily_detailed("GLM-5.2是什么时候发布的，当前编程能力怎么样", user_id="user-a")

    assert payloads == [{
        "query": "GLM-5.2是什么时候发布的，当前编程能力怎么样",
        "search_depth": "advanced",
        "chunks_per_source": 3,
        "max_results": 8,
        "topic": "news",
        "time_range": "month",
        "include_answer": "advanced",
        "include_raw_content": "markdown",
        "include_images": False,
    }]
    assert detail["search_profile"] == "enhanced_recent"
    assert detail["search_parameters"]["search_depth"] == "advanced"
    assert detail["answer"] == "GLM-5.2 于 2026 年 6 月 13 日开放。"
    assert detail["results"][0]["raw_content"].startswith("2026年06月13日")
    assert detail["results"][0]["score"] == 0.9235


@pytest.mark.asyncio
async def test_search_web_falls_back_to_duckduckgo_without_tavily_keys(monkeypatch):
    monkeypatch.setattr(web_search, "claim_tavily_api_keys", lambda user_id: ([], 0))

    async def fake_duckduckgo_detail(query, limit=5):
        return {
            "provider": "duckduckgo",
            "ok": True,
            "status": "ok",
            "message": "DuckDuckGo fallback 搜索成功。",
            "attempts": 1,
            "key_count": None,
            "results": [{"title": "Duck result", "url": "https://example.com/duck", "snippet": "Fallback"}],
        }

    monkeypatch.setattr(web_search, "search_duckduckgo_detailed", fake_duckduckgo_detail)

    assert await web_search.search_web("search online fallback", user_id="user-a") == [
        {"title": "Duck result", "url": "https://example.com/duck", "snippet": "Fallback"}
    ]


@pytest.mark.asyncio
async def test_build_web_search_context_detailed_reports_actionable_failure(monkeypatch):
    monkeypatch.setattr(web_search, "claim_tavily_api_keys", lambda user_id: ([], 0))

    async def fake_duckduckgo_detail(query, limit=5):
        return {
            "provider": "duckduckgo",
            "ok": False,
            "status": "network_error",
            "message": "DuckDuckGo 网络请求失败：blocked",
            "attempts": 1,
            "key_count": None,
            "results": [],
        }

    monkeypatch.setattr(web_search, "search_duckduckgo_detailed", fake_duckduckgo_detail)

    detail = await web_search.build_web_search_context_detailed("联网搜索 GLM-5.2 发布时间", user_id="user-a")

    assert detail["ok"] is False
    assert detail["diagnostics"][0]["status"] == "missing_api_key"
    assert detail["diagnostics"][1]["status"] == "network_error"
    assert "配置或更换 Tavily API Keys" in detail["context"]
    assert "不要说你没有联网能力" in detail["context"]


@pytest.mark.asyncio
async def test_build_web_search_context_includes_tavily_answer_and_raw_evidence(monkeypatch):
    async def fake_search_web_detail(query, limit=5, user_id="default"):
        return {
            "query": query,
            "ok": True,
            "provider": "tavily",
            "status": "ok",
            "message": "Tavily 搜索成功。",
            "diagnostics": [],
            "search_profile": "enhanced_recent",
            "search_parameters": {
                "search_depth": "advanced",
                "topic": "news",
                "time_range": "month",
                "include_answer": "advanced",
                "include_raw_content": "markdown",
            },
            "answer": "GLM-5.2 于 2026 年 6 月 13 日向 GLM Coding Plan 用户开放。",
            "results": [
                {
                    "title": "智谱:GLM-5.2 将面向 GLM Coding Plan 全量用户开放",
                    "url": "https://example.com/glm-5-2",
                    "snippet": "智谱今日宣布 GLM-5.2 开放。",
                    "raw_content": "2026年06月13日 14:34。今晚 5:21，GLM-5.2 将面向 GLM Coding Plan 全量用户开放。",
                    "score": 0.91,
                }
            ],
        }

    monkeypatch.setattr(web_search, "search_web_detailed", fake_search_web_detail)

    detail = await web_search.build_web_search_context_detailed("联网搜索 GLM-5.2 发布时间", user_id="user-a")

    assert "搜索策略：enhanced_recent" in detail["context"]
    assert "Tavily 综合回答：GLM-5.2 于 2026 年 6 月 13 日" in detail["context"]
    assert "正文摘录: 2026年06月13日 14:34" in detail["context"]
    assert "回答要求：优先依据上述联网证据回答" in detail["context"]
