import { type FormEvent, useMemo, useState } from "react";
import {
  Aperture,
  BadgeCheck,
  Box,
  Brush,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  Layers3,
  Maximize2,
  PanelRight,
  Play,
  Ruler,
  Send,
  SlidersHorizontal,
  SunMedium,
  Upload
} from "lucide-react";

type Locale = "zh" | "en";
type Tone = "neutral" | "good" | "warn";
type ToolKey = "select" | "assets" | "material" | "lighting";
type ParameterKey = "cameraHeight" | "materialDetail" | "daylightBalance";

type LocalizedText = Record<Locale, string>;

type RenderVersion = {
  id: string;
  name: LocalizedText;
  score: string;
  angle: LocalizedText;
  status: "ready" | "review";
  metrics: Record<ParameterKey | "composition", number>;
};

type IterationRun = {
  step: string;
  title: LocalizedText;
  model: string;
  score: LocalizedText;
  status: "accepted" | "refined" | "warning";
  notes: Record<Locale, string[]>;
};

type Metric = {
  key: string;
  label: LocalizedText;
  value: number;
  tone: Tone;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "analysis" | "render" | "error";
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  imageUrl?: string;
  imageLabel?: string;
};

type ApiImage = {
  label: string;
  filename: string;
  data_url: string;
};

type GenerateResponse = {
  ok: boolean;
  status?: string;
  floor_desc?: string;
  prompt?: string;
  evaluation?: string;
  logs?: string;
  images?: ApiImage[];
  error?: string;
  stage?: string;
};

const copy = {
  zh: {
    appName: "Render Director Studio",
    title: "室内效果图设计工作台",
    modeLabel: "模式",
    modeValue: "3D 效果图",
    modelLabel: "模型",
    qualityGate: "质量阈值",
    iteration: "迭代",
    preview: "预览",
    export: "导出",
    generate: "开始生成",
    rendering: "生成中",
    ready: "就绪",
    selected: "已选中",
    aspect: "16:9",
    previewQuality: "4K 预览",
    projectBrief: "项目资料",
    projectName: "住宅 A-14",
    replaceFloorPlan: "替换平面图",
    designRequest: "设计需求",
    designRequestCopy:
      "现代新中式客厅空间，克制的高级感、自然材质、清晰动线，以及西南 45 度电影感鸟瞰视角。",
    renderControls: "渲染控制",
    directionStack: "设计指令栈",
    creativeDirection: "创意方向",
    renderParameters: "渲染参数",
    cameraHeight: "相机高度",
    materialDetail: "材质细节",
    daylightBalance: "日光平衡",
    modelFallback: "备用模型",
    maxIterations: "最大迭代",
    aiCritique: "AI 评审",
    qualityReview: "质量复核",
    timeline: "迭代时间线",
    runTrace: "运行轨迹",
    noteOpen: "1 条待处理",
    activeTool: "当前工具",
    language: "语言",
    directionState: "已聚焦",
    selectedStep: "当前步骤",
    designChat: "设计对话",
    chatWorkspace: "需求输入与方案推演",
    userLabel: "你",
    aiLabel: "设计总监 AI",
    composerPlaceholder: "描述空间、风格、镜头、材质或你希望调整的画面细节...",
    attachFloorPlan: "平面图",
    attachReference: "参考图",
    attachedFiles: "已选择文件",
    sendPrompt: "发送需求",
    analysisCard: "空间分析",
    renderPreview: "渲染预览",
    quickBrief: "快捷方向",
    emptyPrompt: "请输入设计需求",
    requestFailed: "生成请求失败",
    apiAnalysisReady: "后端已返回空间分析与评估结果。",
    apiRenderReady: "后端已返回渲染结果。"
  },
  en: {
    appName: "Render Director Studio",
    title: "Interior Visualization Agent",
    modeLabel: "Mode",
    modeValue: "3D Render",
    modelLabel: "Model",
    qualityGate: "Quality Gate",
    iteration: "Iteration",
    preview: "Preview",
    export: "Export",
    generate: "Generate",
    rendering: "Rendering",
    ready: "Ready",
    selected: "selected",
    aspect: "16:9",
    previewQuality: "4K Preview",
    projectBrief: "Project Brief",
    projectName: "Residence A-14",
    replaceFloorPlan: "Replace floor plan",
    designRequest: "Design Request",
    designRequestCopy:
      "Modern new oriental living space with restrained luxury, natural materials, clear circulation, and a cinematic south-west aerial camera angle.",
    renderControls: "Render Controls",
    directionStack: "Direction Stack",
    creativeDirection: "Creative Direction",
    renderParameters: "Render Parameters",
    cameraHeight: "Camera Height",
    materialDetail: "Material Detail",
    daylightBalance: "Daylight Balance",
    modelFallback: "Model Fallback",
    maxIterations: "Max Iterations",
    aiCritique: "AI Critique",
    qualityReview: "Quality Review",
    timeline: "Iteration Timeline",
    runTrace: "Run Trace",
    noteOpen: "1 note open",
    activeTool: "Active Tool",
    language: "Language",
    directionState: "Focused",
    selectedStep: "Selected Step",
    designChat: "Design Chat",
    chatWorkspace: "Prompt and direction workspace",
    userLabel: "You",
    aiLabel: "Design Director AI",
    composerPlaceholder: "Describe the space, style, camera, materials, or visual details you want to adjust...",
    attachFloorPlan: "Floor plan",
    attachReference: "Reference",
    attachedFiles: "Selected files",
    sendPrompt: "Send prompt",
    analysisCard: "Spatial Analysis",
    renderPreview: "Render Preview",
    quickBrief: "Quick Direction",
    emptyPrompt: "Enter a design prompt",
    requestFailed: "Generation request failed",
    apiAnalysisReady: "The backend returned spatial analysis and evaluation results.",
    apiRenderReady: "The backend returned render results."
  }
} satisfies Record<Locale, Record<string, string>>;

