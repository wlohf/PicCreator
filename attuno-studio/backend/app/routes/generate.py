from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile

from backend.app.schemas.generation import GenerateForm
from backend.app.services.auth_service import get_current_or_default_user, resolve_config_user_id
from backend.app.services.generation_service import generate_render, stream_generate_render
from backend.app.services.preferences_store import load_style_profile
from models.schemas import GenerationMode

router = APIRouter(prefix="/api", tags=["generation"])


@router.post("/generate")
async def generate(
    user=Depends(get_current_or_default_user),
    project_id: str = Form("default"),
    mode: str = Form(GenerationMode.STANDARD.value),
    requirement: str = Form(""),
    direction_stack_text: str = Form(""),
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
    enable_quality_evaluation: bool = Form(False),
    floor_plans: Optional[list[UploadFile]] = File(None),
):
    form = GenerateForm(
        user_id=user["user_id"],
        config_user_id=resolve_config_user_id(user),
        project_id=project_id,
        mode=mode,
        requirement=requirement,
        direction_stack_text=direction_stack_text,
        manual_prompt=manual_prompt,
        max_iterations=max_iterations,
        analysis_provider_name=analysis_provider_name,
        analysis_api_format=analysis_api_format,
        analysis_base_url=analysis_base_url,
        analysis_api_key=analysis_api_key,
        analysis_model=analysis_model,
        img_provider_name=img_provider_name,
        img_api_format=img_api_format,
        img_base_url=img_base_url,
        img_api_key=img_api_key,
        img_model=img_model,
        fallback_models_text=fallback_models_text,
        model_switch_after_failures=model_switch_after_failures,
        stop_after_last_model_failures=stop_after_last_model_failures,
        enable_quality_evaluation=enable_quality_evaluation,
        floor_plans=floor_plans or [],
    )
    return await generate_render(form, load_style_profile(project_id, user["user_id"]))


@router.post("/generate/stream")
async def generate_stream(
    user=Depends(get_current_or_default_user),
    project_id: str = Form("default"),
    mode: str = Form(GenerationMode.STANDARD.value),
    requirement: str = Form(""),
    direction_stack_text: str = Form(""),
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
    enable_quality_evaluation: bool = Form(False),
    floor_plans: Optional[list[UploadFile]] = File(None),
):
    form = GenerateForm(
        user_id=user["user_id"],
        config_user_id=resolve_config_user_id(user),
        project_id=project_id,
        mode=mode,
        requirement=requirement,
        direction_stack_text=direction_stack_text,
        manual_prompt=manual_prompt,
        max_iterations=max_iterations,
        analysis_provider_name=analysis_provider_name,
        analysis_api_format=analysis_api_format,
        analysis_base_url=analysis_base_url,
        analysis_api_key=analysis_api_key,
        analysis_model=analysis_model,
        img_provider_name=img_provider_name,
        img_api_format=img_api_format,
        img_base_url=img_base_url,
        img_api_key=img_api_key,
        img_model=img_model,
        fallback_models_text=fallback_models_text,
        model_switch_after_failures=model_switch_after_failures,
        stop_after_last_model_failures=stop_after_last_model_failures,
        enable_quality_evaluation=enable_quality_evaluation,
        floor_plans=floor_plans or [],
    )
    return await stream_generate_render(form, load_style_profile(project_id, user["user_id"]))
