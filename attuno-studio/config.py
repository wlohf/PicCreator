from dataclasses import dataclass, field
from collections.abc import Mapping
from typing import Optional
import os
import json
from pathlib import Path


DEFAULT_PROMPT_ENGINE_VERSION = "llm_prompt_v1"


@dataclass
class AdapterConfig:
    provider: str          # backward compatible alias for api_format
    api_key: str
    model: str
    base_url: Optional[str] = None
    timeout: int = 60
    provider_name: str = "Custom"
    api_format: str = "openai_chat"  # openai_chat | openai_image | anthropic
    supports_image_inputs: Optional[bool] = None
    supports_negative_prompt: Optional[bool] = None


SUPPORTED_API_FORMATS = (
    "openai_chat",
    "openai_responses",
    "gemini",
    "openai_image",
    "anthropic",
    "azure_openai",
    "custom_openai_chat",
    "custom_openai_image",
    "ollama",
    "new_api",
    "cherryin",
)

API_FORMAT_LABELS = {
    "openai_chat": "OpenAI",
    "openai_image": "OpenAI Image",
    "openai_responses": "OpenAI-Response",
    "gemini": "Gemini",
    "anthropic": "Anthropic",
    "azure_openai": "Azure OpenAI",
    "new_api": "New API",
    "cherryin": "CherryIN",
    "ollama": "Ollama",
    "custom_openai_chat": "Custom OpenAI",
    "custom_openai_image": "Custom OpenAI Image",
}

COMMON_API_FORMAT_CHOICES = (
    ("OpenAI", "openai_chat"),
    ("OpenAI Image", "openai_image"),
    ("OpenAI-Response", "openai_responses"),
    ("Gemini", "gemini"),
    ("Anthropic", "anthropic"),
    ("Azure OpenAI", "azure_openai"),
    ("Ollama", "ollama"),
    ("Custom", "custom_openai_chat"),
    ("Custom OpenAI Image", "custom_openai_image"),
)


@dataclass
class AppConfig:
    llm: AdapterConfig          # 需求解析 + 提示词生成
    image_gen: AdapterConfig    # 生图
    vision: AdapterConfig       # 图像评估
    max_iterations: int = 3
    quality_threshold: float = 6.5
    enable_quality_evaluation: bool = True
    prompt_strategy_version: str = DEFAULT_PROMPT_ENGINE_VERSION
    image_model_fallbacks: list[str] = field(default_factory=list)
    model_switch_after_failures: int = 2
    stop_after_last_model_failures: int = 2


def load_config(path: str = "config.json") -> AppConfig:
    """从 JSON 文件加载配置，环境变量可覆盖 api_key。"""
    config_path = Path(path)
    _load_env_file(str(config_path.with_name(".env")))

    with config_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    return build_config_from_dict(data, os.environ)


def build_config_from_dict(data: dict, env_values: Mapping[str, str] | None = None) -> AppConfig:
    """Build an AppConfig from already-loaded JSON plus resolved env values."""
    env = os.environ if env_values is None else env_values

    def active_provider_overlay(d: dict) -> dict:
        section = dict(d or {})
        providers = section.get("providers")
        active_id = str(section.get("active_provider_id") or "").strip()
        if isinstance(providers, list) and active_id:
            for item in providers:
                if not isinstance(item, dict) or str(item.get("id") or "").strip() != active_id:
                    continue
                for source_key, target_key in (
                    ("provider_name", "provider_name"),
                    ("api_format", "api_format"),
                    ("base_url", "base_url"),
                    ("api_key", "api_key"),
                    ("model", "model"),
                ):
                    value = item.get(source_key)
                    if isinstance(value, str) and value.strip():
                        section[target_key] = value
                break
        return section

    def build(d: dict) -> AdapterConfig:
        d = active_provider_overlay(d)
        # 支持从环境变量读取 api_key
        env_name = str(d.get("api_key_env", "") or "").strip()
        key = env.get(env_name, d.get("api_key", "")) if env_name else d.get("api_key", "")
        legacy_provider = d.get("provider", "openai_compat")
        api_format = d.get("api_format") or _legacy_provider_to_api_format(legacy_provider)
        return AdapterConfig(
            provider=legacy_provider,
            api_key=key,
            model=d["model"],
            base_url=d.get("base_url"),
            timeout=d.get("timeout", 60),
            provider_name=d.get("provider_name", legacy_provider),
            api_format=api_format,
            supports_image_inputs=d.get("supports_image_inputs"),
            supports_negative_prompt=d.get("supports_negative_prompt"),
        )

    cfg = AppConfig(
        llm=build(data["llm"]),
        image_gen=build(data["image_gen"]),
        vision=build(data["vision"]),
        max_iterations=data.get("max_iterations", 3),
        quality_threshold=data.get("quality_threshold", 6.5),
        prompt_strategy_version=data.get("prompt_strategy_version", DEFAULT_PROMPT_ENGINE_VERSION),
        image_model_fallbacks=data.get("image_model_fallbacks", []),
        model_switch_after_failures=max(1, int(data.get("model_switch_after_failures", 2))),
        stop_after_last_model_failures=max(1, int(data.get("stop_after_last_model_failures", 2))),
    )
    _validate_app_config(cfg)
    return cfg


