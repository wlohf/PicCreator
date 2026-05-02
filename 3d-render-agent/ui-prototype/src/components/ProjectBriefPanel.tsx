import { ImagePlus, Upload } from "lucide-react";

import type { Locale } from "../types/domain";
import { StatusBadge } from "./StatusBadge";

type ProjectBriefCopy = {
  projectBrief: string;
  projectName: string;
  rendering: string;
  ready: string;
  replaceFloorPlan: string;
  designRequest: string;
};

export function ProjectBriefPanel({
  locale,
  copy,
  isRendering,
  floorPlanCount,
  floorPlanNames,
  referenceFileName,
  onPickFloorPlan,
  onPickReference,
}: {
  locale: Locale;
  copy: ProjectBriefCopy;
  isRendering: boolean;
  floorPlanCount: number;
  floorPlanNames: string[];
  referenceFileName: string;
  onPickFloorPlan: () => void;
  onPickReference: () => void;
}) {
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
        <div className={`brief-dropzone ${floorPlanCount === 0 ? "brief-dropzone--empty" : ""}`}>
          <div className="brief-dropzone__icon">
            <Upload size={18} />
          </div>
          <div className="brief-dropzone__copy">
            <p className="eyebrow">{locale === "zh" ? "平面图" : "Floor plan"}</p>
            <strong>{floorPlanCount === 0 ? (locale === "zh" ? "尚未上传平面图" : "No floor plan yet") : locale === "zh" ? `已选 ${floorPlanCount} 张平面图` : `${floorPlanCount} floor plan file(s)`}</strong>
            <p>{locale === "zh" ? "上传后，后端会根据平面图和需求一起生成提示词。" : "After upload, the backend combines the floor plan and brief into the generation prompt."}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onPickFloorPlan}>
            <Upload size={16} />
            {copy.replaceFloorPlan}
          </button>
        </div>

        <button className="brief-reference" type="button" onClick={onPickReference}>
          <span className="brief-reference__icon">
            <ImagePlus size={16} />
          </span>
          <span className="brief-reference__copy">
            <strong>{locale === "zh" ? "参考图" : "Reference image"}</strong>
            <em>{referenceFileName || (locale === "zh" ? "可选，不上传也能继续" : "Optional, you can continue without one")}</em>
          </span>
          <span className="brief-reference__state">{referenceFileName ? (locale === "zh" ? "已选" : "Selected") : (locale === "zh" ? "未选" : "Empty")}</span>
        </button>

        {floorPlanCount > 0 && (
          <ul className="brief-file-list">
            {floorPlanNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}

        <div className="brief-note">
          <div className="section-title">{copy.designRequest}</div>
          <p>{locale === "zh" ? "设计需求写在中间输入框，右侧再补充可编辑的设计指令栈。" : "Write the brief in the center composer, then refine it with the editable direction stack on the right."}</p>
        </div>
      </div>
    </aside>
  );
}
