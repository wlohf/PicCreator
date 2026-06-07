import asyncio
import base64
import json
import re
from io import BytesIO
from typing import AsyncIterator
import httpx
from openai import AsyncOpenAI
from config import AdapterConfig, normalize_api_format
from models.schemas import PromptSet, NormalizedImage
from adapters.base import BaseLLMAdapter, BaseImageAdapter, BaseVisionAdapter


class OpenAICompatAdapter(BaseLLMAdapter, BaseImageAdapter, BaseVisionAdapter):
    """统一适配 OpenAI 兼容格式的 LLM / 生图 / 视觉接口（含中转站）。"""

    RETRYABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}
    RETRYABLE_HTTPX_EXCEPTIONS = (
        httpx.ConnectTimeout,
        httpx.WriteTimeout,
        httpx.PoolTimeout,
        httpx.ReadError,
        httpx.WriteError,
        httpx.ConnectError,
        httpx.RemoteProtocolError,
    )
    MAX_ATTEMPTS = 3

    def __init__(self, cfg: AdapterConfig):
        self.model = cfg.model
        self.api_key = (cfg.api_key or "").strip()
        self.base_url = (cfg.base_url or "https://api.openai.com/v1").rstrip("/")
        self.timeout = cfg.timeout
        self.api_format = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")

        if not self.api_key:
            raise ValueError(f"OpenAI-compatible 适配器缺少 API Key（model={self.model}, base_url={self.base_url}）")

        # 优先用 httpx 直接请求，避免 SDK User-Agent 被拦截
        self._headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        # 同时保留 SDK client（用于 with_raw_response）
        self.client = AsyncOpenAI(
            api_key=cfg.api_key,
            base_url=self.base_url,
            timeout=cfg.timeout,
            default_headers={"User-Agent": "python-httpx/0.25.0"},
        )

    @classmethod
    def _is_retryable_status_code(cls, status_code: int | None) -> bool:
        return status_code in cls.RETRYABLE_STATUS_CODES

    @staticmethod
    def _extract_retry_after_seconds(headers) -> float | None:
        if not headers:
            return None
        raw_value = headers.get("Retry-After")
        if not raw_value:
            return None
        try:
            seconds = float(str(raw_value).strip())
        except (TypeError, ValueError):
            return None
        return max(0.0, seconds)

    @classmethod
    def _retry_delay_seconds(cls, attempt: int, retry_after_seconds: float | None = None) -> float:
        if retry_after_seconds is not None:
            return min(max(retry_after_seconds, 0.5), 15.0)
        base = 1.5 * (2 ** max(attempt - 1, 0))
        return min(base, 8.0)

    @classmethod
    def _should_retry_exception(cls, exc: Exception) -> tuple[bool, float | None]:
        if isinstance(exc, cls.RETRYABLE_HTTPX_EXCEPTIONS):
            return True, None
        status_code = getattr(exc, "status_code", None)
        response = getattr(exc, "response", None)
        if status_code is None and response is not None:
            status_code = getattr(response, "status_code", None)
        if cls._is_retryable_status_code(status_code):
            headers = getattr(response, "headers", None)
            return True, cls._extract_retry_after_seconds(headers)
        return False, None

    async def _run_with_retries(self, operation):
        last_exc = None
        for attempt in range(1, self.MAX_ATTEMPTS + 1):
            try:
                return await operation()
            except Exception as exc:
                last_exc = exc
                should_retry, retry_after = self._should_retry_exception(exc)
                if not should_retry or attempt >= self.MAX_ATTEMPTS:
                    raise
                await asyncio.sleep(self._retry_delay_seconds(attempt, retry_after))
        raise last_exc

    async def _post(self, endpoint: str, payload: dict) -> dict:
        async def operation() -> dict:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}{endpoint}",
                    headers=self._headers,
                    json=payload,
                )
                resp.raise_for_status()
                return resp.json()

        return await self._run_with_retries(operation)

    async def _post_text(self, endpoint: str, payload: dict) -> str:
        async def operation() -> str:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.base_url}{endpoint}",
                    headers=self._headers,
                    json=payload,
                )
                resp.raise_for_status()
                return resp.text

        return await self._run_with_retries(operation)

    async def _stream_lines(self, endpoint: str, payload: dict) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}{endpoint}",
                headers={**self._headers, "Accept": "text/event-stream"},
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    yield line

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

    async def chat(self, messages: list, **kwargs) -> str:
        model = kwargs.pop("model", self.model)
        if self.api_format == "openai_responses":
            return await self._responses_chat(model, messages, **kwargs)

        data = await self._post("/chat/completions", {
            "model": model,
            "messages": messages,
            **kwargs,
        })
        return self._extract_chat_content(data)

    async def stream_chat(self, messages: list, **kwargs) -> AsyncIterator[str]:
        model = kwargs.pop("model", self.model)
        if self.api_format == "openai_responses":
            async for chunk in self._responses_stream_chat(model, messages, **kwargs):
                yield chunk
            return

        async for chunk in self._chat_completions_stream(model, messages, **kwargs):
            yield chunk

    @staticmethod
    def _extract_chat_content(data: dict) -> str:
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") in ("text", "output_text"):
                    texts.append(part.get("text", ""))
            return "\n".join([t for t in texts if t])
        return str(content)

    @classmethod
    def _extract_stream_content_text(cls, content) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in ("text", "output_text"):
                    text = str(part.get("text") or "")
                    if text:
                        texts.append(text)
            return "".join(texts)
        return ""

    @classmethod
    def _extract_chat_completion_delta_text(cls, data: dict) -> str:
        choice = (data.get("choices") or [{}])[0] or {}
        delta = choice.get("delta") if isinstance(choice, dict) else {}
        if isinstance(delta, dict):
            text = cls._extract_stream_content_text(delta.get("content"))
            if text:
                return text
        message = choice.get("message") if isinstance(choice, dict) else {}
        if isinstance(message, dict):
            return cls._extract_stream_content_text(message.get("content"))
        return ""

    @staticmethod
    def _extract_responses_payload_text(data: dict) -> str:
        texts = []
        candidates = []
        if isinstance(data, dict):
            candidates.append(data)
            response = data.get("response")
            if isinstance(response, dict):
                candidates.append(response)

        for candidate in candidates:
            for item in candidate.get("output", []) or []:
                if not isinstance(item, dict):
                    continue
                for part in item.get("content", []) or []:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") in ("output_text", "text") and part.get("text"):
                        texts.append(part["text"])
            output_text = candidate.get("output_text")
            if isinstance(output_text, str) and output_text.strip():
                texts.append(output_text)
            elif isinstance(output_text, list):
                for item in output_text:
                    if isinstance(item, str) and item.strip():
                        texts.append(item)
        return "".join(texts).strip()

    @classmethod
    def _extract_responses_text(cls, raw: str) -> str:
        stripped = (raw or "").strip()
        if not stripped:
            return ""
        if stripped[:1] in "{[":
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                pass
            else:
                return cls._extract_responses_payload_text(data)

        done_texts = []
        delta_texts = []
        response_texts = []
        for line in stripped.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                continue
            event_type = data.get("type")
            if event_type == "response.output_text.done":
                text = data.get("text") or ""
                if text:
                    done_texts.append(text)
                continue
            if event_type == "response.output_text.delta":
                text = data.get("delta") or ""
                if text:
                    delta_texts.append(text)
                continue
            response = data.get("response")
            if isinstance(response, dict):
                for item in response.get("output", []) or []:
                    for part in item.get("content", []) or []:
                        if part.get("type") in ("output_text", "text") and part.get("text"):
                            response_texts.append(part["text"])
        if done_texts:
            return "".join(done_texts).strip()
        if response_texts:
            return "".join(response_texts).strip()
        return "".join(delta_texts).strip()

    @staticmethod
    def _messages_to_responses_input(messages: list) -> list:
        converted = []
        for message in messages:
            role = message.get("role", "user")
            if role == "system":
                role = "developer"
            content = message.get("content", "")
            if isinstance(content, str):
                converted.append({"role": role, "content": content})
                continue
            parts = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    parts.append({"type": "input_text", "text": part.get("text", "")})
                elif part.get("type") == "image_url":
                    image_url = part.get("image_url", {})
                    url = image_url.get("url", "") if isinstance(image_url, dict) else ""
                    if url:
                        parts.append({"type": "input_image", "image_url": url})
            converted.append({"role": role, "content": parts or ""})
        return converted

    async def _responses_chat(self, model: str, messages: list, **kwargs) -> str:
        max_tokens = kwargs.pop("max_tokens", None) or kwargs.pop("max_completion_tokens", None)
        payload = {
            "model": model,
            "input": self._messages_to_responses_input(messages),
            "stream": False,
            "reasoning": {"effort": "none"},
            **kwargs,
        }
        if max_tokens:
            payload["max_output_tokens"] = max_tokens
        raw = await self._post_text("/responses", payload)
        text = self._extract_responses_text(raw)
        if text:
            return text
        preview = (raw or "").strip().replace("\n", "\\n")[:200]
        raise ValueError(
            f"Responses API 返回成功但未提取到文本（model={model}, api_format={self.api_format}, raw_len={len(raw or '')}, preview={preview!r})"
        )

    async def _responses_stream_chat(self, model: str, messages: list, **kwargs) -> AsyncIterator[str]:
        max_tokens = kwargs.pop("max_tokens", None) or kwargs.pop("max_completion_tokens", None)
        payload = {
            "model": model,
            "input": self._messages_to_responses_input(messages),
            "stream": True,
            "reasoning": {"effort": "none"},
            **kwargs,
        }
        if max_tokens:
            payload["max_output_tokens"] = max_tokens

        saw_delta = False
        async for line in self._stream_lines("/responses", payload):
            line = str(line or "").strip()
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if not raw or raw == "[DONE]":
                continue
            data = json.loads(raw)
            event_type = data.get("type")
            if event_type == "response.output_text.delta":
                text = str(data.get("delta") or "")
                if text:
                    saw_delta = True
                    yield text
                continue
            if event_type == "response.output_text.done":
                text = str(data.get("text") or "")
                if text and not saw_delta:
                    yield text
                continue
            if saw_delta:
                continue
            text = self._extract_responses_payload_text(data)
            if text:
                yield text

    async def _chat_completions_stream(self, model: str, messages: list, **kwargs) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            **kwargs,
        }
        async for line in self._stream_lines("/chat/completions", payload):
            line = str(line or "").strip()
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if not raw or raw == "[DONE]":
                continue
            data = json.loads(raw)
            text = self._extract_chat_completion_delta_text(data)
            if text:
                yield text

    @staticmethod
    def _extract_image_url_from_text(text: str) -> str:
        if not text:
            return ""
        patterns = [
            r"!\[[^\]]*\]\((https?://[^\s)]+)\)",
            r"(https?://[^\s]+(?:png|jpg|jpeg|webp))",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                return match.group(1)
        return ""

    async def _download_remote_image(self, url: str) -> bytes:
        async def operation() -> bytes:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.content

        return await self._run_with_retries(operation)

    async def _extract_image_from_chat_response(self, data: dict) -> bytes:
        msg = data.get("choices", [{}])[0].get("message", {})
        images = msg.get("images", [])
        if images:
            url = images[0].get("image_url", {}).get("url", "")
            if url.startswith("data:image"):
                return base64.b64decode(url.split(",", 1)[1])
            if url.startswith("http"):
                return await self._download_remote_image(url)

        content = msg.get("content", [])
        if isinstance(content, str):
            image_url = self._extract_image_url_from_text(content)
            if image_url:
                return await self._download_remote_image(image_url)
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                image_url = part.get("image_url", {})
                url = image_url.get("url", "")
                if url.startswith("data:image"):
                    return base64.b64decode(url.split(",", 1)[1])
                if url.startswith("http"):
                    return await self._download_remote_image(url)
                b64 = part.get("b64_json")
                if b64:
                    return base64.b64decode(b64)
                text = part.get("text", "")
                remote_url = self._extract_image_url_from_text(text)
                if remote_url:
                    return await self._download_remote_image(remote_url)

        raise ValueError("画图模型未返回可解析的图片数据")

    async def _extract_image_from_images_response(self, resp) -> bytes:
        data = getattr(resp, "data", None) or []
        if not data:
            raise ValueError("画图模型未返回图片数据")
        first = data[0]
        b64_json = getattr(first, "b64_json", None)
        if b64_json:
            return base64.b64decode(b64_json)

        image_url = getattr(first, "url", None)
        if isinstance(image_url, str):
            if image_url.startswith("data:image"):
                return base64.b64decode(image_url.split(",", 1)[1])
            if image_url.startswith("http"):
                return await self._download_remote_image(image_url)

        raise ValueError("画图模型未返回可解析的图片数据")

    @staticmethod
    def _compose_generation_text(prompt: PromptSet) -> tuple[str, bool, str]:
        positive = (prompt.positive_prompt or "").strip()
        negative = (prompt.negative_prompt or "").strip()
        if not negative:
            return positive, False, "not_provided"
        combined = f"{positive}\n\n负向约束：{negative}"
        return combined, True, "embedded_text"

    @staticmethod
    def _prefers_images_endpoint(model: str) -> bool:
        model_name = (model or "").strip().lower()
        return model_name.startswith(("dall-e-2", "dall-e-3", "gpt-image-"))

    async def _generate_with_images_endpoint(
        self,
        *,
        model: str,
        prompt_text: str,
        prompt: PromptSet,
        negative_applied: bool,
        negative_mode: str,
    ) -> NormalizedImage:
        async def operation():
            return await self.client.images.generate(
                model=model,
                prompt=prompt_text,
                response_format="b64_json",
                n=1,
            )

        resp = await self._run_with_retries(operation)
        image_bytes = await self._extract_image_from_images_response(resp)
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

    async def _edit_with_images_endpoint(
        self,
        *,
        model: str,
        prompt_text: str,
        prompt: PromptSet,
        negative_applied: bool,
        negative_mode: str,
    ) -> NormalizedImage:
        source_name = "reference_image" if prompt.reference_image else "floor_plan"
        image_bytes = prompt.reference_image if prompt.reference_image else prompt.floor_plan

        async def operation():
            image_file = BytesIO(image_bytes or b"")
            image_file.name = f"{source_name}.png"
            return await self.client.images.edit(
                model=model,
                prompt=prompt_text,
                image=image_file,
                response_format="b64_json",
                n=1,
            )

        resp = await self._run_with_retries(operation)
        return NormalizedImage(
            image_bytes=await self._extract_image_from_images_response(resp),
            source_model=model,
            generation_params={
                "prompt": prompt.positive_prompt,
                "negative_prompt": prompt.negative_prompt,
                "negative_prompt_applied": negative_applied,
                "negative_prompt_mode": negative_mode,
                "has_floor_plan": bool(prompt.floor_plan),
                "has_reference_image": bool(prompt.reference_image),
                "endpoint": "images.edit",
                "edit_image_source": source_name,
            },
        )

    async def generate(self, prompt: PromptSet) -> NormalizedImage:
        model = prompt.model_target or self.model
        prompt_text, negative_applied, negative_mode = self._compose_generation_text(prompt)
        content_parts = []
        if prompt.floor_plan:
            mime = self._guess_mime_type(prompt.floor_plan)
            b64 = base64.b64encode(prompt.floor_plan).decode()
            content_parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
        if prompt.reference_image:
            mime = self._guess_mime_type(prompt.reference_image)
            b64 = base64.b64encode(prompt.reference_image).decode()
            content_parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
        content_parts.append({"type": "text", "text": prompt_text})
        content = content_parts if len(content_parts) > 1 else prompt_text

        if not (prompt.floor_plan or prompt.reference_image) and self._prefers_images_endpoint(model):
            return await self._generate_with_images_endpoint(
                model=model,
                prompt_text=prompt_text,
                prompt=prompt,
                negative_applied=negative_applied,
                negative_mode=negative_mode,
            )

        if (prompt.floor_plan or prompt.reference_image) and self._prefers_images_endpoint(model):
            return await self._edit_with_images_endpoint(
                model=model,
                prompt_text=prompt_text,
                prompt=prompt,
                negative_applied=negative_applied,
                negative_mode=negative_mode,
            )

        # 画图模型走 SDK with_raw_response（需要读 images 字段）
        try:
            async def operation():
                return await self.client.chat.completions.with_raw_response.create(
                    model=model,
                    messages=[{"role": "user", "content": content}],
                )

            raw = await self._run_with_retries(operation)
            data = json.loads(raw.text)
            image_bytes = await self._extract_image_from_chat_response(data)
            return NormalizedImage(
                image_bytes=image_bytes,
                source_model=model,
                generation_params={
                    "prompt": prompt.positive_prompt,
                    "negative_prompt": prompt.negative_prompt,
                    "negative_prompt_applied": negative_applied,
                    "negative_prompt_mode": negative_mode,
                    "has_floor_plan": bool(prompt.floor_plan),
                    "has_reference_image": bool(prompt.reference_image),
                    "endpoint": "chat.completions",
                },
            )
        except Exception:
            # 兼容只支持 /images/generations 的供应商；带参考图/平面图时不能降级，否则会丢失输入约束。
            if prompt.floor_plan or prompt.reference_image:
                raise

        return await self._generate_with_images_endpoint(
            model=model,
            prompt_text=prompt_text,
            prompt=prompt,
            negative_applied=negative_applied,
            negative_mode=negative_mode,
        )

    async def analyze(self, image_bytes: bytes, prompt: str) -> str:
        mime = self._guess_mime_type(image_bytes)
        b64 = base64.b64encode(image_bytes).decode()
        messages = [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": prompt},
            ],
        }]
        if self.api_format == "openai_responses":
            return await self._responses_chat(self.model, messages)

        data = await self._post("/chat/completions", {
            "model": self.model,
            "messages": messages,
        })
        return self._extract_chat_content(data)
