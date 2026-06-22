import type { ChatMessage, ChatMessageVariant, GenerationMode } from "../types/domain";

export type WorkspaceModeLike = "chat" | "image";

export function canSwitchWorkspaceMode({
  currentMode,
  nextMode,
  isVisibleRendering = false,
  isVisibleChatResponding = false,
}: {
  currentMode: WorkspaceModeLike;
  nextMode: WorkspaceModeLike;
  isVisibleRendering?: boolean;
  isVisibleChatResponding?: boolean;
}) {
  return currentMode !== nextMode && !isVisibleRendering && !isVisibleChatResponding;
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return length - 1;
  return Math.min(length - 1, Math.max(0, Math.trunc(index)));
}

function cloneMessageWithParent(message: ChatMessage, parentId: string | null): ChatMessage {
  return {
    ...message,
    parentId,
  };
}

function hasMessageId(messages: ChatMessage[], id: string | null | undefined) {
  return Boolean(id && messages.some((message) => message.id === id));
}

export function normalizeMessageTree(messages: ChatMessage[], activeMessageId?: string | null) {
  let previousId: string | null = null;
  let changed = false;
  const seenIds = new Set<string>();
  const normalizedMessages = messages.map((message) => {
    const explicitParent = Object.prototype.hasOwnProperty.call(message, "parentId");
    const parentId = explicitParent ? message.parentId ?? null : previousId;
    if (!explicitParent || message.parentId !== parentId) {
      changed = true;
    }
    if (parentId && !seenIds.has(parentId)) {
      changed = true;
    }
    const nextMessage = cloneMessageWithParent(message, parentId && seenIds.has(parentId) ? parentId : null);
    seenIds.add(nextMessage.id);
    previousId = nextMessage.id;
    return nextMessage;
  });
  const normalizedActiveMessageId = hasMessageId(normalizedMessages, activeMessageId)
    ? activeMessageId ?? null
    : normalizedMessages[normalizedMessages.length - 1]?.id ?? null;
  return {
    messages: changed ? normalizedMessages : messages,
    activeMessageId: normalizedActiveMessageId,
  };
}

export function getActiveMessagePath(messages: ChatMessage[], activeMessageId?: string | null): ChatMessage[] {
  if (messages.length === 0) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  let cursor = activeMessageId && byId.has(activeMessageId)
    ? byId.get(activeMessageId)
    : messages[messages.length - 1];
  const path: ChatMessage[] = [];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    path.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse();
}

export function getMessageSiblings(messages: ChatMessage[], messageId: string): ChatMessage[] {
  const target = messages.find((message) => message.id === messageId);
  if (!target) return [];
  const targetParentId = target.parentId ?? null;
  return messages.filter((message) => (message.parentId ?? null) === targetParentId && message.role === target.role);
}

export function getBranchInfo(messages: ChatMessage[], messageId: string) {
  const siblings = getMessageSiblings(messages, messageId);
  return {
    siblings,
    activeIndex: Math.max(0, siblings.findIndex((message) => message.id === messageId)),
    count: siblings.length,
  };
}

export function findBranchLeafMessageId(messages: ChatMessage[], rootMessageId: string) {
  const childrenByParent = new Map<string | null, ChatMessage[]>();
  for (const message of messages) {
    const parentId = message.parentId ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), message]);
  }
  let cursor: ChatMessage | undefined = messages.find((message) => message.id === rootMessageId);
  if (!cursor) return null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const children: ChatMessage[] = childrenByParent.get(cursor.id) ?? [];
    if (children.length === 0) break;
    cursor = children[children.length - 1];
  }
  return cursor?.id ?? null;
}

export function switchMessageSibling(messages: ChatMessage[], messageId: string, offset: number) {
  const { siblings, activeIndex } = getBranchInfo(messages, messageId);
  if (siblings.length <= 1) return messageId;
  const nextSibling = siblings[clampIndex(activeIndex + offset, siblings.length)];
  return findBranchLeafMessageId(messages, nextSibling.id) ?? nextSibling.id;
}

export function getMessagePathTo(messages: ChatMessage[], messageId: string) {
  return getActiveMessagePath(messages, messageId);
}

