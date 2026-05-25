import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckSquare,
  Clipboard,
  Download,
  Edit3,
  Image as ImageIcon,
  ImagePlus,
  Plus,
  RefreshCcw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";

import type { Locale, RenderHistoryItem } from "../types/domain";

export type DateRange = {
  start: string;
  end: string;
};

export function ImageManagementPage({
  locale,
  items,
  activeId,
  isRefreshing,
  onBackToWorkspace,
  onSelect,
  onRefresh,
  onOpen,
  onDownload,
  onCopy,
  onUsePrompt,
  onEdit,
  onRemove,
  onDeleteMany,
}: {
  locale: Locale;
  items: RenderHistoryItem[];
  activeId: string | null;
  isRefreshing: boolean;
  onBackToWorkspace: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void> | void;
  onOpen: (item: RenderHistoryItem) => void;
  onDownload: (item: RenderHistoryItem) => void;
  onCopy: (item: RenderHistoryItem) => void;
  onUsePrompt: (item: RenderHistoryItem) => void;
  onEdit: (item: RenderHistoryItem) => void;
  onRemove: (id: string) => Promise<void> | void;
  onDeleteMany: (items: RenderHistoryItem[]) => Promise<void>;
}) {
  const [draftRange, setDraftRange] = useState<DateRange>({ start: "", end: "" });
  const [appliedRange, setAppliedRange] = useState<DateRange>({ start: "", end: "" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBatchWorking, setIsBatchWorking] = useState(false);

  const filteredItems = useMemo(
    () => items.filter((item) => isResultInDateRange(item, appliedRange)),
    [items, appliedRange]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSet.has(item.id)),
    [items, selectedSet]
  );
  const hasAppliedFilter = Boolean(appliedRange.start || appliedRange.end);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  function applyDateFilter() {
    setAppliedRange(normalizeDateRange(draftRange));
  }

  function clearDateFilter() {
    setDraftRange({ start: "", end: "" });
    setAppliedRange({ start: "", end: "" });
  }

  function applyPresetDateRange(range: DateRange) {
    const normalizedRange = normalizeDateRange(range);
    setDraftRange(normalizedRange);
    setAppliedRange(normalizedRange);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id]
    ));
  }

  function selectFilteredItems() {
    setSelectedIds(filteredItems.map((item) => item.id));
  }

  function selectAllItems() {
    setSelectedIds(items.map((item) => item.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function downloadSelected() {
    selectedItems.forEach((item) => onDownload(item));
  }

  async function deleteItems(targetItems: RenderHistoryItem[], confirmation: string) {
    if (targetItems.length === 0 || isBatchWorking) return;
    if (typeof window !== "undefined" && !window.confirm(confirmation)) {
      return;
    }
    setIsBatchWorking(true);
    try {
      await onDeleteMany(targetItems);
      const removedIds = new Set(targetItems.map((item) => item.id));
      setSelectedIds((current) => current.filter((id) => !removedIds.has(id)));
    } finally {
      setIsBatchWorking(false);
    }
  }

  const pageCountCopy = locale === "zh"
    ? `共 ${filteredItems.length} 张`
    : `${filteredItems.length} images`;
  const allCountCopy = hasAppliedFilter && items.length !== filteredItems.length
    ? locale === "zh" ? `全部 ${items.length} 张` : `${items.length} total`
    : "";
  const appliedRangeCopy = formatDateRangeLabel(appliedRange, locale);
  const presetOptions = [
    { key: "today", label: locale === "zh" ? "今天" : "Today", range: recentDateRange(1) },
    { key: "7d", label: locale === "zh" ? "近 7 天" : "Last 7 days", range: recentDateRange(7) },
    { key: "30d", label: locale === "zh" ? "近 30 天" : "Last 30 days", range: recentDateRange(30) },
  ];

  return (
    <div className="image-management-page">
      <header className="image-management-hero">
        <div className="image-management-heading">
          <p className="eyebrow">IMAGES</p>
          <h1>{locale === "zh" ? "图片管理" : "Image Management"}</h1>
        </div>
        <div className="image-management-filters" aria-label={locale === "zh" ? "图片筛选" : "Image filters"}>
          <div className="image-date-range" role="group" aria-label={locale === "zh" ? "日期范围" : "Date range"}>
            <div className="image-date-range__title">
              <Calendar size={16} aria-hidden="true" />
              <span>{locale === "zh" ? "日期范围" : "Date range"}</span>
            </div>
            <label className="image-date-input">
              <span>{locale === "zh" ? "开始" : "Start"}</span>
              <input
                type="date"
                value={draftRange.start}
                onChange={(event) => setDraftRange((current) => ({ ...current, start: event.target.value }))}
                aria-label={locale === "zh" ? "开始日期" : "Start date"}
              />
            </label>
            <label className="image-date-input">
              <span>{locale === "zh" ? "结束" : "End"}</span>
              <input
                type="date"
                value={draftRange.end}
                onChange={(event) => setDraftRange((current) => ({ ...current, end: event.target.value }))}
                aria-label={locale === "zh" ? "结束日期" : "End date"}
              />
            </label>
            <div className="image-date-presets" aria-label={locale === "zh" ? "快捷日期范围" : "Quick date ranges"}>
              {presetOptions.map((option) => (
                <button type="button" key={option.key} onClick={() => applyPresetDateRange(option.range)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="image-management-action" onClick={clearDateFilter} disabled={!draftRange.start && !draftRange.end && !hasAppliedFilter}>
            {locale === "zh" ? "清除筛选条件" : "Clear filters"}
          </button>
          <button type="button" className="image-management-action image-management-action--primary" onClick={applyDateFilter}>
            <Search size={16} />
            {locale === "zh" ? "查询" : "Search"}
          </button>
          <button
            type="button"
            className="image-management-action image-management-action--danger"
            title={!hasAppliedFilter ? (locale === "zh" ? "先选择日期范围再删除匹配结果" : "Choose a date range before deleting matches") : undefined}
            onClick={() => void deleteItems(
              filteredItems,
              locale === "zh" ? `确定删除当前日期筛选匹配的 ${filteredItems.length} 张图片吗？` : `Delete ${filteredItems.length} images matching the current date filter?`
            )}
            disabled={!hasAppliedFilter || filteredItems.length === 0 || isBatchWorking}
          >
            <Trash2 size={16} />
            {locale === "zh" ? "删除匹配日期" : "Delete matching dates"}
          </button>
        </div>
      </header>

      <section className="image-management-board" aria-label={locale === "zh" ? "历史生成图片" : "Generated image history"}>
        <div className="image-management-toolbar">
          <div className="image-management-count">
            <ImageIcon size={18} />
            <strong>{pageCountCopy}</strong>
            {allCountCopy && <span>{allCountCopy}</span>}
            {hasAppliedFilter && <span className="image-management-filter-summary">{locale === "zh" ? `筛选：${appliedRangeCopy}` : `Filtered: ${appliedRangeCopy}`}</span>}
            <button type="button" onClick={selectFilteredItems} disabled={filteredItems.length === 0}>
              <Square size={15} />
              {locale === "zh" ? "本页全选" : "Select page"}
            </button>
            <button type="button" onClick={selectAllItems} disabled={items.length === 0}>
              <CheckSquare size={15} />
              {locale === "zh" ? "全选结果" : "Select all"}
            </button>
          </div>
          <div className="image-management-bulk-actions">
            <button type="button" onClick={() => void onRefresh()} disabled={isRefreshing || isBatchWorking}>
              <RefreshCcw size={15} className={isRefreshing ? "is-spinning" : ""} />
              {locale === "zh" ? "刷新" : "Refresh"}
            </button>
            <button type="button" onClick={clearSelection} disabled={selectedIds.length === 0}>
              <X size={15} />
              {locale === "zh" ? "取消选择" : "Clear selection"}
            </button>
            <button type="button" onClick={downloadSelected} disabled={selectedItems.length === 0 || isBatchWorking}>
              <Download size={15} />
              {locale === "zh" ? "下载所选" : "Download selected"}
            </button>
            <button
              type="button"
              className="image-management-bulk-danger"
              onClick={() => void deleteItems(
                selectedItems,
                locale === "zh" ? `确定删除所选 ${selectedItems.length} 张图片吗？` : `Delete ${selectedItems.length} selected images?`
              )}
              disabled={selectedItems.length === 0 || isBatchWorking}
            >
              <Trash2 size={15} />
              {locale === "zh" ? "删除所选" : "Delete selected"}
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="image-management-empty">
            <ImagePlus size={26} aria-hidden="true" />
            <strong>{locale === "zh" ? "没有匹配的图片" : "No matching images"}</strong>
            <p>
              {items.length === 0
                ? locale === "zh" ? "生成成功后，图片会自动出现在这里。" : "Generated images will appear here after a successful run."
                : locale === "zh" ? "换个日期范围试试，或者清除筛选条件。" : "Try another date range or clear the filter."}
            </p>
            <button type="button" onClick={items.length === 0 ? onBackToWorkspace : clearDateFilter}>
              {items.length === 0
                ? locale === "zh" ? "回到工作区" : "Back to workspace"
                : locale === "zh" ? "清除筛选" : "Clear filter"}
            </button>
          </div>
        ) : (
          <div className="image-management-grid">
            {filteredItems.map((item) => {
              const isSelected = selectedSet.has(item.id);
              const isActive = activeId === item.id;
              return (
                <article className={`image-management-card ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`} key={item.id}>
                  <button
                    type="button"
                    className="image-management-card__image"
                    onClick={() => {
                      onSelect(item.id);
                      onOpen(item);
                    }}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.imageLabel || item.title} />
                    ) : (
                      <span className="image-management-card__placeholder">
                        <ImageIcon size={24} />
                      </span>
                    )}
                  </button>
                  <div className="image-management-card__meta">
                    <div className="image-management-card__time">
                      <Calendar size={15} />
                      <span>{formatImageDateTime(item.createdAt)}</span>
                    </div>
                    <div className="image-management-card__quick-actions">
                      <button type="button" onClick={() => onDownload(item)} disabled={!item.imageUrl} title={locale === "zh" ? "下载图片" : "Download image"}>
                        <Download size={15} />
                      </button>
                      <button type="button" onClick={() => onCopy(item)} title={locale === "zh" ? "复制摘要" : "Copy summary"}>
                        <Clipboard size={15} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`image-management-card__check ${isSelected ? "is-selected" : ""}`}
                      onClick={() => toggleSelected(item.id)}
                      aria-pressed={isSelected}
                      aria-label={isSelected
                        ? locale === "zh" ? "取消选择图片" : "Deselect image"
                        : locale === "zh" ? "选择图片" : "Select image"}
                    >
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  </div>
                  <div className="image-management-card__details">
                    <span>{formatResultDescriptor(item, locale)}</span>
                    <span>{item.imageLabel || item.title}</span>
                  </div>
                  <div className="image-management-card__actions">
                    <button type="button" onClick={() => onOpen(item)} disabled={!item.imageUrl} title={locale === "zh" ? "预览图片" : "Preview image"}>
                      <Plus size={15} />
                    </button>
                    <button type="button" onClick={() => onUsePrompt(item)} disabled={!item.prompt} title={locale === "zh" ? "载入提示词" : "Load prompt"}>
                      <RefreshCcw size={15} />
                    </button>
                    <button type="button" onClick={() => onEdit(item)} disabled={!item.imageUrl} title={locale === "zh" ? "继续改图" : "Edit image"}>
                      <Edit3 size={15} />
                    </button>
                    <button type="button" onClick={() => void onRemove(item.id)} title={locale === "zh" ? "删除图片" : "Delete image"}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function normalizeDateRange(range: DateRange): DateRange {
  if (range.start && range.end && range.start > range.end) {
    return { start: range.end, end: range.start };
  }
  return range;
}

export function isResultInDateRange(item: RenderHistoryItem, range: DateRange) {
  if (!range.start && !range.end) return true;
  const createdAt = new Date(item.createdAt).getTime();
  if (Number.isNaN(createdAt)) return false;
  const startAt = range.start ? new Date(`${range.start}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const endAt = range.end ? new Date(`${range.end}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  return createdAt >= startAt && createdAt <= endAt;
}

function recentDateRange(dayCount: number): DateRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(1, dayCount) + 1);
  return {
    start: formatDateInputValue(start),
    end: formatDateInputValue(end),
  };
}

function formatDateInputValue(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateRangeLabel(range: DateRange, locale: Locale) {
  if (range.start && range.end) {
    return range.start === range.end ? range.start : `${range.start} - ${range.end}`;
  }
  if (range.start) {
    return locale === "zh" ? `${range.start} 之后` : `After ${range.start}`;
  }
  if (range.end) {
    return locale === "zh" ? `${range.end} 之前` : `Before ${range.end}`;
  }
  return locale === "zh" ? "全部日期" : "All dates";
}

function formatImageDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatResultDescriptor(item: RenderHistoryItem, locale: Locale) {
  const mode = item.generationMode === "render3d"
    ? locale === "zh" ? "3D 效果图" : "3D render"
    : item.generationMode === "colored_floor_plan"
      ? locale === "zh" ? "彩色平面图" : "Colored floor plan"
      : locale === "zh" ? "默认模式" : "Standard";
  const kind = item.generationType === "edit"
    ? locale === "zh" ? "改图" : "Edit"
    : locale === "zh" ? "生成" : "Generation";
  const version = `v${item.versionIndex || 1}`;
  return [kind, mode, version, item.modelWarning ? (locale === "zh" ? "仅文本参考" : "Text reference") : ""].filter(Boolean).join(" · ");
}
