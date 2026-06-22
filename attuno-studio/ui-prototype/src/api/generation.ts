import { apiFetch, parseApiJson } from "./client";
import { iterateSseEvents } from "./sse";
import type { GenerateResponse, GenerationProgress, GenerationRequest } from "../types/domain";

export class GenerationStreamAbortedError extends Error {
  constructor(message = "Generation stream aborted") {
    super(message);
    this.name = "GenerationStreamAbortedError";
  }
}

export function isGenerationStreamAbortedError(error: unknown) {
  return error instanceof GenerationStreamAbortedError;
}

function buildGenerationPath(path: string, userId?: string) {
  const normalized = String(userId || "").trim();
  if (!normalized) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}user_id=${encodeURIComponent(normalized)}`;
}

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
  const response = await apiFetch(buildGenerationPath("/api/generate", request.userId), {
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
  apiPathOrOptions: string | { apiPath?: string; signal?: AbortSignal } = "/api/generate/stream",
  signal?: AbortSignal
): Promise<GenerateResponse> {
  const apiPath = typeof apiPathOrOptions === "string" ? apiPathOrOptions : apiPathOrOptions.apiPath || "/api/generate/stream";
  const abortSignal = typeof apiPathOrOptions === "string" ? signal : apiPathOrOptions.signal;
  const response = await apiFetch(buildGenerationPath(apiPath, request.userId), {
    method: "POST",
    signal: abortSignal,
    body: buildGenerationFormData(request)
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GenerationStreamAbortedError();
    }
    throw new Error(
      `无法连接后端代理 ${apiPath}。请确认前端开发服务器已代理 /api，且 API 服务正在运行；原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok || !response.body) {
    const data = await parseApiJson<GenerateResponse>(response);
    throw new Error(data.error || data.status || response.statusText);
  }

  try {
    for await (const parsed of iterateSseEvents(
      response,
      "生成连接已中断，后端可能在长时间图片生成中退出/不可达。请检查 API 窗口日志"
    )) {
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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GenerationStreamAbortedError();
    }
    throw error;
  }

  throw new Error("Generation stream ended without a final result");
}
