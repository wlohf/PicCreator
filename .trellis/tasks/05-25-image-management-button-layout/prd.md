# Fix Image Management Button Layout

## Goal

Repair the image management page controls so filter buttons, batch actions, and card action icons render with proper spacing, visible icons, and responsive wrapping.

## Requirements

* Keep the existing image management data flow and callbacks unchanged.
* Add scoped CSS for the `image-management-*` UI surface.
* Use the existing `lucide-react` icon system.
* Add an icon to the clear-selection action.
* Keep desktop and narrow viewport layouts readable without overlapping controls.

## Acceptance Criteria

* Date filter controls and action buttons have visible spacing, button chrome, and icons.
* Batch selection and bulk action buttons wrap cleanly when space is constrained.
* Image cards keep stable dimensions and card action buttons show icon-only controls.
* Disabled and danger states remain visually distinct.
* `npm run build` passes in `attuno-studio/ui-prototype`.

## Technical Approach

Patch `ImageManagementPage.tsx` only where the missing clear-selection icon is needed. Add scoped CSS rules in `src/styles.css` for page layout, filters, toolbar groups, buttons, cards, empty state, and responsive behavior.

## Out of Scope

* Backend/API behavior changes.
* Result deletion/download behavior changes.
* Whole-app visual redesign.
* New dependencies.
