# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

### Conversation State

Conversation history should distinguish transient composer state from durable conversation content.

- Durable content: submitted user/assistant messages, render messages with an `imageUrl`, active rendering state, or live generation output.
- Transient content: unsent composer text, selected mode, active result selection, and attached floor-plan files that have not been submitted yet.
- When image composer attachments are submitted, snapshot the files into the durable user message before clearing composer state. Do not store message attachments as composer blob preview URLs because clearing `floorPlanFiles` revokes those URLs; use independent data URLs or backend asset URLs for message display, then clear transient attachments with the silent clear path.
- Source of truth: authenticated chat history must persist through `/api/chat-history`, scoped by the backend account session. Browser `localStorage` is only a cache and migration source for legacy sessions; it is not sufficient for deployable multi-user history.
- When loading browser-local chat history for a signed-in account, only inspect that account's Attuno/legacy keys. Do not scan `default`, generic keys, or other account namespaces, and do not copy another account's recovered payload into the current account key.
- If both backend and browser chat history are empty but server-side generated images exist, the frontend may reconstruct minimal historical generation sessions from image management so prior image work still has a conversation entry.
- The left history list sorts by the last durable conversation update. Opening a historical session, editing an unsent draft, switching workspace/generation mode, or changing the selected result may save that session in place, but must not refresh `updatedAt` or move it to the top.

Use a small helper for durable-content checks instead of repeating ad hoc truthiness in UI handlers.

```typescript
hasConversationContent({
  messages,
  generationRecordCount: countGenerationRecords(messages),
  isRendering,
  liveGenerationHasContent,
});
```

This contract matters for `New Conversation`: clicking it while the current session only has transient draft state should keep the user in the same empty session; clicking it after durable content exists may create/switch to a new session.

### Assistant Reply Retry Variants

Retrying a daily-chat assistant reply must update the original assistant message as a reply variant, not append the previous user prompt as a new user message.

**What**: Store alternate assistant replies on `ChatMessage.variants` and select the visible reply with `activeVariantIndex`.

```typescript
type ChatMessageVariant = {
  id: string;
  kind?: "text" | "analysis" | "render" | "error";
  workflowMode?: "chat" | "image";
  generationMode?: GenerationMode;
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  promptText?: string;
  imageUrl?: string;
  imageLabel?: string;
  attachments?: ChatImageAttachment[];
  sourceResultId?: string;
  draftInstruction?: string;
  memoryCandidate?: ChatMemoryCandidate;
  model?: string;
  createdAt?: string;
};
```

**Why**: Re-appending the same user prompt bloats visible history and saved conversation state. Message-level variants keep the original user turn single while still preserving previous assistant answers.

Image-workflow retries use the same variant contract. A retry may change the active output from `error` or `analysis` into `render`, so variant records must carry `kind`, `workflowMode`, `generationMode`, image fields, and source result ids. `withActiveMessageVariant(message)` must project those fields onto the visible message before rendering, copying, comparison, context building, generation-record counting, and workflow routing.

Use the shared helpers in `utils/chatSessions.ts` for variant-aware behavior:

```typescript
const activeMessage = withActiveMessageVariant(message);
const variants = getMessageVariants(message);
const nextMessage = appendMessageVariant(message, { content: retryReply, model });
```

Good:

```typescript
updateMessageById(targetAssistantId, (message) =>
  appendMessageVariant(message, { kind: "text", workflowMode: "chat", content: retryReply, model: retryModel })
);
```

Bad:

```typescript
setMessages((messages) => [
  ...messages,
  { role: "user", content: previousPrompt },
  { role: "assistant", content: retryReply },
]);
```

When rendering, copying, searching, checking durable content, or counting render records, resolve the active variant first. Old history without `variants` must still render by treating the base message as a single implicit variant.

Retry UI should show message-level version navigation (`1 / 2`, `2 / 2` with previous/next arrows) when `getMessageVariants(message).length > 1`. That control switches `activeVariantIndex`; it must not create, delete, or switch message-tree siblings.

### Branched Conversation Tree

Chat sessions now persist conversation state as a flat node list with parent links, while the visible thread stays linear.

