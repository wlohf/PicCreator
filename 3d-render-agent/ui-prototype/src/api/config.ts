import { apiFetch, parseApiJson } from "./client";
import type { ApiConfig } from "../types/domain";

export type ConfigVerifyResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  stage?: string;
};

export type ConfigSaveResponse = ConfigVerifyResponse;
export type ConfigLoadResponse = {
  ok: boolean;
  config?: ApiConfig;
  error?: string;
  stage?: string;
};

type ConfigRole = "analysis" | "image";

function appendConfig(formData: FormData, apiConfig: ApiConfig, role: ConfigRole) {
  if (role === "analysis") {
    formData.append("provider_name", apiConfig.analysisProviderName);
    formData.append("api_format", apiConfig.analysisApiFormat);
    formData.append("base_url", apiConfig.analysisBaseUrl);
    formData.append("api_key", apiConfig.analysisApiKey);
    formData.append("model", apiConfig.analysisModel);
    return;
  }
  formData.append("provider_name", apiConfig.imageProviderName);
  formData.append("api_format", apiConfig.imageApiFormat);
  formData.append("base_url", apiConfig.imageBaseUrl);
  formData.append("api_key", apiConfig.imageApiKey);
  formData.append("model", apiConfig.imageModel);
}

export async function loadConfig(): Promise<ApiConfig> {
  const response = await apiFetch("/api/config");
  const data = await parseApiJson<ConfigLoadResponse>(response);
  if (!response.ok || !data.ok || !data.config) {
    throw new Error(data.error || response.statusText);
  }
  return data.config;
}

export async function verifyConfig(role: ConfigRole, apiConfig: ApiConfig): Promise<ConfigVerifyResponse> {
  const formData = new FormData();
  appendConfig(formData, apiConfig, role);
  const response = await apiFetch(`/api/config/verify-${role}`, {
    method: "POST",
    body: formData
  });
  const data = await parseApiJson<ConfigVerifyResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || response.statusText);
  }
  return data;
}

export async function saveConfig(apiConfig: ApiConfig): Promise<ConfigSaveResponse> {
  const formData = new FormData();
  formData.append("analysis_provider_name", apiConfig.analysisProviderName);
  formData.append("analysis_api_format", apiConfig.analysisApiFormat);
  formData.append("analysis_base_url", apiConfig.analysisBaseUrl);
  formData.append("analysis_api_key", apiConfig.analysisApiKey);
  formData.append("analysis_model", apiConfig.analysisModel);
  formData.append("img_provider_name", apiConfig.imageProviderName);
  formData.append("img_api_format", apiConfig.imageApiFormat);
  formData.append("img_base_url", apiConfig.imageBaseUrl);
  formData.append("img_api_key", apiConfig.imageApiKey);
  formData.append("img_model", apiConfig.imageModel);
  formData.append("floor_analysis_system_prompt", apiConfig.floorAnalysisSystemPrompt);
  formData.append("prompt_gen_system_3d_cn", apiConfig.promptGenSystem3dCn);
  formData.append("fallback_models_text", apiConfig.fallbackModels);
  formData.append("model_switch_after_failures", String(apiConfig.modelSwitchAfterFailures));
  formData.append("stop_after_last_model_failures", String(apiConfig.stopAfterLastModelFailures));

  const response = await apiFetch("/api/config/save", {
    method: "POST",
    body: formData
  });
  const data = await parseApiJson<ConfigSaveResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || response.statusText);
  }
  return data;
}
