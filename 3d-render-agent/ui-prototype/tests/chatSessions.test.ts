import { countGenerationRecords, hasConversationContent, hasDurableConversationContent, isCurrentConversationRun } from "../src/utils/chatSessions.js";
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

const runGuard = { userId: "alpha", epoch: 1 };

assert(isCurrentConversationRun(runGuard, "alpha", 1), "matching token and epoch should allow async conversation updates");
assert(!isCurrentConversationRun(runGuard, "beta", 1), "token switches should reject stale async conversation updates");
assert(!isCurrentConversationRun(runGuard, "alpha", 2), "namespace epoch changes should reject stale async conversation updates");