function isImageWorkflowOwnMessage(message: ChatMessage) {
  const activeMessage = withActiveMessageVariant(message);
  return (
    activeMessage.workflowMode === "image" ||
    activeMessage.id.startsWith("m-user-") ||
    activeMessage.id.startsWith("m-api-") ||
    activeMessage.id.startsWith("m-live-analysis-") ||
    activeMessage.id.startsWith("recovered-user-") ||
    activeMessage.id.startsWith("recovered-render-") ||
    activeMessage.kind === "analysis" ||
    activeMessage.kind === "render" ||
    Boolean(activeMessage.imageUrl || activeMessage.sourceResultId || activeMessage.promptText)
  );
}

function hasImageWorkflowDescendant(messages: ChatMessage[], messageId: string) {
  const childrenByParent = new Map<string | null, ChatMessage[]>();
  for (const message of messages) {
    const parentId = message.parentId ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), message]);
  }
  const queue = [...(childrenByParent.get(messageId) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const child = queue.shift();
    if (!child || seen.has(child.id)) continue;
    seen.add(child.id);
    if (isImageWorkflowOwnMessage(child)) {
      return true;
    }
    queue.push(...(childrenByParent.get(child.id) ?? []));
  }
  return false;
}

export function isImageWorkflowMessage(messages: ChatMessage[], messageId: string) {
  const message = messages.find((item) => item.id === messageId);
  if (!message) return false;
  const activeMessage = withActiveMessageVariant(message);
  if (activeMessage.workflowMode === "chat") return false;
  if (isImageWorkflowOwnMessage(activeMessage)) return true;
  const path = getMessagePathTo(messages, activeMessage.id).map(withActiveMessageVariant);
  const hasChatBoundary = path.some((item) => item.workflowMode === "chat");
  if (hasChatBoundary) return false;
  return path.some(isImageWorkflowOwnMessage) || hasImageWorkflowDescendant(messages, activeMessage.id);
}

export function inferMessageGenerationMode(
  messages: ChatMessage[],
  messageId: string,
  fallbackMode: GenerationMode
): GenerationMode {
  const path = getMessagePathTo(messages, messageId).map(withActiveMessageVariant);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const mode = path[index].generationMode;
    if (mode) return mode;
  }
  const childrenByParent = new Map<string | null, ChatMessage[]>();
  for (const message of messages) {
    const parentId = message.parentId ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), message]);
  }
  const queue = [...(childrenByParent.get(messageId) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const child = queue.shift();
    if (!child || seen.has(child.id)) continue;
    seen.add(child.id);
    const activeChild = withActiveMessageVariant(child);
    if (activeChild.generationMode) return activeChild.generationMode;
    queue.push(...(childrenByParent.get(child.id) ?? []));
  }
  return fallbackMode;
}

export function cloneMessagePath(path: ChatMessage[], idPrefix: string) {
  const idMap = new Map<string, string>();
  return path.map((message, index) => {
    const nextId = `${idPrefix}-${index}-${message.id}`;
    idMap.set(message.id, nextId);
    const parentId = message.parentId ? idMap.get(message.parentId) ?? null : null;
    return {
      ...message,
      id: nextId,
      parentId,
      variants: message.variants?.map((variant) => ({
        ...variant,
        id: `${nextId}-${variant.id}`,
      })),
    };
  });
}

export type LinearChatContextMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatMessage["attachments"];
};

export function buildLinearChatContext(messages: ChatMessage[], activeMessageId?: string | null): LinearChatContextMessage[] {
  return getActiveMessagePath(messages, activeMessageId)
    .map(withActiveMessageVariant)
    .filter((message) => {
      if (!(message.kind === "text" || message.kind === "analysis" || message.kind === "error")) {
        return false;
      }
      return Boolean(localizedContentText(message.content).trim() || message.attachments?.length);
    })
    .map((message) => ({
      role: message.role,
      content: localizedContentText(message.content),
      attachments: message.attachments,
    }))
}