- Source of truth for stored messages is `ChatMessage[]` plus `parentId` on each message and `activeMessageId` on the session record.
- The chat window renders only `getActiveMessagePath(messages, activeMessageId)`. Do not iterate over the entire stored message array for the visible thread.
- New user submits append a child under the current `activeMessageId`; the matching assistant reply appends under that new user node and then becomes the next `activeMessageId`.
- Editing a historical user message must not mutate that original node or move `activeMessageId` to the old user node, because that hides downstream assistant output from the active path. Keep the current visible branch intact, store the draft in message-level edit UI state, and only on submit create a new user sibling under the original parent with a fresh assistant child.
- Regenerating an assistant reply must not append duplicate user/assistant nodes. Add a message-level variant to the original assistant message, set `activeVariantIndex` to the newest variant, and move `activeMessageId` to that assistant message so old downstream output is not shown under the retry result.
- When a parent has multiple children of the same role, branch navigation controls should switch siblings by updating `activeMessageId` to the selected sibling or that sibling branch's deepest visible leaf.
- `Branch in new chat` copies the selected root-to-node path into a fresh session with new message ids. The new session must not share ids or parent references with the source session.
- Model API requests still receive a linear message path. Build that request context from `getActiveMessagePath(...)`, not from the entire stored tree.
- Legacy sessions that only stored a linear `messages` array must be normalized on load by filling `parentId` from the previous message chain and defaulting `activeMessageId` to the last message.

Branch navigation is for user edits and explicit branch exploration. Retry navigation is separate and uses `variants`; do not model retry as sibling assistant nodes.

### Chat View Scroll Boundary

Chat-like workspace pages should keep the app shell fixed to the viewport and put long conversation scrolling inside the message thread.

- `body`, `#root`, `.studio-shell`, `.chatgpt-layout`, and `.chatgpt-main` should not grow with message count.
- `.chatgpt-thread` is the primary scroll container for conversation content; composer controls stay in the bottom grid row.
- Parent grid children that contain the thread should use `min-height: 0` and `overflow: hidden`; otherwise nested overflow will fail and the browser page will grow after many turns.
- Empty-conversation layout is based on submitted/active content, not draft text. Use `messages.length === 0 && !isRendering && !isChatResponding`; do not include `chatInput.trim()` in the empty-state exit condition.
- While empty, keep the prompt/title area visible and place the composer in the central area. After the first submitted message, switch back to the standard bottom composer row.
- User text messages should not show a separate `You`/`你` label in the bubble; the right-aligned user bubble is enough sender identity.
- Avoid duplicating result-entry buttons in the main header when image management already owns the primary generated-image entry. Keep contextual image actions such as preview/compare where they operate on the active result.
- Keep operational diagnostics such as run status and floor-plan analysis under the settings menu's advanced entry, not as a primary header action. The main header should stay focused on mode switching and contextual image actions.
- Shortcut phrases are image-workspace composer helpers, not 3D-only controls. Show them whenever `workspaceMode === "image"` and `composerMode === "new-generation"` so standard image prompts, 3D prompts, and colored-plan flows can all reuse saved phrasing.
- Render shortcut phrase insertion from a compact right-header popover, near the phrase management action, not as a bottom row inside the composer. Keep the popover capped to the first 10 phrases and close it after insertion so the main textarea, send button, and mode row remain visually primary.
- Keep composer-side provider/model controls compact. Advanced or quality controls should not be added beside the send button once they have a drawer home.
- Strict review belongs under the settings menu's Advanced drawer together with run-stage diagnostics and floor-plan analysis. Do not duplicate it as a composer quick action.
- Treat `render3d` as a 3D prompt-enhancement mode rather than a separate image workflow. It accepts prompt-only generation; attached floor plans are optional structure references. `colored_floor_plan` remains a floor-plan tool and should keep requiring at least one image attachment.
- Compare analysis should use A/B slots. Build current-chat options from both image-workflow user message attachments and render messages in `getActiveMessagePath(...)`; submitted upload attachments are source-image candidates, render messages are result-image candidates. Label them uniquely for the current conversation, default A/B to the latest uploaded source image and latest generated/edited result when both exist, otherwise fall back to the latest two current-chat images. Then merge non-duplicate image-library options from `renderHistory` so either slot can be manually replaced. Only fall back to floor-plan-vs-render comparison when there are fewer than two distinct comparable images across the current chat and image library.
- Workspace-level drag-and-drop of image files should be accepted from any primary view, switch back into the image workspace, and append files to the current floor-plan attachments.
- Mobile layout may scroll the sidebar section, but the main conversation area should still preserve a fixed-height thread + composer structure.
- Regression checks should assert that the page shell uses viewport height and that `.chatgpt-thread` owns `overflow-y: auto`.

