import base64
from types import SimpleNamespace

import httpx
import pytest

from adapters.google import OpenAIImageAdapter
from adapters.openai_compat import OpenAICompatAdapter
import adapters
from config import AdapterConfig, adapter_supports_image_inputs
from models.schemas import PromptSet


class RecordingChatCreate:
    def __init__(self):
        self.called = False

    async def create(self, **_kwargs):
        self.called = True
        raise RuntimeError("chat path should not be used")


class RecordingImages:
    def __init__(self):
        self.generate_calls = []
        self.edit_calls = []

    async def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
        return SimpleNamespace(
            data=[
                SimpleNamespace(
                    b64_json=base64.b64encode(b"image-bytes").decode("ascii")
                )
            ]
        )

    async def edit(self, **kwargs):
        self.edit_calls.append(kwargs)
        return SimpleNamespace(
            data=[
                SimpleNamespace(
                    b64_json=base64.b64encode(b"edited-image-bytes").decode("ascii")
                )
            ]
        )


def test_anthropic_messages_alias_builds_anthropic_adapter(monkeypatch):
    captured = {}

    class FakeAnthropicAdapter:
        def __init__(self, cfg):
            captured["cfg"] = cfg

    monkeypatch.setattr(adapters, "AnthropicAdapter", FakeAnthropicAdapter)
    cfg = AdapterConfig(
        provider="openai_chat",
        api_key="anthropic-key",
        model="claude-test",
        api_format="messages",
    )

    adapter = adapters.build_adapter(cfg, "llm")

    assert isinstance(adapter, FakeAnthropicAdapter)
    assert captured["cfg"].api_format == "messages"


@pytest.mark.asyncio
async def test_gpt_image_models_without_image_inputs_use_images_endpoint_first():
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "gpt-image-2"
    adapter.api_format = "openai_chat"
    adapter.timeout = 600
    chat_create = RecordingChatCreate()
    images = RecordingImages()
    adapter.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                with_raw_response=SimpleNamespace(create=chat_create.create)
            )
        ),
        images=images,
    )
    prompt = PromptSet(
        positive_prompt="modern room",
        negative_prompt="blurry",
        model_target="gpt-image-2",
    )

    image = await adapter.generate(prompt)

    assert chat_create.called is False
    assert len(images.generate_calls) == 1
    assert images.generate_calls[0]["model"] == "gpt-image-2"
    assert image.image_bytes == b"image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"


@pytest.mark.asyncio
async def test_gpt_image_models_without_image_inputs_accept_data_url_response():
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "gpt-image-2"
    adapter.api_format = "openai_responses"
    adapter.timeout = 600
    chat_create = RecordingChatCreate()

    class DataUrlImages:
        def __init__(self):
            self.generate_calls = []

        async def generate(self, **kwargs):
            self.generate_calls.append(kwargs)
            data_url = "data:image/png;base64," + base64.b64encode(b"data-url-image-bytes").decode("ascii")
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url=data_url)])

    images = DataUrlImages()
    adapter.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                with_raw_response=SimpleNamespace(create=chat_create.create)
            )
        ),
        images=images,
    )

    image = await adapter.generate(
        PromptSet(
            positive_prompt="modern room",
            negative_prompt="",
            model_target="gpt-image-2",
        )
    )

    assert chat_create.called is False
    assert len(images.generate_calls) == 1
    assert image.image_bytes == b"data-url-image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"


@pytest.mark.asyncio
async def test_gpt_image_models_without_image_inputs_accept_remote_url_response():
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "gpt-image-2"
    adapter.api_format = "openai_responses"
    adapter.timeout = 600
    chat_create = RecordingChatCreate()

    class RemoteUrlImages:
        def __init__(self):
            self.generate_calls = []

        async def generate(self, **kwargs):
            self.generate_calls.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url="https://cdn.example/image.png")])

    images = RemoteUrlImages()
    adapter.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                with_raw_response=SimpleNamespace(create=chat_create.create)
            )
        ),
        images=images,
    )

    async def fake_download(url: str):
        assert url == "https://cdn.example/image.png"
        return b"remote-url-image-bytes"

    adapter._download_remote_image = fake_download

    image = await adapter.generate(
        PromptSet(
            positive_prompt="modern room",
            negative_prompt="",
            model_target="gpt-image-2",
        )
    )

    assert chat_create.called is False
    assert len(images.generate_calls) == 1
    assert image.image_bytes == b"remote-url-image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"


