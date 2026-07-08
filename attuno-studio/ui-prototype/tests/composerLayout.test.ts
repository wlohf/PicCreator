// @ts-ignore Node's builtin types are not part of this lightweight test harness.
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const styles = readSource("../src/styles.css");
const appSource = readSource("../src/App.tsx");
const chatWorkspaceSource = readSource("../src/components/chat-workspace.tsx");
const workspaceSource = `${appSource}\n${chatWorkspaceSource}`;
const studioDataSource = readSource("../src/data/studioData.ts");
const domainSource = readSource("../src/types/domain.ts");
const finalParityMarker = "/* Attuno OpenDesign final parity pass */";
const finalStyles = styles.slice(styles.lastIndexOf(finalParityMarker));

assert(
  finalStyles.startsWith(finalParityMarker) &&
  /\.chatgpt-composer__bar,[\s\S]*?\.chatgpt-composer--empty-conversation \.chatgpt-composer__bar\.chatgpt-composer__bar--has-attachments\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?grid-template-areas:\s*"attachments"[\s\S]*?"textarea"[\s\S]*?"toolbar";/m.test(finalStyles) &&
  /\.chatgpt-composer__inline-actions\.composer-toolbar,[\s\S]*?\.chatgpt-composer--empty-conversation \.chatgpt-composer__inline-actions\.composer-toolbar\s*\{[\s\S]*?justify-content:\s*space-between;[\s\S]*?border-top:\s*1px solid rgba\(231,\s*222,\s*209,\s*0\.66\);/m.test(finalStyles),
  "final OpenDesign composer should use a textarea-over-toolbar layout with the toolbar separated by a warm divider",
);

assert(
  chatWorkspaceSource.includes("rows={1}") &&
  /\.chatgpt-composer textarea,[\s\S]*?\.chatgpt-composer--empty-conversation textarea\s*\{[\s\S]*?min-height:\s*calc\(1lh \+ 18px\);[\s\S]*?white-space:\s*pre-wrap;[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?word-break:\s*break-word;/m.test(finalStyles) &&
  appSource.includes("Math.min(textarea.scrollHeight, COMPOSER_MAX_VISIBLE_HEIGHT)"),
  "chat composer textarea should start compact, wrap long text, and grow dynamically up to the visible height cap",
);

assert(
  domainSource.includes("chatMaxOutputTokens: number;") &&
  domainSource.includes("chatContextSize: number;") &&
  studioDataSource.includes("chatMaxOutputTokens: 131072") &&
  studioDataSource.includes("chatContextSize: 131072") &&
  appSource.includes("输出 Token 上限") &&
  appSource.includes("上下文大小") &&
  appSource.includes("normalizePositiveInteger(event.target.value, current.chatMaxOutputTokens") &&
  appSource.includes("normalizePositiveInteger(event.target.value, current.chatContextSize"),
  "settings UI should expose saved chat output token and context size controls",
);

assert(
  appSource.includes("const CHAT_AUTO_FOLLOW_BOTTOM_THRESHOLD = 96") &&
  appSource.includes("const shouldAutoFollowChatRef = useRef(true)") &&
  appSource.includes("function isChatThreadNearBottom") &&
  appSource.includes("function handleChatThreadScroll") &&
  appSource.includes("shouldAutoFollowChatRef.current = true;") &&
  appSource.includes("if (!thread || !shouldAutoFollowChatRef.current) return;") &&
  appSource.includes("onScroll={handleChatThreadScroll}"),
  "streaming chat should auto-follow only while the user remains near the bottom of the thread",
);

assert(
  /\.chatgpt-composer\.composer\s*\{[\s\S]*?position:\s*relative;[\s\S]*?left:\s*auto;[\s\S]*?bottom:\s*auto;[\s\S]*?margin:\s*0 auto 24px;[\s\S]*?transform:\s*none;/m.test(finalStyles),
  "restored non-empty conversations should keep the composer in the main grid flow instead of inheriting the old absolute centered position",
);

assert(
  styles.includes("/* Attuno OpenDesign chat redesign integration */") &&
  finalStyles.includes(finalParityMarker) &&
  styles.includes("--attuno-bg: #fbf8f2;") &&
  styles.includes("--attuno-accent: #a65f3f;") &&
  styles.includes('--app-display-font: "Signifier"'),
  "OpenDesign-derived Attuno theme tokens should be present in the production stylesheet",
);

assert(
  /html,\s*body,\s*#root,\s*\.studio-shell\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/m.test(styles) &&
  /\.chatgpt-layout,[\s\S]*?\.chatgpt-layout\.is-sidebar-collapsed\.has-drawer\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/m.test(finalStyles) &&
  /\.chatgpt-main\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?grid-template-rows:\s*68px minmax\(0,\s*1fr\) auto;/m.test(finalStyles),
  "OpenDesign theme should preserve a fixed viewport app shell with the thread as the scroll owner",
);

assert(
  /\.chatgpt-thread\.chat-shell\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?padding:\s*42px 28px 24px;/m.test(finalStyles),
  "chat thread should keep the OpenDesign desktop spacing while retaining vertical scrolling",
);

assert(
  /\.chatgpt-thread\.chat-shell\s*\{[\s\S]*?display:\s*grid;[\s\S]*?align-content:\s*start;[\s\S]*?align-items:\s*start;[\s\S]*?grid-auto-rows:\s*max-content;/m.test(finalStyles),
  "chat thread grid rows should stay content-sized so short conversations do not stretch message cards into tall empty panels",
);

const mobileRulePattern = /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-composer\.composer\s*\{[\s\S]*?border-radius:\s*24px;/m;
assert(
  mobileRulePattern.test(finalStyles),
  "mobile composer should keep the OpenDesign rounded shell while the toolbar wraps below the textarea",
);

assert(
  /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-composer__inline-actions\.composer-toolbar,[\s\S]*?\.chatgpt-composer--empty-conversation \.chatgpt-composer__inline-actions\.composer-toolbar\s*\{[\s\S]*?flex-wrap:\s*wrap;/m.test(finalStyles),
  "OpenDesign mobile override should let composer toolbar groups wrap without changing backend controls",
);

assert(
  /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-composer textarea,\s*\.chatgpt-composer--empty-conversation textarea\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*15px;/m.test(finalStyles) &&
  /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-composer__tool-group--end\s*\{[\s\S]*?justify-content:\s*space-between;/m.test(finalStyles),
  "mobile OpenDesign composer should keep the textarea readable and preserve the trailing model/send controls",
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
  chatWorkspaceSource.includes("promptModeOptions.map((option)") &&
  appSource.includes("onSelectPromptMode={(modeId) => selectPromptMode(modeId as PromptModeId)}") &&
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
  chatWorkspaceSource.includes('className="chatgpt-tool-action"'),
  "colored floor plan should be available as an explicit floor-plan tool action instead of a primary mode",
);

assert(
  chatWorkspaceSource.includes("{isImageWorkspace && (") &&
  chatWorkspaceSource.includes('className="chatgpt-composer__meta"') &&
  chatWorkspaceSource.includes('className="chatgpt-composer__mode-row"') &&
  !workspaceSource.includes("日常对话不会直接出图") &&
  !workspaceSource.includes("Daily chat does not render directly") &&
  !workspaceSource.includes("已输入 ${chatInput.trim().length} 字") &&
  !workspaceSource.includes("${chatInput.trim().length} characters"),
  "composer meta should only render image controls and should not show chat-mode helper or character count text",
);

assert(
  appSource.includes('const QUICK_PHRASE_VISIBLE_LIMIT = 10;') &&
  chatWorkspaceSource.includes('className="quick-phrase-popover"') &&
  chatWorkspaceSource.includes('className="quick-phrase-card"') &&
  appSource.includes("quickPhrases={quickPhraseViewItems}") &&
  appSource.includes("quickPhraseLimit={QUICK_PHRASE_VISIBLE_LIMIT}") &&
  chatWorkspaceSource.includes("quickPhrases.slice(0, quickPhraseLimit)") &&
  chatWorkspaceSource.includes('aria-label={localeText(locale, "展开快捷短语", "Open quick phrases")}') &&
  chatWorkspaceSource.includes('title={localeText(locale, "插入快捷短语", "Insert shortcut phrase")}') &&
  !workspaceSource.includes('className="shortcut-toolbar"'),
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

const composerFormBlock = chatWorkspaceSource.match(/<form className=\{`chatgpt-composer[\s\S]*?<\/form>/m)?.[0] ?? "";
assert(
  !composerFormBlock.includes('className="shortcut-toolbar"') &&
  !composerFormBlock.includes("shortcutPhrases.map"),
  "shortcut phrases should not render inside the composer form",
);

assert(
  !workspaceSource.includes("Globe2") &&
  !workspaceSource.includes("onWebSearch") &&
  !workspaceSource.includes("onVoice") &&
  !composerFormBlock.includes("chatgpt-composer__mic-btn") &&
  !composerFormBlock.includes("chatgpt-composer__web-btn") &&
  !composerFormBlock.includes("联网搜索") &&
  !composerFormBlock.includes("语音") &&
  !composerFormBlock.includes("composer-hint") &&
  !composerFormBlock.includes("chatgpt-mode-note") &&
  !workspaceSource.includes("请输入要直接发送给画图模型的提示词") &&
  !workspaceSource.includes("Enter the prompt to send directly to the image model"),
  "composer should remove voice/web controls and bottom helper prompt copy from the rendered form",
);

assert(
  /\/\* Composer and settings refinement \*\//.test(finalStyles) &&
  /\.chatgpt-composer textarea,[\s\S]*?\.chatgpt-composer--empty-conversation textarea:focus-visible\s*\{[\s\S]*?border:\s*0 !important;[\s\S]*?outline:\s*0 !important;[\s\S]*?box-shadow:\s*none !important;[\s\S]*?resize:\s*none;/m.test(finalStyles) &&
  /\.chatgpt-composer__inline-actions\.composer-toolbar,[\s\S]*?\.chatgpt-composer--empty-conversation \.chatgpt-composer__inline-actions\.composer-toolbar\s*\{[\s\S]*?gap:\s*18px;[\s\S]*?padding-top:\s*12px;/m.test(finalStyles) &&
  /\.chatgpt-composer__tool-group\.tool-group\s*\{[\s\S]*?gap:\s*12px;/m.test(finalStyles),
  "composer refinement should remove the textarea focus rectangle and loosen toolbar spacing",
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
  appSource.includes("sourceResultId: activeMessage.sourceResultId") &&
  appSource.includes("const comparableImageCount = uniqueImageComparisonCandidates(comparisonCandidates).length;") &&
  appSource.includes("comparableImageCount >= 2") &&
  appSource.includes('source: "library"') &&
  appSource.includes("A 基准图 / B 对比图") &&
  appSource.includes("默认优先选当前聊天的上传源图和最新结果") &&
  appSource.includes("至少需要两张不同图片才能对比") &&
  appSource.includes("!messageSourceResult?.floorPlanUrl && !floorPlanPreviews[0]?.url"),
  "chat-thread compare actions should use A/B image comparison with current-chat source/result defaults, image-library fallback, and floor-plan fallback when needed",
);

assert(
  appSource.includes('type MemoryProjectPreferenceGroup = "style" | "furniture" | "structure" | "materials" | "lighting" | "avoid";') &&
  appSource.includes('const [newMemoryDraft, setNewMemoryDraft] = useState<MemoryDraft>({ text: "", sectionId: "long_term_preferences", group: "style" });') &&
  appSource.includes("projectPreferenceGroupOptions.map((option)") &&
  appSource.includes("function handlePrepareMemoryDraftForSection") &&
  appSource.includes("function handleCopyMemoryItemToDraft") &&
  appSource.includes("createMemoryItem(nextText, newMemoryDraft.sectionId, DEFAULT_PROJECT_ID, newMemoryDraft.group)") &&
  appSource.includes("添加到这里") &&
  appSource.includes("转为记忆") &&
  styles.includes(".memory-section-head") &&
  styles.includes(".memory-item-group"),
  "memory management should expose section add-here actions, project preference groups, and read-only copy-to-form controls",
);

assert(
  appSource.includes('type ComparisonSlot = "left" | "right";') &&
  appSource.includes('const [comparisonActiveSlot, setComparisonActiveSlot] = useState<ComparisonSlot>("right");') &&
  appSource.includes('const [comparisonCandidateSource, setComparisonCandidateSource] = useState<ImageComparisonCandidateSource>("conversation");') &&
  appSource.includes("function handleAssignComparisonCandidate") &&
  appSource.includes('className="comparison-slot-row"') &&
  appSource.includes('className="comparison-source-tabs"') &&
  appSource.includes('className="comparison-thumbnail-grid"') &&
  appSource.includes('data-source={candidate.source}') &&
  appSource.includes("candidate.source === comparisonCandidateSource") &&
  styles.includes(".comparison-slot-card") &&
  styles.includes(".comparison-thumbnail-grid"),
  "comparison analysis should provide visual A/B slots, current-chat/library tabs, and clickable thumbnail candidates",
);

assert(
  appSource.includes("chatProviderLabel") &&
  appSource.includes("chatModelValue") &&
  appSource.includes("handleChatModelChange") &&
  appSource.includes("handleDetectModels") &&
  appSource.includes("chatReasoningEffort") &&
  chatWorkspaceSource.includes('className="chatgpt-composer__provider-badge"') &&
  chatWorkspaceSource.includes('className="chatgpt-composer__model-select chip-btn"') &&
  chatWorkspaceSource.includes('className="chatgpt-composer__effort-select"'),
  "composer footer should expose provider, model switching, and effort controls near the send button",
);

assert(
  /\.chatgpt-composer__provider-badge\s*\{[\s\S]*?max-width:\s*168px;/m.test(finalStyles) &&
  /\.chatgpt-composer__model-select,\s*\.chatgpt-composer__effort-select\s*\{[\s\S]*?max-width:\s*148px;/m.test(finalStyles) &&
  /font-size:\s*14px;/.test(finalStyles),
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
  appSource.includes("parseMarkdownBlocks") &&
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
  dailyChatFlowBlock.includes("buildLinearChatContext([...baseMessages, nextPatch[0]], userMessageId)") &&
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
const annotationEditFlowBlock = appSource.match(/async function handleSubmitAnnotationEdit[\s\S]*?function applyGenerationProgress/m)?.[0] ?? "";
assert(
  appSource.includes("function clearComposerDraft()") &&
  appSource.includes("function clearComposerAfterSubmit") &&
  dailyChatFlowBlock.includes("clearComposerDraft();") &&
  generationFlowBlock.includes("clearComposerAfterSubmit(submitComposerMode, submittedFiles.length)") &&
  generationFlowBlock.includes("getGenerationBlocker(submitMode, userBrief, submittedFiles.length)"),
  "composer draft text and submitted image attachments should clear after a real chat or image submit while validation uses the submitted prompt text",
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
  appSource.includes("handleOpenComparison({ url: activeMessage.imageUrl") &&
  appSource.includes("handleDownloadResult(renderMessageDownloadItem ?? fallbackRenderMessageDownloadItem)") &&
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
  appSource.includes("function sanitizeSessionForPersistence") &&
  appSource.includes('url.startsWith("data:image/") || !url.startsWith("data:")') &&
  appSource.includes('!url.startsWith("blob:")') &&
  appSource.includes("const persistableSessions = chatSessions.map(sanitizeSessionForPersistence)") &&
  /try\s*\{\s*window\.localStorage\.setItem\(chatHistoryStorageKey\(currentUserId\),\s*serialized\);\s*\}\s*catch/m.test(appSource),
  "chat history persistence should keep durable image attachments, filter blob previews, and catch storage quota failures",
);

assert(
  !/权限|permission|temporary access token|临时访问标识/.test(appSource),
  "composer and account UI should not reintroduce permission management or temporary-token copy",
);

assert(
  chatWorkspaceSource.includes('className="chatgpt-sidebar__footer user-card"') &&
  chatWorkspaceSource.includes('className={`chatgpt-sidebar__footer-settings icon-btn ${isSettingsActive ? "is-active active" : ""} ${isSidebarCollapsed ? "is-collapsed" : ""}`}') &&
  chatWorkspaceSource.includes('onClick={() => onOpenSettingsPanel("setup")}') &&
  appSource.includes('isSettingsActive={isSettingsPanel(activeUtilityPanel)}') &&
  chatWorkspaceSource.includes('className={`chatgpt-sidebar__account-menu ${isSidebarCollapsed ? "is-collapsed" : ""}`}') &&
  appSource.includes("settingsPanelItems.map") &&
  appSource.includes('panel: "preferences" as const') &&
  appSource.includes('panel: "setup" as const') &&
  appSource.includes('panel: "analysis" as const') &&
  appSource.includes('panel: "prompts" as const') &&
  !appSource.includes('panel: "generation" as const') &&
  appSource.includes('activeUtilityPanel === "analysis"') &&
  appSource.includes('activeUtilityPanel === "prompts"') &&
  appSource.includes('openSettingsPanel(item.panel)') &&
  /\.chatgpt-sidebar__footer\.user-card\s*\{[\s\S]*?grid-template-columns:\s*38px minmax\(0,\s*1fr\) 36px;/m.test(finalStyles) &&
  /\.chatgpt-sidebar__footer-settings\s*\{[\s\S]*?grid-column:\s*3;/m.test(finalStyles),
  "sidebar footer should match the OpenDesign user-card with a separate settings gear and current category settings destinations",
);

assert(
  appSource.includes('title: locale === "zh" ? "高级功能" : "Advanced"') &&
  appSource.includes('analysis: locale === "zh" ? "严格复核、运行阶段和平面图分析集中在这里。" : "Strict review, run stages, and floor-plan analysis live here."') &&
  !appSource.includes('{locale === "zh" ? "分析" : "Analysis"}'),
  "run analysis should live under the Advanced settings entry instead of a main-header action",
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
  chatWorkspaceSource.includes('isEmptyConversation ? "chatgpt-composer--empty-conversation" : ""') &&
  !appSource.includes('messages.length === 0 && !isRendering && !chatInput.trim()') &&
  !appSource.includes('messages.length === 0 && !isRendering && !hasPromptText'),
  "empty conversation state should not disappear while the user is typing an unsent draft or a background session is running",
);

assert(
  appSource.includes('visibleComposerPlaceholder') &&
  appSource.includes('locale === "zh" ? "有问题，尽管问" : "Ask anything"') &&
  appSource.includes("const emptyPromptCards") &&
  chatWorkspaceSource.includes("ATTUNO WORKSPACE") &&
  chatWorkspaceSource.includes("我们先把想法变成可执行的下一步。") &&
  chatWorkspaceSource.includes('className="chatgpt-empty__starter-icon"') &&
  chatWorkspaceSource.includes('className="chatgpt-empty__starter-copy"') &&
  appSource.includes("emptyPromptStarterCards") &&
  appSource.includes("emptyPromptCards.map((card)") &&
  appSource.includes("insertComposerPhrase(card.prompt)") &&
  appSource.includes("switchWorkspaceMode(targetMode)") &&
  chatWorkspaceSource.includes('<span>{localeText(locale, "附件", "Attach")}</span>'),
  "empty state should present the OpenDesign hero, six prompt cards, and a real attachment control",
);

assert(
  appSource.includes('const CUSTOM_PROMPT_PLAZA_STORAGE_KEY = "attuno-custom-prompt-plaza-v1";') &&
  appSource.includes('const PROMPT_PLAZA_FAVORITES_STORAGE_KEY = "attuno-prompt-plaza-favorites-v1";') &&
  appSource.includes('const PROMPT_PLAZA_LIKES_STORAGE_KEY = "attuno-prompt-plaza-likes-v1";') &&
  appSource.includes('type PromptPlazaSource = "official" | "community" | "team" | "user";') &&
  appSource.includes("function parseImportedPromptPlazaItems") &&
  appSource.includes("function savePromptPlazaDraft") &&
  appSource.includes("handleImportPromptPlazaFile") &&
  appSource.includes("function togglePromptPlazaLike") &&
  appSource.includes("PROMPT_PLAZA_COMMUNITY_LIKE_THRESHOLD") &&
  appSource.includes('className="visually-hidden-input"') &&
  appSource.includes("customPromptPlazaItems") &&
  appSource.includes("添加提示词") &&
  appSource.includes("导入文件") &&
  appSource.includes("我的提示词"),
  "prompt plaza should support locally persisted custom prompts and file import",
);

assert(
  appSource.includes('id: "image-edit-reference"') &&
  appSource.includes('id: "ui-screenshot-review"') &&
  appSource.includes('id: "extract-table"') &&
  appSource.includes('id: "social-post"') &&
  /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(320px,\s*1fr\)\);/.test(styles) &&
  styles.includes("max-width: 420px;") &&
  styles.includes("justify-content: start;") &&
  /\.plaza-card\s*\{[\s\S]*?min-height:\s*286px;/m.test(styles) &&
  /\.plaza-preview\s*\{[\s\S]*?min-height:\s*58px;/m.test(styles),
  "prompt plaza cards should keep fixed widths, seed basic examples, and avoid large empty image placeholders",
);

assert(
  !workspaceSource.includes('className="chatgpt-empty__suggestions"') &&
  !workspaceSource.includes('aria-label={locale === "zh" ? "快速开始" : "Quick starts"}') &&
  chatWorkspaceSource.includes('className="chatgpt-composer__plus-btn tool-btn"') &&
  chatWorkspaceSource.includes('<Send size={18} />') &&
  !workspaceSource.includes("AudioLines"),
  "empty conversation should use the OpenDesign prompt grid and composer controls without the old quick-start chip row",
);

assert(
  styles.includes(".chatgpt-main--empty-conversation") &&
  styles.includes("/* Attuno OpenDesign high-fidelity refinement */") &&
  styles.includes("@keyframes attuno-rise") &&
  styles.includes("@keyframes attuno-pop") &&
  styles.includes("@keyframes attuno-pulse") &&
  styles.includes("--empty-composer-width: min(920px, calc(100% - 56px));") &&
  styles.includes("grid-template-rows: 68px minmax(0, 1fr) auto;") &&
  styles.includes("width: var(--empty-composer-width);") &&
  styles.includes(".chatgpt-composer--empty-conversation") &&
  /\.chatgpt-composer--empty-conversation\s+\.chatgpt-composer__bar\s*\{[\s\S]*?min-height:\s*146px;[\s\S]*?grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;[\s\S]*?grid-template-areas:\s*"textarea textarea textarea"[\s\S]*?"plus spacer actions";/m.test(styles) &&
  /\.chatgpt-empty__starters button:nth-child\(6\)\s*\{[\s\S]*?animation-delay:\s*200ms;/m.test(styles) &&
  /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-empty__starters\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/m.test(styles) &&
  /@media \(max-width: 860px\)[\s\S]*?\.chatgpt-composer--empty-conversation \.chatgpt-composer__bar\s*\{[\s\S]*?grid-template-areas:\s*"plus textarea actions";/m.test(styles) &&
  styles.includes(".chatgpt-composer textarea:focus-visible"),
  "empty conversation should match the OpenDesign hero/cards/composer layout with responsive motion-safe refinements",
);

assert(
  chatWorkspaceSource.includes('className="chatgpt-composer__attachments-inner"') &&
  chatWorkspaceSource.includes('className="chatgpt-composer__attachment-card"') &&
  chatWorkspaceSource.includes('className="chatgpt-composer__attachment-card-close"') &&
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
  styles.includes(".chatgpt-drawer.chatgpt-drawer--settings-dialog") &&
  styles.includes("@media (max-width: 860px)"),
  "productized UI overrides should define final tokens, settings dialog polish, and mobile constraints",
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
  generationBlockerBlock.includes('mode === "colored_floor_plan" && floorPlanFileCount === 0') &&
  !generationBlockerBlock.includes('if (floorPlanFiles.length === 0)') &&
  appSource.includes(': hasPromptText;') &&
  generationBlockerBlock.includes('mode === "render3d" && !hasSubmitPromptText') &&
  generationBlockerBlock.includes('请填写画面需求，或使用快捷短语补充 3D 效果提示词') &&
  generationModeOptionsBlock.includes("3D 提示词增强") &&
  !workspaceSource.includes("请输入要直接发送给画图模型的提示词"),
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
  appSource.includes("setComposerImageAttachments(event.target.files, true)") &&
  appSource.includes("setComposerImageAttachments(images, true)") &&
  chatWorkspaceSource.includes("onChange={onFileChange}") &&
  (appSource.match(/function setComposerImageAttachments[\s\S]*?function removeFloorPlan/m)?.[0] ?? "").includes("isChatWorkspace") &&
  (appSource.match(/function setComposerImageAttachments[\s\S]*?function removeFloorPlan/m)?.[0] ?? "").includes("张聊天图片") &&
  (appSource.match(/function setComposerImageAttachments[\s\S]*?function removeFloorPlan/m)?.[0] ?? "").includes("chat image(s) attached"),
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
  appSource.includes("function buildGenerationPreviewAttachments") &&
  generationFlowBlock.includes("await buildGenerationPreviewAttachments(submittedFiles)") &&
  generationFlowBlock.includes("const submittedFiles = requestedFiles ?? [...floorPlanFiles]") &&
  generationFlowBlock.includes("const submittedFloorPlanUrl = submittedFloorPlanPreview?.dataUrl") &&
  generationFlowBlock.includes("attachments: generationAttachments") &&
  generationFlowBlock.includes("floorPlanFiles: submittedFiles"),
  "submitted image-generation uploads should stay visible in the user message and result metadata while using the same file snapshot sent to generation",
);

const comparisonCandidateBlock = appSource.match(/const conversationComparisonCandidates = useMemo[\s\S]*?const maxIterations/m)?.[0] ?? "";
const defaultComparisonPairBlock = appSource.match(/function resolveDefaultComparisonPair[\s\S]*?function handleOpenComparison/m)?.[0] ?? "";
assert(
  appSource.includes('type ImageComparisonCandidateAssetType = "source-image" | "result-image"') &&
  comparisonCandidateBlock.includes("activeMessage.attachments?.length") &&
  comparisonCandidateBlock.includes('assetType: "source-image"') &&
  comparisonCandidateBlock.includes('assetType: "result-image"') &&
  comparisonCandidateBlock.includes("上传源图") &&
  defaultComparisonPairBlock.includes('candidate.assetType === "source-image"') &&
  defaultComparisonPairBlock.includes('candidate.assetType === "result-image"') &&
  appSource.includes("默认优先选当前聊天的上传源图和最新结果"),
  "uploaded source images should become compare candidates and default against the latest generated or edited result",
);

assert(
  appSource.includes("function getImageEditBlocker") &&
  appSource.includes("!sourceResultHasImage && sourceFileCount === 0") &&
  generationFlowBlock.includes("getImageEditBlocker(userBrief, submittedFiles.length, Boolean(activeResult?.imageUrl))") &&
  generationFlowBlock.includes("const shouldEditUploadedReference = submittedFiles.length > 0") &&
  generationFlowBlock.includes('mode: "standard"') &&
  generationFlowBlock.includes("floorPlanFiles: submittedFiles"),
  "edit mode should allow uploaded reference images to use the standard image-to-image generation path without requiring a selected history result",
);

assert(
  generationFlowBlock.includes('id: `m-live-analysis-${idBase}`') &&
  generationFlowBlock.includes("已提交生成请求，正在等待图片服务返回结果。") &&
  generationFlowBlock.includes("If the upstream service fails, the reason will appear here") &&
  generationFlowBlock.includes("removeLiveAnalysisMessage(runGuard, idBase);") &&
  appSource.includes("正在画图中，未卡住") &&
  appSource.includes("generation-progress-status") &&
  styles.includes(".generation-progress-status"),
  "image generation should immediately show a visible assistant pending state and clear it before final success or failure output",
);

const finalRenderMessageBlocks = [...generationFlowBlock.matchAll(/\{\s*id: `m-api-render-\$\{idBase\}`,[\s\S]*?\.\.\.variantPatchToAssistantMessage\(renderPatch,/g)]
  .map((match) => match[0]);
const renderRetryUpdateMatches = [...generationFlowBlock.matchAll(/updateRunSessionActiveMessageVariant\(runGuard, retryTargetMessageId, renderPatch\)/g)];
assert(
  finalRenderMessageBlocks.length === 3 &&
  finalRenderMessageBlocks.every((block) => block.includes("parentId: userMessageId")) &&
  renderRetryUpdateMatches.length === 3 &&
  !generationFlowBlock.includes('id: `m-api-analysis-${idBase}`') &&
  !generationFlowBlock.includes('parentId: `m-api-analysis-${idBase}`') &&
  generationFlowBlock.includes("promptText: finalPrompt") &&
  generationFlowBlock.includes("imageUrl: historyItem.imageUrl || firstImage?.url || firstImage?.data_url") &&
  generationFlowBlock.includes("sourceResultId: historyItem.id"),
  "successful image generation/edit flows should append only the final render message directly under the user request",
);

const annotationRenderMessageBlocks = [...annotationEditFlowBlock.matchAll(/\{\s*id: `m-api-annotation-render-\$\{idBase\}`,[\s\S]*?sourceResultId: historyItem.id,/g)]
  .map((match) => match[0]);
assert(
  annotationEditFlowBlock.includes("id: annotationProgressMessageId") &&
  annotationEditFlowBlock.includes("removeRunSessionMessage(runGuard, annotationProgressMessageId)") &&
  annotationRenderMessageBlocks.length === 1 &&
  annotationRenderMessageBlocks.every((block) =>
    block.includes("parentId: annotationUserMessageId") &&
    block.includes("bullets: {") &&
    block.includes("promptText: historyItem.prompt")
  ) &&
  !annotationEditFlowBlock.includes('id: `m-api-annotation-analysis-${idBase}`') &&
  annotationEditFlowBlock.includes('id: `m-api-annotation-error-${idBase}`'),
  "successful annotated image edits should remove progress and append one render message with result metadata while failures stay explicit",
);

assert(
  appSource.includes("function hasGenerationImageResult") &&
  appSource.includes("function emptyGenerationResultError") &&
  appSource.includes("画图服务没有返回图片结果") &&
  generationFlowBlock.includes("if (!hasGenerationImageResult(result, backendItems))") &&
  generationFlowBlock.includes("throw emptyGenerationResultError(result, locale);"),
  "image generation should treat ok responses without any returned image as failures instead of rendering an empty result card",
);

assert(
  appSource.includes("function formatGenerationErrorMessage") &&
  appSource.includes('lowerMessage.includes("upstream")') &&
  appSource.includes('lowerMessage.includes("没有返回图片")') &&
  appSource.includes("画图服务暂时没有成功返回图片") &&
  generationFlowBlock.includes("formatGenerationErrorMessage(error, locale, t.requestFailed)") &&
  !generationFlowBlock.includes("content: `${t.requestFailed}: ${error instanceof Error ? error.message : String(error)}`"),
  "image-generation failures should be summarized as user-friendly upstream service errors instead of raw JSON/SSE text",
);

assert(
  appSource.includes('if (activeMessage.kind === "render" && activeMessage.imageUrl)') &&
  appSource.includes("await handleCopyImage(activeMessage.imageUrl, activeMessage.imageLabel)") &&
  appSource.includes('const isStreamingAssistantMessage = isVisibleChatResponding') &&
  appSource.includes("function AssistantThinkingStatusCard") &&
  appSource.includes("normalizeChatThinkingStatus(progress, thinkingStartedAt)") &&
  appSource.includes("thinkingStatus: undefined") &&
  appSource.includes('className="assistant-streaming-indicator"') &&
  appSource.includes('className="assistant-thinking-card"') &&
  styles.includes(".assistant-streaming-indicator") &&
  styles.includes(".assistant-thinking-card") &&
  styles.includes(".assistant-thinking-tool") &&
  styles.includes("@keyframes assistant-streaming-pulse"),
  "render message copy should copy the image, and active assistant replies should show streaming plus safe thinking/tool status indicators",
);

assert(
  /\.chatgpt-drawer\.chatgpt-drawer--settings-dialog\s*\{[\s\S]*?width:\s*min\(1320px,\s*calc\(100vw - 32px\)\);[\s\S]*?height:\s*min\(900px,\s*calc\(100dvh - 32px\)\);[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*?border-radius:\s*28px;/m.test(finalStyles) &&
  /\.chatgpt-drawer\.chatgpt-drawer--settings-dialog\s*\{[\s\S]*?grid-template-columns:\s*326px minmax\(0,\s*1fr\);[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\);/m.test(finalStyles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.chatgpt-drawer__header\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*1;/m.test(finalStyles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.chatgpt-drawer__content\.settings-shell\s*\{[\s\S]*?display:\s*contents;/m.test(finalStyles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.chatgpt-drawer__nav\.settings-nav\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1 \/ -1;[\s\S]*?padding:\s*28px 20px;[\s\S]*?background:\s*#f5ecdf;/m.test(finalStyles) &&
  /\.chatgpt-drawer--settings-dialog\s+\.chatgpt-drawer__stack\.settings-content\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;[\s\S]*?gap:\s*24px;[\s\S]*?padding:\s*34px 46px 44px;[\s\S]*?overflow-y:\s*auto;/m.test(finalStyles) &&
  /@media \(max-width:\s*980px\)[\s\S]*?\.chatgpt-drawer\.chatgpt-drawer--settings-dialog\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/m.test(finalStyles),
  "settings dialog should use the wide two-column settings-center layout with a warm sidebar and responsive single-column fallback",
);
