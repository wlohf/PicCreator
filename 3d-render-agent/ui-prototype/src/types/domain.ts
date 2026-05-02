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

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "analysis" | "render" | "error";
  content: LocalizedText | string;
  bullets?: Record<Locale, string[]>;
  imageUrl?: string;
  imageLabel?: string;
};

export type ApiImage = {
  label: string;
  filename: string;
  data_url: string;
};

export type RenderHistoryItem = {
  id: string;
  title: string;
  status?: string;
  imageUrl?: string;
  imageLabel?: string;
  prompt?: string;
  evaluation?: string;
  logs?: string;
  createdAt: string;
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
  directionStackText: string;
  maxIterations: number;
  apiConfig: ApiConfig;
  selectedModel: string;
  floorPlanFiles: File[];
  referenceFile: File | null;
};