Wrong:

```css
.chatgpt-layout,
.chatgpt-main {
  min-height: 100vh;
}
```

Correct:

```css
.chatgpt-layout,
.studio-shell {
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.chatgpt-thread {
  min-height: 0;
  overflow-y: auto;
}
```

### Workspace Modes

The app has two top-level workspace modes:

- `chat`: daily conversation only. Composer submit must hit the chat path and must not trigger image generation implicitly.
- `image`: image workflow only. Generation mode selection (`standard`, `render3d`, `colored_floor_plan`) lives under this workspace.

Persist `workspaceMode` alongside session state so reopening a saved session restores the right composer behavior and empty-state copy.

Mode-switch UI guards and click handlers must use the same visible-conversation busy state. A background image generation in another session may block starting a second generation through the existing submit guard, but it must not prevent a newly opened blank conversation from switching between `chat` and `image`.

Persist message-level workflow hints for submitted turns that may later be edited or retried:

```typescript
type ChatMessage = {
  workflowMode?: "chat" | "image";
  generationMode?: GenerationMode;
};
```

Editing or retrying a historical image-generation user message, analysis, render, or generation error must route back through `runConversationFlow` and the stored `generationMode`; it must not switch to `chat` or call the daily chat model. For legacy messages without these hints, infer image workflow from image descendants such as `analysis`, `render`, `promptText`, `imageUrl`, or `sourceResultId`, while explicit `workflowMode: "chat"` remains a hard chat boundary.

When an image turn is created after a normal chat turn in the same branch, the image turn's own `workflowMode: "image"` wins over chat ancestors. Do not reject image routing merely because `getMessagePathTo(...)` includes earlier chat messages. The chat boundary only blocks legacy descendant-based inference for messages that do not carry their own image workflow signal.

```typescript
// Correct: target image message remains image-routed even under a chat ancestor.
if (activeMessage.workflowMode === "chat") return false;
if (isImageWorkflowOwnMessage(activeMessage)) return true;
```

Wrong:

```typescript
const hasChatBoundary = path.some((item) => item.workflowMode === "chat");
if (hasChatBoundary) return false;
```

If chat returns a reusable image draft, store it as a reversible suggestion and let the user switch into image mode explicitly. Do not auto-enter image generation from ordinary chat.

Daily chat image-draft routing must require an explicit image action such as drawing, rendering, or editing an image. Brainstorming requests about logo ideas, naming, style preference, or design direction remain ordinary chat even when an active generated result exists.

### Primary Views vs Workspace Modes

Use a separate primary-view state for full-page sidebar destinations that are not composer modes.

- `workspaceMode` remains limited to composer behavior: `chat` for daily conversation and `image` for image generation/editing.
- Full-page tools such as image management should use a separate view discriminator such as `PrimaryView = "workspace" | "image-management"`.
- Entering a full-page tool should close contextual right drawers (`activeUtilityPanel`) and preserve the current conversation, attachments, result history, and composer draft.
- Actions inside a full-page tool that need the composer, such as loading a prompt or continuing an image edit, should switch back to the workspace and explicitly set `workspaceMode` to `image`.
- Do not persist full-page tool state into chat session records unless reopening the exact tool view is a deliberate product requirement.

### Memory Writes

Chat-derived memory candidates should be manually confirmed before persistence.

- Allowed: show a preview of extracted likes/avoids/project constraints and expose a `Remember` action.
- Not allowed: silently merge every chat message into long-term preferences.
- Memory UI should separate daily chat memory from image preferences, avoid items, project preferences, evaluation standards, and recent derived edit patterns.
- Editable memory items should round-trip through the backend `GET/PATCH/DELETE /api/preferences/memory` API. Do not keep a UI-only memory list that can drift from prompt-injection context.

### Account Identity State

The main frontend identity model is the authenticated account session, not a temporary access token.

