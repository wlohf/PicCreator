from abc import ABC, abstractmethod
from models.schemas import PromptSet, NormalizedImage


class BaseLLMAdapter(ABC):
    @abstractmethod
    async def chat(self, messages: list, **kwargs) -> str: ...


class BaseImageAdapter(ABC):
    @abstractmethod
    async def generate(self, prompt: PromptSet) -> NormalizedImage: ...


class BaseVisionAdapter(ABC):
    @abstractmethod
    async def analyze(self, image_bytes: bytes, prompt: str) -> str: ...
