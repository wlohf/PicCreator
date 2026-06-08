import { appendMessageVariant, buildLinearChatContext, cloneMessagePath, countGenerationRecords, getActiveMessagePath, getActiveMessageVariant, getActiveMessageVariantIndex, hasConversationContent, hasDurableConversationContent, inferMessageGenerationMode, inferStoredWorkspaceMode, isCurrentConversationRun, isImageWorkflowMessage, mergeMessagesIntoSessionSnapshot, normalizeMessageTree, setActiveMessageVariantIndex, switchMessageSibling, upsertSessionSnapshot } from "../src/utils/chatSessions.js";
import { modelOptions } from "../src/data/studioData.js";
import type { ChatMessage } from "../src/types/domain.js";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const emptyMessages: ChatMessage[] = [];

assert(!hasConversationContent({ messages: emptyMessages }), "empty session should have no content");
assert(!hasDurableConversationContent(emptyMessages), "blank sessions should not appear in chat history");
assert(hasConversationContent({ messages: emptyMessages, generationRecordCount: 1 }), "generation records should count as conversation content");

const userMessage: ChatMessage = {
  id: "user-1",
  role: "user",
  kind: "text",
  content: "add warm walnut cabinets",
};

assert(hasConversationContent({ messages: [userMessage] }), "submitted user messages should count as conversation content");
assert(hasDurableConversationContent([userMessage]), "submitted user messages should appear in chat history");

const renderMessage: ChatMessage = {
  id: "render-1",
  role: "assistant",
  kind: "render",
  content: { zh: "", en: "" },
  imageUrl: "/api/results/result-1/image",
};

assert(hasConversationContent({ messages: [renderMessage] }), "render output should count as conversation content");
assert(hasDurableConversationContent([renderMessage]), "render output should appear in chat history");
assert(countGenerationRecords([renderMessage]) === 1, "render image messages should count as generation records");
assert(countGenerationRecords(emptyMessages) === 0, "empty sessions should have no generation records");
assert(!hasConversationContent({ messages: emptyMessages, generationRecordCount: 0 }), "selected historical results alone should not make an empty session non-empty");
assert(hasConversationContent({ messages: emptyMessages, liveGenerationHasContent: true }), "in-flight generation content should block empty-session reset");
assert(!hasDurableConversationContent(emptyMessages), "transient live state should not make an empty session durable");

const variantBaseMessage: ChatMessage = {
  id: "assistant-variant",
  role: "assistant",
  kind: "text",
  content: "First answer",
};
const variantMessage = appendMessageVariant(variantBaseMessage, {
  id: "assistant-variant-retry",
  content: "Second answer",
  model: "gpt-5.5",
});
assert(getActiveMessageVariantIndex(variantMessage) === 1, "appending a variant should select the newest response");
assert(getActiveMessageVariant(variantMessage).content === "Second answer", "active variant should expose retry content");
assert(hasConversationContent({ messages: [variantMessage] }), "messages with variants should count as conversation content");
const previousVariantMessage = setActiveMessageVariantIndex(variantMessage, 0);
assert(getActiveMessageVariant(previousVariantMessage).content === "First answer", "variant switch should show the previous response without dropping variants");
assert(previousVariantMessage.variants?.length === 2, "variant switch should preserve all responses");

const imageErrorMessage: ChatMessage = {
  id: "image-error",
  parentId: "image-user",
  role: "assistant",
  kind: "error",
  workflowMode: "image",
  generationMode: "standard",
  content: "First image attempt failed",
};
const imageRetryMessage = appendMessageVariant(imageErrorMessage, {
  id: "image-error-retry",
  kind: "render",
  workflowMode: "image",
  generationMode: "render3d",
  content: "Retry image returned",
  imageUrl: "/api/results/retry/image",
  sourceResultId: "retry-result",
});
const activeImageRetry = getActiveMessageVariant(imageRetryMessage);
assert(activeImageRetry.kind === "render", "image retry variants should carry their own message kind");
assert(activeImageRetry.workflowMode === "image", "image retry variants should preserve image workflow routing");
assert(activeImageRetry.generationMode === "render3d", "image retry variants should preserve the generation mode used for the retry");
assert(
  setActiveMessageVariantIndex(imageRetryMessage, 0).kind === "error",
  "switching back to the original variant should restore the original message kind",
);

const runGuard = { userId: "alpha", epoch: 1, sessionId: "session-1" };

assert(isCurrentConversationRun(runGuard, "alpha", 1), "matching token and epoch should allow async conversation updates");
assert(!isCurrentConversationRun(runGuard, "beta", 1), "token switches should reject stale async conversation updates");
assert(!isCurrentConversationRun(runGuard, "alpha", 2), "namespace epoch changes should reject stale async conversation updates");

const baseSession = {
  id: "session-1",
  title: "Session 1",
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
  messages: [userMessage],
  activeMessageId: "user-1",
  chatInput: "warm wood",
  workspaceMode: "image",
  generationMode: "standard",
  composerMode: "new-generation",
  activeResultId: null,
};

