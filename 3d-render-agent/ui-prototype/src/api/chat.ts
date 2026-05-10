import { apiFetch, parseApiJson } from "./client";
import type { ChatMemoryCandidate } from "../types/domain";
export type { ChatMemoryCandidate } from "../types/domain";

export type DesignChatContext = {
  activeResult?: {
    id?: string;
    prompt?: string;
    evaluation?: string;
    floorDesc?: string;
    logs?: string;
  } | null;
  chatInput?: string;
  [key: string]: unknown;
};

export type DesignChatRequest = {
  message: string;
  user_id?: string;
  project_id?: string;
  active_result_id?: string;
  context?: DesignChatContext;
};

export type DesignChatResponse = {
  ok: boolean;
  reply: string;
  intent: string;
  suggested_action: string;
  draft_instruction: string;
  memory_candidate?: ChatMemoryCandidate;
  context_summary?: string;
  ui_hints?: {
    collapse_long_prompt?: boolean;
    apply_to_composer?: boolean;
    switch_to_edit?: boolean;
  };
  error?: string;
};

export type ApplyChatMemoryResponse = {
  ok: boolean;
  profile?: unknown;
  memory?: unknown;
  error?: string;
};

export async function sendDesignChat(request: DesignChatRequest): Promise<DesignChatResponse> {
  const response = await apiFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: "default",
      project_id: "default",
      active_result_id: "",
      context: {},
      ...request
    })
  });
  const data = await parseApiJson<DesignChatResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

export async function applyChatMemory(projectId: string, memoryCandidate: ChatMemoryCandidate, userId = "default"): Promise<ApplyChatMemoryResponse> {
  const response = await apiFetch("/api/chat/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, project_id: projectId || "default", memory_candidate: memoryCandidate })
  });
  const data = await parseApiJson<ApplyChatMemoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}
