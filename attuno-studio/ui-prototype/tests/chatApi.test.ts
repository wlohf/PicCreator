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
  chatApiSource.includes('reasoning_effort?: ChatReasoningEffort'),
  "chat API request type should carry active provider/model config and selected effort",
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

const dailyChatFlowBlock = appSource.match(/async function runDailyChatFlow[\s\S]*?async function runConversationFlow/m)?.[0] ?? "";
assert(
  dailyChatFlowBlock.includes("sendDesignChat({") &&
  dailyChatFlowBlock.includes("api_config: apiConfig") &&
  dailyChatFlowBlock.includes("reasoning_effort: chatReasoningEffort"),
  "daily chat submit should call the backend chat API with active config and effort",
);

assert(
  dailyChatFlowBlock.includes("content: response.reply") &&
  dailyChatFlowBlock.includes('kind: "error"') &&
  !dailyChatFlowBlock.includes("response.reply ||"),
  "daily chat should render backend reply or an explicit error message without repeating a local fallback",
);
