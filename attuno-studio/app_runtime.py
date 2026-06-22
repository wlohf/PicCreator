import asyncio
import json
from io import BytesIO
import os
import sys
from pathlib import Path
from queue import Queue
from threading import Lock, Thread
import time
import traceback
from typing import Optional, Any, List
from urllib.parse import urlsplit, urlunsplit
import httpx
from PIL import Image

if os.name == "nt":
    # Avoid startup hangs when Python's optional _wmi module cannot query Windows metadata.
    sys.modules.setdefault("_wmi", None)

from config import (
    load_config,
    build_config_from_dict,
    AppConfig,
    AdapterConfig,
    COMMON_API_FORMAT_CHOICES,
    API_FORMAT_LABELS,
    SUPPORTED_API_FORMATS,
    normalize_api_format,
    describe_adapter_capabilities,
    adapter_supports_image_inputs,
    clone_adapter_config,
)
from adapters import build_adapter
from agents import prompt_assets
from backend.app.services.result_store import get_user_data_dir, normalize_user_id
from pipeline import PipelineFactory
from models.schemas import GenerationMode
from models.schemas import PromptSet

GENERATION_ANALYSIS_TIMEOUT_SECONDS = 180
GENERATION_IMAGE_TIMEOUT_SECONDS = 600
PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = PROJECT_ROOT / "config.json"
CONFIG_EXAMPLE_PATH = PROJECT_ROOT / "config.example.json"
ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_CONFIG_USER_ID = "default"
_WEB_SEARCH_CONFIG_LOCK = Lock()
_KEY_SPLIT_TRANSLATION = str.maketrans({",": "\n", ";": "\n", "，": "\n", "；": "\n"})


def _ensure_min_timeout(cfg: AdapterConfig, minimum_seconds: int) -> AdapterConfig:
    try:
        current = int(cfg.timeout or 0)
    except (TypeError, ValueError):
        current = 0
    cfg.timeout = max(current, minimum_seconds)
    return cfg

API_FORMAT_HELP = (
    "API格式是请求/响应协议，不是供应商名称。当前支持："
    "OpenAI、OpenAI Image、OpenAI-Response、Gemini、Anthropic、Azure OpenAI、Ollama、Custom、Custom OpenAI Image。"
    "OpenAI / Custom 走聊天兼容接口；OpenAI Image / Custom OpenAI Image 走 Images API，gpt-image-2 可验证参考图输入。"
)
UI_API_FORMAT_CHOICES = (("使用 config.json", ""), *COMMON_API_FORMAT_CHOICES)

def _is_default_config_user(user_id: str | None) -> bool:
    return normalize_user_id(user_id) == DEFAULT_CONFIG_USER_ID


def _user_config_dir(user_id: str) -> Path:
    return get_user_data_dir(user_id) / "config"


