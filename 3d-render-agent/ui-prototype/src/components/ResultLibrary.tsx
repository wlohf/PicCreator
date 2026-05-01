import { Download, ExternalLink } from "lucide-react";

import type { Locale, RenderHistoryItem } from "../types/domain";

export function ResultLibrary({
  locale,
  items,
  activeId,
  onSelect,
  onDownload,
  onOpen
}: {
  locale: Locale;
  items: RenderHistoryItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDownload: (item: RenderHistoryItem) => void;
  onOpen: (item: RenderHistoryItem) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="result-library result-library--empty" aria-label={locale === "zh" ? "生成结果库" : "Result library"}>
        <div>
          <p className="eyebrow">{locale === "zh" ? "结果库" : "Result Library"}</p>
          <strong>{locale === "zh" ? "还没有真实生成结果" : "No generated result yet"}</strong>
        </div>
        <span>{locale === "zh" ? "生成成功后会在这里保留最近结果，方便预览和下载。" : "Successful generations will be kept here for preview and download."}</span>
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
        <span>{locale === "zh" ? "本地会话临时保存" : "Session only"}</span>
      </div>
      <div className="result-library-list">
        {items.map((item) => {
          const active = activeId === item.id;
          return (
            <article className={`result-card ${active ? "result-card--active" : ""}`} key={item.id}>
              <button className="result-card-main" type="button" onClick={() => onSelect(item.id)}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.imageLabel || item.title} />
                ) : (
                  <span className="result-card-placeholder" />
                )}
                <span>
                  <strong>{item.title}</strong>
                  <em>{item.status || (locale === "zh" ? "已完成" : "Completed")}</em>
                </span>
              </button>
              <div className="result-card-actions">
                <button type="button" onClick={() => onOpen(item)} disabled={!item.imageUrl} title={locale === "zh" ? "打开图片" : "Open image"}>
                  <ExternalLink size={14} />
                </button>
                <button type="button" onClick={() => onDownload(item)} disabled={!item.imageUrl} title={locale === "zh" ? "下载图片" : "Download image"}>
                  <Download size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
