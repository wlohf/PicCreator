from fastapi import APIRouter, Depends, File, Form, UploadFile

from backend.app.services.auth_service import get_current_or_namespace_user, resolve_config_user_id
from backend.app.schemas.generation import AnnotatedEditImageForm, EditImageForm
from backend.app.services.image_edit_service import annotated_edit_render, edit_render
from backend.app.services.preferences_store import load_style_profile

router = APIRouter(prefix="/api/results", tags=["image-edits"])


@router.post("/{result_id}/edit")
async def edit_result(
    result_id: str,
    user=Depends(get_current_or_namespace_user),
    edit_instruction: str = Form(""),
    project_id: str = Form("default"),
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
):
    form = EditImageForm(
        source_result_id=result_id,
        user_id=user["user_id"],
        config_user_id=resolve_config_user_id(user),
        edit_instruction=edit_instruction,
        project_id=project_id,
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
    )
    return await edit_render(form, load_style_profile(project_id, user["user_id"]))


@router.post("/{result_id}/annotated-edit")
async def annotated_edit_result(
    result_id: str,
    user=Depends(get_current_or_namespace_user),
    edit_instruction: str = Form(""),
    project_id: str = Form("default"),
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
    annotation_image: UploadFile | None = File(None),
):
    form = AnnotatedEditImageForm(
        source_result_id=result_id,
        user_id=user["user_id"],
        config_user_id=resolve_config_user_id(user),
        edit_instruction=edit_instruction,
        project_id=project_id,
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
        annotation_image=annotation_image,
    )
    return await annotated_edit_render(form, load_style_profile(project_id, user["user_id"]))
