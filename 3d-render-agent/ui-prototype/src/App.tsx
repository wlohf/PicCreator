import { type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
  ImagePlus,
  KeyRound,
  Maximize2,
  MessageCircle,
  MousePointer,
  PanelRight,
  PlugZap,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X
} from "lucide-react";

import { loadConfig, saveConfig, verifyConfig } from "./api/config";
import { applyChatMemory, sendDesignChat } from "./api/chat";
import { setApiUserNamespace } from "./api/client";
import { requestGenerationStream } from "./api/generation";
import { requestAnnotatedImageEdit, requestImageEdit } from "./api/imageEdits";
import { loadShortcutPreferences, loadStyleProfile, recordPreferenceEvent, saveShortcutPreferences, type StyleProfile } from "./api/preferences";
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
import type { ApiConfig, ChatMemoryCandidate, ChatMessage, FilePreview, GenerationMode, GenerationProgress, Locale, RenderHistoryItem } from "./types/domain";
import { countGenerationRecords, hasConversationContent, hasDurableConversationContent, isCurrentConversationRun, type ConversationRunGuard } from "./utils/chatSessions";
import { apiConfigStorageKey } from "./utils/apiConfigStorage";
import { filesFromList, imageFilesFromFiles, mergeFloorPlanFiles } from "./utils/fileAttachments";
import { compactLines, localized } from "./utils/text";

const CHAT_HISTORY_STORAGE_KEY = "render-director-chat-history-v1";
const SHORTCUT_PHRASES_STORAGE_KEY = "render-director-shortcut-phrases-v1";
const USER_TOKEN_STORAGE_KEY = "render-director-user-token-v1";
const GENERATION_SLOW_NOTICE_MS = 5 * 60 * 1000;
const MAX_ITERATIONS_UPPER_BOUND = 50;
const COMPOSER_MAX_VISIBLE_HEIGHT = 232;


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
type UtilityPanel = "results" | "analysis" | "shortcuts" | "settings";

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

