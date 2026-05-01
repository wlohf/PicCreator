import { type FormEvent, useMemo, useState } from "react";
import {
  Aperture,
  Box,
  Brush,
  Camera,
  ChevronDown,
  Clock3,
  Download,
  Eye,
  FileText,
  ImagePlus,
  Maximize2,
  PanelRight,
  PlugZap,
  Play,
  Ruler,
  Send,
  SlidersHorizontal,
  SunMedium,
  Upload
} from "lucide-react";

import { verifyConfig } from "./api/config";
import { requestGeneration } from "./api/generation";
import { ConfigStatus, type ConfigStatusState } from "./components/ConfigStatus";
import { MousePointerIcon } from "./components/MousePointerIcon";
import { ParameterSlider } from "./components/ParameterSlider";
import { ProjectBriefPanel } from "./components/ProjectBriefPanel";
import { ResultLibrary } from "./components/ResultLibrary";
import { StatusBadge } from "./components/StatusBadge";
import { TimelinePanel } from "./components/TimelinePanel";
import {
  apiFormatOptions,
  copy,
  defaultApiConfig,
  directionItems,
  initialChatMessages,
  iterationOptions,
  modelOptions,
  renderVersions,
  styleTokens,
  tools
} from "./data/studioData";
import type { ApiConfig, ChatMessage, Locale, Metric, ParameterKey, RenderHistoryItem, ToolKey } from "./types/domain";
import { compactLines, localized } from "./utils/text";

