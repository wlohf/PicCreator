// @ts-ignore Node's builtin types are not part of this lightweight test harness.
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const studioDataSource = readFileSync(new URL("../src/data/studioData.ts", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("../src/types/domain.ts", import.meta.url), "utf8");

assert(
  styles.includes("grid-template-columns: minmax(0, 1fr) auto;"),
  "desktop composer bar should reserve width for the textarea and trailing actions only",
);

const mobileRulePattern = /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-composer__bar\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*border-radius:\s*20px;/m;
assert(
  mobileRulePattern.test(styles),
  "mobile composer bar should collapse to a single text column before placing actions on the next row",
);

assert(
  styles.includes(".chat-message--assistant .message-body"),
  "assistant replies should render inside a readable light card treatment",
);

assert(
  /\.chat-message--user\s+\.message-meta\s*\{\s*display:\s*none;/m.test(styles) &&
  !appSource.includes('{locale === "zh" ? "结果" : "Results"}'),
  "user message labels and the header results shortcut should stay out of the streamlined chat view",
);

const composerKeydownBlock = appSource.match(/function handleComposerKeyDown[\s\S]*?function handleComposerPaste/m)?.[0] ?? "";
assert(
  composerKeydownBlock.includes('event.key !== "Enter"') &&
  composerKeydownBlock.includes("event.shiftKey") &&
  composerKeydownBlock.includes("event.preventDefault()"),
  "composer should submit on Enter while preserving Shift+Enter for multiline input",
);

const generationModeOptionsBlock = appSource.match(/const generationModeOptions[\s\S]*?\];/m)?.[0] ?? "";
assert(
  generationModeOptionsBlock.includes('{ value: "standard"') &&
  generationModeOptionsBlock.includes('{ value: "render3d"') &&
  !generationModeOptionsBlock.includes("colored_floor_plan"),
  "primary mode buttons should expose only standard and render3d",
);

assert(
  appSource.includes('const PROMPT_SKILLS_STORAGE_KEY = "attuno-prompt-skills-v1";') &&
  appSource.includes("type PromptModeId = \"builtin-standard\" | \"builtin-render3d\" | `skill-${string}`;") &&
  appSource.includes("loadPromptSkillPreferences(currentUserId)") &&
  appSource.includes("savePromptSkillPreferences(normalized.map(promptSkillStorageShape), currentUserId)") &&
  appSource.includes("function applyPromptSkillTemplate(template: string, userPrompt: string)") &&
  appSource.includes("const promptModeOptions") &&
  appSource.includes("const visibleSelectedPromptModeId") &&
  appSource.includes("promptModeOptions.map((option)") &&
  appSource.includes("selectPromptMode(option.id)") &&
  appSource.includes("prompt-skill-manager") &&
  appSource.includes("prompt-skill-editor"),
  "image workspace should support account-scoped custom prompt skills beside the built-in default and 3D modes",
);

assert(
  appSource.includes('mode: submitMode,') &&
  appSource.includes("const submitPromptModeId = submitMode === \"standard\" && requestedPromptModeId.startsWith(\"skill-\")") &&
  appSource.includes("applyPromptSkillTemplate(skill.prompt, basePrompt)") &&
  appSource.includes("setGenerationMode(generationModeForPromptMode(modeId))") &&
  styles.includes(".prompt-skill-manager") &&
  styles.includes(".prompt-skill-editor input"),
  "custom prompt skills should submit as standard generation with the selected template applied to the composer prompt",
);

assert(
  appSource.includes('handleRunColoredFloorPlanTool') &&
  appSource.includes('runConversationFlow(undefined, "colored_floor_plan", "new-generation", promptModeIdForGenerationMode("colored_floor_plan"))') &&
  appSource.includes('className="chatgpt-tool-action"'),
  "colored floor plan should be available as an explicit floor-plan tool action instead of a primary mode",
);

assert(
  appSource.includes('{isImageWorkspace && (\n              <div className="chatgpt-composer__meta">') &&
  appSource.includes('className="chatgpt-composer__mode-row"') &&
  !appSource.includes("日常对话不会直接出图") &&
  !appSource.includes("Daily chat does not render directly") &&
  !appSource.includes("已输入 ${chatInput.trim().length} 字") &&
  !appSource.includes("${chatInput.trim().length} characters"),
  "composer meta should only render image controls and should not show chat-mode helper or character count text",
);

assert(
  appSource.includes('const QUICK_PHRASE_VISIBLE_LIMIT = 10;') &&
  appSource.includes('className="quick-phrase-popover"') &&
  appSource.includes('className="quick-phrase-card"') &&
  appSource.includes("shortcutPhrases.slice(0, QUICK_PHRASE_VISIBLE_LIMIT)") &&
  appSource.includes('aria-label={locale === "zh" ? "展开快捷短语" : "Open quick phrases"}') &&
  appSource.includes('title={locale === "zh" ? "插入快捷短语" : "Insert shortcut phrase"}') &&
  !appSource.includes('className="shortcut-toolbar"'),
  "shortcut phrases should live in a capped right-header popover instead of the composer bottom row",
);

assert(
  styles.includes(".quick-phrase-popover") &&
  styles.includes(".quick-phrase-card") &&
  styles.includes(".quick-phrase-card__list") &&
  /\.quick-phrase-card button:hover[\s\S]*?box-shadow:\s*0 10px 24px rgba\(15,\s*23,\s*42,\s*0\.13\);/m.test(styles) &&
  !styles.includes(".chatgpt-composer .shortcut-toolbar"),
  "quick phrase popover should be styled as a collapsible right-header card with hover shadow feedback",
);

const composerFormBlock = appSource.match(/<form className=\{`chatgpt-composer[\s\S]*?<\/form>/m)?.[0] ?? "";
assert(
  !composerFormBlock.includes('className="shortcut-toolbar"') &&
  !composerFormBlock.includes("shortcutPhrases.map"),
  "shortcut phrases should not render inside the composer form",
);

assert(
  appSource.includes("type ShortcutPhrase = {\n  id: string;\n  text: string;\n};") &&
  appSource.includes('const [shortcutDraft, setShortcutDraft] = useState({ text: "" });') &&
  appSource.includes('phrase.text || phrase.zh || phrase.en') &&
  !appSource.includes("中文短语") &&
  !appSource.includes("English phrase"),
  "shortcut phrases should use one shared text field while normalizing legacy zh/en entries",
);

assert(
  appSource.includes("function isRenderMessageComparisonDisabled") &&
  appSource.includes("sourceResultId: historyItem.id") &&
  appSource.includes("sourceResultId: message.sourceResultId") &&
  appSource.includes("const comparableImageCount = uniqueImageComparisonCandidates(comparisonCandidates).length;") &&
  appSource.includes("comparableImageCount >= 2") &&
  appSource.includes('source: "library"') &&
  appSource.includes("A 基准图 / B 对比图") &&
  appSource.includes("默认优先选当前聊天最近两张生成图") &&
  appSource.includes("至少需要两张不同的生成图才能对比") &&
  appSource.includes("!messageSourceResult?.floorPlanUrl && !floorPlanPreviews[0]?.url"),
  "chat-thread compare actions should use A/B image comparison with current-chat defaults, image-library fallback, and floor-plan fallback when needed",
);

assert(
  appSource.includes("chatProviderLabel") &&
  appSource.includes("chatModelValue") &&
  appSource.includes("handleChatModelChange") &&
  appSource.includes("handleDetectModels") &&
  appSource.includes("chatReasoningEffort") &&
  appSource.includes('className="chatgpt-composer__provider-badge"') &&
  appSource.includes('className="chatgpt-composer__model-select"') &&
  appSource.includes('className="chatgpt-composer__effort-select"'),
  "composer footer should expose provider, model switching, and effort controls near the send button",
);

assert(
  /\.chatgpt-composer__provider-badge\s*\{[\s\S]*?max-width:\s*132px;/m.test(styles) &&
  /\.chatgpt-composer__model-select,\s*\.chatgpt-composer__effort-select\s*\{[\s\S]*?max-width:\s*148px;/m.test(styles) &&
  styles.includes("font-size: 11px;"),
  "composer provider and model controls should stay visually compact",
);

assert(
  !composerFormBlock.includes("enableQualityEvaluation") &&
  appSource.includes('activeUtilityPanel === "analysis"') &&
  appSource.includes('className={`quality-toggle-card ${enableQualityEvaluation ? "quality-toggle-card--active" : ""}`}'),
  "strict review should be controlled from the Advanced drawer, not the composer actions",
);

assert(
  !appSource.includes("defaultChatModelOptions") &&
  !appSource.includes('"claude-3-5-sonnet"') &&
  appSource.includes("function isUsableModelName") &&
  appSource.includes("function removeStoredModelFragments") &&
  appSource.includes(".filter(isUsableModelName)") &&
  !appSource.includes("const analysis = modelSelectOptions(\"\", [model], current.analysis);") &&
  appSource.includes("addedDetectedModels.analysis") &&
  appSource.includes("addedDetectedModels.image") &&
  appSource.includes("detectedModels.analysis") &&
  appSource.includes("detectedModels.image"),
  "composer model choices should come from configured/added models instead of hard-coded chat fallbacks or partial typed fragments",
);

assert(
  appSource.includes('const ANALYSIS_MODEL_OPTIONS_STORAGE_KEY = "attuno-analysis-model-options-v1";') &&
  appSource.includes("loadStoredAnalysisModelOptions(currentUserId)") &&
  appSource.includes("storeAnalysisModelOptions(currentUserId, selectedAnalysisModelOptions)") &&
  appSource.includes("window.localStorage.removeItem(analysisModelOptionsStorageKey(currentUserId))") &&
  appSource.includes("function removeAnalysisModelOption") &&
  appSource.includes("function removeImageModelOption") &&
  appSource.includes('className="api-model-chip"') &&
  appSource.includes('className="api-model-chip__remove"') &&
  styles.includes(".api-model-chip__remove"),
  "added analysis model candidates should persist per account without changing the backend single-default-model config",
);

assert(
  appSource.includes("visibleApiKeys") &&
  appSource.includes('type={visibleApiKeys.analysis ? "text" : "password"}') &&
  appSource.includes('type={visibleApiKeys.image ? "text" : "password"}') &&
  studioDataSource.includes('export const defaultApiBaseUrl = "https://api.xyleisure.site/v1";') &&
  studioDataSource.includes("analysisBaseUrl: defaultApiBaseUrl") &&
  studioDataSource.includes("imageBaseUrl: defaultApiBaseUrl") &&
  styles.includes(".api-key-field") &&
  styles.includes(".config-status--good") &&
  styles.includes("color: #047857;"),
  "API setup should default to the Xyleisure endpoint, support explicit key show/hide controls, and use a readable success green",
);

assert(
  appSource.includes("MessageContent") &&
  appSource.includes("parseOrderedListParagraph") &&
  styles.includes(".message-markdown ol") &&
  styles.includes(".api-model-picker__list") &&
  styles.includes(".api-model-search-row"),
  "chat messages should render basic markdown lists and API setup should expose compact detected model controls",
);

assert(
  !appSource.includes("我已收到需求") &&
  !appSource.includes("The request is being submitted to the backend"),
  "image generation should not add a redundant pre-submit assistant acknowledgement message",
);

assert(
  !appSource.includes('message.kind === "analysis" && <span>{t.analysisCard}</span>'),
  "analysis chat cards should not show a repeated analysis label in the message header",
);

assert(
  appSource.includes('className="api-model-search-row api-config-wide"') &&
  appSource.includes('onClick={() => applyDetectedModels("analysis")}') &&
  appSource.includes('onClick={() => applyDetectedModels("image")}') &&
  appSource.includes("selectedAnalysisModelOptions") &&
  appSource.includes("toggleDetectedAnalysisModel") &&
  appSource.includes("toggleDetectedImageModel"),
  "API setup should keep model search buttons compact and allow multi-selecting detected analysis and image models",
);

const dailyChatFlowBlock = appSource.match(/async function runDailyChatFlow[\s\S]*?async function runConversationFlow/m)?.[0] ?? "";
assert(
  dailyChatFlowBlock.includes("streamDesignChat(") &&
  dailyChatFlowBlock.includes("message: userBrief") &&
  dailyChatFlowBlock.includes("api_config: requestApiConfig") &&
  dailyChatFlowBlock.includes("reasoning_effort: chatReasoningEffort") &&
  dailyChatFlowBlock.includes("buildLinearChatContext([...messages, nextPatch[0]], userMessageId)") &&
  dailyChatFlowBlock.includes("messages: requestMessages"),
  "daily chat submit should call the backend chat stream API with active provider/model config, effort, and the linear active path context",
);

assert(
  dailyChatFlowBlock.includes("assistantMessageId") &&
  dailyChatFlowBlock.includes("onDelta: (delta)") &&
  !dailyChatFlowBlock.includes('content: response.reply || "收到。"') &&
  !dailyChatFlowBlock.includes('content: response.reply || "Got it."'),
  "daily chat UI should update one assistant message during streaming and avoid synthesizing a fixed fallback reply",
);

const generationFlowBlock = appSource.match(/async function runConversationFlow[\s\S]*?function handleGenerate/m)?.[0] ?? "";
assert(
  appSource.includes("function clearComposerDraft()") &&
  dailyChatFlowBlock.includes("clearComposerDraft();") &&
  generationFlowBlock.includes("clearComposerDraft();") &&
  generationFlowBlock.includes("getGenerationBlocker(submitMode, userBrief)"),
  "composer draft text should clear after a real chat or image submit while validation uses the submitted prompt text",
);

assert(
  domainSource.includes('feedback?: "like" | "dislike";') &&
  appSource.includes('className="assistant-output-actions"') &&
  appSource.includes("handleOpenRetryPopover(message)") &&
  appSource.includes("handleRegenerateMessage(message, retryPopover.model)") &&
  appSource.includes('handleMessageFeedback(message, "like")') &&
  appSource.includes('handleMessageFeedback(message, "dislike")') &&
  appSource.includes("handleBranchFromMessage(message)") &&
  appSource.includes("handleCopyMessage(message)") &&
  appSource.includes("handleOpenComparison({ url: message.imageUrl") &&
  appSource.includes("handleDownloadResult(renderMessageDownloadItem)") &&
  !appSource.includes('className="render-card-actions"') &&
  styles.includes(".assistant-output-actions") &&
  styles.includes(".assistant-output-actions button.is-selected"),
  "assistant outputs should expose one unified action row with regenerate, feedback, branch, copy, compare, and download actions",
);

assert(
  appSource.includes("sessionId: currentSessionIdRef.current") &&
  !appSource.includes("if (isRendering || isChatResponding) return;\n    if (!sessionId || sessionId === currentSessionId) return;") &&
  appSource.includes("appendMessagesToRunSession(runGuard, resultMessages)") &&
  appSource.includes("normalizeSessionForDisplay(session)") &&
  appSource.includes('chatInput: ""'),
  "history sessions should remain clickable during generation and stale submitted composer text should be cleared on display",
);

assert(
  !/权限|permission|temporary access token|临时访问标识/.test(appSource),
  "composer and account UI should not reintroduce permission management or temporary-token copy",
);

assert(
  appSource.includes('className="chatgpt-sidebar__footer"') &&
  appSource.includes('className={`chatgpt-sidebar__account-menu ${isSidebarCollapsed ? "is-collapsed" : ""}`}') &&
  appSource.includes("settingsPanelItems.map") &&
  appSource.includes('panel: "preferences"') &&
  appSource.includes('panel: "generation"') &&
  appSource.includes('panel: "setup"') &&
  appSource.includes('panel: "analysis"') &&
  appSource.includes('panel: "prompts"') &&
  appSource.includes('activeUtilityPanel === "analysis"') &&
  appSource.includes('activeUtilityPanel === "prompts"') &&
  appSource.includes('openSettingsPanel(item.panel)'),
  "sidebar footer should expose a compact account menu with separate setup, advanced, and prompt destinations",
);

assert(
  appSource.includes('title: locale === "zh" ? "高级功能" : "Advanced"') &&
  appSource.includes('analysis: locale === "zh" ? "严格复核、运行阶段和平面图分析集中在这里。" : "Strict review, run stages, and floor-plan analysis live here."') &&
  !appSource.includes('{locale === "zh" ? "分析" : "Analysis"}'),
  "run analysis should live under the Advanced settings entry instead of a main-header action",
);

assert(
  appSource.includes('generation: locale === "zh" ? "调整下一次出图使用的模型、备用模型和轮数。" : "Tune the model, fallbacks, and pass count for the next image run."'),
  "generation settings should not advertise strict review after strict review moves into Advanced",
);

assert(
  !styles.includes(".chatgpt-sidebar__settings-popover") &&
  styles.includes(".chatgpt-sidebar__account-menu") &&
  styles.includes(".chatgpt-settings-backdrop") &&
  styles.includes(".chatgpt-drawer--settings-dialog .chatgpt-drawer__nav") &&
  appSource.includes('role={isSettingsDialogOpen ? "dialog" : undefined}'),
  "settings categories should open from the account menu into a dialog with category navigation instead of a sidebar popup",
);

assert(
  styles.includes("--chatgpt-sidebar-width") &&
  styles.includes("--chatgpt-drawer-width") &&
  styles.includes(".chatgpt-layout__resize-handle--sidebar") &&
  styles.includes(".chatgpt-layout__resize-handle--drawer") &&
  styles.includes("body.is-resizing-layout"),
  "desktop layout should support persistent draggable sidebar and drawer widths",
);

assert(
  /body\s*\{[\s\S]*?margin:\s*0;[\s\S]*?min-width:\s*320px;[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/m.test(styles) &&
  /\.studio-shell\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?height:\s*100dvh;/m.test(styles) &&
  /\.chatgpt-layout\s*\{[\s\S]*?--chatgpt-sidebar-width:\s*312px;[\s\S]*?height:\s*100dvh;/m.test(styles) &&
  /\.chatgpt-main\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/m.test(styles) &&
  /\.chatgpt-thread\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/m.test(styles),
  "chat layout should stay viewport-fixed and keep scrolling inside the message thread",
);

assert(
  appSource.includes("const isEmptyConversation = activePathMessages.length === 0 && !isVisibleRendering && !isVisibleChatResponding") &&
  appSource.includes('isEmptyConversation && !isImageManagementView ? "chatgpt-main--empty-conversation" : ""') &&
  appSource.includes('isEmptyConversation ? "is-empty" : ""') &&
  appSource.includes('isEmptyConversation ? "chatgpt-composer--empty-conversation" : ""') &&
  !appSource.includes('messages.length === 0 && !isRendering && !chatInput.trim()') &&
  !appSource.includes('messages.length === 0 && !isRendering && !hasPromptText'),
  "empty conversation state should not disappear while the user is typing an unsent draft or a background session is running",
);

assert(
  appSource.includes('visibleComposerPlaceholder') &&
  appSource.includes('locale === "zh" ? "有问题，尽管问" : "Ask anything"') &&
  appSource.includes('className="chatgpt-empty__suggestions"') &&
  appSource.includes('aria-label={locale === "zh" ? "快速开始" : "Quick starts"}') &&
  appSource.includes('onClick={() => isImageWorkspace ? composerRef.current?.focus() : switchWorkspaceMode("image")}') &&
  appSource.includes('onClick={openImageManagementView}'),
  "empty state should present one title, short composer placeholder, and compact suggestion chips",
);

assert(
  styles.includes(".chatgpt-main--empty-conversation") &&
  styles.includes("--empty-composer-width: min(1040px, calc(100% - 48px));") &&
  styles.includes("grid-template-rows: 58px minmax(28px, 0.28fr) auto minmax(0, 1fr);") &&
  styles.includes("width: var(--empty-composer-width);") &&
  styles.includes(".chatgpt-composer--empty-conversation") &&
  /\.chatgpt-composer--empty-conversation\s+\.chatgpt-composer__bar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/m.test(styles) &&
  styles.includes(".chatgpt-composer textarea:focus-visible"),
  "empty conversation composer should be centered, compact, lower on the page, reserve a send-button column, and avoid an inner textarea focus box",
);

assert(
  appSource.includes('className="chatgpt-composer__attachments-inner"') &&
  appSource.includes('className="chatgpt-composer__attachment-card"') &&
  appSource.includes('className="chatgpt-composer__attachment-card-close"') &&
  /\.chatgpt-composer--empty-conversation\s+\.chatgpt-composer__bar\.chatgpt-composer__bar--has-attachments\s*\{[\s\S]*?min-height:\s*292px;[\s\S]*?grid-template-areas:\s*"attachments attachments attachments"[\s\S]*?"plus textarea actions";[\s\S]*?border-radius:\s*32px;/m.test(styles) &&
  /\.chatgpt-composer__attachment-card-header\s*\{[\s\S]*?display:\s*contents;/m.test(styles) &&
  /\.chatgpt-composer__attachment-card-thumb,\s*\.chatgpt-composer__attachment-card-name\s*\{[\s\S]*?display:\s*none;/m.test(styles) &&
  /\.chatgpt-composer__attachment-card-close\s*\{[\s\S]*?background:\s*#050505;/m.test(styles) &&
  /\.chatgpt-composer__attachment-card-preview\s*\{[\s\S]*?height:\s*174px;/m.test(styles),
  "uploaded images should render as large in-composer thumbnails with a floating remove button",
);

assert(
  styles.includes("/* Productized app UI */") &&
  styles.includes("--app-sidebar-hover") &&
  styles.includes(".chatgpt-empty__suggestions") &&
  styles.includes(".chatgpt-drawer.chatgpt-drawer--settings-dialog") &&
  styles.includes("@media (max-width: 860px)"),
  "productized UI overrides should define final tokens, empty suggestion chips, settings dialog polish, and mobile constraints",
);

assert(
  styles.includes("--chat-composer-veil-height") &&
  styles.includes(".chatgpt-main::after") &&
  /\.chatgpt-main::after\s*\{[\s\S]*?z-index:\s*3;[\s\S]*?pointer-events:\s*none;[\s\S]*?var\(--app-canvas\)/m.test(styles) &&
  /\.chatgpt-thread\s*\{[\s\S]*?z-index:\s*1;/m.test(styles) &&
  /\.chatgpt-composer\s*\{[\s\S]*?z-index:\s*4;/m.test(styles),
  "composer should veil scrolled thread content below the input while keeping the input above the mask",
);

const generationBlockerBlock = appSource.match(/function getGenerationBlocker[\s\S]*?const canEditSelectedResult/m)?.[0] ?? "";
assert(
  generationBlockerBlock.includes('mode === "colored_floor_plan" && floorPlanFiles.length === 0') &&
  !generationBlockerBlock.includes('if (floorPlanFiles.length === 0)') &&
  appSource.includes(': hasPromptText;') &&
  appSource.includes('3D 提示词增强会在你的输入上追加效果图表达') &&
  generationModeOptionsBlock.includes("3D 提示词增强"),
  "3D render generation should behave as prompt enhancement while colored floor plan still requires an uploaded plan",
);

assert(
  appSource.includes('setWorkspaceMode("image");') &&
  appSource.includes('setActivePrimaryView("workspace");') &&
  appSource.includes('onDragEnter={handleWorkspaceDragEnter}') &&
  appSource.includes('onDragOver={handleWorkspaceDragOver}') &&
  appSource.includes('onDrop={handleWorkspaceDrop}') &&
  appSource.includes('setFloorPlansFromFiles(event.dataTransfer.files, true)'),
  "drag-and-drop images should be accepted at workspace level and route into image mode attachments",
);

assert(
  appSource.includes("function setComposerImageAttachments") &&
  appSource.includes("setComposerImageAttachments(e.target.files, true)") &&
  appSource.includes("setComposerImageAttachments(images, true)") &&
  appSource.includes('isChatWorkspace\n      ? locale === "zh" ? `已添加 ${imageFiles.length} 张聊天图片`'),
  "composer uploads and pasted images should stay in chat mode as chat attachments",
);

assert(
  appSource.includes("findPreviousUserMessage(message.id)") &&
  appSource.includes("retryAttachments: previousUserMessage?.attachments"),
  "retrying an assistant answer should preserve the original user image attachments",
);

const editUserMessageBlock = appSource.match(/function handleEditUserMessage[\s\S]*?function updateEditedUserMessageDraft/m)?.[0] ?? "";
const submitEditedUserMessageBlock = appSource.match(/function submitEditedUserMessage[\s\S]*?function handleEditedUserMessageKeyDown/m)?.[0] ?? "";
assert(
  editUserMessageBlock.includes("setEditingMessage({ messageId: message.id, parentId: message.parentId ?? null, draft })") &&
  !editUserMessageBlock.includes("setActiveMessageId(message.id)") &&
  submitEditedUserMessageBlock.includes("editParentId: editingMessage.parentId") &&
  submitEditedUserMessageBlock.includes("submittedAttachments: activeMessage.attachments ?? []") &&
  appSource.includes("className=\"message-inline-editor\"") &&
  appSource.includes('"chat-message--editing"') &&
  styles.includes(".message-inline-editor"),
  "editing a user message should preserve the visible branch and render an inline editor that resubmits as a sibling branch",
);

assert(
  appSource.includes('activeMessage.attachments && activeMessage.attachments.length > 0') &&
  appSource.includes('onClick={() => handleExpandPreview({ url: attachment.dataUrl') &&
  appSource.includes('className="chatgpt-composer__attachment"'),
  "submitted chat image attachments should remain visible in the message thread",
);

assert(
  appSource.includes('if (activeMessage.kind === "render" && activeMessage.imageUrl)') &&
  appSource.includes("await handleCopyImage(activeMessage.imageUrl, activeMessage.imageLabel)") &&
  appSource.includes('const isStreamingAssistantMessage = isVisibleChatResponding') &&
  appSource.includes('className="assistant-streaming-indicator"') &&
  styles.includes(".assistant-streaming-indicator") &&
  styles.includes("@keyframes assistant-streaming-pulse"),
  "render message copy should copy the image, and active assistant replies should show a streaming status indicator",
);

assert(
  /\.chatgpt-drawer--settings-dialog\s+\.chatgpt-drawer__stack\s*\{[\s\S]*?align-content:\s*start;[\s\S]*?padding:\s*14px 16px 18px;/m.test(styles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.config-action-row\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/m.test(styles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.config-toggle\s*\{[\s\S]*?min-height:\s*38px;/m.test(styles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.api-config-grid\s*\{[\s\S]*?gap:\s*10px;[\s\S]*?padding:\s*10px;/m.test(styles),
  "settings and generation control drawers should keep compact cards, controls, and top-aligned content",
);