const unchangedSession = {
  ...baseSession,
  updatedAt: "2026-05-11T00:01:00.000Z",
};

const stableList = [baseSession];
assert(
  upsertSessionSnapshot(stableList, unchangedSession) === stableList,
  "unchanged session snapshots should not force another state update",
);

const secondSession = {
  ...baseSession,
  id: "session-2",
  title: "Session 2",
  updatedAt: "2026-05-11T00:02:00.000Z",
};
const reordered = upsertSessionSnapshot([secondSession, baseSession], unchangedSession);
assert(reordered[0].id === "session-2", "opening an unchanged older session should not move it to the front");
assert(reordered[1].updatedAt === baseSession.updatedAt, "opening an unchanged session should preserve its last content update time");

const draftOnlySession = {
  ...baseSession,
  chatInput: "draft that has not been sent",
  updatedAt: "2026-05-11T00:03:00.000Z",
};
const draftList = upsertSessionSnapshot([secondSession, baseSession], draftOnlySession);
assert(draftList[0].id === "session-2", "editing transient draft text should not reorder chat history");
assert(draftList[1].chatInput === draftOnlySession.chatInput, "transient draft text should still be saved in place");
assert(draftList[1].updatedAt === baseSession.updatedAt, "transient draft text should not update the durable conversation timestamp");

const editedSession = {
  ...baseSession,
  messages: [
    ...baseSession.messages,
    {
      id: "assistant-1",
      role: "assistant",
      kind: "text",
      content: "new content",
    } satisfies ChatMessage,
  ],
  updatedAt: "2026-05-11T00:04:00.000Z",
};
const updatedList = upsertSessionSnapshot([secondSession, baseSession], editedSession);
assert(updatedList[0].id === "session-1", "sessions with new conversation content should move to the front");
assert(updatedList[0].updatedAt === editedSession.updatedAt, "sessions with new conversation content should keep the new update time");

const backgroundAssistantMessage: ChatMessage = {
  id: "assistant-background",
  parentId: "user-1",
  role: "assistant",
  kind: "text",
  content: "Background response",
};
const visibleSession = {
  ...secondSession,
  messages: [
    {
      id: "visible-user",
      parentId: null,
      role: "user",
      kind: "text",
      content: "visible session prompt",
    } satisfies ChatMessage,
  ],
};
const routedBackgroundUpdate = mergeMessagesIntoSessionSnapshot(
  [visibleSession, baseSession],
  "session-1",
  [backgroundAssistantMessage],
  "2026-05-11T00:05:00.000Z",
);
assert(
  routedBackgroundUpdate[0].id === "session-1" && routedBackgroundUpdate[0].messages.some((message) => message.id === "assistant-background"),
  "background run updates should be routed to the original run session",
);
assert(
  routedBackgroundUpdate.find((session) => session.id === "session-2")?.messages.length === visibleSession.messages.length,
  "background run updates should leave the currently selected visible session unchanged",
);

const linearized = normalizeMessageTree([
  { id: "u1", role: "user", kind: "text", content: "first" },
  { id: "a1", role: "assistant", kind: "text", content: "answer" },
  { id: "u2", role: "user", kind: "text", content: "second" },
] satisfies ChatMessage[]);
assert(linearized.messages[0].parentId === null, "first historical message should normalize to root");
assert(linearized.messages[1].parentId === "u1", "second historical message should normalize to the previous node");
assert(linearized.messages[2].parentId === "a1", "later historical messages should preserve linear parent chaining");
assert(linearized.activeMessageId === "u2", "normalized history should point activeMessageId at the last message by default");

const branchedMessages: ChatMessage[] = [
  { id: "u-root", parentId: null, role: "user", kind: "text", content: "root" },
  { id: "a-root-1", parentId: "u-root", role: "assistant", kind: "text", content: "answer 1" },
  { id: "a-root-2", parentId: "u-root", role: "assistant", kind: "text", content: "answer 2" },
  { id: "u-follow", parentId: "a-root-2", role: "user", kind: "text", content: "follow up" },
];
const activePath = getActiveMessagePath(branchedMessages, "u-follow");
assert(activePath.map((message) => message.id).join(",") === "u-root,a-root-2,u-follow", "active path should render only the selected branch");
assert(switchMessageSibling(branchedMessages, "a-root-2", -1) === "a-root-1", "branch switch should move to the assistant sibling when no deeper child exists");

const clonedPath = cloneMessagePath(activePath, "branch-copy");
assert(clonedPath.length === 3, "cloned branch path should preserve message count");
assert(clonedPath[0].parentId === null && clonedPath[1].parentId === clonedPath[0].id, "cloned branch path should rewire parent ids to the new copy");

const contextMessages = buildLinearChatContext(branchedMessages, "u-follow");
assert(contextMessages.length === 3, "linear chat context should follow the active branch only");
assert(contextMessages[1].content === "answer 2", "linear chat context should include the active sibling response");

