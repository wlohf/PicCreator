import { buildApiUrl, parseApiJson } from "./client";
import type { ApiConfig } from "../types/domain";

export type ConfigVerifyResponse = {
  ok: boolean;
  message?: string;
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

export async function verifyConfig(role: ConfigRole, apiConfig: ApiConfig): Promise<ConfigVerifyResponse> {
  const formData = new FormData();
  appendConfig(formData, apiConfig, role);
  const response = await fetch(buildApiUrl(`/api/config/verify-${role}`), {
    method: "POST",
    body: formData
  });
  const data = await parseApiJson<ConfigVerifyResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || response.statusText);
  }
  return data;
}
