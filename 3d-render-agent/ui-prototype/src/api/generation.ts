import { apiFetch, buildApiUrl, parseApiJson } from "./client";
import type { GenerateResponse, GenerationProgress, GenerationRequest } from "../types/domain";

function buildGenerationFormData({
  mode,
  projectId,
  userId,
  prompt,
  directionStackText,
  maxIterations,
  enableQualityEvaluation,
  apiConfig,
  selectedModel,
  floorPlanFiles
}: GenerationRequest) {
  const formData = new FormData();
  formData.append("mode", mode);
  formData.append("user_id", userId || "default");
  formData.append("project_id", projectId || "default");
  formData.append("requirement", prompt);
  formData.append("direction_stack_text", directionStackText);
  formData.append("manual_prompt", "");
  formData.append("max_iterations", String(maxIterations));
  formData.append("enable_quality_evaluation", String(enableQualityEvaluation));
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
  return formData;
}


export async function requestGeneration(request: GenerationRequest): Promise<GenerateResponse> {
  const response = await apiFetch("/api/generate", {
    method: "POST",
    body: buildGenerationFormData(request)
  });
  const data = await parseApiJson<GenerateResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.status || response.statusText);
  }
  return data;
}

export async function requestGenerationStream(
  request: GenerationRequest,
  onProgress: (progress: GenerationProgress) => void,
  apiPath = "/api/generate/stream"
): Promise<GenerateResponse> {
  const response = await apiFetch(apiPath, {
    method: "POST",
    body: buildGenerationFormData(request)
  }).catch((error) => {
    throw new Error(
      `无法连接后端代理 ${apiPath}。请确认前端开发服务器已代理 /api，且 API 服务正在运行；原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok || !response.body) {
    const data = await parseApiJson<GenerateResponse>(response);
    throw new Error(data.error || data.status || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseEvent(rawEvent: string) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return null;
    const data = JSON.parse(dataLines.join("\n")) as GenerateResponse | GenerationProgress;
    return { eventName, data };
  }

  try {
    while (true) {
      const { value, done } = await reader.read().catch((error) => {
        throw new Error(
          `生成连接已中断，后端可能在长时间图片生成中退出/不可达。请检查 API 窗口日志；原始错误：${error instanceof Error ? error.message : String(error)}`
        );
      });
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const parsed = parseEvent(part);
        if (!parsed) continue;
        if (parsed.eventName === "progress") {
          onProgress(parsed.data as GenerationProgress);
          continue;
        }
        if (parsed.eventName === "complete") {
          const data = parsed.data as GenerateResponse;
          if (!data.ok) throw new Error(data.error || data.status || "Generation failed");
          return data;
        }
        if (parsed.eventName === "error") {
          const data = parsed.data as GenerateResponse;
          throw new Error(data.error || data.status || "Generation failed");
        }
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error("Generation stream ended without a final result");
}