const styleTokens: LocalizedText[] = [
  { zh: "现代新中式", en: "Modern Oriental" },
  { zh: "温暖画廊感", en: "Gallery Warmth" },
  { zh: "石材 + 胡桃木", en: "Stone + Oak" },
  { zh: "柔和日光", en: "Soft Daylight" }
];

const referenceAssets = [
  {
    label: { zh: "平面图", en: "Floor Plan" },
    meta: { zh: "142 平方米 / 3 个空间", en: "142 sqm / 3 rooms" },
    icon: FileImage
  },
  {
    label: { zh: "材质板", en: "Material Board" },
    meta: { zh: "洞石、胡桃木、亚麻", en: "travertine, walnut, linen" },
    icon: Layers3
  },
  {
    label: { zh: "参考视角", en: "Reference View" },
    meta: { zh: "西南 45 度", en: "south-west 45deg" },
    icon: ImagePlus
  }
];

const renderVersions: RenderVersion[] = [
  {
    id: "A.04",
    name: { zh: "温暖画廊", en: "Warm Gallery" },
    score: "8.7",
    angle: { zh: "西南 45 度", en: "SW 45deg" },
    status: "ready",
    metrics: { composition: 92, materialDetail: 84, cameraHeight: 78, daylightBalance: 88 }
  },
  {
    id: "A.03",
    name: { zh: "材质聚焦", en: "Material Focus" },
    score: "8.1",
    angle: { zh: "平视视角", en: "Eye level" },
    status: "ready",
    metrics: { composition: 84, materialDetail: 91, cameraHeight: 74, daylightBalance: 79 }
  },
  {
    id: "A.02",
    name: { zh: "夜景预览", en: "Night Preview" },
    score: "7.6",
    angle: { zh: "24mm 广角", en: "Wide 24mm" },
    status: "review",
    metrics: { composition: 78, materialDetail: 76, cameraHeight: 71, daylightBalance: 82 }
  }
];

