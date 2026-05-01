import type { LucideIcon } from "lucide-react";

export type Locale = "zh" | "en";
export type Tone = "neutral" | "good" | "warn";
export type ToolKey = "select" | "assets" | "material" | "lighting";
export type ParameterKey = "cameraHeight" | "materialDetail" | "daylightBalance";

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
  fallbackModels: string;
  modelSwitchAfterFailures: number;
  stopAfterLastModelFailures: number;
};

export type LocalizedText = Record<Locale, string>;

export type RenderVersion = {
  id: string;
  name: LocalizedText;
  score: string;
  angle: LocalizedText;
  status: "ready" | "review";
  metrics: Record<ParameterKey | "composition", number>;
};

export type IterationRun = {
  step: string;
  title: LocalizedText;
  model: string;
  score: LocalizedText;
  status: "accepted" | "refined" | "warning";
  notes: Record<Locale, string[]>;
};

export type Metric = {
  key: string;
  label: LocalizedText;
  value: number;
  tone: Tone;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "analysis" | "render" | "error";
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  imageUrl?: string;
  imageLabel?: string;
};

export type ReferenceAsset = {
  label: LocalizedText;
  meta: LocalizedText;
  icon: LucideIcon;
};

export type ToolDefinition = {
  key: ToolKey;
  label: LocalizedText;
  icon: "pointer" | "camera" | "ruler" | "sun";
};

export type ApiImage = {
  label: string;
  filename: string;
  data_url: string;
};

export type GenerateResponse = {
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

export type GenerationRequest = {
  prompt: string;
  maxIterations: number;
  apiConfig: ApiConfig;
  selectedModel: string;
  floorPlanFiles: File[];
  referenceFile: File | null;
};
