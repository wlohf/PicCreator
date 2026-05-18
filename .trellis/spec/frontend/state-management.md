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

### Workspace Modes

The app has two top-level workspace modes:

- `chat`: daily conversation only. Composer submit must hit the chat path and must not trigger image generation implicitly.
- `image`: image workflow only. Generation mode selection (`standard`, `render3d`, `colored_floor_plan`) lives under this workspace.

Persist `workspaceMode` alongside session state so reopening a saved session restores the right composer behavior and empty-state copy.

If chat returns a reusable image draft, store it as a reversible suggestion and let the user switch into image mode explicitly. Do not auto-enter image generation from ordinary chat.

### Memory Writes

Chat-derived memory candidates should be manually confirmed before persistence.

- Allowed: show a preview of extracted likes/avoids/project constraints and expose a `Remember` action.
- Not allowed: silently merge every chat message into long-term preferences.
- Memory UI should separate daily chat memory from image preferences, avoid items, project preferences, evaluation standards, and recent derived edit patterns.
- Editable memory items should round-trip through the backend `GET/PATCH/DELETE /api/preferences/memory` API. Do not keep a UI-only memory list that can drift from prompt-injection context.

### Account Identity State

The main frontend identity model is the authenticated account session, not a temporary access token.

- On startup, call `/api/auth/me`. If authenticated, set the current user id from the returned account and bootstrap config, results, shortcuts, preferences, and chat history for that account.
- If unauthenticated, show the login/register dialog. Do not ask for a custom access token in the main UI.
- `apiFetch` should rely on `credentials: "include"` for the session cookie. Do not attach `X-Render-Agent-User-Token` from the main frontend.
- On logout, clear visible conversation state, results, learned profile, API config cache for the active view, and auth draft/error state before showing the login dialog.
- Browser-local chat history can still be keyed by account `user_id`, but it must not be visible when no account is authenticated.

### Result Asset URLs

Logged-in result assets should use session-cookie-backed URLs.

- For authenticated account users, normalize result image/download/annotation/floor-plan URLs without appending `user_id`.
- The `user_id` query parameter is only for default or legacy compatibility paths where the browser cannot send a namespace header.
- Keep result URL normalization in a small helper so list, note update, delete, clear, and render-message paths do not diverge.

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
