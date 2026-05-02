import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Box,
  Brush,
  Camera,
  ChevronDown,
  Clipboard,
  Clock3,
  Download,
  Eye,
  FileText,
  ImagePlus,
  Maximize2,
  PanelRight,
  PlugZap,
  Play,
  RotateCcw,
  Ruler,
  Save,
  Send,
  SlidersHorizontal,
  SunMedium,
  Trash2,
  Upload
} from "lucide-react";

import { saveConfig, verifyConfig } from "./api/config";
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
  iterationOptions,
  modelOptions,
  tools
} from "./data/studioData";
import type { ApiConfig, ChatMessage, Locale, ParameterKey, RenderHistoryItem, ToolKey } from "./types/domain";
import { compactLines, localized } from "./utils/text";

const API_CONFIG_STORAGE_KEY = "render-director-api-config-v1";

function normalizeApiConfig(value: unknown): ApiConfig {
  if (!value || typeof value !== "object") {
    return defaultApiConfig;
  }
  const saved = value as Partial<ApiConfig>;
  return {
    ...defaultApiConfig,
    analysisProviderName: String(saved.analysisProviderName ?? defaultApiConfig.analysisProviderName),
    analysisApiFormat: String(saved.analysisApiFormat ?? defaultApiConfig.analysisApiFormat),
    analysisBaseUrl: String(saved.analysisBaseUrl ?? defaultApiConfig.analysisBaseUrl),
    analysisApiKey: String(saved.analysisApiKey ?? defaultApiConfig.analysisApiKey),
    analysisModel: String(saved.analysisModel ?? defaultApiConfig.analysisModel),
    imageProviderName: String(saved.imageProviderName ?? defaultApiConfig.imageProviderName),
    imageApiFormat: String(saved.imageApiFormat ?? defaultApiConfig.imageApiFormat),
    imageBaseUrl: String(saved.imageBaseUrl ?? defaultApiConfig.imageBaseUrl),
    imageApiKey: String(saved.imageApiKey ?? defaultApiConfig.imageApiKey),
    imageModel: String(saved.imageModel ?? defaultApiConfig.imageModel),
    fallbackModels: String(saved.fallbackModels ?? defaultApiConfig.fallbackModels),
    modelSwitchAfterFailures: Number(saved.modelSwitchAfterFailures ?? defaultApiConfig.modelSwitchAfterFailures) || defaultApiConfig.modelSwitchAfterFailures,
    stopAfterLastModelFailures: Number(saved.stopAfterLastModelFailures ?? defaultApiConfig.stopAfterLastModelFailures) || defaultApiConfig.stopAfterLastModelFailures
  };
}

function loadSavedApiConfig(): ApiConfig {
  if (typeof window === "undefined") {
    return defaultApiConfig;
  }
  try {
    const raw = window.localStorage.getItem(API_CONFIG_STORAGE_KEY);
    return raw ? normalizeApiConfig(JSON.parse(raw)) : defaultApiConfig;
  } catch {
    return defaultApiConfig;
  }
}

const initialApiConfig = loadSavedApiConfig();

