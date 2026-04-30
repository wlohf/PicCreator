import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from config import load_config
from adapters import build_adapter
from models.schemas import PromptSet

async def main():
    cfg = load_config("config.json")
    img_adapter = build_adapter(cfg.image_gen, "image")
    prompt = PromptSet(
        positive_prompt="A modern living room, warm tones, floor-to-ceiling windows",
        negative_prompt="baroque, ornate",
        model_target="gemini-image"
    )
    resp = await img_adapter.client.chat.completions.create(
        model=img_adapter.model,
        messages=[{"role": "user", "content": prompt.positive_prompt}],
    )
    print("=== 完整响应 ===")
    print(repr(resp))
    print("\n=== choices[0] ===")
    print(repr(resp.choices[0]))
    print("\n=== message ===")
    msg = resp.choices[0].message
    print("content type:", type(msg.content))
    print("content:", repr(msg.content))
    if hasattr(msg, '__dict__'):
        print("message dict:", msg.__dict__)

asyncio.run(main())
