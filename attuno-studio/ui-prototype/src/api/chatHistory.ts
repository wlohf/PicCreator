import { apiFetch, parseApiJson } from "./client";
import type { ChatMessage, GenerationMode } from "../types/domain";

export type ChatSessionPayload = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  activeMessageId: string | null;
  chatInput: string;
  workspaceMode: "chat" | "image";
  generationMode: GenerationMode;
  promptModeId?: string;
  composerMode: "new-generation" | "edit-selected-result";
  activeResultId: string | null;
  pinnedAt?: string | null;
  titleLocked?: boolean;
  hasMessages?: boolean;
  messageCount?: number;
  searchText?: string;
};

export type ChatHistoryPayload = {
  currentSessionId: string;
  sessions: ChatSessionPayload[];
};

type ChatHistoryResponse = {
  ok: boolean;
  history?: ChatHistoryPayload;
  error?: string;
  detail?: string;
};

type ChatSessionResponse = {
  ok: boolean;
  session?: ChatSessionPayload;
  error?: string;
  detail?: string;
};

function withUserNamespace(path: string, userId: string, params: Record<string, string> = {}) {
  const normalized = String(userId || "").trim();
  const search = new URLSearchParams(params);
  if (normalized) {
    search.set("user_id", normalized);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function buildChatHistoryPath(userId: string, options: { summary?: boolean } = {}) {
  return withUserNamespace("/api/chat-history", userId, options.summary ? { summary: "1" } : {});
}

export async function loadChatHistory(userId: string): Promise<ChatHistoryPayload> {
  const response = await apiFetch(buildChatHistoryPath(userId));
  const data = await parseApiJson<ChatHistoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data.history ?? { currentSessionId: "", sessions: [] };
}

export async function loadChatHistorySummary(userId: string): Promise<ChatHistoryPayload> {
  const response = await apiFetch(buildChatHistoryPath(userId, { summary: true }));
  const data = await parseApiJson<ChatHistoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data.history ?? { currentSessionId: "", sessions: [] };
}

export async function loadChatSession(sessionId: string, userId: string): Promise<ChatSessionPayload> {
  const response = await apiFetch(withUserNamespace(`/api/chat-history/${encodeURIComponent(sessionId)}`, userId));
  const data = await parseApiJson<ChatSessionResponse>(response);
  if (!response.ok || !data.ok || !data.session) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data.session;
}

export async function saveChatHistory(history: ChatHistoryPayload, userId: string): Promise<ChatHistoryPayload> {
  const response = await apiFetch(buildChatHistoryPath(userId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(history),
  });
  const data = await parseApiJson<ChatHistoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data.history ?? history;
}
