import nest_asyncio
nest_asyncio.apply()
import asyncio
from io import BytesIO
import os
import sys
from queue import Queue
from threading import Thread
import time
import traceback
from typing import Optional, Any, List
from PIL import Image

if os.name == "nt":
    # Avoid startup hangs when Python's optional _wmi module cannot query Windows metadata.
    sys.modules.setdefault("_wmi", None)

import gradio as gr
import httpx
from config import (
    load_config,
    AppConfig,
    AdapterConfig,
    COMMON_API_FORMAT_CHOICES,
    API_FORMAT_LABELS,
    SUPPORTED_API_FORMATS,
    normalize_api_format,
    describe_adapter_capabilities,
    adapter_supports_image_inputs,
)
from adapters import build_adapter
from pipeline import PipelineFactory
from models.schemas import GenerationMode
from models.schemas import PromptSet

API_FORMAT_HELP = (
    "API格式是请求/响应协议，不是供应商名称。当前支持："
    "OpenAI、OpenAI-Response、Gemini、Anthropic、Azure OpenAI、Ollama、Custom。"
    "当前实现里，除 Anthropic 外其余常用项均按 OpenAI 兼容方式接入。"
)
UI_API_FORMAT_CHOICES = (("使用 config.json", ""), *COMMON_API_FORMAT_CHOICES)

def get_config() -> AppConfig:
    try:
        return load_config("config.json")
    except Exception as e:
        raise gr.Error(f"配置文件加载失败：{e}")


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


def _preview_uploaded_floor_plans(files: Any):
    return _to_path_list(files)


def _select_gallery_preview(gallery_items: Any, evt: gr.SelectData):
    if not gallery_items:
        return None
    index = getattr(evt, "index", None)
    if index is None or not isinstance(index, int) or index < 0 or index >= len(gallery_items):
        return None
    item = gallery_items[index]
    if isinstance(item, (list, tuple)) and item:
        return item[0]
    if isinstance(item, dict):
        return item.get("image") or item.get("path") or item.get("url")
    return item


RESULT_IMAGE_HELPER_HTML = """
<script>
(() => {
  const bindResultPreview = () => {
    const root = document.querySelector('#result-main-image');
    if (!root) return;
    const img = root.querySelector('img');
    if (!img || img.dataset.codexBound === '1') return;
    img.dataset.codexBound = '1';
    img.title = '双击可放大预览';
    img.addEventListener('dblclick', async () => {
      const target = img.closest('[data-testid=\"image\"]') || img;
      if (target && target.requestFullscreen) {
        try {
          await target.requestFullscreen();
        } catch (err) {
          console.warn('fullscreen failed', err);
        }
      }
    });
  };

  const observer = new MutationObserver(bindResultPreview);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(bindResultPreview, 300);
})();
</script>
"""


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


def _validate_adapter_config(name: str, cfg: AdapterConfig):
    api_format = normalize_api_format(getattr(cfg, "api_format", "") or cfg.provider or "")
    if not api_format:
        raise gr.Error(f"{name} 配置缺少 API 格式")
    if api_format not in SUPPORTED_API_FORMATS:
        label = API_FORMAT_LABELS.get(api_format, api_format)
        raise gr.Error(
            f"{name} 暂未实现 {label} 原生适配。"
            "当前可用：OpenAI、OpenAI-Response、Gemini、Anthropic、Azure OpenAI、Ollama、Custom。"
        )
    if not (cfg.model or "").strip():
        raise gr.Error(f"{name} 配置缺少 model")
    if not (cfg.api_key or "").strip():
        raise gr.Error(f"{name} 配置缺少 API Key。请在 UI 中填写，或在 .env 中设置对应变量。")


