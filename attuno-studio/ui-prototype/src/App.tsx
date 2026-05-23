import { type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Clock3,
  Download,
  Edit3,
  Eye,
  FileText,
  Settings2,
  ImagePlus,
  KeyRound,
  LogOut,
  Maximize2,
  MessageCircle,
  MousePointer,
  PlugZap,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X
} from "lucide-react";

import { loadAuthMe, login, logout, register, type AuthUser } from "./api/auth";
import { loadConfig, saveConfig, verifyConfig } from "./api/config";
import { applyChatMemory, sendDesignChat } from "./api/chat";
import { requestGenerationStream } from "./api/generation";
import { requestAnnotatedImageEdit, requestImageEdit } from "./api/imageEdits";
import { deleteMemoryItem, loadMemoryView, loadShortcutPreferences, loadStyleProfile, recordPreferenceEvent, saveShortcutPreferences, updateMemoryItem, type MemoryItem, type MemorySection, type MemoryView, type StyleProfile } from "./api/preferences";
import { clearResults, deleteResult, listResults, normalizeApiResult, saveResultNotes } from "./api/results";
import { ConfigStatus, type ConfigStatusState } from "./components/ConfigStatus";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { ResultLibrary } from "./components/ResultLibrary";
import { StatusBadge } from "./components/StatusBadge";
import {
  apiFormatOptions,
  copy,
  defaultApiConfig,
  directionItems,
  modelOptions
} from "./data/studioData";
import type { ApiConfig, ChatMemoryCandidate, ChatMessage, ChatReasoningEffort, FilePreview, GenerationMode, GenerationProgress, Locale, RenderHistoryItem } from "./types/domain";
import { countGenerationRecords, hasConversationContent, hasDurableConversationContent, isCurrentConversationRun, upsertSessionSnapshot, type ConversationRunGuard } from "./utils/chatSessions";
import { apiConfigStorageKey, apiConfigStorageReadKeys } from "./utils/apiConfigStorage";
import { filesFromList, imageFilesFromFiles, mergeFloorPlanFiles } from "./utils/fileAttachments";
import { compactLines, localized } from "./utils/text";

const CHAT_HISTORY_STORAGE_KEY = "attuno-chat-history-v1";
const LEGACY_CHAT_HISTORY_STORAGE_KEY = "render-director-chat-history-v1";
const SHORTCUT_PHRASES_STORAGE_KEY = "attuno-shortcut-phrases-v1";
const LEGACY_SHORTCUT_PHRASES_STORAGE_KEY = "render-director-shortcut-phrases-v1";
const LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY = "attuno-sidebar-width-v1";
const LEGACY_LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY = "render-director-sidebar-width-v1";
const LAYOUT_DRAWER_WIDTH_STORAGE_KEY = "attuno-drawer-width-v1";
const LEGACY_LAYOUT_DRAWER_WIDTH_STORAGE_KEY = "render-director-drawer-width-v1";
const GENERATION_SLOW_NOTICE_MS = 5 * 60 * 1000;
const MAX_ITERATIONS_UPPER_BOUND = 50;
const COMPOSER_MAX_VISIBLE_HEIGHT = 232;
const SIDEBAR_WIDTH_MIN = 240;
const SIDEBAR_WIDTH_MAX = 420;
const DRAWER_WIDTH_MIN = 320;
const DRAWER_WIDTH_MAX = 560;
const DESKTOP_DRAWER_BREAKPOINT = 1100;


type ShortcutPhrase = {
  id: string;
  zh: string;
  en: string;
};

type PreviewImage = {
  url: string;
  label?: string;
  downloadUrl?: string;
  sourceResultId?: string;
};

type ComposerMode = "new-generation" | "edit-selected-result";
type WorkspaceMode = "chat" | "image";
type UtilityPanel = "results" | "analysis" | "shortcuts" | "preferences" | "generation" | "setup" | "prompts";
type ResizablePanel = "sidebar" | "drawer";

const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "chat";

type ChatSessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  chatInput: string;
  workspaceMode: WorkspaceMode;
  generationMode: GenerationMode;
  composerMode: ComposerMode;
  activeResultId: string | null;
};

function chatHistoryStorageKey(userId: string) {
  return `${CHAT_HISTORY_STORAGE_KEY}:${userId || "default"}`;
}

function legacyChatHistoryStorageKey(userId: string) {
  return `${LEGACY_CHAT_HISTORY_STORAGE_KEY}:${userId || "default"}`;
}

function shortcutPhrasesStorageKey(userId: string) {
  return `${SHORTCUT_PHRASES_STORAGE_KEY}:${userId || "default"}`;
}

function legacyShortcutPhrasesStorageKey(userId: string) {
  return `${LEGACY_SHORTCUT_PHRASES_STORAGE_KEY}:${userId || "default"}`;
}

function readLocalStorageWithMigration(storageKeys: string[]) {
  if (typeof window === "undefined") {
    return null;
  }
  const [primaryKey, ...legacyKeys] = storageKeys;
  try {
    const primaryRaw = window.localStorage.getItem(primaryKey);
    if (primaryRaw !== null) {
      return primaryRaw;
    }
    for (const legacyKey of legacyKeys) {
      const legacyRaw = window.localStorage.getItem(legacyKey);
      if (legacyRaw !== null) {
        window.localStorage.setItem(primaryKey, legacyRaw);
        return legacyRaw;
      }
    }
  } catch {
    return null;
  }
  return null;
}

type LiveGenerationState = {
  status?: string;
  stage?: string;
  floorDesc?: string;
  prompt?: string;
  evaluation?: string;
  logs?: string;
  hasImages?: boolean;
  iteration?: number | null;
  maxIterations?: number | null;
};

function buildFloorPlanAnalysisText(floorDesc?: string) {
  const text = String(floorDesc || "").trim();
  if (!text) return "";
  if (!text.includes("【结构化平面图分析】") && !text.includes("【提示词编译要求】")) {
    return text;
  }

  const normalized = text.replace(/^【图\d+】\s*/m, "").replace(/【提示词编译要求】[\s\S]*$/m, "").trim();
  const headerBlock = normalized.split(/【逐空间约束】/)[0]?.replace("【结构化平面图分析】", "【平面图分析】").trim() || "";
  const spaces: string[] = [];
  const spacePattern = /(?:^|\n)\d+\.\s*空间名称：([^\n]+)([\s\S]*?)(?=\n\d+\.\s*空间名称：|\n【|$)/g;
  let match: RegExpExecArray | null;
  while ((match = spacePattern.exec(normalized)) && spaces.length < 14) {
    const block = match[2] || "";
    const name = match[1].trim();
    const functionText = block.match(/-\s*功能：(.+)/)?.[1]?.trim();
    const positionText = block.match(/-\s*位置：(.+)/)?.[1]?.trim();
    spaces.push(`- ${name}${functionText || positionText ? `：${[functionText, positionText].filter(Boolean).join("；")}` : ""}`);
  }

  const constraints: string[] = [];
  for (const section of ["全局墙体约束", "全局窗户约束", "全局门洞约束", "全局硬约束"]) {
    const sectionMatch = normalized.match(new RegExp(`【${section}】([\\s\\S]*?)(?=\\n【|$)`));
    if (!sectionMatch) continue;
    for (const line of sectionMatch[1].split("\n")) {
      const cleaned = line.replace(/^-\s*/, "").trim();
      if (cleaned) constraints.push(`- ${cleaned}`);
      if (constraints.length >= 8) break;
    }
    if (constraints.length >= 8) break;
  }

  return [
    headerBlock,
    spaces.length ? `【识别到的空间】\n${spaces.join("\n")}` : "",
    constraints.length ? `【关键约束】\n${constraints.join("\n")}` : ""
  ].filter(Boolean).join("\n\n");
}


type ComparisonImage =
  | {
      mode: "floor-vs-render";
      floorPlanUrl: string;
      floorPlanName?: string;
      renderUrl: string;
      renderLabel?: string;
    }
  | {
      mode: "history-vs-history";
      leftResultId: string;
      rightResultId: string;
    };

const generationModeLabels: Record<GenerationMode, { zh: string; en: string }> = {
  standard: { zh: "默认模式", en: "Default" },
  render3d: { zh: "3D 效果图", en: "3D render" },
  colored_floor_plan: { zh: "彩色平面图", en: "Colored plan" }
};

const generationModeOptions: { value: "standard" | "render3d"; zh: string; en: string }[] = [
  { value: "standard", zh: "默认模式", en: "Default" },
  { value: "render3d", zh: "3D 效果图", en: "3D render" },
];

const defaultChatModelOptions = ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "gemini-pro"];
const chatReasoningEffortOptions: Array<{ value: ChatReasoningEffort; zh: string; en: string }> = [
  { value: "low", zh: "低", en: "Low" },
  { value: "medium", zh: "中", en: "Medium" },
  { value: "high", zh: "高", en: "High" },
];

function modelSelectOptions(primaryModel: string, fallbackModels: string[]) {
  const options = [primaryModel, ...fallbackModels]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(options));
}

function apiFormatDisplayName(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return apiFormatOptions.find((option) => option.value === normalized)?.label || normalized;
}

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
    floorAnalysisSystemPrompt: String(saved.floorAnalysisSystemPrompt ?? defaultApiConfig.floorAnalysisSystemPrompt),
    promptGenSystem3dCn: String(saved.promptGenSystem3dCn ?? defaultApiConfig.promptGenSystem3dCn),
    fallbackModels: String(saved.fallbackModels ?? defaultApiConfig.fallbackModels),
    modelSwitchAfterFailures: Number(saved.modelSwitchAfterFailures ?? defaultApiConfig.modelSwitchAfterFailures) || defaultApiConfig.modelSwitchAfterFailures,
    stopAfterLastModelFailures: Number(saved.stopAfterLastModelFailures ?? defaultApiConfig.stopAfterLastModelFailures) || defaultApiConfig.stopAfterLastModelFailures
  };
}

function slugifyFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "render-result";
}

function normalizeMaxIterations(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_ITERATIONS_UPPER_BOUND, Math.max(1, Math.trunc(value)));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withStartupRetry<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await wait(250 * (index + 1));
      }
    }
  }
  throw lastError;
}

function loadSavedApiConfig(userId = ""): ApiConfig {
  if (typeof window === "undefined") {
    return defaultApiConfig;
  }

  try {
    const raw = readLocalStorageWithMigration(apiConfigStorageReadKeys(userId));
    return raw ? normalizeApiConfig(JSON.parse(raw)) : defaultApiConfig;
  } catch {
    return defaultApiConfig;
  }
}

function extractContentText(content: ChatMessage["content"]) {
  if (typeof content === "string") {
    return content.trim();
  }
  return String(content.zh || content.en || "").trim();
}

function buildSessionTitle(messages: ChatMessage[], chatInput: string, generationMode: GenerationMode, workspaceMode: WorkspaceMode) {
  const firstUserText = messages.find((message) => message.role === "user" && message.kind === "text");
  const raw = extractContentText(firstUserText?.content ?? chatInput);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized) {
    return normalized.length > 22 ? `${normalized.slice(0, 22)}...` : normalized;
  }
  if (workspaceMode === "chat") return "日常对话";
  if (generationMode === "render3d") return "3D 效果图";
  if (generationMode === "colored_floor_plan") return "彩色平面图";
  return "新对话";
}

function createEmptySession(): ChatSessionRecord {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).slice(2, 8);
  return {
    id: `session-${Date.now()}-${random}`,
    title: "新对话",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    chatInput: "",
    workspaceMode: DEFAULT_WORKSPACE_MODE,
    generationMode: "standard",
    composerMode: "new-generation",
    activeResultId: null,
  };
}

function normalizeStoredSession(value: unknown): ChatSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<ChatSessionRecord>;
  const id = String(session.id || "").trim();
  if (!id) return null;
  const messages = Array.isArray(session.messages) ? session.messages as ChatMessage[] : [];
  const generationMode = session.generationMode === "render3d" || session.generationMode === "standard"
    ? session.generationMode
    : "standard";
  const workspaceMode = session.workspaceMode === "chat" || session.workspaceMode === "image"
    ? session.workspaceMode
    : "image";
  const composerMode = session.composerMode === "edit-selected-result" ? "edit-selected-result" : "new-generation";
  return {
    id,
    title: String(session.title || buildSessionTitle(messages, String(session.chatInput || ""), generationMode, workspaceMode)),
    createdAt: String(session.createdAt || new Date().toISOString()),
    updatedAt: String(session.updatedAt || session.createdAt || new Date().toISOString()),
    messages,
    chatInput: String(session.chatInput || ""),
    workspaceMode,
    generationMode,
    composerMode,
    activeResultId: session.activeResultId ? String(session.activeResultId) : null,
  };
}

function loadStoredSessions(userId: string) {
  if (typeof window === "undefined") {
    return { currentSessionId: "", sessions: [] as ChatSessionRecord[] };
  }
  try {
    const raw = readLocalStorageWithMigration([
      chatHistoryStorageKey(userId),
      legacyChatHistoryStorageKey(userId),
    ]);
    if (!raw) {
      return { currentSessionId: "", sessions: [] as ChatSessionRecord[] };
    }
    const parsed = JSON.parse(raw) as { currentSessionId?: string; sessions?: unknown[] };
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeStoredSession).filter((item): item is ChatSessionRecord => Boolean(item))
      : [];
    return {
      currentSessionId: String(parsed.currentSessionId || ""),
      sessions,
    };
  } catch {
    return { currentSessionId: "", sessions: [] as ChatSessionRecord[] };
  }
}

function clampPanelWidth(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function loadStoredPanelWidth(storageKeys: string[], fallback: number, min: number, max: number) {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = Number(readLocalStorageWithMigration(storageKeys));
    return Number.isFinite(raw) ? clampPanelWidth(raw, min, max) : fallback;
  } catch {
    return fallback;
  }
}

const render3DShortcutPhrases: ShortcutPhrase[] = directionItems.map((item, index) => ({
  id: `default-${index}`,
  zh: item.zh,
  en: item.en
}));

function cloneDefaultShortcutPhrases() {
  return render3DShortcutPhrases.map((item) => ({ ...item }));
}

function normalizeShortcutPhrase(value: unknown): ShortcutPhrase | null {
  if (!value || typeof value !== "object") return null;
  const phrase = value as Partial<ShortcutPhrase>;
  const id = String(phrase.id || "").trim();
  const zh = String(phrase.zh || "").trim();
  const en = String(phrase.en || "").trim();
  if (!id || (!zh && !en)) return null;
  return {
    id,
    zh: zh || en,
    en: en || zh,
  };
}

function loadStoredShortcutPhrases(userId: string): ShortcutPhrase[] {
  if (typeof window === "undefined") {
    return cloneDefaultShortcutPhrases();
  }
  try {
    const raw = readLocalStorageWithMigration([
      shortcutPhrasesStorageKey(userId),
      legacyShortcutPhrasesStorageKey(userId),
    ]);
    if (!raw) {
      return cloneDefaultShortcutPhrases();
    }
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return cloneDefaultShortcutPhrases();
    }
    const phrases = parsed.map(normalizeShortcutPhrase).filter((item): item is ShortcutPhrase => Boolean(item));
    return parsed.length === 0 || phrases.length > 0 ? phrases : cloneDefaultShortcutPhrases();
  } catch {
    return cloneDefaultShortcutPhrases();
  }
}

