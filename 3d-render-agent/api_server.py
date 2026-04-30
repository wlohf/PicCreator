import base64
import mimetypes
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from main import run_pipeline, verify_analysis_api, verify_image_api
from models.schemas import GenerationMode


app = FastAPI(title="3D Render Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5174", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "3d-render-agent-api"}


@app.post("/api/config/verify-analysis")
def verify_analysis(
    provider_name: str = Form(""),
    api_format: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
):
    return {"ok": True, "message": verify_analysis_api(provider_name, api_format, base_url, api_key, model)}


@app.post("/api/config/verify-image")
def verify_image(
    provider_name: str = Form(""),
    api_format: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
):
    return {"ok": True, "message": verify_image_api(provider_name, api_format, base_url, api_key, model)}


@app.post("/api/generate")
async def generate(
    mode: str = Form(GenerationMode.RENDER3D.value),
    requirement: str = Form(""),
    manual_prompt: str = Form(""),
    max_iterations: int = Form(3),
    analysis_provider_name: str = Form(""),
    analysis_api_format: str = Form(""),
    analysis_base_url: str = Form(""),
    analysis_api_key: str = Form(""),
    analysis_model: str = Form(""),
    img_provider_name: str = Form(""),
    img_api_format: str = Form(""),
    img_base_url: str = Form(""),
    img_api_key: str = Form(""),
    img_model: str = Form(""),
    fallback_models_text: str = Form(""),
    model_switch_after_failures: int = Form(2),
    stop_after_last_model_failures: int = Form(2),
    floor_plans: Optional[list[UploadFile]] = File(None),
    reference_image: Optional[UploadFile] = File(None),
):
    temp_dir = tempfile.TemporaryDirectory(prefix="render-agent-api-")
    try:
        floor_plan_paths = await _save_uploads(floor_plans or [], Path(temp_dir.name))
        reference_path = None
        if reference_image is not None and reference_image.filename:
            reference_path = (await _save_uploads([reference_image], Path(temp_dir.name)))[0]

        latest = None
        for snapshot in run_pipeline(
            mode,
            floor_plan_paths,
            reference_path,
            requirement,
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
            fallback_models_text,
            model_switch_after_failures,
            stop_after_last_model_failures,
            progress=_NoopProgress(),
        ):
            latest = snapshot

        if latest is None:
            return _error("generation", "生成流程没有返回结果")

        current_preview, output_images, status_text, floor_desc, prompt_text, eval_report, logs = latest
        images = [_image_record(path, label) for path, label in output_images if path]
        images = [image for image in images if image is not None]
        if not images and isinstance(current_preview, str):
            image = _image_record(current_preview, "current_preview")
            if image:
                images.append(image)

        ok = not str(status_text or "").startswith("执行失败")
        if not ok:
            return _error("generation", status_text or logs or "生成失败")
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
        return _error("generation", f"{type(exc).__name__}: {exc}")
    finally:
        temp_dir.cleanup()


async def _save_uploads(files: list[UploadFile], target_dir: Path) -> list[str]:
    paths: list[str] = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, upload in enumerate(files):
        suffix = Path(upload.filename or "").suffix or ".png"
        path = target_dir / f"upload_{index}{suffix}"
        path.write_bytes(await upload.read())
        paths.append(str(path))
    return paths


def _image_record(path: str, label: str):
    image_path = Path(path)
    if not image_path.exists():
        return None
    mime_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
    data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return {
        "label": label,
        "filename": image_path.name,
        "data_url": f"data:{mime_type};base64,{data}",
    }


def _error(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})


class _NoopProgress:
    def __call__(self, *_args, **_kwargs):
        return None


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("API_HOST", "127.0.0.1")
    port = int(os.environ.get("API_PORT", "8787"))
    uvicorn.run(app, host=host, port=port)
