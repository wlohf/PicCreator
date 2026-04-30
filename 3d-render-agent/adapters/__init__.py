from .base import BaseLLMAdapter, BaseImageAdapter, BaseVisionAdapter
from .openai_compat import OpenAICompatAdapter
from .google import GoogleImagenAdapter
from .anthropic_adapter import AnthropicAdapter
from config import AdapterConfig, normalize_api_format


def _prefers_images_endpoint(model: str) -> bool:
    model_name = (model or "").strip().lower()
    return model_name.startswith(("dall-e-2", "dall-e-3"))


def build_adapter(cfg: AdapterConfig, role: str):
    """根据 API 格式和 role 构建适配器。role: llm | image | vision"""
    api_format = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")
    resolved_model = (cfg.model or "").strip()

    if api_format == "anthropic":
        if role == "image":
            raise ValueError("Anthropic API 格式当前不支持 image 生图，请改用 openai_chat 或 openai_image。")
        return AnthropicAdapter(cfg)
    if api_format in ("openai_image", "custom_openai_image"):
        if role != "image":
            raise ValueError("openai_image API 格式当前仅支持 image 生图。")
        return GoogleImagenAdapter(cfg)
    if role == "image" and _prefers_images_endpoint(resolved_model):
        return GoogleImagenAdapter(cfg)
    if api_format in (
        "openai_chat",
        "openai_responses",
        "gemini",
        "azure_openai",
        "custom_openai_chat",
        "new_api",
        "cherryin",
        "ollama",
        "",
    ):
        return OpenAICompatAdapter(cfg)

    raise ValueError(f"不支持的 API 格式: {api_format}")