def save_api_keys_to_env(analysis_api_key, img_api_key):
    env_path = ".env"
    current = {}
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                k, v = raw.split("=", 1)
                current[k.strip()] = v.strip()

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

    with open(env_path, "w", encoding="utf-8") as f:
        for k in sorted(current.keys()):
            f.write(f"{k}={current[k]}\n")

    msg = []
    if llm_key:
        msg.append("LLM/Vision")
    if image_key:
        msg.append("Image")
    return f"已保存到 .env：{', '.join(msg)}"


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
) -> AppConfig:
    cfg = get_config()
    cfg.max_iterations = int(max_iterations)

    analysis_cfg = _merge_adapter_override(
        cfg.llm,
        analysis_provider_name,
        analysis_api_format,
        analysis_base_url or "",
        analysis_api_key or "",
        analysis_model or "",
    )
    cfg.llm = analysis_cfg
    cfg.vision = analysis_cfg

    cfg.image_gen = _merge_adapter_override(
        cfg.image_gen,
        img_provider_name,
        img_api_format,
        img_base_url or "",
        img_api_key or "",
        img_model or "",
    )

    _validate_adapter_config("分析/提示词模型", cfg.llm)
    _validate_adapter_config("图像分析模型", cfg.vision)
    _validate_adapter_config("画图模型", cfg.image_gen)

    fallback_models = []
    for item in str(fallback_models_text or "").replace("\r", "\n").replace(",", "\n").split("\n"):
        model_name = item.strip()
        if model_name and model_name != cfg.image_gen.model:
            fallback_models.append(model_name)
    cfg.image_model_fallbacks = fallback_models or list(cfg.image_model_fallbacks or [])
    cfg.model_switch_after_failures = max(1, int(model_switch_after_failures))
    cfg.stop_after_last_model_failures = max(1, int(stop_after_last_model_failures))
    return cfg


def _build_analysis_adapter_config(
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
) -> AdapterConfig:
    cfg = get_config()
    analysis_cfg = _merge_adapter_override(
        cfg.llm,
        analysis_provider_name,
        analysis_api_format,
        analysis_base_url or "",
        analysis_api_key or "",
        analysis_model or "",
    )
    _validate_adapter_config("分析/提示词模型", analysis_cfg)
    return analysis_cfg


def _build_image_adapter_config(
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
) -> AdapterConfig:
    cfg = get_config()
    image_cfg = _merge_adapter_override(
        cfg.image_gen,
        img_provider_name,
        img_api_format,
        img_base_url or "",
        img_api_key or "",
        img_model or "",
    )
    _validate_adapter_config("画图模型", image_cfg)
    return image_cfg


