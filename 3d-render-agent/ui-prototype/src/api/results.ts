import { apiFetch, buildApiUrl, parseApiJson } from "./client";
import type { ApiResult, RenderHistoryItem } from "../types/domain";

export type ResultsResponse = {
  ok: boolean;
  results: ApiResult[];
};

type ResultMutationResponse = {
  ok: boolean;
  result?: ApiResult;
  error?: string;
  detail?: string;
};

function resolveAssetUrl(value?: string | null, userId?: string | null) {
  if (!value) return undefined;
  if (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return buildApiUrl(value, userId ? { user_id: userId } : undefined);
}

export function normalizeApiResult(item: ApiResult): RenderHistoryItem {
  const userId = item.user_id || "default";
  return {
    id: item.id,
    title: item.title || item.image_label || "Render result",
    status: item.status,
    imageUrl: resolveAssetUrl(item.image_url, userId),
    downloadUrl: resolveAssetUrl(item.download_url, userId),
    annotationUrl: resolveAssetUrl(item.annotation_url, userId),
    floorPlanUrl: resolveAssetUrl(item.floor_plan_url, userId),
    floorPlanName: item.floor_plan_name,
    imageLabel: item.image_label,
    prompt: item.prompt,
    evaluation: item.evaluation,
    floorDesc: item.floor_desc,
    logs: item.logs,
    notes: item.notes,
    createdAt: item.created_at || new Date().toISOString(),
    parentId: item.parent_id,
    generationType: item.generation_type || "generation",
    editMode: item.edit_mode || "",
    editInstruction: item.edit_instruction,
    annotationAnalysis: item.annotation_analysis,
    sourcePrompt: item.source_prompt,
    sourceEvaluation: item.source_evaluation,
    sourceLogs: item.source_logs,
    modelUsed: item.model_used,
    modelWarning: item.model_warning,
    generationMode: item.generation_mode,
    versionIndex: item.version_index || 1,
    projectId: item.project_id || "default"
    ,
    userId
  };
}

function httpError(response: Response, data?: { error?: string }): Error {
  return new Error(data?.error || `HTTP ${response.status}`);
}

export async function listResults(userId = "default"): Promise<RenderHistoryItem[]> {
  const response = await apiFetch(`/api/results?user_id=${encodeURIComponent(userId)}`);
  const data = await parseApiJson<ResultsResponse>(response);
  if (!response.ok || !data.ok) {
    throw httpError(response, data as { error?: string });
  }
  return data.results.map(normalizeApiResult);
}

export async function deleteResult(id: string, userId = "default"): Promise<void> {
  const response = await apiFetch(`/api/results/${id}?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await parseApiJson<{ error?: string }>(response).catch(() => ({}));
    throw httpError(response, data);
  }
}

export async function clearResults(userId = "default"): Promise<void> {
  const response = await apiFetch(`/api/results?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await parseApiJson<{ error?: string }>(response).catch(() => ({}));
    throw httpError(response, data);
  }
}

export async function saveResultNotes(id: string, notes: string, userId = "default"): Promise<RenderHistoryItem> {
  const response = await apiFetch(`/api/results/${id}/notes?user_id=${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const data = await parseApiJson<ResultMutationResponse>(response);
  if (!response.ok || !data.ok || !data.result) {
    throw new Error(data.error || data.detail || `HTTP ${response.status}`);
  }
  return normalizeApiResult(data.result);
}
