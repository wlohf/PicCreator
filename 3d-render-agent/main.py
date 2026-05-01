import os
import sys
import time
from typing import Any, List, Optional

if os.name == "nt":
    # Avoid startup hangs when Python's optional _wmi module cannot query Windows metadata.
    sys.modules.setdefault("_wmi", None)

import gradio as gr
import httpx
from models.schemas import GenerationMode

from app_runtime import (
    API_FORMAT_HELP,
    UI_API_FORMAT_CHOICES,
    run_pipeline,
    save_api_keys_to_env,
    verify_analysis_api,
    verify_image_api,
)

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