def verify_analysis_api(
    analysis_provider_name,
    analysis_api_format,
    analysis_base_url,
    analysis_api_key,
    analysis_model,
):
    analysis_cfg = _build_analysis_adapter_config(
        analysis_provider_name,
        analysis_api_format,
        analysis_base_url,
        analysis_api_key,
        analysis_model,
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
            return (
                f"分析模型可用\n"
                f"供应商：{analysis_cfg.provider_name}\n"
                f"格式：{_display_api_format(analysis_cfg.api_format)}\n"
                f"模型：{analysis_cfg.model}\n"
                f"响应：{ok_text}"
            )
        except Exception as e:
            return (
                f"分析模型不可用\n"
                f"供应商：{analysis_cfg.provider_name}\n"
                f"格式：{_display_api_format(analysis_cfg.api_format)}\n"
                f"模型：{analysis_cfg.model}\n"
                f"错误：{e}"
            )

    return asyncio.run(_verify())


def verify_image_api(
    img_provider_name,
    img_api_format,
    img_base_url,
    img_api_key,
    img_model,
):
    image_cfg = _build_image_adapter_config(
        img_provider_name,
        img_api_format,
        img_base_url,
        img_api_key,
        img_model,
    )
    capabilities = describe_adapter_capabilities(image_cfg, image_cfg.model)
    test_prompt = (
        "Draw a Hello Kitty character on a plain background, "
        "full body, clear subject, simple composition, no text, no watermark."
    )

    async def _verify():
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
            return (
                f"画图模型可用\n"
                f"供应商：{image_cfg.provider_name}\n"
                f"格式：{_display_api_format(image_cfg.api_format)}\n"
                f"模型：{image_cfg.model}\n"
                f"支持平面图/参考图输入：{'是' if capabilities['supports_image_inputs'] else '否'}\n"
                f"支持原生负向提示词：{'是' if capabilities['supports_negative_prompt'] else '否'}\n"
                f"测试提示词：{test_prompt}\n"
                f"负向提示词处理：{generated.generation_params.get('negative_prompt_mode', 'unknown')}\n"
                f"返回图片字节：{len(generated.image_bytes)}"
            )
        except Exception as e:
            return (
                f"画图模型不可用\n"
                f"供应商：{image_cfg.provider_name}\n"
                f"格式：{_display_api_format(image_cfg.api_format)}\n"
                f"模型：{image_cfg.model}\n"
                f"支持平面图/参考图输入：{'是' if capabilities['supports_image_inputs'] else '否'}\n"
                f"支持原生负向提示词：{'是' if capabilities['supports_negative_prompt'] else '否'}\n"
                f"测试提示词：{test_prompt}\n"
                f"错误：{e}"
            )

    return asyncio.run(_verify())


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
    progress=gr.Progress(),
):
    user_requirement = user_requirement or ""
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

    if generation_mode == GenerationMode.STANDARD and not reference_image_path and not manual_prompt.strip() and not user_requirement.strip():
        error = "执行失败：常规生图请至少提供设计需求、手动提示词或参考图"
        yield None, [], error, "", "", "", error
        return

    if not user_requirement.strip() and not manual_prompt.strip() and not reference_image_path:
        error = "执行失败：请输入设计需求或手动提示词"
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
        )
    except Exception as e:
        error = f"执行失败：{type(e).__name__}: {e}"
        yield None, [], error, "", "", "", error
        return

    model_queue = [cfg.image_gen.model] + list(cfg.image_model_fallbacks or [])
    requires_image_inputs = bool(reference_image_path or floor_plan_paths)
    if requires_image_inputs:
        compatible_models = [model_name for model_name in model_queue if adapter_supports_image_inputs(cfg.image_gen, model_name)]
        if not compatible_models:
            error = (
                "执行失败：画图阶段没有兼容当前输入约束的模型。"
                f"当前模型链：{', '.join(model_queue)}；"
                "当前输入包含平面图或参考图，但这些模型不支持多模态约束。"
            )
            yield None, [], error, "", "", "", error
            return

    if generation_mode == GenerationMode.RENDER3D and not floor_plan_paths:
        append_log("[提示] 3D 模式未上传平面图，将按需求进行3D生成（无法执行平面一致性约束）。")
        yield snapshot()

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
            run_paths = (floor_plan_paths or [None]) if generation_mode == GenerationMode.RENDER3D else [None]
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
                        on_progress=on_progress,
                        on_event=on_event,
                        manual_prompt=manual_prompt.strip() or None,
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
            floor_text = payload.get("text") or "常规模式未启用平面图解析"
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
            append_log(f"[图片已生成] 第{payload.get('iteration', 1)}轮图片已生成，等待评估。")
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
            for iter_idx, (image_path, score) in enumerate(zip(result.iteration_image_paths, result.all_scores)):
                label = f"{result.mode} 图{payload['path_index']} 第{iter_idx + 1}轮 {score:.1f}分"
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


def launch_with_fallback():
    host = os.environ.get("APP_HOST", "127.0.0.1")
    start_port = int(os.environ.get("APP_PORT", "7860"))
    max_tries = int(os.environ.get("APP_PORT_TRIES", "10"))

    last_err = None
    for offset in range(max_tries):
        port = start_port + offset
        print(f"[INFO] Trying to start on {host}:{port} ...")
        launch_err = None

        try:
            demo.launch(server_name=host, server_port=port, prevent_thread_lock=True, show_error=True)
        except Exception as e:
            launch_err = e
            msg = str(e)
            if "Cannot find empty port" in msg or "Address already in use" in msg:
                print(f"[WARN] Port {port} is busy, trying next port.")
                last_err = e
                continue
            if "startup-events" not in msg:
                raise
            print(f"[WARN] Gradio startup self-check failed on {port}: {e}")
            print("[WARN] Continue probing local server availability...")

        url = f"http://{host}:{port}/"
        ready = False
        probe_client = httpx.Client(trust_env=False)
        for _ in range(20):
            try:
                resp = probe_client.get(url, timeout=1.5)
                if resp.status_code < 500:
                    ready = True
                    break
            except Exception:
                pass
            time.sleep(0.5)
        probe_client.close()

        if ready:
            print(f"[INFO] App is running: {url}")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                print("\n[INFO] App stopped.")
            return

        last_err = launch_err or RuntimeError(f"服务未就绪：{url}")
        print(f"[WARN] Startup probe failed on {port}, trying next port.")

    raise RuntimeError(f"无法启动服务，已尝试端口范围 {start_port}-{start_port + max_tries - 1}") from last_err


