import { formatDateRangeLabel, isResultInDateRange, normalizeDateRange, type DateRange } from "../src/components/ImageManagementPage.js";
import type { RenderHistoryItem } from "../src/types/domain.js";
import { mergeRenderHistoryItems } from "../src/utils/renderHistory.js";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function item(createdAt: string): RenderHistoryItem {
  return {
    id: createdAt,
    title: "Result",
    createdAt,
  };
}

const swapped = normalizeDateRange({ start: "2026-05-20", end: "2026-05-10" });
assert(swapped.start === "2026-05-10" && swapped.end === "2026-05-20", "date range should normalize reversed bounds");

const range: DateRange = { start: "2026-05-10", end: "2026-05-20" };
assert(isResultInDateRange(item("2026-05-10T00:00:00.000Z"), range), "range should include start-day results");
assert(isResultInDateRange(item("2026-05-20T23:59:59"), range), "range should include end-day local results");
assert(!isResultInDateRange(item("2026-05-21T00:00:00.000Z"), range), "range should exclude results after end date");
assert(isResultInDateRange(item("2026-05-15T12:00:00.000Z"), { start: "2026-05-12", end: "" }), "open-ended start range should include later dates");
assert(isResultInDateRange(item("2026-05-15T12:00:00.000Z"), { start: "", end: "2026-05-16" }), "open-ended end range should include earlier dates");
assert(!isResultInDateRange(item("not-a-date"), range), "invalid result dates should not match a constrained range");

assert(formatDateRangeLabel({ start: "2026-05-10", end: "2026-05-10" }, "zh") === "2026-05-10", "same-day range should collapse label");
assert(formatDateRangeLabel({ start: "2026-05-10", end: "" }, "zh") === "2026-05-10 之后", "start-only range should label after date in Chinese");
assert(formatDateRangeLabel({ start: "", end: "2026-05-20" }, "en") === "Before 2026-05-20", "end-only range should label before date in English");

const fullHistory = Array.from({ length: 20 }, (_, index) => item(`2026-05-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`));
const mergedHistory = mergeRenderHistoryItems(
  [
    { ...item("2026-05-03T12:00:00.000Z"), title: "Updated duplicate" },
    item("2026-06-01T12:00:00.000Z"),
  ],
  fullHistory
);
assert(mergedHistory.length === 21, "merging new results should preserve full image history instead of truncating to a preview count");
assert(mergedHistory[0].title === "Updated duplicate", "newer duplicate results should replace older entries at the front");
