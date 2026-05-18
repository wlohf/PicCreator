# rename attuno branding and internal app paths

## Goal

Rename the product branding from `PicCreator` / `PicCreator Chat` to `Attuno`, and rename the internal app folder / startup scripts from `3d-render-agent` to an Attuno-branded name where it is safe to do so, without renaming the outer workspace root or falsifying clearly historical references.

## What I already know

* User selected `Attuno` as the new English product name.
* Current visible branding appears in `README.md`, `attuno-studio/ui-prototype/index.html`, and `attuno-studio/ui-prototype/src/data/studioData.ts`.
* The main startup path was previously rooted at `3d-render-agent` with `start_3d_render_agent.bat`; tracked docs/tests/scripts need to follow the rename.
* Some additional `PicCreator` / `3d-render-agent` references exist in historical docs and path examples; those should not be blindly rewritten if they refer to real old paths or archived context.

## Assumptions (temporary)

* `Attuno AI` is the preferred in-product assistant label where the UI currently says `PicCreator AI`.
* `Attuno Studio` is the preferred internal app folder / launcher name replacing `3d-render-agent`.

## Open Questions

* None blocking for the first pass.

## Requirements

* Replace the main README product title/name with `Attuno`.
* Replace `PicCreator Chat` UI branding with `Attuno`.
* Replace `PicCreator AI` assistant label with `Attuno AI`.
* Rename the tracked internal app folder from `3d-render-agent` to `attuno-studio`.
* Rename the tracked startup scripts to Attuno-branded names and update script / doc / test references accordingly.
* Keep clearly historical or archived references only where rewriting them would be misleading.

## Acceptance Criteria

* [ ] README presents the project as `Attuno` and points to the renamed startup path.
* [ ] Browser title uses `Attuno`.
* [ ] Frontend seeded branding text uses `Attuno` / `Attuno AI`.
* [ ] The app folder and launchers are renamed to `attuno-studio` / `start_attuno_studio.bat` (plus the in-app Chinese launcher).
* [ ] Health-check strings, tests, and Vite warnings follow the renamed app identity.
* [ ] A follow-up search confirms remaining `3d-render-agent` references are intentional historical metadata only.

## Definition of Done

* User-visible naming updated in targeted files
* Internal app path / launcher rename completed
* Diff reviewed for accidental path/file renames
* Follow-up search run to verify remaining old-name references are historical/path-related only

## Out of Scope

* Renaming the repository directory
* Rewriting historical review docs that refer to real old paths or archived context

## Technical Notes

* Target files identified via `git grep`.
