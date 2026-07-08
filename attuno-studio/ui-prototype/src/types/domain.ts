export type Locale = "zh" | "en";
export type Tone = "neutral" | "good" | "warn";
export type ToolKey = "select";
export type GenerationMode = "standard" | "render3d" | "colored_floor_plan";
export type ChatReasoningEffort = "low" | "medium" | "high";
export type ChatMemoryCandidate = {
  likes?: string[];
  avoids?: string[];
  project?: string[];
  evaluation_standards?: string[];
};

export type ChatThinkingStatus = {
  startedAt?: string;
  stage?: string;
  summary?: string;
  toolLabel?: string;
  toolDetail?: string;
  state?: "running" | "done" | "error";
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  published_date?: string;
  score?: number;
};

export type WebSearchDiagnostic = {
  provider?: string;
  ok?: boolean;
  status?: string;
  message?: string;
  attempts?: number;
  key_count?: number | null;
};

export type WebSearchMetadata = {
  query: string;
  results: WebSearchResult[];
  ok: boolean;
  provider?: string;
  answer?: string;
  search_profile?: string;
  search_parameters?: Record<string, unknown>;
  diagnostics?: WebSearchDiagnostic[];
  decision?: {
    source?: string;
    reason?: string;
  };
};

export type SystemUpdateStatus = {
  ok: boolean;
  enabled: boolean;
  update_source?: "release" | "branch" | string;
  repo_root?: string;
  branch?: string;
  remote?: string;
  remote_branch?: string;
  github_repository?: string;
  current_commit?: string;
  remote_commit?: string;
  current_version?: string;
  latest_version?: string;
  latest_release_tag?: string;
  latest_release_name?: string;
  latest_release_url?: string;
  latest_release_published_at?: string;
  latest_release_commit?: string;
  has_update?: boolean;
  fast_forward?: boolean;
  can_apply?: boolean;
  apply_blockers?: string[];
  dirty?: boolean;
  checked_at?: string;
  error?: string;
  applied?: boolean;
  message?: string;
  log?: string;
};

export type SystemRuntimeStatus = {
  ok: boolean;
  service?: string;
  build?: string;
  environment?: string;
  checked_at?: string;
  database?: {
    ok?: boolean;
    required?: boolean;
    configured?: boolean;
    fallback?: boolean;
    error?: string;
  };
  storage?: {
    ok?: boolean;
    data_dir?: string;
    writable?: boolean;
    error?: string;
  };
  update?: Pick<SystemUpdateStatus, "ok" | "enabled" | "update_source" | "current_version" | "latest_version" | "has_update" | "can_apply" | "apply_blockers" | "checked_at" | "error">;
};