function shortcutPhrasesStorageKey(userId: string) {
  return `${SHORTCUT_PHRASES_STORAGE_KEY}:${userId || "default"}`;
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

const generationModeOptions: { value: GenerationMode; zh: string; en: string }[] = [
  { value: "standard", zh: "默认模式", en: "Default" },
  { value: "render3d", zh: "3D 效果图", en: "3D render" },
  { value: "colored_floor_plan", zh: "彩色平面图", en: "Colored plan" }
];

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
    const raw = window.localStorage.getItem(apiConfigStorageKey(userId));
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
    workspaceMode: "image",
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
  const generationMode = session.generationMode === "render3d" || session.generationMode === "colored_floor_plan" || session.generationMode === "standard"
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
    const raw = window.localStorage.getItem(chatHistoryStorageKey(userId));
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

function normalizeUserIdInput(value: string) {
  return value.trim().replace(/\s+/g, "-").slice(0, 48);
}

function loadStoredUserToken() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return normalizeUserIdInput(window.localStorage.getItem(USER_TOKEN_STORAGE_KEY) || "");
  } catch {
    return "";
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
    const raw = window.localStorage.getItem(shortcutPhrasesStorageKey(userId));
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
const initialUserToken = loadStoredUserToken();
const initialApiConfig = loadSavedApiConfig(initialUserToken);
function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [isRendering, setIsRendering] = useState(false);
  const [activeStep, setActiveStep] = useState("idle");
  const [selectedModel, setSelectedModel] = useState(initialApiConfig.imageModel || modelOptions[0]);
  const [maxIterationsInput, setMaxIterationsInput] = useState("5");
  const [enableQualityEvaluation, setEnableQualityEvaluation] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("image");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("standard");
  const [chatInput, setChatInput] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("new-generation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floorPlanFiles, setFloorPlanFiles] = useState<File[]>([]);
  const [liveGeneration, setLiveGeneration] = useState<LiveGenerationState | null>(null);

  const [showApiConfig, setShowApiConfig] = useState(false);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [comparisonImage, setComparisonImage] = useState<ComparisonImage | null>(null);
  const [annotationTarget, setAnnotationTarget] = useState<RenderHistoryItem | null>(null);

  const [apiConfig, setApiConfig] = useState<ApiConfig>(initialApiConfig);
  const [configStatus, setConfigStatus] = useState<ConfigStatusState | null>(null);
  const [configAction, setConfigAction] = useState<"save" | "analysis" | "image" | null>(null);
  const [learnedProfile, setLearnedProfile] = useState<StyleProfile | null>(null);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState(initialUserToken);
  const [authError, setAuthError] = useState("");
  const [userDraftId, setUserDraftId] = useState(initialUserToken);
  const [showUserDialog, setShowUserDialog] = useState(!initialUserToken);
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [activeUtilityPanel, setActiveUtilityPanel] = useState<UtilityPanel | null>(null);
  const [shortcutPhrases, setShortcutPhrases] = useState<ShortcutPhrase[]>(() => cloneDefaultShortcutPhrases());
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState({ zh: "", en: "" });
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [floorPlanPreviews, setFloorPlanPreviews] = useState<FilePreview[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [isChatResponding, setIsChatResponding] = useState(false);
  const [rememberingMessageId, setRememberingMessageId] = useState<string | null>(null);
  const [isSubmittingAnnotation, setIsSubmittingAnnotation] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const previousGenerationModeRef = useRef<GenerationMode>("standard");
  const currentUserIdRef = useRef(currentUserId);
  const conversationEpochRef = useRef(0);

  const t = copy[locale];
  const isImageWorkspace = workspaceMode === "image";
  const isChatWorkspace = workspaceMode === "chat";
  const currentGenerationModeOption = generationModeOptions.find((option) => option.value === generationMode) ?? generationModeOptions[0];
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
    settings: locale === "zh" ? "生成设置" : "Generation settings"
  };

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
    setActiveStep(session.messages.length > 0 ? "completed" : "idle");
    setGenerationStartedAt(null);
    setGenerationElapsedMs(0);
    setIsRendering(false);
  }

  function resetVisibleConversationState() {
    setMessages([]);
    setChatInput("");
    setWorkspaceMode("image");
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
    setActiveResultId(null);
    resetVisibleConversationState();
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
    return [
      nextSession,
      ...list.filter((session) => session.id !== nextSession.id),
    ].slice(0, 20);
  }

  async function refreshLearnedProfile(projectId = DEFAULT_PROJECT_ID, userId = currentUserId || DEFAULT_PROJECT_ID) {
    if (!userId) {
      setLearnedProfile(null);
      return;
    }
    try {
      const profile = await loadStyleProfile(projectId, userId);
      setLearnedProfile(profile);
    } catch {
      setLearnedProfile(null);
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

  const hasUserNamespace = Boolean(currentUserId);
  const canEditSelectedResult = hasUserNamespace && isImageWorkspace && composerMode === "edit-selected-result" && Boolean(activeResult?.imageUrl) && hasPromptText;
  const canGenerateNew = !isImageWorkspace || !hasUserNamespace
    ? false
    : generationMode === "standard"
    ? hasPromptText
    : generationMode === "colored_floor_plan"
      ? floorPlanFiles.length > 0
      : floorPlanFiles.length > 0 && hasPromptText;
  const canGenerate = composerMode === "edit-selected-result" ? canEditSelectedResult : canGenerateNew;
  const canSubmitChat = hasUserNamespace && isChatWorkspace && hasPromptText && !isChatResponding && !isRendering;
  const canSubmitComposer = isChatWorkspace ? canSubmitChat : canGenerate;
  const chatBlocker = isChatWorkspace && !hasUserNamespace
    ? locale === "zh"
      ? "请先输入自定义访问标识"
      : "Enter a custom access token first"
    : isChatWorkspace && !hasPromptText
    ? locale === "zh"
      ? "输入日常问题，或描述想法后再发送"
      : "Type a chat message before sending"
    : "";
  const generationBlocker = composerMode === "edit-selected-result"
    ? !hasUserNamespace
      ? locale === "zh"
        ? "请先输入自定义访问标识"
        : "Enter a custom access token first"
      : !activeResult?.imageUrl
      ? locale === "zh"
        ? "请先选择一张已有结果"
        : "Select an existing result first"
      : !hasPromptText
        ? locale === "zh"
          ? "请输入要修改的内容"
          : "Describe what to edit"
        : ""
    : !hasUserNamespace
      ? locale === "zh"
        ? "请先输入自定义访问标识"
        : "Enter a custom access token first"
    : generationMode === "standard"
      ? !hasPromptText
        ? locale === "zh"
          ? "请输入要直接发送给画图模型的提示词"
          : "Enter the prompt to send directly to the image model"
        : ""
      : floorPlanFiles.length === 0
        ? locale === "zh"
          ? "请先粘贴或拖入至少一张平面图"
          : "Paste or drop at least one floor plan first"
        : generationMode === "render3d" && !hasPromptText
          ? locale === "zh"
            ? "请填写 3D 效果图需求，或使用快捷短语补充需求"
            : "Add a 3D render brief or insert shortcut phrases before generating"
          : "";
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
      title: locale === "zh" ? "复核" : "Review",
      detail: enableQualityEvaluation
        ? locale === "zh" ? "质量评估开启" : "Quality review on"
        : locale === "zh" ? "默认跳过" : "Skipped by default"
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
            ? liveGeneration?.status || (locale === "zh" ? "图片已返回，正在评估质量" : "Image returned, evaluating quality")
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
    if (!currentUserId) {
      return;
    }
    setApiUserNamespace(currentUserId);
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
    setApiUserNamespace(currentUserId);
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
    if (!currentUserId) {
      setChatSessions([]);
      setCurrentSessionId("");
      setMessages([]);
      setChatInput("");
      setWorkspaceMode("image");
      setGenerationMode("standard");
      setComposerMode("new-generation");
      return;
    }
    const stored = loadStoredSessions(currentUserId);
    if (stored.sessions.length > 0) {
      const target = stored.sessions.find((session) => session.id === stored.currentSessionId) ?? stored.sessions[0];
      setChatSessions(stored.sessions);
      setCurrentSessionId(target.id);
      applySession(target);
      return;
    }
    const nextSession = createEmptySession();
    setChatSessions([nextSession]);
    setCurrentSessionId(nextSession.id);
    applySession(nextSession);
  }, [currentUserId]);

  useEffect(() => {
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
    if (activeUtilityPanel === "settings" && currentUserId) {
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
  }, [annotationTarget, isComparisonOpen, isSubmittingAnnotation, locale, previewImage]);

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
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (isChatWorkspace) {
        void runDailyChatFlow();
      } else {
        runConversationFlow();
      }
    }
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
    setActiveUtilityPanel((current) => current === panel ? null : panel);
  }

  function buildGenerationPrompt(userPrompt?: string) {
    const basePrompt = (userPrompt ?? chatInput).trim();
    if (generationMode === "standard") {
      return basePrompt;
    }
    return basePrompt ? (locale === "zh" ? `设计需求：${basePrompt}` : `Design brief: ${basePrompt}`) : "";
  }

  function handleSelectedModelChange(value: string) {
    setSelectedModel(value);
    setApiConfig((current) => ({ ...current, imageModel: value }));
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
    setShowApiConfig(false);
    setShowPromptConfig(false);
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

  function handleCommitUserIdentity(rawValue?: string) {
    const normalized = normalizeUserIdInput(rawValue ?? userDraftId);
    setAuthError("");
    if (!normalized) {
      setAuthError(locale === "zh" ? "请输入自定义访问标识" : "Enter a custom access token");
      return;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USER_TOKEN_STORAGE_KEY, normalized);
    }
    beginNamespaceSwitch(normalized);
    setCurrentUserId(normalized);
    setUserDraftId(normalized);
    setShowUserDialog(false);
    showToast(locale === "zh" ? `已切换到访问标识：${normalized}` : `Switched to token: ${normalized}`);
  }

  function handleClearUserToken() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(USER_TOKEN_STORAGE_KEY);
    }
    beginNamespaceSwitch("");
    setCurrentUserId("");
    setUserDraftId("");
    setShowUserDialog(true);
    showToast(locale === "zh" ? "已清除当前访问标识" : "Current access token cleared");
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
      if (activeUtilityPanel === "settings") {
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
          ? "图片已返回，质量评估已更新，正在整理最终结果。"
          : enableQualityEvaluation
            ? "图片已返回，正在等待质量评估。"
            : "图片已返回，质量评估已关闭，正在整理最终结果。"
        : hasSpatialAnalysis || hasPrompt
          ? "空间分析或提示词已返回，正在继续等待图片生成结果。"
          : "后端正在处理生成流程。";
      const enContent = hasImage
        ? hasEvaluation
          ? "Images returned and evaluation updated. Packaging the final result."
          : enableQualityEvaluation
            ? "Images returned. Waiting for quality evaluation."
            : "Images returned. Quality review is off, packaging the final result."
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
              hasEvaluation ? "评估信息已返回" : hasImage ? (enableQualityEvaluation ? "等待质量评估" : "已跳过质量评估") : ""
            ]),
            en: compactLines([
              progress.status || "",
              hasSpatialAnalysis ? "Spatial analysis completed" : "",
              hasPrompt ? "Final prompt generated" : "",
              hasImage ? "Image result returned" : "Image generation is still running",
              hasEvaluation ? "Evaluation returned" : hasImage ? (enableQualityEvaluation ? "Waiting for quality evaluation" : "Quality review skipped") : ""
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
          content: response.reply || (locale === "zh" ? "收到。" : "Got it."),
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

  async function runConversationFlow(userPrompt?: string) {
    if (isRendering) return;
    const prompt = buildGenerationPrompt(userPrompt);
    const userBrief = (userPrompt ?? chatInput).trim();
    if (!canGenerate) {
      showToast(generationBlocker || (locale === "zh" ? "请先补齐生成输入" : "Complete the generation inputs first"));
      return;
    }
    const displayedBrief = userBrief || (generationMode === "colored_floor_plan"
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
        zh: compactLines(["提交生成请求", generationMode === "standard" ? "直通模式：不解析需求" : "同步平面图", "等待后端真实返回"]),
        en: compactLines(["Submit generation request", generationMode === "standard" ? "Default mode: no requirement parsing" : "Sync floor plan", "Wait for the real backend result"])
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
        if (activeUtilityPanel === "settings") {
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
            imageLabel: historyItem.imageLabel || historyItem.title
          }
        ]);
        return;
      }

      const result = await requestGenerationStream(
        {
          projectId: DEFAULT_PROJECT_ID,
          userId: currentUserId || DEFAULT_PROJECT_ID,
          mode: generationMode,
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
        generationMode,
        floorPlanUrl: floorPlanPreviews[0]?.url,
        floorPlanName: floorPlanPreviews[0]?.name
      };
      const newHistoryItems = (backendItems.length > 0 ? backendItems : [fallbackItem]).map((item) => ({
        ...item,
        generationMode: item.generationMode || generationMode,
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
      if (activeUtilityPanel === "settings") {
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
            zh: generationMode === "standard" ? "生成完成。默认模式已按输入框文本直通出图。" : "生成完成。空间分析已整理到右侧栏，最终提示词可在这里展开查看。",
            en: generationMode === "standard" ? "Generation completed. Default mode sent the composer text directly to image generation." : "Generation completed. Spatial analysis is shown in the right panel, and the final prompt can be expanded here."
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
          imageLabel: historyItem.imageLabel || firstImage?.label
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
      message: locale === "zh" ? "正在保存到当前临时空间..." : "Saving to the current temporary space..."
    });
    try {
      window.localStorage.setItem(apiConfigStorageKey(currentUserId), JSON.stringify(apiConfig));
      const result = await saveConfig(apiConfig);
      setConfigStatus({
        tone: "good",
        message: result.message || (locale === "zh" ? "模型与 API 配置已保存到当前临时空间" : "Model and API setup saved to this temporary space")
      });
      showToast(locale === "zh" ? "配置已保存到当前临时空间" : "Configuration saved to this temporary space");
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
    window.localStorage.removeItem(apiConfigStorageKey(currentUserId));
    setConfigStatus({
      tone: "good",
      message:
        locale === "zh"
          ? "已恢复默认配置；当前临时空间会继续使用后端已保存的本地配置。"
          : "Defaults restored. This temporary space can still use backend-saved local setup."
    });
  }

  const comparisonLeftResult = comparisonImage?.mode === "history-vs-history"
    ? renderHistory.find((item) => item.id === comparisonImage.leftResultId) ?? null
    : null;
  const comparisonRightResult = comparisonImage?.mode === "history-vs-history"
    ? renderHistory.find((item) => item.id === comparisonImage.rightResultId) ?? null
    : null;

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

      <div className={`chatgpt-layout ${activeUtilityPanel ? "has-drawer" : ""}`}>
        <aside className="chatgpt-sidebar" aria-label={locale === "zh" ? "侧边栏" : "Sidebar"}>
          <div className="chatgpt-sidebar__brand">
            <div className="brand-mark">
              <Aperture size={18} />
            </div>
            <div>
              <strong>{t.appName}</strong>
              <span>{locale === "zh" ? "生成工作台" : "Generation workspace"}</span>
            </div>
          </div>

          <div className="chatgpt-sidebar__identity">
            <div>
              <span>{locale === "zh" ? "临时访问标识" : "Temporary token"}</span>
              <strong>{currentUserId || (locale === "zh" ? "未设置" : "Not set")}</strong>
              <small>
                {locale === "zh"
                  ? "仅用于本地隔离历史，不是安全登录。"
                  : "Only separates local history; this is not secure sign-in."}
              </small>
            </div>
            <button type="button" onClick={() => {
              setUserDraftId(currentUserId);
              setAuthError("");
              setShowUserDialog(true);
            }}>
              <KeyRound size={14} />
              {locale === "zh" ? "切换" : "Switch"}
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
                <button type="button" className={activeUtilityPanel === "settings" ? "is-active" : ""} onClick={() => toggleUtilityPanel("settings")}>
                  <PanelRight size={14} />
                  {locale === "zh" ? "设置" : "Settings"}
                </button>
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
                  <button type="button" onClick={() => toggleUtilityPanel("settings")}>
                    <PlugZap size={14} />
                    {locale === "zh" ? "生成设置" : "Generation settings"}
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
                        <span className={enableQualityEvaluation && ["evaluating", "completed"].includes(activeStep) ? "is-active" : !enableQualityEvaluation ? "is-muted" : ""}>{enableQualityEvaluation ? (locale === "zh" ? "评估质量" : "Evaluating") : (locale === "zh" ? "跳过质检" : "Review off")}</span>
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
                              <button type="button" className="image-zoom-trigger" onClick={() => message.imageUrl && handleExpandPreview({ url: message.imageUrl, label: message.imageLabel || t.renderPreview })} title={locale === "zh" ? "单击放大" : "Click to enlarge"}><img className="api-render-image" src={message.imageUrl} alt={message.imageLabel || t.renderPreview} /></button>
                              <div className="render-card-actions">
                                <button type="button" onClick={() => message.imageUrl && handleExpandPreview({ url: message.imageUrl, label: message.imageLabel || t.renderPreview })}>
                                  <Eye size={14} />
                                  {locale === "zh" ? "放大" : "Enlarge"}
                                </button>
                                <button type="button" onClick={() => handleCopyImage(message.imageUrl, message.imageLabel)}>
                                  <Clipboard size={14} />
                                  {locale === "zh" ? "复制图片" : "Copy image"}
                                </button>
                                <button type="button" onClick={() => message.imageUrl && handleOpenComparison({ url: message.imageUrl, label: message.imageLabel || t.renderPreview })} disabled={activeResultMode === "standard" ? comparisonCandidates.length < 2 : !floorPlanPreviews[0]?.url}>
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
                {isImageWorkspace && (
                  <button type="button" className={enableQualityEvaluation ? "is-active" : ""} onClick={() => setEnableQualityEvaluation((current) => !current)} disabled={isRendering}>
                    <CheckCircle2 size={14} />
                    {locale === "zh" ? "复核" : "Review"}
                  </button>
                )}
                <button
                  type="submit"
                  className="chatgpt-composer__send"
                  disabled={isRendering || isChatResponding || !canSubmitComposer}
                  aria-busy={isRendering || isChatResponding}
                  title={(isChatWorkspace ? chatBlocker : generationBlocker) || `${composerSubmitLabel} (Ctrl/⌘ + Enter)`}
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

              {activeUtilityPanel === "settings" && (
                <div className="chatgpt-drawer__stack">
                  <div className="control-section">
                    <div className="section-title">
                      <CheckCircle2 size={14} />
                      {locale === "zh" ? "已学习偏好" : "Learned preferences"}
                    </div>
                    {learnedProfile ? (
                      <div className="learned-profile-list">
                        {learnedProfile.preference_summary?.long_term_preferences?.length ? (
                          <div className="learned-profile-block">
                            <strong>{locale === "zh" ? "长期偏好" : "Long-term preferences"}</strong>
                            <p>{learnedProfile.preference_summary.long_term_preferences.join("；")}</p>
                          </div>
                        ) : null}
                        {learnedProfile.preference_summary?.avoid_items?.length ? (
                          <div className="learned-profile-block">
                            <strong>{locale === "zh" ? "避免项" : "Avoid items"}</strong>
                            <p>{learnedProfile.preference_summary.avoid_items.join("；")}</p>
                          </div>
                        ) : null}
                        {learnedProfile.preference_summary?.evaluation_standards?.length ? (
                          <div className="learned-profile-block">
                            <strong>{locale === "zh" ? "评判标准" : "Evaluation standards"}</strong>
                            <p>{learnedProfile.preference_summary.evaluation_standards.join("；")}</p>
                          </div>
                        ) : null}
                        {learnedProfile.preference_summary?.frequent_edit_requests?.length ? (
                          <div className="learned-profile-block">
                            <strong>{locale === "zh" ? "最近常见修改" : "Frequent recent edits"}</strong>
                            <p>{learnedProfile.preference_summary.frequent_edit_requests.join("；")}</p>
                          </div>
                        ) : null}
                        {!learnedProfile.preference_summary?.long_term_preferences?.length &&
                        !learnedProfile.preference_summary?.avoid_items?.length &&
                        !learnedProfile.preference_summary?.evaluation_standards?.length &&
                        !learnedProfile.preference_summary?.frequent_edit_requests?.length ? (
                          <p className="chatgpt-drawer__empty-note">{locale === "zh" ? "目前还没有学到稳定偏好。" : "No stable preferences learned yet."}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="chatgpt-drawer__empty-note">{locale === "zh" ? "还没有读取到偏好摘要。" : "Preference summary is not available yet."}</p>
                    )}
                  </div>

                  <div className="control-section">
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
                          {locale === "zh" ? "质量复核（可选）" : "Quality review (optional)"}
                        </div>
                        <p>
                          {enableQualityEvaluation
                            ? locale === "zh" ? "本次会在图片返回后调用视觉模型评分，并按最大迭代继续优化。" : "This run will score the image with the vision model and iterate up to the max pass count."
                            : locale === "zh" ? "默认跳过质量评估，图片返回后直接入库；需要时手动启用。" : "Skipped by default. The image is saved as soon as it returns; enable it only when needed."}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={enableQualityEvaluation ? "is-active" : ""}
                        onClick={() => setEnableQualityEvaluation((current) => !current)}
                        disabled={isRendering}
                      >
                        <CheckCircle2 size={14} />
                        {enableQualityEvaluation ? (locale === "zh" ? "本次启用" : "Enabled") : (locale === "zh" ? "启用复核" : "Enable")}
                      </button>
                    </div>
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
                        ? "留空则使用当前临时空间已保存的后端配置；点击保存配置后会写入该空间的本地配置，并同步缓存到本机浏览器。"
                        : "Leave empty to use this temporary space's saved backend setup. Save writes to that local space and also caches it in this browser."}
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
                        ? "这里单独维护分析提示词和生图提示词，避免和 API 参数混在一起。保存时写入当前临时空间的本地配置。"
                        : "Manage analysis and generation prompts separately here. Saving writes to this temporary space's local setup."}
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
        <div className="identity-modal" role="dialog" aria-modal="true" aria-label={locale === "zh" ? "用户空间" : "User space"} onClick={() => currentUserId && setShowUserDialog(false)}>
          <div className="identity-modal__content" onClick={(event) => event.stopPropagation()}>
            <div className="identity-modal__head">
              <div className="identity-modal__title-block">
                <p className="eyebrow">{locale === "zh" ? "临时隔离" : "Temporary isolation"}</p>
                <h2>{locale === "zh" ? "输入自定义访问标识" : "Enter a custom token"}</h2>
              </div>
              {currentUserId && (
                <button type="button" className="identity-modal__close" onClick={() => setShowUserDialog(false)} aria-label={locale === "zh" ? "关闭" : "Close"}>
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="identity-modal__hint">
              {locale === "zh"
                ? "相同标识会打开同一份聊天历史、结果库和偏好；全新标识会进入空白空间。这个标识只用于临时命名空间隔离，不是安全登录。"
                : "The same token opens the same chat history, result library, and preferences. A new token starts blank. This is temporary namespace isolation, not secure authentication."}
            </p>
            <form className="identity-modal__form" onSubmit={(event) => {
              event.preventDefault();
              handleCommitUserIdentity();
            }}>
              <label className="identity-modal__field">
                <span>{locale === "zh" ? "访问标识" : "Access token"}</span>
                <input
                  id="identity-username"
                  name="username"
                  value={userDraftId}
                  onChange={(event) => {
                    setUserDraftId(event.target.value);
                    setAuthError("");
                  }}
                  placeholder={locale === "zh" ? "例如：team-a 或 my-demo-token" : "e.g. team-a or my-demo-token"}
                  autoComplete="username"
                />
              </label>
              {authError && (
                <div className="identity-modal__error" role="alert">
                  {authError}
                </div>
              )}
              <button type="submit" className="identity-modal__submit">
                <KeyRound size={17} aria-hidden="true" />
                <span>
                  {locale === "zh" ? "进入这个空间" : "Open this space"}
                </span>
              </button>
              {currentUserId && (
                <button type="button" onClick={handleClearUserToken}>
                  <X size={14} aria-hidden="true" />
                  {locale === "zh" ? "清除当前标识" : "Clear current token"}
                </button>
              )}
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