@pytest.mark.asyncio
async def test_gpt_image_models_with_reference_image_use_images_edit():
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "gpt-image-2"
    adapter.api_format = "openai_responses"
    adapter.timeout = 600
    chat_create = RecordingChatCreate()
    images = RecordingImages()
    adapter.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                with_raw_response=SimpleNamespace(create=chat_create.create)
            )
        ),
        images=images,
    )

    image = await adapter.generate(
        PromptSet(
            positive_prompt="turn this reference into a clean icon",
            negative_prompt="blurry",
            model_target="gpt-image-2",
            reference_image=b"reference-image-bytes",
        )
    )

    assert chat_create.called is False
    assert images.generate_calls == []
    assert len(images.edit_calls) == 1
    call = images.edit_calls[0]
    assert call["model"] == "gpt-image-2"
    assert call["prompt"] == "turn this reference into a clean icon\n\n负向约束：blurry"
    assert call["image"].read() == b"reference-image-bytes"
    assert image.image_bytes == b"edited-image-bytes"
    assert image.generation_params["endpoint"] == "images.edit"
    assert image.generation_params["has_reference_image"] is True
    assert image.generation_params["edit_image_source"] == "reference_image"


@pytest.mark.asyncio
async def test_gpt_image_models_reopen_reference_image_for_edit_retry(monkeypatch):
    adapter = object.__new__(OpenAICompatAdapter)
    adapter.model = "gpt-image-2"
    adapter.api_format = "openai_responses"
    adapter.timeout = 600
    chat_create = RecordingChatCreate()

    class RetryingImages:
        def __init__(self):
            self.edit_image_reads = []

        async def edit(self, **kwargs):
            self.edit_image_reads.append(kwargs["image"].read())
            if len(self.edit_image_reads) == 1:
                request = httpx.Request("POST", "https://api.example/v1/images/edits")
                response = httpx.Response(429, headers={"Retry-After": "0"}, request=request)
                raise httpx.HTTPStatusError("rate limited", request=request, response=response)
            return SimpleNamespace(
                data=[
                    SimpleNamespace(
                        b64_json=base64.b64encode(b"retried-image-bytes").decode("ascii")
                    )
                ]
            )

    images = RetryingImages()
    adapter.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                with_raw_response=SimpleNamespace(create=chat_create.create)
            )
        ),
        images=images,
    )

    async def fake_sleep(_seconds: float):
        return None

    monkeypatch.setattr("adapters.openai_compat.asyncio.sleep", fake_sleep)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="retry this edit",
            negative_prompt="",
            model_target="gpt-image-2",
            reference_image=b"reference-image-bytes",
        )
    )

    assert chat_create.called is False
    assert images.edit_image_reads == [b"reference-image-bytes", b"reference-image-bytes"]
    assert image.image_bytes == b"retried-image-bytes"
    assert image.generation_params["endpoint"] == "images.edit"


@pytest.mark.asyncio
async def test_openai_image_adapter_text_only_uses_images_generate():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"
    images = RecordingImages()
    adapter.client = SimpleNamespace(images=images)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="modern room",
            negative_prompt="blurry",
            model_target="gpt-image-2",
        )
    )

    assert len(images.generate_calls) == 1
    assert images.generate_calls[0]["model"] == "gpt-image-2"
    assert images.generate_calls[0]["prompt"] == "modern room\n\n负向约束：blurry"
    assert images.edit_calls == []
    assert image.image_bytes == b"image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"
    assert image.generation_params["negative_prompt_mode"] == "embedded_text"


@pytest.mark.asyncio
async def test_openai_image_adapter_accepts_data_url_response():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"

    class DataUrlImages:
        def __init__(self):
            self.generate_calls = []

        async def generate(self, **kwargs):
            self.generate_calls.append(kwargs)
            data_url = "data:image/png;base64," + base64.b64encode(b"data-url-image-bytes").decode("ascii")
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url=data_url)])

    images = DataUrlImages()
    adapter.client = SimpleNamespace(images=images)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="modern room",
            negative_prompt="",
            model_target="gpt-image-2",
        )
    )

    assert len(images.generate_calls) == 1
    assert image.image_bytes == b"data-url-image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"


@pytest.mark.asyncio
async def test_openai_image_adapter_accepts_remote_url_response():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"

    class RemoteUrlImages:
        def __init__(self):
            self.generate_calls = []

        async def generate(self, **kwargs):
            self.generate_calls.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url="https://cdn.example/image.png")])

    images = RemoteUrlImages()
    adapter.client = SimpleNamespace(images=images)

    async def fake_download(url: str):
        assert url == "https://cdn.example/image.png"
        return b"remote-url-image-bytes"

    adapter._download_remote_image = fake_download

    image = await adapter.generate(
        PromptSet(
            positive_prompt="modern room",
            negative_prompt="",
            model_target="gpt-image-2",
        )
    )

    assert len(images.generate_calls) == 1
    assert image.image_bytes == b"remote-url-image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"


@pytest.mark.asyncio
async def test_openai_image_adapter_rejects_empty_image_response():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"

    class EmptyImages:
        async def generate(self, **_kwargs):
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url=None)])

    adapter.client = SimpleNamespace(images=EmptyImages())

    with pytest.raises(ValueError, match="画图模型未返回可解析的图片数据"):
        await adapter.generate(
            PromptSet(
                positive_prompt="modern room",
                negative_prompt="",
                model_target="gpt-image-2",
            )
        )


