import base64
from types import SimpleNamespace

import pytest

from adapters.openai_compat import OpenAICompatAdapter
from models.schemas import PromptSet


class RecordingChatCreate:
    def __init__(self):
        self.called = False

    async def create(self, **_kwargs):
        self.called = True
        raise RuntimeError("chat path should not be used")


class RecordingImages:
    def __init__(self):
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            data=[
                SimpleNamespace(
                    b64_json=base64.b64encode(b"image-bytes").decode("ascii")
                )
            ]
        )


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
    assert len(images.calls) == 1
    assert images.calls[0]["model"] == "gpt-image-2"
    assert image.image_bytes == b"image-bytes"
    assert image.generation_params["endpoint"] == "images.generate"