export function inferStoredWorkspaceMode({
  workspaceMode,
  messages,
  generationMode,
  activeResultId,
}: {
  workspaceMode?: unknown;
  messages: ChatMessage[];
  generationMode?: GenerationMode;
  activeResultId?: string | null;
}): WorkspaceModeLike {
  if (workspaceMode === "chat") {
    return "chat";
  }
  if (activeResultId || generationMode === "render3d" || generationMode === "colored_floor_plan") {
    return "image";
  }
  const hasImageWorkflowMessage = messages.some((message) => {
    const activeMessage = withActiveMessageVariant(message);
    return (
      activeMessage.kind === "analysis" ||
      activeMessage.kind === "render" ||
      Boolean(activeMessage.imageUrl || activeMessage.sourceResultId || activeMessage.promptText)
    );
  });
  if (workspaceMode === "image" && hasImageWorkflowMessage) {
    return "image";
  }
  return hasImageWorkflowMessage ? "image" : "chat";
}

export function messageToVariant(message: ChatMessage): ChatMessageVariant {
  return {
    id: `${message.id}-variant-0`,
    kind: message.kind,
    workflowMode: message.workflowMode,
    generationMode: message.generationMode,
    content: message.content,
    bullets: message.bullets,
    promptText: message.promptText,
    imageUrl: message.imageUrl,
    imageLabel: message.imageLabel,
    attachments: message.attachments,
    sourceResultId: message.sourceResultId,
    draftInstruction: message.draftInstruction,
    memoryCandidate: message.memoryCandidate,
    thinkingStatus: message.thinkingStatus,
    webSearch: message.webSearch,
  };
}

export function getMessageVariants(message: ChatMessage): ChatMessageVariant[] {
  return message.variants?.length ? message.variants : [messageToVariant(message)];
}

export function getActiveMessageVariant(message: ChatMessage): ChatMessageVariant {
  const variants = getMessageVariants(message);
  return variants[clampIndex(message.activeVariantIndex ?? variants.length - 1, variants.length)];
}

export function getActiveMessageVariantIndex(message: ChatMessage) {
  const variants = getMessageVariants(message);
  return clampIndex(message.activeVariantIndex ?? variants.length - 1, variants.length);
}

export function withActiveMessageVariant(message: ChatMessage): ChatMessage {
  const activeVariant = getActiveMessageVariant(message);
  return {
    ...message,
    kind: activeVariant.kind ?? message.kind,
    workflowMode: activeVariant.workflowMode ?? message.workflowMode,
    generationMode: activeVariant.generationMode ?? message.generationMode,
    content: activeVariant.content,
    bullets: activeVariant.bullets,
    promptText: activeVariant.promptText,
    imageUrl: activeVariant.imageUrl,
    imageLabel: activeVariant.imageLabel,
    attachments: activeVariant.attachments,
    sourceResultId: activeVariant.sourceResultId,
    draftInstruction: activeVariant.draftInstruction,
    memoryCandidate: activeVariant.memoryCandidate,
    thinkingStatus: activeVariant.thinkingStatus,
    webSearch: activeVariant.webSearch,
  };
}

export function appendMessageVariant(message: ChatMessage, patch: Partial<ChatMessageVariant>): ChatMessage {
  const variants = getMessageVariants(message);
  const nextVariant: ChatMessageVariant = {
    ...messageToVariant(message),
    id: patch.id || `${message.id}-variant-${variants.length}`,
    createdAt: new Date().toISOString(),
    ...patch,
  };
  const nextVariants = [...variants, nextVariant];
  return {
    ...message,
    ...withActiveMessageVariant({
      ...message,
      variants: nextVariants,
      activeVariantIndex: nextVariants.length - 1,
    }),
    variants: nextVariants,
    activeVariantIndex: nextVariants.length - 1,
  };
}

export function updateActiveMessageVariant(message: ChatMessage, patch: Partial<ChatMessageVariant>): ChatMessage {
  const variants = getMessageVariants(message);
  const activeVariantIndex = getActiveMessageVariantIndex(message);
  const nextVariants = variants.map((variant, index) => (
    index === activeVariantIndex
      ? { ...variant, ...patch }
      : variant
  ));
  return withActiveMessageVariant({
    ...message,
    variants: nextVariants,
    activeVariantIndex,
  });
}