const DEFAULT_PROJECT_ID = "default";
const initialApiConfig = loadSavedApiConfig("");
function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [isRendering, setIsRendering] = useState(false);
  const [activeStep, setActiveStep] = useState("idle");
  const [selectedModel, setSelectedModel] = useState(initialApiConfig.imageModel || modelOptions[0]);
  const [maxIterationsInput, setMaxIterationsInput] = useState("5");
  const [enableQualityEvaluation, setEnableQualityEvaluation] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(DEFAULT_WORKSPACE_MODE);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("standard");
  const [chatInput, setChatInput] = useState("");
  const [chatReasoningEffort, setChatReasoningEffort] = useState<ChatReasoningEffort>("medium");
  const [composerMode, setComposerMode] = useState<ComposerMode>("new-generation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floorPlanFiles, setFloorPlanFiles] = useState<File[]>([]);
  const [liveGeneration, setLiveGeneration] = useState<LiveGenerationState | null>(null);

  const [showApiConfig, setShowApiConfig] = useState(true);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [comparisonImage, setComparisonImage] = useState<ComparisonImage | null>(null);
  const [annotationTarget, setAnnotationTarget] = useState<RenderHistoryItem | null>(null);

  const [apiConfig, setApiConfig] = useState<ApiConfig>(initialApiConfig);
  const [configStatus, setConfigStatus] = useState<ConfigStatusState | null>(null);
  const [configAction, setConfigAction] = useState<"save" | "analysis" | "image" | null>(null);
  const [learnedProfile, setLearnedProfile] = useState<StyleProfile | null>(null);
  const [memoryView, setMemoryView] = useState<MemoryView | null>(null);
  const [editingMemoryItemId, setEditingMemoryItemId] = useState<string | null>(null);
  const [memoryDraftText, setMemoryDraftText] = useState("");
  const [memoryActionId, setMemoryActionId] = useState<string | null>(null);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authDraft, setAuthDraft] = useState({ username: "", password: "" });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showUserDialog, setShowUserDialog] = useState(true);
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [activeUtilityPanel, setActiveUtilityPanel] = useState<UtilityPanel | null>(null);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [shortcutPhrases, setShortcutPhrases] = useState<ShortcutPhrase[]>(() => cloneDefaultShortcutPhrases());
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState({ zh: "", en: "" });
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(true);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [floorPlanPreviews, setFloorPlanPreviews] = useState<FilePreview[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [isChatResponding, setIsChatResponding] = useState(false);
  const [rememberingMessageId, setRememberingMessageId] = useState<string | null>(null);
  const [isSubmittingAnnotation, setIsSubmittingAnnotation] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadStoredPanelWidth([LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY, LEGACY_LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY], 280, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX));
  const [drawerWidth, setDrawerWidth] = useState(() => loadStoredPanelWidth([LAYOUT_DRAWER_WIDTH_STORAGE_KEY, LEGACY_LAYOUT_DRAWER_WIDTH_STORAGE_KEY], 380, DRAWER_WIDTH_MIN, DRAWER_WIDTH_MAX));
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const activeResizeRef = useRef<{ panel: ResizablePanel; startX: number; startWidth: number } | null>(null);
  const previousGenerationModeRef = useRef<GenerationMode>("standard");
  const currentUserIdRef = useRef(currentUserId);
  const conversationEpochRef = useRef(0);
  const isBootstrappingSessionRef = useRef(false);

  const t = copy[locale];
  const isImageWorkspace = workspaceMode === "image";
  const isChatWorkspace = workspaceMode === "chat";
  const currentGenerationModeOption = generationModeLabels[generationMode] ?? generationModeLabels.standard;
  const currentGenerationModeLabel = locale === "zh" ? currentGenerationModeOption.zh : currentGenerationModeOption.en;
  const currentWorkspaceLabel = isChatWorkspace
    ? locale === "zh" ? "日常对话" : "Daily chat"
    : currentGenerationModeLabel;
  const sidebarHistoryItems = currentUserId
    ? chatSessions
      .filter((session) => hasDurableConversationContent(session.messages))
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 12)
    : [];
  const activeResult = useMemo(
    () => renderHistory.find((item) => item.id === activeResultId) ?? renderHistory[0] ?? null,
    [activeResultId, renderHistory]
  );
  const maxIterations = normalizeMaxIterations(Number(maxIterationsInput));
  const activePrompt = activeResult?.prompt || (chatInput.trim() ? buildGenerationPrompt() : "");
  const hasPromptText = Boolean(chatInput.trim());
  const isStructuredGenerationMode = generationMode !== "standard";
  const comparisonCandidates = renderHistory.filter((item) => Boolean(item.imageUrl));
  const activeResultMode = activeResult?.generationMode || generationMode;
  const canCompareActiveResult = Boolean(activeResult?.imageUrl) && (
    activeResultMode === "standard"
      ? comparisonCandidates.length >= 2
      : Boolean(activeResult?.floorPlanUrl || floorPlanPreviews[0]?.url)
  );
  const conversationGenerationRecordCount = countGenerationRecords(messages);
  const hasWorkspaceContent = hasPromptText || floorPlanFiles.length > 0 || messages.length > 0 || workspaceMode !== "image";
  const canStartNewConversation = currentConversationHasContent();
  const onboardingSteps = [
    {
      done: floorPlanFiles.length > 0,
      label: locale === "zh" ? "添加平面图" : "Add floor plan",
      detail: locale === "zh" ? (floorPlanFiles.length ? `已选择 ${floorPlanFiles.length} 张` : "可粘贴或拖拽图片到工作台") : (floorPlanFiles.length ? `${floorPlanFiles.length} selected` : "Paste or drag images into the workspace")
    },
    {
      done: Boolean(chatInput.trim()),
      label: locale === "zh" ? "补充设计需求" : "Add design brief",
      detail: locale === "zh" ? "描述风格、镜头、材质和空间目标" : "Describe style, camera, materials, and goals"
    },
    {
      done: Boolean(apiConfig.imageModel || selectedModel),
      label: locale === "zh" ? "确认模型" : "Confirm model",
      detail: selectedModel
    }
  ];
  const progressPromptText = liveGeneration?.prompt || "";
  const utilityPanelTitles: Record<UtilityPanel, string> = {
    results: locale === "zh" ? "结果库" : "Result library",
    analysis: locale === "zh" ? "运行状态" : "Run status",
    shortcuts: locale === "zh" ? "管理快捷短语" : "Manage quick phrases",
    preferences: locale === "zh" ? "记忆与偏好" : "Memory & preferences",
    generation: locale === "zh" ? "生成控制" : "Generation controls",
    setup: locale === "zh" ? "模型与 API 设置" : "Model & API setup",
    prompts: locale === "zh" ? "提示词设置" : "Prompt settings"
  };
  const sidebarSettingPanels = [
    {
      panel: "preferences" as const,
      icon: CheckCircle2,
      title: locale === "zh" ? "记忆与偏好" : "Memory",
      description: locale === "zh" ? "查看、编辑或删除聊天记忆和生图偏好" : "Review, edit, or delete chat memory and image preferences"
    },
    {
      panel: "generation" as const,
      icon: Box,
      title: locale === "zh" ? "生成控制" : "Generation",
      description: locale === "zh" ? "切换模型、轮数与可选严格复核" : "Switch model, pass count, and optional strict review"
    },
    {
      panel: "setup" as const,
      icon: PlugZap,
      title: locale === "zh" ? "模型与 API" : "Model & API",
      description: locale === "zh" ? "供应商、地址、密钥与默认模型" : "Providers, endpoints, keys, and default models"
    },
    {
      panel: "prompts" as const,
      icon: FileText,
      title: locale === "zh" ? "提示词设置" : "Prompt settings",
      description: locale === "zh" ? "分析提示词与 3D 提示词覆盖" : "Analysis and 3D prompt overrides"
    }
  ];

  function openSettingsPanel(panel: Extract<UtilityPanel, "preferences" | "generation" | "setup" | "prompts">) {
    if (panel === "setup") {
      setShowApiConfig(true);
    }
    if (panel === "prompts") {
      setShowPromptConfig(true);
    }
    setActiveUtilityPanel(panel);
    setIsSettingsMenuOpen(false);
  }

  function syncComposerHeight(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return;
    if (!textarea.value) {
      textarea.style.height = "";
      textarea.style.overflowY = "hidden";
      return;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_MAX_VISIBLE_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_VISIBLE_HEIGHT ? "auto" : "hidden";
  }

  function applySession(session: ChatSessionRecord) {
    setMessages(session.messages);
    setChatInput(session.chatInput);
    setWorkspaceMode(session.workspaceMode);
    setGenerationMode(session.generationMode);
    setComposerMode(session.composerMode);
    setActiveResultId(session.activeResultId);
    setFloorPlanFiles([]);
    setLiveGeneration(null);
    setPreviewImage(null);
    setComparisonImage(null);
    setIsComparisonOpen(false);
    setAnnotationTarget(null);
    setActiveUtilityPanel(null);
    setIsSettingsMenuOpen(false);
    setActiveStep(session.messages.length > 0 ? "completed" : "idle");
    setGenerationStartedAt(null);
    setGenerationElapsedMs(0);
    setIsRendering(false);
  }

  function resetVisibleConversationState() {
    setMessages([]);
    setChatInput("");
    setWorkspaceMode(DEFAULT_WORKSPACE_MODE);
    setGenerationMode("standard");
    setComposerMode("new-generation");
    setFloorPlanFiles([]);
    setLiveGeneration(null);
    setPreviewImage(null);
    setComparisonImage(null);
    setIsComparisonOpen(false);
    setAnnotationTarget(null);
    setActiveUtilityPanel(null);
    setActiveStep("idle");
    setGenerationStartedAt(null);
    setGenerationElapsedMs(0);
    setIsRendering(false);
    setIsChatResponding(false);
    setRememberingMessageId(null);
    setIsSubmittingAnnotation(false);
  }

  function beginNamespaceSwitch(nextUserId: string) {
    conversationEpochRef.current += 1;
    currentUserIdRef.current = nextUserId;
    setCurrentSessionId("");
    setChatSessions([]);
    setRenderHistory([]);
    setLearnedProfile(null);
    setMemoryView(null);
    setEditingMemoryItemId(null);
    setMemoryDraftText("");
    setMemoryActionId(null);
    setActiveResultId(null);
    resetVisibleConversationState();
  }

  function applyAuthenticatedUser(user: AuthUser) {
    beginNamespaceSwitch(user.user_id);
    setAuthUser(user);
    setCurrentUserId(user.user_id);
    setAuthDraft({ username: user.username || user.user_id, password: "" });
    setAuthError("");
    setShowUserDialog(false);
  }

  function clearAuthenticatedUserState(showDialog = true) {
    beginNamespaceSwitch("");
    setAuthUser(null);
    setCurrentUserId("");
    setAuthDraft({ username: "", password: "" });
    setAuthError("");
    setApiConfig(defaultApiConfig);
    setSelectedModel(defaultApiConfig.imageModel || modelOptions[0]);
    setConfigStatus(null);
    setConfigAction(null);
    setShortcutPhrases(cloneDefaultShortcutPhrases());
    setEditingShortcutId(null);
    setShortcutDraft({ zh: "", en: "" });
    setShowUserDialog(showDialog);
  }

  function createConversationRunGuard(): ConversationRunGuard {
    return {
      userId: currentUserIdRef.current,
      epoch: conversationEpochRef.current,
    };
  }

  function isActiveConversationRun(guard: ConversationRunGuard) {
    return isCurrentConversationRun(guard, currentUserIdRef.current, conversationEpochRef.current);
  }

  function snapshotCurrentSession(sessionId = currentSessionId): ChatSessionRecord | null {
    const id = String(sessionId || "").trim();
    if (!id) return null;
    const existing = chatSessions.find((session) => session.id === id);
    return {
      id,
      title: buildSessionTitle(messages, chatInput, generationMode, workspaceMode),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages,
      chatInput,
      workspaceMode,
      generationMode,
      composerMode,
      activeResultId,
    };
  }

  function upsertSession(list: ChatSessionRecord[], nextSession: ChatSessionRecord) {
    return upsertSessionSnapshot(list, nextSession);
  }

  async function refreshLearnedProfile(projectId = DEFAULT_PROJECT_ID, userId = currentUserId || DEFAULT_PROJECT_ID) {
    if (!userId) {
      setLearnedProfile(null);
      setMemoryView(null);
      return;
    }
    try {
      const [profile, memory] = await Promise.all([
        loadStyleProfile(projectId, userId),
        loadMemoryView(projectId, userId),
      ]);
      setLearnedProfile(profile);
      setMemoryView(memory);
    } catch {
      setLearnedProfile(null);
      setMemoryView(null);
    }
  }

  function firePreferenceEvent(eventType: string, payload: Record<string, unknown> = {}, resultId = "", projectId = DEFAULT_PROJECT_ID, userId = currentUserId || DEFAULT_PROJECT_ID) {
    if (!userId) return;
    void recordPreferenceEvent({
      eventType,
      userId,
      projectId,
      resultId,
      payload,
    }).catch(() => undefined);
  }

  const hasAuthenticatedUser = Boolean(currentUserId);
  function getGenerationBlocker(mode: GenerationMode) {
    if (!hasAuthenticatedUser) {
      return locale === "zh" ? "请先登录或注册账号" : "Sign in or create an account first";
    }
    if (mode === "standard") {
      return hasPromptText
        ? ""
        : locale === "zh"
          ? "请输入要直接发送给画图模型的提示词"
          : "Enter the prompt to send directly to the image model";
    }
    if (floorPlanFiles.length === 0) {
      return locale === "zh" ? "请先粘贴或拖入至少一张平面图" : "Paste or drop at least one floor plan first";
    }
    if (mode === "render3d" && !hasPromptText) {
      return locale === "zh"
        ? "请填写 3D 效果图需求，或使用快捷短语补充需求"
        : "Add a 3D render brief or insert shortcut phrases before generating";
    }
    return "";
  }
  const canEditSelectedResult = hasAuthenticatedUser && isImageWorkspace && composerMode === "edit-selected-result" && Boolean(activeResult?.imageUrl) && hasPromptText;
  const canGenerateNew = !isImageWorkspace || !hasAuthenticatedUser
    ? false
    : generationMode === "standard"
    ? hasPromptText
    : generationMode === "colored_floor_plan"
      ? floorPlanFiles.length > 0
      : floorPlanFiles.length > 0 && hasPromptText;
  const canGenerate = composerMode === "edit-selected-result" ? canEditSelectedResult : canGenerateNew;
  const canSubmitChat = hasAuthenticatedUser && isChatWorkspace && hasPromptText && !isChatResponding && !isRendering;
  const canSubmitComposer = isChatWorkspace ? canSubmitChat : canGenerate;
  const chatProviderLabel = apiConfig.analysisProviderName || apiFormatDisplayName(apiConfig.analysisApiFormat) || (locale === "zh" ? "聊天供应商" : "Chat provider");
  const imageProviderLabel = apiConfig.imageProviderName || apiFormatDisplayName(apiConfig.imageApiFormat) || (locale === "zh" ? "图像供应商" : "Image provider");
  const chatModelValue = apiConfig.analysisModel || "";
  const composerProviderLabel = isChatWorkspace ? chatProviderLabel : imageProviderLabel;
  const composerModelValue = isChatWorkspace ? chatModelValue : selectedModel;
  const composerModelOptions = isChatWorkspace
    ? modelSelectOptions(chatModelValue, defaultChatModelOptions)
    : modelSelectOptions(selectedModel, modelOptions);
  const chatBlocker = isChatWorkspace && !hasAuthenticatedUser
    ? locale === "zh"
      ? "请先登录或注册账号"
      : "Sign in or create an account first"
    : isChatWorkspace && !hasPromptText
    ? locale === "zh"
        ? "输入日常问题，或描述想法后再发送"
        : "Type a chat message before sending"
    : "";
  const generationBlocker = composerMode === "edit-selected-result"
    ? !hasAuthenticatedUser
      ? locale === "zh"
        ? "请先登录或注册账号"
        : "Sign in or create an account first"
      : !activeResult?.imageUrl
      ? locale === "zh"
        ? "请先选择一张已有结果"
        : "Select an existing result first"
      : !hasPromptText
        ? locale === "zh"
          ? "请输入要修改的内容"
          : "Describe what to edit"
        : ""
    : getGenerationBlocker(generationMode);
  const coloredFloorPlanActionBlocker = composerMode === "edit-selected-result"
    ? locale === "zh"
      ? "彩色平面图工具只在新生成模式下可用"
      : "Colored plan is only available for new generation"
    : getGenerationBlocker("colored_floor_plan");
  const selectedEditSourceLabel = isImageWorkspace && composerMode === "edit-selected-result" && activeResult
    ? locale === "zh"
      ? `源图：${activeResult.title} · v${activeResult.versionIndex || 1}`
      : `Source: ${activeResult.title} · v${activeResult.versionIndex || 1}`
    : "";
  const composerTitle = isChatWorkspace
    ? locale === "zh" ? "日常对话" : "Daily chat"
    : composerMode === "edit-selected-result" ? (locale === "zh" ? "继续修改当前图" : "Continue Editing") : t.quickBrief;
  const composerPlaceholder = isChatWorkspace
    ? locale === "zh"
      ? "可以日常聊天；如果聊到想画的内容，我会给你一条可套用的生成草稿..."
      : "Chat normally here. If the conversation turns into an image idea, I can offer a draft for image mode..."
    : composerMode === "edit-selected-result"
    ? locale === "zh"
      ? "描述要修改的局部或画面细节，例如：把灯光改暖，其他保持不变..."
      : "Describe the edits to make, e.g. make the lighting warmer and keep everything else unchanged..."
    : t.composerPlaceholder;
  const composerSubmitLabel = isChatWorkspace
    ? locale === "zh" ? "发送聊天" : "Send chat"
    : composerMode === "edit-selected-result" ? (locale === "zh" ? "提交改图" : "Edit image") : t.sendPrompt;
  const composerHint = isChatWorkspace
    ? chatBlocker || (locale === "zh" ? "日常对话不会触发画图；需要出图时切换到图像模式。" : "Daily chat does not generate images; switch to image mode when ready to draw.")
    : generationBlocker || (composerMode === "edit-selected-result"
    ? locale === "zh"
      ? "会以当前选中的结果图为源图，只修改你描述的内容。"
      : "The selected result is used as the source image; only the described changes are requested."
    : generationMode === "standard"
      ? locale === "zh"
        ? "默认模式不会解析需求或生成内置提示词，只把输入框文本直接交给画图模型。"
        : "Default mode skips parsing and built-in prompts; the composer text is sent directly to the image model."
      : generationMode === "colored_floor_plan"
        ? locale === "zh"
        ? "添加平面图后可生成彩色平面图，输入框文字只作为补充偏好。"
        : "Add a floor plan to generate a colored plan; composer text is used only as optional preference."
        : locale === "zh"
          ? "至少添加一张平面图，并填写设计需求，才能开始生成。"
          : "Add at least one floor plan and fill the brief before generating.");
  const composerSubmitShortcutHint = locale === "zh"
    ? `${composerSubmitLabel}（Enter 发送，Shift+Enter 换行）`
    : `${composerSubmitLabel} (Enter to send, Shift+Enter for a new line)`;
  const latestResult = activeResult;
  const progressAnalysisText = buildFloorPlanAnalysisText(liveGeneration?.floorDesc);
  const latestAnalysisText = buildFloorPlanAnalysisText(latestResult?.floorDesc);
  const hasCurrentAnalysisResult = Boolean(progressAnalysisText);
  const sidebarAnalysisText = isRendering ? progressAnalysisText : progressAnalysisText || latestAnalysisText;
  const hasRunFailure = activeStep === "failed";
  const hasRun = messages.length > 0 || isRendering || renderHistory.length > 0;
  const workflowActiveStep = activeStep === "idle" && latestResult ? "completed" : activeStep;
  const workflowSteps = [
    {
      step: "submitted",
      title: locale === "zh" ? "提交" : "Submit",
      detail: locale === "zh" ? "请求进入后端" : "Request accepted"
    },
    {
      step: "analysis",
      title: locale === "zh" ? "分析" : "Analyze",
      detail: hasCurrentAnalysisResult
        ? locale === "zh" ? "结果已返回" : "Result returned"
        : generationMode === "standard"
          ? locale === "zh" ? "直通提示词" : "Direct prompt"
          : locale === "zh" ? "正在解析平面图" : "Parsing floor plan"
    },
    {
      step: "rendering",
      title: locale === "zh" ? "出图" : "Render",
      detail: locale === "zh" ? "等待图片返回" : "Wait for image"
    },
    {
      step: "evaluating",
      title: locale === "zh" ? "严格复核" : "Strict review",
      detail: enableQualityEvaluation
        ? locale === "zh" ? "严格复核开启" : "Strict review on"
        : locale === "zh" ? "默认关闭" : "Off by default"
    },
    {
      step: "completed",
      title: locale === "zh" ? "入库" : "Save",
      detail: locale === "zh" ? "结果写入图库" : "Save result"
    }
  ];
  const workflowStepOrder = workflowSteps.map((step) => step.step);
  const workflowActiveIndex = workflowStepOrder.indexOf(workflowActiveStep);
  const projectState = isRendering
    ? t.rendering
    : isChatResponding
      ? locale === "zh"
        ? "回复中"
        : "Replying"
    : isChatWorkspace
      ? locale === "zh"
        ? "可聊天"
        : "Ready to chat"
    : latestResult
      ? latestResult.status || (locale === "zh" ? "已生成" : "Generated")
      : hasRunFailure
        ? locale === "zh"
          ? "生成失败"
          : "Failed"
        : generationMode === "standard" && !hasPromptText
        ? locale === "zh"
          ? "待输入提示词"
          : "Need prompt"
        : generationMode !== "standard" && floorPlanFiles.length === 0
        ? locale === "zh"
          ? "待添加平面图"
          : "Need floor plan"
        : !hasPromptText && generationMode !== "colored_floor_plan"
          ? locale === "zh"
            ? "待输入需求"
            : "Need brief"
          : locale === "zh"
            ? "可生成"
            : "Ready";
  const generationElapsedSeconds = Math.floor(generationElapsedMs / 1000);
  const generationElapsedLabel = `${String(Math.floor(generationElapsedSeconds / 60)).padStart(2, "0")}:${String(generationElapsedSeconds % 60).padStart(2, "0")}`;
  const currentIteration = liveGeneration?.iteration ?? null;
  const effectiveMaxIterations = enableQualityEvaluation ? maxIterations : 1;
  const currentMaxIterations = liveGeneration?.maxIterations ?? effectiveMaxIterations;
  const displayIteration = isRendering ? currentIteration ?? 0 : latestResult ? latestResult.versionIndex || 1 : 0;
  const generationStageLabel = activeStep === "submitted"
    ? liveGeneration?.status || (generationMode === "standard" ? (locale === "zh" ? "已提交，正在直通生成" : "Submitted, direct generation") : (locale === "zh" ? "已提交，正在分析" : "Submitted, analyzing"))
    : activeStep === "analysis"
      ? progressPromptText
        ? locale === "zh" ? "提示词已生成，准备进入图片生成" : "Prompt ready, preparing image generation"
        : liveGeneration?.status || (isStructuredGenerationMode ? (locale === "zh" ? "正在分析平面图与需求" : "Analyzing floor plan and brief") : (locale === "zh" ? "正在准备直通提示词" : "Preparing direct prompt"))
      : activeStep === "rendering"
        ? liveGeneration?.hasImages
          ? locale === "zh" ? "图片已返回，正在整理结果" : "Images returned, packaging results"
          : liveGeneration?.status || (locale === "zh" ? "正在等待图片结果" : "Waiting for image result")
        : activeStep === "evaluating"
          ? enableQualityEvaluation
            ? liveGeneration?.status || (locale === "zh" ? "图片已返回，正在进行严格复核" : "Image returned, running the strict review")
            : liveGeneration?.status || (locale === "zh" ? "图片已返回，正在整理结果" : "Image returned, packaging result")
        : activeStep === "completed"
          ? locale === "zh" ? "生成完成" : "Completed"
          : activeStep === "failed"
            ? locale === "zh" ? "生成失败" : "Failed"
            : locale === "zh" ? "等待后端响应" : "Waiting for backend";
  const progressAnalysisStepLabel = hasCurrentAnalysisResult
    ? locale === "zh" ? "分析已出" : "Analysis ready"
    : generationMode === "standard"
      ? locale === "zh" ? "直通" : "Direct"
    : activeStep === "analysis"
      ? locale === "zh" ? "分析中" : "Analyzing"
      : locale === "zh" ? "等待分析" : "Waiting for analysis";
  const isGenerationSlow = isRendering && generationElapsedMs >= GENERATION_SLOW_NOTICE_MS;

  useEffect(() => {
    let isMounted = true;
    loadAuthMe()
      .then((response) => {
        if (!isMounted) return;
        if (response.authenticated && response.user) {
          applyAuthenticatedUser(response.user);
          return;
        }
        clearAuthenticatedUserState(true);
      })
      .catch((error) => {
        if (!isMounted) return;
        clearAuthenticatedUserState(true);
        setAuthError(`${locale === "zh" ? "无法读取登录状态" : "Could not load sign-in status"}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (isMounted) {
          setIsAuthLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    const localConfig = loadSavedApiConfig(currentUserId);
    setApiConfig(localConfig);
    setSelectedModel(localConfig.imageModel || modelOptions[0]);
    let isMounted = true;
    withStartupRetry(loadConfig)
      .then((savedConfig) => {
        if (!isMounted) return;
        const normalized = normalizeApiConfig(savedConfig);
        setApiConfig(normalized);
        setSelectedModel(normalized.imageModel || modelOptions[0]);
        window.localStorage.setItem(apiConfigStorageKey(currentUserId), JSON.stringify(normalized));
      })
      .catch(() => {
        // Keep browser-local config when the backend is not available.
      });
    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setRenderHistory([]);
      setActiveResultId(null);
      return;
    }
    setRenderHistory([]);
    setActiveResultId(null);
    let isMounted = true;
    withStartupRetry(() => listResults(currentUserId))
      .then((items) => {
        if (!isMounted) return;
        setRenderHistory(items);
      })
      .catch(() => {
        if (isMounted) {
          setRenderHistory([]);
          setActiveResultId(null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    let bootstrapTimer: number | null = null;
    const finishBootstrapping = () => {
      if (typeof window === "undefined") {
        isBootstrappingSessionRef.current = false;
        return;
      }
      bootstrapTimer = window.setTimeout(() => {
        isBootstrappingSessionRef.current = false;
      }, 0);
    };

    isBootstrappingSessionRef.current = true;
    if (!currentUserId) {
      setChatSessions([]);
      setCurrentSessionId("");
      setMessages([]);
      setChatInput("");
      setWorkspaceMode(DEFAULT_WORKSPACE_MODE);
      setGenerationMode("standard");
      setComposerMode("new-generation");
      finishBootstrapping();
      return () => {
        if (bootstrapTimer !== null) {
          window.clearTimeout(bootstrapTimer);
        }
        isBootstrappingSessionRef.current = false;
      };
    }
    const stored = loadStoredSessions(currentUserId);
    if (stored.sessions.length > 0) {
      const target = stored.sessions.find((session) => session.id === stored.currentSessionId) ?? stored.sessions[0];
      setChatSessions(upsertSession(stored.sessions, target));
      setCurrentSessionId(target.id);
      applySession(target);
      finishBootstrapping();
      return () => {
        if (bootstrapTimer !== null) {
          window.clearTimeout(bootstrapTimer);
        }
        isBootstrappingSessionRef.current = false;
      };
    }
    const nextSession = createEmptySession();
    setChatSessions([nextSession]);
    setCurrentSessionId(nextSession.id);
    applySession(nextSession);
    finishBootstrapping();
    return () => {
      if (bootstrapTimer !== null) {
        window.clearTimeout(bootstrapTimer);
      }
      isBootstrappingSessionRef.current = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (isBootstrappingSessionRef.current) return;
    const nextSession = snapshotCurrentSession();
    if (!nextSession) return;
    setChatSessions((current) => upsertSession(current, nextSession));
  }, [currentSessionId, messages, chatInput, workspaceMode, generationMode, composerMode, activeResultId]);

  useEffect(() => {
    if (typeof window === "undefined" || !currentUserId || chatSessions.length === 0) return;
    window.localStorage.setItem(chatHistoryStorageKey(currentUserId), JSON.stringify({
      currentSessionId,
      sessions: chatSessions,
    }));
  }, [chatSessions, currentSessionId, currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setShortcutPhrases(cloneDefaultShortcutPhrases());
      setEditingShortcutId(null);
      setShortcutDraft({ zh: "", en: "" });
      return;
    }
    const localPhrases = loadStoredShortcutPhrases(currentUserId);
    setShortcutPhrases(localPhrases);
    setEditingShortcutId(null);
    setShortcutDraft({ zh: "", en: "" });
    let isMounted = true;
    withStartupRetry(() => loadShortcutPreferences(currentUserId))
      .then((items) => {
        if (!isMounted || items.length === 0) return;
        setShortcutPhrases(items.map((item) => ({ id: item.id, zh: item.zh, en: item.en })));
      })
      .catch(() => {
        // Browser-local shortcut phrases remain usable if the backend is offline.
      });
    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (activeUtilityPanel === "preferences" && currentUserId) {
      void refreshLearnedProfile();
    }
  }, [activeUtilityPanel, currentUserId]);

  useEffect(() => {
    const previous = previousGenerationModeRef.current;
    if (previous !== generationMode) {
      firePreferenceEvent("mode_switch", { from: previous, to: generationMode });
      previousGenerationModeRef.current = generationMode;
    }
  }, [generationMode]);

  useEffect(() => {
    const previews = floorPlanFiles.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
    setFloorPlanPreviews(previews);
    return () => previews.forEach((item) => URL.revokeObjectURL(item.url));
  }, [floorPlanFiles]);

  useEffect(() => {
    if (!isRendering || generationStartedAt === null) return;
    setGenerationElapsedMs(Date.now() - generationStartedAt);
    const timer = window.setInterval(() => {
      setGenerationElapsedMs(Date.now() - generationStartedAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, isRendering]);

  useEffect(() => {
    chatThreadRef.current?.scrollTo({ top: chatThreadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isRendering]);

  useEffect(() => {
    syncComposerHeight(composerRef.current);
  }, [chatInput, composerMode, workspaceMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditableTarget = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "Escape") {
        if (isSettingsMenuOpen) {
          setIsSettingsMenuOpen(false);
          return;
        }
        if (annotationTarget && !isSubmittingAnnotation) {
          setAnnotationTarget(null);
          return;
        }
        if (isComparisonOpen) {
          setIsComparisonOpen(false);
          setComparisonImage(null);
          return;
        }
        if (previewImage) {
          setPreviewImage(null);
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        composerRef.current?.focus();
        if (!isEditableTarget) {
          showToast(locale === "zh" ? "已聚焦需求输入框" : "Composer focused");
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [annotationTarget, isComparisonOpen, isSettingsMenuOpen, isSubmittingAnnotation, locale, previewImage]);

  useEffect(() => {
    if (!isSettingsMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (settingsMenuRef.current && target && !settingsMenuRef.current.contains(target)) {
        setIsSettingsMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isSettingsMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Ignore local layout persistence failures.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAYOUT_DRAWER_WIDTH_STORAGE_KEY, String(drawerWidth));
    } catch {
      // Ignore local layout persistence failures.
    }
  }, [drawerWidth]);

  useEffect(() => {
    function stopResize() {
      activeResizeRef.current = null;
      document.body.classList.remove("is-resizing-layout");
    }

    function handlePointerMove(event: PointerEvent) {
      const activeResize = activeResizeRef.current;
      if (!activeResize) return;
      if (activeResize.panel === "sidebar") {
        const nextWidth = clampPanelWidth(activeResize.startWidth + (event.clientX - activeResize.startX), SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX);
        setSidebarWidth(nextWidth);
        return;
      }
      const nextWidth = clampPanelWidth(activeResize.startWidth - (event.clientX - activeResize.startX), DRAWER_WIDTH_MIN, DRAWER_WIDTH_MAX);
      setDrawerWidth(nextWidth);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("is-resizing-layout");
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600);
  }

  function setFloorPlansFromFiles(files: FileList | File[], append = false) {
    const imageFiles = imageFilesFromFiles(filesFromList(files));
    if (imageFiles.length === 0) {
      showToast(locale === "zh" ? "请粘贴或拖入图片文件" : "Paste or drop image files");
      return;
    }
    setFloorPlanFiles((current) => mergeFloorPlanFiles(current, imageFiles, append));
    showToast(locale === "zh" ? `已导入 ${imageFiles.length} 张平面图` : `${imageFiles.length} floor plan image(s) imported`);
  }

  function containsFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleWorkspaceDragEnter(event: DragEvent<HTMLElement>) {
    if (!isImageWorkspace) return;
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleWorkspaceDragOver(event: DragEvent<HTMLElement>) {
    if (!isImageWorkspace) return;
    if (!containsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFiles(true);
  }

  function handleWorkspaceDragLeave(event: DragEvent<HTMLElement>) {
    if (!isImageWorkspace) return;
    if (!containsFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }

  function handleWorkspaceDrop(event: DragEvent<HTMLElement>) {
    if (!isImageWorkspace) return;
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    setFloorPlansFromFiles(event.dataTransfer.files, true);
  }

  function shortcutText(item: ShortcutPhrase) {
    return (item[locale] || item.zh || item.en).trim();
  }

  function persistShortcutPhrases(nextPhrases: ShortcutPhrase[]) {
    setShortcutPhrases(nextPhrases);
    if (typeof window !== "undefined" && currentUserId) {
      window.localStorage.setItem(shortcutPhrasesStorageKey(currentUserId), JSON.stringify(nextPhrases));
      void saveShortcutPreferences(nextPhrases, currentUserId)
        .then((saved) => {
          const normalized = saved.map((item) => normalizeShortcutPhrase(item)).filter((item): item is ShortcutPhrase => Boolean(item));
          if (normalized.length > 0 || nextPhrases.length === 0) {
            setShortcutPhrases(normalized);
            window.localStorage.setItem(shortcutPhrasesStorageKey(currentUserId), JSON.stringify(normalized));
          }
        })
        .catch((error) => {
          showToast(`${locale === "zh" ? "快捷短语已保存在本机，后端同步失败" : "Phrase saved locally, backend sync failed"}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
  }

  function startNewShortcutPhrase() {
    setEditingShortcutId(null);
    setShortcutDraft({ zh: "", en: "" });
    setActiveUtilityPanel("shortcuts");
  }

  function startEditingShortcutPhrase(item: ShortcutPhrase) {
    setEditingShortcutId(item.id);
    setShortcutDraft({ zh: item.zh, en: item.en });
    setActiveUtilityPanel("shortcuts");
  }

  function saveShortcutPhrase() {
    const zh = shortcutDraft.zh.trim();
    const en = shortcutDraft.en.trim();
    if (!zh && !en) {
      showToast(locale === "zh" ? "请先填写短语内容" : "Add phrase text first");
      return;
    }
    const nextPhrase: ShortcutPhrase = {
      id: editingShortcutId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      zh: zh || en,
      en: en || zh,
    };
    const nextPhrases = editingShortcutId
      ? shortcutPhrases.map((item) => item.id === editingShortcutId ? nextPhrase : item)
      : [...shortcutPhrases, nextPhrase];
    persistShortcutPhrases(nextPhrases);
    setEditingShortcutId(null);
    setShortcutDraft({ zh: "", en: "" });
    showToast(locale === "zh" ? "快捷短语已保存" : "Shortcut phrase saved");
  }

  function removeShortcutPhrase(id: string) {
    const nextPhrases = shortcutPhrases.filter((item) => item.id !== id);
    persistShortcutPhrases(nextPhrases);
    if (editingShortcutId === id) {
      setEditingShortcutId(null);
      setShortcutDraft({ zh: "", en: "" });
    }
    showToast(locale === "zh" ? "快捷短语已删除" : "Shortcut phrase removed");
  }

  function resetShortcutPhrases() {
    const defaults = cloneDefaultShortcutPhrases();
    persistShortcutPhrases(defaults);
    setEditingShortcutId(null);
    setShortcutDraft({ zh: "", en: "" });
    showToast(locale === "zh" ? "已恢复默认快捷短语" : "Default shortcut phrases restored");
  }

  function insertComposerPhrase(text: string) {
    const phrase = text.trim();
    if (!phrase) return;
    setChatInput((current) => {
      const separator = current.trim() ? (current.endsWith("\n") ? "" : "\n") : "";
      return `${current}${separator}${phrase}`;
    });
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function handleComposerInputChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setChatInput(event.target.value);
    syncComposerHeight(event.currentTarget);
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (isChatWorkspace) {
      void runDailyChatFlow();
      return;
    }
    runConversationFlow();
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!isImageWorkspace) return;
    const files = filesFromList(event.clipboardData.files);
    const images = imageFilesFromFiles(files);
    if (images.length === 0) return;
    event.preventDefault();
    setFloorPlansFromFiles(images, true);
  }

  function toggleUtilityPanel(panel: UtilityPanel) {
    setIsSettingsMenuOpen(false);
    setActiveUtilityPanel((current) => current === panel ? null : panel);
  }

  function beginPanelResize(panel: ResizablePanel, width: number, event: ReactPointerEvent<HTMLDivElement>) {
    if (typeof window === "undefined" || window.innerWidth <= DESKTOP_DRAWER_BREAKPOINT) {
      return;
    }
    event.preventDefault();
    activeResizeRef.current = {
      panel,
      startX: event.clientX,
      startWidth: width,
    };
    document.body.classList.add("is-resizing-layout");
  }

  function buildGenerationPrompt(userPrompt?: string, mode: GenerationMode = generationMode) {
    const basePrompt = (userPrompt ?? chatInput).trim();
    if (mode === "standard") {
      return basePrompt;
    }
    return basePrompt ? (locale === "zh" ? `设计需求：${basePrompt}` : `Design brief: ${basePrompt}`) : "";
  }

  function handleSelectedModelChange(value: string) {
    setSelectedModel(value);
    setApiConfig((current) => ({ ...current, imageModel: value }));
  }

  function handleChatModelChange(value: string) {
    setApiConfig((current) => ({ ...current, analysisModel: value }));
  }

  function handleComposerModelChange(value: string) {
    if (isChatWorkspace) {
      handleChatModelChange(value);
      return;
    }
    handleSelectedModelChange(value);
  }

  function handleMaxIterationsChange(value: string) {
    setMaxIterationsInput(value.replace(/\D/g, ""));
  }

  function commitMaxIterations() {
    setMaxIterationsInput(String(normalizeMaxIterations(Number(maxIterationsInput))));
  }

  function removeFloorPlan(index: number) {
    setFloorPlanFiles((current) => current.filter((_, i) => i !== index));
    showToast(locale === "zh" ? "已删除平面图" : "Floor plan removed");
  }

  function clearAttachments(silent = false) {
    setFloorPlanFiles([]);
    if (!silent) {
      showToast(locale === "zh" ? "已清空附件" : "Attachments cleared");
    }
  }

  function currentConversationHasContent() {
    return hasConversationContent({
      messages,
      generationRecordCount: conversationGenerationRecordCount,
      isRendering: isRendering || isChatResponding,
      liveGenerationHasContent: Boolean(liveGeneration?.hasImages || liveGeneration?.floorDesc || liveGeneration?.prompt || liveGeneration?.logs),
    });
  }

  function handleResetWorkspace() {
    if (isRendering || isChatResponding) return;
    if (!currentConversationHasContent()) {
      resetVisibleConversationState();
      setTimeout(() => composerRef.current?.focus(), 0);
      showToast(locale === "zh" ? "当前已是空白新对话" : "Already on a blank new chat");
      return;
    }
    const currentSnapshot = snapshotCurrentSession();
    const nextSession = createEmptySession();
    setChatSessions((current) => {
      const seeded = currentSnapshot ? upsertSession(current, currentSnapshot) : current;
      return upsertSession(seeded, nextSession);
    });
    setCurrentSessionId(nextSession.id);
    setShowApiConfig(true);
    setShowPromptConfig(true);
    setConfigStatus(null);
    setConfigAction(null);
    setIsSubmittingAnnotation(false);
    setIsChatResponding(false);
    setRememberingMessageId(null);
    clearAttachments(true);
    applySession(nextSession);
    showToast(locale === "zh" ? "已新建对话" : "New chat created");
  }

  function handleOpenSession(sessionId: string) {
    if (isRendering || isChatResponding) return;
    if (!sessionId || sessionId === currentSessionId) return;
    const currentSnapshot = snapshotCurrentSession();
    const target = chatSessions.find((session) => session.id === sessionId);
    if (!target) return;
    setChatSessions((current) => currentSnapshot ? upsertSession(current, currentSnapshot) : current);
    setCurrentSessionId(sessionId);
    clearAttachments(true);
    applySession(target);
    showToast(locale === "zh" ? "已切换聊天记录" : "Chat session switched");
  }

  function switchWorkspaceMode(nextMode: WorkspaceMode) {
    if (isRendering || isChatResponding || workspaceMode === nextMode) return;
    setWorkspaceMode(nextMode);
    if (nextMode === "chat") {
      setComposerMode("new-generation");
      setActiveUtilityPanel(null);
      setComparisonImage(null);
      setIsComparisonOpen(false);
    }
    showToast(nextMode === "chat"
      ? locale === "zh" ? "已切换到日常对话" : "Switched to daily chat"
      : locale === "zh" ? "已切换到图像模式" : "Switched to image mode");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function memoryCandidateHasEntries(candidate?: ChatMemoryCandidate) {
    if (!candidate) return false;
    return Object.values(candidate).some((items) => Array.isArray(items) && items.some((item) => String(item || "").trim()));
  }

  function formatMemoryCandidate(candidate: ChatMemoryCandidate, language: Locale) {
    const labels: Record<keyof ChatMemoryCandidate, string> = language === "zh"
      ? { likes: "偏好", avoids: "避免", project: "项目", evaluation_standards: "评判" }
      : { likes: "Likes", avoids: "Avoids", project: "Project", evaluation_standards: "Evaluation" };
    const entries = (Object.keys(labels) as (keyof ChatMemoryCandidate)[])
      .map((key) => {
        const values = candidate[key]?.filter((item) => String(item || "").trim()) ?? [];
        return values.length ? `${labels[key]}: ${values.join(language === "zh" ? "、" : ", ")}` : "";
      })
      .filter(Boolean);
    return entries;
  }

  function handleApplyDraftInstruction(draftInstruction: string) {
    const draft = draftInstruction.trim();
    if (!draft) return;
    setWorkspaceMode("image");
    setComposerMode("new-generation");
    setChatInput(draft);
    setActiveUtilityPanel(null);
    showToast(locale === "zh" ? "已切换到图像模式并载入草稿" : "Switched to image mode and loaded the draft");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function handleRememberChatCandidate(messageId: string, candidate: ChatMemoryCandidate) {
    if (!memoryCandidateHasEntries(candidate) || rememberingMessageId) return;
    setRememberingMessageId(messageId);
    try {
      await applyChatMemory(DEFAULT_PROJECT_ID, candidate, currentUserId || DEFAULT_PROJECT_ID);
      await refreshLearnedProfile(DEFAULT_PROJECT_ID, currentUserId || DEFAULT_PROJECT_ID);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, memoryCandidate: undefined } : message));
      showToast(locale === "zh" ? "已手动记住这条偏好" : "Preference remembered");
    } catch (error) {
      showToast(`${locale === "zh" ? "记忆失败" : "Remember failed"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRememberingMessageId(null);
    }
  }

  function getMemorySectionCopy(section: MemorySection) {
    const copyById: Record<string, { title: string; description: string }> = {
      daily_memories: {
        title: locale === "zh" ? "日常聊天记忆" : "Daily chat memory",
        description: locale === "zh"
          ? "只保存你明确点“记住”后的事实或偏好。"
          : "Only facts or preferences you explicitly saved from chat.",
      },
      long_term_preferences: {
        title: locale === "zh" ? "生图长期偏好" : "Image preferences",
        description: locale === "zh"
          ? "用于改进后续图像提示词的风格偏好。"
          : "Style preferences used to improve future image prompts.",
      },
      avoid_items: {
        title: locale === "zh" ? "避免项" : "Avoid items",
        description: locale === "zh"
          ? "后续图像生成应尽量避开的风格或元素。"
          : "Styles or details future image generation should avoid.",
      },
      project_preferences: {
        title: locale === "zh" ? "项目偏好" : "Project preferences",
        description: locale === "zh"
          ? "当前项目里的结构、材质、灯光和布局约束。"
          : "Current-project structure, material, lighting, and layout constraints.",
      },
      evaluation_standards: {
        title: locale === "zh" ? "评判标准" : "Evaluation standards",
        description: locale === "zh"
          ? "复核图像结果时优先看的质量标准。"
          : "Quality criteria used when reviewing image output.",
      },
      frequent_edit_requests: {
        title: locale === "zh" ? "最近常见修改" : "Recent common edits",
        description: locale === "zh"
          ? "由手动改图动作归纳，仅供查看。"
          : "Derived from manual image edit actions and shown read-only.",
      },
    };
    return copyById[section.id] ?? {
      title: section.label,
      description: section.description || "",
    };
  }

  function startEditingMemoryItem(item: MemoryItem) {
    if (item.editable === false) return;
    setEditingMemoryItemId(item.id);
    setMemoryDraftText(item.text);
  }

  async function handleSaveMemoryItem(itemId: string) {
    const nextText = memoryDraftText.trim();
    if (!nextText) {
      showToast(locale === "zh" ? "记忆内容不能为空" : "Memory text cannot be empty");
      return;
    }
    setMemoryActionId(itemId);
    try {
      const response = await updateMemoryItem(itemId, nextText, DEFAULT_PROJECT_ID);
      setMemoryView(response.memory);
      if (response.profile) {
        setLearnedProfile(response.profile);
      } else {
        await refreshLearnedProfile();
      }
      setEditingMemoryItemId(null);
      setMemoryDraftText("");
      showToast(locale === "zh" ? "记忆已更新" : "Memory updated");
    } catch (error) {
      showToast(`${locale === "zh" ? "更新记忆失败" : "Memory update failed"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMemoryActionId(null);
    }
  }

  async function handleDeleteMemoryItem(itemId: string) {
    setMemoryActionId(itemId);
    try {
      const response = await deleteMemoryItem(itemId, DEFAULT_PROJECT_ID);
      setMemoryView(response.memory);
      if (response.profile) {
        setLearnedProfile(response.profile);
      } else {
        await refreshLearnedProfile();
      }
      if (editingMemoryItemId === itemId) {
        setEditingMemoryItemId(null);
        setMemoryDraftText("");
      }
      showToast(locale === "zh" ? "记忆已删除" : "Memory deleted");
    } catch (error) {
      showToast(`${locale === "zh" ? "删除记忆失败" : "Memory delete failed"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMemoryActionId(null);
    }
  }

  async function handleSubmitAuth(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const username = authDraft.username.trim();
    const password = authDraft.password;
    setAuthError("");
    if (!username || !password) {
      setAuthError(locale === "zh" ? "请输入账号和密码" : "Enter username and password");
      return;
    }
    setIsAuthSubmitting(true);
    try {
      const response = authMode === "register"
        ? await register(username, password)
        : await login(username, password);
      if (!response.user) {
        throw new Error(locale === "zh" ? "登录响应缺少用户信息" : "Auth response did not include a user");
      }
      applyAuthenticatedUser(response.user);
      showToast(authMode === "register"
        ? locale === "zh" ? "账号已创建并登录" : "Account created and signed in"
        : locale === "zh" ? "已登录" : "Signed in");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      showToast(`${locale === "zh" ? "登出请求失败，已清空本地状态" : "Logout request failed; local state cleared"}: ${error instanceof Error ? error.message : String(error)}`);
    }
    clearAuthenticatedUserState(true);
    setAuthMode("login");
    showToast(locale === "zh" ? "已登出并清空当前可见数据" : "Signed out and cleared visible user data");
  }

  function handleExpandPreview(item: PreviewImage | RenderHistoryItem | null | undefined = activeResult) {
    if (!item) {
      showToast(locale === "zh" ? "暂无可放大的生成图片" : "No generated image to expand yet");
      return;
    }
    const imageUrl = "url" in item ? item.url : item.imageUrl;
    if (!imageUrl) {
      showToast(locale === "zh" ? "暂无可放大的生成图片" : "No generated image to expand yet");
      return;
    }
    const label = "url" in item ? item.label : item.imageLabel || item.title;
    const sourceResultId = "url" in item ? item.sourceResultId : item.id;
    if (sourceResultId) {
      setActiveResultId(sourceResultId);
    }
    setPreviewImage({
      url: imageUrl,
      label,
      downloadUrl: item.downloadUrl,
      sourceResultId
    });
  }

  function downloadImage(url: string, filename: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleDownloadResult(item?: RenderHistoryItem | null) {
    const imageUrl = item?.downloadUrl || item?.imageUrl;
    if (!imageUrl) {
      showToast(locale === "zh" ? "暂无可下载的图片" : "No image to download yet");
      return;
    }
    const safeName = slugifyFilename(item?.imageLabel || item?.title || "render-result");
    downloadImage(imageUrl, `${safeName}.png`);
  }

  function handleOpenResult(item?: RenderHistoryItem | null) {
    handleExpandPreview(item);
  }

  async function handleCopyImage(url?: string, label?: string) {
    if (!url) {
      showToast(locale === "zh" ? "暂无可复制的图片" : "No image to copy yet");
      return;
    }
    try {
      if (navigator.clipboard?.write && "ClipboardItem" in window) {
        const response = await fetch(url);
        const blob = await response.blob();
        const mimeType = blob.type || "image/png";
        await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
        showToast(locale === "zh" ? "已复制图片" : "Image copied");
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast(locale === "zh" ? "已复制图片链接" : "Image link copied");
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        showToast(locale === "zh" ? "图片复制受限，已复制链接" : "Image copy is restricted; link copied");
      } catch {
        showToast(locale === "zh" ? "复制失败，请手动复制" : "Copy failed");
      }
    }
  }

  function handleOpenComparison(item?: PreviewImage | RenderHistoryItem | null) {
    const selectedResult = item && !("url" in item) ? item : item?.sourceResultId ? renderHistory.find((result) => result.id === item.sourceResultId) ?? null : activeResult;
    const renderUrl = item && "url" in item ? item.url : selectedResult?.imageUrl;
    const renderLabel = item && "url" in item ? item.label : selectedResult?.imageLabel || selectedResult?.title;
    const resultMode = selectedResult?.generationMode || generationMode;
    if (resultMode === "standard") {
      const rightResult = selectedResult?.imageUrl ? selectedResult : comparisonCandidates[0] ?? null;
      const leftResult = comparisonCandidates.find((candidate) => candidate.id !== rightResult?.id) ?? null;
      if (!leftResult || !rightResult) {
        showToast(locale === "zh" ? "默认模式需要至少两张历史生成图才能对比" : "Default mode needs at least two generated history images to compare");
        return;
      }
      setComparisonImage({ mode: "history-vs-history", leftResultId: leftResult.id, rightResultId: rightResult.id });
      setIsComparisonOpen(true);
      firePreferenceEvent("compare", { mode: "history-vs-history" }, selectedResult?.id || "");
      return;
    }
    const floorPlanUrl = selectedResult?.floorPlanUrl || floorPlanPreviews[0]?.url;
    const floorPlanName = selectedResult?.floorPlanName || floorPlanPreviews[0]?.name;
    if (!floorPlanUrl || !renderUrl) {
      showToast(locale === "zh" ? "需要同时有平面图和效果图才能对比" : "A floor plan and a render are both required for comparison");
      return;
    }
    if (selectedResult?.id) {
      setActiveResultId(selectedResult.id);
    }
    setComparisonImage({ mode: "floor-vs-render", floorPlanUrl, floorPlanName, renderUrl, renderLabel });
    setIsComparisonOpen(true);
    firePreferenceEvent("compare", { mode: "floor-vs-render" }, selectedResult?.id || "");
  }

  function resolveRenderMessageResult(message: ChatMessage) {
    if (!message.sourceResultId) {
      return activeResult;
    }
    return renderHistory.find((item) => item.id === message.sourceResultId) ?? activeResult;
  }

  function isRenderMessageComparisonDisabled(message: ChatMessage) {
    const messageSourceResult = resolveRenderMessageResult(message);
    const messageResultMode = messageSourceResult?.generationMode || generationMode;
    if (messageResultMode === "standard") {
      return comparisonCandidates.length < 2;
    }
    return !messageSourceResult?.floorPlanUrl && !floorPlanPreviews[0]?.url;
  }

  async function handleCopyRunSummary(item?: RenderHistoryItem | null) {
    if (!item) {
      showToast(locale === "zh" ? "暂无生成摘要" : "No run summary yet");
      return;
    }
    const analysisText = buildFloorPlanAnalysisText(item.floorDesc);
    const summary = [
      `# ${item.title}`,
      item.status ? `Status: ${item.status}` : "",
      analysisText ? `Analysis:\n${analysisText}` : "",
      item.prompt ? `Prompt:\n${item.prompt}` : "",
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
    setComposerMode("new-generation");
    firePreferenceEvent("use_prompt", {
      generation_mode: item.generationMode || generationMode,
      source_title: item.title,
    }, item.id, item.projectId || DEFAULT_PROJECT_ID, item.userId || currentUserId || DEFAULT_PROJECT_ID);
    showToast(locale === "zh" ? "已把结果提示词载入输入框" : "Prompt loaded into composer");
  }

  function handleEditResult(item: RenderHistoryItem) {
    if (!item.imageUrl) {
      showToast(locale === "zh" ? "这条结果没有可继续修改的图片" : "This result has no image to edit");
      return;
    }
    setActiveResultId(item.id);
    setComposerMode("edit-selected-result");
    setTimeout(() => composerRef.current?.focus(), 0);
    showToast(locale === "zh" ? "已切换为继续改图模式" : "Composer switched to edit mode");
  }

  function handleAnnotateResult(item: RenderHistoryItem) {
    if (!item.imageUrl) {
      showToast(locale === "zh" ? "这条结果没有可标注的图片" : "This result has no image to annotate");
      return;
    }
    setActiveResultId(item.id);
    setAnnotationTarget(item);
    showToast(locale === "zh" ? "已打开标注续改" : "Annotation editor opened");
  }

  function handleNewGenerationMode() {
    setComposerMode("new-generation");
    showToast(locale === "zh" ? "已切换为新生成模式" : "Composer switched to new generation");
  }

  function removeResultFromState(id: string) {
    setRenderHistory((current) => {
      const next = current.filter((item) => item.id !== id);
      setActiveResultId((currentActive) => {
        if (currentActive !== id) return currentActive;
        return next[0]?.id ?? null;
      });
      return next;
    });
  }

  async function handleRemoveResult(id: string) {
    if (!id.startsWith("result-")) {
      removeResultFromState(id);
      showToast(locale === "zh" ? "已移除该结果" : "Result removed");
      return;
    }
    try {
      await deleteResult(id, currentUserId || DEFAULT_PROJECT_ID);
      removeResultFromState(id);
      showToast(locale === "zh" ? "已移除该结果" : "Result removed");
    } catch (error) {
      showToast(`${locale === "zh" ? "后端删除失败" : "Backend delete failed"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleClearHistory() {
    const snapshot = renderHistory;
    const snapshotActive = activeResultId;
    setRenderHistory([]);
    setActiveResultId(null);
    try {
      await clearResults(currentUserId || DEFAULT_PROJECT_ID);
      showToast(locale === "zh" ? "结果库已清空" : "Result library cleared");
    } catch (error) {
      setRenderHistory(snapshot);
      setActiveResultId(snapshotActive);
      showToast(`${locale === "zh" ? "后端清空失败" : "Backend clear failed"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleSaveResultNotes(item: RenderHistoryItem, notes: string) {
    try {
      const updated = await saveResultNotes(item.id, notes, item.userId || currentUserId || DEFAULT_PROJECT_ID);
      setRenderHistory((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...updated } : candidate));
      showToast(locale === "zh" ? "备注已保存" : "Notes saved");
      firePreferenceEvent("note", {
        has_notes: Boolean(notes.trim()),
        title: item.title,
      }, item.id, item.projectId || DEFAULT_PROJECT_ID, item.userId || currentUserId || DEFAULT_PROJECT_ID);
    } catch (error) {
      showToast(`${locale === "zh" ? "保存备注失败" : "Saving notes failed"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleSubmitAnnotationEdit(instruction: string, annotationImage: Blob) {
    const target = annotationTarget;
    if (!target?.id) {
      showToast(locale === "zh" ? "请先选择一张已有结果" : "Select an existing result first");
      return;
    }
    const idBase = Date.now();
    const runGuard = createConversationRunGuard();
    const userBrief = instruction.trim() || (locale === "zh" ? "仅使用图片标注，保持其他区域不变" : "Use the image annotation only and keep other regions unchanged");
    setMessages((current) => [
      ...current,
      {
        id: `m-user-annotation-${idBase}`,
        role: "user",
        kind: "text",
        content: locale === "zh" ? `标注续改：${userBrief}` : `Annotated edit: ${userBrief}`
      },
      {
        id: `m-ai-annotation-${idBase}`,
        role: "assistant",
        kind: "analysis",
        content: {
          zh: "已提交标注图。后端会先让分析模型理解标注区域，再用干净源图生成新版本。",
          en: "Annotation submitted. The backend will analyze the marked region first, then generate from the clean source image."
        },
        bullets: {
          zh: ["标注图仅用于分析模型", "画图阶段优先使用干净源图", "红圈、箭头和涂鸦会作为负向约束"],
          en: ["Annotation is only for the analysis model", "Generation prefers the clean source image", "Circles, arrows, and drawings are negative constraints"]
        }
      }
    ]);
    setChatInput(instruction);
    setActiveResultId(target.id);
    setIsSubmittingAnnotation(true);
    setIsRendering(true);
    setGenerationStartedAt(Date.now());
    setGenerationElapsedMs(0);
    setLiveGeneration(null);
    setActiveStep("submitted");
    try {
      const response = await requestAnnotatedImageEdit({
        sourceResultId: target.id,
        userId: target.userId || currentUserId || DEFAULT_PROJECT_ID,
        editInstruction: instruction,
        projectId: target.projectId || "default",
        maxIterations: effectiveMaxIterations,
        enableQualityEvaluation,
        apiConfig,
        selectedModel,
        annotationImage: new File([annotationImage], "annotation.png", { type: annotationImage.type || "image/png" })
      });
      if (!isActiveConversationRun(runGuard)) return;
      const editedItems = (response.results?.length ? response.results : response.result ? [response.result] : []).map(normalizeApiResult);
      if (editedItems.length === 0) {
        throw new Error(locale === "zh" ? "标注改图没有返回结果" : "Annotated edit returned no result");
      }
      const newHistoryItems = editedItems.map((item) => ({
        ...item,
        floorPlanUrl: item.floorPlanUrl || target.floorPlanUrl || floorPlanPreviews[0]?.url,
        floorPlanName: item.floorPlanName || target.floorPlanName || floorPlanPreviews[0]?.name
      }));
      const historyItem = newHistoryItems[0];
      setRenderHistory((current) => {
        const newIds = new Set(newHistoryItems.map((item) => item.id));
        return [...newHistoryItems, ...current.filter((item) => !newIds.has(item.id))].slice(0, 12);
      });
      setActiveResultId(historyItem.id);
      setActiveStep("completed");
      setAnnotationTarget(null);
      showToast(historyItem.modelWarning || (locale === "zh" ? "标注改图完成，已加入结果库" : "Annotated edit completed and added to library"));
      if (activeUtilityPanel === "preferences") {
        void refreshLearnedProfile(target.projectId || DEFAULT_PROJECT_ID, target.userId || currentUserId || DEFAULT_PROJECT_ID);
      }
      setMessages((current) => [
        ...current,
        {
          id: `m-api-annotation-analysis-${idBase}`,
          role: "assistant",
          kind: "analysis",
          content: {
            zh: "标注改图完成。新版本已保留在结果库，并记录了标注图、修改文字和分析结果。",
            en: "Annotated edit completed. The new version is stored with its annotation image, edit request, and analysis result."
          },
          bullets: {
            zh: compactLines([
              historyItem.status || "",
              historyItem.editInstruction ? `修改要求：${historyItem.editInstruction}` : "",
              historyItem.versionIndex ? `版本 v${historyItem.versionIndex}` : "",
              historyItem.modelWarning || ""
            ]),
            en: compactLines([
              historyItem.status || "",
              historyItem.editInstruction ? `Edit: ${historyItem.editInstruction}` : "",
              historyItem.versionIndex ? `Version v${historyItem.versionIndex}` : "",
              historyItem.modelWarning || ""
            ])
          },
          promptText: historyItem.prompt
        },
        {
          id: `m-api-annotation-render-${idBase}`,
          role: "assistant",
          kind: "render",
          content: response.ok ? (locale === "zh" ? "标注修改后的真实渲染结果已返回" : "Annotated edit result returned") : response.error || t.requestFailed,
          imageUrl: historyItem.imageUrl,
          imageLabel: historyItem.imageLabel || historyItem.title
        }
      ]);
    } catch (error) {
      if (!isActiveConversationRun(runGuard)) return;
      setActiveStep("failed");
      setMessages((current) => [
        ...current,
        {
          id: `m-api-annotation-error-${idBase}`,
          role: "assistant",
          kind: "error",
          content: `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]);
    } finally {
      if (isActiveConversationRun(runGuard)) {
        setIsSubmittingAnnotation(false);
        setIsRendering(false);
        setGenerationStartedAt(null);
        setLiveGeneration(null);
      }
    }
  }

  function applyGenerationProgress(idBase: number, progress: GenerationProgress) {
    const nextStep = progress.stage === "failed"
      ? "failed"
      : progress.stage === "completed"
        ? "completed"
        : progress.stage === "evaluating"
          ? "evaluating"
        : progress.stage === "rendering"
          ? "rendering"
          : progress.stage === "analysis" || progress.prompt || progress.floor_desc
            ? "analysis"
            : "submitted";
    setActiveStep(nextStep);
    setLiveGeneration({
      status: progress.status,
      stage: progress.stage,
      floorDesc: progress.floor_desc,
      prompt: progress.prompt,
      evaluation: progress.evaluation,
      logs: progress.logs,
      hasImages: progress.has_images,
      iteration: progress.iteration,
      maxIterations: progress.max_iterations
    });
    const hasSpatialAnalysis = Boolean(progress.floor_desc);
    const hasPrompt = Boolean(progress.prompt);
    const hasEvaluation = Boolean(progress.evaluation);
    const hasImage = Boolean(progress.has_images);
    if (hasSpatialAnalysis || hasPrompt || hasEvaluation || hasImage) {
      const waitingForImage = !hasImage;
      const zhContent = hasImage
        ? hasEvaluation
          ? "图片已返回，严格复核结果已更新，正在整理最终结果。"
          : enableQualityEvaluation
            ? "图片已返回，正在等待严格复核结论。"
            : "图片已返回，严格复核默认关闭，正在整理最终结果。"
        : hasSpatialAnalysis || hasPrompt
          ? "空间分析或提示词已返回，正在继续等待图片生成结果。"
          : "后端正在处理生成流程。";
      const enContent = hasImage
        ? hasEvaluation
          ? "Images returned and the strict review is updated. Packaging the final result."
          : enableQualityEvaluation
            ? "Images returned. Waiting for the strict review result."
            : "Images returned. Strict review is off by default, packaging the final result."
        : hasSpatialAnalysis || hasPrompt
          ? "Spatial analysis or prompt returned. Still waiting for image generation."
          : "Backend generation is still running.";
      setMessages((current) => {
        const next = current.filter((message) => message.id !== `m-live-analysis-${idBase}`);
        next.push({
          id: `m-live-analysis-${idBase}`,
          role: "assistant",
          kind: "analysis",
          content: {
            zh: zhContent,
            en: enContent
          },
          bullets: {
            zh: compactLines([
              progress.status || "",
              hasSpatialAnalysis ? "空间分析已完成" : "",
              hasPrompt ? "最终提示词已生成" : "",
              hasImage ? "图片结果已返回" : "图片仍在生成中，请继续等待",
              hasEvaluation ? "严格复核结果已返回" : hasImage ? (enableQualityEvaluation ? "等待严格复核" : "严格复核默认关闭") : ""
            ]),
            en: compactLines([
              progress.status || "",
              hasSpatialAnalysis ? "Spatial analysis completed" : "",
              hasPrompt ? "Final prompt generated" : "",
              hasImage ? "Image result returned" : "Image generation is still running",
              hasEvaluation ? "Strict review result returned" : hasImage ? (enableQualityEvaluation ? "Waiting for strict review" : "Strict review left off") : ""
            ])
          },
          promptText: progress.prompt
        });
        return next;
      });
    }
  }

  function removeLiveAnalysisMessage(idBase: number) {
    setMessages((current) => current.filter((message) => message.id !== `m-live-analysis-${idBase}`));
  }

  async function runDailyChatFlow() {
    if (isChatResponding || isRendering) return;
    const userBrief = chatInput.trim();
    if (!userBrief) {
      showToast(chatBlocker || (locale === "zh" ? "请先输入聊天内容" : "Type a chat message first"));
      return;
    }

    const idBase = Date.now();
    const runGuard = createConversationRunGuard();
    setMessages((current) => [
      ...current,
      {
        id: `m-chat-user-${idBase}`,
        role: "user",
        kind: "text",
        content: userBrief
      }
    ]);
    setChatInput("");
    setIsChatResponding(true);

    try {
      const response = await sendDesignChat({
        message: userBrief,
        user_id: currentUserId || DEFAULT_PROJECT_ID,
        project_id: DEFAULT_PROJECT_ID,
        active_result_id: activeResult?.id || "",
        api_config: apiConfig,
        reasoning_effort: chatReasoningEffort,
        context: {
          workspace_mode: "chat",
          chatInput: userBrief,
          activeResult: activeResult ? {
            id: activeResult.id,
            prompt: activeResult.prompt,
            evaluation: activeResult.evaluation,
            floorDesc: activeResult.floorDesc,
            logs: activeResult.logs
          } : null
        }
      });
      if (!isActiveConversationRun(runGuard)) return;
      const draftInstruction = response.draft_instruction?.trim() || "";
      const memoryCandidate = memoryCandidateHasEntries(response.memory_candidate) ? response.memory_candidate : undefined;
      const bullets = [
        draftInstruction ? (locale === "zh" ? "可一键转到图像模式并载入草稿" : "Draft can be moved into image mode") : "",
        memoryCandidate ? (locale === "zh" ? "检测到可手动保存的偏好" : "Detected a preference you can save manually") : "",
      ].filter(Boolean);
      setMessages((current) => [
        ...current,
        {
          id: `m-chat-ai-${idBase}`,
          role: "assistant",
          kind: "text",
          content: response.reply,
          bullets: bullets.length
            ? {
                zh: locale === "zh" ? bullets : compactLines([
                  draftInstruction ? "可一键转到图像模式并载入草稿" : "",
                  memoryCandidate ? "检测到可手动保存的偏好" : "",
                ]),
                en: locale === "en" ? bullets : compactLines([
                  draftInstruction ? "Draft can be moved into image mode" : "",
                  memoryCandidate ? "Detected a preference you can save manually" : "",
                ])
              }
            : undefined,
          draftInstruction,
          memoryCandidate
        }
      ]);
    } catch (error) {
      if (!isActiveConversationRun(runGuard)) return;
      setMessages((current) => [
        ...current,
        {
          id: `m-chat-error-${idBase}`,
          role: "assistant",
          kind: "error",
          content: `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]);
    } finally {
      if (isActiveConversationRun(runGuard)) {
        setIsChatResponding(false);
      }
    }
  }

  async function runConversationFlow(userPrompt?: string, requestedMode: GenerationMode = generationMode) {
    if (isRendering) return;
    const submitMode = requestedMode;
    const prompt = buildGenerationPrompt(userPrompt, submitMode);
    const userBrief = (userPrompt ?? chatInput).trim();
    const submitBlocker = composerMode === "edit-selected-result"
      ? generationBlocker
      : getGenerationBlocker(submitMode);
    if (submitBlocker) {
      showToast(submitBlocker || (locale === "zh" ? "请先补齐生成输入" : "Complete the generation inputs first"));
      return;
    }
    const displayedBrief = userBrief || (submitMode === "colored_floor_plan"
      ? locale === "zh" ? "生成彩色平面图" : "Generate a colored floor plan"
      : "");
    const idBase = Date.now();
    const runGuard = createConversationRunGuard();
    const nextMessages: ChatMessage[] = [];
    nextMessages.push({
      id: `m-user-${idBase}`,
      role: "user",
      kind: "text",
      content: displayedBrief
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
        zh: compactLines(["提交生成请求", submitMode === "standard" ? "直通模式：不解析需求" : "同步平面图", "等待后端真实返回"]),
        en: compactLines(["Submit generation request", submitMode === "standard" ? "Default mode: no requirement parsing" : "Sync floor plan", "Wait for the real backend result"])
      }
    });
    setMessages((current) => [...current, ...nextMessages]);
    setGenerationStartedAt(Date.now());
    setGenerationElapsedMs(0);
    setLiveGeneration(null);
    setIsRendering(true);
    setActiveStep("submitted");

    try {
      if (composerMode === "edit-selected-result") {
        if (!activeResult?.id) {
          throw new Error(locale === "zh" ? "请先选择一张已有结果" : "Select an existing result first");
        }
        const editResult = await requestImageEdit({
          sourceResultId: activeResult.id,
          userId: activeResult.userId || currentUserId || DEFAULT_PROJECT_ID,
          editInstruction: userBrief,
          projectId: activeResult.projectId || "default",
          maxIterations: effectiveMaxIterations,
          enableQualityEvaluation,
          apiConfig,
          selectedModel
        });
        if (!isActiveConversationRun(runGuard)) return;
        const editedItems = (editResult.results?.length ? editResult.results : editResult.result ? [editResult.result] : []).map(normalizeApiResult);
        if (editedItems.length === 0) {
          throw new Error(locale === "zh" ? "改图没有返回结果" : "Image edit returned no result");
        }
        const newHistoryItems = editedItems.map((item) => ({
          ...item,
          floorPlanUrl: item.floorPlanUrl || activeResult.floorPlanUrl || floorPlanPreviews[0]?.url,
          floorPlanName: item.floorPlanName || activeResult.floorPlanName || floorPlanPreviews[0]?.name
        }));
        const historyItem = newHistoryItems[0];
        setRenderHistory((current) => {
          const newIds = new Set(newHistoryItems.map((item) => item.id));
          return [...newHistoryItems, ...current.filter((item) => !newIds.has(item.id))].slice(0, 12);
        });
        setActiveResultId(historyItem.id);
        setActiveStep("completed");
        showToast(locale === "zh" ? "改图完成，已加入结果库" : "Image edit completed and added to library");
        if (activeUtilityPanel === "preferences") {
          void refreshLearnedProfile(activeResult.projectId || DEFAULT_PROJECT_ID, activeResult.userId || currentUserId || DEFAULT_PROJECT_ID);
        }
        removeLiveAnalysisMessage(idBase);
        setMessages((current) => [
          ...current,
          {
            id: `m-api-analysis-${idBase}`,
            role: "assistant",
            kind: "analysis",
            content: {
              zh: "改图完成。新版本已保留在结果库，并与上一版建立版本关系。",
              en: "Image edit completed. The new version is saved in the result library and linked to the previous version."
            },
            bullets: {
              zh: compactLines([historyItem.status || "", historyItem.editInstruction ? `修改要求：${historyItem.editInstruction}` : "", historyItem.versionIndex ? `版本 v${historyItem.versionIndex}` : ""]),
              en: compactLines([historyItem.status || "", historyItem.editInstruction ? `Edit: ${historyItem.editInstruction}` : "", historyItem.versionIndex ? `Version v${historyItem.versionIndex}` : ""])
            },
            promptText: historyItem.prompt
          },
          {
            id: `m-api-render-${idBase}`,
            role: "assistant",
            kind: "render",
            content: editResult.ok ? (locale === "zh" ? "修改后的真实渲染结果已返回" : "Edited render result returned") : editResult.error || t.requestFailed,
            imageUrl: historyItem.imageUrl,
            imageLabel: historyItem.imageLabel || historyItem.title,
            sourceResultId: historyItem.id,
          }
        ]);
        return;
      }

      const result = await requestGenerationStream(
        {
          projectId: DEFAULT_PROJECT_ID,
          userId: currentUserId || DEFAULT_PROJECT_ID,
          mode: submitMode,
          prompt,
          directionStackText: "",
          maxIterations: effectiveMaxIterations,
          enableQualityEvaluation,
          apiConfig,
          selectedModel,
          floorPlanFiles
        },
        (progress) => {
          if (!isActiveConversationRun(runGuard)) return;
          applyGenerationProgress(idBase, progress);
        }
      );
      if (!isActiveConversationRun(runGuard)) return;
      const firstImage = result.images?.[0];
      const backendItems = result.results?.map(normalizeApiResult) ?? [];
      const fallbackItem: RenderHistoryItem = {
        id: `r-${idBase}`,
        title: firstImage?.label || (locale === "zh" ? `生成结果 ${new Date().toLocaleTimeString()}` : `Render ${new Date().toLocaleTimeString()}`),
        status: result.status,
        imageUrl: firstImage?.url || firstImage?.data_url,
        downloadUrl: firstImage?.download_url,
        imageLabel: firstImage?.label,
        prompt: result.prompt,
        evaluation: result.evaluation,
        floorDesc: result.floor_desc,
        logs: result.logs,
        createdAt: new Date().toISOString(),
        generationMode: submitMode,
        floorPlanUrl: floorPlanPreviews[0]?.url,
        floorPlanName: floorPlanPreviews[0]?.name
      };
      const newHistoryItems = (backendItems.length > 0 ? backendItems : [fallbackItem]).map((item) => ({
        ...item,
        generationMode: item.generationMode || submitMode,
        floorPlanUrl: item.floorPlanUrl || floorPlanPreviews[0]?.url,
        floorPlanName: item.floorPlanName || floorPlanPreviews[0]?.name
      }));
      const historyItem = newHistoryItems[0];
      setRenderHistory((current) => {
        const newIds = new Set(newHistoryItems.map((item) => item.id));
        return [...newHistoryItems, ...current.filter((item) => !newIds.has(item.id))].slice(0, 12);
      });
      setActiveResultId(historyItem.id);
      setActiveStep("completed");
      showToast(locale === "zh" ? "生成完成，已加入结果库" : "Generation completed and added to library");
      if (activeUtilityPanel === "preferences") {
        void refreshLearnedProfile(DEFAULT_PROJECT_ID, currentUserId || DEFAULT_PROJECT_ID);
      }
      const finalPrompt = result.prompt || prompt;
      removeLiveAnalysisMessage(idBase);
      const resultMessages: ChatMessage[] = [
        {
          id: `m-api-analysis-${idBase}`,
          role: "assistant",
          kind: "analysis",
          content: {
            zh: submitMode === "standard" ? "生成完成。默认模式已按输入框文本直通出图。" : "生成完成。空间分析已整理到右侧栏，最终提示词可在这里展开查看。",
            en: submitMode === "standard" ? "Generation completed. Default mode sent the composer text directly to image generation." : "Generation completed. Spatial analysis is shown in the right panel, and the final prompt can be expanded here."
          },
          bullets: {
            zh: compactLines([result.status || "", finalPrompt ? "最终提示词已生成" : "", result.evaluation ? "评估报告已返回" : ""]),
            en: compactLines([result.status || "", finalPrompt ? "Final prompt generated" : "", result.evaluation ? "Evaluation returned" : ""])
          },
          promptText: finalPrompt
        },
        {
          id: `m-api-render-${idBase}`,
          role: "assistant",
          kind: "render",
          content: result.ok ? (locale === "zh" ? "真实渲染结果已返回" : "Real render result returned") : result.error || t.requestFailed,
          imageUrl: historyItem.imageUrl || firstImage?.data_url || firstImage?.url,
          imageLabel: historyItem.imageLabel || firstImage?.label,
          sourceResultId: historyItem.id,
        }
      ];
      setMessages((current) => [...current, ...resultMessages]);
    } catch (error) {
      if (!isActiveConversationRun(runGuard)) return;
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
      if (isActiveConversationRun(runGuard)) {
        setIsRendering(false);
        setGenerationStartedAt(null);
        setLiveGeneration(null);
      }
    }
  }

  function handleGenerate() {
    if (isChatWorkspace) {
      void runDailyChatFlow();
      return;
    }
    runConversationFlow();
  }

  function handleRunColoredFloorPlanTool() {
    if (isChatWorkspace) {
      return;
    }
    void runConversationFlow(undefined, "colored_floor_plan");
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isChatWorkspace) {
      void runDailyChatFlow();
      return;
    }
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
      message: locale === "zh" ? "正在保存到当前账号..." : "Saving to the current account..."
    });
    try {
      window.localStorage.setItem(apiConfigStorageKey(currentUserId), JSON.stringify(apiConfig));
      const result = await saveConfig(apiConfig);
      setConfigStatus({
        tone: "good",
        message: result.message || (locale === "zh" ? "模型与 API 配置已保存到当前账号" : "Model and API setup saved to this account")
      });
      showToast(locale === "zh" ? "配置已保存到当前账号" : "Configuration saved to this account");
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
    for (const storageKey of apiConfigStorageReadKeys(currentUserId)) {
      window.localStorage.removeItem(storageKey);
    }
    setConfigStatus({
      tone: "good",
      message:
        locale === "zh"
          ? "已恢复默认配置；当前账号会继续使用后端已保存的本地配置。"
          : "Defaults restored. This account can still use backend-saved local setup."
    });
  }

  const comparisonLeftResult = comparisonImage?.mode === "history-vs-history"
    ? renderHistory.find((item) => item.id === comparisonImage.leftResultId) ?? null
    : null;
  const comparisonRightResult = comparisonImage?.mode === "history-vs-history"
    ? renderHistory.find((item) => item.id === comparisonImage.rightResultId) ?? null
    : null;
  const layoutStyle = {
    "--chatgpt-sidebar-width": `${sidebarWidth}px`,
    "--chatgpt-drawer-width": `${drawerWidth}px`,
  } as CSSProperties;

  return (
    <main
      className={`studio-shell ${isRendering ? "is-rendering" : ""} ${isDraggingFiles ? "is-dragging-files" : ""}`}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
    >
      {isDraggingFiles && (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            <ImagePlus size={24} />
            <strong>{locale === "zh" ? "释放图片以添加平面图" : "Drop images to add floor plans"}</strong>
            <span>{locale === "zh" ? "支持多张图片，系统会自动同步到生成请求" : "Multiple images are supported and sent with the generation request"}</span>
          </div>
        </div>
      )}

      <div className={`chatgpt-layout ${activeUtilityPanel ? "has-drawer" : ""}`} style={layoutStyle}>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={locale === "zh" ? "调整左侧边栏宽度" : "Resize the left sidebar"}
          className="chatgpt-layout__resize-handle chatgpt-layout__resize-handle--sidebar"
          onPointerDown={(event) => beginPanelResize("sidebar", sidebarWidth, event)}
        />
        <aside className="chatgpt-sidebar" aria-label={locale === "zh" ? "侧边栏" : "Sidebar"}>
          <div className="chatgpt-sidebar__brand">
            <div className="brand-mark">
              <Aperture size={18} />
            </div>
            <div>
              <strong>{t.appName}</strong>
              <span>{locale === "zh" ? "聊天优先，图像辅助" : "Chat first, image assisted"}</span>
            </div>
          </div>

          <div className="chatgpt-sidebar__identity">
            <div>
              <span>{locale === "zh" ? "当前账号" : "Account"}</span>
              <strong>{authUser?.username || (locale === "zh" ? "未登录" : "Not signed in")}</strong>
              <small>
                {locale === "zh"
                  ? "配置、结果、历史和偏好按登录账号隔离。"
                  : "Config, results, history, and memory are scoped to this account."}
              </small>
            </div>
            <button type="button" onClick={() => authUser ? void handleLogout() : setShowUserDialog(true)}>
              {authUser ? <LogOut size={14} /> : <KeyRound size={14} />}
              {authUser ? (locale === "zh" ? "登出" : "Logout") : (locale === "zh" ? "登录" : "Sign in")}
            </button>
          </div>

          <button
            type="button"
            className={`chatgpt-sidebar__new-chat ${canStartNewConversation ? "" : "is-empty-session"}`}
            onClick={handleResetWorkspace}
            disabled={isRendering || isChatResponding}
            title={!canStartNewConversation
              ? (locale === "zh" ? "当前已经是空白新对话；点击可清空草稿并聚焦输入框" : "Current chat is already blank; click to clear draft state and focus the composer")
              : (locale === "zh" ? "新建对话" : "Start a new chat")}
          >
            <Plus size={15} />
            <span>{locale === "zh" ? "新对话" : "New chat"}</span>
          </button>

          <div className="chatgpt-sidebar__section chatgpt-sidebar__history">
            <p className="chatgpt-sidebar__label">{locale === "zh" ? "历史聊天" : "Chat history"}</p>
            {sidebarHistoryItems.length === 0 ? (
              <div className="chatgpt-sidebar__empty">
                {locale === "zh" ? "还没有历史聊天" : "No chat history yet"}
              </div>
            ) : (
              sidebarHistoryItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={currentSessionId === item.id ? "is-active" : ""}
                  onClick={() => handleOpenSession(item.id)}
                >
                  <span className="chatgpt-sidebar__history-title">{item.title}</span>
                  <small>{new Date(item.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                </button>
              ))
            )}
          </div>

          <div className="chatgpt-sidebar__footer">
            <div className="chatgpt-sidebar__section">
              <p className="chatgpt-sidebar__label">{locale === "zh" ? "工作台设置" : "Workspace settings"}</p>
              <div className="chatgpt-sidebar__settings-menu" ref={settingsMenuRef}>
                <button
                  type="button"
                  className={`chatgpt-sidebar__settings-trigger ${isSettingsMenuOpen ? "is-active" : ""}`}
                  aria-expanded={isSettingsMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setIsSettingsMenuOpen((current) => !current)}
                >
                  <span className="chatgpt-sidebar__tool-icon">
                    <Settings2 size={15} />
                  </span>
                  <span className="chatgpt-sidebar__tool-copy">
                    <strong>{locale === "zh" ? "设置" : "Settings"}</strong>
                    <small>{locale === "zh" ? "点击后选择要调整的功能项" : "Choose a category to adjust"}</small>
                  </span>
                </button>
                {isSettingsMenuOpen && (
                  <div className="chatgpt-sidebar__settings-popover" role="menu" aria-label={locale === "zh" ? "设置菜单" : "Settings menu"}>
                    {sidebarSettingPanels.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.panel}
                          type="button"
                          role="menuitem"
                          className={`chatgpt-sidebar__menu-item ${activeUtilityPanel === item.panel ? "is-active" : ""}`}
                          onClick={() => openSettingsPanel(item.panel)}
                        >
                          <span className="chatgpt-sidebar__tool-icon">
                            <Icon size={15} />
                          </span>
                          <span className="chatgpt-sidebar__tool-copy">
                            <strong>{item.title}</strong>
                            <small>{item.description}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

        </aside>

        <section className="chatgpt-main">
          <header className={`chatgpt-main__header chatgpt-main__header--${workspaceMode}`}>
            <div className="chatgpt-main__title">
              <p>{composerMode === "edit-selected-result" && isImageWorkspace ? (locale === "zh" ? "继续修改当前图" : "Continue editing") : currentWorkspaceLabel}</p>
              <div className="chatgpt-main__status-row">
                <strong className="chatgpt-main__model-name" title={isChatWorkspace ? undefined : selectedModel}>
                  {isChatWorkspace ? (locale === "zh" ? "日常聊天" : "Daily conversation") : selectedModel}
                </strong>
                <StatusBadge tone={isRendering ? "warn" : hasRunFailure ? "warn" : "good"}>{projectState}</StatusBadge>
              </div>
            </div>
            <div className="workspace-mode-toggle" aria-label={locale === "zh" ? "工作区模式" : "Workspace mode"}>
              <button
                type="button"
                className={workspaceMode === "chat" ? "is-active" : ""}
                aria-pressed={workspaceMode === "chat"}
                onClick={() => switchWorkspaceMode("chat")}
                disabled={isRendering || isChatResponding}
              >
                <MessageCircle size={14} />
                {locale === "zh" ? "聊天" : "Chat"}
              </button>
              <button
                type="button"
                className={workspaceMode === "image" ? "is-active" : ""}
                aria-pressed={workspaceMode === "image"}
                onClick={() => switchWorkspaceMode("image")}
                disabled={isRendering || isChatResponding}
              >
                <Camera size={14} />
                {locale === "zh" ? "图像" : "Image"}
              </button>
            </div>
            <div className={`chatgpt-main__actions chatgpt-main__actions--${workspaceMode}`}>
              <div className="chatgpt-main__action-group">
                {isImageWorkspace && composerMode === "edit-selected-result" && (
                  <button type="button" onClick={handleNewGenerationMode}>
                    <RotateCcw size={14} />
                    {locale === "zh" ? "回到新生成" : "Back to new"}
                  </button>
                )}
                <button type="button" className={activeUtilityPanel === "results" ? "is-active" : ""} onClick={() => toggleUtilityPanel("results")}>
                  <ImagePlus size={14} />
                  {locale === "zh" ? "结果" : "Results"}
                </button>
                {isImageWorkspace && (
                  <button type="button" className={activeUtilityPanel === "analysis" ? "is-active" : ""} onClick={() => toggleUtilityPanel("analysis")}>
                    <Clock3 size={14} />
                    {locale === "zh" ? "分析" : "Analysis"}
                  </button>
                )}
                {isImageWorkspace && (
                  <button
                    type="button"
                    className={activeUtilityPanel === "shortcuts" ? "is-active" : ""}
                    onClick={() => toggleUtilityPanel("shortcuts")}
                    title={locale === "zh" ? "自定义、编辑或删除快捷短语" : "Customize, edit, or delete shortcut phrases"}
                  >
                    <Edit3 size={14} />
                    {locale === "zh" ? "管理短语" : "Manage phrases"}
                  </button>
                )}
              </div>
              {isImageWorkspace && (
                <div className="chatgpt-main__action-group chatgpt-main__action-group--result">
                  <button type="button" onClick={() => handleOpenResult(activeResult)} disabled={!activeResult?.imageUrl}>
                    <Eye size={14} />
                    {locale === "zh" ? "预览" : "Preview"}
                  </button>
                  <button type="button" onClick={() => handleOpenComparison()} disabled={!canCompareActiveResult}>
                    <FileText size={14} />
                    {locale === "zh" ? "对比" : "Compare"}
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className={`chatgpt-thread ${messages.length === 0 && !isRendering && !chatInput.trim() ? "is-empty" : ""}`} aria-label={t.designChat} ref={chatThreadRef}>
            {messages.length === 0 && !isRendering && !chatInput.trim() ? (
              <div className={`chatgpt-empty chatgpt-empty--${workspaceMode}`}>
                <div className="chatgpt-empty__copy">
                  <h1>{locale === "zh" ? "我们先从哪里开始呢？" : "Where should we start?"}</h1>
                  <p>
                    {isChatWorkspace
                      ? locale === "zh"
                        ? "先日常聊聊；当你有想出图的内容时，可以把草稿一键带到图像模式。"
                        : "Chat normally first. When an image idea is ready, move the draft into image mode."
                      : locale === "zh"
                      ? "粘贴或拖入平面图、选择模式，再把你的需求直接发给模型。常用功能都通过按钮按需展开。"
                      : "Paste or drop floor plans, pick a mode, and send the prompt directly. Utility panels stay behind buttons until needed."}
                  </p>
                </div>
                <div className="chatgpt-empty__actions">
                  {isImageWorkspace ? (
                    <button type="button" onClick={() => composerRef.current?.focus()}>
                      <Edit3 size={14} />
                      {locale === "zh" ? "开始输入需求" : "Start brief"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => composerRef.current?.focus()}>
                      <MessageCircle size={14} />
                      {locale === "zh" ? "开始聊天" : "Start chatting"}
                    </button>
                  )}
                  <button type="button" onClick={() => toggleUtilityPanel("results")}>
                    <ImagePlus size={14} />
                    {locale === "zh" ? "打开结果库" : "Open results"}
                  </button>
                  <button type="button" onClick={() => toggleUtilityPanel("generation")}>
                    <Box size={14} />
                    {locale === "zh" ? "打开生成控制" : "Open generation controls"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {isRendering && (
                  <div className="generation-progress-card" role="status" aria-live="polite">
                    <div className="progress-orb"><span /></div>
                    <div className="generation-progress-content">
                      <div className="generation-progress-head">
                        <strong>{locale === "zh" ? "后端正在执行生成流程" : "Backend generation is running"}</strong>
                        <span>{generationElapsedLabel}</span>
                      </div>
                      <p>
                        {locale === "zh"
                          ? `当前阶段：${generationStageLabel}。分析/提示词会先显示，图片继续在后台等待真实返回。`
                          : `Current stage: ${generationStageLabel}. Analysis and prompt details may appear before the image is returned.`}
                      </p>
                      <div className="generation-progress-meta">
                        <span>{locale === "zh" ? `已用 ${generationElapsedLabel}` : `Elapsed ${generationElapsedLabel}`}</span>
                        <span>{locale === "zh" ? "等待真实返回" : "Waiting for real result"}</span>
                      </div>
                      <div className="generation-progress-bar generation-progress-bar--indeterminate" aria-label={locale === "zh" ? "生成状态" : "Generation status"}>
                        <span />
                      </div>
                      <div className="generation-progress-steps">
                        <span className={["submitted", "analysis", "rendering", "evaluating", "completed"].includes(activeStep) ? "is-active" : ""}>{locale === "zh" ? "已提交" : "Submitted"}</span>
                        <span className={["analysis", "rendering", "evaluating", "completed"].includes(activeStep) || hasCurrentAnalysisResult ? "is-active" : ""}>{progressAnalysisStepLabel}</span>
                        <span className={["rendering", "evaluating", "completed"].includes(activeStep) ? "is-active" : ""}>{currentIteration ? (locale === "zh" ? `第 ${currentIteration} 轮出图` : `Rendering iteration ${currentIteration}`) : (locale === "zh" ? "等待图片" : "Waiting for image")}</span>
                        <span className={enableQualityEvaluation && ["evaluating", "completed"].includes(activeStep) ? "is-active" : !enableQualityEvaluation ? "is-muted" : ""}>{enableQualityEvaluation ? (locale === "zh" ? "严格复核" : "Strict review") : (locale === "zh" ? "默认关闭" : "Off by default")}</span>
                      </div>
                      {isGenerationSlow && (
                        <p className="generation-slow-note">
                          {locale === "zh"
                            ? "已经超过 5 分钟，可能是模型排队或图片生成较慢；只要没有报错，后端仍在等待结果。"
                            : "This has taken over 5 minutes. The model may be queued or rendering slowly; without an error, the backend is still waiting."}
                        </p>
                      )}
                    </div>
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

                      {message.promptText && (
                        <details className="prompt-details">
                          <summary>{locale === "zh" ? "查看最终提示词" : "View final prompt"}</summary>
                          <pre>{message.promptText}</pre>
                        </details>
                      )}

                      {(message.draftInstruction || memoryCandidateHasEntries(message.memoryCandidate)) && (
                        <div className="message-action-row">
                          {message.draftInstruction && (
                            <button type="button" onClick={() => handleApplyDraftInstruction(message.draftInstruction || "")}>
                              <Camera size={14} />
                              {locale === "zh" ? "转到图像模式" : "Use in image mode"}
                            </button>
                          )}
                          {memoryCandidateHasEntries(message.memoryCandidate) && (
                            <button
                              type="button"
                              onClick={() => message.memoryCandidate && void handleRememberChatCandidate(message.id, message.memoryCandidate)}
                              disabled={rememberingMessageId !== null}
                            >
                              <Save size={14} />
                              {rememberingMessageId === message.id
                                ? locale === "zh" ? "保存中" : "Saving"
                                : locale === "zh" ? "记住偏好" : "Remember"}
                            </button>
                          )}
                          {message.memoryCandidate && memoryCandidateHasEntries(message.memoryCandidate) && (
                            <small>{formatMemoryCandidate(message.memoryCandidate, locale).join("；")}</small>
                          )}
                        </div>
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
                      <button type="button" className="image-zoom-trigger" onClick={() => message.imageUrl && handleExpandPreview({ url: message.imageUrl, label: message.imageLabel || t.renderPreview, sourceResultId: message.sourceResultId })} title={locale === "zh" ? "单击放大" : "Click to enlarge"}><img className="api-render-image" src={message.imageUrl} alt={message.imageLabel || t.renderPreview} /></button>
                      <div className="render-card-actions">
                        <button type="button" onClick={() => message.imageUrl && handleExpandPreview({ url: message.imageUrl, label: message.imageLabel || t.renderPreview, sourceResultId: message.sourceResultId })}>
                          <Eye size={14} />
                          {locale === "zh" ? "放大" : "Enlarge"}
                        </button>
                        <button type="button" onClick={() => handleCopyImage(message.imageUrl, message.imageLabel)}>
                          <Clipboard size={14} />
                          {locale === "zh" ? "复制图片" : "Copy image"}
                        </button>
                        <button type="button" onClick={() => message.imageUrl && handleOpenComparison({ url: message.imageUrl, label: message.imageLabel || t.renderPreview, sourceResultId: message.sourceResultId })} disabled={isRenderMessageComparisonDisabled(message)}>
                          <FileText size={14} />
                          {locale === "zh" ? "对比分析" : "Compare"}
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
              </>
            )}
          </div>

          <form className="chatgpt-composer" onSubmit={handleComposerSubmit}>
            {isImageWorkspace && (selectedEditSourceLabel || floorPlanFiles.length > 0) && (
              <div className="chatgpt-composer__attachments" aria-label={locale === "zh" ? "已添加的图片" : "Attached images"}>
                {selectedEditSourceLabel && <span className="chatgpt-chip chatgpt-chip--accent">{selectedEditSourceLabel}</span>}
                {floorPlanPreviews.slice(0, 4).map((file, index) => (
                  <button
                    type="button"
                    className="chatgpt-composer__attachment"
                    key={file.url}
                    onClick={() => removeFloorPlan(index)}
                    title={locale === "zh" ? "点击移除平面图" : "Click to remove floor plan"}
                  >
                    <img src={file.url} alt={file.name} />
                    <span>{file.name}</span>
                    <X size={13} aria-hidden="true" />
                  </button>
                ))}
                {floorPlanPreviews.length > 4 && <span className="chatgpt-chip">+{floorPlanPreviews.length - 4}</span>}
              </div>
            )}

            <div className={`chatgpt-composer__bar ${isChatWorkspace ? "chatgpt-composer__bar--chat" : ""}`}>
              <textarea
                ref={composerRef}
                name="composer_text"
                className={chatInput.trim().length > 900 ? "is-long-draft" : ""}
                value={chatInput}
                onChange={handleComposerInputChange}
                onKeyDown={handleComposerKeyDown}
                onPaste={handleComposerPaste}
                placeholder={composerPlaceholder}
                rows={1}
                aria-label={composerPlaceholder}
              />
              <div className="chatgpt-composer__inline-actions">
                <span className="chatgpt-composer__provider-badge" title={composerProviderLabel}>
                  <PlugZap size={14} aria-hidden="true" />
                  <span>{composerProviderLabel}</span>
                </span>
                <select
                  className="chatgpt-composer__model-select"
                  value={composerModelValue}
                  onChange={(event) => handleComposerModelChange(event.target.value)}
                  disabled={isRendering || isChatResponding}
                  aria-label={isChatWorkspace ? (locale === "zh" ? "聊天模型" : "Chat model") : (locale === "zh" ? "图像模型" : "Image model")}
                  title={isChatWorkspace ? (locale === "zh" ? "切换聊天模型" : "Switch chat model") : (locale === "zh" ? "切换图像模型" : "Switch image model")}
                >
                  {!composerModelValue && (
                    <option value="">{locale === "zh" ? "选择模型" : "Select model"}</option>
                  )}
                  {composerModelOptions.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                {isChatWorkspace && (
                  <select
                    className="chatgpt-composer__effort-select"
                    value={chatReasoningEffort}
                    onChange={(event) => setChatReasoningEffort(event.target.value as ChatReasoningEffort)}
                    disabled={isChatResponding}
                    aria-label={locale === "zh" ? "思考强度" : "Reasoning effort"}
                    title={locale === "zh" ? "切换回复深度" : "Switch response depth"}
                  >
                    {chatReasoningEffortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {locale === "zh" ? `思考 ${option.zh}` : `Effort ${option.en}`}
                      </option>
                    ))}
                  </select>
                )}
                {isImageWorkspace && (
                  <button type="button" className={enableQualityEvaluation ? "is-active" : ""} onClick={() => setEnableQualityEvaluation((current) => !current)} disabled={isRendering} title={enableQualityEvaluation ? (locale === "zh" ? "关闭严格复核" : "Disable strict review") : (locale === "zh" ? "启用可选严格复核" : "Enable optional strict review")}>
                    <CheckCircle2 size={14} />
                    {locale === "zh" ? "严格复核" : "Strict review"}
                  </button>
                )}
                <button
                  type="submit"
                  className="chatgpt-composer__send"
                  disabled={isRendering || isChatResponding || !canSubmitComposer}
                  aria-busy={isRendering || isChatResponding}
                  title={(isChatWorkspace ? chatBlocker : generationBlocker) || composerSubmitShortcutHint}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>

            <div className="chatgpt-composer__meta">
              <div className="chatgpt-composer__mode-row">
                {isImageWorkspace && (composerMode === "new-generation" ? generationModeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={generationMode === option.value ? "is-active" : ""}
                    aria-pressed={generationMode === option.value}
                    onClick={() => setGenerationMode(option.value)}
                    disabled={isRendering}
                  >
                    {locale === "zh" ? option.zh : option.en}
                  </button>
                )) : (
                  <button type="button" className="is-active" onClick={handleNewGenerationMode}>
                    {locale === "zh" ? "切回新生成" : "Back to new"}
                  </button>
                ))}
                {isChatWorkspace && (
                  <span className="chatgpt-mode-note">
                    {locale === "zh" ? "日常对话不会直接出图" : "Daily chat does not render directly"}
                  </span>
                )}
              </div>
              <div className="chatgpt-composer__utility-row">
                {isImageWorkspace && composerMode === "new-generation" && floorPlanFiles.length > 0 && (
                  <button
                    type="button"
                    className="chatgpt-tool-action"
                    onClick={handleRunColoredFloorPlanTool}
                    disabled={isRendering || isChatResponding || Boolean(coloredFloorPlanActionBlocker)}
                    title={coloredFloorPlanActionBlocker || (locale === "zh" ? "用当前平面图直接生成彩色平面图，输入框文字只作为补充偏好" : "Generate a colored floor plan from the current attachment; composer text is only an optional preference")}
                  >
                    <Aperture size={14} />
                    {locale === "zh" ? "彩色平面图" : "Colored plan"}
                  </button>
                )}
                <span>{locale === "zh" ? `已输入 ${chatInput.trim().length} 字` : `${chatInput.trim().length} characters`}</span>
              </div>
            </div>

            {isImageWorkspace && composerMode === "new-generation" && generationMode === "render3d" && (
              <div className="shortcut-toolbar" aria-label={locale === "zh" ? "3D 快捷短语" : "3D shortcut phrases"}>
                <div className="shortcut-toolbar__head">
                  <span>{locale === "zh" ? "快捷短语" : "Shortcut phrases"}</span>
                </div>
                <div className="shortcut-chip-row">
                  {shortcutPhrases.length === 0 ? (
                    <p className="shortcut-empty-note">
                      {locale === "zh" ? "还没有快捷短语，可通过顶部「管理短语」新增。" : "No shortcut phrases yet. Use the header Manage phrases control to add one."}
                    </p>
                  ) : shortcutPhrases.map((item) => {
                    const text = shortcutText(item);
                    return (
                      <span className="shortcut-chip" key={item.id}>
                        <button type="button" onClick={() => insertComposerPhrase(text)} title={locale === "zh" ? "插入 3D 快捷短语" : "Insert 3D shortcut phrase"}>
                          {text}
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {!canSubmitComposer && <p className="composer-hint">{composerHint}</p>}
          </form>
        </section>

        {activeUtilityPanel && (
          <aside className="chatgpt-drawer">
            <div className="chatgpt-drawer__header">
              <div>
                <p className="eyebrow">{locale === "zh" ? "按需展开" : "Open on demand"}</p>
                <h2>{utilityPanelTitles[activeUtilityPanel]}</h2>
              </div>
              <button type="button" onClick={() => setActiveUtilityPanel(null)}>
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>

            <div className="chatgpt-drawer__content">
              {activeUtilityPanel === "results" && (
                <ResultLibrary
                  locale={locale}
                  items={renderHistory}
                  activeId={activeResultId}
                  onSelect={setActiveResultId}
                  onDownload={handleDownloadResult}
                  onOpen={handleOpenResult}
                  onCopy={handleCopyRunSummary}
                  onUsePrompt={handleUseResultPrompt}
                  onEdit={handleEditResult}
                  onAnnotate={handleAnnotateResult}
                  onSaveNotes={handleSaveResultNotes}
                  onRemove={handleRemoveResult}
                  onClear={handleClearHistory}
                />
              )}

              {activeUtilityPanel === "analysis" && (
                <div className="chatgpt-drawer__stack">
                  <div className="control-section run-status-panel">
                    <div className="section-title">
                      <Clock3 size={14} />
                      {locale === "zh" ? "运行阶段" : "Run stages"}
                    </div>
                    <div className="run-stage-rail" aria-label={locale === "zh" ? "运行阶段" : "Run stages"}>
                      {workflowSteps.map((item) => {
                        const stepIndex = workflowStepOrder.indexOf(item.step);
                        const isSkipped = item.step === "evaluating" && !enableQualityEvaluation;
                        const isCurrentFailure = hasRunFailure && item.step === "analysis";
                        const isActive = !isSkipped && (workflowActiveStep === item.step || isCurrentFailure);
                        const isDone = !isSkipped && !hasRunFailure && hasRun && (workflowActiveStep === "completed" || (workflowActiveIndex >= 0 && stepIndex < workflowActiveIndex));
                        return (
                          <div
                            className={`run-stage ${isDone ? "run-stage--done" : ""} ${isActive ? "run-stage--active" : ""} ${isSkipped ? "run-stage--skipped" : ""} ${isCurrentFailure ? "run-stage--warning" : ""}`}
                            key={item.step}
                          >
                            <span>{isDone ? "✓" : stepIndex + 1}</span>
                            <strong>{item.title}</strong>
                            <em>{item.detail}</em>
                          </div>
                        );
                      })}
                    </div>
                    <p className="run-stage-note">
                      {hasRunFailure
                        ? locale === "zh" ? "本次请求失败，流程停在分析或生成阶段。" : "This request failed during analysis or generation."
                        : isRendering
                          ? generationStageLabel
                          : latestResult
                            ? locale === "zh" ? "最近一次结果已完成并写入结果库。" : "The latest result has completed and was saved."
                            : locale === "zh" ? "开始生成后，这里会随阶段自动变换。" : "After generation starts, this rail updates with the current stage."}
                    </p>
                  </div>

                  <div className="control-section floor-analysis-sidebar">
                    <div className="section-title">
                      <FileText size={14} />
                      {locale === "zh" ? "平面图分析结果" : "Floor plan analysis"}
                    </div>
                    {sidebarAnalysisText ? (
                      <pre>{sidebarAnalysisText}</pre>
                    ) : (
                      <p>
                        {floorPlanFiles.length > 0
                          ? locale === "zh" ? "生成开始后，平面图解析结果会显示在这里。" : "Floor plan parsing appears here after generation starts."
                          : locale === "zh" ? "先粘贴或拖入平面图，然后开始生成以获取分析结果。" : "Paste or drop a floor plan, then generate to get analysis output."}
                      </p>
                    )}
                    {(liveGeneration?.status || latestResult?.status) && <em>{liveGeneration?.status || latestResult?.status}</em>}
                  </div>
                </div>
              )}

              {activeUtilityPanel === "shortcuts" && (
                <div className="chatgpt-drawer__stack">
                  <div className="control-section shortcut-manager">
                    <div className="shortcut-manager__head">
                      <div className="section-title">
                        <Clipboard size={14} />
                        {locale === "zh" ? "常用短语" : "Saved phrases"}
                      </div>
                      <button type="button" onClick={startNewShortcutPhrase}>
                        <Plus size={14} />
                        {locale === "zh" ? "新增" : "Add"}
                      </button>
                    </div>
                    <p className="config-hint">
                      {locale === "zh"
                        ? "这里管理的短语会作为按钮插入到唯一的主输入框，不会新增第二个需求输入入口。"
                        : "Managed phrases insert into the single main composer; this does not add a second prompt field."}
                    </p>
                    <div className="shortcut-manager__list">
                      {shortcutPhrases.length === 0 ? (
                        <p className="shortcut-empty-note">
                          {locale === "zh" ? "当前没有已保存短语。点击新增创建第一条，或恢复默认短语。" : "No saved phrases. Add the first one or restore defaults."}
                        </p>
                      ) : shortcutPhrases.map((item) => {
                        const text = shortcutText(item);
                        return (
                          <div className="shortcut-manager__item" key={item.id}>
                            <button type="button" className="shortcut-manager__phrase" onClick={() => insertComposerPhrase(text)}>
                              <span>{text}</span>
                              <small>{locale === "zh" ? "插入到主输入框" : "Insert into composer"}</small>
                            </button>
                            <div className="shortcut-manager__item-actions">
                              <button type="button" onClick={() => startEditingShortcutPhrase(item)} title={locale === "zh" ? "编辑短语" : "Edit phrase"}>
                                <Edit3 size={14} />
                              </button>
                              <button type="button" onClick={() => removeShortcutPhrase(item.id)} title={locale === "zh" ? "删除短语" : "Delete phrase"}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="control-section shortcut-editor">
                    <div className="section-title">
                      <Edit3 size={14} />
                      {editingShortcutId ? (locale === "zh" ? "编辑短语" : "Edit phrase") : (locale === "zh" ? "新增短语" : "New phrase")}
                    </div>
                    <label>
                      <span>{locale === "zh" ? "中文短语" : "Chinese phrase"}</span>
                      <textarea
                        rows={3}
                        value={shortcutDraft.zh}
                        onChange={(event) => setShortcutDraft((current) => ({ ...current, zh: event.target.value }))}
                        placeholder={locale === "zh" ? "例如：柔和日光与真实全局照明" : "Optional Chinese phrase"}
                      />
                    </label>
                    <label>
                      <span>{locale === "zh" ? "英文短语" : "English phrase"}</span>
                      <textarea
                        rows={3}
                        value={shortcutDraft.en}
                        onChange={(event) => setShortcutDraft((current) => ({ ...current, en: event.target.value }))}
                        placeholder="Soft daylight and realistic global illumination"
                      />
                    </label>
                    <div className="shortcut-editor__actions">
                      <button type="button" onClick={saveShortcutPhrase}>
                        <Save size={14} />
                        {locale === "zh" ? "保存短语" : "Save phrase"}
                      </button>
                      <button type="button" onClick={() => {
                        setEditingShortcutId(null);
                        setShortcutDraft({ zh: "", en: "" });
                      }}>
                        <X size={14} />
                        {locale === "zh" ? "清空" : "Clear"}
                      </button>
                      <button type="button" onClick={resetShortcutPhrases}>
                        <RotateCcw size={14} />
                        {locale === "zh" ? "恢复默认" : "Reset defaults"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeUtilityPanel === "preferences" && (
                <div className="chatgpt-drawer__stack">
                  <div className="control-section">
                    <div className="section-title">
                      <CheckCircle2 size={14} />
                      {locale === "zh" ? "记忆与偏好" : "Memory and preferences"}
                    </div>
                    <p className="config-hint">
                      {locale === "zh"
                        ? "日常聊天记忆只来自你手动确认的“记住”；生图偏好用于辅助图像提示词。"
                        : "Daily chat memory only comes from explicit Remember actions; image preferences support image prompts."}
                    </p>
                    {memoryView ? (
                      <div className="learned-profile-list">
                        {memoryView.sections.map((section) => {
                          const sectionCopy = getMemorySectionCopy(section);
                          return (
                            <div className="learned-profile-block" key={section.id}>
                              <strong>{sectionCopy.title}</strong>
                              <p>{sectionCopy.description}</p>
                              {section.items.length === 0 ? (
                                <p className="memory-item-empty">{locale === "zh" ? "暂无内容" : "Nothing saved yet"}</p>
                              ) : (
                                <div className="memory-item-list">
                                  {section.items.map((item) => (
                                    <div className="memory-item-row" key={item.id}>
                                      {editingMemoryItemId === item.id ? (
                                        <input
                                          value={memoryDraftText}
                                          onChange={(event) => setMemoryDraftText(event.target.value)}
                                          aria-label={locale === "zh" ? "编辑记忆" : "Edit memory"}
                                        />
                                      ) : (
                                        <span>{item.text}</span>
                                      )}
                                      {item.editable === false ? (
                                        <small>{locale === "zh" ? "只读" : "Read-only"}</small>
                                      ) : editingMemoryItemId === item.id ? (
                                        <div className="memory-item-actions">
                                          <button type="button" onClick={() => void handleSaveMemoryItem(item.id)} disabled={memoryActionId === item.id}>
                                            <Save size={13} />
                                            {locale === "zh" ? "保存" : "Save"}
                                          </button>
                                          <button type="button" onClick={() => {
                                            setEditingMemoryItemId(null);
                                            setMemoryDraftText("");
                                          }}>
                                            <X size={13} />
                                            {locale === "zh" ? "取消" : "Cancel"}
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="memory-item-actions">
                                          <button type="button" onClick={() => startEditingMemoryItem(item)}>
                                            <Edit3 size={13} />
                                            {locale === "zh" ? "编辑" : "Edit"}
                                          </button>
                                          <button type="button" onClick={() => void handleDeleteMemoryItem(item.id)} disabled={memoryActionId === item.id}>
                                            <Trash2 size={13} />
                                            {locale === "zh" ? "删除" : "Delete"}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="chatgpt-drawer__empty-note">{locale === "zh" ? "还没有读取到记忆内容。" : "Memory is not available yet."}</p>
                    )}
                  </div>
                </div>
              )}

              {activeUtilityPanel === "generation" && (
                <div className="chatgpt-drawer__stack">
                  <div className="control-section">
                    <p className="config-hint">
                      {locale === "zh"
                        ? "这里的改动会直接影响下一次出图；如果你希望长期保留到当前账号，再去“模型与 API”面板保存。"
                        : "Changes here affect the next image run immediately. Use the Model & API panel if you want to save them for this account."}
                    </p>
                    <label className="select-row">
                      <span>
                        <Box size={15} />
                        {locale === "zh" ? "画图模型" : "Image model"}
                      </span>
                      <span className="select-shell select-shell--input">
                        <input
                          name="selected_model"
                          list="image-model-options"
                          value={selectedModel}
                          onChange={(event) => handleSelectedModelChange(event.target.value)}
                          placeholder={locale === "zh" ? "输入模型名" : "Type model name"}
                          aria-label={locale === "zh" ? "画图模型" : "Image model"}
                        />
                        <datalist id="image-model-options">
                          {modelOptions.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                      </span>
                    </label>
                    <label className="select-row select-row--stacked">
                      <span>
                        <RotateCcw size={15} />
                        {t.modelFallback}
                      </span>
                      <span className="select-shell select-shell--input select-shell--wide">
                        <input
                          name="fallback_models"
                          value={apiConfig.fallbackModels}
                          onChange={(event) => setApiConfig((current) => ({ ...current, fallbackModels: event.target.value }))}
                          placeholder={locale === "zh" ? "多个模型用逗号分隔" : "Comma-separated model names"}
                          aria-label={t.modelFallback}
                        />
                      </span>
                    </label>
                    <label className="select-row">
                      <span>
                        <Clock3 size={15} />
                        {t.maxIterations}
                      </span>
                      <span className="select-shell select-shell--input select-shell--number">
                        <input
                          name="max_iterations"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          min={1}
                          max={MAX_ITERATIONS_UPPER_BOUND}
                          value={maxIterationsInput}
                          onChange={(event) => handleMaxIterationsChange(event.target.value)}
                          onBlur={commitMaxIterations}
                          onFocus={(event) => event.currentTarget.select()}
                          placeholder="5"
                          aria-label={t.maxIterations}
                        />
                        <span className="select-shell__unit">{locale === "zh" ? "轮" : "passes"}</span>
                      </span>
                    </label>
                    <div className={`quality-toggle-card ${enableQualityEvaluation ? "quality-toggle-card--active" : ""}`}>
                      <div>
                        <div className="section-title">
                          <CheckCircle2 size={14} />
                          {locale === "zh" ? "严格复核（可选）" : "Strict review (optional)"}
                        </div>
                        <p>
                          {enableQualityEvaluation
                            ? locale === "zh" ? "本次会在首轮出图后追加一次视觉复核；只有复核认为仍需补跑时，才会继续占用剩余轮数。" : "This run adds a vision-based review after the first image and only spends extra passes if that review asks for another try."
                            : locale === "zh" ? "默认关闭。首轮图片返回后直接入库；只有你主动打开时，才会进入额外复核流程。" : "Off by default. The first returned image is saved immediately; turn this on only when you want the extra review pass."}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={enableQualityEvaluation ? "is-active" : ""}
                        onClick={() => setEnableQualityEvaluation((current) => !current)}
                        disabled={isRendering}
                      >
                        <CheckCircle2 size={14} />
                        {enableQualityEvaluation ? (locale === "zh" ? "本次启用" : "Enabled") : (locale === "zh" ? "启用严格复核" : "Enable")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeUtilityPanel === "setup" && (
                <div className="chatgpt-drawer__stack">
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
                        ? "留空则使用当前账号已保存的后端配置；点击保存配置后会写入该账号的本地配置，并同步缓存到本机浏览器。"
                        : "Leave empty to use this account's saved backend setup. Save writes to this account and also caches it in this browser."}
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
                </div>
              )}

              {activeUtilityPanel === "prompts" && (
                <div className="chatgpt-drawer__stack">
                  <div className="control-section">
                    <button
                      className="config-toggle"
                      type="button"
                      onClick={() => setShowPromptConfig((current) => !current)}
                    >
                      <span>
                        <FileText size={16} />
                        {locale === "zh" ? "提示词设置" : "Prompt settings"}
                      </span>
                      <ChevronDown size={15} className={showPromptConfig ? "is-open" : ""} />
                    </button>
                    <p className="config-hint">
                      {locale === "zh"
                        ? "这里单独维护分析提示词和生图提示词，避免和模型/API 参数混在一起。保存时仍写入当前账号的本地配置。"
                        : "Prompt overrides live here separately from the model/API setup. Saving still writes to this account's local config."}
                    </p>
                    {showPromptConfig && (
                      <div className="api-config-grid">
                        <label className="api-config-wide">
                          <span>{locale === "zh" ? "第一步提示词：平面图结构化分析" : "Step 1 prompt: floor plan structured analysis"}</span>
                          <textarea
                            rows={12}
                            value={apiConfig.floorAnalysisSystemPrompt}
                            onChange={(event) => setApiConfig((current) => ({ ...current, floorAnalysisSystemPrompt: event.target.value }))}
                            placeholder={locale === "zh" ? "为空则使用后端默认第一步提示词" : "Leave empty to use the backend default step-1 prompt"}
                          />
                        </label>
                        <label className="api-config-wide">
                          <span>{locale === "zh" ? "第二步提示词：中文生图提示词生成" : "Step 2 prompt: Chinese prompt compiler"}</span>
                          <textarea
                            rows={12}
                            value={apiConfig.promptGenSystem3dCn}
                            onChange={(event) => setApiConfig((current) => ({ ...current, promptGenSystem3dCn: event.target.value }))}
                            placeholder={locale === "zh" ? "为空则使用后端默认第二步提示词" : "Leave empty to use the backend default step-2 prompt"}
                          />
                        </label>
                        <div className="config-action-row">
                          <button type="button" onClick={handleSaveApiConfig} disabled={configAction !== null}>
                            <Save size={14} />
                            {configAction === "save" ? (locale === "zh" ? "保存中" : "Saving") : locale === "zh" ? "保存提示词设置" : "Save prompt settings"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setApiConfig((current) => ({ ...current, floorAnalysisSystemPrompt: "", promptGenSystem3dCn: "" }))}
                            disabled={configAction !== null}
                          >
                            <RotateCcw size={14} />
                            {locale === "zh" ? "清空覆盖" : "Clear overrides"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
        {activeUtilityPanel && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={locale === "zh" ? "调整右侧抽屉宽度" : "Resize the right drawer"}
            className="chatgpt-layout__resize-handle chatgpt-layout__resize-handle--drawer"
            onPointerDown={(event) => beginPanelResize("drawer", drawerWidth, event)}
          />
        )}
      </div>

      {annotationTarget && (
        <AnnotationEditor
          locale={locale}
          item={annotationTarget}
          isSubmitting={isSubmittingAnnotation}
          onClose={() => {
            if (!isSubmittingAnnotation) setAnnotationTarget(null);
          }}
          onSubmit={handleSubmitAnnotationEdit}
        />
      )}
      {showUserDialog && (
        <div className="identity-modal" role="dialog" aria-modal="true" aria-label={locale === "zh" ? "账号登录" : "Account sign in"} onClick={() => authUser && setShowUserDialog(false)}>
          <div className="identity-modal__content" onClick={(event) => event.stopPropagation()}>
            <div className="identity-modal__head">
              <div className="identity-modal__title-block">
                <p className="eyebrow">{locale === "zh" ? "账号空间" : "Account workspace"}</p>
                <h2>{authMode === "register" ? (locale === "zh" ? "创建账号" : "Create account") : (locale === "zh" ? "登录账号" : "Sign in")}</h2>
              </div>
              {authUser && (
                <button type="button" className="identity-modal__close" onClick={() => setShowUserDialog(false)} aria-label={locale === "zh" ? "关闭" : "Close"}>
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="identity-modal__hint">
              {locale === "zh"
                ? "登录后，你的聊天历史、结果库、API Key、配置和记忆都会按账号隔离。"
                : "After sign-in, chat history, results, API keys, config, and memory are isolated by account."}
            </p>
            <div className="identity-modal__mode-row" role="tablist" aria-label={locale === "zh" ? "登录方式" : "Auth mode"}>
              <button type="button" className={authMode === "login" ? "is-active" : ""} onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}>
                {locale === "zh" ? "登录" : "Sign in"}
              </button>
              <button type="button" className={authMode === "register" ? "is-active" : ""} onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}>
                {locale === "zh" ? "注册" : "Register"}
              </button>
            </div>
            <form className="identity-modal__form" onSubmit={handleSubmitAuth}>
              <label className="identity-modal__field">
                <span>{locale === "zh" ? "账号名" : "Username"}</span>
                <input
                  id="identity-username"
                  name="username"
                  value={authDraft.username}
                  onChange={(event) => {
                    setAuthDraft((current) => ({ ...current, username: event.target.value }));
                    setAuthError("");
                  }}
                  placeholder={locale === "zh" ? "例如：alex 或 team-a" : "e.g. alex or team-a"}
                  autoComplete="username"
                />
              </label>
              <label className="identity-modal__field">
                <span>{locale === "zh" ? "密码" : "Password"}</span>
                <input
                  id="identity-password"
                  name="password"
                  type="password"
                  value={authDraft.password}
                  onChange={(event) => {
                    setAuthDraft((current) => ({ ...current, password: event.target.value }));
                    setAuthError("");
                  }}
                  placeholder={authMode === "register" ? (locale === "zh" ? "至少 8 位" : "At least 8 characters") : ""}
                  autoComplete={authMode === "register" ? "new-password" : "current-password"}
                />
              </label>
              {authError && (
                <div className="identity-modal__error" role="alert">
                  {authError}
                </div>
              )}
              <button type="submit" className="identity-modal__submit" disabled={isAuthSubmitting || isAuthLoading}>
                <KeyRound size={17} aria-hidden="true" />
                <span>
                  {isAuthSubmitting
                    ? locale === "zh" ? "处理中" : "Working"
                    : authMode === "register"
                      ? locale === "zh" ? "注册并进入" : "Create and enter"
                      : locale === "zh" ? "登录并进入" : "Sign in"}
                </span>
              </button>
            </form>
          </div>
        </div>
      )}
      {previewImage && (
        <div className="preview-modal" role="dialog" aria-modal="true" aria-label={locale === "zh" ? "生成图放大预览" : "Expanded render preview"} onClick={() => setPreviewImage(null)}>
          <div className="preview-modal__content" onClick={(event) => event.stopPropagation()}>
            <div className="preview-modal__bar">
              <div>
                <p className="eyebrow">{locale === "zh" ? "生成图预览" : "Render preview"}</p>
                <h2>{previewImage.label || (locale === "zh" ? "生成结果" : "Render result")}</h2>
              </div>
              <div className="preview-modal__actions">
                <button type="button" onClick={() => handleCopyImage(previewImage.url, previewImage.label)}>
                  <Clipboard size={15} />
                  {locale === "zh" ? "复制图片" : "Copy image"}
                </button>
                <button type="button" onClick={() => handleOpenComparison(previewImage)} disabled={activeResultMode === "standard" ? comparisonCandidates.length < 2 : (!floorPlanPreviews[0]?.url && !activeResult?.floorPlanUrl)}>
                  <FileText size={15} />
                  {locale === "zh" ? "对比分析" : "Compare"}
                </button>
                <button type="button" onClick={() => downloadImage(previewImage.downloadUrl || previewImage.url, `${slugifyFilename(previewImage.label || "render-result")}.png`)}>
                  <Download size={15} />
                  {locale === "zh" ? "下载" : "Download"}
                </button>
                <button type="button" onClick={() => setPreviewImage(null)}>
                  {locale === "zh" ? "关闭" : "Close"}
                </button>
              </div>
            </div>
            <button type="button" className="preview-modal__image-button" onClick={() => setPreviewImage(null)} title={locale === "zh" ? "单击缩小" : "Click to shrink"}>
              <img src={previewImage.url} alt={previewImage.label || (locale === "zh" ? "生成图预览" : "Render preview")} />
            </button>
          </div>
        </div>
      )}
      {isComparisonOpen && comparisonImage && (
        <div className="comparison-modal" role="dialog" aria-modal="true" aria-label={comparisonImage.mode === "history-vs-history" ? (locale === "zh" ? "历史生成图对比" : "History image comparison") : (locale === "zh" ? "平面图与效果图对比分析" : "Floor plan and render comparison")} onClick={() => { setIsComparisonOpen(false); setComparisonImage(null); }}>
          <div className="comparison-modal__content" onClick={(event) => event.stopPropagation()}>
            <div className="comparison-modal__head">
              <div>
                <p className="eyebrow">{locale === "zh" ? "对比分析" : "Compare analysis"}</p>
                <h2>
                  {comparisonImage.mode === "history-vs-history"
                    ? locale === "zh" ? "历史生成图 A / 历史生成图 B" : "History image A / history image B"
                    : locale === "zh" ? "左侧平面图 / 右侧效果图" : "Floor plan left / render right"}
                </h2>
              </div>
              <button type="button" onClick={() => { setIsComparisonOpen(false); setComparisonImage(null); }}>{locale === "zh" ? "关闭" : "Close"}</button>
            </div>
            {comparisonImage.mode === "history-vs-history" && (
              <div className="comparison-selectors">
                <label>
                  <span>{locale === "zh" ? "左侧图片" : "Left image"}</span>
                  <select
                    value={comparisonImage.leftResultId}
                    onChange={(event) => setComparisonImage((current) => current?.mode === "history-vs-history" ? { ...current, leftResultId: event.target.value } : current)}
                  >
                    {comparisonCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.imageLabel || candidate.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{locale === "zh" ? "右侧图片" : "Right image"}</span>
                  <select
                    value={comparisonImage.rightResultId}
                    onChange={(event) => setComparisonImage((current) => current?.mode === "history-vs-history" ? { ...current, rightResultId: event.target.value } : current)}
                  >
                    {comparisonCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.imageLabel || candidate.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="comparison-grid">
              {comparisonImage.mode === "history-vs-history" ? (
                <>
                  <figure>
                    <figcaption>{comparisonLeftResult?.imageLabel || comparisonLeftResult?.title || (locale === "zh" ? "历史图 A" : "History image A")}</figcaption>
                    {comparisonLeftResult?.imageUrl && <img src={comparisonLeftResult.imageUrl} alt={comparisonLeftResult.imageLabel || comparisonLeftResult.title} />}
                  </figure>
                  <figure>
                    <figcaption>{comparisonRightResult?.imageLabel || comparisonRightResult?.title || (locale === "zh" ? "历史图 B" : "History image B")}</figcaption>
                    {comparisonRightResult?.imageUrl && <img src={comparisonRightResult.imageUrl} alt={comparisonRightResult.imageLabel || comparisonRightResult.title} />}
                  </figure>
                </>
              ) : (
                <>
                  <figure>
                    <figcaption>{locale === "zh" ? "平面图" : "Floor plan"}</figcaption>
                    <img src={comparisonImage.floorPlanUrl} alt={comparisonImage.floorPlanName || (locale === "zh" ? "平面图" : "Floor plan")} />
                  </figure>
                  <figure>
                    <figcaption>{locale === "zh" ? "效果图" : "Render"}</figcaption>
                    <img src={comparisonImage.renderUrl} alt={comparisonImage.renderLabel || (locale === "zh" ? "效果图" : "Render")} />
                  </figure>
                </>
              )}
            </div>
            {comparisonImage.mode === "floor-vs-render" && latestAnalysisText && (
              <div className="comparison-analysis">
                <strong>{locale === "zh" ? "后端分析" : "Backend analysis"}</strong>
                <pre>{latestAnalysisText}</pre>
              </div>
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast-message" role="status">{toast}</div>}
    </main>
  );
}

export default App;
