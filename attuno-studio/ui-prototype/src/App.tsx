import { type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  AudioLines,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Clock3,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  GitBranch,
  ImagePlus,
  KeyRound,
  LogOut,
  Maximize2,
  MessageCircle,
  Mic,
  MousePointer,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Search,
  Square,
  PlugZap,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X
} from "lucide-react";

import { loadAuthMe, login, logout, register, type AuthUser } from "./api/auth";
import { detectConfigModels, loadConfig, saveConfig, verifyConfig, type ConfigRole } from "./api/config";
import { applyChatMemory, isChatStreamAbortedError, streamDesignChat } from "./api/chat";
import { loadChatHistory, saveChatHistory } from "./api/chatHistory";
import { isGenerationStreamAbortedError, requestGenerationStream } from "./api/generation";
import { requestAnnotatedImageEdit, requestImageEdit } from "./api/imageEdits";
import { deleteMemoryItem, loadMemoryView, loadPromptSkillPreferences, loadShortcutPreferences, loadStyleProfile, recordPreferenceEvent, savePromptSkillPreferences, saveShortcutPreferences, updateMemoryItem, type MemoryItem, type MemorySection, type MemoryView, type PromptSkillPreference, type StyleProfile } from "./api/preferences";
import { deleteResult, listResults, normalizeApiResult } from "./api/results";
import { ConfigStatus, type ConfigStatusState } from "./components/ConfigStatus";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { ImageManagementPage } from "./components/ImageManagementPage";
import { StatusBadge } from "./components/StatusBadge";
import {
  apiFormatOptions,
  copy,
  defaultApiBaseUrl,
  defaultApiConfig,
  directionItems,
  modelOptions
} from "./data/studioData";
import type { ApiConfig, ApiProviderProfile, ChatImageAttachment, ChatMemoryCandidate, ChatMessage, ChatReasoningEffort, FilePreview, GenerationMode, GenerationProgress, Locale, RenderHistoryItem } from "./types/domain";
import { buildLinearChatContext, cloneMessagePath, countGenerationRecords, getActiveMessagePath, getBranchInfo, getMessagePathTo, hasConversationContent, hasDurableConversationContent, isCurrentConversationRun, mergeMessageTreeById, mergeMessagesIntoSessionSnapshot, normalizeMessageTree, switchMessageSibling, upsertSessionSnapshot, withActiveMessageVariant, type ConversationRunGuard } from "./utils/chatSessions";
import { apiConfigStorageKey, apiConfigStorageReadKeys } from "./utils/apiConfigStorage";
import { filesFromList, imageFilesFromClipboardItems, imageFilesFromFiles, mergeFloorPlanFiles } from "./utils/fileAttachments";
import { mergeRenderHistoryItems } from "./utils/renderHistory";
import { compactLines, localized } from "./utils/text";

const CHAT_HISTORY_STORAGE_KEY = "attuno-chat-history-v1";
const LEGACY_CHAT_HISTORY_STORAGE_KEY = "render-director-chat-history-v1";
const SHORTCUT_PHRASES_STORAGE_KEY = "attuno-shortcut-phrases-v1";
const LEGACY_SHORTCUT_PHRASES_STORAGE_KEY = "render-director-shortcut-phrases-v1";
const PROMPT_SKILLS_STORAGE_KEY = "attuno-prompt-skills-v1";
const ANALYSIS_MODEL_OPTIONS_STORAGE_KEY = "attuno-analysis-model-options-v1";
const LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY = "attuno-sidebar-width-v1";
const LEGACY_LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY = "render-director-sidebar-width-v1";
const LAYOUT_DRAWER_WIDTH_STORAGE_KEY = "attuno-drawer-width-v1";
const LEGACY_LAYOUT_DRAWER_WIDTH_STORAGE_KEY = "render-director-drawer-width-v1";
const SIDEBAR_COLLAPSED_WIDTH = 72;
const GENERATION_SLOW_NOTICE_MS = 5 * 60 * 1000;
const MAX_ITERATIONS_UPPER_BOUND = 50;
const COMPOSER_MAX_VISIBLE_HEIGHT = 232;
const SIDEBAR_WIDTH_MIN = 280;
const SIDEBAR_WIDTH_MAX = 280;
const DRAWER_WIDTH_MIN = 420;
const DRAWER_WIDTH_MAX = 500;
const DESKTOP_DRAWER_BREAKPOINT = 1100;


type ShortcutPhrase = {
  id: string;
  text: string;
};

type PromptSkill = {
  id: string;
  name: string;
  description: string;
  prompt: string;
};

type PromptSkillDraft = {
  name: string;
  description: string;
  prompt: string;
};

type PromptModeId = "builtin-standard" | "builtin-render3d" | `skill-${string}`;

type PreviewImage = {
  url: string;
  label?: string;
  downloadUrl?: string;
  sourceResultId?: string;
};

type ComposerMode = "new-generation" | "edit-selected-result";
type WorkspaceMode = "chat" | "image";
type PrimaryView = "workspace" | "image-management";
type UtilityPanel = "analysis" | "shortcuts" | "preferences" | "generation" | "setup" | "prompts";
type SettingsUtilityPanel = Extract<UtilityPanel, "preferences" | "generation" | "setup" | "analysis" | "prompts">;
type ResizablePanel = "sidebar" | "drawer";
type DetectedModelState = Record<ConfigRole, string[]>;
type ConfigAction = "save" | "analysis" | "image" | "models-analysis" | "models-image";
type RetryPopoverState = {
  messageId: string;
  model: string;
};

type MessageEditState = {
  messageId: string;
  parentId: string | null;
  draft: string;
};

const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "chat";
const settingsUtilityPanels = new Set<UtilityPanel>(["preferences", "generation", "setup", "analysis", "prompts"]);

function isSettingsPanel(panel: UtilityPanel | null): panel is SettingsUtilityPanel {
  return panel !== null && settingsUtilityPanels.has(panel);
}

type ChatSessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  activeMessageId: string | null;
  chatInput: string;
  workspaceMode: WorkspaceMode;
  generationMode: GenerationMode;
  promptModeId?: PromptModeId;
  composerMode: ComposerMode;
  activeResultId: string | null;
  pinnedAt?: string | null;
  titleLocked?: boolean;
};

type StoredChatSessions = {
  currentSessionId: string;
  sessions: ChatSessionRecord[];
  recoveredFromKey?: string;
};

type HistoryMenuPosition = {
  top: number;
  left: number;
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

function promptSkillsStorageKey(userId: string) {
  return `${PROMPT_SKILLS_STORAGE_KEY}:${userId || "default"}`;
}

function analysisModelOptionsStorageKey(userId: string) {
  return `${ANALYSIS_MODEL_OPTIONS_STORAGE_KEY}:${userId || "default"}`;
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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image attachment"));
    reader.readAsDataURL(file);
  });
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

type ImageComparisonCandidateSource = "conversation" | "library";

type ImageComparisonCandidate = {
  id: string;
  imageUrl: string;
  label: string;
  alt: string;
  source: ImageComparisonCandidateSource;
  sourceResultId?: string;
  result?: RenderHistoryItem;
};

function areSameImageComparisonCandidate(left: ImageComparisonCandidate, right: ImageComparisonCandidate) {
  return left.id === right.id ||
    (Boolean(left.sourceResultId) && left.sourceResultId === right.sourceResultId) ||
    left.imageUrl === right.imageUrl;
}

function uniqueImageComparisonCandidates(candidates: ImageComparisonCandidate[]) {
  return candidates.filter((candidate, index) => (
    candidates.findIndex((item) => areSameImageComparisonCandidate(item, candidate)) === index
  ));
}

const generationModeLabels: Record<GenerationMode, { zh: string; en: string }> = {
  standard: { zh: "默认模式", en: "Default" },
  render3d: { zh: "3D 增强", en: "3D boost" },
  colored_floor_plan: { zh: "彩色平面图", en: "Colored plan" }
};

const generationModeOptions: { value: "standard" | "render3d"; zh: string; en: string }[] = [
  { value: "standard", zh: "默认模式", en: "Default" },
  { value: "render3d", zh: "3D 提示词增强", en: "3D prompt boost" },
];

const BUILTIN_STANDARD_PROMPT_MODE_ID: PromptModeId = "builtin-standard";
const BUILTIN_RENDER3D_PROMPT_MODE_ID: PromptModeId = "builtin-render3d";
const DEFAULT_PROMPT_SKILL_DRAFT: PromptSkillDraft = {
  name: "",
  description: "",
  prompt: "",
};

const chatReasoningEffortOptions: Array<{ value: ChatReasoningEffort; zh: string; en: string }> = [
  { value: "low", zh: "低", en: "Low" },
  { value: "medium", zh: "中", en: "Medium" },
  { value: "high", zh: "高", en: "High" },
];

function parseModelListText(value: string) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/,/g, "\n")
    .split("\n")
    .map((item) => item.trim())
    .filter(isUsableModelName);
}

function isUsableModelName(value: string) {
  const model = String(value || "").trim();
  if (!model || model.length < 3) {
    return false;
  }
  const normalized = model.toLowerCase();
  if (/^your-.+-model$/.test(normalized)) {
    return false;
  }
  if (/^(?:g|gp|gpt|gpt[-.]?|gpt-\d+\.)$/.test(normalized)) {
    return false;
  }
  return /^[-._:/+a-z0-9]+$/i.test(model);
}

function modelSelectOptions(primaryModel: string, ...modelGroups: string[][]) {
  const options = [primaryModel, ...modelGroups.flat()]
    .map((item) => String(item || "").trim())
    .filter(isUsableModelName);
  return Array.from(new Set(options));
}

function removeStoredModelFragments(models: string[], hadInvalidFragments: boolean) {
  if (!hadInvalidFragments) {
    return models;
  }
  return models.filter((model) => {
    const normalized = model.toLowerCase();
    return !models.some((other) => {
      const otherNormalized = other.toLowerCase();
      return otherNormalized !== normalized &&
        otherNormalized.startsWith(normalized) &&
        /^gpt-\d+$/.test(normalized);
    });
  });
}

function loadStoredAnalysisModelOptions(userId: string) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(analysisModelOptionsStorageKey(userId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const rawModels = parsed.map((item) => String(item || "").trim()).filter(Boolean);
    const hadInvalidFragments = rawModels.some((item) => !isUsableModelName(item));
    return removeStoredModelFragments(modelSelectOptions("", rawModels), hadInvalidFragments);
  } catch {
    return [];
  }
}

function storeAnalysisModelOptions(userId: string, models: string[]) {
  if (typeof window === "undefined" || !userId) {
    return;
  }
  window.localStorage.setItem(analysisModelOptionsStorageKey(userId), JSON.stringify(modelSelectOptions("", models)));
}

function apiFormatDisplayName(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return apiFormatOptions.find((option) => option.value === normalized)?.label || normalized;
}

function createProviderId(prefix: "analysis" | "image") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function providerProfileFromFlatConfig(config: Partial<ApiConfig>, role: "analysis" | "image", id?: string): ApiProviderProfile {
  if (role === "analysis") {
    return {
      id: id || createProviderId("analysis"),
      providerName: String(config.analysisProviderName ?? ""),
      apiFormat: String(config.analysisApiFormat ?? ""),
      baseUrl: String(config.analysisBaseUrl ?? ""),
      apiKey: String(config.analysisApiKey ?? ""),
      model: String(config.analysisModel ?? "")
    };
  }
  return {
    id: id || createProviderId("image"),
    providerName: String(config.imageProviderName ?? ""),
    apiFormat: String(config.imageApiFormat ?? ""),
    baseUrl: String(config.imageBaseUrl ?? ""),
    apiKey: String(config.imageApiKey ?? ""),
    model: String(config.imageModel ?? "")
  };
}

function normalizeProviderProfile(value: unknown, role: "analysis" | "image", fallback: ApiProviderProfile): ApiProviderProfile {
  const saved = value && typeof value === "object" ? value as Partial<ApiProviderProfile> : {};
  const candidate = {
    id: String(saved.id || fallback.id || createProviderId(role)),
    providerName: String(saved.providerName ?? fallback.providerName),
    apiFormat: String(saved.apiFormat ?? fallback.apiFormat),
    baseUrl: String(saved.baseUrl ?? fallback.baseUrl),
    apiKey: String(saved.apiKey ?? fallback.apiKey),
    model: String(saved.model ?? fallback.model)
  };
  return candidate;
}

function normalizeProviderProfiles(value: unknown, role: "analysis" | "image", flatConfig: Partial<ApiConfig>, activeId: string): ApiProviderProfile[] {
  const fallback = providerProfileFromFlatConfig(flatConfig, role, activeId || undefined);
  const rawItems = Array.isArray(value) ? value : [];
  const providers: ApiProviderProfile[] = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    const provider = normalizeProviderProfile(item, role, fallback);
    if (!provider.id || seen.has(provider.id)) {
      provider.id = createProviderId(role);
    }
    seen.add(provider.id);
    providers.push(provider);
  }
  if (providers.length === 0) {
    providers.push(fallback);
  }
  return providers;
}

function applyProviderProfile(config: ApiConfig, role: "analysis" | "image", provider: ApiProviderProfile): ApiConfig {
  if (role === "analysis") {
    return {
      ...config,
      activeAnalysisProviderId: provider.id,
      analysisProviderName: provider.providerName,
      analysisApiFormat: provider.apiFormat,
      analysisBaseUrl: provider.baseUrl,
      analysisApiKey: provider.apiKey,
      analysisModel: provider.model
    };
  }
  return {
    ...config,
    activeImageProviderId: provider.id,
    imageProviderName: provider.providerName,
    imageApiFormat: provider.apiFormat,
    imageBaseUrl: provider.baseUrl,
    imageApiKey: provider.apiKey,
    imageModel: provider.model
  };
}

function syncActiveProvider(config: ApiConfig, role: "analysis" | "image", patch: Partial<ApiProviderProfile>): ApiConfig {
  const providersKey = role === "analysis" ? "analysisProviders" : "imageProviders";
  const activeIdKey = role === "analysis" ? "activeAnalysisProviderId" : "activeImageProviderId";
  const flatProvider = providerProfileFromFlatConfig(config, role, config[activeIdKey] || undefined);
  const existingProviders = config[providersKey];
  const activeId = config[activeIdKey] || existingProviders[0]?.id || flatProvider.id;
  const providers = existingProviders.length ? existingProviders : [flatProvider];
  let found = false;
  const nextProviders = providers.map((provider) => {
    if (provider.id !== activeId) {
      return provider;
    }
    found = true;
    return { ...provider, ...patch, id: provider.id };
  });
  if (!found) {
    nextProviders.unshift({ ...flatProvider, ...patch, id: activeId });
  }
  const nextConfig = {
    ...config,
    [providersKey]: nextProviders,
    [activeIdKey]: activeId
  } as ApiConfig;
  return applyProviderProfile(nextConfig, role, nextProviders.find((provider) => provider.id === activeId) || nextProviders[0]);
}

