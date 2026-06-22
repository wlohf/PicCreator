import { apiFetch, parseApiJson } from "./client";
import type { AnnotatedImageEditRequest, ImageEditRequest, ImageEditResponse } from "../types/domain";

function buildImageEditPath(path: string, userId?: string) {
  const normalized = String(userId || "").trim();
  if (!normalized) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}user_id=${encodeURIComponent(normalized)}`;
}

function appendEditFormFields(formData: FormData, request: ImageEditRequest) {
  formData.append("user_id", request.userId || "default");
  formData.append("edit_instruction", request.editInstruction);
  formData.append("project_id", request.projectId);
  formData.append("max_iterations", String(request.maxIterations));
  formData.append("enable_quality_evaluation", String(request.enableQualityEvaluation));
  formData.append("analysis_provider_name", request.apiConfig.analysisProviderName);
  formData.append("analysis_api_format", request.apiConfig.analysisApiFormat);
  formData.append("analysis_base_url", request.apiConfig.analysisBaseUrl);
  formData.append("analysis_api_key", request.apiConfig.analysisApiKey);
  formData.append("analysis_model", request.apiConfig.analysisModel);
  formData.append("img_provider_name", request.apiConfig.imageProviderName);
  formData.append("img_api_format", request.apiConfig.imageApiFormat);
  formData.append("img_base_url", request.apiConfig.imageBaseUrl);
  formData.append("img_api_key", request.apiConfig.imageApiKey);
  formData.append("img_model", request.apiConfig.imageModel || request.selectedModel);
  formData.append("fallback_models_text", request.apiConfig.fallbackModels);
  formData.append("model_switch_after_failures", String(request.apiConfig.modelSwitchAfterFailures));
  formData.append("stop_after_last_model_failures", String(request.apiConfig.stopAfterLastModelFailures));
  return formData;
}

export async function requestImageEdit(request: ImageEditRequest, options: { signal?: AbortSignal } = {}): Promise<ImageEditResponse> {
  const formData = appendEditFormFields(new FormData(), request);
  const response = await apiFetch(buildImageEditPath(`/api/results/${request.sourceResultId}/edit`, request.userId), {
    method: "POST",
    signal: options.signal,
    body: formData
  });
  const data = await parseApiJson<ImageEditResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

export async function requestAnnotatedImageEdit(request: AnnotatedImageEditRequest): Promise<ImageEditResponse> {
  const formData = appendEditFormFields(new FormData(), request);
  formData.append("annotation_image", request.annotationImage, "annotation.png");

  const response = await apiFetch(buildImageEditPath(`/api/results/${request.sourceResultId}/annotated-edit`, request.userId), {
    method: "POST",
    body: formData
  });
  const data = await parseApiJson<ImageEditResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}
