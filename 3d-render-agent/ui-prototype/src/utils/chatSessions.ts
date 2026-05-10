import type { ChatMessage } from "../types/domain";

function localizedContentText(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content.trim();
  }
  return `${content.zh || ""} ${content.en || ""}`.trim();
}

export function hasMeaningfulMessage(message: ChatMessage) {
  const contentText = localizedContentText(message.content);
  const bulletText = message.bullets
    ? [...message.bullets.zh, ...message.bullets.en].join(" ").trim()
    : "";

  return Boolean(
    contentText ||
    bulletText ||
    message.promptText?.trim() ||
    message.imageUrl
  );
}

export function countGenerationRecords(messages: ChatMessage[]) {
  return messages.filter((message) => message.kind === "render" && Boolean(message.imageUrl)).length;
}

export function hasConversationContent(input: {
  messages: ChatMessage[];
  generationRecordCount?: number;
  isRendering?: boolean;
  liveGenerationHasContent?: boolean;
}) {
  return Boolean(
    input.generationRecordCount ||
    input.isRendering ||
    input.liveGenerationHasContent ||
    input.messages.some(hasMeaningfulMessage)
  );
}

export function hasDurableConversationContent(messages: ChatMessage[]) {
  return hasConversationContent({
    messages,
    generationRecordCount: countGenerationRecords(messages),
  });
}

export type ConversationRunGuard = {
  userId: string;
  epoch: number;
};

export function isCurrentConversationRun(
  guard: ConversationRunGuard,
  currentUserId: string,
  currentEpoch: number
) {
  return guard.userId === currentUserId && guard.epoch === currentEpoch;
}
