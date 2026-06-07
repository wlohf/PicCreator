import type { Tone } from "../types/domain";

export function StatusBadge({ children, tone = "neutral" }: { children: string; tone?: Tone }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
