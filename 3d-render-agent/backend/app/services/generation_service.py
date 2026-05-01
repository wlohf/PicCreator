import tempfile
from pathlib import Path

from fastapi.responses import JSONResponse

from app_runtime import run_pipeline
from backend.app.schemas.generation import GenerateForm
from backend.app.services.file_service import image_record, save_uploads


class NoopProgress:
    def __call__(self, *_args, **_kwargs):
        return None


async def generate_render(form: GenerateForm):
    temp_dir = tempfile.TemporaryDirectory(prefix="render-agent-api-")
    try:
        floor_plan_paths = await save_uploads(form.floor_plans, Path(temp_dir.name))
        reference_path = None
        if form.reference_image is not None and form.reference_image.filename:
            reference_path = (await save_uploads([form.reference_image], Path(temp_dir.name)))[0]

        latest = None
        for snapshot in run_pipeline(
            form.mode,
            floor_plan_paths,
            reference_path,
            form.requirement,
            form.manual_prompt,
            form.max_iterations,
            form.analysis_provider_name,
            form.analysis_api_format,
            form.analysis_base_url,
            form.analysis_api_key,
            form.analysis_model,
            form.img_provider_name,
            form.img_api_format,
            form.img_base_url,
            form.img_api_key,
            form.img_model,
            form.fallback_models_text,
            form.model_switch_after_failures,
            form.stop_after_last_model_failures,
            progress=NoopProgress(),
        ):
            latest = snapshot

        if latest is None:
            return error_response("generation", "生成流程没有返回结果")

        current_preview, output_images, status_text, floor_desc, prompt_text, eval_report, logs = latest
        images = [image_record(path, label) for path, label in output_images if path]
        images = [image for image in images if image is not None]
        if not images and isinstance(current_preview, str):
            image = image_record(current_preview, "current_preview")
            if image:
                images.append(image)

        ok = not str(status_text or "").startswith("执行失败")
        if not ok:
            return error_response("generation", status_text or logs or "生成失败")
        return {
            "ok": ok,
            "status": status_text,
            "floor_desc": floor_desc,
            "prompt": prompt_text,
            "evaluation": eval_report,
            "logs": logs,
            "images": images,
        }
    except Exception as exc:
        return error_response("generation", f"{type(exc).__name__}: {exc}")
    finally:
        temp_dir.cleanup()


def error_response(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})