export function setActiveMessageVariantIndex(message: ChatMessage, index: number): ChatMessage {
  const variants = getMessageVariants(message);
  const activeVariantIndex = clampIndex(index, variants.length);
  return withActiveMessageVariant({
    ...message,
    variants,
    activeVariantIndex,
  });
}

function localizedContentText(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content.trim();
  }
  return `${content.zh || ""} ${content.en || ""}`.trim();
}

export function hasMeaningfulMessage(message: ChatMessage) {
  const activeMessage = withActiveMessageVariant(message);
  const contentText = localizedContentText(activeMessage.content);
  const bulletText = activeMessage.bullets
    ? [...(activeMessage.bullets.zh ?? []), ...(activeMessage.bullets.en ?? [])].join(" ").trim()
    : "";

  return Boolean(
    contentText ||
    bulletText ||
    activeMessage.promptText?.trim() ||
    activeMessage.imageUrl ||
    activeMessage.attachments?.length
  );
}

export function countGenerationRecords(messages: ChatMessage[]) {
  return messages.filter((message) => {
    const activeMessage = withActiveMessageVariant(message);
    return activeMessage.kind === "render" && Boolean(activeMessage.imageUrl);
  }).length;
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
  activeMessageId?: string | null;
  chatInput: string;
  workspaceMode: string;
  generationMode: string;
  composerMode: string;
  activeResultId: string | null;
};

type ChatSessionSnapshotLike = SessionSnapshotLike & {
  messages: ChatMessage[];
};

function sameMessages(left: readonly unknown[], right: readonly unknown[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStoredSession<T extends SessionSnapshotLike>(left: T, right: T) {
  return (
    left.title === right.title &&
    left.updatedAt === right.updatedAt &&
    sameMessages(left.messages, right.messages) &&
    (left.activeMessageId ?? null) === (right.activeMessageId ?? null) &&
    left.chatInput === right.chatInput &&
    left.workspaceMode === right.workspaceMode &&
    left.generationMode === right.generationMode &&
    left.composerMode === right.composerMode &&
    left.activeResultId === right.activeResultId
  );
}

export function upsertSessionSnapshot<T extends SessionSnapshotLike>(list: T[], nextSession: T) {
  const existingIndex = list.findIndex((session) => session.id === nextSession.id);
  if (existingIndex >= 0) {
    const existing = list[existingIndex];
    if (sameMessages(existing.messages, nextSession.messages)) {
      const nextWithoutContentUpdate = {
        ...nextSession,
        updatedAt: existing.updatedAt,
      };
      if (sameStoredSession(existing, nextWithoutContentUpdate)) {
        return list;
      }
      return list.map((session, index) => index === existingIndex ? nextWithoutContentUpdate : session).slice(0, 20) as T[];
    }
  }
  return [
    nextSession,
    ...list.filter((session) => session.id !== nextSession.id),
  ].slice(0, 20);
}

export function mergeMessagesById(existingMessages: ChatMessage[], patch: ChatMessage[]): ChatMessage[] {
  const patchIds = new Set(patch.map((message) => message.id));
  return [
    ...existingMessages.filter((message) => !patchIds.has(message.id)),
    ...patch,
  ];
}

export function mergeMessageTreeById(existingMessages: ChatMessage[], patch: ChatMessage[], activeMessageId?: string | null) {
  return normalizeMessageTree(mergeMessagesById(existingMessages, patch), activeMessageId);
}

export function mergeMessagesIntoSessionSnapshot<T extends ChatSessionSnapshotLike>(
  list: T[],
  sessionId: string,
  patch: ChatMessage[],
  updatedAt: string
): T[] {
  const target = list.find((session) => session.id === sessionId);
  if (!target) return list;
  const nextTree = mergeMessageTreeById(target.messages, patch, patch[patch.length - 1]?.id ?? target.activeMessageId);
  return upsertSessionSnapshot(list, {
    ...target,
    messages: nextTree.messages,
    activeMessageId: nextTree.activeMessageId,
    updatedAt,
  });
}

export type ConversationRunGuard = {
  userId: string;
  epoch: number;
  sessionId: string;
};

export function isCurrentConversationRun(
  guard: ConversationRunGuard,
  currentUserId: string,
  currentEpoch: number
) {
  return guard.userId === currentUserId && guard.epoch === currentEpoch;
}
