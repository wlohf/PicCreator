# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

(To be filled by the team)

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

### Generation Mode And Result Metadata Types

Keep the frontend generation mode union aligned with the backend enum:

```typescript
type GenerationMode = "standard" | "render3d" | "colored_floor_plan";
```

Result-library records that can be rendered in the UI must include stable optional fields for source floor-plan comparison and user notes:

```typescript
type RenderHistoryItem = {
  id: string;
  mode: GenerationMode;
  imageUrl: string;
  floorPlanUrl?: string | null;
  notes?: string;
};
```

When adding a new mode or result metadata field, update the API client types, UI domain types, and backend schema/tests in the same task. Avoid accepting `string` for mode in component props once the value has crossed the API boundary.

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

(To be filled by the team)
