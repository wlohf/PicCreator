import { FileImage, ImagePlus, Layers3 } from "lucide-react";

import type { ApiConfig, ChatMessage, IterationRun, Locale, LocalizedText, RenderVersion, ToolKey } from "../types/domain";

export const copy = {
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

export const styleTokens: LocalizedText[] = [
  { zh: "现代新中式", en: "Modern Oriental" },
  { zh: "温暖画廊感", en: "Gallery Warmth" },
  { zh: "石材 + 胡桃木", en: "Stone + Oak" },
  { zh: "柔和日光", en: "Soft Daylight" }
];

export const referenceAssets = [
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

export const renderVersions: RenderVersion[] = [
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

export const iterationRuns: IterationRun[] = [
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

export const directionItems: LocalizedText[] = [
  { zh: "现代新中式高端住宅套间", en: "Modern oriental hospitality suite" },
  { zh: "低对比天然石材表面", en: "Low contrast natural stone surfaces" },
  { zh: "胡桃木定制柜体与亚麻墙面", en: "Walnut millwork with linen wall finish" },
  { zh: "柔和日光与真实全局照明", en: "Soft daylight, realistic global illumination" },
  { zh: "建筑摄影镜头，24mm，西南 45 度", en: "Architectural lens, 24mm, SW 45deg aerial" }
];

export const initialChatMessages: ChatMessage[] = [
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

export const tools: Array<{ key: ToolKey; label: LocalizedText; icon: "pointer" | "camera" | "ruler" | "sun" }> = [
  { key: "select", label: { zh: "选择", en: "Select" }, icon: "pointer" },
  { key: "assets", label: { zh: "视角", en: "Camera" }, icon: "camera" },
  { key: "material", label: { zh: "测量", en: "Measure" }, icon: "ruler" },
  { key: "lighting", label: { zh: "光照", en: "Lighting" }, icon: "sun" }
];

export const modelOptions = ["gpt-image-2", "dall-e-3", "imagen-preview"];
export const apiFormatOptions = [
  { value: "", label: "config.json" },
  { value: "openai", label: "OpenAI compatible" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "gemini", label: "Gemini compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "custom", label: "Custom" }
];
export const iterationOptions = [3, 4, 5];

export const defaultApiConfig: ApiConfig = {
  analysisProviderName: "",
  analysisApiFormat: "",
  analysisBaseUrl: "",
  analysisApiKey: "",
  analysisModel: "",
  imageProviderName: "",
  imageApiFormat: "",
  imageBaseUrl: "",
  imageApiKey: "",
  imageModel: "gpt-image-2",
  fallbackModels: "",
  modelSwitchAfterFailures: 2,
  stopAfterLastModelFailures: 2
};

