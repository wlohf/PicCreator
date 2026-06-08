import base64
from io import BytesIO

import httpx

from config import AdapterConfig
from models.schemas import PromptSet, NormalizedImage
from adapters.base import BaseImageAdapter


class OpenAIImageAdapter(BaseImageAdapter):
    """OpenAI Images API 格式适配器，可接入任意兼容该格式的供应商。"""

    def __init__(self, cfg: AdapterConfig):
        from openai import AsyncOpenAI
        self.model = cfg.model
        self.timeout = cfg.timeout
        self.api_key = (cfg.api_key or "").strip()
        if not self.api_key:
            raise ValueError(f"OpenAI Images API 格式适配器缺少 API Key（model={self.model}）")
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=cfg.base_url,
            timeout=cfg.timeout,
        )

    async def generate(self, prompt: PromptSet) -> NormalizedImage:
        model = prompt.model_target or self.model
        prompt_text = (prompt.positive_prompt or "").strip()
        negative = (prompt.negative_prompt or "").strip()
        negative_applied = False
        negative_mode = "not_provided"
        if negative:
            prompt_text = f"{prompt_text}\n\n负向约束：{negative}"
            negative_applied = True
            negative_mode = "embedded_text"
        has_floor_plan = bool(prompt.floor_plan)
        has_reference_image = bool(prompt.reference_image)

        if has_floor_plan or has_reference_image:
            source_name = "reference_image" if has_reference_image else "floor_plan"
            image_bytes = prompt.reference_image if has_reference_image else prompt.floor_plan
            image_file = BytesIO(image_bytes or b"")
            image_file.name = f"{source_name}.png"
            resp = await self.client.images.edit(
                model=model,
                prompt=prompt_text,
                image=image_file,
                response_format="b64_json",
                n=1,
            )
            endpoint = "images.edit"
        else:
            source_name = None
            resp = await self.client.images.generate(
                model=model,
                prompt=prompt_text,
                response_format="b64_json",
                n=1,
            )
            endpoint = "images.generate"

        image_bytes = await self._extract_image_from_response(resp)
        generation_params = {
            "prompt": prompt.positive_prompt,
            "negative_prompt": prompt.negative_prompt,
            "negative_prompt_applied": negative_applied,
            "negative_prompt_mode": negative_mode,
            "has_floor_plan": has_floor_plan,
            "has_reference_image": has_reference_image,
            "endpoint": endpoint,
        }
        if source_name:
            generation_params["edit_image_source"] = source_name
        return NormalizedImage(
            image_bytes=image_bytes,
            source_model=model,
            generation_params=generation_params,
        )

    async def _extract_image_from_response(self, resp) -> bytes:
        data = getattr(resp, "data", None) or []
        if not data:
            raise ValueError("画图模型未返回图片数据")

        first = data[0]
        b64_json = getattr(first, "b64_json", None)
        if b64_json:
            return base64.b64decode(b64_json)

        image_url = getattr(first, "url", None)
        if isinstance(image_url, str):
            if image_url.startswith("data:image") and "," in image_url:
                return base64.b64decode(image_url.split(",", 1)[1])
            if image_url.startswith(("http://", "https://")):
                return await self._download_remote_image(image_url)

        raise ValueError("画图模型未返回可解析的图片数据")

    async def _download_remote_image(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content


GoogleImagenAdapter = OpenAIImageAdapter
