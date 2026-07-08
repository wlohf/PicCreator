// @ts-ignore Node's builtin types are not part of this lightweight test harness.
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const chatApiSource = readFileSync(new URL("../src/api/chat.ts", import.meta.url), "utf8");
const configApiSource = readFileSync(new URL("../src/api/config.ts", import.meta.url), "utf8");
const systemApiSource = readFileSync(new URL("../src/api/system.ts", import.meta.url), "utf8");
const chatHistorySource = readFileSync(new URL("../src/api/chatHistory.ts", import.meta.url), "utf8");
const resultsApiSource = readFileSync(new URL("../src/api/results.ts", import.meta.url), "utf8");
const generationApiSource = readFileSync(new URL("../src/api/generation.ts", import.meta.url), "utf8");
const imageEditsApiSource = readFileSync(new URL("../src/api/imageEdits.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const studioDataSource = readFileSync(new URL("../src/data/studioData.ts", import.meta.url), "utf8");
const chatWorkspaceSource = readFileSync(new URL("../src/components/chat-workspace.tsx", import.meta.url), "utf8");
const workspaceSource = `${appSource}\n${chatWorkspaceSource}`;

assert(
  chatApiSource.includes('api_config?: ApiConfig') &&
  chatApiSource.includes('reasoning_effort?: ChatReasoningEffort') &&
  chatApiSource.includes('attachments?: ChatImageAttachment[]'),
  "chat API request type should carry active provider/model config, selected effort, and image attachments",
);

assert(
  configApiSource.includes('formData.append("chat_max_output_tokens", String(apiConfig.chatMaxOutputTokens))') &&
  configApiSource.includes('formData.append("chat_context_size", String(apiConfig.chatContextSize))'),
  "config save API should persist chat output token and context size settings",
);

assert(
  !studioDataSource.includes('label: "config.json"') &&
  !studioDataSource.includes("custom_openai_chat") &&
  !studioDataSource.includes("custom_openai_image") &&
  studioDataSource.includes('{ value: "openai_responses", label: "response" }') &&
  studioDataSource.includes('{ value: "openai_chat", label: "completion" }') &&
  studioDataSource.includes('{ value: "anthropic", label: "message" }'),
  "settings API format selector should expose only response, completion, and message",
);

assert(
  chatApiSource.includes("web_search?: WebSearchMetadata") &&
  appSource.includes("webSearch: streamResponse.web_search") &&
  appSource.includes("webSearch: response.web_search") &&
  appSource.includes("<WebSearchSourcesCard search={activeMessage.webSearch} locale={locale} />") &&
  appSource.includes("function WebSearchSourcesCard") &&
  appSource.includes("className=\"web-search-citation\"") &&
  appSource.includes("className=\"message-markdown-link\""),
  "chat API and message rendering should preserve and display web search source metadata",
);

assert(
  systemApiSource.includes("getSystemUpdateStatus") &&
  systemApiSource.includes("checkSystemUpdate") &&
  systemApiSource.includes("applySystemUpdate") &&
  systemApiSource.includes("Authorization: authHeader(credentials)") &&
  appSource.includes('panel: "system" as const') &&
  appSource.includes('runSystemUpdateRequest("check")') &&
  appSource.includes('runSystemUpdateRequest("apply")') &&
  !appSource.includes(["WHL", "whl", "666"].join("")),
  "system update UI should use the update API with admin authorization and must not embed the real password",
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
  chatHistorySource.includes("export async function loadChatHistorySummary(userId: string)") &&
  chatHistorySource.includes("export async function loadChatSession(sessionId: string, userId: string)") &&
  chatHistorySource.includes('options.summary ? { summary: "1" } : {}') &&
  chatHistorySource.includes("`/api/chat-history/${encodeURIComponent(sessionId)}`") &&
  chatHistorySource.includes("export async function saveChatHistory(history: ChatHistoryPayload, userId: string)") &&
  appSource.includes("withStartupRetry(() => loadChatHistorySummary(currentUserId))") &&
  appSource.includes("const localStored = loadStoredSessions(currentUserId)") &&
  appSource.includes("applyStoredSessionSummaries(serverStored)") &&
  appSource.includes("const shouldLoadDetail = isSummaryOnlySession(target)") &&
  appSource.includes("await loadChatSession(sessionId, currentUserId)") &&
  appSource.includes("sessionsForBackendSave(persistableSessions)") &&
  appSource.includes("saveChatHistory(recoveredStored, currentUserId)") &&
  appSource.includes("lastSavedChatHistoryRef.current = \"\";"),
  "chat history startup should use summary loading, lazy-load session detail, and keep save namespace scoped to the active account",
);

const localHistoryStartupIndex = appSource.indexOf("const localStored = loadStoredSessions(currentUserId)");
const serverSummaryStartupIndex = appSource.indexOf("withStartupRetry(() => loadChatHistorySummary(currentUserId))");
assert(
  localHistoryStartupIndex >= 0 &&
  serverSummaryStartupIndex > localHistoryStartupIndex &&
  appSource.includes("session.searchText || \"\"") &&
  appSource.includes("isSummaryOnlySession(session)") &&
  appSource.includes("messages: [], activeMessageId: null"),
  "chat history startup should apply account-local cache before server summary, search summary text, and avoid saving summaries as full empty sessions",
);

assert(
  appSource.includes("const serverTarget = preferredStoredSession(serverStored)") &&
  appSource.includes("selectCurrentSession(serverTarget.id)") &&
  appSource.includes("const detailTarget = selectedSession ?? serverTarget") &&
  appSource.includes("await loadChatSession(detailTarget.id, currentUserId)") &&
  !appSource.includes("if (!didApplyLocalStored && !currentSessionIdRef.current)"),
  "server-only summary startup should open and lazy-load the server current session instead of creating a blank new chat",
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