function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [selectedVersionId, setSelectedVersionId] = useState("A.04");
  const [isRendering, setIsRendering] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolKey>("select");
  const [activeDirection, setActiveDirection] = useState(0);
  const [activeStep, setActiveStep] = useState("03");
  const [selectedModel, setSelectedModel] = useState(modelOptions[0]);
  const [maxIterations, setMaxIterations] = useState(5);
  const [parameters, setParameters] = useState<Record<ParameterKey, number>>({
    cameraHeight: 62,
    materialDetail: 84,
    daylightBalance: 70
  });
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [floorPlanFiles, setFloorPlanFiles] = useState<File[]>([]);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(defaultApiConfig);
  const [configStatus, setConfigStatus] = useState<ConfigStatusState | null>(null);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const t = copy[locale];
  const selectedVersion = useMemo(
    () => renderVersions.find((version) => version.id === selectedVersionId) ?? renderVersions[0],
    [selectedVersionId]
  );
  const activeResult = useMemo(
    () => renderHistory.find((item) => item.id === activeResultId) ?? renderHistory[0] ?? null,
    [activeResultId, renderHistory]
  );
  const activeToolLabel = tools.find((tool) => tool.key === activeTool)?.label[locale] ?? "";
  const qualityMetrics: Metric[] = [
    {
      key: "composition",
      label: { zh: "构图", en: "Composition" },
      value: selectedVersion.metrics.composition,
      tone: selectedVersion.metrics.composition >= 82 ? "good" : "warn"
    },
    {
      key: "materialDetail",
      label: { zh: "材质还原", en: "Material Fidelity" },
      value: selectedVersion.metrics.materialDetail,
      tone: selectedVersion.metrics.materialDetail >= 82 ? "good" : "warn"
    },
    {
      key: "cameraHeight",
      label: { zh: "空间准确性", en: "Spatial Accuracy" },
      value: selectedVersion.metrics.cameraHeight,
      tone: selectedVersion.metrics.cameraHeight >= 82 ? "good" : "warn"
    },
    {
      key: "daylightBalance",
      label: { zh: "光照控制", en: "Lighting Control" },
      value: selectedVersion.metrics.daylightBalance,
      tone: selectedVersion.metrics.daylightBalance >= 82 ? "good" : "warn"
    }
  ];

  function updateParameter(key: ParameterKey, value: number) {
    setParameters((current) => ({ ...current, [key]: value }));
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600);
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleDownloadResult(item?: RenderHistoryItem | null) {
    if (!item?.imageUrl) {
      showToast(locale === "zh" ? "暂无可下载的图片" : "No image to download yet");
      return;
    }
    const safeName = (item.imageLabel || item.title || "render-result").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
    downloadDataUrl(item.imageUrl, `${safeName || "render-result"}.png`);
  }

  function handleOpenResult(item?: RenderHistoryItem | null) {
    if (!item?.imageUrl) {
      showToast(locale === "zh" ? "暂无可预览的图片" : "No image to preview yet");
      return;
    }
    window.open(item.imageUrl, "_blank", "noopener,noreferrer");
  }

  async function handleCopyRunSummary(item?: RenderHistoryItem | null) {
    if (!item) {
      showToast(locale === "zh" ? "暂无生成摘要" : "No run summary yet");
      return;
    }
    const summary = [
      `# ${item.title}`,
      item.status ? `Status: ${item.status}` : "",
      item.prompt ? `Prompt:\n${item.prompt}` : "",
      item.evaluation ? `Evaluation:\n${item.evaluation}` : "",
      item.logs ? `Logs:\n${item.logs}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(summary);
      showToast(locale === "zh" ? "已复制本次生成摘要" : "Run summary copied");
    } catch {
      showToast(locale === "zh" ? "复制失败，请手动复制" : "Copy failed");
    }
  }

  async function runConversationFlow(userPrompt?: string) {
    if (isRendering) return;
    const prompt = userPrompt?.trim() || t.designRequestCopy;
    if (userPrompt !== undefined && !userPrompt.trim()) return;
    const idBase = Date.now();
    const nextMessages: ChatMessage[] = [];
    nextMessages.push({
      id: `m-user-${idBase}`,
      role: "user",
      kind: "text",
      content: prompt
    });
    nextMessages.push({
      id: `m-ai-analysis-${idBase}`,
      role: "assistant",
      kind: "analysis",
      content: {
        zh: "我已收到需求，正在提交给后端生成流程，并会把平面图、参考图、模型和迭代参数一起发送。",
        en: "I received the prompt and am submitting it to the backend generation flow with floor plans, references, model, and iteration settings."
      },
      bullets: {
        zh: ["提交需求文本", "同步附件状态", "等待 pipeline 返回结果"],
        en: ["Submit prompt text", "Sync attachment state", "Wait for pipeline result"]
      }
    });
    setMessages((current) => [...current, ...nextMessages]);
    setChatInput("");
    setIsRendering(true);
    setActiveStep("03");

    try {
      const result = await requestGeneration({
        prompt,
        maxIterations,
        apiConfig,
        selectedModel,
        floorPlanFiles,
        referenceFile
      });
      setSelectedVersionId("A.04");
      setActiveStep("04");
      const firstImage = result.images?.[0];
      const historyItem: RenderHistoryItem = {
        id: `r-${idBase}`,
        title: firstImage?.label || (locale === "zh" ? `生成结果 ${new Date().toLocaleTimeString()}` : `Render ${new Date().toLocaleTimeString()}`),
        status: result.status,
        imageUrl: firstImage?.data_url,
        imageLabel: firstImage?.label,
        prompt: result.prompt,
        evaluation: result.evaluation,
        logs: result.logs,
        createdAt: new Date().toISOString()
      };
      setRenderHistory((current) => [historyItem, ...current].slice(0, 8));
      setActiveResultId(historyItem.id);
      showToast(locale === "zh" ? "生成完成，已加入结果库" : "Generation completed and added to library");
      const resultMessages: ChatMessage[] = [
        {
          id: `m-api-analysis-${idBase}`,
          role: "assistant",
          kind: "analysis",
          content: result.floor_desc || result.evaluation || result.status || t.apiAnalysisReady,
          bullets: {
            zh: compactLines([result.status || "", result.prompt ? "提示词已生成" : "", result.evaluation ? "评估报告已返回" : ""]),
            en: compactLines([result.status || "", result.prompt ? "Prompt generated" : "", result.evaluation ? "Evaluation returned" : ""])
          }
        },
        {
          id: `m-api-render-${idBase}`,
          role: "assistant",
          kind: "render",
          content: result.ok ? t.apiRenderReady : result.error || t.requestFailed,
          imageUrl: firstImage?.data_url,
          imageLabel: firstImage?.label
        }
      ];
      setMessages((current) => [...current, ...resultMessages]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `m-api-error-${idBase}`,
          role: "assistant",
          kind: "error",
          content: `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]);
    } finally {
      setIsRendering(false);
    }
  }

  function handleGenerate() {
    runConversationFlow(chatInput.trim() ? chatInput : undefined);
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runConversationFlow(chatInput);
  }

  async function handleVerifyConfig(role: "analysis" | "image") {
    const label = locale === "zh" ? (role === "analysis" ? "分析模型" : "画图模型") : role === "analysis" ? "analysis model" : "image model";
    setConfigStatus({ tone: "warn", message: locale === "zh" ? `正在验证${label}...` : `Verifying ${label}...` });
    try {
      const result = await verifyConfig(role, apiConfig);
      setConfigStatus({ tone: "good", message: result.message || (locale === "zh" ? `${label}验证通过` : `${label} verified`) });
    } catch (error) {
      setConfigStatus({ tone: "warn", message: `${locale === "zh" ? `${label}验证失败` : `${label} verification failed`}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }


  return (
    <main className={`studio-shell ${isRendering ? "is-rendering" : ""}`}>
      <header className="studio-bar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Aperture size={20} />
          </div>
          <div>
            <p className="eyebrow">{t.appName}</p>
            <h1>{t.title}</h1>
          </div>
        </div>

        <div className="project-strip" aria-label="Project status">
          <div>
            <span>{t.modeLabel}</span>
            <strong>{t.modeValue}</strong>
          </div>
          <div>
            <span>{t.modelLabel}</span>
            <strong>{selectedModel}</strong>
          </div>
          <div>
            <span>{t.qualityGate}</span>
            <strong>8.5+</strong>
          </div>
          <div>
            <span>{t.iteration}</span>
            <strong>04 / {String(maxIterations).padStart(2, "0")}</strong>
          </div>
        </div>

        <div className="studio-actions">
          <div className="language-toggle" aria-label={t.language}>
            <button className={locale === "zh" ? "is-active" : ""} onClick={() => setLocale("zh")}>
              中文
            </button>
            <button className={locale === "en" ? "is-active" : ""} onClick={() => setLocale("en")}>
              EN
            </button>
          </div>
          <button className="icon-button" aria-label={t.preview} onClick={() => handleOpenResult(activeResult)} title={t.preview}>
            <Eye size={18} />
          </button>
          <button className="icon-button" aria-label={locale === "zh" ? "复制摘要" : "Copy summary"} onClick={() => handleCopyRunSummary(activeResult)} title={locale === "zh" ? "复制摘要" : "Copy summary"}>
            <FileText size={18} />
          </button>
          <button className="icon-button" aria-label={t.export} onClick={() => handleDownloadResult(activeResult)} title={t.export}>
            <Download size={18} />
          </button>
          <button className="primary-button" onClick={handleGenerate} disabled={isRendering}>
            <Play size={17} />
            {isRendering ? t.rendering : t.generate}
          </button>
        </div>
      </header>

      <section className="workspace-grid">
          <ProjectBriefPanel locale={locale} copy={t} isRendering={isRendering} />

        <section className="viewport-zone chat-workspace">
          <div className="viewport-toolbar">
            <div className="toolbar-group">
              {tools.map((tool) => (
                <button
                  className={`tool-button ${activeTool === tool.key ? "is-active" : ""}`}
                  key={tool.key}
                  onClick={() => setActiveTool(tool.key)}
                  aria-label={tool.label[locale]}
                  title={tool.label[locale]}
                >
                  {tool.icon === "pointer" && <MousePointerIcon />}
                  {tool.icon === "camera" && <Camera size={17} />}
                  {tool.icon === "ruler" && <Ruler size={17} />}
                  {tool.icon === "sun" && <SunMedium size={17} />}
                </button>
              ))}
            </div>
            <div className="viewport-meta">
              <StatusBadge tone={isRendering ? "warn" : "good"}>
                {isRendering ? t.rendering : `${selectedVersion.id} ${t.selected}`}
              </StatusBadge>
              <span>{t.aspect}</span>
              <span>{t.previewQuality}</span>
              <span>
                {t.activeTool}: {activeToolLabel}
              </span>
              <button className="icon-button" aria-label="Maximize viewport">
                <Maximize2 size={17} />
              </button>
            </div>
          </div>

          <div className="chat-thread" aria-label={t.designChat}>
            <div className="chat-thread-heading">
              <div>
                <p className="eyebrow">{t.chatWorkspace}</p>
                <h2>{t.designChat}</h2>
              </div>
              <StatusBadge tone={isRendering ? "warn" : "good"}>{isRendering ? t.rendering : t.ready}</StatusBadge>
            </div>

            {messages.map((message) => (
              <article
                className={`chat-message chat-message--${message.role} chat-message--${message.kind}`}
                key={message.id}
              >
                <div className="message-avatar">{message.role === "user" ? "U" : "AI"}</div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{message.role === "user" ? t.userLabel : t.aiLabel}</strong>
                    {message.kind === "analysis" && <span>{t.analysisCard}</span>}
                    {message.kind === "render" && <span>{t.renderPreview}</span>}
                  </div>
                  <p>{localized(message.content, locale)}</p>

                  {message.bullets && (
                    <ul className="analysis-list">
                      {message.bullets[locale].map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}

                  {message.kind === "render" && (
                    <div className="render-preview-card">
                      <div className="render-preview-info">
                        <div>
                          <p className="eyebrow">{t.renderPreview}</p>
                          <h3>
                            {message.imageLabel || `${selectedVersion.id} · ${selectedVersion.name[locale]}`}
                          </h3>
                        </div>
                        <span className="score-pill">{selectedVersion.score}</span>
                      </div>
                      {message.imageUrl ? (
                        <>
                          <img className="api-render-image" src={message.imageUrl} alt={message.imageLabel || t.renderPreview} />
                          <div className="render-card-actions">
                            <button type="button" onClick={() => handleOpenResult({ id: message.id, title: message.imageLabel || t.renderPreview, imageUrl: message.imageUrl, imageLabel: message.imageLabel, createdAt: new Date().toISOString() })}>
                              <Eye size={14} />
                              {locale === "zh" ? "打开" : "Open"}
                            </button>
                            <button type="button" onClick={() => handleDownloadResult({ id: message.id, title: message.imageLabel || t.renderPreview, imageUrl: message.imageUrl, imageLabel: message.imageLabel, createdAt: new Date().toISOString() })}>
                              <Download size={14} />
                              {locale === "zh" ? "下载" : "Download"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="render-viewport render-viewport--chat">
                          <div className="viewport-gridlines" />
                          <div className={`render-frame version-scene-${selectedVersion.id.replace(".", "").toLowerCase()}`}>
                            <div className="render-scene">
                              <div className="ceiling-plane" />
                              <div className="back-wall">
                                <span className="wall-art" />
                                <span className="wall-art wall-art--small" />
                              </div>
                              <div className="window-wall" />
                              <div className="floor-plane" />
                              <div className="sofa-block" />
                              <div className="table-block" />
                              <div className="chair-block chair-block--left" />
                              <div className="chair-block chair-block--right" />
                              <div className="plant-block" />
                              <div className="light-beam" />
                              {isRendering && <div className="rendering-scan" />}
                            </div>
                            <div className="frame-overlay frame-overlay--top">
                              {selectedVersion.angle[locale]} / 24mm / {locale === "zh" ? "柔和日光" : "Soft Daylight"}
                            </div>
                            <div className="frame-overlay frame-overlay--bottom">
                              {isRendering
                                ? t.rendering
                                : locale === "zh"
                                  ? `渲染候选 ${selectedVersion.id}`
                                  : `Render candidate ${selectedVersion.id}`}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="filmstrip chat-version-strip" aria-label="Render versions">
            {renderVersions.map((version) => {
              const selected = selectedVersion.id === version.id;
              return (
                <button
                  className={`version-tile ${selected ? "version-tile--selected" : ""} version-tile--${version.status}`}
                  key={version.id}
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  <div className="version-thumb">
                    <span />
                  </div>
                  <div>
                    <strong>{version.id}</strong>
                    <p>{version.name[locale]}</p>
                    <small>{version.angle[locale]}</small>
                  </div>
                  <span className="score-pill">{version.score}</span>
                </button>
              );
            })}
          </div>

          <ResultLibrary
            locale={locale}
            items={renderHistory}
            activeId={activeResultId}
            onSelect={setActiveResultId}
            onDownload={handleDownloadResult}
            onOpen={handleOpenResult}
          />

          <form className="chat-composer" onSubmit={handleComposerSubmit}>
            <div className="composer-head">
              <span>{t.quickBrief}</span>
              <div>
                {styleTokens.slice(0, 3).map((token) => (
                  <button
                    key={token.en}
                    type="button"
                    onClick={() => setChatInput((current) => (current ? `${current}，${token[locale]}` : token[locale]))}
                  >
                    {token[locale]}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={t.composerPlaceholder}
              rows={4}
            />
            <div className="composer-actions">
              <div className="composer-attachments">
                <label>
                  <Upload size={15} />
                  {t.attachFloorPlan}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => setFloorPlanFiles(Array.from(event.target.files ?? []))}
                  />
                </label>
                <label>
                  <ImagePlus size={15} />
                  {t.attachReference}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setReferenceFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <button className="primary-button composer-submit" type="submit" disabled={isRendering}>
                <Send size={16} />
                {isRendering ? t.rendering : t.sendPrompt}
              </button>
            </div>
            {(floorPlanFiles.length > 0 || referenceFile) && (
              <div className="file-chip-row">
                <span>{t.attachedFiles}</span>
                {floorPlanFiles.map((file) => (
                  <em key={`${file.name}-${file.size}`}>{file.name}</em>
                ))}
                {referenceFile && <em>{referenceFile.name}</em>}
                <button type="button" onClick={() => { setFloorPlanFiles([]); setReferenceFile(null); }}>
                  {locale === "zh" ? "清空" : "Clear"}
                </button>
              </div>
            )}
          </form>
        </section>

        <aside className="panel control-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t.renderControls}</p>
              <h2>{t.directionStack}</h2>
            </div>
            <button className="icon-button" aria-label="Panel settings">
              <PanelRight size={17} />
            </button>
          </div>

          <div className="control-section">
            <div className="section-title">
              <Brush size={16} />
              {t.creativeDirection}
            </div>
            <div className="direction-stack">
              {directionItems.map((item, index) => (
                <button
                  className={`direction-item ${activeDirection === index ? "direction-item--active" : ""}`}
                  key={item.en}
                  onClick={() => setActiveDirection(index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{item[locale]}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="control-section">
            <div className="section-title">
              <SlidersHorizontal size={16} />
              {t.renderParameters}
            </div>
            <div className="parameter-grid">
              <ParameterSlider
                label={t.cameraHeight}
                value={parameters.cameraHeight}
                onChange={(value) => updateParameter("cameraHeight", value)}
              />
              <ParameterSlider
                label={t.materialDetail}
                value={parameters.materialDetail}
                onChange={(value) => updateParameter("materialDetail", value)}
              />
              <ParameterSlider
                label={t.daylightBalance}
                value={parameters.daylightBalance}
                onChange={(value) => updateParameter("daylightBalance", value)}
              />
            </div>
          </div>

          <div className="control-section">
            <label className="select-row">
              <span>
                <Box size={15} />
                {t.modelFallback}
              </span>
              <span className="select-shell">
                <select
                  value={selectedModel}
                  onChange={(event) => {
                    setSelectedModel(event.target.value);
                    setApiConfig((current) => ({ ...current, imageModel: event.target.value }));
                  }}
                >
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
            <label className="select-row">
              <span>
                <Clock3 size={15} />
                {t.maxIterations}
              </span>
              <span className="select-shell">
                <select
                  value={maxIterations}
                  onChange={(event) => setMaxIterations(Number(event.target.value))}
                >
                  {iterationOptions.map((count) => (
                    <option key={count} value={count}>
                      {locale === "zh" ? `${count} 轮` : `${count} passes`}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
          </div>

          <div className="control-section">
            <button
              className="config-toggle"
              type="button"
              onClick={() => setShowApiConfig((current) => !current)}
            >
              <span>
                <PlugZap size={16} />
                {locale === "zh" ? "模型与 API 配置" : "Model & API Setup"}
              </span>
              <ChevronDown size={15} className={showApiConfig ? "is-open" : ""} />
            </button>
            <p className="config-hint">
              {locale === "zh"
                ? "留空则使用后端 config.json / .env；如需前端直连配置，可在这里临时填写，密钥不会保存。"
                : "Leave empty to use backend config.json / .env. Fill temporary overrides here; keys are not saved."}
            </p>
            <div className="config-action-row">
              <button type="button" onClick={() => handleVerifyConfig("analysis")}>{locale === "zh" ? "验证分析模型" : "Verify analysis"}</button>
              <button type="button" onClick={() => handleVerifyConfig("image")}>{locale === "zh" ? "验证画图模型" : "Verify image"}</button>
            </div>
            <ConfigStatus status={configStatus} />
            {showApiConfig && (
              <div className="api-config-grid">
                <label>
                  <span>{locale === "zh" ? "分析供应商" : "Analysis provider"}</span>
                  <input
                    value={apiConfig.analysisProviderName}
                    onChange={(event) => setApiConfig((current) => ({ ...current, analysisProviderName: event.target.value }))}
                    placeholder="OpenAI / Anthropic"
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "分析格式" : "Analysis format"}</span>
                  <select
                    value={apiConfig.analysisApiFormat}
                    onChange={(event) => setApiConfig((current) => ({ ...current, analysisApiFormat: event.target.value }))}
                  >
                    {apiFormatOptions.map((option) => (
                      <option key={option.value || "config"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{locale === "zh" ? "分析 Base URL" : "Analysis Base URL"}</span>
                  <input
                    value={apiConfig.analysisBaseUrl}
                    onChange={(event) => setApiConfig((current) => ({ ...current, analysisBaseUrl: event.target.value }))}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "分析 API Key" : "Analysis API Key"}</span>
                  <input
                    type="password"
                    value={apiConfig.analysisApiKey}
                    onChange={(event) => setApiConfig((current) => ({ ...current, analysisApiKey: event.target.value }))}
                    placeholder="sk-..."
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "分析模型" : "Analysis model"}</span>
                  <input
                    value={apiConfig.analysisModel}
                    onChange={(event) => setApiConfig((current) => ({ ...current, analysisModel: event.target.value }))}
                    placeholder="gpt-4o"
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "画图供应商" : "Image provider"}</span>
                  <input
                    value={apiConfig.imageProviderName}
                    onChange={(event) => setApiConfig((current) => ({ ...current, imageProviderName: event.target.value }))}
                    placeholder="OpenAI / custom"
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "画图格式" : "Image format"}</span>
                  <select
                    value={apiConfig.imageApiFormat}
                    onChange={(event) => setApiConfig((current) => ({ ...current, imageApiFormat: event.target.value }))}
                  >
                    {apiFormatOptions.map((option) => (
                      <option key={option.value || "config"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{locale === "zh" ? "画图 Base URL" : "Image Base URL"}</span>
                  <input
                    value={apiConfig.imageBaseUrl}
                    onChange={(event) => setApiConfig((current) => ({ ...current, imageBaseUrl: event.target.value }))}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "画图 API Key" : "Image API Key"}</span>
                  <input
                    type="password"
                    value={apiConfig.imageApiKey}
                    onChange={(event) => setApiConfig((current) => ({ ...current, imageApiKey: event.target.value }))}
                    placeholder="sk-..."
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "画图模型" : "Image model"}</span>
                  <input
                    value={apiConfig.imageModel}
                    onChange={(event) => {
                      setApiConfig((current) => ({ ...current, imageModel: event.target.value }));
                      setSelectedModel(event.target.value || modelOptions[0]);
                    }}
                    placeholder="gpt-image-2"
                  />
                </label>
                <label className="api-config-wide">
                  <span>{locale === "zh" ? "备用模型" : "Fallback models"}</span>
                  <textarea
                    rows={2}
                    value={apiConfig.fallbackModels}
                    onChange={(event) => setApiConfig((current) => ({ ...current, fallbackModels: event.target.value }))}
                    placeholder="dall-e-3, imagen-preview"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="critique-panel">
            <div className="critique-header">
              <div>
                <p className="eyebrow">{t.aiCritique}</p>
                <h3>{t.qualityReview}</h3>
              </div>
              <div className="score-ring">{selectedVersion.score}</div>
            </div>
            <div className="metrics">
              {qualityMetrics.map((metric) => (
                <div className="metric" key={metric.key}>
                  <div>
                    <span>{metric.label[locale]}</span>
                    <strong>{metric.value}%</strong>
                  </div>
                  <div className="meter">
                    <span className={`meter-fill meter-fill--${metric.tone}`} style={{ width: `${metric.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <TimelinePanel locale={locale} copy={t} activeStep={activeStep} onSelectStep={setActiveStep} />
      {toast && <div className="toast-message" role="status">{toast}</div>}
    </main>
  );
}

export default App;
