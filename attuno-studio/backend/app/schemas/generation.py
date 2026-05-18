from dataclasses import dataclass

from fastapi import UploadFile


@dataclass(slots=True)
class GenerateForm:
    user_id: str
    config_user_id: str
    project_id: str
    mode: str
    requirement: str
    direction_stack_text: str
    manual_prompt: str
    max_iterations: int
    analysis_provider_name: str
    analysis_api_format: str
    analysis_base_url: str
    analysis_api_key: str
    analysis_model: str
    img_provider_name: str
    img_api_format: str
    img_base_url: str
    img_api_key: str
    img_model: str
    fallback_models_text: str
    model_switch_after_failures: int
    stop_after_last_model_failures: int
    enable_quality_evaluation: bool
    floor_plans: list[UploadFile]


@dataclass(slots=True)
class EditImageForm:
    source_result_id: str
    user_id: str
    config_user_id: str
    edit_instruction: str
    project_id: str
    max_iterations: int
    analysis_provider_name: str
    analysis_api_format: str
    analysis_base_url: str
    analysis_api_key: str
    analysis_model: str
    img_provider_name: str
    img_api_format: str
    img_base_url: str
    img_api_key: str
    img_model: str
    fallback_models_text: str
    model_switch_after_failures: int
    stop_after_last_model_failures: int
    enable_quality_evaluation: bool


@dataclass(slots=True)
class AnnotatedEditImageForm(EditImageForm):
    annotation_image: UploadFile | None
