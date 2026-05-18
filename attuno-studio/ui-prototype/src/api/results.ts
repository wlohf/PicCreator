import { apiFetch, buildApiUrl, parseApiJson } from "./client";
import type { ApiResult, RenderHistoryItem } from "../types/domain";
import { resolveResultAssetUrl, shouldIncludeResultNamespaceQuery } from "../utils/resultAssetUrls";

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

export function normalizeApiResult(item: ApiResult, options: { includeNamespaceQuery?: boolean } | number = {}): RenderHistoryItem {
  const userId = item.user_id || "default";
  const includeNamespaceQuery = typeof options === "number" ? false : options.includeNamespaceQuery ?? false;
  return {
    id: item.id,
    title: item.title || item.image_label || "Render result",
    status: item.status,
    imageUrl: resolveResultAssetUrl(item.image_url, userId, includeNamespaceQuery, buildApiUrl),
    downloadUrl: resolveResultAssetUrl(item.download_url, userId, includeNamespaceQuery, buildApiUrl),
    annotationUrl: resolveResultAssetUrl(item.annotation_url, userId, includeNamespaceQuery, buildApiUrl),
    floorPlanUrl: resolveResultAssetUrl(item.floor_plan_url, userId, includeNamespaceQuery, buildApiUrl),
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
  const includeNamespaceQuery = shouldIncludeResultNamespaceQuery(userId);
  const response = await apiFetch(includeNamespaceQuery ? `/api/results?user_id=${encodeURIComponent(userId)}` : "/api/results");
  const data = await parseApiJson<ResultsResponse>(response);
  if (!response.ok || !data.ok) {
    throw httpError(response, data as { error?: string });
  }
  return data.results.map((item) => normalizeApiResult(item, { includeNamespaceQuery }));
}

export async function deleteResult(id: string, userId = "default"): Promise<void> {
  const response = await apiFetch(userId === "default" ? `/api/results/${id}?user_id=${encodeURIComponent(userId)}` : `/api/results/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await parseApiJson<{ error?: string }>(response).catch(() => ({}));
    throw httpError(response, data);
  }
}

export async function clearResults(userId = "default"): Promise<void> {
  const response = await apiFetch(userId === "default" ? `/api/results?user_id=${encodeURIComponent(userId)}` : "/api/results", { method: "DELETE" });
  if (!response.ok) {
    const data = await parseApiJson<{ error?: string }>(response).catch(() => ({}));
    throw httpError(response, data);
  }
}

export async function saveResultNotes(id: string, notes: string, userId = "default"): Promise<RenderHistoryItem> {
  const response = await apiFetch(userId === "default" ? `/api/results/${id}/notes?user_id=${encodeURIComponent(userId)}` : `/api/results/${id}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const data = await parseApiJson<ResultMutationResponse>(response);
  if (!response.ok || !data.ok || !data.result) {
    throw new Error(data.error || data.detail || `HTTP ${response.status}`);
  }
  return normalizeApiResult(data.result, { includeNamespaceQuery: shouldIncludeResultNamespaceQuery(userId) });
}
