"""
手工联调脚本（需要真实 API Key 与计费环境）：
  Step 1 - LLM 连通性（需求解析）
  Step 2 - 提示词生成
  Step 3 - 画图
  Step 4 - 图像评估
  Step 5 - 完整 pipeline
"""
__test__ = False

import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from config import load_config
from adapters import build_adapter
from agents import RequirementParser, PromptGenerator, ImageEvaluator, ErrorRouter
from pipeline import PipelineFactory
from models.schemas import GenerationMode

# 用一张纯色小图模拟平面图
def make_dummy_floor_plan() -> bytes:
    from PIL import Image
    import io
    img = Image.new("RGB", (200, 200), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def test_llm(cfg):
    print("\n=== Step 1: LLM 连通性 ===")
    llm = build_adapter(cfg.llm, "llm")
    resp = await llm.chat([{"role": "user", "content": "回复 OK"}])
    print("LLM 响应:", resp[:100])


async def test_parser(cfg):
    print("\n=== Step 2: 需求解析 ===")
    llm = build_adapter(cfg.llm, "llm")
    parser = RequirementParser(llm)
    req = await parser.parse("现代简约风格客厅，暖色调，大落地窗，不要宫廷元素", "")
    print("解析结果:", req.model_dump())
    return req


async def test_prompt_gen(cfg, req):
    print("\n=== Step 3: 提示词生成 ===")
    llm = build_adapter(cfg.llm, "llm")
    gen = PromptGenerator(llm)
    prompt = await gen.generate(req, target_model="gemini-image")
    print("正向提示词:", prompt.positive_prompt[:200])
    print("负向提示词:", prompt.negative_prompt[:100])
    return prompt


async def test_image_gen(cfg, prompt):
    print("\n=== Step 4: 画图 ===")
    img_adapter = build_adapter(cfg.image_gen, "image")
    image = await img_adapter.generate(prompt)
    print(f"图像大小: {len(image.image_bytes)} bytes，模型: {image.source_model}")
    # 保存到本地
    with open("test_output.png", "wb") as f:
        f.write(image.image_bytes)
    print("已保存到 test_output.png")
    return image


async def test_evaluator(cfg, image, req):
    print("\n=== Step 5: 图像评估 ===")
    vision = build_adapter(cfg.vision, "vision")
    evaluator = ImageEvaluator(vision, cfg.quality_threshold)
    result = await evaluator.evaluate(image, req)
    print(f"总分: {result.total_score}，通过: {result.passed}")
    for d in result.dimensions:
        print(f"  {d.name}: {d.score} - {d.comment}")
    return result


async def test_full_pipeline(cfg):
    print("\n=== Step 6: 完整 Pipeline ===")
    pipeline = PipelineFactory.create(GenerationMode.RENDER3D, cfg)
    floor_plan = make_dummy_floor_plan()

    def on_progress(step, detail=""):
        print(f"  [{step}] {detail}")

    result = await pipeline.run(floor_plan, None, "现代简约风格客厅，暖色调，大落地窗", on_progress)
    print(f"\n状态: {result.status}")
    print(f"停止原因: {result.stop_reason}")
    print(f"最终模型: {result.final_model}")
    print(f"评分: {result.quality_score}")
    print(f"迭代次数: {result.iteration_count}")
    if result.final_image:
        with open("final_output.png", "wb") as f:
            f.write(result.final_image)
        print("最终图像已保存到 final_output.png")


async def main():
    cfg = load_config("config.json")

    try:
        await test_llm(cfg)
    except Exception as e:
        print(f"[FAIL] LLM: {e}")
        return

    try:
        req = await test_parser(cfg)
    except Exception as e:
        print(f"[FAIL] Parser: {e}")
        return

    try:
        prompt = await test_prompt_gen(cfg, req)
    except Exception as e:
        print(f"[FAIL] PromptGen: {e}")
        return

    try:
        image = await test_image_gen(cfg, prompt)
    except Exception as e:
        print(f"[FAIL] ImageGen: {e}")
        return

    try:
        await test_evaluator(cfg, image, req)
    except Exception as e:
        print(f"[FAIL] Evaluator: {e}")
        return

    await test_full_pipeline(cfg)


if __name__ == "__main__":
    asyncio.run(main())