const iterationRuns: IterationRun[] = [
  {
    step: "01",
    title: { zh: "空间分析", en: "Spatial Analysis" },
    model: "gpt-4o vision",
    score: { zh: "已锁定", en: "locked" },
    status: "accepted",
    notes: {
      zh: ["开放客厅区域", "识别到主要采光面", "主行动线清晰"],
      en: ["Open living zone", "Window wall detected", "Primary circulation clear"]
    }
  },
  {
    step: "02",
    title: { zh: "指令栈生成", en: "Direction Stack" },
    model: "layered_constraints_v1",
    score: { zh: "稳定", en: "stable" },
    status: "accepted",
    notes: {
      zh: ["镜头：西南 45 度", "材质：石材 + 胡桃木", "光照：柔和日光"],
      en: ["Camera: SW 45deg", "Material: stone + walnut", "Lighting: soft daylight"]
    }
  },
  {
    step: "03",
    title: { zh: "候选渲染", en: "Render Candidate" },
    model: "gpt-image-2",
    score: { zh: "8.7", en: "8.7" },
    status: "refined",
    notes: {
      zh: ["构图已优化", "保留吊顶细节", "修正材质比例"],
      en: ["Composition improved", "Ceiling detail retained", "Texture scale corrected"]
    }
  },
  {
    step: "04",
    title: { zh: "评审通过", en: "Critique Pass" },
    model: "vision evaluator",
    score: { zh: "轻微问题", en: "minor" },
    status: "warning",
    notes: {
      zh: ["餐区吊灯对齐需要复核", "石材纹理保持更克制"],
      en: ["Dining pendant alignment needs review", "Keep stone veins quieter"]
    }
  }
];

const directionItems: LocalizedText[] = [
  { zh: "现代新中式高端住宅套间", en: "Modern oriental hospitality suite" },
  { zh: "低对比天然石材表面", en: "Low contrast natural stone surfaces" },
  { zh: "胡桃木定制柜体与亚麻墙面", en: "Walnut millwork with linen wall finish" },
  { zh: "柔和日光与真实全局照明", en: "Soft daylight, realistic global illumination" },
  { zh: "建筑摄影镜头，24mm，西南 45 度", en: "Architectural lens, 24mm, SW 45deg aerial" }
];

const initialChatMessages: ChatMessage[] = [
  {
    id: "m-brief",
    role: "user",
    kind: "text",
    content: {
      zh: "我想做一个现代新中式客厅效果图，空间要高级但克制，参考平面图生成西南 45 度鸟瞰视角。",
      en: "I want a modern oriental living room render that feels restrained and premium, using the floor plan with a south-west 45 degree aerial view."
    }
  },
  {
    id: "m-analysis",
    role: "assistant",
    kind: "analysis",
    content: {
      zh: "已读取平面图与参考方向。当前空间适合以横向客厅为主画面，保留右侧采光面，并用低饱和材质建立高级感。",
      en: "I read the floor plan and reference direction. The space works best with a horizontal living-room composition, keeping the window wall and using low-saturation materials."
    },
    bullets: {
      zh: ["主视角：西南 45 度", "材质：洞石、胡桃木、亚麻", "光照：柔和日光"],
      en: ["Camera: SW 45deg", "Materials: travertine, walnut, linen", "Lighting: soft daylight"]
    }
  },
  {
    id: "m-render",
    role: "assistant",
    kind: "render",
    content: {
      zh: "我先给出一版候选渲染，并把构图、材质、空间准确性和光照控制同步到右侧评审面板。",
      en: "I prepared a render candidate and synced composition, material fidelity, spatial accuracy, and lighting control to the critique panel."
    }
  }
];

const tools: Array<{ key: ToolKey; label: LocalizedText; icon: "pointer" | "camera" | "ruler" | "sun" }> = [
  { key: "select", label: { zh: "选择", en: "Select" }, icon: "pointer" },
  { key: "assets", label: { zh: "视角", en: "Camera" }, icon: "camera" },
  { key: "material", label: { zh: "测量", en: "Measure" }, icon: "ruler" },
  { key: "lighting", label: { zh: "光照", en: "Lighting" }, icon: "sun" }
];