- On startup, call `/api/auth/me`. If authenticated through `attuno_session`, set the current user id from the returned account and bootstrap config, results, shortcuts, preferences, and chat history for that account.
- If unauthenticated, show the login/register dialog. Do not ask for a custom access token in the main UI.
- `apiFetch` should rely on `credentials: "include"` for the session cookie. Do not attach `X-Attuno-User-Token` or legacy `X-Render-Agent-User-Token` from the main frontend.
- On logout, clear visible conversation state, results, learned profile, API config cache for the active view, and auth draft/error state before showing the login dialog.
- Browser-local chat history can still be keyed by account `user_id`, but it must be treated as a cache/migration fallback and must not be visible when no account is authenticated.
- Namespace switches (login, logout, account swap) must clear any in-memory "last saved history" snapshot before bootstrapping the next account. Otherwise a previous account's serialized history can suppress writes or leak into the next account flow.
- Browser-local storage keys should use Attuno-branded primary keys such as `attuno-chat-history-v1`, `attuno-shortcut-phrases-v1`, `attuno-sidebar-width-v1`, `attuno-drawer-width-v1`, and `attuno-api-config-v1`.
- During the rename transition, the frontend may read legacy `render-director-*` localStorage keys, migrate the value into the matching Attuno key, and then save future writes only to the Attuno key.

### API Config Model Options State

Model dropdowns should reflect the user's configured and detected models, not product guesses.

- Source of truth for configured models is `apiConfig.analysisModel`, `apiConfig.imageModel`, and parsed `apiConfig.fallbackModels`.
- Detected model lists are transient UI state, e.g. `DetectedModelState = Record<"analysis" | "image", string[]>`; clear them when switching accounts, resetting config, or logging out.
- Keep raw detected lists separate from the smaller set the user has added to composer options. A model search result should not automatically flood the composer dropdown until the user clicks a detected chip or uses the add-all action.
- Chat composer model options should be built from the configured analysis model plus added detected analysis models only. Do not inject hard-coded defaults such as `gpt-4o`, Claude, or Gemini names.
- Image composer options may include current image model, fallback models, added detected image models, and the small built-in image-model starter list for empty/default setups.
- Detected analysis models may be multi-selected as composer candidates and saved in a browser-local, account-scoped list; `apiConfig.analysisModel` remains the single default model sent with a chat request.
- Multi-selecting detected image models should keep the first selected model as `imageModel` and serialize the remaining selected models into `fallbackModels`.
- Added model candidates must remain user-removable from the settings surface. Removing the current default model should promote the next selected candidate; removing image models should rewrite `imageModel` plus `fallbackModels` from the remaining ordered list.
- Detection failure is a status message, not a state reset; preserve the user's current typed values.
- Free-typed model fields are draft/default inputs. Do not persist every intermediate keystroke into composer model options; only store names that pass model-name validation or were explicitly selected from detected models. Filter obvious placeholders and partial fragments such as `g`, `gpt-`, `gpt-5.`, and `your-*-model` before writing browser-local model option lists, while preserving valid complete names such as `gpt-5`.

### Shortcut Phrase State

Shortcut phrases should be a single text field from the user's perspective.

- Store new shortcut phrases as `{ id, text }`.
- Normalize legacy `{ id, zh, en }` or string entries into the single text field on load so existing browser/backend data still works.
- The shortcut editor should render one textarea, not separate Chinese and English copies. Locale can affect labels and placeholders, but not the saved phrase schema.

### Result Asset URLs

Logged-in result assets should use session-cookie-backed URLs.

- For authenticated account users, normalize result image/download/annotation/floor-plan URLs without appending `user_id`.
- The `user_id` query parameter is only for default or legacy compatibility paths where the browser cannot send a namespace header.
- Keep result URL normalization in a small helper so list, note update, delete, clear, and render-message paths do not diverge.
- Account-scoped API calls such as chat history load/save, result listing, generation, and image edit should carry the active `user_id` in the request URL when compatibility namespace routing is needed. Do not rely on JSON or multipart body `user_id` fields alone for namespace resolution.

### Image Management State

Image management is the single full-page surface for generated-image browsing and batch operations. Do not reintroduce a separate result-library drawer or sidebar panel.

- Source of truth: `renderHistory`, loaded through `listResults(currentUserId)` from `/api/results`.
- Single-result actions should reuse shared result handlers where possible: preview, download, copy summary, load prompt, edit, annotate, notes, and delete.
- Batch deletion may call the existing per-result delete API until a backend batch endpoint exists, but the UI must update `renderHistory` and `activeResultId` consistently after each deleted item.
- Deleting from image management must not mutate or remove chat messages. Historical render messages keep their saved `imageUrl`; the backend preserves soft-deleted result assets so those URLs can still render outside the management list.
- Date filtering is view-local UI state. Do not mutate or re-fetch server state merely to apply a local date filter.
- If the management view offers destructive batch actions, keep selection state local to that view and clear selected ids after successful deletion or refresh removes the underlying records.

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)
