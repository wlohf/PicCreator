import { apiFetch, parseApiJson } from "./client";
import { iterateSseEvents } from "./sse";
import type { ApiConfig, ChatImageAttachment, ChatMemoryCandidate, ChatReasoningEffort } from "../types/domain";
export type { ChatMemoryCandidate } from "../types/domain";

export type DesignChatContext = {
  messages?: Array<{
    role: "user" | "assistant";
    content: string;
    attachments?: ChatImageAttachment[];
  }>;
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
  api_config?: ApiConfig;
  reasoning_effort?: ChatReasoningEffort;
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

export type DesignChatStreamMeta = Omit<DesignChatResponse, "reply"> & {
  reply?: string;
};

export type DesignChatStreamHandlers = {
  onMeta?: (meta: DesignChatStreamMeta) => void;
  onDelta?: (delta: string) => void;
  onComplete?: (response: DesignChatResponse) => void;
};

export class ChatStreamAbortedError extends Error {
  constructor(message = "Chat stream aborted") {
    super(message);
    this.name = "ChatStreamAbortedError";
  }
}

export function isChatStreamAbortedError(error: unknown) {
  return error instanceof ChatStreamAbortedError;
}

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

export async function streamDesignChat(
  request: DesignChatRequest,
  handlers: DesignChatStreamHandlers = {},
  apiPathOrOptions: string | { apiPath?: string; signal?: AbortSignal } = "/api/chat/stream",
  signal?: AbortSignal
): Promise<DesignChatResponse> {
  const apiPath = typeof apiPathOrOptions === "string" ? apiPathOrOptions : apiPathOrOptions.apiPath || "/api/chat/stream";
  const abortSignal = typeof apiPathOrOptions === "string" ? signal : apiPathOrOptions.signal;
  const response = await apiFetch(apiPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortSignal,
    body: JSON.stringify({
      user_id: "default",
      project_id: "default",
      active_result_id: "",
      context: {},
      ...request
    })
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatStreamAbortedError();
    }
    throw new Error(
      `无法连接后端聊天流 ${apiPath}。请确认前端开发服务器已代理 /api，且 API 服务正在运行；原始错误：${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok || !response.body) {
    const data = await parseApiJson<DesignChatResponse>(response);
    throw new Error(data.error || response.statusText);
  }

  try {
    for await (const parsed of iterateSseEvents(
      response,
      "聊天流连接已中断，后端可能已退出或不可达。请检查 API 服务日志"
    )) {
      if (parsed.eventName === "meta") {
        handlers.onMeta?.(parsed.data as DesignChatStreamMeta);
        continue;
      }
      if (parsed.eventName === "delta") {
        handlers.onDelta?.(String((parsed.data as { text?: string }).text || ""));
        continue;
      }
      if (parsed.eventName === "complete") {
        const data = parsed.data as DesignChatResponse;
        if (!data.ok) throw new Error(data.error || "Chat failed");
        handlers.onComplete?.(data);
        return data;
      }
      if (parsed.eventName === "error") {
        const data = parsed.data as Partial<DesignChatResponse>;
        throw new Error(data.error || "Chat failed");
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatStreamAbortedError();
    }
    throw error;
  }

  throw new Error("Chat stream ended without a final result");
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
