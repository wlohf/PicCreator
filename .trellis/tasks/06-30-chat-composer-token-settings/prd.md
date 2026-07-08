# Fix Chat Composer Wrapping And Model Token Settings

## Goal

Improve the chat composer so long input wraps onto new lines instead of visually extending to the right, and make chat model output token / context size settings visible in the settings UI.

## Requirements

* The main chat composer textarea must wrap long text within its container.
* The composer should start at one visible line, grow to two lines when needed, and cap around three comfortable lines before scrolling.
* During streaming output, the chat view should auto-follow only while the user is near the bottom; if the user scrolls upward, keep their reading position until they return to the bottom.
* The settings UI should expose chat output token count and context size fields near the analysis/chat model configuration.
* Chat output token count should be saved and used by the `/api/chat` and `/api/chat/stream` daily chat path instead of the hard-coded default.
* Context size should be saved and loaded as configuration so the user can see and edit it; deeper prompt truncation can remain out of scope if the current backend does not have a context-window budgeting layer.

## Acceptance Criteria

* [ ] Long unbroken text in the composer wraps within the visible composer width.
* [ ] Composer textarea starts compact for one-line input, grows with content, and caps around three visible lines before internal scrolling.
* [ ] Streaming chat output does not force-scroll down after the user scrolls up to read earlier messages.
* [ ] Returning to the bottom restores automatic follow behavior for new streamed content.
* [ ] Settings contain numeric controls for output token count and context size.
* [ ] Saved config round-trips the new numeric fields through frontend API types, backend config save/load, and local defaults.
* [ ] Daily chat model calls use the configured output token count, with sane fallback and bounds.
* [ ] Focused regression tests cover config round-trip and chat max token usage.

## Definition Of Done

* Run targeted backend tests for config and chat token behavior.
* Run frontend build or targeted test where feasible.
* Report any pre-existing dirty files or verification limitations.

## Technical Approach

* Patch the actual composer component plus the final effective CSS overrides near the end of `styles.css`.
* Extend `ApiConfig` and default config in the frontend.
* Extend backend config schema, save route form fields, and UI config mapping.
* Add `chatMaxOutputTokens` to `ChatApiConfig` and use it in `_daily_chat_max_tokens`.
* Keep context size as a saved configuration value for now because current chat routing does not implement token-budget trimming.

## Out Of Scope

* Full tokenization-based context trimming.
* New provider-specific token limit detection.
* Redesigning the settings modal beyond adding the necessary controls.

## Technical Notes

* Main composer component: `attuno-studio/ui-prototype/src/components/chat-workspace.tsx`.
* Effective composer CSS has multiple overrides in `attuno-studio/ui-prototype/src/styles.css`; final rules near the end must be patched.
* Existing backend chat default is `CHAT_RESPONSE_MAX_TOKENS = 131072` in `attuno-studio/backend/app/routes/chat.py`.