const attachmentContext = buildLinearChatContext([
  {
    id: "u-image",
    parentId: null,
    role: "user",
    kind: "text",
    content: "这图里面讲的什么？",
    attachments: [{
      id: "img-1",
      name: "upload.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AA==",
    }],
  },
] satisfies ChatMessage[], "u-image");
assert(attachmentContext[0].attachments?.[0].dataUrl === "data:image/png;base64,AA==", "linear chat context should preserve image attachments on the active user turn");

assert(
  inferStoredWorkspaceMode({ messages: [userMessage] }) === "chat",
  "legacy text-only sessions without workspaceMode should reopen in chat mode so they can continue as conversations",
);
assert(
  inferStoredWorkspaceMode({ workspaceMode: "image", messages: [userMessage] }) === "chat",
  "legacy text-only sessions saved with the old image default should still reopen in chat mode",
);
assert(
  inferStoredWorkspaceMode({ messages: [renderMessage] }) === "image",
  "legacy render sessions without workspaceMode should still reopen in image mode",
);

assert(!modelOptions.includes("dall-e-3"), "built-in image model options should not include unavailable DALL-E placeholders");
assert(!modelOptions.includes("imagen-preview"), "built-in image model options should not include unavailable Imagen placeholders");

const imageWorkflowMessages: ChatMessage[] = [
  {
    id: "m-user-image",
    parentId: null,
    role: "user",
    kind: "text",
    content: "画一张室内图",
    workflowMode: "image",
    generationMode: "standard",
  },
  {
    id: "m-api-error-image",
    parentId: "m-user-image",
    role: "assistant",
    kind: "error",
    content: "画图失败",
    workflowMode: "image",
    generationMode: "standard",
  },
];
assert(isImageWorkflowMessage(imageWorkflowMessages, "m-user-image"), "image user prompts should be routed back through image generation when edited or resent");
assert(isImageWorkflowMessage(imageWorkflowMessages, "m-api-error-image"), "image generation errors should retry with image generation instead of chat");
assert(inferMessageGenerationMode(imageWorkflowMessages, "m-api-error-image", "render3d") === "standard", "image retries should preserve the original generation mode when it is stored");

const imageBranchAfterChatMessages: ChatMessage[] = [
  {
    id: "m-chat-user-root",
    parentId: null,
    role: "user",
    kind: "text",
    content: "先聊一下方案",
    workflowMode: "chat",
  },
  {
    id: "m-chat-ai-root",
    parentId: "m-chat-user-root",
    role: "assistant",
    kind: "text",
    content: "可以，后续也能继续生图。",
    workflowMode: "chat",
  },
  {
    id: "m-user-image-after-chat",
    parentId: "m-chat-ai-root",
    role: "user",
    kind: "text",
    content: "把这张图改成两层别墅",
    workflowMode: "image",
    generationMode: "standard",
  },
  {
    id: "m-api-render-after-chat",
    parentId: "m-user-image-after-chat",
    role: "assistant",
    kind: "render",
    content: "图片结果",
    workflowMode: "image",
    generationMode: "standard",
    imageUrl: "/api/results/result-after-chat/image",
  },
];
assert(
  isImageWorkflowMessage(imageBranchAfterChatMessages, "m-user-image-after-chat"),
  "image prompts created after a chat turn should still edit/regenerate through the image workflow",
);
assert(
  isImageWorkflowMessage(imageBranchAfterChatMessages, "m-api-render-after-chat"),
  "image render replies after a chat turn should still retry through the image workflow",
);

const legacyImageWorkflowMessages: ChatMessage[] = [
  {
    id: "legacy-user",
    parentId: null,
    role: "user",
    kind: "text",
    content: "重新画一下这个空间",
  },
  {
    id: "legacy-analysis",
    parentId: "legacy-user",
    role: "assistant",
    kind: "analysis",
    content: "正在准备图片",
  },
  {
    id: "legacy-render",
    parentId: "legacy-analysis",
    role: "assistant",
    kind: "render",
    content: "图片结果",
    imageUrl: "/api/results/result-1/image",
  },
];
assert(isImageWorkflowMessage(legacyImageWorkflowMessages, "legacy-user"), "legacy user prompts with image descendants should still route through image generation");

const chatWorkflowMessages: ChatMessage[] = [
  {
    id: "m-chat-user",
    parentId: null,
    role: "user",
    kind: "text",
    content: "聊一下设计思路",
    workflowMode: "chat",
  },
  {
    id: "m-chat-ai",
    parentId: "m-chat-user",
    role: "assistant",
    kind: "text",
    content: "可以从材质和采光开始。",
    workflowMode: "chat",
  },
];
assert(!isImageWorkflowMessage(chatWorkflowMessages, "m-chat-user"), "ordinary chat user prompts should keep using the chat model");
assert(!isImageWorkflowMessage(chatWorkflowMessages, "m-chat-ai"), "ordinary chat assistant retries should keep using the chat model");
