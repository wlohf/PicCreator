import type { Tone } from "../types/domain";

export type ConfigStatusState = {
  tone: Tone;
  message: string;
};

export function ConfigStatus({ status }: { status: ConfigStatusState | null }) {
  if (!status) return null;
  return <p className={`config-status config-status--${status.tone}`}>{status.message}</p>;
}
