// @ts-ignore Node's builtin types are not part of this lightweight test harness.
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const chatApiSource = readFileSync(new URL("../src/api/chat.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

assert(
  chatApiSource.includes('api_config?: ApiConfig') &&
  chatApiSource.includes('reasoning_effort?: ChatReasoningEffort') &&
  chatApiSource.includes('attachments?: ChatImageAttachment[]'),
  "chat API request type should carry active provider/model config, selected effort, and image attachments",
);

const sendDesignChatBlock = chatApiSource.match(/export async function sendDesignChat[\s\S]*?export async function applyChatMemory/m)?.[0] ?? "";
assert(
  sendDesignChatBlock.includes('apiFetch("/api/chat"') &&
  sendDesignChatBlock.includes("...request"),
  "sendDesignChat should post the caller-provided request to /api/chat",
);

assert(
  sendDesignChatBlock.includes("throw new Error(data.error || response.statusText)") &&
  !sendDesignChatBlock.includes("收到。") &&
  !sendDesignChatBlock.includes("Got it."),
  "sendDesignChat should surface backend errors instead of synthesizing a fixed fallback reply",
);

const streamDesignChatBlock = chatApiSource.match(/export async function streamDesignChat[\s\S]*?export async function applyChatMemory/m)?.[0] ?? "";
assert(
  streamDesignChatBlock.includes('apiPath = "/api/chat/stream"') &&
  streamDesignChatBlock.includes("iterateSseEvents(") &&
  streamDesignChatBlock.includes('parsed.eventName === "delta"') &&
  streamDesignChatBlock.includes('parsed.eventName === "complete"'),
  "streamDesignChat should consume /api/chat/stream SSE events and surface delta/complete handlers",
);

const dailyChatFlowBlock = appSource.match(/async function runDailyChatFlow[\s\S]*?async function runConversationFlow/m)?.[0] ?? "";
assert(
  dailyChatFlowBlock.includes("streamDesignChat({") &&
  dailyChatFlowBlock.includes("api_config: requestApiConfig") &&
  dailyChatFlowBlock.includes("reasoning_effort: chatReasoningEffort"),
  "daily chat submit should call the backend chat stream API with active config and effort",
);

assert(
  dailyChatFlowBlock.includes("assistantMessageId") &&
  dailyChatFlowBlock.includes("onDelta: (delta)") &&
  dailyChatFlowBlock.includes("buildChatImageAttachments(submittedFiles)") &&
  dailyChatFlowBlock.includes("attachments: chatAttachments") &&
  dailyChatFlowBlock.includes("retryAttachments?: ChatImageAttachment[]") &&
  dailyChatFlowBlock.includes("buildLinearChatContext([...messages, nextPatch[0]], userMessageId)") &&
  dailyChatFlowBlock.includes("messages: requestMessages") &&
  dailyChatFlowBlock.includes("content: response.reply || streamedReply") &&
  dailyChatFlowBlock.includes('kind: "error"') &&
  !dailyChatFlowBlock.includes('content: response.reply || "收到。"') &&
  !dailyChatFlowBlock.includes('content: response.reply || "Got it."'),
  "daily chat should stream assistant text in place and still surface explicit errors without a fixed fallback reply",
);