@pytest.mark.asyncio
async def test_openai_image_adapter_reference_image_uses_images_edit():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"
    images = RecordingImages()
    adapter.client = SimpleNamespace(images=images)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="turn this into a refined render",
            negative_prompt="low quality",
            model_target="gpt-image-2",
            reference_image=b"reference-image-bytes",
        )
    )

    assert images.generate_calls == []
    assert len(images.edit_calls) == 1
    call = images.edit_calls[0]
    assert call["model"] == "gpt-image-2"
    assert call["prompt"] == "turn this into a refined render\n\n负向约束：low quality"
    assert call["image"].read() == b"reference-image-bytes"
    assert image.image_bytes == b"edited-image-bytes"
    assert image.generation_params["endpoint"] == "images.edit"
    assert image.generation_params["has_reference_image"] is True
    assert image.generation_params["has_floor_plan"] is False
    assert image.generation_params["edit_image_source"] == "reference_image"


@pytest.mark.asyncio
async def test_openai_image_adapter_edit_accepts_data_url_response():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"

    class DataUrlEditImages:
        def __init__(self):
            self.edit_calls = []

        async def edit(self, **kwargs):
            self.edit_calls.append(kwargs)
            data_url = "data:image/png;base64," + base64.b64encode(b"edited-data-url-image-bytes").decode("ascii")
            return SimpleNamespace(data=[SimpleNamespace(b64_json=None, url=data_url)])

    images = DataUrlEditImages()
    adapter.client = SimpleNamespace(images=images)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="continue this drawing",
            negative_prompt="",
            model_target="gpt-image-2",
            reference_image=b"reference-image-bytes",
        )
    )

    assert len(images.edit_calls) == 1
    assert images.edit_calls[0]["image"].read() == b"reference-image-bytes"
    assert image.image_bytes == b"edited-data-url-image-bytes"
    assert image.generation_params["endpoint"] == "images.edit"


@pytest.mark.asyncio
async def test_openai_image_adapter_floor_plan_uses_images_edit():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"
    images = RecordingImages()
    adapter.client = SimpleNamespace(images=images)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="convert the floor plan into a clean color plan",
            negative_prompt="",
            model_target="gpt-image-2",
            floor_plan=b"floor-plan-bytes",
        )
    )

    assert images.generate_calls == []
    assert len(images.edit_calls) == 1
    call = images.edit_calls[0]
    assert call["model"] == "gpt-image-2"
    assert call["prompt"] == "convert the floor plan into a clean color plan"
    assert call["image"].read() == b"floor-plan-bytes"
    assert image.image_bytes == b"edited-image-bytes"
    assert image.generation_params["endpoint"] == "images.edit"
    assert image.generation_params["has_floor_plan"] is True
    assert image.generation_params["has_reference_image"] is False
    assert image.generation_params["edit_image_source"] == "floor_plan"


@pytest.mark.asyncio
async def test_openai_image_adapter_prefers_reference_image_but_keeps_input_metadata():
    adapter = object.__new__(OpenAIImageAdapter)
    adapter.model = "gpt-image-2"
    images = RecordingImages()
    adapter.client = SimpleNamespace(images=images)

    image = await adapter.generate(
        PromptSet(
            positive_prompt="use the reference render and keep floor plan constraints",
            negative_prompt="",
            model_target="gpt-image-2",
            floor_plan=b"floor-plan-bytes",
            reference_image=b"reference-image-bytes",
        )
    )

    assert images.generate_calls == []
    assert len(images.edit_calls) == 1
    call = images.edit_calls[0]
    assert call["image"].read() == b"reference-image-bytes"
    assert image.generation_params["endpoint"] == "images.edit"
    assert image.generation_params["has_floor_plan"] is True
    assert image.generation_params["has_reference_image"] is True
    assert image.generation_params["edit_image_source"] == "reference_image"


def test_openai_image_formats_support_image_inputs_for_gpt_image_but_not_dalle3():
    openai_image = AdapterConfig(
        provider="openai_image",
        api_key="key",
        model="gpt-image-2",
        api_format="openai_image",
    )
    custom_openai_image = AdapterConfig(
        provider="custom_openai_image",
        api_key="key",
        model="gpt-image-2",
        api_format="custom_openai_image",
    )

    assert adapter_supports_image_inputs(openai_image, "gpt-image-2") is True
    assert adapter_supports_image_inputs(custom_openai_image, "gpt-image-2") is True
    assert adapter_supports_image_inputs(openai_image, "dall-e-3") is False
    assert adapter_supports_image_inputs(custom_openai_image, "dall-e-3") is False


def test_dalle_models_do_not_support_image_inputs_even_with_capability_override():
    cfg = AdapterConfig(
        provider="openai_image",
        api_key="key",
        model="dall-e-3",
        api_format="openai_image",
        supports_image_inputs=True,
    )

    assert adapter_supports_image_inputs(cfg, "dall-e-3") is False
