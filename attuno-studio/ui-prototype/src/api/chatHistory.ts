import { apiFetch, parseApiJson } from "./client";
import type { ChatMessage, GenerationMode } from "../types/domain";

export type ChatSessionPayload = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  chatInput: string;
  workspaceMode: "chat" | "image";
  generationMode: GenerationMode;
  composerMode: "new-generation" | "edit-selected-result";
  activeResultId: string | null;
  pinnedAt?: string | null;
  titleLocked?: boolean;
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

function buildChatHistoryPath(userId: string) {
  const normalized = String(userId || "").trim();
  if (!normalized) return "/api/chat-history";
  return `/api/chat-history?user_id=${encodeURIComponent(normalized)}`;
}

export async function loadChatHistory(userId: string): Promise<ChatHistoryPayload> {
  const response = await apiFetch(buildChatHistoryPath(userId));
  const data = await parseApiJson<ChatHistoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data.history ?? { currentSessionId: "", sessions: [] };
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
