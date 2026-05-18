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

type SessionSnapshotLike = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: readonly unknown[];
  chatInput: string;
  workspaceMode: string;
  generationMode: string;
  composerMode: string;
  activeResultId: string | null;
};

function sameSessionContent<T extends SessionSnapshotLike>(left: T, right: T) {
  return (
    left.title === right.title &&
    left.messages === right.messages &&
    left.chatInput === right.chatInput &&
    left.workspaceMode === right.workspaceMode &&
    left.generationMode === right.generationMode &&
    left.composerMode === right.composerMode &&
    left.activeResultId === right.activeResultId
  );
}

export function upsertSessionSnapshot<T extends SessionSnapshotLike>(list: T[], nextSession: T) {
  const existingIndex = list.findIndex((session) => session.id === nextSession.id);
  if (existingIndex === 0 && sameSessionContent(list[0], nextSession)) {
    return list;
  }
  return [
    nextSession,
    ...list.filter((session) => session.id !== nextSession.id),
  ].slice(0, 20);
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