with gr.Blocks(title="3D Render Agent") as demo:
    gr.Markdown("# 3D 效果图生成智能体")
    gr.HTML(RESULT_IMAGE_HELPER_HTML)

    with gr.Row():
        with gr.Column(scale=1):
            mode = gr.Radio(
                choices=[("方案A：常规生图", GenerationMode.STANDARD.value), ("方案B：3D效果图", GenerationMode.RENDER3D.value)],
                value=GenerationMode.RENDER3D.value,
                label="生成方案",
            )
            floor_plan = gr.File(label="平面图（可多选）", file_count="multiple", file_types=["image"])
            floor_plan_preview = gr.Gallery(
                label="已上传平面图预览",
                columns=2,
                height=220,
                allow_preview=True,
                preview=True,
                type="filepath",
                object_fit="contain",
                buttons=["download", "fullscreen"],
            )
            reference_image = gr.Image(
                label="参考图（可选，图生图）",
                type="filepath",
                sources=["upload", "clipboard"],
                height=220,
                buttons=["download", "fullscreen"],
            )
            requirement = gr.Textbox(label="设计需求（自然语言）", lines=3, placeholder="例如：现代新中式风格，西南45度鸟瞰")
            manual_prompt = gr.Textbox(label="手动提示词（填写后直接使用，跳过自动生成）", lines=8, placeholder="可选：直接粘贴你的完整中文提示词")
            max_iter = gr.Slider(1, 5, value=3, step=1, label="最大迭代次数")

            with gr.Accordion("自定义模型配置（可选，留空则使用 config.json）", open=False):
                gr.Markdown("**分析平面图 + 提示词模型（LLM/Vision）**")
                gr.Markdown(API_FORMAT_HELP)
                analysis_provider_name = gr.Textbox(
                    label="供应商名称（可自定义，仅用于显示和备注）",
                    placeholder="例如：NewCLI、OpenAI、Anthropic、Fc-gpt",
                )
                analysis_api_format = gr.Dropdown(
                    choices=UI_API_FORMAT_CHOICES,
                    value="",
                    label="API格式（协议/请求格式）",
                    allow_custom_value=False,
                )
                analysis_base_url = gr.Textbox(label="Base URL", placeholder="https://code.newcli.com/codex/v1")
                analysis_api_key = gr.Textbox(label="API Key", placeholder="sk-...", type="password")
                analysis_model = gr.Textbox(label="模型名称", placeholder="gpt-4o")

                gr.Markdown("**画图模型（Image）**")
                img_provider_name = gr.Textbox(
                    label="画图供应商名称（可自定义，仅用于显示和备注）",
                    placeholder="例如：BLTCY、OpenAI、Azure、Ollama",
                )
                img_api_format = gr.Dropdown(
                    choices=UI_API_FORMAT_CHOICES,
                    value="",
                    label="画图API格式（协议/请求格式）",
                    allow_custom_value=False,
                )
                img_base_url = gr.Textbox(label="画图 Base URL", placeholder="https://api.bltcy.ai/v1")
                img_api_key = gr.Textbox(label="画图 API Key", placeholder="sk-...", type="password")
                img_model = gr.Textbox(label="画图模型名称", placeholder="gpt-image-2")
                fallback_models_text = gr.Textbox(
                    label="备用画图模型（逗号或换行分隔，可选）",
                    lines=3,
                    placeholder="dall-e-3",
                )
                model_switch_after_failures = gr.Slider(
                    minimum=1,
                    maximum=4,
                    value=2,
                    step=1,
                    label="连续失败几轮后切换模型",
                )
                stop_after_last_model_failures = gr.Slider(
                    minimum=1,
                    maximum=4,
                    value=2,
                    step=1,
                    label="最后一个模型连续失败几轮后停止",
                )
            submit_btn = gr.Button("开始生成", variant="primary")
            with gr.Row():
                save_keys_btn = gr.Button("保存当前 API Key 到本地 .env")
                verify_analysis_btn = gr.Button("验证分析模型")
                verify_image_btn = gr.Button("验证画图模型")
            api_action_status = gr.Textbox(label="API 配置状态", lines=4, interactive=False)

        with gr.Column(scale=1):
            current_output_image = gr.Image(
                label="当前大图预览（双击可放大）",
                interactive=False,
                buttons=["download", "fullscreen"],
                elem_id="result-main-image",
                height=420,
            )
            with gr.Row():
                copy_current_image_btn = gr.Button("复制当前大图")
                copy_status = gr.Textbox(label="图片操作", lines=1, interactive=False)
            output_image = gr.Gallery(
                label="生成结果缩略图",
                columns=2,
                allow_preview=True,
                preview=True,
                type="filepath",
                object_fit="contain",
                buttons=["download", "fullscreen"],
                height=260,
            )
            status_text = gr.Textbox(label="状态", interactive=False)
            floor_desc_output = gr.Textbox(label="平面图解析结果", lines=6, interactive=False)
            prompt_output = gr.Textbox(label="当前/最终提示词", lines=16, interactive=False)
            eval_report = gr.Textbox(label="评估报告", lines=10, interactive=False)
            log_output = gr.Textbox(label="执行日志", lines=6, interactive=False)

    submit_btn.click(
        fn=run_pipeline,
        inputs=[
            mode,
            floor_plan,
            reference_image,
            requirement,
            manual_prompt,
            max_iter,
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
        ],
        outputs=[current_output_image, output_image, status_text, floor_desc_output, prompt_output, eval_report, log_output],
    )

    floor_plan.change(
        fn=_preview_uploaded_floor_plans,
        inputs=[floor_plan],
        outputs=[floor_plan_preview],
        queue=False,
    )

    output_image.select(
        fn=_select_gallery_preview,
        inputs=[output_image],
        outputs=[current_output_image],
        queue=False,
    )

    copy_current_image_btn.click(
        fn=None,
        inputs=[],
        outputs=[copy_status],
        queue=False,
        js="""
        async () => {
            const img = document.querySelector('#result-main-image img');
            if (!img) {
                return '当前没有可复制的图片';
            }
            const src = img.currentSrc || img.src;
            if (!src) {
                return '当前没有可复制的图片';
            }
            if (!navigator.clipboard || !window.ClipboardItem) {
                return '当前浏览器不支持直接复制图片，请使用右键复制';
            }
            try {
                const response = await fetch(src);
                const blob = await response.blob();
                await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
                return '已复制当前大图到剪贴板';
            } catch (err) {
                return `复制失败：${err?.message || err}`;
            }
        }
        """,
    )

    save_keys_btn.click(
        fn=save_api_keys_to_env,
        inputs=[analysis_api_key, img_api_key],
        outputs=[api_action_status],
    )

    verify_analysis_btn.click(
        fn=verify_analysis_api,
        inputs=[
            analysis_provider_name,
            analysis_api_format,
            analysis_base_url,
            analysis_api_key,
            analysis_model,
        ],
        outputs=[api_action_status],
    )

    verify_image_btn.click(
        fn=verify_image_api,
        inputs=[
            img_provider_name,
            img_api_format,
            img_base_url,
            img_api_key,
            img_model,
        ],
        outputs=[api_action_status],
    )

if __name__ == "__main__":
    demo.queue(default_concurrency_limit=2)
    launch_with_fallback()
