import { apiFetch, buildApiUrl, parseApiJson } from "./client";

export type StyleProfile = {
  user_style_preferences?: Record<string, string[]>;
  project_style_memory?: Record<string, string[]>;
  behavior_summary?: Record<string, string[]>;
  preference_summary?: {
    long_term_preferences?: string[];
    project_preferences?: Record<string, string[]>;
    avoid_items?: string[];
    evaluation_standards?: string[];
    frequent_edit_requests?: string[];
  };
};

export type MemoryItem = {
  id: string;
  text: string;
  editable?: boolean;
  kind?: string;
  group?: string;
  created_at?: string;
};

export type MemorySection = {
  id: string;
  label: string;
  description?: string;
  items: MemoryItem[];
};

export type MemoryView = {
  project_id: string;
  sections: MemorySection[];
};

export type PreferenceEventRequest = {
  eventType: string;
  userId?: string;
  projectId?: string;
  resultId?: string;
  payload?: Record<string, unknown>;
};

export type ShortcutPreference = {
  id: string;
  text: string;
  zh?: string;
  en?: string;
};

type StyleProfileResponse = {
  ok: boolean;
  profile: StyleProfile;
  error?: string;
};

type MemoryResponse = {
  ok: boolean;
  memory: MemoryView;
  profile?: StyleProfile;
  error?: string;
  detail?: string;
};

type ShortcutPreferencesResponse = {
  ok: boolean;
  shortcuts: ShortcutPreference[];
  error?: string;
};

export async function loadShortcutPreferences(userId = "default"): Promise<ShortcutPreference[]> {
  const response = await apiFetch(`/api/preferences/shortcuts?user_id=${encodeURIComponent(userId)}`);
  const data = await parseApiJson<ShortcutPreferencesResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return Array.isArray(data.shortcuts) ? data.shortcuts : [];
}

export async function saveShortcutPreferences(shortcuts: ShortcutPreference[], userId = "default"): Promise<ShortcutPreference[]> {
  const response = await apiFetch("/api/preferences/shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, shortcuts }),
  });
  const data = await parseApiJson<ShortcutPreferencesResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return Array.isArray(data.shortcuts) ? data.shortcuts : shortcuts;
}

export async function loadStyleProfile(projectId = "default", userId = "default"): Promise<StyleProfile> {
  const response = await apiFetch(`/api/preferences/style-profile?project_id=${encodeURIComponent(projectId)}&user_id=${encodeURIComponent(userId)}`);
  const data = await parseApiJson<StyleProfileResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data.profile ?? {};
}

export async function loadMemoryView(projectId = "default", userId = "default"): Promise<MemoryView> {
  const response = await apiFetch(`/api/preferences/memory?project_id=${encodeURIComponent(projectId)}&user_id=${encodeURIComponent(userId)}`);
  const data = await parseApiJson<MemoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data.memory ?? { project_id: projectId, sections: [] };
}

export async function updateMemoryItem(itemId: string, text: string, projectId = "default"): Promise<MemoryResponse> {
  const response = await apiFetch(`/api/preferences/memory/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, text }),
  });
  const data = await parseApiJson<MemoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data;
}

export async function deleteMemoryItem(itemId: string, projectId = "default"): Promise<MemoryResponse> {
  const response = await apiFetch(`/api/preferences/memory/${encodeURIComponent(itemId)}?project_id=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
  const data = await parseApiJson<MemoryResponse>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.detail || response.statusText);
  }
  return data;
}

export async function recordPreferenceEvent({
  eventType,
  projectId = "default",
  userId = "default",
  resultId = "",
  payload = {},
}: PreferenceEventRequest): Promise<void> {
  const response = await apiFetch("/api/preferences/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: eventType,
      project_id: projectId,
      user_id: userId,
      result_id: resultId,
      payload,
    }),
  });
  const data = await parseApiJson<{ ok: boolean; error?: string }>(response);
  if (!response.ok || !data.ok) {
    throw new Error(data.error || response.statusText);
  }
}
