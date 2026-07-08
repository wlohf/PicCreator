# Simplify provider API formats

## Goal

Simplify API provider setup so new users inherit the Xyleisure relay Base URL and only see three protocol choices: response, completion, and message.

## Requirements

* Change the default image provider Base URL from `https://api.bltcy.ai/v1` to `https://api.xyleisure.site/v1` in the local default config and the example template.
* Rename the default image provider away from BLTCY so new-user setup no longer presents the old provider as the default.
* Reduce user-facing API format choices to only `response`, `completion`, and `message`; do not show `config.json` as an API/key format.
* Keep legacy values such as `openai_chat`, `openai_responses`, `anthropic`, `openai_image`, `custom_openai_chat`, `custom_openai_image`, `gemini`, `azure_openai`, and `ollama` accepted as input aliases so old saved config can load and save cleanly.
* Normalize saved/displayed profile values to the three active internal route families: `openai_responses`, `openai_chat`, and `anthropic`.

## Acceptance Criteria

* [x] A fresh non-default user loading `/api/config` sees image Base URL `https://api.xyleisure.site/v1` and no default BLTCY provider label.
* [x] Backend UI choices expose only response, completion, and message protocol choices.
* [x] React settings dropdown exposes only response, completion, and message.
* [x] Empty/legacy UI format values normalize to `completion` rather than leaving a visible `config.json` fallback.
* [x] Legacy image/chat/provider aliases load into one of the three simplified choices without crashing.
* [x] Config save/load tests cover response, completion, and message, plus legacy alias collapse.
* [x] Frontend build passes.

## Definition of Done

* Backend tests updated and passing for config round-trip behavior.
* Frontend build/typecheck passes.
* Relevant Trellis spec is updated because this intentionally changes the previous provider-format contract.

## Technical Approach

Use `config.py` as the backend source of truth for supported formats and aliases. Keep adapter routing based on the existing canonical internal values (`openai_responses`, `openai_chat`, `anthropic`) while changing labels and UI option sets to the simpler product vocabulary. Update frontend normalization in `App.tsx` and choices in `studioData.ts` to match backend normalization.

## Decision (ADR-lite)

Context: The old selector mixed protocols, vendors, and adapter implementation details, which made provider setup confusing and exposed partially overlapping choices.

Decision: Collapse visible choices to three protocol families and treat old specific values as compatibility aliases.

Consequences: New saves become simpler, old configs still load, and OpenAI Images API-specific setup is no longer a visible separate format choice. `config.json` remains the real application config file, but is not presented as a user-selectable API protocol. Image generation remains supported through the existing image-role/model routing.

## Out of Scope

* Removing adapter code for old values in the same task.
* Migrating every existing user config file on disk beyond normal load/save normalization.
* Adding new provider-specific APIs.

## Technical Notes

* `app_runtime.py` uses `config.json` first, then `config.example.json`; both defaults matter for the user's reported new-user setup.
* The local `config.json` has no inline API key, only env references, and its image provider currently points to BLTCY.
* Existing memory for this repo says `api_format` is the runtime routing key and the required text verification families are chat completions, responses, and Anthropic messages.
