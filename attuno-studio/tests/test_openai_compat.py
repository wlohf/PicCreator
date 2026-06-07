import pytest
import httpx

from adapters.openai_compat import OpenAICompatAdapter


def _make_adapter():
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.api_format = "openai_responses"
    adapter.model = "gpt-test"
    return adapter


def test_extract_responses_text_from_top_level_json():
    raw = '{"output":[{"content":[{"type":"output_text","text":"hello"}]}]}'
    assert OpenAICompatAdapter._extract_responses_text(raw) == "hello"


def test_extract_responses_text_from_nested_response_json():
    raw = '{"response":{"output":[{"content":[{"type":"output_text","text":"world"}]}]}}'
    assert OpenAICompatAdapter._extract_responses_text(raw) == "world"


def test_extract_responses_text_from_sse_stream():
    raw = 'data: {"type":"response.output_text.done","text":"ok"}'
    assert OpenAICompatAdapter._extract_responses_text(raw) == "ok"


@pytest.mark.asyncio
async def test_responses_chat_raises_on_empty_response():
    adapter = _make_adapter()

    async def fake_post_text(endpoint: str, payload: dict) -> str:
        return "{}"

    adapter._post_text = fake_post_text

    with pytest.raises(ValueError, match="未提取到文本"):
        await adapter._responses_chat("gpt-test", [{"role": "user", "content": "hi"}])


@pytest.mark.asyncio
async def test_responses_stream_chat_emits_delta_chunks():
    adapter = _make_adapter()

    async def fake_stream_lines(endpoint: str, payload: dict):
        assert endpoint == "/responses"
        assert payload["stream"] is True
        yield 'data: {"type":"response.output_text.delta","delta":"he"}'
        yield 'data: {"type":"response.output_text.delta","delta":"llo"}'
        yield "data: [DONE]"

    adapter._stream_lines = fake_stream_lines

    chunks = []
    async for chunk in adapter._responses_stream_chat("gpt-test", [{"role": "user", "content": "hi"}]):
        chunks.append(chunk)

    assert chunks == ["he", "llo"]


@pytest.mark.asyncio
async def test_responses_stream_chat_falls_back_to_done_text_when_no_delta():
    adapter = _make_adapter()

    async def fake_stream_lines(_endpoint: str, _payload: dict):
        yield 'data: {"type":"response.output_text.done","text":"ok"}'
        yield "data: [DONE]"

    adapter._stream_lines = fake_stream_lines

    chunks = []
    async for chunk in adapter._responses_stream_chat("gpt-test", [{"role": "user", "content": "hi"}]):
        chunks.append(chunk)

    assert chunks == ["ok"]


def test_extract_chat_completion_delta_text_from_string_content():
    data = {"choices": [{"delta": {"content": "hello"}}]}

    assert OpenAICompatAdapter._extract_chat_completion_delta_text(data) == "hello"


def test_extract_chat_completion_delta_text_from_list_content():
    data = {"choices": [{"delta": {"content": [{"type": "text", "text": "hello"}]}}]}

    assert OpenAICompatAdapter._extract_chat_completion_delta_text(data) == "hello"


def test_retryable_status_code_includes_429():
    assert OpenAICompatAdapter._is_retryable_status_code(429) is True
    assert OpenAICompatAdapter._is_retryable_status_code(400) is False


def test_retry_delay_prefers_retry_after_header():
    assert OpenAICompatAdapter._retry_delay_seconds(1, 7.0) == 7.0


def test_messages_to_responses_input_preserves_image_parts():
    image_url = "data:image/png;base64,AA=="
    converted = OpenAICompatAdapter._messages_to_responses_input([
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "这图里面讲的什么？"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }
    ])

    assert converted == [{
        "role": "user",
        "content": [
            {"type": "input_text", "text": "这图里面讲的什么？"},
            {"type": "input_image", "image_url": image_url},
        ],
    }]


def test_should_retry_http_status_error_uses_retry_after():
    request = httpx.Request("POST", "https://example.com/v1/chat/completions")
    response = httpx.Response(429, headers={"Retry-After": "3"}, request=request)
    exc = httpx.HTTPStatusError("rate limited", request=request, response=response)

    should_retry, retry_after = OpenAICompatAdapter._should_retry_exception(exc)

    assert should_retry is True
    assert retry_after == 3.0


@pytest.mark.asyncio
async def test_run_with_retries_retries_rate_limit_once(monkeypatch):
    adapter = _make_adapter()
    calls = {"count": 0}

    async def fake_sleep(_seconds: float):
        return None

    async def flaky_operation():
        calls["count"] += 1
        if calls["count"] == 1:
            request = httpx.Request("POST", "https://example.com/v1/chat/completions")
            response = httpx.Response(429, headers={"Retry-After": "0"}, request=request)
            raise httpx.HTTPStatusError("rate limited", request=request, response=response)
        return "ok"

    monkeypatch.setattr("adapters.openai_compat.asyncio.sleep", fake_sleep)

    result = await adapter._run_with_retries(flaky_operation)

    assert result == "ok"
    assert calls["count"] == 2


@pytest.mark.asyncio
async def test_run_with_retries_does_not_retry_read_timeout(monkeypatch):
    adapter = _make_adapter()
    calls = {"count": 0}

    async def fake_sleep(_seconds: float):
        raise AssertionError("ReadTimeout should not sleep for a retry")

    async def slow_operation():
        calls["count"] += 1
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr("adapters.openai_compat.asyncio.sleep", fake_sleep)

    with pytest.raises(httpx.ReadTimeout):
        await adapter._run_with_retries(slow_operation)

    assert calls["count"] == 1
