import base64
from config import AdapterConfig
from models.schemas import PromptSet, NormalizedImage
from adapters.base import BaseImageAdapter


class OpenAIImageAdapter(BaseImageAdapter):
    """OpenAI Images API 格式适配器，可接入任意兼容该格式的供应商。"""

    def __init__(self, cfg: AdapterConfig):
        from openai import AsyncOpenAI
        self.model = cfg.model
        self.api_key = (cfg.api_key or "").strip()
        if not self.api_key:
            raise ValueError(f"OpenAI Images API 格式适配器缺少 API Key（model={self.model}）")
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=cfg.base_url,
            timeout=cfg.timeout,
        )

    async def generate(self, prompt: PromptSet) -> NormalizedImage:
        if prompt.floor_plan or prompt.reference_image:
            raise ValueError("当前图像接口不支持多模态输入（平面图/参考图）")
        model = prompt.model_target or self.model
        prompt_text = (prompt.positive_prompt or "").strip()
        negative = (prompt.negative_prompt or "").strip()
        negative_applied = False
        negative_mode = "not_provided"
        if negative:
            prompt_text = f"{prompt_text}\n\n负向约束：{negative}"
            negative_applied = True
            negative_mode = "embedded_text"
        resp = await self.client.images.generate(
            model=model,
            prompt=prompt_text,
            response_format="b64_json",
            n=1,
        )
        image_bytes = base64.b64decode(resp.data[0].b64_json)
        return NormalizedImage(
            image_bytes=image_bytes,
            source_model=model,
            generation_params={
                "prompt": prompt.positive_prompt,
                "negative_prompt": prompt.negative_prompt,
                "negative_prompt_applied": negative_applied,
                "negative_prompt_mode": negative_mode,
                "has_floor_plan": False,
                "has_reference_image": False,
                "endpoint": "images.generate",
            },
        )


GoogleImagenAdapter = OpenAIImageAdapter
