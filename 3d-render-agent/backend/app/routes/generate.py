from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile

from backend.app.schemas.generation import GenerateForm
from backend.app.services.generation_service import generate_render
from models.schemas import GenerationMode

router = APIRouter(prefix="/api", tags=["generation"])


@router.post("/generate")
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
    form = GenerateForm(
        mode=mode,
        requirement=requirement,
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
        floor_plans=floor_plans or [],
        reference_image=reference_image,
    )
    return await generate_render(form)