export type ApiProviderProfile = {
  id: string;
  providerName: string;
  apiFormat: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ApiConfig = {
  analysisProviderName: string;
  analysisApiFormat: string;
  analysisBaseUrl: string;
  analysisApiKey: string;
  analysisModel: string;
  activeAnalysisProviderId: string;
  analysisProviders: ApiProviderProfile[];
  imageProviderName: string;
  imageApiFormat: string;
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  activeImageProviderId: string;
  imageProviders: ApiProviderProfile[];
  tavilyApiKeys: string;
  chatMaxOutputTokens: number;
  chatContextSize: number;
  floorAnalysisSystemPrompt: string;
  promptGenSystem3dCn: string;
  fallbackModels: string;
  modelSwitchAfterFailures: number;
  stopAfterLastModelFailures: number;
};

export type LocalizedText = Record<Locale, string>;

export type FilePreview = {
  name: string;
  url: string;
};

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatMessageVariant = {
  id: string;
  kind?: "text" | "analysis" | "render" | "error";
  workflowMode?: "chat" | "image";
  generationMode?: GenerationMode;
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  promptText?: string;
  imageUrl?: string;
  imageLabel?: string;
  attachments?: ChatImageAttachment[];
  sourceResultId?: string;
  draftInstruction?: string;
  memoryCandidate?: ChatMemoryCandidate;
  thinkingStatus?: ChatThinkingStatus;
  webSearch?: WebSearchMetadata;
  model?: string;
  createdAt?: string;
};

export type ChatMessage = {
  id: string;
  parentId?: string | null;
  role: "user" | "assistant";
  kind: "text" | "analysis" | "render" | "error";
  workflowMode?: "chat" | "image";
  generationMode?: GenerationMode;
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  promptText?: string;
  imageUrl?: string;
  imageLabel?: string;
  attachments?: ChatImageAttachment[];
  sourceResultId?: string;
  draftInstruction?: string;
  memoryCandidate?: ChatMemoryCandidate;
  thinkingStatus?: ChatThinkingStatus;
  webSearch?: WebSearchMetadata;
  feedback?: "like" | "dislike";
  variants?: ChatMessageVariant[];
  activeVariantIndex?: number;
};

export type ApiImage = {
  id?: string;
  label: string;
  filename: string;
  data_url: string;
  url?: string;
  download_url?: string;
};

export type ApiResult = {
  id: string;
  title: string;
  status?: string;
  image_url?: string | null;
  download_url?: string | null;
  annotation_url?: string | null;
  floor_plan_url?: string | null;
  image_label?: string;
  filename?: string;
  annotation_filename?: string;
  floor_plan_filename?: string;
  floor_plan_name?: string;
  prompt?: string;
  evaluation?: string;
  floor_desc?: string;
  logs?: string;
  notes?: string;
  created_at: string;
  parent_id?: string;
  generation_type?: "generation" | "edit";
  edit_mode?: "text" | "annotation" | "";
  edit_instruction?: string;
  annotation_analysis?: Record<string, unknown>;
  source_prompt?: string;
  source_evaluation?: string;
  source_logs?: string;
  model_used?: string;
  model_warning?: string;
  generation_mode?: GenerationMode;
  version_index?: number;
  project_id?: string;
  user_id?: string;
};

export type RenderHistoryItem = {
  id: string;
  title: string;
  status?: string;
  imageUrl?: string;
  downloadUrl?: string;
  annotationUrl?: string;
  floorPlanUrl?: string;
  floorPlanName?: string;
  imageLabel?: string;
  prompt?: string;
  evaluation?: string;
  floorDesc?: string;
  logs?: string;
  notes?: string;
  createdAt: string;
  parentId?: string;
  generationType?: "generation" | "edit";
  editMode?: "text" | "annotation" | "";
  editInstruction?: string;
  annotationAnalysis?: Record<string, unknown>;
  sourcePrompt?: string;
  sourceEvaluation?: string;
  sourceLogs?: string;
  modelUsed?: string;
  modelWarning?: string;
  generationMode?: GenerationMode;
  versionIndex?: number;
  projectId?: string;
  userId?: string;
};

export type GenerateResponse = {
  ok: boolean;
  status?: string;
  floor_desc?: string;
  prompt?: string;
  evaluation?: string;
  logs?: string;
  images?: ApiImage[];
  results?: ApiResult[];
  error?: string;
  stage?: string;
};

export type GenerationProgress = Pick<GenerateResponse, "ok" | "status" | "floor_desc" | "prompt" | "evaluation" | "logs" | "error" | "stage"> & {
  has_images?: boolean;
  iteration?: number | null;
  max_iterations?: number | null;
};

export type GenerationRequest = {
  projectId?: string;
  userId?: string;
  mode: GenerationMode;
  prompt: string;
  directionStackText: string;
  maxIterations: number;
  enableQualityEvaluation: boolean;
  apiConfig: ApiConfig;
  selectedModel: string;
  floorPlanFiles: File[];
};

export type ImageEditRequest = {
  sourceResultId: string;
  userId?: string;
  editInstruction: string;
  projectId: string;
  maxIterations: number;
  enableQualityEvaluation: boolean;
  apiConfig: ApiConfig;
  selectedModel: string;
};

export type AnnotatedImageEditRequest = ImageEditRequest & {
  annotationImage: File | Blob;
};

export type ImageEditResponse = {
  ok: boolean;
  result?: ApiResult;
  results?: ApiResult[];
  error?: string;
  stage?: string;
};
