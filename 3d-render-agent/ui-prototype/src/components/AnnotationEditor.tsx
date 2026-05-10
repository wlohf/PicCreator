import { type PointerEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Brush, Circle, Send, Square, Trash2, Undo2, X } from "lucide-react";

import type { Locale, RenderHistoryItem } from "../types/domain";

type AnnotationTool = "pen" | "ellipse" | "rect" | "arrow";

type Point = {
  x: number;
  y: number;
};

type AnnotationMark = {
  tool: AnnotationTool;
  points: Point[];
  color: string;
  width: number;
};

const tools: Array<{ key: AnnotationTool; zh: string; en: string; icon: "brush" | "circle" | "square" | "arrow" }> = [
  { key: "pen", zh: "画笔", en: "Pen", icon: "brush" },
  { key: "ellipse", zh: "圆圈", en: "Circle", icon: "circle" },
  { key: "rect", zh: "矩形", en: "Rectangle", icon: "square" },
  { key: "arrow", zh: "箭头", en: "Arrow", icon: "arrow" }
];

function drawArrow(ctx: CanvasRenderingContext2D, start: Point, end: Point, width: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(16, width * 5);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function drawMark(ctx: CanvasRenderingContext2D, mark: AnnotationMark) {
  if (mark.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.lineWidth = mark.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const [start, end] = [mark.points[0], mark.points[mark.points.length - 1]];
  if (mark.tool === "pen") {
    ctx.beginPath();
    ctx.moveTo(mark.points[0].x, mark.points[0].y);
    for (const point of mark.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  if (mark.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (mark.tool === "rect") {
    ctx.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  }
  if (mark.tool === "arrow") {
    drawArrow(ctx, start, end, mark.width);
  }
  ctx.restore();
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>): Point {
  const rect = canvas.getBoundingClientRect();
  const style = window.getComputedStyle(canvas);
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
  const contentWidth = Math.max(1, rect.width - borderLeft - borderRight);
  const contentHeight = Math.max(1, rect.height - borderTop - borderBottom);
  const scale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height) || 1;
  const drawnWidth = canvas.width * scale;
  const drawnHeight = canvas.height * scale;
  const offsetX = (contentWidth - drawnWidth) / 2;
  const offsetY = (contentHeight - drawnHeight) / 2;
  const localX = Math.min(Math.max(event.clientX - rect.left - borderLeft - offsetX, 0), drawnWidth);
  const localY = Math.min(Math.max(event.clientY - rect.top - borderTop - offsetY, 0), drawnHeight);
  return {
    x: (localX / drawnWidth) * canvas.width,
    y: (localY / drawnHeight) * canvas.height
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, "image/png");
  });
}

export function AnnotationEditor({
  locale,
  item,
  onClose,
  onSubmit,
  isSubmitting
}: {
  locale: Locale;
  item: RenderHistoryItem;
  onClose: () => void;
  onSubmit: (instruction: string, annotationImage: Blob) => Promise<void>;
  isSubmitting: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [activeTool, setActiveTool] = useState<AnnotationTool>("pen");
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [draftMark, setDraftMark] = useState<AnnotationMark | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loadError, setLoadError] = useState("");
  const [localWarning, setLocalWarning] = useState("");

  const color = "#ef3f35";
  const lineWidth = Math.max(5, Math.round(Math.min(canvasSize.width || 900, canvasSize.height || 600) / 180));

  useEffect(() => {
    setMarks([]);
    setDraftMark(null);
    setLoadError("");
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const maxSide = 1500;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      imageRef.current = image;
      setCanvasSize({ width, height });
    };
    image.onerror = () => setLoadError(locale === "zh" ? "源图加载失败，无法标注" : "Source image failed to load");
    image.src = item.imageUrl || "";
  }, [item.imageUrl, locale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !canvasSize.width || !canvasSize.height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const mark of marks) drawMark(ctx, mark);
    if (draftMark) drawMark(ctx, draftMark);
  }, [canvasSize, draftMark, marks]);

  function startMark(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || isSubmitting || !canvasSize.width || !canvasSize.height) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Browser-generated pointer events capture normally; synthetic events can fail.
    }
    const point = canvasPoint(canvas, event);
    setDraftMark({ tool: activeTool, points: [point, point], color, width: lineWidth });
  }

  function updateMark(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !draftMark || isSubmitting) return;
    event.preventDefault();
    const point = canvasPoint(canvas, event);
    setDraftMark((current) => {
      if (!current) return current;
      if (current.tool === "pen") {
        return { ...current, points: [...current.points, point] };
      }
      return { ...current, points: [current.points[0], point] };
    });
  }

  function finishMark() {
    if (!draftMark) return;
    const first = draftMark.points[0];
    const last = draftMark.points[draftMark.points.length - 1];
    const distance = Math.hypot(last.x - first.x, last.y - first.y);
    if (distance > 3 || draftMark.tool === "pen") {
      setMarks((current) => [...current, draftMark]);
    }
    setDraftMark(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || loadError) return;
    if (!canvasSize.width || !canvasSize.height) {
      setLocalWarning(locale === "zh" ? "图片尚未加载完成，请稍候" : "Image not loaded yet, please wait");
      return;
    }
    if (marks.length === 0) {
      setLocalWarning(locale === "zh" ? "请先在图片上做一个标注" : "Add at least one annotation first");
      return;
    }
    if (!instruction.trim()) {
      setLocalWarning(locale === "zh" ? "没有文字说明时，后端会让分析模型保守推断标注意图。" : "Without text, the backend will infer the marked intent conservatively.");
    }
    const blob = await canvasToBlob(canvas);
    await onSubmit(instruction.trim(), blob);
  }

  return (
    <div className="annotation-modal" role="dialog" aria-modal="true" aria-label={locale === "zh" ? "标注续改" : "Annotated edit"} onClick={onClose}>
      <form className="annotation-modal__content" onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
        <div className="annotation-modal__bar">
          <div>
            <p className="eyebrow">{locale === "zh" ? "标注续改" : "Annotated edit"}</p>
            <h2>{item.title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} aria-label={locale === "zh" ? "关闭" : "Close"}>
            <X size={16} />
          </button>
        </div>
        <div className="annotation-toolbar" aria-label={locale === "zh" ? "标注工具" : "Annotation tools"}>
          {tools.map((tool) => (
            <button
              type="button"
              key={tool.key}
              className={activeTool === tool.key ? "is-active" : ""}
              onClick={() => setActiveTool(tool.key)}
              aria-pressed={activeTool === tool.key}
              title={locale === "zh" ? tool.zh : tool.en}
              disabled={isSubmitting}
            >
              {tool.icon === "brush" && <Brush size={16} />}
              {tool.icon === "circle" && <Circle size={16} />}
              {tool.icon === "square" && <Square size={16} />}
              {tool.icon === "arrow" && <ArrowUpRight size={16} />}
              <span>{locale === "zh" ? tool.zh : tool.en}</span>
            </button>
          ))}
          <button type="button" onClick={() => setMarks((current) => current.slice(0, -1))} disabled={marks.length === 0 || isSubmitting} title={locale === "zh" ? "撤销" : "Undo"}>
            <Undo2 size={16} />
            <span>{locale === "zh" ? "撤销" : "Undo"}</span>
          </button>
          <button type="button" onClick={() => setMarks([])} disabled={marks.length === 0 || isSubmitting} title={locale === "zh" ? "清空" : "Clear"}>
            <Trash2 size={16} />
            <span>{locale === "zh" ? "清空" : "Clear"}</span>
          </button>
        </div>
        <div className="annotation-canvas-shell">
          {loadError ? (
            <div className="annotation-error">{loadError}</div>
          ) : (
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              onPointerDown={startMark}
              onPointerMove={updateMark}
              onPointerUp={finishMark}
              onPointerCancel={() => setDraftMark(null)}
              aria-label={locale === "zh" ? "标注画布" : "Annotation canvas"}
            />
          )}
        </div>
        <div className="annotation-form-row">
          <textarea
            name="annotation_instruction"
            value={instruction}
            onChange={(event) => {
              setInstruction(event.target.value);
              setLocalWarning("");
            }}
            rows={3}
            placeholder={locale === "zh" ? "写一句修改要求，例如：把圈出的单椅换成浅灰布艺，其他不变" : "Add the edit request, e.g. change the marked chair to light gray fabric and keep everything else unchanged"}
            disabled={isSubmitting}
          />
          <button className="primary-button" type="submit" disabled={isSubmitting || Boolean(loadError)}>
            <Send size={16} />
            {isSubmitting ? (locale === "zh" ? "提交中" : "Submitting") : (locale === "zh" ? "提交标注改图" : "Submit")}
          </button>
        </div>
        {localWarning && <p className="annotation-hint">{localWarning}</p>}
      </form>
    </div>
  );
}
