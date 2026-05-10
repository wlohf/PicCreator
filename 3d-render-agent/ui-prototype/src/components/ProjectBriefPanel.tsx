import { type DragEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import type { FilePreview, Locale, RenderHistoryItem } from "../types/domain";
import { StatusBadge } from "./StatusBadge";

type ProjectBriefCopy = {
  projectBrief: string;
  projectName: string;
  rendering: string;
  ready: string;
  designRequest: string;
};

export function ProjectBriefPanel({
  locale,
  copy,
  isRendering,
  floorPlanCount,
  floorPlanNames,
  floorPlanPreviews,
  historyItems,
  activeHistoryId,
  onSelectHistory,
  onOpenHistory,
  isDragActive,
  onRemoveFloorPlan,
  onDropFloorPlan,
}: {
  locale: Locale;
  copy: ProjectBriefCopy;
  isRendering: boolean;
  floorPlanCount: number;
  floorPlanNames: string[];
  floorPlanPreviews: FilePreview[];
  historyItems: RenderHistoryItem[];
  activeHistoryId: string | null;
  onSelectHistory: (id: string) => void;
  onOpenHistory: (item: RenderHistoryItem) => void;
  isDragActive: boolean;
  onRemoveFloorPlan: (index: number) => void;
  onDropFloorPlan: (event: DragEvent<HTMLElement>) => void;
}) {
  function allowAttachmentDrop(event: DragEvent<HTMLElement>) {
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  return (
    <aside className="panel brief-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{copy.projectBrief}</p>
          <h2>{copy.projectName}</h2>
        </div>
        <StatusBadge tone={isRendering ? "warn" : "good"}>{isRendering ? copy.rendering : copy.ready}</StatusBadge>
      </div>

      <div className="drop-zone">
        <div
          className={`brief-dropzone ${floorPlanCount === 0 ? "brief-dropzone--empty" : ""} ${isDragActive ? "brief-dropzone--dragging" : ""}`}
          onDragOver={allowAttachmentDrop}
          onDrop={onDropFloorPlan}
        >
          <span className="brief-dropzone__icon">
            <ImagePlus size={18} />
          </span>
          <span className="brief-dropzone__copy">
            <p className="eyebrow">{locale === "zh" ? "平面图" : "Floor plan"}</p>
            <strong>{floorPlanCount === 0 ? (locale === "zh" ? "拖到这里作为平面图" : "Drop here as floor plan") : locale === "zh" ? `已选 ${floorPlanCount} 张平面图` : `${floorPlanCount} floor plan file(s)`}</strong>
            <p>{locale === "zh" ? "支持拖放或粘贴图片；所有图片都会作为平面图附件。" : "Drop or paste images; every image is treated as a floor plan attachment."}</p>
          </span>
          {floorPlanPreviews.length > 0 ? (
            <span className="brief-preview-grid">
              {floorPlanPreviews.slice(0, 4).map((item, index) => (
                <span className="brief-preview-thumb" key={item.url}>
                  <img src={item.url} alt={item.name} />
                  <span className="brief-preview-name">{item.name}</span>
                  <button
                    className="brief-preview-remove"
                    type="button"
                    onClick={() => onRemoveFloorPlan(index)}
                    aria-label={locale === "zh" ? `删除平面图 ${item.name}` : `Remove floor plan ${item.name}`}
                    title={locale === "zh" ? "删除平面图" : "Remove floor plan"}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              ))}
              {floorPlanPreviews.length > 4 && <span className="brief-preview-more">+{floorPlanPreviews.length - 4}</span>}
            </span>
          ) : null}
        </div>
        <section className="brief-history-card">
          <div className="brief-history-head">
            <div>
              <div className="section-title">{locale === "zh" ? "历史图片库" : "Image history"}</div>
              <p>{locale === "zh" ? "以前生成的图片会保留在这里，可随时点击打开查看。" : "Previously generated images stay here for quick review."}</p>
            </div>
            <strong>{historyItems.length}</strong>
          </div>
          {historyItems.length > 0 ? (
            <div className="brief-history-grid">
              {historyItems.map((item) => {
                const active = item.id === activeHistoryId;
                return (
                  <button
                    className={`brief-history-thumb ${active ? "brief-history-thumb--active" : ""}`}
                    type="button"
                    key={item.id}
                    onClick={() => {
                      onSelectHistory(item.id);
                      onOpenHistory(item);
                    }}
                    disabled={!item.imageUrl}
                    title={item.imageLabel || item.title}
                  >
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.imageLabel || item.title} /> : <span />}
                    <em>{item.imageLabel || item.title}</em>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="brief-history-empty">{locale === "zh" ? "还没有历史图片，生成成功后会自动加入。" : "No image history yet. Successful generations are added automatically."}</p>
          )}
        </section>


        {floorPlanCount > 0 && (
          <ul className="brief-file-list">
            {floorPlanNames.map((name, index) => (
              <li key={`${name}-${index}`}>
                <span>{name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFloorPlan(index)}
                  aria-label={locale === "zh" ? `删除平面图 ${name}` : `Remove floor plan ${name}`}
                  title={locale === "zh" ? "删除平面图" : "Remove floor plan"}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="brief-note">
          <div className="section-title">{copy.designRequest}</div>
          <p>{locale === "zh" ? "设计需求写在中间输入框。图片可拖到页面或直接粘贴，都会作为平面图处理。" : "Write the brief in the center composer. Dropped or pasted images are all treated as floor plans."}</p>
        </div>
      </div>
    </aside>
  );
}
