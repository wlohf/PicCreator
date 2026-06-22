// @ts-ignore Node's builtin types are not part of this lightweight test harness.
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const chatApiSource = readFileSync(new URL("../src/api/chat.ts", import.meta.url), "utf8");
const chatHistorySource = readFileSync(new URL("../src/api/chatHistory.ts", import.meta.url), "utf8");
const resultsApiSource = readFileSync(new URL("../src/api/results.ts", import.meta.url), "utf8");
const generationApiSource = readFileSync(new URL("../src/api/generation.ts", import.meta.url), "utf8");
const imageEditsApiSource = readFileSync(new URL("../src/api/imageEdits.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const chatWorkspaceSource = readFileSync(new URL("../src/components/chat-workspace.tsx", import.meta.url), "utf8");
const workspaceSource = `${appSource}\n${chatWorkspaceSource}`;

assert(
  chatApiSource.includes('api_config?: ApiConfig') &&
  chatApiSource.includes('reasoning_effort?: ChatReasoningEffort') &&
  chatApiSource.includes('attachments?: ChatImageAttachment[]'),
  "chat API request type should carry active provider/model config, selected effort, and image attachments",
);

const sendDesignChatBlock = chatApiSource.match(/export async function sendDesignChat[\s\S]*?export async function applyChatMemory/m)?.[0] ?? "";
assert(
  sendDesignChatBlock.includes('buildChatPath("/api/chat", request.user_id)') &&
  sendDesignChatBlock.includes("...request") &&
  !sendDesignChatBlock.includes('user_id: "default"'),
  "sendDesignChat should post the caller-provided request to /api/chat without forcing the shared default namespace",
);

assert(
  sendDesignChatBlock.includes("throw new Error(data.error || response.statusText)") &&
  !sendDesignChatBlock.includes("收到。") &&
  !sendDesignChatBlock.includes("Got it."),
  "sendDesignChat should surface backend errors instead of synthesizing a fixed fallback reply",
);

const streamDesignChatBlock = chatApiSource.match(/export async function streamDesignChat[\s\S]*?export async function applyChatMemory/m)?.[0] ?? "";
assert(
  streamDesignChatBlock.includes('apiPathOrOptions: string | { apiPath?: string; signal?: AbortSignal } = "/api/chat/stream"') &&
  streamDesignChatBlock.includes('apiPathOrOptions.apiPath || "/api/chat/stream"') &&
  streamDesignChatBlock.includes("buildChatPath(apiPath, request.user_id)") &&
  streamDesignChatBlock.includes("ChatStreamAbortedError") &&
  streamDesignChatBlock.includes("signal: abortSignal") &&
  streamDesignChatBlock.includes("iterateSseEvents(") &&
  streamDesignChatBlock.includes('parsed.eventName === "progress"') &&
  streamDesignChatBlock.includes("handlers.onProgress?.(parsed.data as DesignChatProgress)") &&
  streamDesignChatBlock.includes('parsed.eventName === "delta"') &&
  streamDesignChatBlock.includes('parsed.eventName === "complete"') &&
  !streamDesignChatBlock.includes('user_id: "default"'),
  "streamDesignChat should consume /api/chat/stream SSE events, preserve the caller namespace, and support abort signals",
);

assert(
  chatHistorySource.includes("export async function loadChatHistory(userId: string)") &&
  chatHistorySource.includes("export async function saveChatHistory(history: ChatHistoryPayload, userId: string)") &&
  appSource.includes("withStartupRetry(() => loadChatHistory(currentUserId))") &&
  appSource.includes("saveChatHistory(historyPayload, currentUserId)") &&
  appSource.includes("saveChatHistory(recoveredStored, currentUserId)") &&
  appSource.includes("lastSavedChatHistoryRef.current = \"\";"),
  "chat history load/save and namespace switching should stay scoped to the active signed-in account",
);

const chatHistoryKeysBlock = appSource.match(/function chatHistoryCandidateKeys[\s\S]*?function loadStoredSessions/m)?.[0] ?? "";
assert(
  !chatHistoryKeysBlock.includes('chatHistoryStorageKey("default")') &&
  !chatHistoryKeysBlock.includes('legacyChatHistoryStorageKey("default")') &&
  !chatHistoryKeysBlock.includes("window.localStorage.length") &&
  !chatHistoryKeysBlock.includes("window.localStorage.key(index)") &&
  chatHistoryKeysBlock.includes('if (normalizedUserId === "default")'),
  "local chat-history recovery should not scan other account namespaces and should only fall back to generic keys for the explicit default namespace",
);

assert(
  resultsApiSource.includes('apiFetch(withUserNamespace("/api/results", userId))') &&
  resultsApiSource.includes('apiFetch(withUserNamespace(`/api/results/${id}`, userId), { method: "DELETE" })') &&
  resultsApiSource.includes('apiFetch(withUserNamespace(`/api/results/${id}/notes`, userId), {') &&
  generationApiSource.includes('apiFetch(buildGenerationPath("/api/generate", request.userId), {') &&
  generationApiSource.includes("apiFetch(buildGenerationPath(apiPath, request.userId), {") &&
  imageEditsApiSource.includes("buildImageEditPath(`/api/results/${request.sourceResultId}/edit`, request.userId)") &&
  imageEditsApiSource.includes("buildImageEditPath(`/api/results/${request.sourceResultId}/annotated-edit`, request.userId)"),
  "result, generation, and image-edit APIs should carry the active account namespace through request URLs",
);

const dailyChatFlowBlock = appSource.match(/async function runDailyChatFlow[\s\S]*?async function runConversationFlow/m)?.[0] ?? "";
const chatSidebarBlock = chatWorkspaceSource.match(/export function ChatSidebar[\s\S]*?export function WorkspaceTopbar/m)?.[0] ?? "";
assert(
  dailyChatFlowBlock.includes("streamDesignChat(") &&
  dailyChatFlowBlock.includes("api_config: requestApiConfig") &&
  dailyChatFlowBlock.includes("reasoning_effort: chatReasoningEffort") &&
  dailyChatFlowBlock.includes("new AbortController()") &&
  dailyChatFlowBlock.includes("{ signal: abortController.signal }") &&
  dailyChatFlowBlock.includes("isChatStreamAbortedError(error)"),
  "daily chat submit should call the backend chat stream API with active config, effort, and abort control",
);

assert(
  appSource.includes("const [chatRespondingSessionIds, setChatRespondingSessionIds]") &&
  appSource.includes("chatRespondingSessionIds.includes(currentSessionId)") &&
  appSource.includes("stopCurrentChatResponse") &&
  workspaceSource.includes("<Square size=") &&
  !appSource.includes("const [isChatResponding, setIsChatResponding]") &&
  !appSource.includes("respondingSessionId"),
  "chat responding state should be tracked per session and expose a stop button instead of a single global lock",
);

assert(
  !chatSidebarBlock.includes("disabled={isRendering}") &&
  !chatSidebarBlock.includes("isRendering") &&
  appSource.includes("function handleResetWorkspace()") &&
  !appSource.includes("function handleResetWorkspace() {\n    if (isRendering) return;") &&
  dailyChatFlowBlock.includes("if (chatRespondingSessionIds.includes(currentSessionIdRef.current)) return;") &&
  !dailyChatFlowBlock.includes("if (isRendering || chatRespondingSessionIds.includes(currentSessionIdRef.current)) return;") &&
  appSource.includes("const isConversationBusy = isRendering || isVisibleChatResponding"),
  "new conversations and daily chat should not be blocked by another session's in-flight image generation",
);

assert(
  dailyChatFlowBlock.includes("assistantMessageId") &&
  dailyChatFlowBlock.includes("onDelta: (delta)") &&
  dailyChatFlowBlock.includes("buildChatImageAttachments(submittedFiles)") &&
  dailyChatFlowBlock.includes("attachments: chatAttachments") &&
  dailyChatFlowBlock.includes("retryAttachments?: ChatImageAttachment[]") &&
  dailyChatFlowBlock.includes("buildLinearChatContext([...baseMessages, nextPatch[0]], userMessageId)") &&
  dailyChatFlowBlock.includes('user_id: currentUserId') &&
  dailyChatFlowBlock.includes("messages: requestMessages") &&
  dailyChatFlowBlock.includes("content: response.reply || streamedReply") &&
  dailyChatFlowBlock.includes('kind: "error"') &&
  !dailyChatFlowBlock.includes('content: response.reply || "收到。"') &&
  !dailyChatFlowBlock.includes('content: response.reply || "Got it."'),
  "daily chat should stream assistant text in place and still surface explicit errors without a fixed fallback reply",
);

assert(
  appSource.includes('type MarkdownBlock =') &&
  appSource.includes('function parseMarkdownBlocks') &&
  appSource.includes('type: "unordered-list"') &&
  appSource.includes('type: "ordered-list"') &&
  appSource.includes('type: "heading"') &&
  appSource.includes('type: "code"') &&
  appSource.includes('trimmed.match(/^(#{2,3})\\s+(.+)$/)') &&
  appSource.includes('trimmed.match(/^[-*]\\s+(.+)$/)') &&
  appSource.includes('trimmed.match(/^(\\d+)\\.\\s+(.+)$/)'),
  "chat message rendering should support common Markdown blocks instead of treating lists/headings as plain text",
);
