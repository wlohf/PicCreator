import { BadgeCheck, CircleDashed } from "lucide-react";

import { iterationRuns } from "../data/studioData";
import type { Locale } from "../types/domain";
import { StatusBadge } from "./StatusBadge";

type TimelineCopy = {
  timeline: string;
  runTrace: string;
  noteOpen: string;
  selectedStep: string;
};

export function TimelinePanel({
  locale,
  copy,
  activeStep,
  onSelectStep
}: {
  locale: Locale;
  copy: TimelineCopy;
  activeStep: string;
  onSelectStep: (step: string) => void;
}) {
  return (
    <section className="timeline-panel">
      <div className="timeline-heading">
        <div>
          <p className="eyebrow">{copy.timeline}</p>
          <h2>{copy.runTrace}</h2>
        </div>
        <div className="timeline-meta">
          <StatusBadge tone="warn">{copy.noteOpen}</StatusBadge>
          <span>
            {copy.selectedStep}: {activeStep}
          </span>
        </div>
      </div>
      <div className="timeline-grid">
        {iterationRuns.map((run) => (
          <button
            className={`timeline-card timeline-card--${run.status} ${activeStep === run.step ? "timeline-card--active" : ""}`}
            key={run.step}
            onClick={() => onSelectStep(run.step)}
          >
            <div className="timeline-step">
              <span>{run.step}</span>
              {run.status === "accepted" ? <BadgeCheck size={18} /> : <CircleDashed size={18} />}
            </div>
            <h3>{run.title[locale]}</h3>
            <p>{run.model}</p>
            <div className="timeline-score">{run.score[locale]}</div>
            <ul>
              {run.notes[locale].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </section>
  );
}
