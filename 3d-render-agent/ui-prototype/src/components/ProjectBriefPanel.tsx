import { CheckCircle2, ClipboardList, Upload } from "lucide-react";

import { referenceAssets, styleTokens } from "../data/studioData";
import type { Locale } from "../types/domain";
import { StatusBadge } from "./StatusBadge";

type ProjectBriefCopy = {
  projectBrief: string;
  projectName: string;
  rendering: string;
  ready: string;
  replaceFloorPlan: string;
  designRequest: string;
  designRequestCopy: string;
};

export function ProjectBriefPanel({ locale, copy, isRendering }: { locale: Locale; copy: ProjectBriefCopy; isRendering: boolean }) {
  return (
    <aside className="panel brief-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{copy.projectBrief}</p>
          <h2>{copy.projectName}</h2>
        </div>
        <StatusBadge tone={isRendering ? "warn" : "good"}>{isRendering ? copy.rendering : copy.ready}</StatusBadge>
      </div>

      <div className="upload-zone">
        <div className="floor-plan-preview">
          <span className="plan-room plan-room--living">{locale === "zh" ? "客厅" : "Living"}</span>
          <span className="plan-room plan-room--dining">{locale === "zh" ? "餐厅" : "Dining"}</span>
          <span className="plan-room plan-room--suite">{locale === "zh" ? "套间" : "Suite"}</span>
          <span className="plan-window" />
        </div>
        <button className="ghost-button">
          <Upload size={16} />
          {copy.replaceFloorPlan}
        </button>
      </div>

      <div className="asset-stack">
        {referenceAssets.map((asset) => {
          const Icon = asset.icon;
          return (
            <button className="asset-row" key={asset.label.en}>
              <div className="asset-icon">
                <Icon size={17} />
              </div>
              <div>
                <h3>{asset.label[locale]}</h3>
                <p>{asset.meta[locale]}</p>
              </div>
              <CheckCircle2 size={17} className="asset-check" />
            </button>
          );
        })}
      </div>

      <div className="brief-copy">
        <div className="section-title">
          <ClipboardList size={16} />
          {copy.designRequest}
        </div>
        <p>{copy.designRequestCopy}</p>
      </div>

      <div className="token-wrap">
        {styleTokens.map((token) => (
          <span className="style-token" key={token.en}>
            {token[locale]}
          </span>
        ))}
      </div>
    </aside>
  );
}