function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [isRendering, setIsRendering] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolKey>("select");
  const [activeStep, setActiveStep] = useState("idle");
  const [selectedModel, setSelectedModel] = useState(initialApiConfig.imageModel || modelOptions[0]);
  const [maxIterations, setMaxIterations] = useState(5);
  const [parameters, setParameters] = useState<Record<ParameterKey, number>>({
    cameraHeight: 62,
    materialDetail: 84,
    daylightBalance: 70
  });
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [directionDrafts, setDirectionDrafts] = useState<string[]>([]);
  const [floorPlanFiles, setFloorPlanFiles] = useState<File[]>([]);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(initialApiConfig);
  const [configStatus, setConfigStatus] = useState<ConfigStatusState | null>(null);
  const [configAction, setConfigAction] = useState<"save" | "analysis" | "image" | null>(null);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const directionPanelRef = useRef<HTMLDivElement | null>(null);
  const parameterPanelRef = useRef<HTMLDivElement | null>(null);

  const t = copy[locale];
  const activeResult = useMemo(
    () => renderHistory.find((item) => item.id === activeResultId) ?? renderHistory[0] ?? null,
    [activeResultId, renderHistory]
  );
  const activeToolLabel = tools.find((tool) => tool.key === activeTool)?.label[locale] ?? "";
  const hasDirectionContent = directionDrafts.some((item) => item.trim());
  const activePrompt = activeResult?.prompt || (chatInput.trim() || hasDirectionContent ? buildGenerationPrompt() : "");
  const hasWorkspaceContent = Boolean(chatInput.trim()) || hasDirectionContent || floorPlanFiles.length > 0 || Boolean(referenceFile) || messages.length > 0 || renderHistory.length > 0;
  const canGenerate = floorPlanFiles.length > 0 && (Boolean(chatInput.trim()) || hasDirectionContent);
  const latestResult = activeResult;
  const hasRunFailure = activeStep === "failed";
  const projectState = isRendering
    ? t.rendering
    : latestResult
      ? latestResult.status || (locale === "zh" ? "已生成" : "Generated")
      : hasRunFailure
        ? locale === "zh"
          ? "生成失败"
          : "Failed"
        : floorPlanFiles.length === 0
        ? locale === "zh"
          ? "待上传平面图"
          : "Need floor plan"
        : !Boolean(chatInput.trim()) && !hasDirectionContent
          ? locale === "zh"
            ? "待输入需求"
            : "Need brief"
          : locale === "zh"
            ? "可生成"
            : "Ready";

  function updateParameter(key: ParameterKey, value: number) {
    setParameters((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    if (!isPreviewExpanded) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPreviewExpanded(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPreviewExpanded]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600);
  }

  function addDirection(text = "") {
    setDirectionDrafts((current) => [...current, text].slice(0, 8));
  }

  function updateDirection(index: number, value: string) {
    setDirectionDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function removeDirection(index: number) {
    setDirectionDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function appendDirection(text: string) {
    const nextText = text.trim();
    if (!nextText) return;
    setDirectionDrafts((current) => {
      if (current.includes(nextText)) return current;
      return [...current, nextText].slice(0, 8);
    });
  }

  function handleToolActivate(toolKey: ToolKey) {
    setActiveTool(toolKey);
    if (toolKey === "select") {
      composerRef.current?.focus();
      return;
    }
    if (toolKey === "assets") {
      floorPlanInputRef.current?.click();
      return;
    }
    if (toolKey === "material") {
      directionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (toolKey === "lighting") {
      parameterPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function buildGenerationPrompt(userPrompt?: string) {
    const basePrompt = (userPrompt ?? chatInput).trim();
    const directions = directionDrafts.map((item) => item.trim()).filter(Boolean);
    const sections = [];
    if (basePrompt) {
      sections.push(locale === "zh" ? `设计需求：${basePrompt}` : `Design brief: ${basePrompt}`);
    }
    if (directions.length > 0) {
      sections.push(`${locale === "zh" ? "设计指令栈" : "Direction stack"}:\n${directions.map((item) => `- ${item}`).join("\n")}`);
    }
    sections.push(
      locale === "zh"
        ? `渲染参数：相机高度 ${parameters.cameraHeight}%，材质细节 ${parameters.materialDetail}%，日光平衡 ${parameters.daylightBalance}%。`
        : `Render parameters: camera height ${parameters.cameraHeight}%, material detail ${parameters.materialDetail}%, daylight balance ${parameters.daylightBalance}%.`
    );
    return sections.join("\n\n");
  }

  function clearAttachments(silent = false) {
    setFloorPlanFiles([]);
    setReferenceFile(null);
    if (floorPlanInputRef.current) {
      floorPlanInputRef.current.value = "";
    }
    if (referenceInputRef.current) {
      referenceInputRef.current.value = "";
    }
    if (!silent) {
      showToast(locale === "zh" ? "已清空附件" : "Attachments cleared");
    }
  }

  function handleResetWorkspace() {
    setMessages([]);
    setChatInput("");
    setDirectionDrafts([]);
    setRenderHistory([]);
    setActiveResultId(null);
    setActiveTool("select");
    setActiveStep("idle");
    setParameters({ cameraHeight: 62, materialDetail: 84, daylightBalance: 70 });
    setShowApiConfig(false);
    setConfigStatus(null);
    setConfigAction(null);
    setIsPreviewExpanded(false);
    clearAttachments(true);
    showToast(locale === "zh" ? "工作台已重置" : "Workspace reset");
  }

  function handleFloorPlanChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setFloorPlanFiles(files);
    if (files.length > 0) {
      showToast(locale === "zh" ? `已选择 ${files.length} 张平面图` : `${files.length} floor plan file(s) selected`);
    }
  }

  function handleReferenceChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setReferenceFile(file);
    if (file) {
      showToast(locale === "zh" ? `已选择参考图：${file.name}` : `Reference selected: ${file.name}`);
    }
  }

  function handleExpandPreview() {
    if (!activeResult?.imageUrl) {
      showToast(locale === "zh" ? "暂无可放大的生成图片" : "No generated image to expand yet");
      return;
    }
    setIsPreviewExpanded(true);
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

  async function handleCopyActivePrompt() {
    if (!activePrompt) {
      showToast(locale === "zh" ? "暂无可复制的提示词" : "No prompt to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(activePrompt);
      showToast(locale === "zh" ? "已复制提示词" : "Prompt copied");
    } catch {
      showToast(locale === "zh" ? "复制失败，请手动复制" : "Copy failed");
    }
  }

  function handleUseResultPrompt(item: RenderHistoryItem) {
    if (!item.prompt) {
      showToast(locale === "zh" ? "这条结果没有可载入的提示词" : "This result has no prompt to load");
      return;
    }
    setChatInput(item.prompt);
    setActiveResultId(item.id);
    showToast(locale === "zh" ? "已把结果提示词载入输入框" : "Prompt loaded into composer");
  }

  function handleRemoveResult(id: string) {
    setRenderHistory((current) => {
      const next = current.filter((item) => item.id !== id);
      setActiveResultId((currentActive) => {
        if (currentActive !== id) return currentActive;
        return next[0]?.id ?? null;
      });
      return next;
    });
    showToast(locale === "zh" ? "已移除该结果" : "Result removed");
  }

  function handleClearHistory() {
    setRenderHistory([]);
    setActiveResultId(null);
    showToast(locale === "zh" ? "结果库已清空" : "Result library cleared");
  }

  async function runConversationFlow(userPrompt?: string) {
    if (isRendering) return;
    const prompt = buildGenerationPrompt(userPrompt);
    if (!canGenerate) {
      showToast(locale === "zh" ? "请先上传平面图并输入需求或设计指令" : "Upload a floor plan and add a brief or direction first");
      return;
    }
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
        zh: "我已收到需求，正在提交到后端。当前不会使用演示数据，结果会等真实生成返回后才出现。",
        en: "The request is being submitted to the backend. No demo result is shown; output appears only after the real generation returns."
      },
      bullets: {
        zh: ["提交需求与指令栈", "同步附件与参数", "等待后端返回结果"],
        en: ["Submit brief and direction stack", "Sync attachments and parameters", "Wait for backend result"]
      }
    });
    setMessages((current) => [...current, ...nextMessages]);
    setIsRendering(true);
    setActiveStep("submitted");

    try {
      const result = await requestGeneration({
        prompt,
        directionStackText: directionDrafts.map((item) => item.trim()).filter(Boolean).join("\n"),
        maxIterations,
        apiConfig,
        selectedModel,
        floorPlanFiles,
        referenceFile
      });
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
      setActiveStep("completed");
      showToast(locale === "zh" ? "生成完成，已加入结果库" : "Generation completed and added to library");
      const resultMessages: ChatMessage[] = [
        {
          id: `m-api-analysis-${idBase}`,
          role: "assistant",
          kind: "analysis",
          content: result.floor_desc || result.evaluation || result.status || (locale === "zh" ? "后端已返回结果" : "Backend result returned"),
          bullets: {
            zh: compactLines([result.status || "", result.prompt ? "提示词已生成" : "", result.evaluation ? "评估报告已返回" : ""]),
            en: compactLines([result.status || "", result.prompt ? "Prompt generated" : "", result.evaluation ? "Evaluation returned" : ""])
          }
        },
        {
          id: `m-api-render-${idBase}`,
          role: "assistant",
          kind: "render",
          content: result.ok ? (locale === "zh" ? "真实渲染结果已返回" : "Real render result returned") : result.error || t.requestFailed,
          imageUrl: firstImage?.data_url,
          imageLabel: firstImage?.label
        }
      ];
      setMessages((current) => [...current, ...resultMessages]);
    } catch (error) {
      setActiveStep("failed");
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
    runConversationFlow();
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runConversationFlow();
  }

  async function handleVerifyConfig(role: "analysis" | "image") {
    const label = locale === "zh" ? (role === "analysis" ? "分析模型" : "画图模型") : role === "analysis" ? "analysis model" : "image model";
    setConfigAction(role);
    setConfigStatus({ tone: "warn", message: locale === "zh" ? `正在验证${label}...` : `Verifying ${label}...` });
    try {
      const result = await verifyConfig(role, apiConfig);
      setConfigStatus({ tone: "good", message: result.message || (locale === "zh" ? `${label}验证通过` : `${label} verified`) });
    } catch (error) {
      setConfigStatus({ tone: "warn", message: `${locale === "zh" ? `${label}验证失败` : `${label} verification failed`}: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setConfigAction(null);
    }
  }

  async function handleSaveApiConfig() {
    setConfigAction("save");
    setConfigStatus({
      tone: "warn",
      message: locale === "zh" ? "正在保存到 config.json / .env..." : "Saving to config.json / .env..."
    });
    try {
      window.localStorage.setItem(API_CONFIG_STORAGE_KEY, JSON.stringify(apiConfig));
      const result = await saveConfig(apiConfig);
      setConfigStatus({
        tone: "good",
        message: result.message || (locale === "zh" ? "模型与 API 配置已保存到本地文件" : "Model and API setup saved to local files")
      });
      showToast(locale === "zh" ? "配置已保存到文件" : "Configuration saved to files");
    } catch (error) {
      setConfigStatus({
        tone: "warn",
        message: `${locale === "zh" ? "配置保存失败" : "Configuration save failed"}: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      setConfigAction(null);
    }
  }

  function handleResetApiConfig() {
    setApiConfig(defaultApiConfig);
    setSelectedModel(defaultApiConfig.imageModel || modelOptions[0]);
    window.localStorage.removeItem(API_CONFIG_STORAGE_KEY);
    setConfigStatus({
      tone: "good",
      message:
        locale === "zh"
          ? "已恢复默认配置；后端仍会使用 config.json / .env 中已有配置。"
          : "Defaults restored. The backend can still use existing config.json / .env values."
    });
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
            <strong>{projectState}</strong>
          </div>
          <div>
            <span>{t.iteration}</span>
            <strong>{String(renderHistory.length).padStart(2, "0")} / {String(maxIterations).padStart(2, "0")}</strong>
          </div>
        </div>

        <div className="studio-actions">
          <div className="language-toggle" aria-label={t.language}>
            <button type="button" className={locale === "zh" ? "is-active" : ""} onClick={() => setLocale("zh")}>
              中文
            </button>
            <button type="button" className={locale === "en" ? "is-active" : ""} onClick={() => setLocale("en")}>
              EN
            </button>
          </div>
          <button type="button" className="icon-button" aria-label={t.preview} onClick={() => handleOpenResult(activeResult)} title={t.preview} disabled={!activeResult?.imageUrl}>
            <Eye size={18} />
          </button>
          <button type="button" className="icon-button" aria-label={locale === "zh" ? "复制摘要" : "Copy summary"} onClick={() => handleCopyRunSummary(activeResult)} title={locale === "zh" ? "复制摘要" : "Copy summary"} disabled={!activeResult}>
            <FileText size={18} />
          </button>
          <button type="button" className="icon-button" aria-label={locale === "zh" ? "复制提示词" : "Copy prompt"} onClick={handleCopyActivePrompt} title={locale === "zh" ? "复制提示词" : "Copy prompt"} disabled={!activePrompt}>
            <Clipboard size={18} />
          </button>
          <button type="button" className="icon-button" aria-label={t.export} onClick={() => handleDownloadResult(activeResult)} title={t.export} disabled={!activeResult?.imageUrl}>
            <Download size={18} />
          </button>
          <button type="button" className="icon-button" aria-label={locale === "zh" ? "重置工作台" : "Reset workspace"} onClick={handleResetWorkspace} title={locale === "zh" ? "重置工作台" : "Reset workspace"} disabled={!hasWorkspaceContent || isRendering}>
            <RotateCcw size={18} />
          </button>
          <button type="button" className="primary-button" onClick={handleGenerate} disabled={isRendering || !canGenerate}>
            <Play size={17} />
            {isRendering ? t.rendering : t.generate}
          </button>
        </div>
      </header>

      <section className="workspace-grid">
          <ProjectBriefPanel
            locale={locale}
            copy={t}
            isRendering={isRendering}
            floorPlanCount={floorPlanFiles.length}
            floorPlanNames={floorPlanFiles.map((file) => file.name)}
            referenceFileName={referenceFile?.name ?? ""}
            onPickFloorPlan={() => floorPlanInputRef.current?.click()}
            onPickReference={() => referenceInputRef.current?.click()}
          />
          <input
            ref={floorPlanInputRef}
            className="visually-hidden-input"
            type="file"
            accept="image/*"
            multiple
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFloorPlanChange}
          />
          <input
            ref={referenceInputRef}
            className="visually-hidden-input"
            type="file"
            accept="image/*"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleReferenceChange}
          />

        <section className="viewport-zone chat-workspace">
          <div className="viewport-toolbar">
            <div className="toolbar-group">
              {tools.map((tool) => (
                <button
                  className={`tool-button ${activeTool === tool.key ? "is-active" : ""}`}
                  key={tool.key}
                  onClick={() => handleToolActivate(tool.key)}
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
                {isRendering ? t.rendering : latestResult ? (locale === "zh" ? "有结果" : "Result ready") : hasRunFailure ? (locale === "zh" ? "生成失败" : "Failed") : (locale === "zh" ? "空项目" : "Empty project")}
              </StatusBadge>
              <span>{t.aspect}</span>
              <span>{t.previewQuality}</span>
              <span>
                {t.activeTool}: {activeToolLabel}
              </span>
              <button
                className="icon-button"
                aria-label={locale === "zh" ? "放大预览" : "Expand preview"}
                title={locale === "zh" ? "放大预览" : "Expand preview"}
                onClick={handleExpandPreview}
                disabled={!activeResult?.imageUrl}
              >
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

            {messages.length === 0 && (
              <div className="empty-workspace">
                <strong>{locale === "zh" ? "从空项目开始" : "Start from an empty project"}</strong>
                <p>
                  {locale === "zh"
                    ? "上传平面图，输入设计需求，必要时在右侧补充可编辑的设计指令栈，然后再生成。这里不会预置演示结果。"
                    : "Upload a floor plan, write the brief, optionally edit the direction stack on the right, then generate. No demo result is preloaded here."}
                </p>
              </div>
            )}

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
                          <h3>{message.imageLabel || (locale === "zh" ? "后端返回结果" : "Backend result")}</h3>
                        </div>
                        {message.imageUrl && <span className="score-pill">{locale === "zh" ? "结果" : "Result"}</span>}
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
                        <div className="empty-render-result">
                          {locale === "zh" ? "本次请求没有返回图片文件。" : "This request did not return an image file."}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          <ResultLibrary
            locale={locale}
            items={renderHistory}
            activeId={activeResultId}
            onSelect={setActiveResultId}
            onDownload={handleDownloadResult}
            onOpen={handleOpenResult}
            onCopy={handleCopyRunSummary}
            onUsePrompt={handleUseResultPrompt}
            onRemove={handleRemoveResult}
            onClear={handleClearHistory}
          />

          <form className="chat-composer" onSubmit={handleComposerSubmit}>
            <div className="composer-head">
              <span>{t.quickBrief}</span>
              <div>
                <button type="button" onClick={handleCopyActivePrompt} disabled={!activePrompt}>
                  <Clipboard size={14} />
                  {locale === "zh" ? "复制提示词" : "Copy prompt"}
                </button>
                <button type="button" onClick={() => setChatInput("")} disabled={!chatInput.trim()}>
                  <RotateCcw size={14} />
                  {locale === "zh" ? "清空输入" : "Clear draft"}
                </button>
              </div>
            </div>
            <textarea
              ref={composerRef}
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
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={handleFloorPlanChange}
                  />
                </label>
                <label>
                  <ImagePlus size={15} />
                  {t.attachReference}
                  <input
                    type="file"
                    accept="image/*"
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={handleReferenceChange}
                  />
                </label>
                <button type="button" onClick={() => clearAttachments()} disabled={!floorPlanFiles.length && !referenceFile}>
                  <Trash2 size={15} />
                  {locale === "zh" ? "清空附件" : "Clear files"}
                </button>
              </div>
              <button className="primary-button composer-submit" type="submit" disabled={isRendering || !canGenerate}>
                <Send size={16} />
                {isRendering ? t.rendering : canGenerate ? t.sendPrompt : (locale === "zh" ? "先补齐输入" : "Need brief")}
              </button>
            </div>
            {!canGenerate && (
              <p className="composer-hint">
                {locale === "zh" ? "至少上传一张平面图，并填写需求或指令栈中的任意一项，才能开始生成。" : "Upload at least one floor plan and fill either the brief or the direction stack before generating."}
              </p>
            )}
            {(floorPlanFiles.length > 0 || referenceFile) && (
              <div className="file-chip-row">
                <span>{t.attachedFiles}</span>
                {floorPlanFiles.map((file) => (
                  <em key={`${file.name}-${file.size}`}>{file.name}</em>
                ))}
                {referenceFile && <em>{referenceFile.name}</em>}
                <button type="button" onClick={() => clearAttachments()}>
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
            <button
              className="icon-button"
              aria-label={locale === "zh" ? "打开模型配置" : "Open model setup"}
              title={locale === "zh" ? "打开模型配置" : "Open model setup"}
              onClick={() => {
                setShowApiConfig((current) => !current);
                showToast(locale === "zh" ? "已切换模型配置面板" : "Model setup panel toggled");
              }}
            >
              <PanelRight size={17} />
            </button>
          </div>

          <div className="control-section" ref={directionPanelRef}>
            <div className="section-title">
              <Brush size={16} />
              {t.creativeDirection}
            </div>
            <div className="direction-editor">
              {directionDrafts.length === 0 && (
                <p className="direction-empty">
                  {locale === "zh" ? "这里还没有指令。添加几条设计约束，生成时会一起发送到后端。" : "No directions yet. Add a few constraints and they will be sent together with the brief."}
                </p>
              )}
              {directionDrafts.map((item, index) => (
                <div className="direction-row" key={index}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <input
                    value={item}
                    onChange={(event) => updateDirection(index, event.target.value)}
                    placeholder={locale === "zh" ? "输入一条设计指令" : "Enter one direction"}
                  />
                  <button type="button" onClick={() => removeDirection(index)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="direction-actions">
                <button type="button" onClick={() => addDirection()}>
                  {locale === "zh" ? "添加一条" : "Add line"}
                </button>
                <button type="button" onClick={() => setDirectionDrafts([])} disabled={directionDrafts.length === 0}>
                  {locale === "zh" ? "清空指令" : "Clear stack"}
                </button>
              </div>
              <p className="quick-stack-label">{locale === "zh" ? "可选快捷添加" : "Optional quick add"}</p>
              <div className="quick-stack">
                {directionItems.map((item) => (
                  <button type="button" key={item.en} onClick={() => appendDirection(item[locale])}>
                    {item[locale]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="control-section" ref={parameterPanelRef}>
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
                ? "留空则使用后端 config.json / .env；点击保存配置后会写入本地 config.json / .env，并同步缓存到本机浏览器。"
                : "Leave empty to use backend config.json / .env. Save writes to local config.json / .env and also caches it in this browser."}
            </p>
            <div className="config-action-row">
              <button type="button" onClick={handleSaveApiConfig} disabled={configAction !== null}>
                <Save size={14} />
                {configAction === "save" ? (locale === "zh" ? "保存中" : "Saving") : locale === "zh" ? "保存配置" : "Save setup"}
              </button>
              <button type="button" onClick={() => handleVerifyConfig("analysis")} disabled={configAction !== null}>
                {configAction === "analysis" ? (locale === "zh" ? "验证中" : "Verifying") : locale === "zh" ? "验证分析模型" : "Verify analysis"}
              </button>
              <button type="button" onClick={() => handleVerifyConfig("image")} disabled={configAction !== null}>
                {configAction === "image" ? (locale === "zh" ? "验证中" : "Verifying") : locale === "zh" ? "验证画图模型" : "Verify image"}
              </button>
              <button type="button" onClick={handleResetApiConfig} disabled={configAction !== null}>
                <RotateCcw size={14} />
                {locale === "zh" ? "恢复默认" : "Reset"}
              </button>
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
                <label>
                  <span>{locale === "zh" ? "失败后切换模型" : "Switch after failures"}</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={apiConfig.modelSwitchAfterFailures}
                    onChange={(event) => setApiConfig((current) => ({ ...current, modelSwitchAfterFailures: Number(event.target.value) || 1 }))}
                  />
                </label>
                <label>
                  <span>{locale === "zh" ? "最终模型失败停止" : "Stop after final failures"}</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={apiConfig.stopAfterLastModelFailures}
                    onChange={(event) => setApiConfig((current) => ({ ...current, stopAfterLastModelFailures: Number(event.target.value) || 1 }))}
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
              <div className="score-ring">{latestResult ? "OK" : "--"}</div>
            </div>
            <div className="result-summary">
              {latestResult ? (
                <>
                  <p>{latestResult.status || (locale === "zh" ? "已完成" : "Completed")}</p>
                  {latestResult.evaluation && <pre>{latestResult.evaluation}</pre>}
                </>
              ) : (
                <p>{locale === "zh" ? "生成完成后，这里会显示后端真实评估结果。" : "After generation, the real backend evaluation appears here."}</p>
              )}
            </div>
          </div>
        </aside>
      </section>

      <TimelinePanel locale={locale} copy={t} activeStep={activeStep} onSelectStep={setActiveStep} hasRun={messages.length > 0 || isRendering || renderHistory.length > 0} />
      {isPreviewExpanded && activeResult?.imageUrl && (
        <div className="preview-modal" role="dialog" aria-modal="true" aria-label={locale === "zh" ? "生成图放大预览" : "Expanded render preview"}>
          <div className="preview-modal__bar">
            <div>
              <p className="eyebrow">{locale === "zh" ? "生成图预览" : "Render preview"}</p>
              <h2>{activeResult.imageLabel || activeResult.title}</h2>
            </div>
            <div className="preview-modal__actions">
              <button type="button" onClick={() => handleDownloadResult(activeResult)}>
                <Download size={15} />
                {locale === "zh" ? "下载" : "Download"}
              </button>
              <button type="button" onClick={() => setIsPreviewExpanded(false)}>
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>
          </div>
          <img src={activeResult.imageUrl} alt={activeResult.imageLabel || activeResult.title} />
        </div>
      )}
      {toast && <div className="toast-message" role="status">{toast}</div>}
    </main>
  );
}

export default App;
