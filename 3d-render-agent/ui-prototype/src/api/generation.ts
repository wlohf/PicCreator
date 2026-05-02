import { buildApiUrl, parseApiJson } from "./client";
import type { GenerateResponse, GenerationRequest } from "../types/domain";

export async function requestGeneration({
  prompt,
  directionStackText,
  maxIterations,
  apiConfig,
  selectedModel,
  floorPlanFiles,
  referenceFile
}: GenerationRequest): Promise<GenerateResponse> {
  const formData = new FormData();
  formData.append("mode", "render3d");
  formData.append("requirement", prompt);
  formData.append("direction_stack_text", directionStackText);
  formData.append("manual_prompt", "");
  formData.append("max_iterations", String(maxIterations));
  formData.append("analysis_provider_name", apiConfig.analysisProviderName);
  formData.append("analysis_api_format", apiConfig.analysisApiFormat);
  formData.append("analysis_base_url", apiConfig.analysisBaseUrl);
  formData.append("analysis_api_key", apiConfig.analysisApiKey);
  formData.append("analysis_model", apiConfig.analysisModel);
  formData.append("img_provider_name", apiConfig.imageProviderName);
  formData.append("img_api_format", apiConfig.imageApiFormat);
  formData.append("img_base_url", apiConfig.imageBaseUrl);
  formData.append("img_api_key", apiConfig.imageApiKey);
  formData.append("img_model", apiConfig.imageModel || selectedModel);
  formData.append("fallback_models_text", apiConfig.fallbackModels);
  formData.append("model_switch_after_failures", String(apiConfig.modelSwitchAfterFailures));
  formData.append("stop_after_last_model_failures", String(apiConfig.stopAfterLastModelFailures));

  for (const file of floorPlanFiles) {
    formData.append("floor_plans", file);
  }
  if (referenceFile) {
    formData.append("reference_image", referenceFile);
  }

  const response = await fetch(buildApiUrl("/api/generate"), {
    method: "POST",
    body: formData
  });
  const data = await parseApiJson<GenerateResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.status || response.statusText);
  }
  return data;
}