const modelOptions = ["gpt-image-2", "dall-e-3", "imagen-preview"];
const iterationOptions = [3, 4, 5];

function StatusBadge({ children, tone = "neutral" }: { children: string; tone?: Tone }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

function localized(value: LocalizedText | string, locale: Locale) {
  return typeof value === "string" ? value : value[locale];
}

function compactLines(values: string[]) {
  const lines = values.map((value) => value.trim()).filter(Boolean);
  return lines.length ? lines : ["OK"];
}

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

  const t = copy[locale];
  const selectedVersion = useMemo(
    () => renderVersions.find((version) => version.id === selectedVersionId) ?? renderVersions[0],
    [selectedVersionId]
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
      const result = await requestGeneration(prompt);
      setSelectedVersionId("A.04");
      setActiveStep("04");
      const firstImage = result.images?.[0];
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

  async function requestGeneration(prompt: string): Promise<GenerateResponse> {
    const formData = new FormData();
    formData.append("mode", "render3d");
    formData.append("requirement", prompt);
    formData.append("manual_prompt", "");
    formData.append("max_iterations", String(maxIterations));
    formData.append("img_model", selectedModel);
    for (const file of floorPlanFiles) {
      formData.append("floor_plans", file);
    }
    if (referenceFile) {
      formData.append("reference_image", referenceFile);
    }

    const response = await fetch("/api/generate", {
      method: "POST",
      body: formData
    });
    const data = (await response.json()) as GenerateResponse;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || data.status || response.statusText);
    }
    return data;
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
          <button className="icon-button" aria-label={t.preview}>
            <Eye size={18} />
          </button>
          <button className="icon-button" aria-label={t.export}>
            <Download size={18} />
          </button>
          <button className="primary-button" onClick={handleGenerate} disabled={isRendering}>
            <Play size={17} />
            {isRendering ? t.rendering : t.generate}
          </button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel brief-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t.projectBrief}</p>
              <h2>{t.projectName}</h2>
            </div>
            <StatusBadge tone={isRendering ? "warn" : "good"}>{isRendering ? t.rendering : t.ready}</StatusBadge>
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
              {t.replaceFloorPlan}
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
              {t.designRequest}
            </div>
            <p>{t.designRequestCopy}</p>
          </div>

          <div className="token-wrap">
            {styleTokens.map((token) => (
              <span className="style-token" key={token.en}>
                {token[locale]}
              </span>
            ))}
          </div>
        </aside>

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
                        <img className="api-render-image" src={message.imageUrl} alt={message.imageLabel || t.renderPreview} />
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
              <button className="primary-button composer-submit" type="submit" disabled={isRendering || !chatInput.trim()}>
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
                <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
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

      <section className="timeline-panel">
        <div className="timeline-heading">
          <div>
            <p className="eyebrow">{t.timeline}</p>
            <h2>{t.runTrace}</h2>
          </div>
          <div className="timeline-meta">
            <StatusBadge tone="warn">{t.noteOpen}</StatusBadge>
            <span>
              {t.selectedStep}: {activeStep}
            </span>
          </div>
        </div>
        <div className="timeline-grid">
          {iterationRuns.map((run) => (
            <button
              className={`timeline-card timeline-card--${run.status} ${
                activeStep === run.step ? "timeline-card--active" : ""
              }`}
              key={run.step}
              onClick={() => setActiveStep(run.step)}
            >
              <div className="timeline-step">
                <span>{run.step}</span>
                {run.status === "accepted" ? <BadgeCheck size={18} /> : <CircleDashed size={18} />}
              </div>
              <h3>{run.title[locale]}</h3>
              <p>{run.model}</p>
              <div className="timeline-score">{run.score[locale]}</div>
              <ul>
                {run.notes[locale].map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function ParameterSlider({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="parameter-label">
        {label}
        <strong>{value}%</strong>
      </span>
      <input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function MousePointerIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3.6 18.4 13 12.7 14.1 10.1 20.1 5 3.6Z" />
    </svg>
  );
}

export default App;
