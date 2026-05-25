import type { RenderHistoryItem } from "../types/domain";

export function mergeRenderHistoryItems(newItems: RenderHistoryItem[], currentItems: RenderHistoryItem[]) {
  const newIds = new Set(newItems.map((item) => item.id));
  return [...newItems, ...currentItems.filter((item) => !newIds.has(item.id))];
}