def _config_path_for_user(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> Path:
    if _is_default_config_user(user_id):
        return CONFIG_PATH
    return _user_config_dir(normalize_user_id(user_id)) / "config.json"


def _env_path_for_user(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> Path:
    if _is_default_config_user(user_id):
        return ENV_PATH
    return _user_config_dir(normalize_user_id(user_id)) / ".env"


def _default_config_source_path() -> Path:
    return CONFIG_PATH if CONFIG_PATH.exists() else CONFIG_EXAMPLE_PATH


def _load_json_file(path: str | os.PathLike[str]) -> dict[str, Any]:
    source = _resolve_project_path(path)
    with source.open("r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"配置文件 {source} 格式错误：{exc}") from exc


def _load_default_config_json() -> dict[str, Any]:
    return _load_json_file(_default_config_source_path())


def _load_namespace_override_json(user_id: str | None) -> dict[str, Any]:
    if _is_default_config_user(user_id):
        return _load_default_config_json()
    target = _config_path_for_user(user_id)
    if not target.exists():
        return {}
    return _load_json_file(target)


def _merge_adapter_section(base_section: Any, override_section: Any) -> dict[str, Any]:
    merged = dict(base_section or {})
    if not isinstance(override_section, dict):
        return merged
    has_explicit_api_key = bool(str(override_section.get("api_key") or "").strip())
    for key, value in override_section.items():
        if value is None:
            continue
        if key == "api_key_env":
            if has_explicit_api_key:
                merged[key] = str(value or "").strip()
            continue
        if key in {"api_key", "provider", "provider_name", "api_format", "base_url", "model"}:
            if isinstance(value, str) and not value.strip():
                continue
        merged[key] = value
    return merged


def _strip_sensitive_default_key_refs(config_json: dict[str, Any], user_id: str | None) -> dict[str, Any]:
    if _is_default_config_user(user_id):
        return config_json

    sanitized = json.loads(json.dumps(config_json))
    for section_name in ("llm", "vision", "image_gen"):
        section = sanitized.get(section_name)
        if not isinstance(section, dict):
            continue
        section["api_key"] = ""
        section["api_key_env"] = ""
        providers = section.get("providers")
        if isinstance(providers, list):
            for provider in providers:
                if isinstance(provider, dict):
                    provider["api_key"] = ""
                    provider["apiKey"] = ""
    return sanitized


def _merge_prompt_overrides(base_overrides: Any, override_overrides: Any) -> dict[str, Any]:
    merged = dict(base_overrides or {})
    if not isinstance(override_overrides, dict):
        return merged
    for key, value in override_overrides.items():
        text = str(value or "").strip()
        if text:
            merged[key] = text
    return merged


def _normalize_tavily_api_keys(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_items = value.translate(_KEY_SPLIT_TRANSLATION).split()
    elif isinstance(value, list):
        raw_items = [str(item or "") for item in value]
    else:
        raw_items = []

    keys: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


def _merge_web_search_config(base_section: Any, override_section: Any, user_id: str | None) -> dict[str, Any]:
    merged = dict(base_section or {}) if isinstance(base_section, dict) else {}
    if not _is_default_config_user(user_id):
        merged["tavily_api_keys"] = []
        merged["tavily_next_key_index"] = 0
    if isinstance(override_section, dict):
        if "tavily_api_keys" in override_section:
            merged["tavily_api_keys"] = _normalize_tavily_api_keys(override_section.get("tavily_api_keys"))
        if "tavily_next_key_index" in override_section:
            try:
                merged["tavily_next_key_index"] = max(0, int(override_section.get("tavily_next_key_index") or 0))
            except (TypeError, ValueError):
                merged["tavily_next_key_index"] = 0
    merged["tavily_api_keys"] = _normalize_tavily_api_keys(merged.get("tavily_api_keys"))
    key_count = len(merged["tavily_api_keys"])
    if key_count:
        merged["tavily_next_key_index"] = int(merged.get("tavily_next_key_index") or 0) % key_count
    else:
        merged["tavily_next_key_index"] = 0
    return merged


def _normalize_web_search_config(section: Any) -> dict[str, Any]:
    normalized = dict(section or {}) if isinstance(section, dict) else {}
    normalized["tavily_api_keys"] = _normalize_tavily_api_keys(normalized.get("tavily_api_keys"))
    key_count = len(normalized["tavily_api_keys"])
    if key_count:
        normalized["tavily_next_key_index"] = int(normalized.get("tavily_next_key_index") or 0) % key_count
    else:
        normalized["tavily_next_key_index"] = 0
    return normalized


def _load_effective_config_json(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> dict[str, Any]:
    base = _load_default_config_json()
    if _is_default_config_user(user_id):
        return base
    base = _strip_sensitive_default_key_refs(base, user_id)

    override = _load_namespace_override_json(user_id)
    if not override:
        base["web_search"] = _merge_web_search_config(base.get("web_search"), {}, user_id)
        return base

    merged = json.loads(json.dumps(base))
    for section_name in ("llm", "vision", "image_gen"):
        merged[section_name] = _merge_adapter_section(base.get(section_name), override.get(section_name))
    merged["prompt_overrides"] = _merge_prompt_overrides(base.get("prompt_overrides"), override.get("prompt_overrides"))
    merged["web_search"] = _merge_web_search_config(base.get("web_search"), override.get("web_search"), user_id)
    for key, value in override.items():
        if key in {"llm", "vision", "image_gen", "prompt_overrides", "web_search"}:
            continue
        merged[key] = value
    return merged


def _effective_env_values(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> dict[str, str]:
    if _is_default_config_user(user_id):
        values: dict[str, str] = {}
        values.update(_read_env_values(ENV_PATH))
        values.update(os.environ)
        return values

    values = _read_env_values(_env_path_for_user(user_id))
    # Non-default users must not inherit workspace API keys from the default .env or process env.
    return values


def _namespace_has_explicit_api_key(user_id: str | None, section_name: str) -> bool:
    if _is_default_config_user(user_id):
        return True
    override = _load_namespace_override_json(user_id)
    section = override.get(section_name)
    if not isinstance(section, dict):
        return False
    if str(section.get("api_key") or "").strip():
        return True
    active_id = str(section.get("active_provider_id") or "").strip()
    providers = section.get("providers")
    if isinstance(providers, list) and active_id:
        for provider in providers:
            if (
                isinstance(provider, dict)
                and str(provider.get("id") or "").strip() == active_id
                and str(provider.get("api_key") or provider.get("apiKey") or "").strip()
            ):
                return True
    return False


def get_config(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> AppConfig:
    if _is_default_config_user(user_id):
        config_path = CONFIG_PATH if CONFIG_PATH.exists() else CONFIG_EXAMPLE_PATH
        return load_config(str(config_path))
    try:
        return build_config_from_dict(
            _load_effective_config_json(user_id),
            _effective_env_values(user_id),
        )
    except Exception as e:
        raise RuntimeError(f"配置文件加载失败：{e}")


def _extract_file_path(file_obj: Any) -> Optional[str]:
    if not file_obj:
        return None
    if isinstance(file_obj, str):
        return file_obj
    if isinstance(file_obj, dict):
        return file_obj.get("path") or file_obj.get("name")
    if hasattr(file_obj, "name"):
        return file_obj.name
    return None


def _to_path_list(files: Any) -> List[Optional[str]]:
    if not files:
        return []
    if isinstance(files, list):
        return [_extract_file_path(f) for f in files if _extract_file_path(f)]
    path = _extract_file_path(files)
    return [path] if path else []


def _merge_adapter_override(
    base: AdapterConfig,
    provider_name: str,
    api_format: str,
    base_url: str,
    api_key: str,
    model: str,
) -> AdapterConfig:
    # 只有在填写了任意字段时才覆盖，避免 UI 默认值误伤 config.json
    if not any([(provider_name or "").strip(), (api_format or "").strip(), (base_url or "").strip(), (api_key or "").strip(), (model or "").strip()]):
        return base
    selected_format = (api_format or base.api_format or base.provider).strip()
    return AdapterConfig(
        provider=selected_format,
        api_key=(api_key or "").strip() or base.api_key,
        model=(model or "").strip() or base.model,
        base_url=(base_url or "").strip() or base.base_url,
        timeout=base.timeout,
        provider_name=(provider_name or "").strip() or base.provider_name,
        api_format=selected_format,
        supports_image_inputs=base.supports_image_inputs,
        supports_negative_prompt=base.supports_negative_prompt,
    )


def _display_api_format(api_format: str) -> str:
    normalized = normalize_api_format(api_format)
    return API_FORMAT_LABELS.get(normalized, api_format or "Unknown")


def _validate_model_list_config(name: str, cfg: AdapterConfig, *, allow_env_fallback: bool = True):
    api_format = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")
    if not api_format:
        raise RuntimeError(f"{name} 配置缺少 API 格式")
    if api_format not in SUPPORTED_API_FORMATS:
        label = API_FORMAT_LABELS.get(api_format, api_format)
        raise RuntimeError(f"{name} 暂未实现 {label} 模型列表检测。")
    if api_format == "ollama":
        return
    if not (cfg.api_key or "").strip():
        if allow_env_fallback:
            raise RuntimeError(f"{name} 配置缺少 API Key。请在 UI 中填写，或在 .env 中设置对应变量。")
        raise RuntimeError(
            f"{name} 配置缺少 API Key。请先为当前用户保存自己的 API Key，默认工作区 Key 不会自动继承。"
        )


def _strip_model_namespace(model_name: str) -> str:
    value = str(model_name or "").strip()
    if value.startswith("models/"):
        return value.split("/", 1)[1]
    return value


def _extract_model_ids(data: Any) -> list[str]:
    if isinstance(data, list):
        raw_items = data
    elif isinstance(data, dict):
        raw_items = data.get("data") or data.get("models") or data.get("items") or []
    else:
        raw_items = []

    models: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        if isinstance(item, str):
            candidate = item
        elif isinstance(item, dict):
            candidate = item.get("id") or item.get("name") or item.get("model")
        else:
            candidate = ""
        model_name = _strip_model_namespace(str(candidate or "").strip())
        if not model_name or model_name in seen:
            continue
        seen.add(model_name)
        models.append(model_name)
    return sorted(models, key=lambda item: item.lower())


def _url_with_path(url: str, path: str) -> str:
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return f"{url.rstrip('/')}/{path.lstrip('/')}"
    normalized_path = "/" + "/".join([parts.path.strip("/"), path.strip("/")]).strip("/")
    return urlunsplit((parts.scheme, parts.netloc, normalized_path, "", ""))


def _remove_url_path_suffix(url: str, suffix: str) -> str:
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        lowered = url.lower().rstrip("/")
        return url[: -len(suffix)].rstrip("/") if lowered.endswith(suffix) else url.rstrip("/")
    path = parts.path.rstrip("/")
    if path.lower().endswith(suffix):
        path = path[: -len(suffix)].rstrip("/") or "/"
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def _openai_compatible_model_urls(base_url: str) -> list[str]:
    root = (base_url or "https://api.openai.com/v1").rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/images/generations", "/images/edits", "/completions"):
        root = _remove_url_path_suffix(root, suffix)

    candidates = [_url_with_path(root, "models")]
    parts = urlsplit(root)
    if parts.scheme and parts.netloc:
        path_segments = [segment for segment in parts.path.split("/") if segment]
        if "v1" not in path_segments:
            candidates.append(_url_with_path(root, "v1/models"))

    unique: list[str] = []
    for item in candidates:
        if item not in unique:
            unique.append(item)
    return unique


def _model_list_requests(cfg: AdapterConfig) -> list[tuple[str, dict[str, str]]]:
    api_format = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")
    api_key = (cfg.api_key or "").strip()
    if api_format == "anthropic":
        base_url = (cfg.base_url or "https://api.anthropic.com/v1").rstrip("/")
        return [(f"{base_url}/models", {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        })]
    if api_format == "azure_openai":
        raise RuntimeError("Azure OpenAI 的模型列表接口依赖资源和 api-version，请先手动填写模型名。")
    if api_format == "gemini":
        base_url = (cfg.base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        return [(_url_with_path(base_url, "models"), {"x-goog-api-key": api_key})]
    if api_format == "ollama":
        base_url = (cfg.base_url or "http://localhost:11434").rstrip("/")
        return [(_url_with_path(base_url, "api/tags"), {})]

    return [(url, {"Authorization": f"Bearer {api_key}"}) for url in _openai_compatible_model_urls(cfg.base_url or "https://api.openai.com/v1")]


def _model_list_request(cfg: AdapterConfig) -> tuple[str, dict[str, str]]:
    return _model_list_requests(cfg)[0]


def _summarize_model_list_error(url: str, exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        body = exc.response.text.strip().replace("\n", " ")[:300]
        detail = f"HTTP {exc.response.status_code}"
        if body:
            detail = f"{detail}: {body}"
        return f"{url} -> {detail}"
    return f"{url} -> {type(exc).__name__}: {exc}"


async def _list_available_models_async(cfg: AdapterConfig) -> list[str]:
    timeout = min(max(int(cfg.timeout or 30), 10), 45)
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for url, headers in _model_list_requests(cfg):
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
                models = _extract_model_ids(data)
                if not models:
                    raise RuntimeError("接口返回为空，或响应中没有可识别的 id/name/model 字段。")
                return models
            except Exception as exc:
                errors.append(_summarize_model_list_error(url, exc))
    raise RuntimeError("模型列表检测失败：" + "；".join(errors))


def list_available_models(
    role: str,
    provider_name,
    api_format,
    base_url,
    api_key,
    model,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
) -> list[str]:
    cfg = get_config(user_id)
    base_cfg = cfg.image_gen if role == "image" else cfg.llm
    merged_cfg = _merge_adapter_override(
        base_cfg,
        provider_name or "",
        api_format or "",
        base_url or "",
        api_key or "",
        model or "",
    )
    label = "画图模型" if role == "image" else "分析模型"
    _validate_model_list_config(label, merged_cfg, allow_env_fallback=_is_default_config_user(user_id))
    return _run_async(_list_available_models_async(merged_cfg))


def _validate_adapter_config(name: str, cfg: AdapterConfig, *, allow_env_fallback: bool = True):
    api_format = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")
    if not api_format:
        raise RuntimeError(f"{name} 配置缺少 API 格式")
    if api_format not in SUPPORTED_API_FORMATS:
        label = API_FORMAT_LABELS.get(api_format, api_format)
        raise RuntimeError(
            f"{name} 暂未实现 {label} 原生适配。"
            "当前可用：OpenAI、OpenAI-Response、Gemini、Anthropic、Azure OpenAI、Ollama、Custom。"
        )
    if not (cfg.model or "").strip():
        raise RuntimeError(f"{name} 配置缺少 model")
    if not (cfg.api_key or "").strip():
        if allow_env_fallback:
            raise RuntimeError(f"{name} 配置缺少 API Key。请在 UI 中填写，或在 .env 中设置对应变量。")
        raise RuntimeError(
            f"{name} 配置缺少 API Key。请先为当前用户保存自己的 API Key，默认工作区 Key 不会自动继承。"
        )


def save_api_keys_to_env(analysis_api_key, img_api_key):
    env_path = ENV_PATH
    current = _read_env_values(env_path)

    llm_key = (analysis_api_key or "").strip()
    image_key = (img_api_key or "").strip()
    if not llm_key and not image_key:
        return "未保存：请输入至少一个 API Key。"

    if llm_key:
        current["LLM_API_KEY"] = llm_key
        current["VISION_API_KEY"] = llm_key
        os.environ["LLM_API_KEY"] = llm_key
        os.environ["VISION_API_KEY"] = llm_key
    if image_key:
        current["IMAGE_API_KEY"] = image_key
        os.environ["IMAGE_API_KEY"] = image_key

    _write_env_values(env_path, current)

    msg = []
    if llm_key:
        msg.append("LLM/Vision")
    if image_key:
        msg.append("Image")
    return f"已保存到 .env：{', '.join(msg)}"


def _resolve_project_path(path: str | os.PathLike[str]) -> Path:
    resolved = Path(path).expanduser()
    return resolved if resolved.is_absolute() else PROJECT_ROOT / resolved


def _read_env_values(env_path: str | os.PathLike[str] = ENV_PATH) -> dict[str, str]:
    current = {}
    path = _resolve_project_path(env_path)
    if path.exists():
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                k, v = raw.split("=", 1)
                current[k.strip()] = v.strip()
    return current


def _write_env_values(env_path: str | os.PathLike[str], current: dict[str, str]):
    path = _resolve_project_path(env_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for k in sorted(current.keys()):
            f.write(f"{k}={current[k]}\n")


def _load_config_json(path: str | os.PathLike[str] = CONFIG_PATH, user_id: str | None = None) -> dict:
    requested = _config_path_for_user(user_id) if user_id is not None else _resolve_project_path(path)
    source = requested if requested.exists() else _default_config_source_path()
    return _load_json_file(source)


def _save_config_json(data: dict, path: str | os.PathLike[str] = CONFIG_PATH):
    target = _resolve_project_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _read_prompt_overrides_from_json(data: dict[str, Any]) -> dict[str, str]:
    overrides = data.get("prompt_overrides") if isinstance(data.get("prompt_overrides"), dict) else {}
    return {
        "floorAnalysisSystemPrompt": str(overrides.get("floorAnalysisSystemPrompt") or prompt_assets.FLOOR_ANALYSIS_SYSTEM_PROMPT).strip(),
        "promptGenSystem3dCn": str(overrides.get("promptGenSystem3dCn") or prompt_assets.PROMPT_GEN_SYSTEM_3D_CN).strip(),
        "promptGenSystemStandardCn": str(overrides.get("promptGenSystemStandardCn") or prompt_assets.PROMPT_GEN_SYSTEM_STANDARD_CN).strip(),
    }


def _apply_prompt_overrides_from_json(data: dict[str, Any]) -> dict[str, str]:
    overrides = _read_prompt_overrides_from_json(data)
    prompt_assets.set_prompt_overrides(
        floor_analysis_system_prompt=overrides["floorAnalysisSystemPrompt"],
        prompt_gen_system_3d_cn=overrides["promptGenSystem3dCn"],
        prompt_gen_system_standard_cn=overrides["promptGenSystemStandardCn"],
    )
    return overrides


def _update_adapter_json(
    data: dict,
    section_name: str,
    *,
    provider_name: str,
    api_format: str,
    base_url: str,
    model: str,
    api_key_env: str,
    api_key: str | None = None,
):
    section = dict(data.get(section_name) or {})
    if provider_name.strip():
        section["provider_name"] = provider_name.strip()
    if api_format.strip():
        section["api_format"] = normalize_api_format(api_format)
    if base_url.strip():
        section["base_url"] = base_url.strip()
    if model.strip():
        section["model"] = model.strip()
    section["api_key_env"] = api_key_env
    if api_key is not None:
        section["api_key"] = api_key.strip()
    data[section_name] = section


def _persist_effective_config_json(user_id: str | None, data: dict[str, Any]) -> None:
    _save_config_json(data, _config_path_for_user(user_id))


def load_web_search_config_for_ui(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> dict[str, Any]:
    config_data = _load_effective_config_json(user_id)
    section = _normalize_web_search_config(config_data.get("web_search"))
    return {
        "tavilyApiKeys": "\n".join(section.get("tavily_api_keys", [])),
        "tavilyNextKeyIndex": int(section.get("tavily_next_key_index") or 0),
    }


def claim_tavily_api_keys(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> tuple[list[str], int]:
    with _WEB_SEARCH_CONFIG_LOCK:
        config_data = _load_effective_config_json(user_id)
        section = _normalize_web_search_config(config_data.get("web_search"))
        keys = list(section.get("tavily_api_keys") or [])
        if not keys:
            return [], 0
        start_index = int(section.get("tavily_next_key_index") or 0) % len(keys)
        try:
            from backend.app.services.search_state_store import claim_tavily_start_index
            db_start_index = claim_tavily_start_index(user_id or DEFAULT_CONFIG_USER_ID, len(keys), start_index)
            if db_start_index is not None:
                start_index = db_start_index
        except Exception:
            pass
        section["tavily_next_key_index"] = (start_index + 1) % len(keys)
        config_data["web_search"] = section
        _persist_effective_config_json(user_id, config_data)
        return keys, start_index


def _adapter_section_to_provider_profile(section: dict[str, Any], provider_id: str = "") -> dict[str, str]:
    return {
        "id": str(section.get("id") or section.get("active_provider_id") or provider_id or "").strip(),
        "providerName": str(section.get("provider_name") or "").strip(),
        "apiFormat": _ui_api_format(str(section.get("api_format") or section.get("provider") or "")),
        "baseUrl": str(section.get("base_url") or "").strip(),
        "apiKey": str(section.get("api_key") or "").strip(),
        "model": str(section.get("model") or "").strip(),
    }


def _profile_to_adapter_json(profile: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(profile.get("id") or "").strip(),
        "provider_name": str(profile.get("providerName") or profile.get("provider_name") or "").strip(),
        "api_format": normalize_api_format(str(profile.get("apiFormat") or profile.get("api_format") or "")),
        "base_url": str(profile.get("baseUrl") or profile.get("base_url") or "").strip(),
        "api_key": str(profile.get("apiKey") or profile.get("api_key") or "").strip(),
        "model": str(profile.get("model") or "").strip(),
    }


def _parse_provider_profiles_json(raw: str) -> list[dict[str, str]]:
    if not str(raw or "").strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"供应商列表 JSON 格式错误：{exc}") from exc
    if not isinstance(parsed, list):
        raise RuntimeError("供应商列表 JSON 必须是数组。")

    profiles: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            continue
        profile = _profile_to_adapter_json(item)
        if not profile["id"]:
            profile["id"] = f"provider-{index}"
        if profile["id"] in seen:
            continue
        seen.add(profile["id"])
        profiles.append(profile)
    return profiles


def _providers_for_ui(section: dict[str, Any], default_id: str) -> tuple[list[dict[str, str]], str]:
    active_id = str(section.get("active_provider_id") or default_id).strip() or default_id
    raw_providers = section.get("providers")
    providers: list[dict[str, str]] = []
    if isinstance(raw_providers, list):
        for index, item in enumerate(raw_providers, start=1):
            if not isinstance(item, dict):
                continue
            profile = _adapter_section_to_provider_profile(item, f"{default_id}-{index}")
            if not profile["id"]:
                profile["id"] = f"{default_id}-{index}"
            providers.append(profile)
    if not providers:
        providers = [_adapter_section_to_provider_profile(section, active_id)]
    if not any(provider["id"] == active_id for provider in providers):
        active_id = providers[0]["id"]
    return providers, active_id


def _write_provider_profiles_to_sections(
    data: dict[str, Any],
    section_names: tuple[str, ...],
    profiles_json: str,
    active_provider_id: str,
):
    profiles = _parse_provider_profiles_json(profiles_json)
    if not profiles:
        return
    active_id = str(active_provider_id or "").strip() or profiles[0]["id"]
    if not any(profile["id"] == active_id for profile in profiles):
        active_id = profiles[0]["id"]
    active_profile = next(profile for profile in profiles if profile["id"] == active_id)
    for section_name in section_names:
        section = dict(data.get(section_name) or {})
        section["providers"] = profiles
        section["active_provider_id"] = active_id
        for key in ("provider_name", "api_format", "base_url", "api_key", "model"):
            value = active_profile.get(key, "")
            if value or key == "api_key":
                section[key] = value
        data[section_name] = section


def save_model_config_to_files(
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
    floor_analysis_system_prompt="",
    prompt_gen_system_3d_cn="",
    fallback_models_text="",
    model_switch_after_failures=2,
    stop_after_last_model_failures=2,
    *,
    analysis_providers_json: str = "",
    active_analysis_provider_id: str = "",
    image_providers_json: str = "",
    active_image_provider_id: str = "",
    tavily_api_keys: str | None = None,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
):
    is_default_user = _is_default_config_user(user_id)
    config_path = _config_path_for_user(user_id)
    env_path = _env_path_for_user(user_id)
    data = _load_effective_config_json(user_id)
    _update_adapter_json(
        data,
        "llm",
        provider_name=analysis_provider_name or "",
        api_format=analysis_api_format or "",
        base_url=analysis_base_url or "",
        model=analysis_model or "",
        api_key_env="LLM_API_KEY" if is_default_user else "",
        api_key=None if is_default_user else (analysis_api_key or ""),
    )
    _update_adapter_json(
        data,
        "vision",
        provider_name=analysis_provider_name or "",
        api_format=analysis_api_format or "",
        base_url=analysis_base_url or "",
        model=analysis_model or "",
        api_key_env="VISION_API_KEY" if is_default_user else "",
        api_key=None if is_default_user else (analysis_api_key or ""),
    )
    _update_adapter_json(
        data,
        "image_gen",
        provider_name=img_provider_name or "",
        api_format=img_api_format or "",
        base_url=img_base_url or "",
        model=img_model or "",
        api_key_env="IMAGE_API_KEY" if is_default_user else "",
        api_key=None if is_default_user else (img_api_key or ""),
    )
    _write_provider_profiles_to_sections(
        data,
        ("llm", "vision"),
        analysis_providers_json,
        active_analysis_provider_id,
    )
    _write_provider_profiles_to_sections(
        data,
        ("image_gen",),
        image_providers_json,
        active_image_provider_id,
    )
    if tavily_api_keys is not None:
        current_web_search = data.get("web_search") if isinstance(data.get("web_search"), dict) else {}
        current_web_search = dict(current_web_search)
        current_web_search["tavily_api_keys"] = _normalize_tavily_api_keys(tavily_api_keys)
        key_count = len(current_web_search["tavily_api_keys"])
        if key_count:
            current_web_search["tavily_next_key_index"] = int(current_web_search.get("tavily_next_key_index") or 0) % key_count
        else:
            current_web_search["tavily_next_key_index"] = 0
        data["web_search"] = current_web_search

    fallback_models = []
    for item in str(fallback_models_text or "").replace("\r", "\n").replace(",", "\n").split("\n"):
        model_name = item.strip()
        if model_name:
            fallback_models.append(model_name)
    data["image_model_fallbacks"] = fallback_models
    data["model_switch_after_failures"] = max(1, int(model_switch_after_failures or 2))
    data["stop_after_last_model_failures"] = max(1, int(stop_after_last_model_failures or 2))
    data["prompt_overrides"] = {
        "floorAnalysisSystemPrompt": (floor_analysis_system_prompt or prompt_assets.FLOOR_ANALYSIS_SYSTEM_PROMPT).strip(),
        "promptGenSystem3dCn": (prompt_gen_system_3d_cn or prompt_assets.PROMPT_GEN_SYSTEM_3D_CN).strip(),
        "promptGenSystemStandardCn": prompt_assets.get_prompt_gen_system_standard_cn(),
    }

    if is_default_user:
        env_values = _read_env_values(env_path)
        if (analysis_api_key or "").strip():
            env_values["LLM_API_KEY"] = analysis_api_key.strip()
            env_values["VISION_API_KEY"] = analysis_api_key.strip()
            os.environ["LLM_API_KEY"] = analysis_api_key.strip()
            os.environ["VISION_API_KEY"] = analysis_api_key.strip()
        if (img_api_key or "").strip():
            env_values["IMAGE_API_KEY"] = img_api_key.strip()
            os.environ["IMAGE_API_KEY"] = img_api_key.strip()
        _write_env_values(env_path, env_values)

    _save_config_json(data, config_path)
    _apply_prompt_overrides_from_json(data)
    if is_default_user:
        return "已保存到 config.json 和 .env"
    return "已保存到当前用户的本地配置"


def load_model_config_for_ui(user_id: str | None = DEFAULT_CONFIG_USER_ID) -> dict[str, Any]:
    config_data = _load_effective_config_json(user_id)
    prompt_overrides = _apply_prompt_overrides_from_json(config_data)
    cfg = get_config(user_id)
    web_search = _normalize_web_search_config(config_data.get("web_search"))
    analysis_providers, active_analysis_provider_id = _providers_for_ui(config_data.get("llm") or {}, "analysis-default")
    image_providers, active_image_provider_id = _providers_for_ui(config_data.get("image_gen") or {}, "image-default")
    analysis_api_key = cfg.llm.api_key if _namespace_has_explicit_api_key(user_id, "llm") else ""
    image_api_key = cfg.image_gen.api_key if _namespace_has_explicit_api_key(user_id, "image_gen") else ""
    for provider in analysis_providers:
        if provider["id"] == active_analysis_provider_id:
            provider.update({
                "providerName": cfg.llm.provider_name or "",
                "apiFormat": _ui_api_format(cfg.llm.api_format or cfg.llm.provider),
                "baseUrl": cfg.llm.base_url or "",
                "apiKey": analysis_api_key,
                "model": cfg.llm.model or "",
            })
    for provider in image_providers:
        if provider["id"] == active_image_provider_id:
            provider.update({
                "providerName": cfg.image_gen.provider_name or "",
                "apiFormat": _ui_api_format(cfg.image_gen.api_format or cfg.image_gen.provider),
                "baseUrl": cfg.image_gen.base_url or "",
                "apiKey": image_api_key,
                "model": cfg.image_gen.model or "",
            })
    return {
        "analysisProviderName": cfg.llm.provider_name or "",
        "analysisApiFormat": _ui_api_format(cfg.llm.api_format or cfg.llm.provider),
        "analysisBaseUrl": cfg.llm.base_url or "",
        "analysisApiKey": analysis_api_key,
        "analysisModel": cfg.llm.model or "",
        "activeAnalysisProviderId": active_analysis_provider_id,
        "analysisProviders": analysis_providers,
        "imageProviderName": cfg.image_gen.provider_name or "",
        "imageApiFormat": _ui_api_format(cfg.image_gen.api_format or cfg.image_gen.provider),
        "imageBaseUrl": cfg.image_gen.base_url or "",
        "imageApiKey": image_api_key,
        "imageModel": cfg.image_gen.model or "",
        "activeImageProviderId": active_image_provider_id,
        "imageProviders": image_providers,
        "tavilyApiKeys": "\n".join(web_search.get("tavily_api_keys", [])),
        "tavilyNextKeyIndex": int(web_search.get("tavily_next_key_index") or 0),
        "fallbackModels": "\n".join(cfg.image_model_fallbacks or []),
        "modelSwitchAfterFailures": cfg.model_switch_after_failures,
        "stopAfterLastModelFailures": cfg.stop_after_last_model_failures,
        "floorAnalysisSystemPrompt": prompt_overrides["floorAnalysisSystemPrompt"],
        "promptGenSystem3dCn": prompt_overrides["promptGenSystem3dCn"],
    }


def _ui_api_format(api_format: str) -> str:
    normalized = normalize_api_format(api_format)
    if normalized == "openai_chat":
        return "openai"
    if normalized == "custom_openai_chat":
        return "custom"
    return normalized


def _build_runtime_config(
    max_iterations,
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
    fallback_models_text="",
    model_switch_after_failures=2,
    stop_after_last_model_failures=2,
    validate_analysis=True,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
) -> AppConfig:
    cfg = get_config(user_id)
    _apply_prompt_overrides_from_json(_load_effective_config_json(user_id))
    cfg.max_iterations = int(max_iterations)
    allow_env_fallback = _is_default_config_user(user_id)

    analysis_cfg = _ensure_min_timeout(
        _merge_adapter_override(
            cfg.llm,
            analysis_provider_name,
            analysis_api_format,
            analysis_base_url or "",
            analysis_api_key or "",
            analysis_model or "",
        ),
        GENERATION_ANALYSIS_TIMEOUT_SECONDS,
    )
    cfg.llm = analysis_cfg
    cfg.vision = clone_adapter_config(analysis_cfg)

    cfg.image_gen = _ensure_min_timeout(
        _merge_adapter_override(
            cfg.image_gen,
            img_provider_name,
            img_api_format,
            img_base_url or "",
            img_api_key or "",
            img_model or "",
        ),
        GENERATION_IMAGE_TIMEOUT_SECONDS,
    )

    if validate_analysis:
        _validate_adapter_config("分析/提示词模型", cfg.llm, allow_env_fallback=allow_env_fallback)
        _validate_adapter_config("图像分析模型", cfg.vision, allow_env_fallback=allow_env_fallback)
    _validate_adapter_config("画图模型", cfg.image_gen, allow_env_fallback=allow_env_fallback)

    fallback_models = []
    for item in str(fallback_models_text or "").replace("\r", "\n").replace(",", "\n").split("\n"):
        model_name = item.strip()
        if model_name and model_name != cfg.image_gen.model:
            fallback_models.append(model_name)
    cfg.image_model_fallbacks = fallback_models or list(cfg.image_model_fallbacks or [])
    cfg.model_switch_after_failures = max(1, int(model_switch_after_failures))
    cfg.stop_after_last_model_failures = max(1, int(stop_after_last_model_failures))
    return cfg



class _NoopProgress:
    def __call__(self, *_args, **_kwargs):
        return None


def _run_async(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result_queue: Queue = Queue(maxsize=1)

    def runner():
        try:
            result_queue.put((True, asyncio.run(coro)))
        except Exception as exc:
            result_queue.put((False, exc))

    thread = Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    ok, value = result_queue.get()
    if ok:
        return value
    raise value


def _build_analysis_adapter_config(
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
) -> AdapterConfig:
    cfg = get_config(user_id)
    analysis_cfg = _merge_adapter_override(
        cfg.llm,
        analysis_provider_name,
        analysis_api_format,
        analysis_base_url or "",
        analysis_api_key or "",
        analysis_model or "",
    )
    _validate_adapter_config(
        "分析/提示词模型",
        analysis_cfg,
        allow_env_fallback=_is_default_config_user(user_id),
    )
    return analysis_cfg


def _build_image_adapter_config(
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
) -> AdapterConfig:
    cfg = get_config(user_id)
    image_cfg = _merge_adapter_override(
        cfg.image_gen,
        img_provider_name,
        img_api_format,
        img_base_url or "",
        img_api_key or "",
        img_model or "",
    )
    _validate_adapter_config(
        "画图模型",
        image_cfg,
        allow_env_fallback=_is_default_config_user(user_id),
    )
    return image_cfg


def _make_vision_probe_image_bytes() -> bytes:
    image = Image.new("RGB", (32, 32), "white")
    for x in range(4, 28):
        image.putpixel((x, 4), (0, 0, 0))
        image.putpixel((x, 27), (0, 0, 0))
    for y in range(4, 28):
        image.putpixel((4, y), (0, 0, 0))
        image.putpixel((27, y), (0, 0, 0))
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _make_image_edit_probe_image_bytes() -> bytes:
    image = Image.new("RGB", (16, 16), "white")
    for x in range(3, 13):
        image.putpixel((x, 3), (220, 0, 0))
        image.putpixel((x, 12), (220, 0, 0))
    for y in range(3, 13):
        image.putpixel((3, y), (220, 0, 0))
        image.putpixel((12, y), (220, 0, 0))
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _verification_error(prefix: str, cfg: AdapterConfig, exc: Exception) -> RuntimeError:
    return RuntimeError(
        f"{prefix}\n"
        f"供应商：{cfg.provider_name}\n"
        f"格式：{_display_api_format(cfg.api_format)}\n"
        f"模型：{cfg.model}\n"
        f"Base URL：{cfg.base_url or '未设置'}\n"
        f"错误：{type(exc).__name__}: {exc}"
    )


def verify_analysis_api(
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
):
    analysis_cfg = _build_analysis_adapter_config(
        analysis_provider_name,
        analysis_api_format,
        analysis_base_url,
        analysis_api_key,
        analysis_model,
        user_id=user_id,
    )

    async def _verify():
        try:
            llm = build_adapter(analysis_cfg, "llm")
            llm_resp = await asyncio.wait_for(
                llm.chat(
                    [{"role": "user", "content": "Reply only with OK."}],
                    max_tokens=8,
                ),
                timeout=min(int(analysis_cfg.timeout or 60), 45),
            )
            ok_text = (llm_resp or "").strip()[:80]
            if not ok_text:
                raise RuntimeError("接口返回为空，请检查 API 格式是否应选择 OpenAI-Response，或检查模型是否支持 chat/completions。")
        except Exception as exc:
            raise _verification_error("分析文本调用失败", analysis_cfg, exc) from exc

        try:
            vision = build_adapter(analysis_cfg, "vision")
            vision_resp = await asyncio.wait_for(
                vision.analyze(
                    _make_vision_probe_image_bytes(),
                    "请用一句中文简短描述这张测试图。只回复一句话。",
                ),
                timeout=min(int(analysis_cfg.timeout or 60), 45),
            )
            vision_text = (vision_resp or "").strip()[:80]
            if not vision_text:
                raise RuntimeError("视觉接口返回为空，真实平面图分析也无法继续。")
        except Exception as exc:
            raise _verification_error("平面图视觉分析调用失败", analysis_cfg, exc) from exc

        return (
            f"分析模型可用\n"
            f"供应商：{analysis_cfg.provider_name}\n"
            f"格式：{_display_api_format(analysis_cfg.api_format)}\n"
            f"模型：{analysis_cfg.model}\n"
            f"文本响应：{ok_text}\n"
            f"视觉响应：{vision_text}"
        )

    return _run_async(_verify())


def verify_image_api(
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
):
    image_cfg = _build_image_adapter_config(
        img_provider_name,
        img_api_format,
        img_base_url,
        img_api_key,
        img_model,
        user_id=user_id,
    )
    capabilities = describe_adapter_capabilities(image_cfg, image_cfg.model)
    test_prompt = (
        "Draw a Hello Kitty character on a plain background, "
        "full body, clear subject, simple composition, no text, no watermark."
    )

    async def _verify():
        text_bytes = 0
        text_negative_mode = "unknown"
        edit_bytes = None
        try:
            img = build_adapter(image_cfg, "image")
            prompt = PromptSet(
                positive_prompt=test_prompt,
                negative_prompt="blurry, distorted, text, watermark",
                model_target=image_cfg.model,
            )
            generated = await asyncio.wait_for(
                img.generate(prompt),
                timeout=min(int(image_cfg.timeout or 60), 60),
            )
            text_bytes = len(generated.image_bytes)
            text_negative_mode = generated.generation_params.get("negative_prompt_mode", "unknown")
        except Exception as exc:
            raise _verification_error("文生图调用失败", image_cfg, exc) from exc

        if capabilities["supports_image_inputs"]:
            try:
                edit_prompt = PromptSet(
                    positive_prompt="Transform this tiny reference image into a clean simple icon. No text.",
                    negative_prompt="blurry, text, watermark",
                    model_target=image_cfg.model,
                    reference_image=_make_image_edit_probe_image_bytes(),
                )
                edited = await asyncio.wait_for(
                    img.generate(edit_prompt),
                    timeout=min(int(image_cfg.timeout or 60), 60),
                )
                edit_bytes = len(edited.image_bytes)
            except Exception as exc:
                raise _verification_error("图生图/参考图调用失败", image_cfg, exc) from exc

        edit_line = (
            f"图生图/参考图可用；图生图/参考图返回图片字节：{edit_bytes}"
            if edit_bytes is not None
            else "图生图/参考图未验证：当前配置声明不支持图片输入"
        )
        return (
            f"画图模型可用\n"
            f"供应商：{image_cfg.provider_name}\n"
            f"格式：{_display_api_format(image_cfg.api_format)}\n"
            f"模型：{image_cfg.model}\n"
            f"支持平面图/参考图输入：{'是' if capabilities['supports_image_inputs'] else '否'}\n"
            f"支持原生负向提示词：{'是' if capabilities['supports_negative_prompt'] else '否'}\n"
            f"测试提示词：{test_prompt}\n"
            f"负向提示词处理：{text_negative_mode}\n"
            f"文生图可用；文生图返回图片字节：{text_bytes}\n"
            f"{edit_line}"
        )

    return _run_async(_verify())


def _format_prompt_text(iteration: int, positive_prompt: str, negative_prompt: str) -> str:
    return (
        f"第{iteration}轮正向提示词：\n{positive_prompt.strip()}\n\n"
        f"第{iteration}轮负向提示词：\n{(negative_prompt or '').strip() or '无'}"
    )


def _format_evaluation_report(ev) -> str:
    report = f"综合评分：{ev.total_score:.1f} / 10\n状态：{'通过' if ev.passed else '未通过'}\n\n"
    if getattr(ev, "image_description", ""):
        report += f"生成图描述：\n{ev.image_description}\n\n"
    if getattr(ev, "prompt_alignment", ""):
        report += f"提示词对比分析：\n{ev.prompt_alignment}\n\n"
    if getattr(ev, "comparison_summary", ""):
        report += f"关键偏差总结：\n{ev.comparison_summary}\n\n"
    for d in ev.dimensions:
        report += f"  {d.name}：{d.score:.1f}  {d.comment}\n"
    if ev.issues:
        report += "\n发现的问题：\n"
        for issue in ev.issues:
            report += f"- {issue}\n"
    if ev.failure_reason:
        report += f"\n主要问题：{ev.failure_reason}"
    return report.strip()


def _format_stop_reason(stop_reason: str) -> str:
    return {
        "passed_quality_threshold": "达到质量阈值",
        "quality_evaluation_disabled": "质量评估未启用",
        "standard_passthrough": "默认模式直通生成",
        "last_model_failure_limit": "最后一个模型连续失败达到上限",
        "router_terminate": "路由策略终止",
        "max_iterations_reached": "达到最大迭代次数",
        "no_compatible_model": "没有兼容当前输入约束的模型",
        "": "未说明",
    }.get(stop_reason, stop_reason)


def run_pipeline(
    mode,
    floor_plan_paths,
    reference_image,
    user_requirement,
    direction_stack_text,
    manual_prompt,
    max_iterations,
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
    fallback_models_text="",
    model_switch_after_failures=2,
    stop_after_last_model_failures=2,
    enable_quality_evaluation=True,
    project_id="default",
    user_id: str | None = DEFAULT_CONFIG_USER_ID,
    learned_preferences_text="",
    record_output_dir: str | None = None,
    progress=None,
):
    progress = progress or _NoopProgress()
    user_requirement = user_requirement or ""
    direction_stack_text = direction_stack_text or ""
    manual_prompt = manual_prompt or ""
    current_preview = None
    output_images = []
    status_lines = []
    floor_descs = []
    reports = []
    log_lines = []
    prompt_text = ""

    def snapshot():
        return current_preview, output_images, "\n".join(status_lines), "\n\n".join(floor_descs), prompt_text, "\n\n".join(reports), "\n".join(log_lines)

    def append_log(message: str):
        log_lines.append(message)
        progress(0, desc=message[:120])

    try:
        generation_mode = GenerationMode(mode)
    except Exception:
        error = f"执行失败：不支持的生成模式 {mode}"
        yield None, [], error, "", "", "", error
        return

    floor_plan_paths = _to_path_list(floor_plan_paths)
    reference_image_path = _extract_file_path(reference_image)

    has_prompt_text = bool(manual_prompt.strip() or user_requirement.strip() or direction_stack_text.strip())
    if generation_mode == GenerationMode.STANDARD and not has_prompt_text:
        error = "执行失败：默认模式请至少提供要直通发送给画图模型的提示词"
        yield None, [], error, "", "", "", error
        return

    if generation_mode == GenerationMode.COLORED_FLOOR_PLAN and not floor_plan_paths:
        error = "执行失败：彩色平面图模式请至少上传一张平面图"
        yield None, [], error, "", "", "", error
        return

    if not has_prompt_text and not reference_image_path and not floor_plan_paths:
        error = "执行失败：请输入设计需求、设计指令栈或手动提示词"
        yield None, [], error, "", "", "", error
        return

    try:
        cfg = _build_runtime_config(
            max_iterations,
            analysis_provider_name,
            analysis_api_format,
            analysis_base_url,
            analysis_api_key,
            analysis_model,
            img_provider_name,
            img_api_format,
            img_base_url,
            img_api_key,
            img_model,
            fallback_models_text,
            model_switch_after_failures,
            stop_after_last_model_failures,
            validate_analysis=generation_mode != GenerationMode.STANDARD,
            user_id=user_id,
        )
        cfg.enable_quality_evaluation = bool(enable_quality_evaluation)
    except Exception as e:
        error = f"执行失败：{type(e).__name__}: {e}"
        yield None, [], error, "", "", "", error
        return

    model_queue = [cfg.image_gen.model] + list(cfg.image_model_fallbacks or [])
    requires_image_inputs = bool(reference_image_path)
    if requires_image_inputs:
        compatible_models = [model_name for model_name in model_queue if adapter_supports_image_inputs(cfg.image_gen, model_name)]
        if not compatible_models:
            error = (
                "执行失败：画图阶段没有兼容当前输入约束的模型。"
                f"当前模型链：{', '.join(model_queue)}；"
                "当前输入包含图片，但这些模型不支持多模态约束。"
            )
            yield None, [], error, "", "", "", error
            return

    try:
        ref_bytes = None
        if reference_image_path:
            with open(reference_image_path, "rb") as rf:
                ref_bytes = rf.read()
    except Exception as e:
        error = f"执行失败：读取参考图失败 {e}"
        yield None, [], error, "", "", "", error
        return

    event_queue: Queue = Queue()
    sentinel = object()

    def worker():
        try:
            run_paths = floor_plan_paths or [None]
            for idx, path in enumerate(run_paths):
                event_queue.put(("log", f"=== 第{idx + 1}张图 ===" if path else "=== 无平面图模式 ==="))
                floor_plan_bytes = None
                if path:
                    with open(path, "rb") as f:
                        floor_plan_bytes = f.read()

                pipeline = PipelineFactory.create(generation_mode, cfg)

                def on_progress(step, detail=""):
                    event_queue.put(("log", f"[{step}] {detail}".strip()))

                def on_event(event_type, payload):
                    payload = dict(payload)
                    payload["path_index"] = idx + 1
                    event_queue.put((event_type, payload))

                result = asyncio.run(
                    pipeline.run(
                        floor_plan_bytes,
                        ref_bytes,
                        user_requirement,
                        direction_stack_text,
                        on_progress=on_progress,
                        on_event=on_event,
                        manual_prompt=manual_prompt.strip() or None,
                        learned_preferences_text=learned_preferences_text if generation_mode != GenerationMode.STANDARD else "",
                        record_output_dir=record_output_dir,
                        project_id=project_id,
                    )
                )
                event_queue.put(("result", {"path_index": idx + 1, "result": result}))
        except Exception as e:
            event_queue.put(("error", {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc(limit=8)}))
        finally:
            event_queue.put(("done", sentinel))

    Thread(target=worker, daemon=True).start()

    while True:
        event_type, payload = event_queue.get()
        if event_type == "done":
            break
        if event_type == "log":
            append_log(payload)
            yield snapshot()
            continue
        if event_type == "floor_desc":
            floor_text = payload.get("display_text") or payload.get("text") or "常规模式未启用平面图解析"
            label = f"【图{payload['path_index']}】\n{floor_text}"
            while len(floor_descs) < payload["path_index"]:
                floor_descs.append("")
            floor_descs[payload["path_index"] - 1] = label
            yield snapshot()
            continue
        if event_type == "prompt":
            prompt_text = _format_prompt_text(
                payload.get("iteration", 1),
                payload.get("positive_prompt", ""),
                payload.get("negative_prompt", ""),
            )
            status_lines.append(f"第{payload.get('iteration', 1)}轮：提示词已生成，开始出图")
            append_log(f"[提示词已生成] 第{payload.get('iteration', 1)}轮提示词已输出到右侧。")
            yield snapshot()
            continue
        if event_type == "image":
            try:
                current_preview = Image.open(BytesIO(payload.get("image_bytes", b""))).copy()
            except Exception:
                current_preview = None
            if getattr(cfg, "enable_quality_evaluation", True):
                append_log(f"[图片已生成] 第{payload.get('iteration', 1)}轮图片已生成，等待评估。")
            else:
                append_log(f"[图片已生成] 第{payload.get('iteration', 1)}轮图片已生成，质量评估已关闭，正在整理结果。")
            yield snapshot()
            continue
        if event_type == "evaluation":
            ev = payload.get("evaluation")
            if ev is not None:
                label = f"【图{payload['path_index']} 第{payload.get('iteration', 1)}轮】\n{_format_evaluation_report(ev)}"
                reports.append(label)
            yield snapshot()
            continue
        if event_type == "result":
            result = payload["result"]
            for iter_idx, image_path in enumerate(result.iteration_image_paths):
                score = result.all_scores[iter_idx] if iter_idx < len(result.all_scores) else None
                label = (
                    f"{result.mode} 图{payload['path_index']} 第{iter_idx + 1}轮 {score:.1f}分"
                    if score is not None
                    else f"{result.mode} 图{payload['path_index']} 第{iter_idx + 1}轮"
                )
                output_images.append((image_path, label))
            status = {
                "success": "生成成功",
                "max_iterations_reached": "已达最大迭代次数，返回最优结果",
                "stopped_early": "提前停止，返回当前最优结果",
                "failed": "生成失败",
            }.get(result.status, result.status)
            status_lines.append(
                f"{result.mode} 图{payload['path_index']}：{status}（迭代{result.iteration_count}次，最终模型：{result.final_model or '未知模型'}，停止原因：{_format_stop_reason(result.stop_reason)}）"
            )
            if result.skipped_models:
                status_lines.append(f"{result.mode} 图{payload['path_index']}：跳过模型 {', '.join(result.skipped_models)}")
            if result.evaluation_report:
                final_report = f"【图{payload['path_index']} 最终结果】\n{_format_evaluation_report(result.evaluation_report)}"
                reports.append(final_report)
            if result.used_prompt:
                prompt_text = _format_prompt_text(result.iteration_count, result.used_prompt, result.used_negative_prompt)
            current_preview = result.final_image_path or current_preview
            yield snapshot()
            continue
        if event_type == "error":
            error_text = f"执行失败：{payload['error']}"
            append_log(f"[异常] {payload['error']}")
            append_log(payload.get("trace", ""))
            yield current_preview, output_images, error_text, "\n\n".join(floor_descs), prompt_text, "\n\n".join(reports), "\n".join(log_lines)
            return

    yield snapshot()
