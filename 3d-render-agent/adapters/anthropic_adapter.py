import base64
import anthropic
from config import AdapterConfig
from models.schemas import NormalizedImage
from adapters.base import BaseLLMAdapter, BaseVisionAdapter


class AnthropicAdapter(BaseLLMAdapter, BaseVisionAdapter):
    """Anthropic Claude 适配器，支持文本和视觉。"""

    def __init__(self, cfg: AdapterConfig):
        self.model = cfg.model
        self.api_key = (cfg.api_key or "").strip()
        if not self.api_key:
            raise ValueError(f"Anthropic 适配器缺少 API Key（model={self.model}）")
        self.client = anthropic.AsyncAnthropic(api_key=self.api_key)

    async def chat(self, messages: list, **kwargs) -> str:
        resp = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            messages=messages,
            **kwargs,
        )
        return resp.content[0].text

    @staticmethod
    def _guess_mime_type(image_bytes: bytes) -> str:
        if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if image_bytes.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
            return "image/webp"
        if image_bytes[:3] == b"GIF":
            return "image/gif"
        return "image/png"

    async def analyze(self, image_bytes: bytes, prompt: str) -> str:
        mime = self._guess_mime_type(image_bytes)
        b64 = base64.b64encode(image_bytes).decode()
        resp = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        return resp.content[0].text
