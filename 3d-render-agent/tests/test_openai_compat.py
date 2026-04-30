import pytest

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
