export type Locale = "zh" | "en";
export type Tone = "neutral" | "good" | "warn";
export type ToolKey = "select";
export type GenerationMode = "standard" | "render3d" | "colored_floor_plan";
export type ChatMemoryCandidate = {
  likes?: string[];
  avoids?: string[];
  project?: string[];
  evaluation_standards?: string[];
};

export type ApiConfig = {
  analysisProviderName: string;
  analysisApiFormat: string;
  analysisBaseUrl: string;
  analysisApiKey: string;
  analysisModel: string;
  imageProviderName: string;
  imageApiFormat: string;
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
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

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "analysis" | "render" | "error";
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  promptText?: string;
  imageUrl?: string;
  imageLabel?: string;
  sourceResultId?: string;
  draftInstruction?: string;
  memoryCandidate?: ChatMemoryCandidate;
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
