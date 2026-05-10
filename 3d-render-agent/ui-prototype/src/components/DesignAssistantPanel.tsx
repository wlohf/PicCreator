import { type FormEvent, useMemo, useState } from "react";
import { Bot, CheckCircle2, Send, Sparkles } from "lucide-react";

import { applyChatMemory, sendDesignChat, type ChatMemoryCandidate, type DesignChatResponse } from "../api/chat";
import type { RenderHistoryItem } from "../types/domain";

type DesignAssistantPanelProps = {
  projectId?: string;
  activeResult: RenderHistoryItem | null;
  chatInput: string;
  onApplyDraft: (draft: string) => void;
  onSwitchToEditAndApply: (draft: string) => void;
  onStatus?: (message: string) => void;
};

function hasMemoryCandidate(candidate?: ChatMemoryCandidate) {
  if (!candidate) return false;
  return [candidate.likes, candidate.avoids, candidate.project, candidate.evaluation_standards].some((items) => Array.isArray(items) && items.length > 0);
}

export function DesignAssistantPanel({
  projectId = "default",
  activeResult,
  chatInput,
  onApplyDraft,
  onSwitchToEditAndApply,
  onStatus
}: DesignAssistantPanelProps) {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<DesignChatResponse | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRemembering, setIsRemembering] = useState(false);
  const [status, setStatus] = useState("");

  const canRemember = hasMemoryCandidate(response?.memory_candidate);
  const draft = response?.draft_instruction?.trim() || "";
  const canSwitchToEdit = Boolean(activeResult?.id) && response?.suggested_action === "image_edit" && Boolean(draft);

  const memoryPreview = useMemo(() => {
    const candidate = response?.memory_candidate;
    if (!candidate) return "";
    return [
      ...(candidate.likes ?? []).map((item) => `喜欢：${item}`),
      ...(candidate.avoids ?? []).map((item) => `避免：${item}`),
      ...(candidate.project ?? []).map((item) => `项目：${item}`),
      ...(candidate.evaluation_standards ?? []).map((item) => `标准：${item}`)
    ].join("；");
  }, [response?.memory_candidate]);

  function publishStatus(nextStatus: string) {
    setStatus(nextStatus);
    onStatus?.(nextStatus);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    setStatus("");
    try {
      const result = await sendDesignChat({
        message: trimmed,
        project_id: projectId,
        active_result_id: activeResult?.id || "",
        context: {
          activeResult: activeResult
            ? {
                id: activeResult.id,
                prompt: activeResult.prompt,
                evaluation: activeResult.evaluation,
                floorDesc: activeResult.floorDesc,
                logs: activeResult.logs
              }
            : null,
          chatInput
        }
      });
      setResponse(result);
      publishStatus("助手已回复");
    } catch (error) {
      publishStatus(`助手请求失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSending(false);
    }
  }

  async function handleRemember() {
    if (!response?.memory_candidate || !canRemember || isRemembering) return;
    setIsRemembering(true);
    try {
      await applyChatMemory(projectId, response.memory_candidate);
      publishStatus("偏好已记住");
    } catch (error) {
      publishStatus(`保存偏好失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRemembering(false);
    }
  }

  function handleApplyDraft() {
    if (!draft) return;
    onApplyDraft(draft);
    publishStatus("已应用到输入框");
  }

  function handleSwitchToEdit() {
    if (!draft) return;
    onSwitchToEditAndApply(draft);
    publishStatus("已切到改图模式并应用");
  }

  return (
    <section className="design-assistant-panel" aria-label="设计助手">
      <div className="design-assistant-panel__head">
        <div>
          <p className="eyebrow">Design Assistant</p>
          <h3><Bot size={15} /> 设计助手</h3>
        </div>
        {response?.intent && <span className="intent-badge">{response.intent}</span>}
      </div>

      <form className="design-assistant-panel__form" onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="和设计助手说：哪里不满意/想记住什么/怎么改"
          aria-label="和设计助手说：哪里不满意/想记住什么/怎么改"
          rows={2}
        />
        <button type="submit" disabled={!message.trim() || isSending}>
          <Send size={14} />
          {isSending ? "思考中" : "发送"}
        </button>
      </form>

      {response && (
        <div className="design-assistant-panel__reply">
          <div className="assistant-meta-row">
            <span className="intent-badge intent-badge--soft">{response.intent || "unknown"}</span>
            <span className="intent-badge intent-badge--soft">{response.suggested_action || "no_action"}</span>
          </div>
          <p>{response.reply}</p>
          {response.context_summary && <em>{response.context_summary}</em>}
          {draft && (
            <details className="assistant-draft-details">
              <summary><Sparkles size={13} /> 查看草稿指令</summary>
              <pre>{draft}</pre>
            </details>
          )}
          {memoryPreview && <small>可记忆：{memoryPreview}</small>}
          <div className="assistant-action-row">
            <button type="button" onClick={handleApplyDraft} disabled={!draft}>
              应用到输入框
            </button>
            <button type="button" onClick={handleRemember} disabled={!canRemember || isRemembering}>
              <CheckCircle2 size={13} />
              {isRemembering ? "保存中" : "记住这个偏好"}
            </button>
            {canSwitchToEdit && (
              <button type="button" onClick={handleSwitchToEdit}>
                切到改图模式并应用
              </button>
            )}
          </div>
        </div>
      )}

      {status && <p className="assistant-status" role="status">{status}</p>}
    </section>
  );
}
