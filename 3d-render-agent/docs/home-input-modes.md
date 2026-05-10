# Home Input Modes

The home workspace supports three generation modes:

- `standard`: strict pass-through. Composer text is sent directly to the image model. Uploaded or pasted images are forwarded as image inputs when the selected model supports image input. Requirement parsing, floor-plan analysis, prompt compilation, and quality-evaluation prompts are skipped unless the user explicitly enables image-model capabilities outside this mode.
- `render3d`: floor-plan-aware 3D rendering. Uploaded, pasted, or dropped images are treated as floor plans and routed through floor-plan analysis, prompt generation, image generation, and optional evaluation.
- `colored_floor_plan`: floor-plan colorization. Requires at least one floor-plan image, preserves the original layout, and asks the image model for an orthographic colored plan rather than a 3D render.

Reference-image upload is intentionally not part of the home generation flow. The only image attachment slot is the floor-plan attachment list.

## Comparison Behavior

- `render3d` and `colored_floor_plan` results can compare the persisted floor plan against the generated image.
- `standard` results are not bound to a floor plan. Their comparison modal lets the user pick two generated history images.

## Notes And Annotations

Each result can store free-form `notes`. Notes are scoped to the result record, persist in the local result store, and do not require login. Use notes for review comments, follow-up ideas, or describing the intent behind a manual annotation.

Annotation edits are separate from notes. The annotation editor lets the user draw on the current result image and submit an edit request. The backend stores the submitted annotation image plus the model's structured annotation analysis on the new edited result version.

## Shortcut Phrases And New Chat

Shortcut phrases are managed from the composer utility row or the right-side phrases drawer. The manager supports adding, editing, deleting, resetting defaults, and inserting a phrase into the single main composer. It must not create a second prompt input on the home screen.

The New chat action only creates a new session when the current session has meaningful content: draft text, attachments, in-flight generation content, or messages/results in the conversation. If the current session is already empty, New chat is disabled/no-op so the user is not moved into another blank conversation.