function normalizeApiConfig(value: unknown): ApiConfig {
  if (!value || typeof value !== "object") {
    return defaultApiConfig;
  }
  const saved = value as Partial<ApiConfig>;
  const flatConfig: ApiConfig = {
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
  const activeAnalysisProviderId = String(saved.activeAnalysisProviderId || "");
  const analysisProviders = normalizeProviderProfiles(saved.analysisProviders, "analysis", flatConfig, activeAnalysisProviderId);
  const activeImageProviderId = String(saved.activeImageProviderId || "");
  const imageProviders = normalizeProviderProfiles(saved.imageProviders, "image", flatConfig, activeImageProviderId);
  const analysisProvider = analysisProviders.find((provider) => provider.id === activeAnalysisProviderId) || analysisProviders[0];
  const imageProvider = imageProviders.find((provider) => provider.id === activeImageProviderId) || imageProviders[0];
  return applyProviderProfile(
    applyProviderProfile({
      ...flatConfig,
      analysisProviders,
      activeAnalysisProviderId: analysisProvider.id,
      imageProviders,
      activeImageProviderId: imageProvider.id
    }, "analysis", analysisProvider),
    "image",
    imageProvider
  );
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

function buildMessageClipboardText(message: ChatMessage, locale: Locale) {
  const activeMessage = withActiveMessageVariant(message);
  const parts = [
    localized(activeMessage.content, locale),
    (activeMessage.bullets?.[locale] ?? []).join("\n"),
    activeMessage.promptText ? `${locale === "zh" ? "最终提示词" : "Final prompt"}:\n${activeMessage.promptText}` : ""
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return parts.join("\n\n");
}

function promptSkillStorageShape(skill: PromptSkill): PromptSkillPreference {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    prompt: skill.prompt,
  };
}

function buildRetryApiConfig(config: ApiConfig, model: string): ApiConfig {
  const trimmedModel = model.trim();
  if (!trimmedModel || trimmedModel === config.analysisModel) {
    return config;
  }
  return {
    ...config,
    analysisModel: trimmedModel,
    analysisProviders: config.analysisProviders.map((provider) => (
      provider.id === config.activeAnalysisProviderId
        ? { ...provider, model: trimmedModel }
        : provider
    )),
  };
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let matchIndex = 0;
  for (const match of text.matchAll(boldPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    nodes.push(<strong key={`${keyPrefix}-strong-${matchIndex}`}>{match[1]}</strong>);
    lastIndex = index + match[0].length;
    matchIndex += 1;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length ? nodes : [text];
}

function parseOrderedListParagraph(text: string) {
  const matches = Array.from(text.matchAll(/(?:^|\s)(\d+)\.\s+/g));
  if (!matches.length) return null;
  const firstNumber = Number(matches[0][1]);
  if (!Number.isFinite(firstNumber)) return null;

  const intro = text.slice(0, matches[0].index ?? 0).trim();
  const looksIntentional = matches.length > 1 || text.trim().startsWith(`${matches[0][1]}.`) || /[:：]$/.test(intro);
  if (!looksIntentional) return null;

  const items = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    return text.slice(start, end).trim();
  }).filter(Boolean);
  return items.length ? { intro, start: firstNumber, items } : null;
}

function MessageContent({ content, locale }: { content: ChatMessage["content"]; locale: Locale }) {
  const text = localized(content, locale);
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (!paragraphs.length) return null;

  return (
    <div className="message-markdown">
      {paragraphs.map((paragraph, paragraphIndex) => {
        const orderedList = parseOrderedListParagraph(paragraph);
        if (orderedList) {
          return (
            <div className="message-markdown__block" key={`paragraph-${paragraphIndex}`}>
              {orderedList.intro && (
                <p>{renderInlineMarkdown(orderedList.intro, `paragraph-${paragraphIndex}-intro`)}</p>
              )}
              <ol start={orderedList.start}>
                {orderedList.items.map((item, itemIndex) => (
                  <li key={`${itemIndex}-${item.slice(0, 24)}`}>
                    {renderInlineMarkdown(item, `paragraph-${paragraphIndex}-item-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            </div>
          );
        }
        return (
          <p key={`paragraph-${paragraphIndex}`}>
            {renderInlineMarkdown(paragraph, `paragraph-${paragraphIndex}`)}
          </p>
        );
      })}
    </div>
  );
}

function buildSessionTitle(messages: ChatMessage[], chatInput: string, generationMode: GenerationMode, workspaceMode: WorkspaceMode) {
  const firstUserText = getActiveMessagePath(messages, messages[messages.length - 1]?.id ?? null)
    .find((message) => message.role === "user" && message.kind === "text");
  const raw = firstUserText ? extractContentText(withActiveMessageVariant(firstUserText).content) : chatInput;
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized) {
    return normalized.length > 22 ? `${normalized.slice(0, 22)}...` : normalized;
  }
  if (workspaceMode === "chat") return "日常对话";
  if (generationMode === "render3d") return "3D 效果图";
  if (generationMode === "colored_floor_plan") return "彩色平面图";
  return "新对话";
}

function promptModeIdForGenerationMode(generationMode: GenerationMode): PromptModeId {
  return generationMode === "render3d" ? "builtin-render3d" : "builtin-standard";
}

function generationModeForPromptMode(promptModeId: PromptModeId): GenerationMode {
  return promptModeId === "builtin-render3d" ? "render3d" : "standard";
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
    activeMessageId: null,
    chatInput: "",
    workspaceMode: DEFAULT_WORKSPACE_MODE,
    generationMode: "standard",
    promptModeId: BUILTIN_STANDARD_PROMPT_MODE_ID,
    composerMode: "new-generation",
    activeResultId: null,
    pinnedAt: null,
    titleLocked: false,
  };
}

function normalizeStoredSession(value: unknown, fallbackId = ""): ChatSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<ChatSessionRecord>;
  const id = String(session.id || fallbackId).trim();
  if (!id) return null;
  const rawMessages = Array.isArray(session.messages) ? session.messages as ChatMessage[] : [];
  const normalizedTree = normalizeMessageTree(rawMessages, session.activeMessageId ? String(session.activeMessageId) : null);
  const messages = normalizedTree.messages;
  const generationMode = session.generationMode === "render3d" || session.generationMode === "standard"
    ? session.generationMode
    : "standard";
  const rawPromptModeId = String(session.promptModeId || "").trim();
  const promptModeId = rawPromptModeId === BUILTIN_STANDARD_PROMPT_MODE_ID ||
    rawPromptModeId === BUILTIN_RENDER3D_PROMPT_MODE_ID ||
    rawPromptModeId.startsWith("skill-")
    ? rawPromptModeId as PromptModeId
    : promptModeIdForGenerationMode(generationMode);
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
    activeMessageId: normalizedTree.activeMessageId,
    chatInput: String(session.chatInput || ""),
    workspaceMode,
    generationMode,
    promptModeId,
    composerMode,
    activeResultId: session.activeResultId ? String(session.activeResultId) : null,
    pinnedAt: typeof session.pinnedAt === "string" ? session.pinnedAt : null,
    titleLocked: Boolean(session.titleLocked),
  };
}

function parseStoredSessions(raw: string | null, fallbackIdPrefix: string): StoredChatSessions {
  if (!raw) {
    return { currentSessionId: "", sessions: [] };
  }
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    const sessions = parsed.some((item) => item && typeof item === "object" && Array.isArray((item as Partial<ChatSessionRecord>).messages))
      ? parsed
        .map((item, index) => normalizeStoredSession(item, `${fallbackIdPrefix}-${index}`))
        .filter((item): item is ChatSessionRecord => Boolean(item))
      : [normalizeStoredSession({ messages: parsed }, fallbackIdPrefix)].filter((item): item is ChatSessionRecord => Boolean(item));
    return {
      currentSessionId: sessions[0]?.id || "",
      sessions,
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { currentSessionId: "", sessions: [] };
  }
  const stored = parsed as { currentSessionId?: string; sessions?: unknown[]; messages?: unknown[] };
  if (Array.isArray(stored.sessions)) {
    const sessions = stored.sessions
      .map((item, index) => normalizeStoredSession(item, `${fallbackIdPrefix}-${index}`))
      .filter((item): item is ChatSessionRecord => Boolean(item));
    return {
      currentSessionId: String(stored.currentSessionId || sessions[0]?.id || ""),
      sessions,
    };
  }
  if (Array.isArray(stored.messages)) {
    const session = normalizeStoredSession(stored, fallbackIdPrefix);
    return {
      currentSessionId: session?.id || "",
      sessions: session ? [session] : [],
    };
  }
  const session = normalizeStoredSession(stored, fallbackIdPrefix);
  return {
    currentSessionId: session?.id || "",
    sessions: session ? [session] : [],
  };
}

function hasRecoverableStoredSessions(sessions: ChatSessionRecord[]) {
  return sessions.some((session) => hasDurableConversationContent(session.messages) || Boolean(session.chatInput.trim()));
}

function chatHistoryCandidateKeys(userId: string) {
  const preferredKeys = [
    chatHistoryStorageKey(userId),
    legacyChatHistoryStorageKey(userId),
    chatHistoryStorageKey("default"),
    legacyChatHistoryStorageKey("default"),
    CHAT_HISTORY_STORAGE_KEY,
    LEGACY_CHAT_HISTORY_STORAGE_KEY,
  ];
  if (typeof window === "undefined") {
    return preferredKeys;
  }
  const seen = new Set<string>();
  const keys: string[] = [];
  const addKey = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  preferredKeys.forEach(addKey);
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (key.startsWith(`${CHAT_HISTORY_STORAGE_KEY}:`) || key.startsWith(`${LEGACY_CHAT_HISTORY_STORAGE_KEY}:`)) {
      addKey(key);
    }
  }
  return keys;
}

function loadStoredSessions(userId: string): StoredChatSessions {
  if (typeof window === "undefined") {
    return { currentSessionId: "", sessions: [] };
  }
  const primaryKey = chatHistoryStorageKey(userId);
  let firstStored: StoredChatSessions | null = null;
  try {
    for (const key of chatHistoryCandidateKeys(userId)) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      const stored = parseStoredSessions(raw, `restored-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
      if (!firstStored && stored.sessions.length > 0) {
        firstStored = stored;
      }
      if (hasRecoverableStoredSessions(stored.sessions)) {
        if (key !== primaryKey) {
          window.localStorage.setItem(primaryKey, JSON.stringify({
            currentSessionId: stored.currentSessionId,
            sessions: stored.sessions,
          }));
        }
        return {
          ...stored,
          recoveredFromKey: key !== primaryKey ? key : undefined,
        };
      }
    }
    return firstStored || { currentSessionId: "", sessions: [] };
  } catch {
    return firstStored || { currentSessionId: "", sessions: [] };
  }
}

function sessionFromHistoryResult(item: RenderHistoryItem): ChatSessionRecord {
  const createdAt = item.createdAt || new Date().toISOString();
  const generationMode = item.generationMode || "standard";
  const prompt = item.prompt || item.editInstruction || item.title || "";
  const messages: ChatMessage[] = [
    {
      id: `recovered-user-${item.id}`,
      parentId: null,
      role: "user",
      kind: "text",
      content: prompt || item.title || "历史生成记录",
    },
    {
      id: `recovered-render-${item.id}`,
      parentId: `recovered-user-${item.id}`,
      role: "assistant",
      kind: "render",
      content: {
        zh: compactLines([
          item.generationType === "edit" ? "已从图片管理恢复一条历史改图记录。" : "已从图片管理恢复一条历史生成记录。",
          item.status || "",
          item.modelUsed ? `模型：${item.modelUsed}` : "",
        ]).join("\n"),
        en: compactLines([
          item.generationType === "edit" ? "Recovered a historical image edit from image management." : "Recovered a historical image generation from image management.",
          item.status || "",
          item.modelUsed ? `Model: ${item.modelUsed}` : "",
        ]).join("\n"),
      },
      promptText: item.prompt,
      imageUrl: item.imageUrl,
      imageLabel: item.imageLabel || item.title,
      sourceResultId: item.id,
    },
  ];
  return {
    id: `result-session-${item.id}`,
    title: buildSessionTitle(messages, prompt, generationMode, "image"),
    createdAt,
    updatedAt: createdAt,
    messages,
    activeMessageId: messages[messages.length - 1]?.id ?? null,
    chatInput: "",
    workspaceMode: "image",
    generationMode,
    composerMode: "new-generation",
    activeResultId: item.id,
  };
}

function sessionsFromHistoryResults(items: RenderHistoryItem[]): ChatSessionRecord[] {
  return items
    .filter((item) => item.imageUrl || item.prompt || item.title)
    .slice()
    .sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""))
    .slice(0, 20)
    .map(sessionFromHistoryResult);
}

function sessionSearchText(session: ChatSessionRecord) {
  const messageText = getActiveMessagePath(session.messages, session.activeMessageId)
    .map((message) => {
      const activeMessage = withActiveMessageVariant(message);
      return [
        localized(activeMessage.content, "zh"),
        localized(activeMessage.content, "en"),
        activeMessage.bullets ? [...(activeMessage.bullets.zh ?? []), ...(activeMessage.bullets.en ?? [])].join(" ") : "",
        activeMessage.promptText || "",
        activeMessage.imageLabel || "",
      ].join(" ");
    })
    .join(" ");
  return [
    session.title,
    session.chatInput,
    messageText,
  ].join(" ").toLowerCase();
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
  text: item.zh || item.en
}));
const QUICK_PHRASE_VISIBLE_LIMIT = 10;

function cloneDefaultShortcutPhrases() {
  return render3DShortcutPhrases.map((item) => ({ ...item }));
}

function normalizeShortcutPhrase(value: unknown): ShortcutPhrase | null {
  if (!value || typeof value !== "object") return null;
  const phrase = value as Partial<ShortcutPhrase> & { zh?: string; en?: string };
  const id = String(phrase.id || "").trim();
  const text = String(phrase.text || phrase.zh || phrase.en || "").trim();
  if (!id || !text) return null;
  return {
    id,
    text,
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

function normalizePromptSkill(value: unknown): PromptSkill | null {
  if (!value || typeof value !== "object") return null;
  const skill = value as Partial<PromptSkillPreference>;
  const id = String(skill.id || "").trim();
  const name = String(skill.name || "").trim();
  const prompt = String(skill.prompt || skill.template || "").trim();
  const description = String(skill.description || "").trim();
  if (!id || id.startsWith("builtin-") || !name || !prompt) return null;
  return {
    id,
    name,
    description,
    prompt,
  };
}

function normalizePromptSkills(value: unknown): PromptSkill[] {
  const rawItems = Array.isArray(value) ? value : [];
  const normalized: PromptSkill[] = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    const skill = normalizePromptSkill(item);
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    normalized.push(skill);
  }
  return normalized.slice(0, 20);
}

function loadStoredPromptSkills(userId: string): PromptSkill[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(promptSkillsStorageKey(userId));
    return raw ? normalizePromptSkills(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function applyPromptSkillTemplate(template: string, userPrompt: string) {
  const prompt = userPrompt.trim();
  const normalizedTemplate = template.trim();
  if (!normalizedTemplate) return prompt;
  if (/\{\{\s*prompt\s*\}\}/i.test(normalizedTemplate)) {
    return normalizedTemplate.replace(/\{\{\s*prompt\s*\}\}/gi, prompt);
  }
  if (/\{\s*prompt\s*\}/i.test(normalizedTemplate)) {
    return normalizedTemplate.replace(/\{\s*prompt\s*\}/gi, prompt);
  }
  return prompt ? `${normalizedTemplate}\n\n用户输入：${prompt}` : normalizedTemplate;
}

const DEFAULT_PROJECT_ID = "default";
const initialApiConfig = loadSavedApiConfig("");
function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [isRendering, setIsRendering] = useState(false);
  const [renderingSessionId, setRenderingSessionId] = useState("");
  const [activeStep, setActiveStep] = useState("idle");
  const [renderingStep, setRenderingStep] = useState("idle");
  const [selectedModel, setSelectedModel] = useState(initialApiConfig.imageModel || modelOptions[0]);
  const [maxIterationsInput, setMaxIterationsInput] = useState("5");
  const [enableQualityEvaluation, setEnableQualityEvaluation] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(DEFAULT_WORKSPACE_MODE);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("standard");
  const [chatInput, setChatInput] = useState("");
  const [chatReasoningEffort, setChatReasoningEffort] = useState<ChatReasoningEffort>("medium");
  const [composerMode, setComposerMode] = useState<ComposerMode>("new-generation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [floorPlanFiles, setFloorPlanFiles] = useState<File[]>([]);
  const [liveGeneration, setLiveGeneration] = useState<LiveGenerationState | null>(null);

  const [showApiConfig, setShowApiConfig] = useState(true);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [comparisonImage, setComparisonImage] = useState<ComparisonImage | null>(null);
  const [annotationTarget, setAnnotationTarget] = useState<RenderHistoryItem | null>(null);

  const [apiConfig, setApiConfig] = useState<ApiConfig>(initialApiConfig);
  const [configStatus, setConfigStatus] = useState<ConfigStatusState | null>(null);
  const [configAction, setConfigAction] = useState<ConfigAction | null>(null);
  const [detectedModels, setDetectedModels] = useState<DetectedModelState>({ analysis: [], image: [] });
  const [addedDetectedModels, setAddedDetectedModels] = useState<DetectedModelState>({ analysis: [], image: [] });
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<ConfigRole, boolean>>({ analysis: false, image: false });
  const [learnedProfile, setLearnedProfile] = useState<StyleProfile | null>(null);
  const [memoryView, setMemoryView] = useState<MemoryView | null>(null);
  const [editingMemoryItemId, setEditingMemoryItemId] = useState<string | null>(null);
  const [memoryDraftText, setMemoryDraftText] = useState("");
  const [memoryActionId, setMemoryActionId] = useState<string | null>(null);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [activePrimaryView, setActivePrimaryView] = useState<PrimaryView>("workspace");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isChatHistoryOpen, setIsChatHistoryOpen] = useState(true);
  const [chatHistoryQuery, setChatHistoryQuery] = useState("");
  const [activeHistoryMenuId, setActiveHistoryMenuId] = useState<string | null>(null);
  const [historyMenuPosition, setHistoryMenuPosition] = useState<HistoryMenuPosition | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isRefreshingResults, setIsRefreshingResults] = useState(false);
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
  const [shortcutPhrases, setShortcutPhrases] = useState<ShortcutPhrase[]>(() => cloneDefaultShortcutPhrases());
  const [isQuickPhraseCardOpen, setIsQuickPhraseCardOpen] = useState(false);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState({ text: "" });
  const [promptSkills, setPromptSkills] = useState<PromptSkill[]>([]);
  const [selectedPromptModeId, setSelectedPromptModeId] = useState<PromptModeId>(BUILTIN_STANDARD_PROMPT_MODE_ID);
  const [editingPromptSkillId, setEditingPromptSkillId] = useState<string | null>(null);
  const [promptSkillDraft, setPromptSkillDraft] = useState<PromptSkillDraft>(DEFAULT_PROMPT_SKILL_DRAFT);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [showPromptConfig, setShowPromptConfig] = useState(true);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [floorPlanPreviews, setFloorPlanPreviews] = useState<FilePreview[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [chatRespondingSessionIds, setChatRespondingSessionIds] = useState<string[]>([]);
  const [retryPopover, setRetryPopover] = useState<RetryPopoverState | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessageEditState | null>(null);
  const [rememberingMessageId, setRememberingMessageId] = useState<string | null>(null);
  const [isSubmittingAnnotation, setIsSubmittingAnnotation] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadStoredPanelWidth([LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY, LEGACY_LAYOUT_SIDEBAR_WIDTH_STORAGE_KEY], 280, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX));
  const [drawerWidth, setDrawerWidth] = useState(() => loadStoredPanelWidth([LAYOUT_DRAWER_WIDTH_STORAGE_KEY, LEGACY_LAYOUT_DRAWER_WIDTH_STORAGE_KEY], 448, DRAWER_WIDTH_MIN, DRAWER_WIDTH_MAX));
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatThreadRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const activeResizeRef = useRef<{ panel: ResizablePanel; startX: number; startWidth: number } | null>(null);
  const previousGenerationModeRef = useRef<GenerationMode>("standard");
  const currentUserIdRef = useRef(currentUserId);
  const currentSessionIdRef = useRef(currentSessionId);
  const conversationEpochRef = useRef(0);
  const isBootstrappingSessionRef = useRef(false);
  const lastSavedChatHistoryRef = useRef("");
  const chatAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const generationAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const t = copy[locale];
  const isImageWorkspace = workspaceMode === "image";
  const isChatWorkspace = workspaceMode === "chat";
  const isImageManagementView = activePrimaryView === "image-management";
  const currentGenerationModeOption = generationModeLabels[generationMode] ?? generationModeLabels.standard;
  const currentGenerationModeLabel = locale === "zh" ? currentGenerationModeOption.zh : currentGenerationModeOption.en;
  const currentWorkspaceLabel = isChatWorkspace
    ? locale === "zh" ? "日常对话" : "Daily chat"
    : currentGenerationModeLabel;
  const normalizedHistoryQuery = chatHistoryQuery.trim().toLowerCase();
  const sidebarHistoryItems = currentUserId
    ? chatSessions
      .filter((session) => hasDurableConversationContent(session.messages))
      .filter((session) => !normalizedHistoryQuery || sessionSearchText(session).includes(normalizedHistoryQuery))
      .slice()
      .sort((left, right) => {
        const pinnedRank = Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt));
        if (pinnedRank !== 0) return pinnedRank;
        if (left.pinnedAt || right.pinnedAt) {
          return String(right.pinnedAt || "").localeCompare(String(left.pinnedAt || ""));
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, 12)
    : [];
  const sidebarHistoryTotal = currentUserId
    ? chatSessions.filter((session) => hasDurableConversationContent(session.messages)).length
    : 0;
  const activeResult = useMemo(
    () => renderHistory.find((item) => item.id === activeResultId) ?? renderHistory[0] ?? null,
    [activeResultId, renderHistory]
  );
  const activePathMessages = getActiveMessagePath(messages, activeMessageId);
  const conversationComparisonCandidates = useMemo<ImageComparisonCandidate[]>(() => {
    const seen = new Set<string>();
    return activePathMessages.reduce<ImageComparisonCandidate[]>((items, message) => {
      const activeMessage = withActiveMessageVariant(message);
      if (activeMessage.kind !== "render" || !activeMessage.imageUrl) {
        return items;
      }
      const result = activeMessage.sourceResultId
        ? renderHistory.find((historyItem) => historyItem.id === activeMessage.sourceResultId)
        : undefined;
      const id = activeMessage.sourceResultId || activeMessage.id;
      if (seen.has(id)) {
        return items;
      }
      seen.add(id);
      const index = items.length + 1;
      const baseLabel = (activeMessage.imageLabel || result?.imageLabel || result?.title || "").trim();
      const labelPrefix = locale === "zh" ? `当前对话 图 ${index}` : `Current chat image ${index}`;
      const modeLabel = result?.generationMode ? generationModeLabels[result.generationMode][locale] : "";
      const labelParts = [labelPrefix, baseLabel, modeLabel].filter(Boolean);
      items.push({
        id,
        imageUrl: activeMessage.imageUrl,
        label: labelParts.join(" · "),
        alt: baseLabel || labelPrefix,
        source: "conversation",
        sourceResultId: activeMessage.sourceResultId,
        result,
      });
      return items;
    }, []);
  }, [activePathMessages, locale, renderHistory]);
  const maxIterations = normalizeMaxIterations(Number(maxIterationsInput));
  const activePrompt = activeResult?.prompt || (chatInput.trim() ? buildGenerationPrompt() : "");
  const hasPromptText = Boolean(chatInput.trim());
  const isStructuredGenerationMode = generationMode !== "standard";
  const comparisonCandidates = useMemo<ImageComparisonCandidate[]>(() => {
    const seen = new Set<string>();
    const seenImageUrls = new Set<string>();
    const combined: ImageComparisonCandidate[] = [];
    conversationComparisonCandidates.forEach((candidate) => {
      seen.add(candidate.sourceResultId || candidate.id);
      seenImageUrls.add(candidate.imageUrl);
      combined.push(candidate);
    });
    renderHistory.forEach((item, index) => {
      if (!item.imageUrl || seen.has(item.id) || seenImageUrls.has(item.imageUrl)) {
        return;
      }
      seen.add(item.id);
      seenImageUrls.add(item.imageUrl);
      const baseLabel = (item.imageLabel || item.title || "").trim();
      const labelPrefix = locale === "zh" ? `图片库 图 ${index + 1}` : `Library image ${index + 1}`;
      const modeLabel = item.generationMode ? generationModeLabels[item.generationMode][locale] : "";
      const labelParts = [labelPrefix, baseLabel, modeLabel].filter(Boolean);
      combined.push({
        id: item.id,
        imageUrl: item.imageUrl,
        label: labelParts.join(" · "),
        alt: baseLabel || labelPrefix,
        source: "library",
        sourceResultId: item.id,
        result: item,
      });
    });
    return combined;
  }, [conversationComparisonCandidates, locale, renderHistory]);
  const activeResultMode = activeResult?.generationMode || generationMode;
  const comparableImageCount = uniqueImageComparisonCandidates(comparisonCandidates).length;
  const canCompareActiveResult = comparableImageCount >= 2 || (
    activeResultMode !== "standard" && Boolean(activeResult?.imageUrl) && Boolean(activeResult?.floorPlanUrl || floorPlanPreviews[0]?.url)
  );
  const conversationGenerationRecordCount = countGenerationRecords(activePathMessages);
  const isVisibleRendering = isRendering && renderingSessionId === currentSessionId;
  const isVisibleChatResponding = chatRespondingSessionIds.includes(currentSessionId);
  const isVisibleConversationBusy = isVisibleRendering || isVisibleChatResponding;
  const isConversationBusy = isRendering || isVisibleChatResponding;
  const visibleLiveGeneration = isVisibleRendering ? liveGeneration : null;
  const visibleActiveStep = isVisibleRendering ? renderingStep : activeStep;
  const hasWorkspaceContent = hasPromptText || floorPlanFiles.length > 0 || activePathMessages.length > 0 || workspaceMode !== "image";
  const canStartNewConversation = currentConversationHasContent();
  const onboardingSteps = [
    {
      done: floorPlanFiles.length > 0,
      label: locale === "zh" ? "添加图片" : "Add image",
      detail: locale === "zh" ? (floorPlanFiles.length ? `已选择 ${floorPlanFiles.length} 张` : "可粘贴或拖拽参考图/平面图到工作台") : (floorPlanFiles.length ? `${floorPlanFiles.length} selected` : "Paste or drag reference images or floor plans into the workspace")
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
  const progressPromptText = visibleLiveGeneration?.prompt || "";
  const utilityPanelTitles: Record<UtilityPanel, string> = {
    analysis: locale === "zh" ? "高级功能" : "Advanced",
    shortcuts: locale === "zh" ? "管理快捷短语" : "Manage quick phrases",
    preferences: locale === "zh" ? "记忆与偏好" : "Memory & preferences",
    generation: locale === "zh" ? "生成控制" : "Generation controls",
    setup: locale === "zh" ? "模型与 API 设置" : "Model & API setup",
    prompts: locale === "zh" ? "提示词设置" : "Prompt settings"
  };
  const settingsPanelDescriptions: Record<UtilityPanel, string> = {
    analysis: locale === "zh" ? "严格复核、运行阶段和平面图分析集中在这里。" : "Strict review, run stages, and floor-plan analysis live here.",
    shortcuts: locale === "zh" ? "维护会插入到主输入框的快捷短语。" : "Manage phrases that insert into the main composer.",
    preferences: locale === "zh" ? "查看、编辑或删除聊天记忆和生图偏好。" : "Review, edit, or delete chat memory and image preferences.",
    generation: locale === "zh" ? "调整下一次出图使用的模型、备用模型和轮数。" : "Tune the model, fallbacks, and pass count for the next image run.",
    setup: locale === "zh" ? "保存供应商、地址、密钥与默认模型。" : "Save providers, endpoints, keys, and default models.",
    prompts: locale === "zh" ? "管理自定义图像模式，或覆盖分析与 3D 提示词。" : "Manage custom image modes or override analysis and 3D prompts."
  };
  const settingsPanelItems: Array<{
    panel: SettingsUtilityPanel;
    icon: typeof CheckCircle2;
    title: string;
    description: string;
  }> = [
    {
      panel: "preferences" as const,
      icon: CheckCircle2,
      title: locale === "zh" ? "记忆与偏好" : "Memory",
      description: settingsPanelDescriptions.preferences
    },
    {
      panel: "generation" as const,
      icon: Box,
      title: locale === "zh" ? "生成控制" : "Generation",
      description: settingsPanelDescriptions.generation
    },
    {
      panel: "setup" as const,
      icon: PlugZap,
      title: locale === "zh" ? "模型与 API" : "Model & API",
      description: settingsPanelDescriptions.setup
    },
    {
      panel: "analysis" as const,
      icon: Clock3,
      title: locale === "zh" ? "高级功能" : "Advanced",
      description: settingsPanelDescriptions.analysis
    },
    {
      panel: "prompts" as const,
      icon: FileText,
      title: locale === "zh" ? "提示词设置" : "Prompt settings",
      description: settingsPanelDescriptions.prompts
    }
  ];

  function openSettingsPanel(panel: SettingsUtilityPanel) {
    if (panel === "setup") {
      setShowApiConfig(true);
    }
    if (panel === "prompts") {
      setShowPromptConfig(true);
    }
    setIsAccountMenuOpen(false);
    setIsQuickPhraseCardOpen(false);
    setActivePrimaryView("workspace");
    setActiveUtilityPanel(panel);
  }

  function openImageManagementView() {
    setActivePrimaryView("image-management");
    setActiveUtilityPanel(null);
    setIsQuickPhraseCardOpen(false);
    setIsAccountMenuOpen(false);
    void refreshResultsFromServer(false);
  }

  function returnToWorkspaceView() {
    setActivePrimaryView("workspace");
    window.setTimeout(() => composerRef.current?.focus(), 0);
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

  function clearComposerDraft() {
    setChatInput("");
    setEditingMessage(null);
    window.setTimeout(() => syncComposerHeight(composerRef.current), 0);
  }

  async function buildChatImageAttachments(files: File[]): Promise<ChatImageAttachment[]> {
    const imageFiles = imageFilesFromFiles(files);
    const attachments = await Promise.all(
      imageFiles.map(async (file, index) => ({
        id: `chat-image-${Date.now()}-${index}-${file.name}`,
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl: await fileToDataUrl(file),
      }))
    );
    return attachments.filter((item) => item.dataUrl.startsWith("data:image/"));
  }

  function normalizeSessionForDisplay(session: ChatSessionRecord) {
    let submittedUserText = "";
    const path = getActiveMessagePath(session.messages, session.activeMessageId);
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const message = path[index];
      if (message.role !== "user") continue;
      submittedUserText = extractContentText(withActiveMessageVariant(message).content);
      if (submittedUserText) break;
    }
    if (submittedUserText && session.chatInput.trim() === submittedUserText) {
      return {
        ...session,
        chatInput: "",
      };
    }
    return session;
  }

  function sessionDisplayTitle(session: ChatSessionRecord) {
    const title = String(session.title || "").trim();
    if (title) return title;
    return buildSessionTitle(session.messages, session.chatInput, session.generationMode, session.workspaceMode);
  }

  function applySession(session: ChatSessionRecord) {
    const displayCandidate = normalizeSessionForDisplay(session);
    const normalizedTree = normalizeMessageTree(displayCandidate.messages, displayCandidate.activeMessageId);
    const displaySession = normalizeSessionForDisplay({
      ...displayCandidate,
      messages: normalizedTree.messages,
      activeMessageId: normalizedTree.activeMessageId,
    });
    setMessages(displaySession.messages);
    setActiveMessageId(displaySession.activeMessageId);
    setChatInput(displaySession.chatInput);
    setWorkspaceMode(displaySession.workspaceMode);
    setGenerationMode(displaySession.generationMode);
    setSelectedPromptModeId(displaySession.promptModeId || promptModeIdForGenerationMode(displaySession.generationMode));
    setComposerMode(displaySession.composerMode);
    setActiveResultId(displaySession.activeResultId);
    setFloorPlanFiles([]);
    setPreviewImage(null);
    setComparisonImage(null);
    setIsComparisonOpen(false);
    setAnnotationTarget(null);
    setActiveUtilityPanel(null);
    setIsQuickPhraseCardOpen(false);
    setIsAccountMenuOpen(false);
    setActiveHistoryMenuId(null);
    setHistoryMenuPosition(null);
    setRenamingSessionId(null);
    setEditingMessage(null);
    setActivePrimaryView("workspace");
    setActiveStep(getActiveMessagePath(displaySession.messages, displaySession.activeMessageId).length > 0 ? "completed" : "idle");
    if (!isRendering) {
      setLiveGeneration(null);
      setGenerationStartedAt(null);
      setGenerationElapsedMs(0);
    }
  }

  function resetVisibleConversationState() {
    setMessages([]);
    setActiveMessageId(null);
    setChatInput("");
    setWorkspaceMode(DEFAULT_WORKSPACE_MODE);
    setGenerationMode("standard");
    setSelectedPromptModeId(BUILTIN_STANDARD_PROMPT_MODE_ID);
    setComposerMode("new-generation");
    setFloorPlanFiles([]);
    setLiveGeneration(null);
    setPreviewImage(null);
    setComparisonImage(null);
    setIsComparisonOpen(false);
    setAnnotationTarget(null);
    setActiveUtilityPanel(null);
    setIsAccountMenuOpen(false);
    setActiveHistoryMenuId(null);
    setHistoryMenuPosition(null);
    setRenamingSessionId(null);
    setActivePrimaryView("workspace");
    setActiveStep("idle");
    setRenderingStep("idle");
    setGenerationStartedAt(null);
    setGenerationElapsedMs(0);
    setIsRendering(false);
    setRenderingSessionId("");
    clearChatRespondingSessions();
    setRetryPopover(null);
    setEditingMessage(null);
    setRememberingMessageId(null);
    setIsSubmittingAnnotation(false);
  }

  function addChatRespondingSession(sessionId: string) {
    if (!sessionId) return;
    setChatRespondingSessionIds((current) => current.includes(sessionId) ? current : [...current, sessionId]);
  }

  function removeChatRespondingSession(sessionId: string) {
    if (!sessionId) return;
    setChatRespondingSessionIds((current) => current.filter((id) => id !== sessionId));
  }

  function clearChatRespondingSessions() {
    chatAbortControllersRef.current.forEach((controller) => controller.abort());
    chatAbortControllersRef.current.clear();
    generationAbortControllersRef.current.forEach((controller) => controller.abort());
    generationAbortControllersRef.current.clear();
    setChatRespondingSessionIds([]);
  }

  function selectCurrentSession(sessionId: string) {
    currentSessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
  }

  function beginNamespaceSwitch(nextUserId: string) {
    clearChatRespondingSessions();
    conversationEpochRef.current += 1;
    currentUserIdRef.current = nextUserId;
    selectCurrentSession("");
    setChatSessions([]);
    setRenderHistory([]);
    setLearnedProfile(null);
    setMemoryView(null);
    setEditingMemoryItemId(null);
    setMemoryDraftText("");
    setMemoryActionId(null);
    setDetectedModels({ analysis: [], image: [] });
    setAddedDetectedModels({ analysis: [], image: [] });
    setActiveResultId(null);
    resetPromptSkillState();
    resetVisibleConversationState();
  }

  function resetPromptSkillState() {
    setPromptSkills([]);
    setSelectedPromptModeId(BUILTIN_STANDARD_PROMPT_MODE_ID);
    setEditingPromptSkillId(null);
    setPromptSkillDraft(DEFAULT_PROMPT_SKILL_DRAFT);
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
    const previousUserId = currentUserIdRef.current || currentUserId;
    beginNamespaceSwitch("");
    setAuthUser(null);
    setCurrentUserId("");
    setAuthDraft({ username: "", password: "" });
    setAuthError("");
    setApiConfig(normalizeApiConfig(defaultApiConfig));
    setSelectedModel(defaultApiConfig.imageModel || modelOptions[0]);
    setConfigStatus(null);
    setConfigAction(null);
    setDetectedModels({ analysis: [], image: [] });
    setAddedDetectedModels({ analysis: [], image: [] });
    setVisibleApiKeys({ analysis: false, image: false });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(analysisModelOptionsStorageKey(previousUserId));
    }
    setShortcutPhrases(cloneDefaultShortcutPhrases());
    setIsQuickPhraseCardOpen(false);
    setEditingShortcutId(null);
    setShortcutDraft({ text: "" });
    resetPromptSkillState();
    setActivePrimaryView("workspace");
    setIsAccountMenuOpen(false);
    setShowUserDialog(showDialog);
  }

  function createConversationRunGuard(): ConversationRunGuard {
    return {
      userId: currentUserIdRef.current,
      epoch: conversationEpochRef.current,
      sessionId: currentSessionIdRef.current,
    };
  }

  function isActiveConversationRun(guard: ConversationRunGuard) {
    return isCurrentConversationRun(guard, currentUserIdRef.current, conversationEpochRef.current);
  }

  function isVisibleConversationRun(guard: ConversationRunGuard) {
    return isActiveConversationRun(guard) && currentSessionIdRef.current === guard.sessionId;
  }

  function snapshotCurrentSession(sessionId = currentSessionId): ChatSessionRecord | null {
    const id = String(sessionId || "").trim();
    if (!id) return null;
    const existing = chatSessions.find((session) => session.id === id);
    const normalizedTree = normalizeMessageTree(messages, activeMessageId);
    return {
      id,
      title: existing?.titleLocked ? existing.title : buildSessionTitle(normalizedTree.messages, chatInput, generationMode, workspaceMode),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: normalizedTree.messages,
      activeMessageId: normalizedTree.activeMessageId,
      chatInput,
      workspaceMode,
      generationMode,
      promptModeId: selectedPromptModeId,
      composerMode,
      activeResultId,
      pinnedAt: existing?.pinnedAt ?? null,
      titleLocked: Boolean(existing?.titleLocked),
    };
  }

  function upsertSession(list: ChatSessionRecord[], nextSession: ChatSessionRecord) {
    return upsertSessionSnapshot(list, nextSession);
  }

  function appendMessagesToRunSession(guard: ConversationRunGuard, patch: ChatMessage[]) {
    if (!isActiveConversationRun(guard)) return;
    if (currentSessionIdRef.current === guard.sessionId) {
      const nextActiveMessageId = patch[patch.length - 1]?.id ?? activeMessageId;
      setMessages((current) => mergeMessageTreeById(current, patch, nextActiveMessageId).messages);
      setActiveMessageId(nextActiveMessageId);
      return;
    }
    setChatSessions((current) => mergeMessagesIntoSessionSnapshot(current, guard.sessionId, patch, new Date().toISOString()));
  }

  function updateRunSessionMessage(guard: ConversationRunGuard, messageId: string, updater: (message: ChatMessage) => ChatMessage) {
    if (!isActiveConversationRun(guard)) return;
    if (currentSessionIdRef.current === guard.sessionId) {
      updateMessageById(messageId, updater);
      return;
    }
    setChatSessions((current) => {
      const target = current.find((session) => session.id === guard.sessionId);
      if (!target) return current;
      let didUpdate = false;
      const nextMessages = target.messages.map((message) => {
        if (message.id !== messageId) return message;
        didUpdate = true;
        return updater(message);
      });
      if (!didUpdate) return current;
      const nextTree = normalizeMessageTree(nextMessages, target.activeMessageId);
      return upsertSession(current, {
        ...target,
        messages: nextTree.messages,
        activeMessageId: nextTree.activeMessageId,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  function removeRunSessionMessage(guard: ConversationRunGuard, messageId: string) {
    if (!isActiveConversationRun(guard)) return;
    if (currentSessionIdRef.current === guard.sessionId) {
      setMessages((current) => {
        const nextMessages = current.filter((message) => message.id !== messageId);
        const nextTree = normalizeMessageTree(nextMessages, activeMessageId === messageId ? null : activeMessageId);
        setActiveMessageId(nextTree.activeMessageId);
        return nextTree.messages;
      });
      return;
    }
    setChatSessions((current) => {
      const target = current.find((session) => session.id === guard.sessionId);
      if (!target) return current;
      const nextMessages = target.messages.filter((message) => message.id !== messageId);
      if (nextMessages.length === target.messages.length) return current;
      const nextTree = normalizeMessageTree(nextMessages, target.activeMessageId === messageId ? null : target.activeMessageId);
      return upsertSession(current, {
        ...target,
        messages: nextTree.messages,
        activeMessageId: nextTree.activeMessageId,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  function updateRunSessionSnapshot(guard: ConversationRunGuard, updater: (session: ChatSessionRecord) => ChatSessionRecord) {
    if (!isActiveConversationRun(guard)) return;
    setChatSessions((current) => {
      const target = current.find((session) => session.id === guard.sessionId);
      const currentSnapshot = currentSessionIdRef.current === guard.sessionId ? snapshotCurrentSession(guard.sessionId) : null;
      const baseSession = currentSnapshot ?? target;
      if (!baseSession) return current;
      return upsertSession(current, updater(baseSession));
    });
  }

  function applyRunActiveResult(runGuard: ConversationRunGuard, activeRunResultId: string) {
    if (isVisibleConversationRun(runGuard)) {
      setActiveResultId(activeRunResultId);
    }
    updateRunSessionSnapshot(runGuard, (session) => ({
      ...session,
      activeResultId: activeRunResultId,
      updatedAt: new Date().toISOString(),
    }));
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
  function getGenerationBlocker(mode: GenerationMode, promptText = chatInput) {
    const hasSubmitPromptText = promptText.trim().length > 0;
    if (!hasAuthenticatedUser) {
      return locale === "zh" ? "请先登录或注册账号" : "Sign in or create an account first";
    }
    if (mode === "standard") {
      return hasSubmitPromptText
        ? ""
        : locale === "zh"
          ? "请输入要直接发送给画图模型的提示词"
          : "Enter the prompt to send directly to the image model";
    }
    if (mode === "colored_floor_plan" && floorPlanFiles.length === 0) {
      return locale === "zh" ? "请先粘贴或拖入至少一张平面图" : "Paste or drop at least one floor plan first";
    }
    if (mode === "render3d" && !hasSubmitPromptText) {
      return locale === "zh"
        ? "请填写画面需求，或使用快捷短语补充 3D 效果提示词"
        : "Add an image brief or insert phrases before applying the 3D prompt boost";
    }
    return "";
  }
  const hasUploadedImageReference = floorPlanFiles.length > 0;
  const canEditSelectedResult = hasAuthenticatedUser && isImageWorkspace && composerMode === "edit-selected-result" && (Boolean(activeResult?.imageUrl) || hasUploadedImageReference) && hasPromptText;
  const canGenerateNew = !isImageWorkspace || !hasAuthenticatedUser
    ? false
    : generationMode === "standard"
    ? hasPromptText
    : generationMode === "colored_floor_plan"
      ? floorPlanFiles.length > 0
      : hasPromptText;
  const canGenerate = composerMode === "edit-selected-result" ? canEditSelectedResult : canGenerateNew;
  const canSubmitChat = hasAuthenticatedUser && isChatWorkspace && hasPromptText && !isVisibleChatResponding;
  const canSubmitComposer = isChatWorkspace ? canSubmitChat : !isConversationBusy && canGenerate;
  const chatProviderLabel = apiConfig.analysisProviderName || apiFormatDisplayName(apiConfig.analysisApiFormat) || (locale === "zh" ? "聊天供应商" : "Chat provider");
  const imageProviderLabel = apiConfig.imageProviderName || apiFormatDisplayName(apiConfig.imageApiFormat) || (locale === "zh" ? "图像供应商" : "Image provider");
  const chatModelValue = apiConfig.analysisModel || "";
  const composerProviderLabel = isChatWorkspace ? chatProviderLabel : imageProviderLabel;
  const composerModelValue = isChatWorkspace ? chatModelValue : selectedModel;
  const composerModelOptions = isChatWorkspace
    ? modelSelectOptions(chatModelValue, addedDetectedModels.analysis)
    : modelSelectOptions(selectedModel, parseModelListText(apiConfig.fallbackModels), addedDetectedModels.image, modelOptions);
  const promptModeOptions: Array<{ id: PromptModeId; zh: string; en: string; description?: string }> = [
    ...generationModeOptions.map((option) => ({
      id: (option.value === "render3d" ? BUILTIN_RENDER3D_PROMPT_MODE_ID : BUILTIN_STANDARD_PROMPT_MODE_ID) as PromptModeId,
      zh: option.zh,
      en: option.en,
    })),
    ...promptSkills.map((skill) => ({
      id: `skill-${skill.id}` as PromptModeId,
      zh: skill.name,
      en: skill.name,
      description: skill.description,
    })),
  ];
  const selectedPromptSkill = selectedPromptModeId.startsWith("skill-")
    ? promptSkills.find((skill) => skill.id === selectedPromptModeId.slice("skill-".length)) ?? null
    : null;
  const visibleSelectedPromptModeId: PromptModeId = selectedPromptModeId.startsWith("skill-") && !selectedPromptSkill
    ? BUILTIN_STANDARD_PROMPT_MODE_ID
    : selectedPromptModeId;
  const selectedAnalysisModelOptions = modelSelectOptions(apiConfig.analysisModel, addedDetectedModels.analysis);
  const retryModelOptions = modelSelectOptions(apiConfig.analysisModel, addedDetectedModels.analysis, detectedModels.analysis);
  const selectedImageModelOptions = modelSelectOptions(apiConfig.imageModel, parseModelListText(apiConfig.fallbackModels));
  const currentHeaderModelLabel = isChatWorkspace
    ? selectedAnalysisModelOptions[0] || apiConfig.analysisModel || (locale === "zh" ? "未设置聊天模型" : "No chat model")
    : selectedModel || selectedImageModelOptions[0] || apiConfig.imageModel || (locale === "zh" ? "未设置图片模型" : "No image model");
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
        ? "请先选择一张已有结果，或上传一张参考图"
        : "Select an existing result or upload a reference image first"
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
  const selectedEditSourceLabel = isImageWorkspace && composerMode === "edit-selected-result" && floorPlanFiles.length > 0
    ? locale === "zh"
      ? `源图：上传图片 ${floorPlanFiles.length} 张`
      : `Source: ${floorPlanFiles.length} uploaded image(s)`
    : isImageWorkspace && composerMode === "edit-selected-result" && activeResult
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
  const composerIsStopping = isVisibleChatResponding || isVisibleRendering;
  const composerHint = isChatWorkspace
    ? chatBlocker || (locale === "zh" ? "日常对话不会触发画图；需要出图时切换到图像模式。" : "Daily chat does not generate images; switch to image mode when ready to draw.")
    : generationBlocker || (composerMode === "edit-selected-result"
    ? locale === "zh"
      ? "会以当前选中的结果图为源图，只修改你描述的内容。"
      : "The selected result is used as the source image; only the described changes are requested."
    : generationMode === "standard"
      ? locale === "zh"
        ? (floorPlanFiles.length > 0 ? "默认模式会把上传图片作为参考图，配合输入框提示词进行图生图/二次创作。" : "默认模式可直接文生图；上传图片后会作为参考图进行图生图。")
        : (floorPlanFiles.length > 0 ? "Default mode uses uploaded images as references for image-to-image generation." : "Default mode supports text-to-image; upload images to use them as references.")
      : generationMode === "colored_floor_plan"
        ? locale === "zh"
        ? "添加平面图后可生成彩色平面图，输入框文字只作为补充偏好。"
        : "Add a floor plan to generate a colored plan; composer text is used only as optional preference."
        : locale === "zh"
          ? "3D 提示词增强会在你的输入上追加效果图表达；平面图可选，拖入后作为结构参考。"
          : "3D prompt boost adds render-oriented wording to your prompt. A floor plan is optional structure reference.");
  const promptModeHint = selectedPromptSkill
    ? locale === "zh"
      ? `当前自定义模式：${selectedPromptSkill.name}。提交时会把模板套用到输入内容。`
      : `Custom mode: ${selectedPromptSkill.name}. The template is applied to your composer text.`
    : composerHint;
  const composerSubmitShortcutHint = locale === "zh"
    ? `${composerSubmitLabel}（Enter 发送，Shift+Enter 换行）`
    : `${composerSubmitLabel} (Enter to send, Shift+Enter for a new line)`;
  const composerStopTitle = isVisibleChatResponding
    ? locale === "zh" ? "停止当前回复" : "Stop current response"
    : locale === "zh" ? "停止当前生成" : "Stop current generation";
  const latestResult = activeResult;
  const progressAnalysisText = buildFloorPlanAnalysisText(visibleLiveGeneration?.floorDesc);
  const latestAnalysisText = buildFloorPlanAnalysisText(latestResult?.floorDesc);
  const hasCurrentAnalysisResult = Boolean(progressAnalysisText);
  const sidebarAnalysisText = isVisibleRendering ? progressAnalysisText : latestAnalysisText;
  const hasRunFailure = visibleActiveStep === "failed";
  const isEmptyConversation = activePathMessages.length === 0 && !isVisibleRendering && !isVisibleChatResponding;
  const visibleComposerPlaceholder = isEmptyConversation
    ? locale === "zh" ? "有问题，尽管问" : "Ask anything"
    : composerPlaceholder;
  const hasRun = activePathMessages.length > 0 || isVisibleRendering || renderHistory.length > 0;
  const workflowActiveStep = visibleActiveStep === "idle" && latestResult ? "completed" : visibleActiveStep;
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
          : floorPlanFiles.length > 0
            ? locale === "zh" ? "正在解析平面图" : "Parsing floor plan"
            : locale === "zh" ? "按文字需求生成" : "Generating from text"
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
  const chatAttachmentLabel = locale === "zh" ? "上传图片" : "Uploaded image";
  const projectState = isVisibleRendering
    ? t.rendering
    : isVisibleChatResponding
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
        : generationMode === "colored_floor_plan" && floorPlanFiles.length === 0
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
  const currentIteration = visibleLiveGeneration?.iteration ?? null;
  const effectiveMaxIterations = enableQualityEvaluation ? maxIterations : 1;
  const currentMaxIterations = visibleLiveGeneration?.maxIterations ?? effectiveMaxIterations;
  const displayIteration = isVisibleRendering ? currentIteration ?? 0 : latestResult ? latestResult.versionIndex || 1 : 0;
  const generationStageLabel = visibleActiveStep === "submitted"
    ? visibleLiveGeneration?.status || (generationMode === "standard" ? (locale === "zh" ? "已提交，正在直通生成" : "Submitted, direct generation") : (locale === "zh" ? "已提交，正在分析" : "Submitted, analyzing"))
    : visibleActiveStep === "analysis"
      ? progressPromptText
        ? locale === "zh" ? "提示词已生成，准备进入图片生成" : "Prompt ready, preparing image generation"
        : visibleLiveGeneration?.status || (isStructuredGenerationMode ? (locale === "zh" ? "正在分析平面图与需求" : "Analyzing floor plan and brief") : (locale === "zh" ? "正在准备直通提示词" : "Preparing direct prompt"))
      : visibleActiveStep === "rendering"
        ? visibleLiveGeneration?.hasImages
          ? locale === "zh" ? "图片已返回，正在整理结果" : "Images returned, packaging results"
          : visibleLiveGeneration?.status || (locale === "zh" ? "正在等待图片结果" : "Waiting for image result")
        : visibleActiveStep === "evaluating"
          ? enableQualityEvaluation
            ? visibleLiveGeneration?.status || (locale === "zh" ? "图片已返回，正在进行严格复核" : "Image returned, running the strict review")
            : visibleLiveGeneration?.status || (locale === "zh" ? "图片已返回，正在整理结果" : "Image returned, packaging result")
        : visibleActiveStep === "completed"
          ? locale === "zh" ? "生成完成" : "Completed"
          : visibleActiveStep === "failed"
            ? locale === "zh" ? "生成失败" : "Failed"
            : locale === "zh" ? "等待后端响应" : "Waiting for backend";
  const progressAnalysisStepLabel = hasCurrentAnalysisResult
    ? locale === "zh" ? "分析已出" : "Analysis ready"
    : generationMode === "standard"
      ? locale === "zh" ? "直通" : "Direct"
    : visibleActiveStep === "analysis"
      ? locale === "zh" ? "分析中" : "Analyzing"
      : locale === "zh" ? "等待分析" : "Waiting for analysis";
  const isGenerationSlow = isVisibleRendering && generationElapsedMs >= GENERATION_SLOW_NOTICE_MS;

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
    setAddedDetectedModels((current) => ({
      ...current,
      analysis: modelSelectOptions(localConfig.analysisModel, loadStoredAnalysisModelOptions(currentUserId))
    }));
    let isMounted = true;
    withStartupRetry(loadConfig)
      .then((savedConfig) => {
        if (!isMounted) return;
        const normalized = normalizeApiConfig(savedConfig);
        setApiConfig(normalized);
        setSelectedModel(normalized.imageModel || modelOptions[0]);
        setAddedDetectedModels((current) => ({
          ...current,
          analysis: modelSelectOptions(normalized.analysisModel, current.analysis)
        }));
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
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    const normalized = normalizeMessageTree(messages, activeMessageId);
    if (normalized.messages !== messages) {
      setMessages(normalized.messages);
    }
    if (normalized.activeMessageId !== activeMessageId) {
      setActiveMessageId(normalized.activeMessageId);
    }
  }, [messages, activeMessageId]);

  useEffect(() => {
    if (!currentUserId) {
      setRenderHistory([]);
      setActiveResultId(null);
      setIsRefreshingResults(false);
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

  async function refreshResultsFromServer(showSuccessToast = true) {
    if (!currentUserId) {
      setRenderHistory([]);
      setActiveResultId(null);
      return;
    }
    setIsRefreshingResults(true);
    try {
      const items = await listResults(currentUserId);
      setRenderHistory(items);
      setActiveResultId((current) => (
        current && items.some((item) => item.id === current)
          ? current
          : items[0]?.id ?? null
      ));
      if (showSuccessToast) {
        showToast(locale === "zh" ? "图片列表已刷新" : "Image list refreshed");
      }
    } catch (error) {
      showToast(`${locale === "zh" ? "刷新图片列表失败" : "Image refresh failed"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRefreshingResults(false);
    }
  }

  function applyStoredSessionCollection(stored: StoredChatSessions) {
    const target = stored.sessions.find((session) => session.id === stored.currentSessionId) ?? stored.sessions[0];
    if (!target) return false;
    setChatSessions(upsertSession(stored.sessions, target));
    selectCurrentSession(target.id);
    applySession(target);
    return true;
  }

  useEffect(() => {
    let bootstrapTimer: number | null = null;
    let isMounted = true;
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
      selectCurrentSession("");
      setMessages([]);
      setActiveMessageId(null);
      setChatInput("");
      setEditingMessage(null);
      setWorkspaceMode(DEFAULT_WORKSPACE_MODE);
      setGenerationMode("standard");
      setSelectedPromptModeId(BUILTIN_STANDARD_PROMPT_MODE_ID);
      setComposerMode("new-generation");
      finishBootstrapping();
      return () => {
        if (bootstrapTimer !== null) {
          window.clearTimeout(bootstrapTimer);
        }
        isBootstrappingSessionRef.current = false;
      };
    }
    withStartupRetry(loadChatHistory)
      .then(async (serverHistory) => {
        if (!isMounted) return;
        const serverStored = parseStoredSessions(JSON.stringify(serverHistory), "server-session");
        if (hasRecoverableStoredSessions(serverStored.sessions) && applyStoredSessionCollection(serverStored)) {
          lastSavedChatHistoryRef.current = JSON.stringify({
            currentSessionId: serverStored.currentSessionId,
            sessions: serverStored.sessions,
          });
          return;
        }

        const localStored = loadStoredSessions(currentUserId);
        if (hasRecoverableStoredSessions(localStored.sessions) && applyStoredSessionCollection(localStored)) {
          await saveChatHistory({
            currentSessionId: localStored.currentSessionId,
            sessions: localStored.sessions,
          }).catch(() => null);
          return;
        }

        const items = await listResults(currentUserId).catch(() => [] as RenderHistoryItem[]);
        if (!isMounted) return;
        if (items.length > 0) {
          setRenderHistory(items);
          setActiveResultId((current) => (
            current && items.some((item) => item.id === current)
              ? current
              : items[0]?.id ?? null
          ));
          const recoveredSessions = sessionsFromHistoryResults(items);
          if (recoveredSessions.length > 0) {
            const recoveredStored = {
              currentSessionId: recoveredSessions[0].id,
              sessions: recoveredSessions,
            };
            if (applyStoredSessionCollection(recoveredStored)) {
              await saveChatHistory(recoveredStored).catch(() => null);
              showToast(locale === "zh" ? "已从图片管理恢复历史生成记录" : "Recovered generation history from images");
              return;
            }
          }
        }

        const nextSession = createEmptySession();
        setChatSessions([nextSession]);
        selectCurrentSession(nextSession.id);
        applySession(nextSession);
      })
      .catch(() => {
        if (!isMounted) return;
        const stored = loadStoredSessions(currentUserId);
        if (stored.sessions.length > 0 && applyStoredSessionCollection(stored)) {
          return;
        }
        const nextSession = createEmptySession();
        setChatSessions([nextSession]);
        selectCurrentSession(nextSession.id);
        applySession(nextSession);
      })
      .finally(() => {
        if (isMounted) {
          finishBootstrapping();
        }
      });
    return () => {
      isMounted = false;
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
  }, [currentSessionId, messages, activeMessageId, chatInput, workspaceMode, generationMode, selectedPromptModeId, composerMode, activeResultId]);

  useEffect(() => {
    if (typeof window === "undefined" || !currentUserId || chatSessions.length === 0) return;
    const historyPayload = {
      currentSessionId,
      sessions: chatSessions,
    };
    const serialized = JSON.stringify(historyPayload);
    window.localStorage.setItem(chatHistoryStorageKey(currentUserId), serialized);
    if (isBootstrappingSessionRef.current || serialized === lastSavedChatHistoryRef.current) return;
    lastSavedChatHistoryRef.current = serialized;
    void saveChatHistory(historyPayload).catch(() => {
      lastSavedChatHistoryRef.current = "";
    });
  }, [chatSessions, currentSessionId, currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setShortcutPhrases(cloneDefaultShortcutPhrases());
      setEditingShortcutId(null);
      setShortcutDraft({ text: "" });
      resetPromptSkillState();
      return;
    }
    const localPhrases = loadStoredShortcutPhrases(currentUserId);
    setShortcutPhrases(localPhrases);
    setEditingShortcutId(null);
    setShortcutDraft({ text: "" });
    const localPromptSkills = loadStoredPromptSkills(currentUserId);
    setPromptSkills(localPromptSkills);
    setSelectedPromptModeId((current) => {
      if (!current.startsWith("skill-")) return current;
      const skillId = current.slice("skill-".length);
      return localPromptSkills.some((skill) => skill.id === skillId) ? current : BUILTIN_STANDARD_PROMPT_MODE_ID;
    });
    setEditingPromptSkillId(null);
    setPromptSkillDraft(DEFAULT_PROMPT_SKILL_DRAFT);
    let isMounted = true;
    withStartupRetry(() => loadShortcutPreferences(currentUserId))
      .then((items) => {
        if (!isMounted || items.length === 0) return;
        const normalized = items.map(normalizeShortcutPhrase).filter((item): item is ShortcutPhrase => Boolean(item));
        if (normalized.length > 0) {
          setShortcutPhrases(normalized);
        }
      })
      .catch(() => {
        // Browser-local shortcut phrases remain usable if the backend is offline.
      });
    withStartupRetry(() => loadPromptSkillPreferences(currentUserId))
      .then((items) => {
        if (!isMounted) return;
        const normalized = normalizePromptSkills(items);
        setPromptSkills(normalized);
        window.localStorage.setItem(promptSkillsStorageKey(currentUserId), JSON.stringify(normalized));
        setSelectedPromptModeId((current) => {
          if (!current.startsWith("skill-")) return current;
          const skillId = current.slice("skill-".length);
          return normalized.some((skill) => skill.id === skillId) ? current : BUILTIN_STANDARD_PROMPT_MODE_ID;
        });
      })
      .catch(() => {
        // Browser-local prompt skills remain usable if the backend is offline.
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
    if (!isVisibleRendering || generationStartedAt === null) return;
    setGenerationElapsedMs(Date.now() - generationStartedAt);
    const timer = window.setInterval(() => {
      setGenerationElapsedMs(Date.now() - generationStartedAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, isVisibleRendering]);

  useEffect(() => {
    chatThreadRef.current?.scrollTo({ top: chatThreadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isVisibleRendering]);

  useEffect(() => {
    if (!retryPopover) return;
    const targetExists = messages.some((message) => message.id === retryPopover.messageId);
    if (!targetExists || isConversationBusy) {
      setRetryPopover(null);
    }
  }, [isConversationBusy, messages, retryPopover]);

  useEffect(() => {
    syncComposerHeight(composerRef.current);
  }, [chatInput, composerMode, workspaceMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditableTarget = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
        if (event.key === "Escape") {
        if (isAccountMenuOpen) {
          setIsAccountMenuOpen(false);
          return;
        }
        if (activeHistoryMenuId) {
          setActiveHistoryMenuId(null);
          setHistoryMenuPosition(null);
          return;
        }
        if (retryPopover) {
          setRetryPopover(null);
          return;
        }
        if (activeUtilityPanel) {
          setActiveUtilityPanel(null);
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
  }, [activeHistoryMenuId, activeUtilityPanel, annotationTarget, isAccountMenuOpen, isComparisonOpen, isSubmittingAnnotation, locale, previewImage, retryPopover]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!isAccountMenuOpen && !activeHistoryMenuId && !retryPopover) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (isAccountMenuOpen && !accountMenuRef.current?.contains(target)) {
        setIsAccountMenuOpen(false);
      }
      if (activeHistoryMenuId) {
        const element = target instanceof Element ? target : target.parentElement;
        if (!element?.closest(".chatgpt-sidebar__history-item, .chatgpt-sidebar__history-menu")) {
          setActiveHistoryMenuId(null);
          setHistoryMenuPosition(null);
        }
      }
      if (retryPopover) {
        const element = target instanceof Element ? target : target.parentElement;
        if (!element?.closest(".retry-popover, .assistant-output-actions__retry")) {
          setRetryPopover(null);
        }
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [activeHistoryMenuId, isAccountMenuOpen, retryPopover]);

  useEffect(() => {
    if (!activeHistoryMenuId) {
      setHistoryMenuPosition(null);
    }
  }, [activeHistoryMenuId]);

  useEffect(() => {
    if (!activeHistoryMenuId) return;
    const closeHistoryMenu = () => {
      setActiveHistoryMenuId(null);
      setHistoryMenuPosition(null);
    };
    window.addEventListener("resize", closeHistoryMenu);
    window.addEventListener("scroll", closeHistoryMenu, true);
    return () => {
      window.removeEventListener("resize", closeHistoryMenu);
      window.removeEventListener("scroll", closeHistoryMenu, true);
    };
  }, [activeHistoryMenuId]);

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
    if (!isImageWorkspace) {
      setWorkspaceMode("image");
      setActivePrimaryView("workspace");
    }
    setFloorPlanFiles((current) => mergeFloorPlanFiles(current, imageFiles, append));
    showToast(locale === "zh" ? `已导入 ${imageFiles.length} 张图片` : `${imageFiles.length} image(s) imported`);
  }

  function setComposerImageAttachments(files: FileList | File[], append = false) {
    const imageFiles = imageFilesFromFiles(filesFromList(files));
    if (imageFiles.length === 0) {
      showToast(locale === "zh" ? "请粘贴或拖入图片文件" : "Paste or drop image files");
      return;
    }
    setFloorPlanFiles((current) => mergeFloorPlanFiles(current, imageFiles, append));
    showToast(isChatWorkspace
      ? locale === "zh" ? `已添加 ${imageFiles.length} 张聊天图片` : `${imageFiles.length} chat image(s) attached`
      : locale === "zh" ? `已添加 ${imageFiles.length} 张参考图/平面图` : `${imageFiles.length} reference image(s) or floor plan(s) attached`);
  }

  function containsFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleWorkspaceDragEnter(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleWorkspaceDragOver(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFiles(true);
  }

  function handleWorkspaceDragLeave(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }

  function handleWorkspaceDrop(event: DragEvent<HTMLElement>) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    setFloorPlansFromFiles(event.dataTransfer.files, true);
  }

  function shortcutText(item: ShortcutPhrase) {
    return item.text.trim();
  }

  function handleInsertQuickPhrase(text: string) {
    insertComposerPhrase(text);
    setIsQuickPhraseCardOpen(false);
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

  function persistPromptSkills(nextSkills: PromptSkill[]) {
    const normalized = normalizePromptSkills(nextSkills);
    setPromptSkills(normalized);
    if (typeof window !== "undefined" && currentUserId) {
      window.localStorage.setItem(promptSkillsStorageKey(currentUserId), JSON.stringify(normalized));
      void savePromptSkillPreferences(normalized.map(promptSkillStorageShape), currentUserId)
        .then((saved) => {
          const savedSkills = normalizePromptSkills(saved);
          setPromptSkills(savedSkills);
          window.localStorage.setItem(promptSkillsStorageKey(currentUserId), JSON.stringify(savedSkills));
        })
        .catch((error) => {
          showToast(`${locale === "zh" ? "图像模式已保存在本机，后端同步失败" : "Image mode saved locally, backend sync failed"}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
  }

  function startNewPromptSkill() {
    setEditingPromptSkillId(null);
    setPromptSkillDraft(DEFAULT_PROMPT_SKILL_DRAFT);
    setActiveUtilityPanel("prompts");
  }

  function startEditingPromptSkill(skill: PromptSkill) {
    setEditingPromptSkillId(skill.id);
    setPromptSkillDraft({
      name: skill.name,
      description: skill.description,
      prompt: skill.prompt,
    });
    setActiveUtilityPanel("prompts");
  }

  function savePromptSkill() {
    const name = promptSkillDraft.name.trim();
    const prompt = promptSkillDraft.prompt.trim();
    if (!name || !prompt) {
      showToast(locale === "zh" ? "请填写模式名称和提示词模板" : "Add a mode name and prompt template");
      return;
    }
    const nextSkill: PromptSkill = {
      id: editingPromptSkillId || `prompt-skill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      description: promptSkillDraft.description.trim(),
      prompt,
    };
    const nextSkills = editingPromptSkillId
      ? promptSkills.map((item) => item.id === editingPromptSkillId ? nextSkill : item)
      : [...promptSkills, nextSkill];
    persistPromptSkills(nextSkills);
    setSelectedPromptModeId(`skill-${nextSkill.id}`);
    setGenerationMode("standard");
    setEditingPromptSkillId(null);
    setPromptSkillDraft(DEFAULT_PROMPT_SKILL_DRAFT);
    showToast(locale === "zh" ? "图像模式已保存" : "Image mode saved");
  }

  function removePromptSkill(id: string) {
    const nextSkills = promptSkills.filter((item) => item.id !== id);
    persistPromptSkills(nextSkills);
    if (selectedPromptModeId === `skill-${id}`) {
      setSelectedPromptModeId(BUILTIN_STANDARD_PROMPT_MODE_ID);
      setGenerationMode("standard");
    }
    if (editingPromptSkillId === id) {
      setEditingPromptSkillId(null);
      setPromptSkillDraft(DEFAULT_PROMPT_SKILL_DRAFT);
    }
    showToast(locale === "zh" ? "图像模式已删除" : "Image mode removed");
  }

  function selectPromptMode(modeId: PromptModeId) {
    setSelectedPromptModeId(modeId);
    setGenerationMode(generationModeForPromptMode(modeId));
  }

  function startNewShortcutPhrase() {
    setEditingShortcutId(null);
    setShortcutDraft({ text: "" });
    setActiveUtilityPanel("shortcuts");
  }

  function startEditingShortcutPhrase(item: ShortcutPhrase) {
    setEditingShortcutId(item.id);
    setShortcutDraft({ text: item.text });
    setActiveUtilityPanel("shortcuts");
  }

  function saveShortcutPhrase() {
    const text = shortcutDraft.text.trim();
    if (!text) {
      showToast(locale === "zh" ? "请先填写短语内容" : "Add phrase text first");
      return;
    }
    const nextPhrase: ShortcutPhrase = {
      id: editingShortcutId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
    };
    const nextPhrases = editingShortcutId
      ? shortcutPhrases.map((item) => item.id === editingShortcutId ? nextPhrase : item)
      : [...shortcutPhrases, nextPhrase];
    persistShortcutPhrases(nextPhrases);
    setEditingShortcutId(null);
    setShortcutDraft({ text: "" });
    showToast(locale === "zh" ? "快捷短语已保存" : "Shortcut phrase saved");
  }

  function removeShortcutPhrase(id: string) {
    const nextPhrases = shortcutPhrases.filter((item) => item.id !== id);
    persistShortcutPhrases(nextPhrases);
    if (editingShortcutId === id) {
      setEditingShortcutId(null);
      setShortcutDraft({ text: "" });
    }
    showToast(locale === "zh" ? "快捷短语已删除" : "Shortcut phrase removed");
  }

  function resetShortcutPhrases() {
    const defaults = cloneDefaultShortcutPhrases();
    persistShortcutPhrases(defaults);
    setEditingShortcutId(null);
    setShortcutDraft({ text: "" });
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
    const clipboardFiles = filesFromList(event.clipboardData.files);
    const files = clipboardFiles.length > 0 ? clipboardFiles : imageFilesFromClipboardItems(event.clipboardData.items);
    const images = imageFilesFromFiles(files);
    if (images.length === 0) return;
    event.preventDefault();
    setComposerImageAttachments(images, true);
  }

  function toggleUtilityPanel(panel: UtilityPanel) {
    setActivePrimaryView("workspace");
    setIsAccountMenuOpen(false);
    setIsQuickPhraseCardOpen(false);
    setActiveUtilityPanel((current) => current === panel ? null : panel);
  }

  function toggleSidebarCollapsed() {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      if (next) {
        setIsAccountMenuOpen(false);
      }
      return next;
    });
  }

  function toggleAccountMenu() {
    if (!authUser) {
      setShowUserDialog(true);
      return;
    }
    setIsAccountMenuOpen((current) => !current);
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

  function buildGenerationPrompt(userPrompt?: string, mode: GenerationMode = generationMode, promptModeId: PromptModeId = selectedPromptModeId) {
    const basePrompt = (userPrompt ?? chatInput).trim();
    if (mode === "standard") {
      if (promptModeId.startsWith("skill-")) {
        const skillId = promptModeId.slice("skill-".length);
        const skill = promptSkills.find((item) => item.id === skillId);
        return skill ? applyPromptSkillTemplate(skill.prompt, basePrompt) : basePrompt;
      }
      return basePrompt;
    }
    return basePrompt ? (locale === "zh" ? `设计需求：${basePrompt}` : `Design brief: ${basePrompt}`) : "";
  }

  function updateAnalysisProvider(patch: Partial<ApiProviderProfile>) {
    setApiConfig((current) => syncActiveProvider(current, "analysis", patch));
  }

  function updateImageProvider(patch: Partial<ApiProviderProfile>) {
    setApiConfig((current) => syncActiveProvider(current, "image", patch));
  }

  function toggleApiKeyVisibility(role: ConfigRole) {
    setVisibleApiKeys((current) => ({
      ...current,
      [role]: !current[role]
    }));
  }

  function selectProviderProfile(role: "analysis" | "image", providerId: string) {
    setApiConfig((current) => {
      const providers = role === "analysis" ? current.analysisProviders : current.imageProviders;
      const provider = providers.find((item) => item.id === providerId);
      if (role === "image" && provider) {
        setSelectedModel(provider.model || modelOptions[0]);
      }
      return provider ? applyProviderProfile(current, role, provider) : current;
    });
  }

  function addProviderProfile(role: "analysis" | "image") {
    setApiConfig((current) => {
      const newProvider: ApiProviderProfile = {
        id: createProviderId(role),
        providerName: locale === "zh" ? "新供应商" : "New provider",
        apiFormat: role === "image" ? "openai_image" : "openai",
        baseUrl: defaultApiBaseUrl,
        apiKey: "",
        model: role === "image" ? modelOptions[0] : ""
      };
      if (role === "image") {
        setSelectedModel(newProvider.model || modelOptions[0]);
      }
      const providersKey = role === "analysis" ? "analysisProviders" : "imageProviders";
      const nextConfig = {
        ...current,
        [providersKey]: [...current[providersKey], newProvider]
      } as ApiConfig;
      return applyProviderProfile(nextConfig, role, newProvider);
    });
  }

  function deleteProviderProfile(role: "analysis" | "image") {
    setApiConfig((current) => {
      const providersKey = role === "analysis" ? "analysisProviders" : "imageProviders";
      const activeId = role === "analysis" ? current.activeAnalysisProviderId : current.activeImageProviderId;
      const providers = current[providersKey];
      if (providers.length <= 1) {
        return current;
      }
      const nextProviders = providers.filter((provider) => provider.id !== activeId);
      const nextActive = nextProviders[0];
      if (role === "image" && nextActive) {
        setSelectedModel(nextActive.model || modelOptions[0]);
      }
      const nextConfig = {
        ...current,
        [providersKey]: nextProviders
      } as ApiConfig;
      return nextActive ? applyProviderProfile(nextConfig, role, nextActive) : current;
    });
  }

  function handleSelectedModelChange(value: string) {
    setSelectedModel(value);
    updateImageProvider({ model: value });
  }

  function handleChatModelChange(value: string) {
    const model = value.trim();
    updateAnalysisProvider({ model });
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
      messages: activePathMessages,
      generationRecordCount: conversationGenerationRecordCount,
      isRendering: isVisibleRendering || isVisibleChatResponding,
      liveGenerationHasContent: Boolean(liveGeneration?.hasImages || liveGeneration?.floorDesc || liveGeneration?.prompt || liveGeneration?.logs),
    });
  }

  function handleResetWorkspace() {
    if (isRendering) return;
    setActivePrimaryView("workspace");
    setIsAccountMenuOpen(false);
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
    selectCurrentSession(nextSession.id);
    setShowApiConfig(true);
    setShowPromptConfig(true);
    setConfigStatus(null);
    setConfigAction(null);
    setIsSubmittingAnnotation(false);
    setRememberingMessageId(null);
    clearAttachments(true);
    applySession(nextSession);
    showToast(locale === "zh" ? "已新建对话" : "New chat created");
  }

  function handleOpenSession(sessionId: string) {
    if (!sessionId || sessionId === currentSessionId) return;
    setActivePrimaryView("workspace");
    setIsAccountMenuOpen(false);
    setActiveHistoryMenuId(null);
    setHistoryMenuPosition(null);
    setRenamingSessionId(null);
    const currentSnapshot = snapshotCurrentSession();
    const target = chatSessions.find((session) => session.id === sessionId);
    if (!target) return;
    setChatSessions((current) => currentSnapshot ? upsertSession(current, currentSnapshot) : current);
    selectCurrentSession(sessionId);
    clearAttachments(true);
    applySession(target);
    showToast(locale === "zh" ? "已切换聊天记录" : "Chat session switched");
  }

  function stopCurrentChatResponse() {
    const sessionId = currentSessionIdRef.current;
    const controller = chatAbortControllersRef.current.get(sessionId) ?? generationAbortControllersRef.current.get(sessionId);
    if (!controller) return;
    controller.abort();
  }

  function handleToggleHistoryMenu(sessionId: string, anchor: HTMLElement) {
    setRenamingSessionId(null);
    if (activeHistoryMenuId === sessionId) {
      setActiveHistoryMenuId(null);
      setHistoryMenuPosition(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 178;
    const viewportPadding = 10;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    );
    setHistoryMenuPosition({
      top: Math.max(viewportPadding, Math.min(rect.bottom + 6, window.innerHeight - 164)),
      left,
    });
    setActiveHistoryMenuId(sessionId);
  }

  function handleTogglePinSession(sessionId: string) {
    const currentSnapshot = snapshotCurrentSession();
    const timestamp = new Date().toISOString();
    const target = (currentSnapshot ? upsertSession(chatSessions, currentSnapshot) : chatSessions)
      .find((session) => session.id === sessionId);
    const didPin = !target?.pinnedAt;
    setChatSessions((current) => {
      const seeded = currentSnapshot ? upsertSession(current, currentSnapshot) : current;
      return seeded.map((session) => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          pinnedAt: session.pinnedAt ? null : timestamp,
        };
      });
    });
    setActiveHistoryMenuId(null);
    setHistoryMenuPosition(null);
    showToast(didPin
      ? locale === "zh" ? "已置顶聊天" : "Chat pinned"
      : locale === "zh" ? "已取消置顶" : "Chat unpinned");
  }

  function handleStartRenameSession(session: ChatSessionRecord) {
    setRenameDraft(sessionDisplayTitle(session));
    setRenamingSessionId(session.id);
    setActiveHistoryMenuId(null);
    setHistoryMenuPosition(null);
  }

  function commitRenameSession(sessionId: string) {
    const title = renameDraft.trim();
    if (!title) {
      setRenamingSessionId(null);
      setRenameDraft("");
      return;
    }
    setChatSessions((current) => current.map((session) => (
      session.id === sessionId
        ? {
          ...session,
          title,
          titleLocked: true,
          updatedAt: new Date().toISOString(),
        }
        : session
    )));
    if (currentSessionId === sessionId) {
      const currentSnapshot = snapshotCurrentSession(sessionId);
      if (currentSnapshot) {
        setChatSessions((current) => upsertSession(current, {
          ...currentSnapshot,
          title,
          titleLocked: true,
        }));
      }
    }
    setRenamingSessionId(null);
    setRenameDraft("");
    showToast(locale === "zh" ? "已重命名聊天" : "Chat renamed");
  }

  function handleDeleteSession(sessionId: string) {
    const currentSnapshot = snapshotCurrentSession();
    const seededSessions = currentSnapshot ? upsertSession(chatSessions, currentSnapshot) : chatSessions;
    const sessionToDelete = seededSessions.find((session) => session.id === sessionId);
    if (!sessionToDelete) return;
    const nextSessions = seededSessions.filter((session) => session.id !== sessionId);
    const fallbackSession = nextSessions.find((session) => hasDurableConversationContent(session.messages)) ?? nextSessions[0] ?? createEmptySession();
    setChatSessions(nextSessions.length > 0 ? nextSessions : [fallbackSession]);
    setActiveHistoryMenuId(null);
    setHistoryMenuPosition(null);
    setRenamingSessionId(null);
    if (currentSessionId === sessionId || !currentSessionId) {
      selectCurrentSession(fallbackSession.id);
      clearAttachments(true);
      applySession(fallbackSession);
    }
    showToast(locale === "zh" ? "已删除聊天记录" : "Chat deleted");
  }

  function switchWorkspaceMode(nextMode: WorkspaceMode) {
    if (isRendering || isVisibleChatResponding || workspaceMode === nextMode) return;
    setActivePrimaryView("workspace");
    setIsAccountMenuOpen(false);
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

  function updateMessageById(messageId: string, updater: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => {
      const normalized = normalizeMessageTree(
        current.map((message) => message.id === messageId ? updater(message) : message),
        activeMessageId
      );
      setActiveMessageId(normalized.activeMessageId);
      return normalized.messages;
    });
  }

  function buildDailyChatMessageExtras(draftInstructionRaw: string, memoryCandidateRaw?: ChatMemoryCandidate) {
    const draftInstruction = draftInstructionRaw.trim();
    const memoryCandidate = memoryCandidateHasEntries(memoryCandidateRaw) ? memoryCandidateRaw : undefined;
    const zhBullets = [
      draftInstruction ? "可一键转到图像模式并载入草稿" : "",
      memoryCandidate ? "检测到可手动保存的偏好" : "",
    ].filter(Boolean);
    const enBullets = [
      draftInstruction ? "Draft can be moved into image mode" : "",
      memoryCandidate ? "Detected a preference you can save manually" : "",
    ].filter(Boolean);

    return {
      draftInstruction,
      memoryCandidate,
      bullets: zhBullets.length || enBullets.length
        ? {
            zh: compactLines(zhBullets),
            en: compactLines(enBullets),
          }
        : undefined,
    };
  }

  function handleApplyDraftInstruction(draftInstruction: string) {
    const draft = draftInstruction.trim();
    if (!draft) return;
    setActivePrimaryView("workspace");
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
      setMessages((current) => current.map((message) => message.id === messageId
        ? { ...message, memoryCandidate: undefined }
        : message));
      showToast(locale === "zh" ? "已手动记住这条偏好" : "Preference remembered");
    } catch (error) {
      showToast(`${locale === "zh" ? "记忆失败" : "Remember failed"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRememberingMessageId(null);
    }
  }

  function findPreviousUserPrompt(messageId: string) {
    const path = getMessagePathTo(messages, messageId);
    if (path.length <= 1) return "";
    for (let index = path.length - 2; index >= 0; index -= 1) {
      const candidate = path[index];
      if (candidate.role === "user") {
        return extractContentText(withActiveMessageVariant(candidate).content);
      }
    }
    return "";
  }

  function findPreviousUserMessage(messageId: string) {
    const path = getMessagePathTo(messages, messageId);
    if (path.length <= 1) return null;
    for (let index = path.length - 2; index >= 0; index -= 1) {
      const candidate = path[index];
      if (candidate.role === "user") {
        return withActiveMessageVariant(candidate);
      }
    }
    return null;
  }

  function handleOpenRetryPopover(message: ChatMessage) {
    if (isRendering || isVisibleChatResponding) {
      showToast(locale === "zh" ? "当前仍有请求在进行中" : "A request is already running");
      return;
    }
    const prompt = findPreviousUserPrompt(message.id);
    if (!prompt) {
      showToast(locale === "zh" ? "没有找到可重新生成的上一条输入" : "No previous user input to regenerate");
      return;
    }
    const activeMessage = withActiveMessageVariant(message);
    if (activeMessage.kind === "analysis" || activeMessage.kind === "render") {
      handleRegenerateMessage(message, "");
      return;
    }
    setRetryPopover((current) => current?.messageId === message.id
      ? null
      : {
        messageId: message.id,
        model: apiConfig.analysisModel || retryModelOptions[0] || "",
      });
  }

  function handleRegenerateMessage(message: ChatMessage, retryModel = retryPopover?.model || apiConfig.analysisModel) {
    if (isRendering || isVisibleChatResponding) {
      showToast(locale === "zh" ? "当前仍有请求在进行中" : "A request is already running");
      return;
    }
    const prompt = findPreviousUserPrompt(message.id);
    if (!prompt) {
      showToast(locale === "zh" ? "没有找到可重新生成的上一条输入" : "No previous user input to regenerate");
      return;
    }
    const previousUserMessage = findPreviousUserMessage(message.id);
    setActivePrimaryView("workspace");
    const activeMessage = withActiveMessageVariant(message);
    if (activeMessage.kind === "analysis" || activeMessage.kind === "render") {
      const sourceResult = activeMessage.sourceResultId ? renderHistory.find((item) => item.id === activeMessage.sourceResultId) : null;
      const nextMode = sourceResult?.generationMode || generationMode;
      setWorkspaceMode("image");
      setComposerMode("new-generation");
      setGenerationMode(nextMode);
      setSelectedPromptModeId(promptModeIdForGenerationMode(nextMode));
      void runConversationFlow(prompt, nextMode, "new-generation", promptModeIdForGenerationMode(nextMode));
      return;
    }
    setWorkspaceMode("chat");
    setComposerMode("new-generation");
    setRetryPopover(null);
    void runDailyChatFlow({
      userPrompt: prompt,
      retryTargetMessageId: message.id,
      retryParentUserMessageId: message.parentId ?? undefined,
      retryModel,
      retryAttachments: previousUserMessage?.attachments,
    });
  }

  function handleEditUserMessage(message: ChatMessage) {
    if (message.role !== "user") return;
    const draft = extractContentText(withActiveMessageVariant(message).content);
    if (!draft) {
      showToast(locale === "zh" ? "这条消息没有可编辑内容" : "This message has no editable content");
      return;
    }
    setActivePrimaryView("workspace");
    setWorkspaceMode("chat");
    setComposerMode("new-generation");
    setEditingMessage({ messageId: message.id, parentId: message.parentId ?? null, draft });
    setRetryPopover(null);
    showToast(locale === "zh" ? "已进入原位编辑，重新发送会创建新分支" : "Editing in place. Resubmitting will create a new branch");
  }

  function updateEditedUserMessageDraft(messageId: string, draft: string) {
    setEditingMessage((current) => current?.messageId === messageId ? { ...current, draft } : current);
  }

  function cancelEditingUserMessage(messageId: string) {
    setEditingMessage((current) => current?.messageId === messageId ? null : current);
  }

  function submitEditedUserMessage(message: ChatMessage) {
    if (!editingMessage || editingMessage.messageId !== message.id) return;
    const draft = editingMessage.draft.trim();
    if (!draft) {
      showToast(locale === "zh" ? "请先输入聊天内容" : "Type a chat message first");
      return;
    }
    const activeMessage = withActiveMessageVariant(message);
    setActivePrimaryView("workspace");
    setWorkspaceMode("chat");
    setComposerMode("new-generation");
    setRetryPopover(null);
    void runDailyChatFlow({
      userPrompt: draft,
      editParentId: editingMessage.parentId,
      submittedAttachments: activeMessage.attachments ?? [],
    });
  }

  function handleEditedUserMessageKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>, message: ChatMessage) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    submitEditedUserMessage(message);
  }

  function handleSwitchMessageBranch(messageId: string, offset: number) {
    const normalized = normalizeMessageTree(messages, activeMessageId);
    if (normalized.messages !== messages) {
      setMessages(normalized.messages);
    }
    const nextActiveId = switchMessageSibling(normalized.messages, messageId, offset);
    setActiveMessageId(nextActiveId);
  }

  function handleMessageFeedback(message: ChatMessage, feedback: "like" | "dislike") {
    const activeMessage = withActiveMessageVariant(message);
    const nextFeedback = message.feedback === feedback ? undefined : feedback;
    updateMessageById(message.id, (currentMessage) => ({ ...currentMessage, feedback: nextFeedback }));
    firePreferenceEvent("assistant_feedback", {
      message_id: message.id,
      message_kind: message.kind,
      feedback: nextFeedback || "cleared",
      content_preview: extractContentText(activeMessage.content).slice(0, 240),
    }, activeMessage.sourceResultId || "");
    showToast(nextFeedback
      ? nextFeedback === "like"
        ? locale === "zh" ? "已记录点赞反馈" : "Positive feedback recorded"
        : locale === "zh" ? "已记录差评反馈" : "Negative feedback recorded"
      : locale === "zh" ? "已取消反馈" : "Feedback cleared");
  }

  function buildBranchDraft(message: ChatMessage) {
    const activeMessage = withActiveMessageVariant(message);
    if (activeMessage.kind === "render" && activeMessage.sourceResultId) {
      const sourceResult = renderHistory.find((item) => item.id === activeMessage.sourceResultId);
      return (sourceResult?.prompt || activeMessage.promptText || buildMessageClipboardText(activeMessage, locale)).trim();
    }
    return buildMessageClipboardText(activeMessage, locale);
  }

  function handleBranchFromMessage(message: ChatMessage) {
    const path = getMessagePathTo(messages, message.id);
    if (path.length === 0) {
      showToast(locale === "zh" ? "这条输出没有可分支的内容" : "This output has no content to branch from");
      return;
    }
    const nextSession = createEmptySession();
    const clonedTree = normalizeMessageTree(cloneMessagePath(path, `branch-${Date.now()}`));
    const clonedMessages = clonedTree.messages;
    const branchedSession: ChatSessionRecord = {
      ...nextSession,
      title: buildSessionTitle(clonedMessages, "", generationMode, workspaceMode),
      messages: clonedMessages,
      activeMessageId: clonedTree.activeMessageId,
      workspaceMode: message.kind === "analysis" || message.kind === "render" ? "image" : "chat",
      generationMode,
      composerMode: "new-generation",
      activeResultId,
    };
    const currentSnapshot = snapshotCurrentSession();
    setChatSessions((current) => {
      const seeded = currentSnapshot ? upsertSession(current, currentSnapshot) : current;
      return upsertSession(seeded, branchedSession);
    });
    selectCurrentSession(branchedSession.id);
    clearAttachments(true);
    applySession(branchedSession);
    showToast(locale === "zh" ? "已创建分支新对话" : "Branched into a new chat");
  }

  async function handleCopyMessage(message: ChatMessage) {
    const activeMessage = withActiveMessageVariant(message);
    if (activeMessage.kind === "render" && activeMessage.imageUrl) {
      await handleCopyImage(activeMessage.imageUrl, activeMessage.imageLabel);
      return;
    }
    const text = buildMessageClipboardText(activeMessage, locale) || activeMessage.imageUrl || "";
    if (!text) {
      showToast(locale === "zh" ? "暂无可复制内容" : "No content to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(locale === "zh" ? "已复制输出内容" : "Output copied");
    } catch {
      showToast(locale === "zh" ? "复制失败，请手动复制" : "Copy failed");
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
    setIsAccountMenuOpen(false);
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

  function findComparisonCandidateForItem(item?: PreviewImage | RenderHistoryItem | null, selectedResult?: RenderHistoryItem | null) {
    if (!item && !selectedResult) {
      return null;
    }
    if (item && "url" in item) {
      return comparisonCandidates.find((candidate) => (
        (item.sourceResultId && candidate.sourceResultId === item.sourceResultId) ||
        candidate.imageUrl === item.url
      )) ?? null;
    }
    const result = selectedResult || (item && !("url" in item) ? item : null);
    if (!result) {
      return null;
    }
    return comparisonCandidates.find((candidate) => (
      candidate.sourceResultId === result.id ||
      candidate.id === result.id ||
      (result.imageUrl && candidate.imageUrl === result.imageUrl)
    )) ?? null;
  }

  function resolveDefaultComparisonPair(item?: PreviewImage | RenderHistoryItem | null, selectedResult?: RenderHistoryItem | null) {
    const uniqueCandidates = uniqueImageComparisonCandidates(comparisonCandidates);
    const targetCandidate = item ? findComparisonCandidateForItem(item, selectedResult) : null;
    if (targetCandidate) {
      const preferredCandidates = targetCandidate.source === "conversation"
        ? uniqueImageComparisonCandidates(conversationComparisonCandidates)
        : uniqueCandidates;
      const leftResult = [...preferredCandidates].reverse().find((candidate) => !areSameImageComparisonCandidate(candidate, targetCandidate)) ??
        [...uniqueCandidates].reverse().find((candidate) => !areSameImageComparisonCandidate(candidate, targetCandidate)) ??
        null;
      return leftResult ? { leftResult, rightResult: targetCandidate } : null;
    }
    const conversationDefaults = uniqueImageComparisonCandidates(conversationComparisonCandidates).slice(-2);
    if (conversationDefaults.length >= 2) {
      return { leftResult: conversationDefaults[0], rightResult: conversationDefaults[1] };
    }
    if (conversationDefaults.length === 1) {
      const rightResult = conversationDefaults[0];
      const leftResult = uniqueCandidates.find((candidate) => !areSameImageComparisonCandidate(candidate, rightResult)) ?? null;
      if (leftResult) {
        return { leftResult, rightResult };
      }
    }
    const fallbackDefaults = uniqueCandidates.slice(-2);
    if (fallbackDefaults.length >= 2) {
      return { leftResult: fallbackDefaults[0], rightResult: fallbackDefaults[1] };
    }
    return null;
  }

  function handleOpenComparison(item?: PreviewImage | RenderHistoryItem | null) {
    const selectedResult = item && !("url" in item) ? item : item?.sourceResultId ? renderHistory.find((result) => result.id === item.sourceResultId) ?? null : activeResult;
    const renderUrl = item && "url" in item ? item.url : selectedResult?.imageUrl;
    const renderLabel = item && "url" in item ? item.label : selectedResult?.imageLabel || selectedResult?.title;
    if (comparableImageCount >= 2) {
      const defaultPair = resolveDefaultComparisonPair(item, selectedResult);
      if (!defaultPair) {
        showToast(locale === "zh" ? "至少需要两张不同的生成图才能对比" : "At least two different generated images are required to compare");
        return;
      }
      setComparisonImage({ mode: "history-vs-history", leftResultId: defaultPair.leftResult.id, rightResultId: defaultPair.rightResult.id });
      setIsComparisonOpen(true);
      firePreferenceEvent("compare", { mode: "history-vs-history" }, selectedResult?.id || "");
      return;
    }
    const resultMode = selectedResult?.generationMode || generationMode;
    if (resultMode === "standard") {
      showToast(locale === "zh" ? "至少需要两张不同的生成图才能对比" : "At least two different generated images are required to compare");
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
    const activeMessage = withActiveMessageVariant(message);
    if (!activeMessage.sourceResultId) {
      return activeResult;
    }
    return renderHistory.find((item) => item.id === activeMessage.sourceResultId) ?? activeResult;
  }

  function isRenderMessageComparisonDisabled(message: ChatMessage) {
    const messageSourceResult = resolveRenderMessageResult(message);
    if (comparableImageCount >= 2) {
      return false;
    }
    const messageResultMode = messageSourceResult?.generationMode || generationMode;
    if (messageResultMode === "standard") {
      return true;
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
    setActivePrimaryView("workspace");
    setWorkspaceMode("image");
    setChatInput(item.prompt);
    setActiveResultId(item.id);
    setComposerMode("new-generation");
    firePreferenceEvent("use_prompt", {
      generation_mode: item.generationMode || generationMode,
      source_title: item.title,
    }, item.id, item.projectId || DEFAULT_PROJECT_ID, item.userId || currentUserId || DEFAULT_PROJECT_ID);
    setSelectedPromptModeId(promptModeIdForGenerationMode(item.generationMode || "standard"));
    showToast(locale === "zh" ? "已把结果提示词载入输入框" : "Prompt loaded into composer");
  }

  function handleEditResult(item: RenderHistoryItem) {
    if (!item.imageUrl) {
      showToast(locale === "zh" ? "这条结果没有可继续修改的图片" : "This result has no image to edit");
      return;
    }
    setActivePrimaryView("workspace");
    setWorkspaceMode("image");
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
    setActivePrimaryView("workspace");
    setWorkspaceMode("image");
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

  async function handleDeleteManyResults(items: RenderHistoryItem[]) {
    const uniqueItems = items.filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index);
    if (uniqueItems.length === 0) return;
    let deletedCount = 0;
    try {
      for (const item of uniqueItems) {
        if (item.id.startsWith("result-")) {
          await deleteResult(item.id, item.userId || currentUserId || DEFAULT_PROJECT_ID);
        }
        removeResultFromState(item.id);
        deletedCount += 1;
      }
      showToast(locale === "zh" ? `已删除 ${deletedCount} 张图片` : `${deletedCount} images deleted`);
    } catch (error) {
      showToast(`${locale === "zh" ? `批量删除中断，已删除 ${deletedCount} 张` : `Batch delete stopped after ${deletedCount} deleted`}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async function handleSubmitAnnotationEdit(instruction: string, annotationImage: Blob) {
    if (isConversationBusy) return;
    const target = annotationTarget;
    if (!target?.id) {
      showToast(locale === "zh" ? "请先选择一张已有结果" : "Select an existing result first");
      return;
    }
    const idBase = Date.now();
    const runGuard = createConversationRunGuard();
    const userBrief = instruction.trim() || (locale === "zh" ? "仅使用图片标注，保持其他区域不变" : "Use the image annotation only and keep other regions unchanged");
    appendMessagesToRunSession(runGuard, [
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
    setRenderingSessionId(runGuard.sessionId);
    setRenderingStep("submitted");
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
        return mergeRenderHistoryItems(newHistoryItems, current);
      });
      applyRunActiveResult(runGuard, historyItem.id);
      setRenderingStep("completed");
      if (isVisibleConversationRun(runGuard)) {
        setActiveStep("completed");
      }
      setAnnotationTarget(null);
      showToast(historyItem.modelWarning || (locale === "zh" ? "标注改图完成，已保存到图片管理" : "Annotated edit completed and saved to images"));
      if (activeUtilityPanel === "preferences") {
        void refreshLearnedProfile(target.projectId || DEFAULT_PROJECT_ID, target.userId || currentUserId || DEFAULT_PROJECT_ID);
      }
      appendMessagesToRunSession(runGuard, [
        {
          id: `m-api-annotation-analysis-${idBase}`,
          role: "assistant",
          kind: "analysis",
          content: {
            zh: "标注改图完成。新版本已保存在历史图片中，并记录了标注图、修改文字和分析结果。",
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
      setRenderingStep("failed");
      if (isVisibleConversationRun(runGuard)) {
        setActiveStep("failed");
      }
      appendMessagesToRunSession(runGuard, [{
        id: `m-api-annotation-error-${idBase}`,
        role: "assistant",
        kind: "error",
        content: `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`
      }]);
    } finally {
      if (isActiveConversationRun(runGuard)) {
        setIsSubmittingAnnotation(false);
        setIsRendering(false);
        setRenderingSessionId("");
        setGenerationStartedAt(null);
        setLiveGeneration(null);
      }
    }
  }

  function applyGenerationProgress(runGuard: ConversationRunGuard, idBase: number, progress: GenerationProgress, parentId?: string | null) {
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
    setRenderingStep(nextStep);
    if (isVisibleConversationRun(runGuard)) {
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
    }
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
      appendMessagesToRunSession(runGuard, [{
        id: `m-live-analysis-${idBase}`,
        parentId: parentId ?? null,
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
      }]);
    }
  }

  function removeLiveAnalysisMessage(runGuard: ConversationRunGuard, idBase: number) {
    removeRunSessionMessage(runGuard, `m-live-analysis-${idBase}`);
  }

  async function runDailyChatFlow(options?: string | {
    userPrompt?: string;
    retryTargetMessageId?: string;
    retryParentUserMessageId?: string;
    editParentId?: string | null;
    retryModel?: string;
    retryAttachments?: ChatImageAttachment[];
    submittedAttachments?: ChatImageAttachment[];
  }) {
    const flowOptions = typeof options === "string" ? { userPrompt: options } : options ?? {};
    const { userPrompt, retryTargetMessageId, retryParentUserMessageId, editParentId, retryModel, retryAttachments, submittedAttachments } = flowOptions;
    if (isRendering || chatRespondingSessionIds.includes(currentSessionIdRef.current)) return;
    const userBrief = (userPrompt ?? chatInput).trim();
    if (!userBrief) {
      showToast(chatBlocker || (locale === "zh" ? "请先输入聊天内容" : "Type a chat message first"));
      return;
    }

    const idBase = Date.now();
    const submittedFiles = [...floorPlanFiles];
    const runGuard = createConversationRunGuard();
    const userMessageId = retryParentUserMessageId ? `m-chat-user-retry-${idBase}` : `m-chat-user-${idBase}`;
    const assistantMessageId = retryTargetMessageId ? `m-chat-ai-retry-${idBase}` : `m-chat-ai-${idBase}`;
    const requestApiConfig = buildRetryApiConfig(apiConfig, retryModel || "");
    const userParentId = retryParentUserMessageId
      ? (messages.find((message) => message.id === retryParentUserMessageId)?.parentId ?? null)
      : editParentId !== undefined
        ? editParentId
        : activeMessageId;
    const providedAttachments = retryAttachments ?? submittedAttachments;
    let chatAttachments: ChatImageAttachment[] = providedAttachments ?? [];
    try {
      if (providedAttachments === undefined) {
        chatAttachments = await buildChatImageAttachments(submittedFiles);
      }
    } catch (error) {
      showToast(`${locale === "zh" ? "读取图片失败" : "Failed to read image"}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const nextPatch: ChatMessage[] = [
      {
        id: userMessageId,
        parentId: userParentId,
        role: "user",
        kind: "text",
        content: userBrief,
        attachments: chatAttachments,
      },
      {
        id: assistantMessageId,
        parentId: userMessageId,
        role: "assistant",
        kind: "text",
        content: ""
      }
    ];
    appendMessagesToRunSession(runGuard, nextPatch);
    if (editParentId !== undefined) {
      setEditingMessage(null);
    }
    if (userPrompt === undefined) {
      clearComposerDraft();
      if (chatAttachments.length > 0) {
        clearAttachments(true);
      }
    }
    const abortController = new AbortController();
    chatAbortControllersRef.current.set(runGuard.sessionId, abortController);
    addChatRespondingSession(runGuard.sessionId);

    let streamedReply = "";
    try {
      const requestMessages = buildLinearChatContext([...messages, nextPatch[0]], userMessageId);
      const updateAssistantMessage = (patch: Partial<ChatMessage>) => {
        updateRunSessionMessage(runGuard, assistantMessageId, (message) => ({
          ...message,
          ...patch,
        }));
      };
      const response = await streamDesignChat(
        {
          message: userBrief,
          user_id: currentUserId || DEFAULT_PROJECT_ID,
          project_id: DEFAULT_PROJECT_ID,
          active_result_id: activeResult?.id || "",
          api_config: requestApiConfig,
          reasoning_effort: chatReasoningEffort,
          context: {
            workspace_mode: "chat",
            chatInput: userBrief,
            retry_target_message_id: retryTargetMessageId || "",
            messages: requestMessages,
            activeResult: activeResult ? {
              id: activeResult.id,
              prompt: activeResult.prompt,
              evaluation: activeResult.evaluation,
              floorDesc: activeResult.floorDesc,
              logs: activeResult.logs
            } : null
          }
        },
        {
          onDelta: (delta) => {
            if (!isActiveConversationRun(runGuard)) return;
            streamedReply += delta;
            updateAssistantMessage({
              kind: "text",
              content: streamedReply,
            });
          },
          onComplete: (streamResponse) => {
            if (!isActiveConversationRun(runGuard)) return;
            streamedReply = streamResponse.reply || streamedReply;
            const extras = buildDailyChatMessageExtras(
              streamResponse.draft_instruction || "",
              streamResponse.memory_candidate
            );
            updateAssistantMessage({
              kind: "text",
              content: streamedReply,
              bullets: extras.bullets,
              draftInstruction: extras.draftInstruction || undefined,
              memoryCandidate: extras.memoryCandidate,
            });
          }
        },
        { signal: abortController.signal }
      );
      if (!isActiveConversationRun(runGuard)) return;
      const extras = buildDailyChatMessageExtras(response.draft_instruction || "", response.memory_candidate);
      updateAssistantMessage({
        kind: "text",
        content: response.reply || streamedReply,
        bullets: extras.bullets,
        draftInstruction: extras.draftInstruction || undefined,
        memoryCandidate: extras.memoryCandidate,
      });
    } catch (error) {
      if (!isActiveConversationRun(runGuard)) return;
      if (isChatStreamAbortedError(error)) {
        updateRunSessionMessage(runGuard, assistantMessageId, (message) => ({
          ...message,
          kind: streamedReply ? "text" : "error",
          content: streamedReply || (locale === "zh" ? "已停止输出。" : "Response stopped."),
          bullets: undefined,
          draftInstruction: undefined,
          memoryCandidate: undefined,
        }));
        return;
      }
      const errorText = `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`;
      updateRunSessionMessage(runGuard, assistantMessageId, (message) => ({
        ...message,
        kind: "error",
        content: errorText,
        bullets: undefined,
        draftInstruction: undefined,
        memoryCandidate: undefined,
      }));
    } finally {
      if (isActiveConversationRun(runGuard)) {
        chatAbortControllersRef.current.delete(runGuard.sessionId);
        removeChatRespondingSession(runGuard.sessionId);
      }
    }
  }

  async function runConversationFlow(
    userPrompt?: string,
    requestedMode: GenerationMode = generationMode,
    requestedComposerMode: ComposerMode = composerMode,
    requestedPromptModeId: PromptModeId = selectedPromptModeId
  ) {
    if (isConversationBusy) return;
    const submitMode = requestedMode;
    const submitComposerMode = requestedComposerMode;
    const submitPromptModeId = submitMode === "standard" && requestedPromptModeId.startsWith("skill-")
      ? requestedPromptModeId
      : promptModeIdForGenerationMode(submitMode);
    const prompt = buildGenerationPrompt(userPrompt, submitMode, submitPromptModeId);
    const userBrief = (userPrompt ?? chatInput).trim();
    const submitBlocker = submitComposerMode === "edit-selected-result"
      ? generationBlocker
      : getGenerationBlocker(submitMode, userBrief);
    if (submitBlocker) {
      showToast(submitBlocker || (locale === "zh" ? "请先补齐生成输入" : "Complete the generation inputs first"));
      return;
    }
    const displayedBrief = userBrief || (submitMode === "colored_floor_plan"
      ? locale === "zh" ? "生成彩色平面图" : "Generate a colored floor plan"
      : "");
    const isFloorPlanInputMode = submitMode === "render3d" || submitMode === "colored_floor_plan";
    const idBase = Date.now();
    const runGuard = createConversationRunGuard();
    const userMessageId = `m-user-${idBase}`;
    const userParentId = activeMessageId;
    const nextMessages: ChatMessage[] = [{
      id: userMessageId,
      parentId: userParentId,
      role: "user",
      kind: "text",
      content: displayedBrief
    }];
    appendMessagesToRunSession(runGuard, nextMessages);
    if (userPrompt === undefined) {
      clearComposerDraft();
    }
    const abortController = new AbortController();
    generationAbortControllersRef.current.set(runGuard.sessionId, abortController);
    setGenerationStartedAt(Date.now());
    setGenerationElapsedMs(0);
    setLiveGeneration(null);
    setRenderingSessionId(runGuard.sessionId);
    setRenderingStep("submitted");
    setIsRendering(true);
    setActiveStep("submitted");

    try {
      if (submitComposerMode === "edit-selected-result") {
        const shouldEditUploadedReference = floorPlanFiles.length > 0;
        if (!activeResult?.id && !shouldEditUploadedReference) {
          throw new Error(locale === "zh" ? "请先选择一张已有结果，或上传一张参考图" : "Select an existing result or upload a reference image first");
        }
        if (shouldEditUploadedReference) {
          const result = await requestGenerationStream(
            {
              projectId: DEFAULT_PROJECT_ID,
              userId: currentUserId || DEFAULT_PROJECT_ID,
              mode: "standard",
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
              applyGenerationProgress(runGuard, idBase, progress, userMessageId);
            },
            { signal: abortController.signal }
          );
          if (!isActiveConversationRun(runGuard)) return;
          const firstImage = result.images?.[0];
          const backendItems = result.results?.map(normalizeApiResult) ?? [];
          const fallbackItem: RenderHistoryItem = {
            id: `r-${idBase}`,
            title: firstImage?.label || (locale === "zh" ? `上传图续改 ${new Date().toLocaleTimeString()}` : `Uploaded edit ${new Date().toLocaleTimeString()}`),
            status: result.status,
            imageUrl: firstImage?.url || firstImage?.data_url,
            downloadUrl: firstImage?.download_url,
            imageLabel: firstImage?.label,
            prompt: result.prompt,
            evaluation: result.evaluation,
            floorDesc: result.floor_desc,
            logs: result.logs,
            createdAt: new Date().toISOString(),
            generationMode: "standard",
          };
          const newHistoryItems = (backendItems.length > 0 ? backendItems : [fallbackItem]).map((item) => ({
            ...item,
            generationMode: item.generationMode || "standard",
          }));
          const historyItem = newHistoryItems[0];
          setRenderHistory((current) => {
            return mergeRenderHistoryItems(newHistoryItems, current);
          });
          applyRunActiveResult(runGuard, historyItem.id);
          setRenderingStep("completed");
          if (isVisibleConversationRun(runGuard)) {
            setActiveStep("completed");
          }
          showToast(locale === "zh" ? "上传图续改完成，已保存到图片管理" : "Uploaded image edit completed and saved to images");
          if (activeUtilityPanel === "preferences") {
            void refreshLearnedProfile(DEFAULT_PROJECT_ID, currentUserId || DEFAULT_PROJECT_ID);
          }
          removeLiveAnalysisMessage(runGuard, idBase);
          const finalPrompt = result.prompt || prompt;
          appendMessagesToRunSession(runGuard, [
            {
              id: `m-api-analysis-${idBase}`,
              parentId: userMessageId,
              role: "assistant",
              kind: "analysis",
              content: {
                zh: "上传图续改完成。默认模式已把上传图片作为参考图，并按输入框要求生成新图。",
                en: "Uploaded image edit completed. Default mode used the uploaded image as a reference and generated a new image from the request."
              },
              bullets: {
                zh: compactLines([result.status || "", finalPrompt ? "最终提示词已生成" : ""]),
                en: compactLines([result.status || "", finalPrompt ? "Final prompt generated" : ""])
              },
              promptText: finalPrompt
            },
            {
              id: `m-api-render-${idBase}`,
              parentId: `m-api-analysis-${idBase}`,
              role: "assistant",
              kind: "render",
              content: result.ok ? (locale === "zh" ? "基于上传图的生成结果已返回" : "Reference-image result returned") : result.error || t.requestFailed,
              imageUrl: historyItem.imageUrl || firstImage?.data_url || firstImage?.url,
              imageLabel: historyItem.imageLabel || firstImage?.label,
              sourceResultId: historyItem.id,
            }
          ]);
          return;
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
        }, { signal: abortController.signal });
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
          return mergeRenderHistoryItems(newHistoryItems, current);
        });
        applyRunActiveResult(runGuard, historyItem.id);
        setRenderingStep("completed");
        if (isVisibleConversationRun(runGuard)) {
          setActiveStep("completed");
        }
        showToast(locale === "zh" ? "改图完成，已保存到图片管理" : "Image edit completed and saved to images");
        if (activeUtilityPanel === "preferences") {
          void refreshLearnedProfile(activeResult.projectId || DEFAULT_PROJECT_ID, activeResult.userId || currentUserId || DEFAULT_PROJECT_ID);
        }
        removeLiveAnalysisMessage(runGuard, idBase);
        appendMessagesToRunSession(runGuard, [
          {
            id: `m-api-analysis-${idBase}`,
            parentId: userMessageId,
            role: "assistant",
            kind: "analysis",
            content: {
              zh: "改图完成。新版本已保存在历史图片中，并与上一版建立版本关系。",
              en: "Image edit completed. The new version is saved in image history and linked to the previous version."
            },
            bullets: {
              zh: compactLines([historyItem.status || "", historyItem.editInstruction ? `修改要求：${historyItem.editInstruction}` : "", historyItem.versionIndex ? `版本 v${historyItem.versionIndex}` : ""]),
              en: compactLines([historyItem.status || "", historyItem.editInstruction ? `Edit: ${historyItem.editInstruction}` : "", historyItem.versionIndex ? `Version v${historyItem.versionIndex}` : ""])
            },
            promptText: historyItem.prompt
          },
          {
            id: `m-api-render-${idBase}`,
            parentId: `m-api-analysis-${idBase}`,
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
          applyGenerationProgress(runGuard, idBase, progress, userMessageId);
        },
        { signal: abortController.signal }
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
        floorPlanUrl: isFloorPlanInputMode ? floorPlanPreviews[0]?.url : undefined,
        floorPlanName: isFloorPlanInputMode ? floorPlanPreviews[0]?.name : undefined
      };
      const newHistoryItems = (backendItems.length > 0 ? backendItems : [fallbackItem]).map((item) => ({
        ...item,
        generationMode: item.generationMode || submitMode,
        floorPlanUrl: item.floorPlanUrl || (isFloorPlanInputMode ? floorPlanPreviews[0]?.url : undefined),
        floorPlanName: item.floorPlanName || (isFloorPlanInputMode ? floorPlanPreviews[0]?.name : undefined)
      }));
      const historyItem = newHistoryItems[0];
      setRenderHistory((current) => {
        return mergeRenderHistoryItems(newHistoryItems, current);
      });
      applyRunActiveResult(runGuard, historyItem.id);
      setRenderingStep("completed");
      if (isVisibleConversationRun(runGuard)) {
        setActiveStep("completed");
      }
      showToast(locale === "zh" ? "生成完成，已保存到图片管理" : "Generation completed and saved to images");
      if (activeUtilityPanel === "preferences") {
        void refreshLearnedProfile(DEFAULT_PROJECT_ID, currentUserId || DEFAULT_PROJECT_ID);
      }
      const finalPrompt = result.prompt || prompt;
      removeLiveAnalysisMessage(runGuard, idBase);
      const resultMessages: ChatMessage[] = [
        {
          id: `m-api-analysis-${idBase}`,
          parentId: userMessageId,
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
          parentId: `m-api-analysis-${idBase}`,
          role: "assistant",
          kind: "render",
          content: result.ok ? (locale === "zh" ? "真实渲染结果已返回" : "Real render result returned") : result.error || t.requestFailed,
          imageUrl: historyItem.imageUrl || firstImage?.data_url || firstImage?.url,
          imageLabel: historyItem.imageLabel || firstImage?.label,
          sourceResultId: historyItem.id,
        }
      ];
      appendMessagesToRunSession(runGuard, resultMessages);
    } catch (error) {
      if (!isActiveConversationRun(runGuard)) return;
      if (isGenerationStreamAbortedError(error) || error instanceof DOMException && error.name === "AbortError") {
        removeLiveAnalysisMessage(runGuard, idBase);
        setRenderingStep("completed");
        if (isVisibleConversationRun(runGuard)) {
          setActiveStep("completed");
        }
        appendMessagesToRunSession(runGuard, [{
          id: `m-api-stopped-${idBase}`,
          parentId: userMessageId,
          role: "assistant",
          kind: "text",
          content: locale === "zh" ? "已停止生成。" : "Generation stopped."
        }]);
        return;
      }
      setRenderingStep("failed");
      if (isVisibleConversationRun(runGuard)) {
        setActiveStep("failed");
      }
      appendMessagesToRunSession(runGuard, [{
        id: `m-api-error-${idBase}`,
        parentId: userMessageId,
        role: "assistant",
        kind: "error",
        content: `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`
      }]);
    } finally {
      if (isActiveConversationRun(runGuard)) {
        generationAbortControllersRef.current.delete(runGuard.sessionId);
        setIsRendering(false);
        setRenderingSessionId("");
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
    void runConversationFlow(undefined, "colored_floor_plan", "new-generation", promptModeIdForGenerationMode("colored_floor_plan"));
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

  async function handleDetectModels(role: ConfigRole) {
    const label = locale === "zh" ? (role === "analysis" ? "分析模型" : "画图模型") : role === "analysis" ? "analysis models" : "image models";
    const action: ConfigAction = role === "analysis" ? "models-analysis" : "models-image";
    setConfigAction(action);
    setConfigStatus({ tone: "warn", message: locale === "zh" ? `正在检测${label}...` : `Detecting ${label}...` });
    try {
      const models = await detectConfigModels(role, apiConfig);
      const usableModels = modelSelectOptions("", models);
      setDetectedModels((current) => ({
        ...current,
        [role]: modelSelectOptions("", current[role], usableModels)
      }));
      setConfigStatus({
        tone: usableModels.length ? "good" : "warn",
        message: usableModels.length
          ? locale === "zh"
            ? `检测到 ${usableModels.length} 个${label}，可多选后加入配置`
            : `Detected ${usableModels.length} ${label}; select one or more to add`
          : locale === "zh"
            ? `没有检测到可用${label}`
            : `No ${label} were detected`
      });
    } catch (error) {
      setConfigStatus({
        tone: "warn",
        message: `${locale === "zh" ? `${label}检测失败` : `${label} detection failed`}: ${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      setConfigAction(null);
    }
  }

  function toggleDetectedAnalysisModel(model: string) {
    const trimmedModel = model.trim();
    if (!trimmedModel) return;
    const isSelected = selectedAnalysisModelOptions.includes(trimmedModel);
    const nextModels = isSelected
      ? selectedAnalysisModelOptions.filter((item) => item !== trimmedModel)
      : [...selectedAnalysisModelOptions, trimmedModel];
    setAddedDetectedModels((current) => {
      storeAnalysisModelOptions(currentUserId, nextModels);
      return {
        ...current,
        analysis: nextModels
      };
    });
    if (!apiConfig.analysisModel && nextModels.length > 0) {
      updateAnalysisProvider({ model: nextModels[0] });
    } else if (apiConfig.analysisModel === trimmedModel && isSelected) {
      updateAnalysisProvider({ model: nextModels[0] || "" });
    }
    showToast(isSelected
      ? locale === "zh" ? `已取消分析模型：${trimmedModel}` : `Removed analysis model: ${trimmedModel}`
      : locale === "zh" ? `已选择分析模型：${trimmedModel}` : `Selected analysis model: ${trimmedModel}`);
  }

  function toggleDetectedImageModel(model: string) {
    const selectedModels = modelSelectOptions(apiConfig.imageModel, parseModelListText(apiConfig.fallbackModels));
    const nextModels = selectedModels.includes(model)
      ? selectedModels.filter((item) => item !== model)
      : [...selectedModels, model];
    applyImageModelOptions(nextModels);
    showToast(nextModels.includes(model)
      ? locale === "zh" ? `已勾选画图模型：${model}` : `Selected image model: ${model}`
      : locale === "zh" ? `已取消画图模型：${model}` : `Removed image model: ${model}`);
  }

  function removeAnalysisModelOption(model: string) {
    const targetModel = model.trim();
    if (!targetModel) return;
    const nextModels = selectedAnalysisModelOptions.filter((item) => item !== targetModel);
    const nextDefaultModel = apiConfig.analysisModel === targetModel ? nextModels[0] || "" : apiConfig.analysisModel;
    const nextAddedModels = nextModels.filter((item) => item !== nextDefaultModel);
    setAddedDetectedModels((current) => {
      const analysis = modelSelectOptions("", nextAddedModels);
      storeAnalysisModelOptions(currentUserId, modelSelectOptions(nextDefaultModel, analysis));
      return {
        ...current,
        analysis
      };
    });
    if (apiConfig.analysisModel === targetModel) {
      updateAnalysisProvider({ model: nextDefaultModel });
    }
    showToast(locale === "zh" ? `已删除分析模型：${targetModel}` : `Removed analysis model: ${targetModel}`);
  }

  function applyImageModelOptions(models: string[]) {
    const nextModels = modelSelectOptions("", models);
    const [primaryModel = "", ...fallbackModels] = nextModels;
    setApiConfig((current) => ({
      ...syncActiveProvider(current, "image", { model: primaryModel }),
      fallbackModels: fallbackModels.join("\n")
    }));
    setAddedDetectedModels((current) => ({
      ...current,
      image: nextModels
    }));
    setSelectedModel(primaryModel || modelOptions[0]);
    return nextModels;
  }

  function removeImageModelOption(model: string) {
    const targetModel = model.trim();
    if (!targetModel) return;
    applyImageModelOptions(selectedImageModelOptions.filter((item) => item !== targetModel));
    showToast(locale === "zh" ? `已删除画图模型：${targetModel}` : `Removed image model: ${targetModel}`);
  }

  function applyDetectedModels(role: ConfigRole) {
    const models = detectedModels[role];
    if (models.length === 0) {
      showToast(locale === "zh" ? "请先搜索模型" : "Search models first");
      return;
    }
    if (role === "analysis") {
      const nextModels = modelSelectOptions(apiConfig.analysisModel, addedDetectedModels.analysis, models);
      const primaryModel = apiConfig.analysisModel || nextModels[0] || "";
      updateAnalysisProvider({ model: primaryModel });
      setAddedDetectedModels((current) => {
        const analysis = modelSelectOptions("", current.analysis, nextModels);
        storeAnalysisModelOptions(currentUserId, analysis);
        return {
          ...current,
          analysis
        };
      });
      showToast(locale === "zh" ? "分析模型已加入聊天模型切换" : "Analysis models added to chat model switcher");
      return;
    }
    const nextModels = modelSelectOptions(apiConfig.imageModel, parseModelListText(apiConfig.fallbackModels), models);
    applyImageModelOptions(nextModels);
    showToast(locale === "zh" ? `已加入 ${nextModels.length} 个画图模型` : `Added ${nextModels.length} image models`);
  }

  async function handleSaveApiConfig() {
    setConfigAction("save");
    setConfigStatus({
      tone: "warn",
      message: locale === "zh" ? "正在保存到当前账号..." : "Saving to the current account..."
    });
    try {
      window.localStorage.setItem(apiConfigStorageKey(currentUserId), JSON.stringify(apiConfig));
      storeAnalysisModelOptions(currentUserId, selectedAnalysisModelOptions);
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
    setApiConfig(normalizeApiConfig(defaultApiConfig));
    setSelectedModel(defaultApiConfig.imageModel || modelOptions[0]);
    setDetectedModels({ analysis: [], image: [] });
    setAddedDetectedModels({ analysis: [], image: [] });
    setVisibleApiKeys({ analysis: false, image: false });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(analysisModelOptionsStorageKey(currentUserId));
    }
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
    ? comparisonCandidates.find((item) => item.id === comparisonImage.leftResultId) ?? null
    : null;
  const comparisonRightResult = comparisonImage?.mode === "history-vs-history"
    ? comparisonCandidates.find((item) => item.id === comparisonImage.rightResultId) ?? null
    : null;
  const comparisonSourceLabel = (candidate: ImageComparisonCandidate) => (
    candidate.source === "conversation"
      ? locale === "zh" ? "当前聊天" : "Current chat"
      : locale === "zh" ? "图片库" : "Image library"
  );
  const comparisonOptionLabel = (candidate: ImageComparisonCandidate) => `${comparisonSourceLabel(candidate)} · ${candidate.label}`;
  const activeSettingsPanel = isSettingsPanel(activeUtilityPanel) ? activeUtilityPanel : null;
  const isShortcutDrawerOpen = activeUtilityPanel === "shortcuts" && !isImageManagementView;
  const isSettingsDialogOpen = activeSettingsPanel !== null && !isImageManagementView;
  const layoutStyle = {
    "--chatgpt-sidebar-width": `${isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth}px`,
    "--chatgpt-drawer-width": `${drawerWidth}px`,
  } as CSSProperties;

  return (
    <main
      className={`studio-shell ${isVisibleRendering ? "is-rendering" : ""} ${isDraggingFiles ? "is-dragging-files" : ""}`}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
    >
      {isDraggingFiles && (
        <div className="drop-overlay" aria-hidden="true">
          <div>
            <ImagePlus size={24} />
            <strong>{locale === "zh" ? "释放图片以添加参考图/平面图" : "Drop images to add references or floor plans"}</strong>
            <span>{locale === "zh" ? "默认模式用于图生图，3D/彩色平面图模式用于结构参考" : "Default mode uses them as references; 3D and colored-plan modes use them as structure inputs"}</span>
          </div>
        </div>
      )}

      <div className={`chatgpt-layout ${isShortcutDrawerOpen ? "has-drawer" : ""} ${isImageManagementView ? "has-management-view" : ""} ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""}`} style={layoutStyle}>
        {!isSidebarCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={locale === "zh" ? "调整左侧边栏宽度" : "Resize the left sidebar"}
            className="chatgpt-layout__resize-handle chatgpt-layout__resize-handle--sidebar"
            onPointerDown={(event) => beginPanelResize("sidebar", sidebarWidth, event)}
          />
        )}
        <aside className="chatgpt-sidebar" aria-label={locale === "zh" ? "侧边栏" : "Sidebar"}>
          <div className="chatgpt-sidebar__brand-row">
            <div className="chatgpt-sidebar__brand">
              <div className="brand-mark">
                <Aperture size={18} />
              </div>
              {!isSidebarCollapsed && (
                <div>
                  <strong>{t.appName}</strong>
                  <span>{locale === "zh" ? "聊天优先，图像辅助" : "Chat first, image assisted"}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="chatgpt-sidebar__icon-button"
              onClick={toggleSidebarCollapsed}
              aria-label={isSidebarCollapsed ? (locale === "zh" ? "展开侧边栏" : "Expand sidebar") : (locale === "zh" ? "收起侧边栏" : "Collapse sidebar")}
              title={isSidebarCollapsed ? (locale === "zh" ? "展开侧边栏" : "Expand sidebar") : (locale === "zh" ? "收起侧边栏" : "Collapse sidebar")}
            >
              {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
          </div>

          <button
            type="button"
            className={`chatgpt-sidebar__new-chat ${isSidebarCollapsed ? "is-collapsed" : ""} ${canStartNewConversation ? "" : "is-empty-session"} ${!isImageManagementView && activeUtilityPanel === null ? "is-active" : ""}`}
            onClick={handleResetWorkspace}
            disabled={isRendering}
            title={!canStartNewConversation
              ? (locale === "zh" ? "当前已经是空白新对话；点击可清空草稿并聚焦输入框" : "Current chat is already blank; click to clear draft state and focus the composer")
              : (locale === "zh" ? "新建对话" : "Start a new chat")}
          >
            <Plus size={15} />
            {!isSidebarCollapsed && <span>{locale === "zh" ? "新对话" : "New chat"}</span>}
          </button>

          <div className="chatgpt-sidebar__section chatgpt-sidebar__nav">
            {!isSidebarCollapsed && <p className="chatgpt-sidebar__label">{locale === "zh" ? "主导航" : "Primary nav"}</p>}
            <button
              type="button"
              className={`${isImageManagementView ? "is-active" : ""} ${isSidebarCollapsed ? "is-icon-only" : ""}`}
              onClick={openImageManagementView}
              title={locale === "zh" ? "图片管理" : "Image management"}
            >
              <span className="chatgpt-sidebar__tool-icon">
                <ImagePlus size={15} />
              </span>
              {!isSidebarCollapsed && (
                <span className="chatgpt-sidebar__tool-copy">
                  <strong>{locale === "zh" ? "图片管理" : "Image management"}</strong>
                  <small>{locale === "zh" ? `管理 ${renderHistory.length} 张历史生成图` : `Manage ${renderHistory.length} generated images`}</small>
                </span>
              )}
            </button>
          </div>

          {!isSidebarCollapsed && (
            <div className={`chatgpt-sidebar__section chatgpt-sidebar__history ${isChatHistoryOpen ? "is-open" : "is-collapsed"}`}>
              <button
                type="button"
                className="chatgpt-sidebar__history-toggle"
                aria-expanded={isChatHistoryOpen}
                onClick={() => setIsChatHistoryOpen((current) => !current)}
              >
                <span>{locale === "zh" ? "历史聊天" : "Chat history"}</span>
                <small>{sidebarHistoryTotal}</small>
                <ChevronDown size={14} />
              </button>
              {isChatHistoryOpen && (
                <>
                  <label className="chatgpt-sidebar__history-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      value={chatHistoryQuery}
                      onChange={(event) => setChatHistoryQuery(event.target.value)}
                      placeholder={locale === "zh" ? "搜索历史聊天" : "Search history"}
                    />
                  </label>
                  {sidebarHistoryItems.length === 0 ? (
                    <div className="chatgpt-sidebar__empty">
                      {normalizedHistoryQuery
                        ? locale === "zh" ? "没有匹配的历史聊天" : "No matching chat history"
                        : locale === "zh" ? "还没有历史聊天" : "No chat history yet"}
                    </div>
                  ) : (
                    sidebarHistoryItems.map((item) => {
                      const isRenaming = renamingSessionId === item.id;
                      return (
                        <div
                          className={`chatgpt-sidebar__history-item ${currentSessionId === item.id ? "is-active" : ""} ${activeHistoryMenuId === item.id ? "has-menu" : ""}`}
                          key={item.id}
                        >
                          {isRenaming ? (
                            <form
                              className="chatgpt-sidebar__history-rename"
                              onSubmit={(event) => {
                                event.preventDefault();
                                commitRenameSession(item.id);
                              }}
                            >
                              <input
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onBlur={() => commitRenameSession(item.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setRenamingSessionId(null);
                                    setRenameDraft("");
                                  }
                                }}
                                aria-label={locale === "zh" ? "重命名聊天" : "Rename chat"}
                                autoFocus
                              />
                            </form>
                          ) : (
                            <button
                              type="button"
                              className="chatgpt-sidebar__history-open"
                              onClick={() => handleOpenSession(item.id)}
                            >
                              <span className="chatgpt-sidebar__history-title">
                                {item.pinnedAt && <Pin size={12} aria-hidden="true" />}
                                {sessionDisplayTitle(item)}
                              </span>
                              <small>{new Date(item.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                            </button>
                          )}
                          {!isRenaming && (
                            <button
                              type="button"
                              className="chatgpt-sidebar__history-more"
                              onClick={(event) => handleToggleHistoryMenu(item.id, event.currentTarget)}
                              aria-expanded={activeHistoryMenuId === item.id}
                              aria-label={locale === "zh" ? "聊天操作" : "Chat actions"}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          )}
                          {activeHistoryMenuId === item.id && (
                            <div
                              className="chatgpt-sidebar__history-menu"
                              role="menu"
                              style={historyMenuPosition
                                ? { top: historyMenuPosition.top, left: historyMenuPosition.left }
                                : undefined}
                            >
                              <button type="button" role="menuitem" onClick={() => handleStartRenameSession(item)}>
                                <Edit3 size={16} />
                                <span>{locale === "zh" ? "重命名" : "Rename"}</span>
                              </button>
                              <button type="button" role="menuitem" onClick={() => handleTogglePinSession(item.id)}>
                                <Pin size={16} />
                                <span>{item.pinnedAt
                                  ? locale === "zh" ? "取消置顶" : "Unpin chat"
                                  : locale === "zh" ? "置顶聊天" : "Pin chat"}</span>
                              </button>
                              <div className="chatgpt-sidebar__history-menu-separator" />
                              <button type="button" role="menuitem" className="is-danger" onClick={() => handleDeleteSession(item.id)}>
                                <Trash2 size={16} />
                                <span>{locale === "zh" ? "删除" : "Delete"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          )}

          <div className="chatgpt-sidebar__footer" ref={accountMenuRef}>
            <button
              type="button"
              className={`chatgpt-sidebar__account-button ${isAccountMenuOpen ? "is-open" : ""} ${isSidebarCollapsed ? "is-collapsed" : ""}`}
              onClick={toggleAccountMenu}
              aria-expanded={isAccountMenuOpen}
              title={authUser ? undefined : (locale === "zh" ? "登录" : "Sign in")}
            >
              <span className="chatgpt-sidebar__account-avatar">
                {authUser?.username?.slice(0, 1).toUpperCase() || <User size={15} />}
              </span>
              {!isSidebarCollapsed && (
                <>
                  <span className="chatgpt-sidebar__account-copy">
                    <strong>{authUser?.username || (locale === "zh" ? "未登录" : "Guest")}</strong>
                    <small>{isSettingsPanel(activeUtilityPanel) ? (locale === "zh" ? "设置已打开" : "Settings open") : (locale === "zh" ? "账户与设置" : "Account & settings")}</small>
                  </span>
                  <ChevronDown size={15} />
                </>
              )}
            </button>
            {isAccountMenuOpen && authUser && (
              <div className={`chatgpt-sidebar__account-menu ${isSidebarCollapsed ? "is-collapsed" : ""}`} role="menu" aria-label={locale === "zh" ? "账户菜单" : "Account menu"}>
                <button type="button" className="chatgpt-sidebar__account-summary" role="menuitem">
                  <span className="chatgpt-sidebar__account-avatar">{authUser.username.slice(0, 1).toUpperCase()}</span>
                  <span className="chatgpt-sidebar__account-copy">
                    <strong>{authUser.username}</strong>
                    <small>{currentHeaderModelLabel}</small>
                  </span>
                  <ChevronDown size={15} />
                </button>
                <div className="chatgpt-sidebar__account-menu-separator" />
                <button type="button" className={activeUtilityPanel === "preferences" ? "is-active" : ""} role="menuitem" onClick={() => openSettingsPanel("preferences")}>
                  <User size={16} />
                  <span>{locale === "zh" ? "个性化" : "Personalization"}</span>
                </button>
                <button type="button" className={activeUtilityPanel === "setup" ? "is-active" : ""} role="menuitem" onClick={() => openSettingsPanel("setup")}>
                  <SlidersHorizontal size={16} />
                  <span>{locale === "zh" ? "设置" : "Settings"}</span>
                </button>
                <button type="button" className={activeUtilityPanel === "generation" ? "is-active" : ""} role="menuitem" onClick={() => openSettingsPanel("generation")}>
                  <Aperture size={16} />
                  <span>{locale === "zh" ? "模型与出图" : "Models & generation"}</span>
                </button>
                <button type="button" className={activeUtilityPanel === "analysis" ? "is-active" : ""} role="menuitem" onClick={() => openSettingsPanel("analysis")}>
                  <Sparkles size={16} />
                  <span>{locale === "zh" ? "高级功能" : "Advanced"}</span>
                </button>
                <button type="button" className={activeUtilityPanel === "prompts" ? "is-active" : ""} role="menuitem" onClick={() => openSettingsPanel("prompts")}>
                  <FileText size={16} />
                  <span>{locale === "zh" ? "提示词设置" : "Prompt settings"}</span>
                </button>
                <div className="chatgpt-sidebar__account-menu-separator" />
                <button type="button" role="menuitem" onClick={() => openSettingsPanel("setup")}>
                  <CircleHelp size={16} />
                  <span>{locale === "zh" ? "帮助与配置" : "Help & setup"}</span>
                </button>
                <button type="button" className="is-danger" role="menuitem" onClick={() => void handleLogout()}>
                  <LogOut size={16} />
                  <span>{locale === "zh" ? "退出登录" : "Log out"}</span>
                </button>
              </div>
            )}
          </div>

        </aside>

        <section className={`chatgpt-main ${isImageManagementView ? "chatgpt-main--management" : ""} ${isEmptyConversation && !isImageManagementView ? "chatgpt-main--empty-conversation" : ""}`}>
          {isImageManagementView ? (
            <ImageManagementPage
              locale={locale}
              items={renderHistory}
              activeId={activeResultId}
              isRefreshing={isRefreshingResults}
              onBackToWorkspace={returnToWorkspaceView}
              onSelect={setActiveResultId}
              onRefresh={() => refreshResultsFromServer()}
              onOpen={handleOpenResult}
              onDownload={handleDownloadResult}
              onCopy={handleCopyRunSummary}
              onUsePrompt={handleUseResultPrompt}
              onEdit={handleEditResult}
              onRemove={handleRemoveResult}
              onDeleteMany={handleDeleteManyResults}
            />
          ) : (
            <>
          <header className={`chatgpt-main__header chatgpt-main__header--${workspaceMode}`}>
            <button
              type="button"
              className="chatgpt-main__model-pill"
              onClick={() => openSettingsPanel(isChatWorkspace ? "setup" : "generation")}
              title={locale === "zh" ? "查看当前模型设置" : "View current model setup"}
            >
              <Aperture size={15} />
              <span className="chatgpt-main__model-pill-copy">
                <strong title={currentHeaderModelLabel}>{currentHeaderModelLabel}</strong>
                <small>{composerMode === "edit-selected-result" && isImageWorkspace ? (locale === "zh" ? "继续改图" : "Editing source") : currentWorkspaceLabel}</small>
              </span>
              <StatusBadge tone={isVisibleRendering ? "warn" : hasRunFailure ? "warn" : "good"}>{projectState}</StatusBadge>
            </button>
            <div className="workspace-mode-toggle" aria-label={locale === "zh" ? "工作区模式" : "Workspace mode"}>
              <button
                type="button"
                className={workspaceMode === "chat" ? "is-active" : ""}
                aria-pressed={workspaceMode === "chat"}
                onClick={() => switchWorkspaceMode("chat")}
                disabled={isVisibleConversationBusy}
              >
                <MessageCircle size={14} />
                {locale === "zh" ? "聊天" : "Chat"}
              </button>
              <button
                type="button"
                className={workspaceMode === "image" ? "is-active" : ""}
                aria-pressed={workspaceMode === "image"}
                onClick={() => switchWorkspaceMode("image")}
                disabled={isVisibleConversationBusy}
              >
                <Camera size={14} />
                {locale === "zh" ? "图像" : "Image"}
              </button>
            </div>
            <div className={`chatgpt-main__actions chatgpt-main__actions--${workspaceMode}`}>
              <div className="chatgpt-main__action-group">
                {isImageWorkspace && composerMode === "edit-selected-result" && (
                  <button
                    type="button"
                    onClick={handleNewGenerationMode}
                    aria-label={locale === "zh" ? "回到新生成" : "Back to new generation"}
                    title={locale === "zh" ? "回到新生成" : "Back to new generation"}
                  >
                    <RotateCcw size={14} />
                    <span className="chatgpt-main__action-label">{locale === "zh" ? "回到新生成" : "Back to new"}</span>
                  </button>
                )}
                {isImageWorkspace && (
                  <div className="quick-phrase-popover">
                    <div className="quick-phrase-popover__actions">
                      <button
                        type="button"
                        className={activeUtilityPanel === "shortcuts" ? "is-active" : ""}
                        onClick={() => toggleUtilityPanel("shortcuts")}
                        aria-label={locale === "zh" ? "管理快捷短语" : "Manage shortcut phrases"}
                        title={locale === "zh" ? "自定义、编辑或删除快捷短语" : "Customize, edit, or delete shortcut phrases"}
                      >
                        <Edit3 size={14} />
                        <span className="chatgpt-main__action-label">{locale === "zh" ? "管理短语" : "Manage phrases"}</span>
                      </button>
                      {composerMode === "new-generation" && shortcutPhrases.length > 0 && (
                        <button
                          type="button"
                          className={isQuickPhraseCardOpen ? "is-active" : ""}
                          onClick={() => {
                            setActivePrimaryView("workspace");
                            setActiveUtilityPanel(null);
                            setIsAccountMenuOpen(false);
                            setIsQuickPhraseCardOpen((current) => !current);
                          }}
                          aria-expanded={isQuickPhraseCardOpen}
                          aria-label={locale === "zh" ? "展开快捷短语" : "Open quick phrases"}
                          title={locale === "zh" ? "展开快捷短语" : "Open quick phrases"}
                        >
                          <Clipboard size={14} />
                          <span className="chatgpt-main__action-label">{locale === "zh" ? "快捷短语" : "Quick phrases"}</span>
                        </button>
                      )}
                    </div>
                    {isQuickPhraseCardOpen && composerMode === "new-generation" && shortcutPhrases.length > 0 && (
                      <div className="quick-phrase-card" role="dialog" aria-label={locale === "zh" ? "快捷短语" : "Quick phrases"}>
                        <div className="quick-phrase-card__list">
                          {shortcutPhrases.slice(0, QUICK_PHRASE_VISIBLE_LIMIT).map((item) => {
                            const text = shortcutText(item);
                            return (
                              <button type="button" key={item.id} onClick={() => handleInsertQuickPhrase(text)} title={locale === "zh" ? "插入快捷短语" : "Insert shortcut phrase"}>
                                {text}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {isImageWorkspace && (
                <div className="chatgpt-main__action-group chatgpt-main__action-group--result">
                  <button
                    type="button"
                    onClick={() => handleOpenResult(activeResult)}
                    disabled={!activeResult?.imageUrl}
                    aria-label={locale === "zh" ? "预览当前结果" : "Preview current result"}
                    title={locale === "zh" ? "预览当前结果" : "Preview current result"}
                  >
                    <Eye size={14} />
                    <span className="chatgpt-main__action-label">{locale === "zh" ? "预览" : "Preview"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenComparison()}
                    disabled={!canCompareActiveResult}
                    aria-label={locale === "zh" ? "对比当前结果" : "Compare current result"}
                    title={locale === "zh" ? "对比当前结果" : "Compare current result"}
                  >
                    <FileText size={14} />
                    <span className="chatgpt-main__action-label">{locale === "zh" ? "对比" : "Compare"}</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className={`chatgpt-thread ${isEmptyConversation ? "is-empty" : ""}`} aria-label={t.designChat} ref={chatThreadRef}>
            {isEmptyConversation ? (
              null
            ) : (
              <>
                {isVisibleRendering && (
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
                        <span className={["submitted", "analysis", "rendering", "evaluating", "completed"].includes(visibleActiveStep) ? "is-active" : ""}>{locale === "zh" ? "已提交" : "Submitted"}</span>
                        <span className={["analysis", "rendering", "evaluating", "completed"].includes(visibleActiveStep) || hasCurrentAnalysisResult ? "is-active" : ""}>{progressAnalysisStepLabel}</span>
                        <span className={["rendering", "evaluating", "completed"].includes(visibleActiveStep) ? "is-active" : ""}>{currentIteration ? (locale === "zh" ? `第 ${currentIteration} 轮出图` : `Rendering iteration ${currentIteration}`) : (locale === "zh" ? "等待图片" : "Waiting for image")}</span>
                        <span className={enableQualityEvaluation && ["evaluating", "completed"].includes(visibleActiveStep) ? "is-active" : !enableQualityEvaluation ? "is-muted" : ""}>{enableQualityEvaluation ? (locale === "zh" ? "严格复核" : "Strict review") : (locale === "zh" ? "默认关闭" : "Off by default")}</span>
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

                {activePathMessages.map((message) => {
                  const activeMessage = withActiveMessageVariant(message);
                  const branchInfo = getBranchInfo(messages, message.id);
                  const hasAssistantOutput = activeMessage.role === "assistant" && Boolean(buildMessageClipboardText(activeMessage, locale) || activeMessage.imageUrl);
                  const isStreamingAssistantMessage = isVisibleChatResponding && activeMessage.role === "assistant" && message.id === activeMessageId;
                  const isEditingUserMessage = activeMessage.role === "user" && editingMessage?.messageId === message.id;
                  const editedDraft = isEditingUserMessage ? editingMessage?.draft ?? "" : "";
                  const editedDraftLineCount = Math.min(8, Math.max(3, editedDraft.split("\n").length));
                  const renderMessageDownloadItem = {
                    id: activeMessage.id,
                    title: activeMessage.imageLabel || t.renderPreview,
                    imageUrl: activeMessage.imageUrl,
                    imageLabel: activeMessage.imageLabel,
                    createdAt: new Date().toISOString()
                  };
                  return (
                  <article
                    className={`chat-message chat-message--${activeMessage.role} chat-message--${activeMessage.kind} ${isEditingUserMessage ? "chat-message--editing" : ""}`}
                    key={message.id}
                  >
                    <div className="message-avatar">{activeMessage.role === "user" ? "U" : "AI"}</div>
                    <div className="message-body">
                      <div className="message-meta">
                        <strong>{activeMessage.role === "user" ? t.userLabel : t.aiLabel}</strong>
                        {isStreamingAssistantMessage && (
                          <span className="assistant-streaming-indicator" role="status" aria-live="polite">
                            <span />
                            {locale === "zh" ? "正在输出" : "Responding"}
                          </span>
                        )}
                        {activeMessage.kind === "render" && <span>{t.renderPreview}</span>}
                        {branchInfo.count > 1 && (
                          <div className="message-version-switch" aria-label={locale === "zh" ? "分支切换" : "Branch switcher"}>
                            <button
                              type="button"
                              onClick={() => handleSwitchMessageBranch(message.id, -1)}
                              disabled={branchInfo.activeIndex <= 0}
                              title={locale === "zh" ? "查看上一个分支" : "View previous branch"}
                            >
                              <ChevronLeft size={15} />
                            </button>
                            <span>{branchInfo.activeIndex + 1} / {branchInfo.count}</span>
                            <button
                              type="button"
                              onClick={() => handleSwitchMessageBranch(message.id, 1)}
                              disabled={branchInfo.activeIndex >= branchInfo.count - 1}
                              title={locale === "zh" ? "查看下一个分支" : "View next branch"}
                            >
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                      {isEditingUserMessage ? (
                        <div className="message-inline-editor">
                          <textarea
                            value={editedDraft}
                            rows={editedDraftLineCount}
                            onChange={(event) => updateEditedUserMessageDraft(message.id, event.target.value)}
                            onKeyDown={(event) => handleEditedUserMessageKeyDown(event, message)}
                            aria-label={locale === "zh" ? "编辑这条历史输入" : "Edit this previous prompt"}
                            autoFocus
                          />
                          <div className="message-inline-editor__actions">
                            <button type="button" onClick={() => cancelEditingUserMessage(message.id)}>
                              <X size={14} />
                              {locale === "zh" ? "取消" : "Cancel"}
                            </button>
                            <button
                              type="button"
                              className="is-primary"
                              onClick={() => submitEditedUserMessage(message)}
                              disabled={isConversationBusy || !editedDraft.trim()}
                            >
                              <Send size={14} />
                              {locale === "zh" ? "发送" : "Send"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <MessageContent content={activeMessage.content} locale={locale} />
                      )}

                      {activeMessage.attachments && activeMessage.attachments.length > 0 && (
                        <div className="chatgpt-composer__attachments" aria-label={locale === "zh" ? "消息图片附件" : "Message image attachments"}>
                          {activeMessage.attachments.slice(0, 4).map((attachment, index) => (
                            <button
                              type="button"
                              className="chatgpt-composer__attachment"
                              key={attachment.id || `${attachment.name}-${index}`}
                              onClick={() => handleExpandPreview({ url: attachment.dataUrl, label: attachment.name || chatAttachmentLabel })}
                              title={locale === "zh" ? "查看上传图片" : "View uploaded image"}
                            >
                              <img src={attachment.dataUrl} alt={attachment.name || chatAttachmentLabel} />
                              <span>{attachment.name || `${chatAttachmentLabel} ${index + 1}`}</span>
                            </button>
                          ))}
                          {activeMessage.attachments.length > 4 && <span className="chatgpt-chip">+{activeMessage.attachments.length - 4}</span>}
                        </div>
                      )}

                      {activeMessage.bullets && (
                        <ul className="analysis-list">
                          {(activeMessage.bullets[locale] ?? []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}

                      {activeMessage.promptText && (
                        <details className="prompt-details">
                          <summary>{locale === "zh" ? "查看最终提示词" : "View final prompt"}</summary>
                          <pre>{activeMessage.promptText}</pre>
                        </details>
                      )}

                      {(activeMessage.draftInstruction || memoryCandidateHasEntries(activeMessage.memoryCandidate)) && (
                        <div className="message-action-row">
                          {activeMessage.draftInstruction && (
                            <button type="button" onClick={() => handleApplyDraftInstruction(activeMessage.draftInstruction || "")}>
                              <Camera size={14} />
                              {locale === "zh" ? "转到图像模式" : "Use in image mode"}
                            </button>
                          )}
                          {memoryCandidateHasEntries(activeMessage.memoryCandidate) && (
                            <button
                              type="button"
                              onClick={() => activeMessage.memoryCandidate && void handleRememberChatCandidate(message.id, activeMessage.memoryCandidate)}
                              disabled={rememberingMessageId !== null}
                            >
                              <Save size={14} />
                              {rememberingMessageId === message.id
                                ? locale === "zh" ? "保存中" : "Saving"
                                : locale === "zh" ? "记住偏好" : "Remember"}
                            </button>
                          )}
                          {activeMessage.memoryCandidate && memoryCandidateHasEntries(activeMessage.memoryCandidate) && (
                            <small>{formatMemoryCandidate(activeMessage.memoryCandidate, locale).join("；")}</small>
                          )}
                        </div>
                      )}

                      {activeMessage.kind === "render" && (
                        <div className="render-preview-card">
                          <div className="render-preview-info">
                            <div>
                              <p className="eyebrow">{t.renderPreview}</p>
                              <h3>{activeMessage.imageLabel || (locale === "zh" ? "后端返回结果" : "Backend result")}</h3>
                            </div>
                            {activeMessage.imageUrl && <span className="score-pill">{locale === "zh" ? "结果" : "Result"}</span>}
                          </div>
                          {activeMessage.imageUrl ? (
                            <button type="button" className="image-zoom-trigger" onClick={() => activeMessage.imageUrl && handleExpandPreview({ url: activeMessage.imageUrl, label: activeMessage.imageLabel || t.renderPreview, sourceResultId: activeMessage.sourceResultId })} title={locale === "zh" ? "单击放大" : "Click to enlarge"}><img className="api-render-image" src={activeMessage.imageUrl} alt={activeMessage.imageLabel || t.renderPreview} /></button>
                          ) : (
                            <div className="empty-render-result">
                              {locale === "zh" ? "本次请求没有返回图片文件。" : "This request did not return an image file."}
                            </div>
                          )}
                        </div>
                      )}

                      {hasAssistantOutput && (
                        <div className="assistant-output-actions" aria-label={locale === "zh" ? "AI 输出操作" : "Assistant output actions"}>
                          <div className="assistant-output-actions__retry">
                            <button type="button" onClick={() => handleOpenRetryPopover(message)} disabled={isConversationBusy} title={locale === "zh" ? "根据上一条输入重试" : "Retry from the previous prompt"}>
                              <RotateCcw size={14} />
                              {locale === "zh" ? "重试" : "Retry"}
                            </button>
                            {retryPopover?.messageId === message.id && (
                              <div className="retry-popover" role="dialog" aria-label={locale === "zh" ? "重试回复设置" : "Retry response settings"}>
                                <label>
                                  <span>{locale === "zh" ? "要求更改回复" : "Retry response"}</span>
                                  <select
                                    value={retryPopover.model}
                                    onChange={(event) => setRetryPopover((current) => current ? { ...current, model: event.target.value } : current)}
                                    aria-label={locale === "zh" ? "选择重试模型" : "Select retry model"}
                                  >
                                    {!retryPopover.model && <option value="">{locale === "zh" ? "当前聊天模型" : "Current chat model"}</option>}
                                    {retryModelOptions.map((modelName) => (
                                      <option key={modelName} value={modelName}>{modelName}</option>
                                    ))}
                                  </select>
                                </label>
                                <button type="button" onClick={() => handleRegenerateMessage(message, retryPopover.model)} disabled={isConversationBusy}>
                                  <RotateCcw size={15} />
                                  {locale === "zh"
                                    ? `用 ${retryPopover.model || apiConfig.analysisModel || "当前模型"} 重试`
                                    : `Retry with ${retryPopover.model || apiConfig.analysisModel || "current model"}`}
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className={message.feedback === "like" ? "is-selected" : ""}
                            aria-pressed={message.feedback === "like"}
                            onClick={() => handleMessageFeedback(message, "like")}
                            title={locale === "zh" ? "标记这条输出有帮助" : "Mark this output as helpful"}
                          >
                            <ThumbsUp size={14} />
                            {locale === "zh" ? "点赞" : "Like"}
                          </button>
                          <button
                            type="button"
                            className={message.feedback === "dislike" ? "is-selected" : ""}
                            aria-pressed={message.feedback === "dislike"}
                            onClick={() => handleMessageFeedback(message, "dislike")}
                            title={locale === "zh" ? "标记这条输出不理想" : "Mark this output as not useful"}
                          >
                            <ThumbsDown size={14} />
                            {locale === "zh" ? "差评" : "Dislike"}
                          </button>
                          <button type="button" onClick={() => handleBranchFromMessage(message)} title={locale === "zh" ? "把这条输出带回输入框继续分支" : "Load this output into the composer as a branch"}>
                            <GitBranch size={14} />
                            {locale === "zh" ? "分支对话" : "Branch"}
                          </button>
                          <button type="button" onClick={() => void handleCopyMessage(message)} title={locale === "zh" ? "复制这条输出文字" : "Copy this output text"}>
                            <Clipboard size={14} />
                            {locale === "zh" ? "复制" : "Copy"}
                          </button>
                          {activeMessage.kind === "render" && activeMessage.imageUrl && (
                            <>
                              <button type="button" onClick={() => handleCopyImage(activeMessage.imageUrl, activeMessage.imageLabel)} title={locale === "zh" ? "复制图片到剪贴板" : "Copy image to clipboard"}>
                                <Clipboard size={14} />
                                {locale === "zh" ? "复制图片" : "Copy image"}
                              </button>
                              <button type="button" onClick={() => message.imageUrl && handleOpenComparison({ url: message.imageUrl, label: activeMessage.imageLabel || t.renderPreview, sourceResultId: message.sourceResultId })} disabled={isRenderMessageComparisonDisabled(activeMessage)} title={locale === "zh" ? "打开对比分析" : "Open comparison"}>
                                <FileText size={14} />
                                {locale === "zh" ? "对比分析" : "Compare"}
                              </button>
                              <button type="button" onClick={() => handleDownloadResult(renderMessageDownloadItem)} title={locale === "zh" ? "下载图片" : "Download image"}>
                                <Download size={14} />
                                {locale === "zh" ? "下载" : "Download"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {activeMessage.role === "user" && !isEditingUserMessage && (
                        <div className="assistant-output-actions" aria-label={locale === "zh" ? "用户消息操作" : "User message actions"}>
                          <button type="button" onClick={() => handleEditUserMessage(message)} title={locale === "zh" ? "编辑这条历史输入并重新生成" : "Edit this prompt and regenerate"}>
                            <Edit3 size={14} />
                            {locale === "zh" ? "编辑" : "Edit"}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                  );
                })}
              </>
            )}
          </div>

          <form className={`chatgpt-composer ${isEmptyConversation ? "chatgpt-composer--empty-conversation" : ""}`} onSubmit={handleComposerSubmit}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  setComposerImageAttachments(e.target.files, true);
                  e.target.value = "";
                }
              }}
            />
            {isEmptyConversation && (
              <div className="chatgpt-composer__empty-title">
                <h1>{locale === "zh" ? "我们先从哪里开始呢？" : "Where shall we start?"}</h1>
              </div>
            )}

            <div className={`chatgpt-composer__bar ${isChatWorkspace ? "chatgpt-composer__bar--chat" : ""} ${(selectedEditSourceLabel || floorPlanFiles.length > 0) ? "chatgpt-composer__bar--has-attachments" : ""}`}>
              {(selectedEditSourceLabel || floorPlanFiles.length > 0) && (
                <div className="chatgpt-composer__attachments-inner" aria-label={locale === "zh" ? "已添加的图片" : "Attached images"}>
                  {selectedEditSourceLabel && <span className="chatgpt-chip chatgpt-chip--accent">{selectedEditSourceLabel}</span>}
                  {floorPlanPreviews.slice(0, 4).map((file, index) => (
                    <div
                      className="chatgpt-composer__attachment-card"
                      key={file.url}
                    >
                      <div className="chatgpt-composer__attachment-card-header">
                        <img src={file.url} alt={file.name} className="chatgpt-composer__attachment-card-thumb" />
                        <span className="chatgpt-composer__attachment-card-name">{file.name}</span>
                        <button
                          type="button"
                          className="chatgpt-composer__attachment-card-close"
                          onClick={() => removeFloorPlan(index)}
                          title={locale === "zh" ? "移除" : "Remove"}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <img src={file.url} alt={file.name} className="chatgpt-composer__attachment-card-preview" />
                    </div>
                  ))}
                  {floorPlanPreviews.length > 4 && <span className="chatgpt-chip">+{floorPlanPreviews.length - 4}</span>}
                </div>
              )}
              {isEmptyConversation && (
                <button
                  type="button"
                  className="chatgpt-composer__plus-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title={locale === "zh" ? "上传文件" : "Upload file"}
                >
                  <Plus size={18} />
                </button>
              )}
              <textarea
                ref={composerRef}
                name="composer_text"
                className={chatInput.trim().length > 900 ? "is-long-draft" : ""}
                value={chatInput}
                onChange={handleComposerInputChange}
                onKeyDown={handleComposerKeyDown}
                onPaste={handleComposerPaste}
                placeholder={visibleComposerPlaceholder}
                rows={1}
                aria-label={visibleComposerPlaceholder}
              />
              <div className="chatgpt-composer__inline-actions">
                {!isEmptyConversation && (
                  <span className="chatgpt-composer__provider-badge" title={composerProviderLabel}>
                    <PlugZap size={14} aria-hidden="true" />
                    <span>{composerProviderLabel}</span>
                  </span>
                )}
                {isEmptyConversation ? (
                  <>
                    <select
                      className="chatgpt-composer__model-select"
                      value={composerModelValue}
                      onChange={(event) => handleComposerModelChange(event.target.value)}
                      disabled={isVisibleConversationBusy}
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
                        disabled={isVisibleChatResponding}
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
                    <button
                      type="button"
                      className="chatgpt-composer__mic-btn"
                      title={locale === "zh" ? "语音输入" : "Voice input"}
                    >
                      <Mic size={18} />
                    </button>
                    <button
                      type={composerIsStopping ? "button" : "submit"}
                      className="chatgpt-composer__send"
                      disabled={composerIsStopping ? false : !canSubmitComposer}
                      aria-busy={isVisibleConversationBusy}
                      onClick={composerIsStopping ? stopCurrentChatResponse : undefined}
                      title={composerIsStopping ? composerStopTitle : (isChatWorkspace ? chatBlocker : generationBlocker) || composerSubmitShortcutHint}
                    >
                      {composerIsStopping ? <Square size={16} /> : <AudioLines size={18} />}
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      className="chatgpt-composer__model-select"
                      value={composerModelValue}
                      onChange={(event) => handleComposerModelChange(event.target.value)}
                      disabled={isVisibleConversationBusy}
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
                        disabled={isVisibleChatResponding}
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
                    <button
                      type={composerIsStopping ? "button" : "submit"}
                      className="chatgpt-composer__send"
                      disabled={composerIsStopping ? false : !canSubmitComposer}
                      aria-busy={isVisibleConversationBusy}
                      onClick={composerIsStopping ? stopCurrentChatResponse : undefined}
                      title={composerIsStopping ? composerStopTitle : (isChatWorkspace ? chatBlocker : generationBlocker) || composerSubmitShortcutHint}
                    >
                      {composerIsStopping ? <Square size={15} /> : <Send size={16} />}
                    </button>
                  </>
                )}
              </div>
            </div>

            {isEmptyConversation && (
              <div className="chatgpt-empty__suggestions" aria-label={locale === "zh" ? "快速开始" : "Quick starts"}>
                <button type="button" onClick={() => isImageWorkspace ? composerRef.current?.focus() : switchWorkspaceMode("image")}>
                  <ImagePlus size={18} />
                  {locale === "zh" ? "生成图片" : "Generate image"}
                </button>
                <button type="button" onClick={() => composerRef.current?.focus()}>
                  <Edit3 size={18} />
                  {locale === "zh" ? "撰写或编辑" : "Write or edit"}
                </button>
                <button type="button" onClick={openImageManagementView}>
                  <Search size={18} />
                  {locale === "zh" ? "查找资料" : "Find references"}
                </button>
              </div>
            )}

            {isImageWorkspace && (
              <div className="chatgpt-composer__meta">
                <div className="chatgpt-composer__mode-row">
                  {composerMode === "new-generation" ? promptModeOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={visibleSelectedPromptModeId === option.id ? "is-active" : ""}
                      aria-pressed={visibleSelectedPromptModeId === option.id}
                      onClick={() => selectPromptMode(option.id)}
                      disabled={isRendering}
                      title={option.description || (locale === "zh" ? option.zh : option.en)}
                    >
                      {locale === "zh" ? option.zh : option.en}
                    </button>
                  )) : (
                    <button type="button" className="is-active" onClick={handleNewGenerationMode}>
                      {locale === "zh" ? "切回新生成" : "Back to new"}
                    </button>
                  )}
                </div>
                {composerMode === "new-generation" && !canSubmitComposer && <span className="chatgpt-mode-note">{promptModeHint}</span>}
                {composerMode === "new-generation" && floorPlanFiles.length > 0 && (
                  <div className="chatgpt-composer__utility-row">
                    <button
                      type="button"
                      className="chatgpt-tool-action"
                      onClick={handleRunColoredFloorPlanTool}
                      disabled={isConversationBusy || Boolean(coloredFloorPlanActionBlocker)}
                      title={coloredFloorPlanActionBlocker || (locale === "zh" ? "用当前平面图直接生成彩色平面图，输入框文字只作为补充偏好" : "Generate a colored floor plan from the current attachment; composer text is only an optional preference")}
                    >
                      <Aperture size={14} />
                      {locale === "zh" ? "彩色平面图" : "Colored plan"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {!canSubmitComposer && <p className="composer-hint">{composerHint}</p>}

          </form>
            </>
          )}
        </section>

        {isSettingsDialogOpen && (
          <button
            type="button"
            className="chatgpt-settings-backdrop"
            onClick={() => setActiveUtilityPanel(null)}
            aria-label={locale === "zh" ? "关闭设置弹窗" : "Close settings dialog"}
          />
        )}

        {activeUtilityPanel && (isShortcutDrawerOpen || isSettingsDialogOpen) && (
          <aside
            className={`chatgpt-drawer ${isSettingsDialogOpen ? "chatgpt-drawer--settings-dialog" : ""}`}
            role={isSettingsDialogOpen ? "dialog" : undefined}
            aria-modal={isSettingsDialogOpen ? true : undefined}
            aria-label={activeUtilityPanel ? utilityPanelTitles[activeUtilityPanel] : undefined}
          >
            <div className="chatgpt-drawer__header">
              <div>
                <h2>{utilityPanelTitles[activeUtilityPanel]}</h2>
                <p>{settingsPanelDescriptions[activeUtilityPanel]}</p>
              </div>
              <button type="button" onClick={() => setActiveUtilityPanel(null)} aria-label={locale === "zh" ? "关闭设置面板" : "Close settings panel"}>
                <X size={16} />
              </button>
            </div>

            <div className="chatgpt-drawer__content">
              {activeUtilityPanel !== "shortcuts" && (
                <nav className="chatgpt-drawer__nav" aria-label={locale === "zh" ? "设置分类" : "Settings sections"}>
                  {settingsPanelItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.panel}
                        type="button"
                        className={activeUtilityPanel === item.panel ? "is-active" : ""}
                        onClick={() => openSettingsPanel(item.panel)}
                      >
                        <Icon size={14} />
                        <span>{item.title}</span>
                      </button>
                    );
                  })}
                </nav>
              )}
              {activeUtilityPanel === "analysis" && (
                <div className="chatgpt-drawer__stack">
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
                        : isVisibleRendering
                          ? generationStageLabel
                          : latestResult
                            ? locale === "zh" ? "最近一次结果已完成并保存到历史图片。" : "The latest result has completed and was saved."
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
                          : locale === "zh" ? "未上传平面图时会按文字需求生成；拖入平面图后这里会显示分析结果。" : "Without a floor plan, generation uses the text brief. Drop a floor plan to show analysis here."}
                      </p>
                    )}
                    {(visibleLiveGeneration?.status || latestResult?.status) && <em>{visibleLiveGeneration?.status || latestResult?.status}</em>}
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
                      <span>{locale === "zh" ? "快捷短语" : "Shortcut phrase"}</span>
                      <textarea
                        rows={3}
                        value={shortcutDraft.text}
                        onChange={(event) => setShortcutDraft({ text: event.target.value })}
                        placeholder={locale === "zh" ? "例如：柔和日光与真实全局照明" : "Soft daylight and realistic global illumination"}
                      />
                    </label>
                    <div className="shortcut-editor__actions">
                      <button type="button" onClick={saveShortcutPhrase}>
                        <Save size={14} />
                        {locale === "zh" ? "保存短语" : "Save phrase"}
                      </button>
                      <button type="button" onClick={() => {
                        setEditingShortcutId(null);
                        setShortcutDraft({ text: "" });
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
                        <div className="api-provider-manager api-config-wide">
                          <div>
                            <span>{locale === "zh" ? "分析供应商档案" : "Analysis provider profile"}</span>
                            <select
                              value={apiConfig.activeAnalysisProviderId}
                              onChange={(event) => selectProviderProfile("analysis", event.target.value)}
                            >
                              {apiConfig.analysisProviders.map((provider, index) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.providerName || `${locale === "zh" ? "分析供应商" : "Analysis provider"} ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button type="button" onClick={() => addProviderProfile("analysis")} disabled={configAction !== null}>
                            <Plus size={13} />
                            {locale === "zh" ? "新增" : "Add"}
                          </button>
                          <button type="button" onClick={() => deleteProviderProfile("analysis")} disabled={configAction !== null || apiConfig.analysisProviders.length <= 1}>
                            <Trash2 size={13} />
                            {locale === "zh" ? "删除" : "Delete"}
                          </button>
                        </div>
                        <label>
                          <span>{locale === "zh" ? "分析供应商" : "Analysis provider"}</span>
                          <input
                            value={apiConfig.analysisProviderName}
                            onChange={(event) => updateAnalysisProvider({ providerName: event.target.value })}
                            placeholder="OpenAI / Anthropic"
                          />
                        </label>
                        <label>
                          <span>{locale === "zh" ? "分析格式" : "Analysis format"}</span>
                          <select
                            value={apiConfig.analysisApiFormat}
                            onChange={(event) => updateAnalysisProvider({ apiFormat: event.target.value })}
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
                            onChange={(event) => updateAnalysisProvider({ baseUrl: event.target.value })}
                            placeholder={defaultApiBaseUrl}
                          />
                        </label>
                        <label>
                          <span>{locale === "zh" ? "分析 API Key" : "Analysis API Key"}</span>
                          <div className="api-key-field">
                            <input
                              type={visibleApiKeys.analysis ? "text" : "password"}
                              value={apiConfig.analysisApiKey}
                              onChange={(event) => updateAnalysisProvider({ apiKey: event.target.value })}
                              placeholder="sk-..."
                              autoComplete="off"
                            />
                            <button
                              type="button"
                              onClick={() => toggleApiKeyVisibility("analysis")}
                              aria-label={visibleApiKeys.analysis ? (locale === "zh" ? "隐藏分析 API Key" : "Hide analysis API key") : (locale === "zh" ? "显示分析 API Key" : "Show analysis API key")}
                              title={visibleApiKeys.analysis ? (locale === "zh" ? "隐藏" : "Hide") : (locale === "zh" ? "显示" : "Show")}
                            >
                              {visibleApiKeys.analysis ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </label>
                        <label>
                          <span>{locale === "zh" ? "分析模型" : "Analysis model"}</span>
                          <input
                            value={apiConfig.analysisModel}
                            onChange={(event) => handleChatModelChange(event.target.value)}
                            placeholder="gpt-4o"
                          />
                        </label>
                        {selectedAnalysisModelOptions.length > 0 && (
                          <div className="api-model-picker api-model-picker--selected api-config-wide">
                            <div className="api-model-picker__head">
                              <strong>{locale === "zh" ? "已加入聊天模型" : "Added chat models"}</strong>
                              <small>{locale === "zh" ? "删除后会从聊天模型切换里移除；删除默认模型会自动切到下一个。" : "Remove models from the chat switcher; removing the default picks the next one."}</small>
                            </div>
                            <div className="api-model-picker__list">
                              {selectedAnalysisModelOptions.map((model, index) => (
                                <span className="api-model-chip" key={model}>
                                  <span>{model}</span>
                                  <em>{apiConfig.analysisModel === model || (!apiConfig.analysisModel && index === 0) ? (locale === "zh" ? "默认" : "Default") : (locale === "zh" ? "已加入" : "Added")}</em>
                                  <button
                                    type="button"
                                    className="api-model-chip__remove"
                                    onClick={() => removeAnalysisModelOption(model)}
                                    disabled={configAction !== null}
                                    title={locale === "zh" ? "删除模型" : "Remove model"}
                                    aria-label={locale === "zh" ? `删除分析模型 ${model}` : `Remove analysis model ${model}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="api-model-search-row api-config-wide">
                          <button type="button" onClick={() => handleDetectModels("analysis")} disabled={configAction !== null}>
                            {configAction === "models-analysis" ? (locale === "zh" ? "搜索中" : "Searching") : locale === "zh" ? "搜索分析模型" : "Search analysis models"}
                          </button>
                          <button type="button" onClick={() => applyDetectedModels("analysis")} disabled={configAction !== null || detectedModels.analysis.length === 0}>
                            {locale === "zh" ? "全部加入" : "Add all"}
                          </button>
                        </div>
                        {detectedModels.analysis.length > 0 && (
                          <div className="api-model-picker api-config-wide">
                            <div className="api-model-picker__head">
                              <strong>{locale === "zh" ? "检测到的分析模型" : "Detected analysis models"}</strong>
                              <small>{locale === "zh" ? "可多选加入聊天模型切换；当前默认模型仍由上方输入框决定" : "Select one or more for chat model switching; the input above remains the default"}</small>
                            </div>
                            <div className="api-model-picker__list">
                              {detectedModels.analysis.map((model) => {
                                const selectedIndex = selectedAnalysisModelOptions.indexOf(model);
                                const isSelected = selectedIndex >= 0;
                                return (
                                  <button
                                    className={isSelected ? "is-selected" : ""}
                                    type="button"
                                    key={model}
                                    onClick={() => toggleDetectedAnalysisModel(model)}
                                  >
                                    {isSelected && <CheckCircle2 size={13} />}
                                    <span>{model}</span>
                                    {apiConfig.analysisModel === model && <em>{locale === "zh" ? "默认" : "Default"}</em>}
                                    {isSelected && apiConfig.analysisModel !== model && <em>{locale === "zh" ? "已加入" : "Added"}</em>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="api-provider-manager api-config-wide">
                          <div>
                            <span>{locale === "zh" ? "画图供应商档案" : "Image provider profile"}</span>
                            <select
                              value={apiConfig.activeImageProviderId}
                              onChange={(event) => selectProviderProfile("image", event.target.value)}
                            >
                              {apiConfig.imageProviders.map((provider, index) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.providerName || `${locale === "zh" ? "画图供应商" : "Image provider"} ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button type="button" onClick={() => addProviderProfile("image")} disabled={configAction !== null}>
                            <Plus size={13} />
                            {locale === "zh" ? "新增" : "Add"}
                          </button>
                          <button type="button" onClick={() => deleteProviderProfile("image")} disabled={configAction !== null || apiConfig.imageProviders.length <= 1}>
                            <Trash2 size={13} />
                            {locale === "zh" ? "删除" : "Delete"}
                          </button>
                        </div>
                        <label>
                          <span>{locale === "zh" ? "画图供应商" : "Image provider"}</span>
                          <input
                            value={apiConfig.imageProviderName}
                            onChange={(event) => updateImageProvider({ providerName: event.target.value })}
                            placeholder="OpenAI / custom"
                          />
                        </label>
                        <label>
                          <span>{locale === "zh" ? "画图格式" : "Image format"}</span>
                          <select
                            value={apiConfig.imageApiFormat}
                            onChange={(event) => updateImageProvider({ apiFormat: event.target.value })}
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
                            onChange={(event) => updateImageProvider({ baseUrl: event.target.value })}
                            placeholder={defaultApiBaseUrl}
                          />
                        </label>
                        <label>
                          <span>{locale === "zh" ? "画图 API Key" : "Image API Key"}</span>
                          <div className="api-key-field">
                            <input
                              type={visibleApiKeys.image ? "text" : "password"}
                              value={apiConfig.imageApiKey}
                              onChange={(event) => updateImageProvider({ apiKey: event.target.value })}
                              placeholder="sk-..."
                              autoComplete="off"
                            />
                            <button
                              type="button"
                              onClick={() => toggleApiKeyVisibility("image")}
                              aria-label={visibleApiKeys.image ? (locale === "zh" ? "隐藏画图 API Key" : "Hide image API key") : (locale === "zh" ? "显示画图 API Key" : "Show image API key")}
                              title={visibleApiKeys.image ? (locale === "zh" ? "隐藏" : "Hide") : (locale === "zh" ? "显示" : "Show")}
                            >
                              {visibleApiKeys.image ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </label>
                        <label>
                          <span>{locale === "zh" ? "画图模型" : "Image model"}</span>
                          <input
                            value={apiConfig.imageModel}
                            onChange={(event) => {
                              updateImageProvider({ model: event.target.value });
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
                            placeholder={locale === "zh" ? "可选：多个模型用换行或逗号分隔" : "Optional: separate models with commas or new lines"}
                          />
                        </label>
                        {selectedImageModelOptions.length > 0 && (
                          <div className="api-model-picker api-model-picker--selected api-config-wide">
                            <div className="api-model-picker__head">
                              <strong>{locale === "zh" ? "已加入画图模型" : "Added image models"}</strong>
                              <small>{locale === "zh" ? "第一个是主模型，其余作为备用模型；可直接删除不需要的候选。" : "The first model is primary and the rest are fallbacks; remove candidates you do not need."}</small>
                            </div>
                            <div className="api-model-picker__list">
                              {selectedImageModelOptions.map((model, index) => (
                                <span className="api-model-chip" key={model}>
                                  <span>{model}</span>
                                  <em>{index === 0 ? (locale === "zh" ? "主" : "Primary") : (locale === "zh" ? "备" : "Fallback")}</em>
                                  <button
                                    type="button"
                                    className="api-model-chip__remove"
                                    onClick={() => removeImageModelOption(model)}
                                    disabled={configAction !== null}
                                    title={locale === "zh" ? "删除模型" : "Remove model"}
                                    aria-label={locale === "zh" ? `删除画图模型 ${model}` : `Remove image model ${model}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="api-model-search-row api-config-wide">
                          <button type="button" onClick={() => handleDetectModels("image")} disabled={configAction !== null}>
                            {configAction === "models-image" ? (locale === "zh" ? "搜索中" : "Searching") : locale === "zh" ? "搜索画图模型" : "Search image models"}
                          </button>
                          <button type="button" onClick={() => applyDetectedModels("image")} disabled={configAction !== null || detectedModels.image.length === 0}>
                            {locale === "zh" ? "全部加入" : "Add all"}
                          </button>
                        </div>
                        {detectedModels.image.length > 0 && (
                          <div className="api-model-picker api-config-wide">
                            <div className="api-model-picker__head">
                              <strong>{locale === "zh" ? "检测到的画图模型" : "Detected image models"}</strong>
                              <small>
                                {locale === "zh"
                                  ? "可多选：第一个勾选项作为主模型，其余写入备用模型"
                                  : "Multi-select: the first checked model is primary; the rest become fallbacks"}
                              </small>
                            </div>
                            <div className="api-model-picker__list">
                              {detectedModels.image.map((model) => {
                                const selectedIndex = selectedImageModelOptions.indexOf(model);
                                const isSelected = selectedIndex >= 0;
                                return (
                                  <button
                                    className={isSelected ? "is-selected" : ""}
                                    type="button"
                                    key={model}
                                    onClick={() => toggleDetectedImageModel(model)}
                                  >
                                    {isSelected && <CheckCircle2 size={13} />}
                                    <span>{model}</span>
                                    {selectedIndex === 0 && <em>{locale === "zh" ? "主" : "Primary"}</em>}
                                    {selectedIndex > 0 && <em>{locale === "zh" ? "备" : "Fallback"}</em>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
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
                  <div className="control-section prompt-skill-manager">
                    <div className="shortcut-manager__head">
                      <div className="section-title">
                        <Sparkles size={14} />
                        {locale === "zh" ? "图像模式" : "Image modes"}
                      </div>
                      <button type="button" onClick={startNewPromptSkill}>
                        <Plus size={14} />
                        {locale === "zh" ? "新增" : "Add"}
                      </button>
                    </div>
                    <p className="config-hint">
                      {locale === "zh"
                        ? "自定义模式会在提交前把模板套到主输入框内容上；模板可使用 {prompt} 或 {{prompt}} 作为输入占位符。"
                        : "Custom modes apply their template to the main composer before submit. Use {prompt} or {{prompt}} as the input placeholder."}
                    </p>
                    <div className="shortcut-manager__list">
                      {promptSkills.length === 0 ? (
                        <p className="shortcut-empty-note">
                          {locale === "zh" ? "还没有自定义图像模式。默认模式和 3D 增强已内置在主输入区。" : "No custom image modes yet. Default and 3D boost are already built in."}
                        </p>
                      ) : promptSkills.map((skill) => (
                        <div className="shortcut-manager__item prompt-skill-manager__item" key={skill.id}>
                          <button type="button" className="shortcut-manager__phrase" onClick={() => selectPromptMode(`skill-${skill.id}`)}>
                            <span>{skill.name}</span>
                            <small>{skill.description || (locale === "zh" ? "套用到下一次出图" : "Apply to next generation")}</small>
                          </button>
                          <div className="shortcut-manager__item-actions">
                            <button type="button" onClick={() => startEditingPromptSkill(skill)} title={locale === "zh" ? "编辑模式" : "Edit mode"}>
                              <Edit3 size={14} />
                            </button>
                            <button type="button" onClick={() => removePromptSkill(skill.id)} title={locale === "zh" ? "删除模式" : "Delete mode"}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="control-section shortcut-editor prompt-skill-editor">
                    <div className="section-title">
                      <Edit3 size={14} />
                      {editingPromptSkillId ? (locale === "zh" ? "编辑图像模式" : "Edit image mode") : (locale === "zh" ? "新增图像模式" : "New image mode")}
                    </div>
                    <label>
                      <span>{locale === "zh" ? "模式名称" : "Mode name"}</span>
                      <input
                        value={promptSkillDraft.name}
                        onChange={(event) => setPromptSkillDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder={locale === "zh" ? "例如：风景图" : "e.g. Landscape"}
                      />
                    </label>
                    <label>
                      <span>{locale === "zh" ? "说明（可选）" : "Description (optional)"}</span>
                      <input
                        value={promptSkillDraft.description}
                        onChange={(event) => setPromptSkillDraft((current) => ({ ...current, description: event.target.value }))}
                        placeholder={locale === "zh" ? "例如：自然风光、真实摄影、电影光影" : "Natural scenery, realistic photography, cinematic light"}
                      />
                    </label>
                    <label>
                      <span>{locale === "zh" ? "提示词模板" : "Prompt template"}</span>
                      <textarea
                        rows={8}
                        value={promptSkillDraft.prompt}
                        onChange={(event) => setPromptSkillDraft((current) => ({ ...current, prompt: event.target.value }))}
                        placeholder={locale === "zh" ? "请把用户输入扩展成高质量风景摄影提示词：{prompt}" : "Expand the user input into a high-quality landscape prompt: {prompt}"}
                      />
                    </label>
                    <div className="shortcut-editor__actions">
                      <button type="button" onClick={savePromptSkill}>
                        <Save size={14} />
                        {locale === "zh" ? "保存模式" : "Save mode"}
                      </button>
                      <button type="button" onClick={() => {
                        setEditingPromptSkillId(null);
                        setPromptSkillDraft(DEFAULT_PROMPT_SKILL_DRAFT);
                      }}>
                        <X size={14} />
                        {locale === "zh" ? "清空" : "Clear"}
                      </button>
                    </div>
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
        {isShortcutDrawerOpen && (
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
                ? "登录后，你的聊天历史、图片、API Key、配置和记忆都会按账号隔离。"
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
                <button type="button" onClick={() => handleOpenComparison(previewImage)} disabled={!canCompareActiveResult}>
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
        <div className="comparison-modal" role="dialog" aria-modal="true" aria-label={comparisonImage.mode === "history-vs-history" ? (locale === "zh" ? "A/B 图片对比" : "A/B image comparison") : (locale === "zh" ? "平面图与效果图对比分析" : "Floor plan and render comparison")} onClick={() => { setIsComparisonOpen(false); setComparisonImage(null); }}>
          <div className="comparison-modal__content" onClick={(event) => event.stopPropagation()}>
            <div className="comparison-modal__head">
              <div>
                <p className="eyebrow">{locale === "zh" ? "对比分析" : "Compare analysis"}</p>
                <h2>
                  {comparisonImage.mode === "history-vs-history"
                    ? locale === "zh" ? "A 基准图 / B 对比图" : "A reference / B comparison"
                    : locale === "zh" ? "左侧平面图 / 右侧效果图" : "Floor plan left / render right"}
                </h2>
              </div>
              <button type="button" onClick={() => { setIsComparisonOpen(false); setComparisonImage(null); }}>{locale === "zh" ? "关闭" : "Close"}</button>
            </div>
            {comparisonImage.mode === "history-vs-history" && (
              <div className="comparison-selectors">
                <p className="comparison-selectors__note">
                  {locale === "zh" ? "默认优先选当前聊天最近两张生成图；也可以从当前聊天或图片库手动指定 A/B。" : "Defaults to the two latest generated images in this chat; you can also choose A/B from the current chat or image library."}
                </p>
                <label>
                  <span>{locale === "zh" ? "A 基准图" : "A reference image"}</span>
                  <select
                    value={comparisonImage.leftResultId}
                    onChange={(event) => setComparisonImage((current) => {
                      if (current?.mode !== "history-vs-history") {
                        return current;
                      }
                      if (event.target.value === current.rightResultId) {
                        showToast(locale === "zh" ? "A 和 B 需要选择不同图片" : "Choose different images for A and B");
                        return current;
                      }
                      return { ...current, leftResultId: event.target.value };
                    })}
                  >
                    {comparisonCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {comparisonOptionLabel(candidate)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{locale === "zh" ? "B 对比图" : "B comparison image"}</span>
                  <select
                    value={comparisonImage.rightResultId}
                    onChange={(event) => setComparisonImage((current) => {
                      if (current?.mode !== "history-vs-history") {
                        return current;
                      }
                      if (event.target.value === current.leftResultId) {
                        showToast(locale === "zh" ? "A 和 B 需要选择不同图片" : "Choose different images for A and B");
                        return current;
                      }
                      return { ...current, rightResultId: event.target.value };
                    })}
                  >
                    {comparisonCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {comparisonOptionLabel(candidate)}
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
                    <figcaption>
                      <span>{locale === "zh" ? "A 基准图" : "A reference"}</span>
                      {comparisonLeftResult && <small>{comparisonOptionLabel(comparisonLeftResult)}</small>}
                    </figcaption>
                    {comparisonLeftResult?.imageUrl && <img src={comparisonLeftResult.imageUrl} alt={comparisonLeftResult.alt} />}
                  </figure>
                  <figure>
                    <figcaption>
                      <span>{locale === "zh" ? "B 对比图" : "B comparison"}</span>
                      {comparisonRightResult && <small>{comparisonOptionLabel(comparisonRightResult)}</small>}
                    </figcaption>
                    {comparisonRightResult?.imageUrl && <img src={comparisonRightResult.imageUrl} alt={comparisonRightResult.alt} />}
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
