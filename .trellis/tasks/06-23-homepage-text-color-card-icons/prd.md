# Adjust homepage text color and card icons

## Goal

Tune the empty homepage visual balance so the hero keeps the softer redesign feel while the headline has more presence, and the six prompt starter card icons no longer feel too close to the top edge.

## Requirements

* Slightly deepen the empty homepage hero title color compared with the current faded gray treatment.
* Keep prompt card title and description copy styling intact.
* Move the icon chip in each of the six starter cards down a few pixels without changing the card content or icon set.
* Keep the change scoped to the existing frontend styling layer.

## Acceptance Criteria

* [ ] The empty homepage hero title is visibly darker than the current screenshot 2 state but still softer than screenshot 1.
* [ ] The six starter card icons sit lower in their cards by a small amount and still align consistently.
* [ ] No React behavior, prompt content, or icon choice changes are introduced.
* [ ] Frontend checks relevant to this styling-only change pass or any unavailable checks are reported.

## Definition of Done

* Specs for the frontend layer have been consulted.
* The targeted CSS is updated with a minimal diff.
* A quick verification command is run.

## Technical Approach

Update the later `chatgpt-empty` CSS overrides in `attuno-studio/ui-prototype/src/styles.css`, because those rules control the visible empty conversation state shown in the screenshots.

## Out of Scope

* Changing card copy, layout width, icon choices, or homepage spacing beyond the icon chip offset.
* Changing backend behavior or chat workflow logic.

## Technical Notes

* Component: `attuno-studio/ui-prototype/src/components/chat-workspace.tsx`
* Styling: `attuno-studio/ui-prototype/src/styles.css`
* Frontend spec index and applicable frontend guideline stubs were inspected.
