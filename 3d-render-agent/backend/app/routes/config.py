from fastapi import APIRouter, Form
from fastapi.responses import JSONResponse

from app_runtime import save_model_config_to_files, verify_analysis_api, verify_image_api

router = APIRouter(prefix="/api/config", tags=["config"])


def error_response(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})


@router.post("/verify-analysis")
def verify_analysis(
    provider_name: str = Form(""),
    api_format: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
):
    try:
        message = verify_analysis_api(provider_name, api_format, base_url, api_key, model)
        return {"ok": True, "message": message}
    except Exception as exc:
        return error_response("verify-analysis", str(exc))


@router.post("/verify-image")
def verify_image(
    provider_name: str = Form(""),
    api_format: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
):
    try:
        message = verify_image_api(provider_name, api_format, base_url, api_key, model)
        return {"ok": True, "message": message}
    except Exception as exc:
        return error_response("verify-image", str(exc))


@router.post("/save")
def save_config(
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
):
    try:
        message = save_model_config_to_files(
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
        return {"ok": True, "message": message}
    except Exception as exc:
        return error_response("save", str(exc))
