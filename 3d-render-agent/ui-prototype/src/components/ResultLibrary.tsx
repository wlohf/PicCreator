import { type FormEvent, useEffect, useState } from "react";
import { Clipboard, Clock3, Download, Edit3, ExternalLink, ImagePlus, Layers, PenTool, RotateCcw, Save, StickyNote, Trash2 } from "lucide-react";

import type { Locale, RenderHistoryItem } from "../types/domain";

export function ResultLibrary({
  locale,
  items,
  activeId,
  onSelect,
  onDownload,
  onOpen,
  onCopy,
  onUsePrompt,
  onEdit,
  onAnnotate,
  onSaveNotes,
  onRemove,
  onClear
}: {
  locale: Locale;
  items: RenderHistoryItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDownload: (item: RenderHistoryItem) => void;
  onOpen: (item: RenderHistoryItem) => void;
  onCopy: (item: RenderHistoryItem) => void;
  onUsePrompt: (item: RenderHistoryItem) => void;
  onEdit: (item: RenderHistoryItem) => void;
  onAnnotate: (item: RenderHistoryItem) => void;
  onSaveNotes: (item: RenderHistoryItem, notes: string) => Promise<void>;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) {
    return (
      <section className="result-library result-library--empty" aria-label={locale === "zh" ? "生成结果库" : "Result library"}>
        <div className="result-library-empty-icon" aria-hidden="true">
          <ImagePlus size={22} />
        </div>
        <div className="result-library-empty-copy">
          <p className="eyebrow">{locale === "zh" ? "结果库" : "Result Library"}</p>
          <strong>{locale === "zh" ? "还没有生成结果" : "No generated results yet"}</strong>
          <span>
            {locale === "zh"
              ? "生成成功后，最近结果会按时间保留在这里，可预览、对比、续改、下载并记录备注。"
              : "Successful generations will appear here with preview, compare, edit, download, and notes actions."}
          </span>
        </div>
        <div className="result-library-empty-steps" aria-hidden="true">
          <span>{locale === "zh" ? "上传或粘贴平面图" : "Upload or paste a floor plan"}</span>
          <span>{locale === "zh" ? "选择模式并生成" : "Choose a mode and generate"}</span>
          <span>{locale === "zh" ? "在这里管理结果" : "Manage results here"}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="result-library" aria-label={locale === "zh" ? "生成结果库" : "Result library"}>
      <div className="result-library-head">
        <div>
          <p className="eyebrow">{locale === "zh" ? "结果库" : "Result Library"}</p>
          <strong>{locale === "zh" ? `最近 ${items.length} 次生成` : `Last ${items.length} generations`}</strong>
        </div>
        <button className="result-library-clear" type="button" onClick={onClear}>
          <Trash2 size={13} />
          {locale === "zh" ? "清空" : "Clear"}
        </button>
      </div>
      <div className="result-library-list">
        {items.map((item) => {
          const active = activeId === item.id;
          const parent = item.parentId ? items.find((candidate) => candidate.id === item.parentId) : null;
          const modeLabel = getResultKindLabel(item, locale);
          const generationLabel = getGenerationModeLabel(item.generationMode, locale);
          const resultDetails = [
            parent ? `${locale === "zh" ? "上一版" : "Prev"} v${parent.versionIndex || 1}` : item.parentId ? `${locale === "zh" ? "上一版" : "Prev"} ${item.parentId.slice(-8)}` : "",
            item.editInstruction ? item.editInstruction : "",
            item.modelWarning ? (locale === "zh" ? "仅文本参考" : "Text-only reference") : "",
            item.floorPlanName ? `${locale === "zh" ? "平面图" : "Floor plan"}: ${item.floorPlanName}` : ""
          ].filter(Boolean).join(" · ");
          return (
            <article className={`result-card ${active ? "result-card--active" : ""}`} key={item.id}>
              <button
                className="result-card-main"
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onOpen(item);
                }}
              >
                <span className="result-card-thumb">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.imageLabel || item.title} />
                  ) : (
                    <span className="result-card-placeholder" />
                  )}
                </span>
                <span className="result-card-copy">
                  <span className="result-card-kicker">
                    <span>
                      <Layers size={12} />
                      {modeLabel}
                    </span>
                    <span>
                      <Clock3 size={12} />
                      {formatResultTime(item.createdAt, locale)}
                    </span>
                  </span>
                  <strong>{item.title}</strong>
                  <em>
                    {item.status || (locale === "zh" ? "已完成" : "Completed")}
                    {" · v"}{item.versionIndex || 1}
                    {generationLabel ? ` · ${generationLabel}` : ""}
                  </em>
                  {resultDetails && <small>{resultDetails}</small>}
                </span>
              </button>
              <div className="result-card-actions" aria-label={locale === "zh" ? "结果操作" : "Result actions"}>
                <button type="button" onClick={() => onOpen(item)} disabled={!item.imageUrl} title={locale === "zh" ? "打开图片" : "Open image"}>
                  <ExternalLink size={14} />
                  <span>{locale === "zh" ? "打开" : "Open"}</span>
                </button>
                <button type="button" onClick={() => onCopy(item)} title={locale === "zh" ? "复制摘要" : "Copy summary"}>
                  <Clipboard size={14} />
                  <span>{locale === "zh" ? "复制" : "Copy"}</span>
                </button>
                <button type="button" onClick={() => onUsePrompt(item)} disabled={!item.prompt} title={locale === "zh" ? "载入提示词" : "Load prompt"}>
                  <RotateCcw size={14} />
                  <span>{locale === "zh" ? "提示词" : "Prompt"}</span>
                </button>
                <button type="button" onClick={() => onEdit(item)} disabled={!item.imageUrl} title={locale === "zh" ? "继续修改这张图" : "Continue editing this image"}>
                  <Edit3 size={14} />
                  <span>{locale === "zh" ? "修改" : "Edit"}</span>
                </button>
                <button type="button" onClick={() => onAnnotate(item)} disabled={!item.imageUrl} title={locale === "zh" ? "画圈标注后继续修改" : "Annotate and edit"}>
                  <PenTool size={14} />
                  <span>{locale === "zh" ? "标注" : "Annotate"}</span>
                </button>
                <button type="button" onClick={() => onDownload(item)} disabled={!item.imageUrl} title={locale === "zh" ? "下载图片" : "Download image"}>
                  <Download size={14} />
                  <span>{locale === "zh" ? "下载" : "Download"}</span>
                </button>
                <button type="button" onClick={() => onRemove(item.id)} title={locale === "zh" ? "移除记录" : "Remove result"}>
                  <Trash2 size={14} />
                  <span>{locale === "zh" ? "移除" : "Remove"}</span>
                </button>
              </div>
              <ResultNotesEditor locale={locale} item={item} onSaveNotes={onSaveNotes} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getResultKindLabel(item: RenderHistoryItem, locale: Locale) {
  if (item.generationType !== "edit") {
    return locale === "zh" ? "生成" : "Generation";
  }
  if (item.editMode === "annotation") {
    return locale === "zh" ? "标注修改" : "Annotated edit";
  }
  return locale === "zh" ? "文本修改" : "Text edit";
}

function getGenerationModeLabel(mode: RenderHistoryItem["generationMode"], locale: Locale) {
  if (mode === "render3d") {
    return locale === "zh" ? "3D 效果图" : "3D render";
  }
  if (mode === "colored_floor_plan") {
    return locale === "zh" ? "彩色平面图" : "Colored floor plan";
  }
  if (mode === "standard") {
    return locale === "zh" ? "默认模式" : "Standard";
  }
  return "";
}

function formatResultTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return locale === "zh" ? "刚刚" : "Just now";
  }
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ResultNotesEditor({
  locale,
  item,
  onSaveNotes
}: {
  locale: Locale;
  item: RenderHistoryItem;
  onSaveNotes: (item: RenderHistoryItem, notes: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(item.notes || "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(item.notes || "");
  }, [item.id, item.notes]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSaveNotes(item, draft);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="result-note-editor" onSubmit={handleSubmit}>
      <label>
        <span>
          <StickyNote size={13} />
          {locale === "zh" ? "备注" : "Notes"}
        </span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder={locale === "zh" ? "记录这个结果的修改点、批注意图或后续想法" : "Record edits, annotation intent, or follow-up notes"}
        />
      </label>
      <button type="submit" disabled={isSaving || draft === (item.notes || "")}>
        <Save size={13} />
        {isSaving ? (locale === "zh" ? "保存中" : "Saving") : (locale === "zh" ? "保存备注" : "Save")}
      </button>
    </form>
  );
}
