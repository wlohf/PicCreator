import { BadgeCheck, CircleDashed } from "lucide-react";

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
  onSelectStep,
  hasRun
}: {
  locale: Locale;
  copy: TimelineCopy;
  activeStep: string;
  onSelectStep: (step: string) => void;
  hasRun: boolean;
}) {
  const steps = [
    {
      step: "submitted",
      title: { zh: "已提交", en: "Submitted" },
      model: { zh: "前端请求", en: "Frontend request" },
      notes: { zh: ["需求和平面图已发送"], en: ["Brief and floor plan sent"] }
    },
    {
      step: "analysis",
      title: { zh: "空间分析", en: "Spatial analysis" },
      model: { zh: "后端 pipeline", en: "Backend pipeline" },
      notes: { zh: ["等待平面图解析与提示词生成"], en: ["Waiting for floor plan parsing and prompt generation"] }
    },
    {
      step: "rendering",
      title: { zh: "图片生成", en: "Image generation" },
      model: { zh: "画图模型", en: "Image model" },
      notes: { zh: ["等待真实图片返回"], en: ["Waiting for real image output"] }
    },
    {
      step: "evaluating",
      title: { zh: "图像评估", en: "Image evaluation" },
      model: { zh: "视觉模型", en: "Vision model" },
      notes: { zh: ["图片返回后进行质量评估"], en: ["Review image quality after output returns"] }
    },
    {
      step: "completed",
      title: { zh: "结果返回", en: "Result returned" },
      model: { zh: "图片管理", en: "Image management" },
      notes: { zh: ["生成结果会进入历史图片"], en: ["Generated output is saved to image history"] }
    }
  ];
  const stepOrder = steps.map((step) => step.step);
  const activeIndex = stepOrder.indexOf(activeStep);
  const isFailed = activeStep === "failed";

  return (
    <section className="timeline-panel">
      <div className="timeline-heading">
        <div>
          <p className="eyebrow">{copy.timeline}</p>
          <h2>{copy.runTrace}</h2>
        </div>
        <div className="timeline-meta">
          <StatusBadge tone={isFailed ? "warn" : hasRun ? "good" : "neutral"}>
            {isFailed ? (locale === "zh" ? "请求失败" : "Failed") : hasRun ? (locale === "zh" ? "已开始" : "Started") : locale === "zh" ? "未开始" : "Not started"}
          </StatusBadge>
          <span>
            {copy.selectedStep}: {activeStep}
          </span>
        </div>
      </div>
      {!hasRun ? (
        <div className="timeline-empty">
          {locale === "zh" ? "生成开始后，这里会记录实际流程状态。" : "Once generation starts, this area records the real workflow state."}
        </div>
      ) : (
      <div className="timeline-grid">
        {steps.map((run) => {
          const runIndex = stepOrder.indexOf(run.step);
          const isDone = activeStep === "completed" || (activeIndex >= 0 && runIndex <= activeIndex);
          const isStopped = isFailed && runIndex > Math.max(activeIndex, 1);
          const isCurrentFailure = isFailed && run.step === (activeIndex >= 0 ? activeStep : "analysis");
          return (
          <button
            className={`timeline-card ${isDone ? "timeline-card--accepted" : ""} ${activeStep === run.step || isCurrentFailure ? "timeline-card--active" : ""} ${isCurrentFailure ? "timeline-card--warning" : ""}`}
            key={run.step}
            onClick={() => onSelectStep(run.step)}
          >
            <div className="timeline-step">
              <span>{run.step}</span>
              {isDone && !isCurrentFailure ? <BadgeCheck size={18} /> : <CircleDashed size={18} />}
            </div>
            <h3>{run.title[locale]}</h3>
            <p>{run.model[locale]}</p>
            <div className="timeline-score">
              {isCurrentFailure
                ? locale === "zh" ? "失败" : "failed"
                : isStopped
                  ? locale === "zh" ? "未执行" : "not run"
                  : isDone
                    ? locale === "zh" ? "已记录" : "tracked"
                    : locale === "zh" ? "等待" : "pending"}
            </div>
            <ul>
              {(isCurrentFailure
                ? [locale === "zh" ? "后端返回错误，本次结果不会保存到历史图片" : "Backend returned an error; no result was saved"]
                : isStopped
                  ? [locale === "zh" ? "前序步骤失败后不会继续执行" : "Skipped because an earlier step failed"]
                  : run.notes[locale]
              ).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </button>
          );
        })}
      </div>
      )}
    </section>
  );
}
