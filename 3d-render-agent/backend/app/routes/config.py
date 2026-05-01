from fastapi import APIRouter, Form
from fastapi.responses import JSONResponse

from app_runtime import verify_analysis_api, verify_image_api

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
