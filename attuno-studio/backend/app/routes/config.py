from fastapi import APIRouter, Depends, Form
from fastapi.responses import JSONResponse

from app_runtime import load_model_config_for_ui, save_model_config_to_files, verify_analysis_api, verify_image_api
from backend.app.services.auth_service import get_current_or_default_user, resolve_config_user_id

router = APIRouter(prefix="/api/config", tags=["config"])


def error_response(stage: str, message: str):
    return JSONResponse(status_code=400, content={"ok": False, "stage": stage, "error": message})


@router.post("/verify-analysis")
def verify_analysis(
    user=Depends(get_current_or_default_user),
    provider_name: str = Form(""),
    api_format: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
):
    try:
        message = verify_analysis_api(provider_name, api_format, base_url, api_key, model, user_id=resolve_config_user_id(user))
        return {"ok": True, "message": message}
    except Exception as exc:
        return error_response("verify-analysis", str(exc))


@router.get("")
def load_config(user=Depends(get_current_or_default_user)):
    try:
        return {"ok": True, "config": load_model_config_for_ui(resolve_config_user_id(user))}
    except Exception as exc:
        return error_response("load", str(exc))


@router.post("/verify-image")
def verify_image(
    user=Depends(get_current_or_default_user),
    provider_name: str = Form(""),
    api_format: str = Form(""),
    base_url: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
):
    try:
        message = verify_image_api(provider_name, api_format, base_url, api_key, model, user_id=resolve_config_user_id(user))
        return {"ok": True, "message": message}
    except Exception as exc:
        return error_response("verify-image", str(exc))


@router.post("/save")
def save_config(
    user=Depends(get_current_or_default_user),
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
    floor_analysis_system_prompt: str = Form(""),
    prompt_gen_system_3d_cn: str = Form(""),
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
            floor_analysis_system_prompt,
            prompt_gen_system_3d_cn,
            fallback_models_text,
            model_switch_after_failures,
            stop_after_last_model_failures,
            user_id=resolve_config_user_id(user),
        )
        return {"ok": True, "message": message}
    except Exception as exc:
        return error_response("save", str(exc))