def _load_env_file(path: str):
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        key = k.strip()
        if not key:
            continue
        value = v.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _legacy_provider_to_api_format(provider: str) -> str:
    p = (provider or "").strip().lower()
    if p == "anthropic":
        return "anthropic"
    if p == "google":
        return "openai_image"
    return "openai_chat"


def normalize_api_format(api_format: str) -> str:
    """Normalize UI aliases and keep compatibility with old saved values."""
    fmt = (api_format or "").strip().lower()
    for value, label in API_FORMAT_LABELS.items():
        if fmt == label.lower():
            return value
    aliases = {
        "openai": "openai_chat",
        "openai_compat": "openai_chat",
        "openai-compatible": "openai_chat",
        "openai-compatible-chat": "openai_chat",
        "openai response": "openai_responses",
        "openai-response": "openai_responses",
        "responses": "openai_responses",
        "chat_completions": "openai_chat",
        "chat/completions": "openai_chat",
        "openai image": "openai_image",
        "openai-image": "openai_image",
        "images": "openai_image",
        "image": "openai_image",
        "google": "gemini",
        "imagen": "gemini",
        "google_gemini": "gemini",
        "anthropic_messages": "anthropic",
        "claude": "anthropic",
        "azure": "azure_openai",
        "azure-openai": "azure_openai",
        "newapi": "custom_openai_chat",
        "new-api": "custom_openai_chat",
        "cherry_in": "custom_openai_chat",
        "cherry-in": "custom_openai_chat",
        "custom": "custom_openai_chat",
        "custom_chat": "custom_openai_chat",
        "custom_image": "custom_openai_image",
    }
    return aliases.get(fmt, fmt)


def clone_adapter_config(cfg: AdapterConfig, model: Optional[str] = None) -> AdapterConfig:
    return AdapterConfig(
        provider=cfg.provider,
        api_key=cfg.api_key,
        model=model or cfg.model,
        base_url=cfg.base_url,
        timeout=cfg.timeout,
        provider_name=cfg.provider_name,
        api_format=cfg.api_format,
        supports_image_inputs=cfg.supports_image_inputs,
        supports_negative_prompt=cfg.supports_negative_prompt,
    )


def adapter_supports_image_inputs(cfg: AdapterConfig, model: Optional[str] = None) -> bool:
    normalized = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")
    model_name = (model or cfg.model or "").strip().lower()
    if model_name.startswith(("dall-e-2", "dall-e-3")):
        return False
    if cfg.supports_image_inputs is not None:
        return bool(cfg.supports_image_inputs)
    if normalized == "anthropic":
        return False
    if normalized in ("openai_image", "custom_openai_image"):
        return True
    return normalized in (
        "openai_chat",
        "openai_responses",
        "gemini",
        "azure_openai",
        "custom_openai_chat",
        "new_api",
        "cherryin",
        "ollama",
        "",
    )


def adapter_supports_negative_prompt(cfg: AdapterConfig, model: Optional[str] = None) -> bool:
    if cfg.supports_negative_prompt is not None:
        return bool(cfg.supports_negative_prompt)
    _ = model or cfg.model or ""
    return False


def describe_adapter_capabilities(cfg: AdapterConfig, model: Optional[str] = None) -> dict:
    resolved_model = model or cfg.model
    return {
        "supports_image_inputs": adapter_supports_image_inputs(cfg, resolved_model),
        "supports_negative_prompt": adapter_supports_negative_prompt(cfg, resolved_model),
        "model": resolved_model,
        "api_format": normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or ""),
    }


def _validate_app_config(cfg: AppConfig):
    if not 0 <= float(cfg.quality_threshold) <= 10:
        raise ValueError(f"quality_threshold 必须在 0-10 之间，当前为 {cfg.quality_threshold}")
