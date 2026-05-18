import type { Locale, LocalizedText } from "../types/domain";

export function localized(value: LocalizedText | string, locale: Locale) {
  return typeof value === "string" ? value : value[locale];
}

export function compactLines(values: string[]) {
  const lines = values.map((value) => value.trim()).filter(Boolean);
  return lines.length ? lines : ["OK"];
}
