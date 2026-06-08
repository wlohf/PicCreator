import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Aperture,
  Camera,
  ChevronDown,
  Clipboard,
  Edit3,
  Eye,
  FileText,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";

import { StatusBadge } from "./StatusBadge";
import type { ChatReasoningEffort, FilePreview, Locale, RenderHistoryItem } from "../types/domain";

export type WorkspaceModeValue = "chat" | "image";
export type ComposerModeValue = "new-generation" | "edit-selected-result";
export type SettingsPanelId = "analysis" | "preferences" | "setup" | "prompts";

export type ChatWorkspaceAction = {
  id: string;
  title: string;
  description?: string;
  icon: ReactNode;
  isActive?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export type SidebarHistoryViewItem = {
  id: string;
  title: string;
  updatedLabel: string;
  pinned: boolean;
  isActive: boolean;
  isRenaming: boolean;
  hasMenu: boolean;
  onOpen: () => void;
  onToggleMenu: (target: HTMLButtonElement) => void;
  onStartRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
};

export type SidebarHistoryViewGroup = {
  label: string;
  items: SidebarHistoryViewItem[];
};

export type PromptStarterCard = {
  icon: ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
};

export type PromptModeOption = {
  id: string;
  zh: string;
  en: string;
  description?: string;
};

export type ReasoningEffortOption = {
  value: ChatReasoningEffort;
  zh: string;
  en: string;
};

export type QuickPhraseViewItem = {
  id: string;
  text: string;
};

function localeText(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

function SidebarHistoryMenu({
  locale,
  item,
  style,
}: {
  locale: Locale;
  item: SidebarHistoryViewItem;
  style?: { top: number; left: number };
}) {
  return (
    <div className="chatgpt-sidebar__history-menu" role="menu" style={style}>
      <button type="button" role="menuitem" onClick={item.onStartRename}>
        <Edit3 size={16} />
        <span>{localeText(locale, "重命名", "Rename")}</span>
      </button>
      <button type="button" role="menuitem" onClick={item.onTogglePin}>
        <Pin size={16} />
        <span>{item.pinned ? localeText(locale, "取消置顶", "Unpin chat") : localeText(locale, "置顶聊天", "Pin chat")}</span>
      </button>
      <div className="chatgpt-sidebar__history-menu-separator" />
      <button type="button" role="menuitem" className="is-danger" onClick={item.onDelete}>
        <Trash2 size={16} />
        <span>{localeText(locale, "删除", "Delete")}</span>
      </button>
    </div>
  );
}

export function ChatSidebar({
  locale,
  appName,
  isSidebarCollapsed,
  canStartNewConversation,
  isChatHistoryOpen,
  historyTotal,
  historyGroups,
  renameDraft,
  historyMenuStyle,
  authUsername,
  currentModelLabel,
  isAccountMenuOpen,
  isSettingsActive,
  primaryActions,
  onToggleSidebar,
  onNewChat,
  onOpenChatSearch,
  onToggleChatHistory,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onToggleAccountMenu,
  onOpenSettingsPanel,
  onLogout,
  accountMenuRef,
}: {
  locale: Locale;
  appName: string;
  isSidebarCollapsed: boolean;
  canStartNewConversation: boolean;
  isChatHistoryOpen: boolean;
  historyTotal: number;
  historyGroups: SidebarHistoryViewGroup[];
  renameDraft: string;
  historyMenuStyle?: { top: number; left: number };
  authUsername?: string;
  currentModelLabel: string;
  isAccountMenuOpen: boolean;
  isSettingsActive: boolean;
  primaryActions: ChatWorkspaceAction[];
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onOpenChatSearch: () => void;
  onToggleChatHistory: () => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onToggleAccountMenu: () => void;
  onOpenSettingsPanel: (panel: SettingsPanelId) => void;
  onLogout: () => void;
  accountMenuRef?: RefObject<HTMLDivElement>;
}) {
  const accountLabel = authUsername || localeText(locale, "未登录", "Guest");
  const accountInitial = authUsername?.slice(0, 1).toUpperCase();

  return (
    <aside className="chatgpt-sidebar" aria-label={localeText(locale, "侧边栏", "Sidebar")}>
      <div className="chatgpt-sidebar__brand-row">
        <div className="chatgpt-sidebar__brand brand">
          <div className="brand-mark mark">
            <Aperture size={18} />
          </div>
          {!isSidebarCollapsed && (
            <div className="brand-copy">
              <strong className="brand-title">{appName}</strong>
              <span className="brand-sub">{localeText(locale, "聊天优先，图像辅助", "Chat first, image assisted")}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          className="chatgpt-sidebar__icon-button"
          onClick={onToggleSidebar}
          aria-label={isSidebarCollapsed ? localeText(locale, "展开侧边栏", "Expand sidebar") : localeText(locale, "收起侧边栏", "Collapse sidebar")}
          title={isSidebarCollapsed ? localeText(locale, "展开侧边栏", "Expand sidebar") : localeText(locale, "收起侧边栏", "Collapse sidebar")}
        >
          {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <button
        type="button"
        className={`chatgpt-sidebar__new-chat primary-action ${isSidebarCollapsed ? "is-collapsed" : ""} ${canStartNewConversation ? "" : "is-empty-session"}`}
        onClick={onNewChat}
        title={
          canStartNewConversation
            ? localeText(locale, "新建对话", "Start a new chat")
            : localeText(locale, "当前已经是空白新对话；点击可清空草稿并聚焦输入框", "Current chat is already blank; click to clear draft state and focus the composer")
        }
      >
        <Plus size={15} />
        {!isSidebarCollapsed && <span>{localeText(locale, "新建对话", "New chat")}</span>}
      </button>

      <div className="chatgpt-sidebar__section chatgpt-sidebar__nav">
        {!isSidebarCollapsed && <p className="chatgpt-sidebar__label section-label">{localeText(locale, "主导航", "Primary nav")}</p>}
        {primaryActions.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${item.isActive ? "is-active active" : ""} ${isSidebarCollapsed ? "is-icon-only" : ""}`}
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.title}
          >
            <span className="chatgpt-sidebar__tool-icon">{item.icon}</span>
            {!isSidebarCollapsed && (
              <span className="chatgpt-sidebar__tool-copy nav-copy">
                <strong>{item.title}</strong>
                {item.description && <small>{item.description}</small>}
              </span>
            )}
          </button>
        ))}
      </div>

      {!isSidebarCollapsed && (
        <div className={`chatgpt-sidebar__section chatgpt-sidebar__history ${isChatHistoryOpen ? "is-open" : "is-collapsed"}`}>
          <div className="history-head">
            <div className="chatgpt-sidebar__history-heading">
              <p className="chatgpt-sidebar__history-heading-label section-label">{localeText(locale, "历史聊天", "Chat history")}</p>
              <small>{historyTotal}</small>
            </div>
            <div className="history-actions">
              <button
                type="button"
                className="chatgpt-sidebar__history-action icon-btn"
                onClick={onOpenChatSearch}
                aria-label={localeText(locale, "搜索聊天", "Search chats")}
                title={localeText(locale, "搜索聊天", "Search chats")}
              >
                <Search size={14} />
              </button>
              <button
                type="button"
                className={`chatgpt-sidebar__history-action icon-btn ${isChatHistoryOpen ? "is-open" : ""}`}
                aria-expanded={isChatHistoryOpen}
                onClick={onToggleChatHistory}
                aria-label={isChatHistoryOpen ? localeText(locale, "收起历史聊天", "Collapse chat history") : localeText(locale, "展开历史聊天", "Expand chat history")}
                title={isChatHistoryOpen ? localeText(locale, "收起历史聊天", "Collapse chat history") : localeText(locale, "展开历史聊天", "Expand chat history")}
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>

          {isChatHistoryOpen && (
            historyGroups.length === 0 ? (
              <div className="chatgpt-sidebar__empty">{localeText(locale, "还没有历史聊天", "No chat history yet")}</div>
            ) : (
              <div className="history-scroll">
                {historyGroups.map((group) => (
                  <div className="chatgpt-sidebar__history-group" key={group.label}>
                    <p className="chatgpt-sidebar__history-group-label section-label">{group.label}</p>
                    {group.items.map((item) => (
                      <div
                        className={`chatgpt-sidebar__history-item ${item.isActive ? "is-active" : ""} ${item.hasMenu ? "has-menu" : ""}`}
                        key={item.id}
                      >
                        {item.isRenaming ? (
                          <form
                            className="chatgpt-sidebar__history-rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              onCommitRename(item.id);
                            }}
                          >
                            <input
                              value={renameDraft}
                              onChange={(event) => onRenameDraftChange(event.target.value)}
                              onBlur={() => onCommitRename(item.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  onCancelRename();
                                }
                              }}
                              aria-label={localeText(locale, "重命名聊天", "Rename chat")}
                              autoFocus
                            />
                          </form>
                        ) : (
                          <button type="button" className="chatgpt-sidebar__history-open" onClick={item.onOpen}>
                            <span className="chatgpt-sidebar__history-main history-main">
                              <span className="chatgpt-sidebar__history-title history-title">
                                {item.pinned && <Pin size={12} aria-hidden="true" />}
                                {item.title}
                              </span>
                              <small className="history-time">{item.updatedLabel}</small>
                            </span>
                          </button>
                        )}
                        {!item.isRenaming && (
                          <button
                            type="button"
                            className="chatgpt-sidebar__history-more more"
                            onClick={(event) => item.onToggleMenu(event.currentTarget)}
                            aria-expanded={item.hasMenu}
                            aria-label={localeText(locale, "聊天操作", "Chat actions")}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        )}
                        {item.hasMenu && typeof document !== "undefined" && createPortal(
                          <SidebarHistoryMenu locale={locale} item={item} style={historyMenuStyle} />,
                          document.body
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      <div className="chatgpt-sidebar__footer user-card" ref={accountMenuRef}>
        <button
          type="button"
          className={`chatgpt-sidebar__account-button ${isAccountMenuOpen ? "is-open" : ""} ${isSidebarCollapsed ? "is-collapsed" : ""}`}
          onClick={onToggleAccountMenu}
          aria-expanded={isAccountMenuOpen}
          title={authUsername ? undefined : localeText(locale, "登录", "Sign in")}
        >
          <span className="chatgpt-sidebar__account-avatar">
            {accountInitial || <User size={15} />}
          </span>
          {!isSidebarCollapsed && (
            <span className="chatgpt-sidebar__account-copy">
              <strong>{accountLabel}</strong>
              <small className="quota">{authUsername ? localeText(locale, "Plus · 今日额度充足", "Plus · quota healthy") : localeText(locale, "登录后同步设置", "Sign in to sync")}</small>
            </span>
          )}
        </button>
        <button
          type="button"
          className={`chatgpt-sidebar__footer-settings icon-btn ${isSettingsActive ? "is-active active" : ""} ${isSidebarCollapsed ? "is-collapsed" : ""}`}
          onClick={() => onOpenSettingsPanel("setup")}
          aria-label={localeText(locale, "打开设置", "Open settings")}
          title={localeText(locale, "打开设置", "Open settings")}
        >
          <Settings size={18} />
        </button>
        {isAccountMenuOpen && authUsername && (
          <div className={`chatgpt-sidebar__account-menu ${isSidebarCollapsed ? "is-collapsed" : ""}`} role="menu" aria-label={localeText(locale, "账户菜单", "Account menu")}>
            <button type="button" className="chatgpt-sidebar__account-summary" role="menuitem">
              <span className="chatgpt-sidebar__account-avatar">{accountInitial}</span>
              <span className="chatgpt-sidebar__account-copy">
                <strong>{authUsername}</strong>
                <small>{currentModelLabel}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            <div className="chatgpt-sidebar__account-menu-separator" />
            <button type="button" role="menuitem" onClick={() => onOpenSettingsPanel("preferences")}>
              <User size={16} />
              <span>{localeText(locale, "个性化", "Personalization")}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => onOpenSettingsPanel("setup")}>
              <Settings size={16} />
              <span>{localeText(locale, "设置", "Settings")}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => onOpenSettingsPanel("analysis")}>
              <Sparkles size={16} />
              <span>{localeText(locale, "高级功能", "Advanced")}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => onOpenSettingsPanel("prompts")}>
              <FileText size={16} />
              <span>{localeText(locale, "提示词设置", "Prompt settings")}</span>
            </button>
            <div className="chatgpt-sidebar__account-menu-separator" />
            <button type="button" className="is-danger" role="menuitem" onClick={onLogout}>
              <Trash2 size={16} />
              <span>{localeText(locale, "退出登录", "Log out")}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export function WorkspaceTopbar({
  locale,
  workspaceMode,
  isConversationBusy,
  currentModelLabel,
  currentSubLabel,
  projectState,
  projectStateTone,
  headerActions,
  composerMode,
  isQuickPhraseCardOpen,
  quickPhrases,
  quickPhraseLimit,
  activeUtilityPanel,
  activeResult,
  canCompareActiveResult,
  onOpenModelSettings,
  onSwitchWorkspaceMode,
  onNewGenerationMode,
  onToggleShortcutDrawer,
  onToggleQuickPhraseCard,
  onInsertQuickPhrase,
  onOpenResult,
  onOpenComparison,
}: {
  locale: Locale;
  workspaceMode: WorkspaceModeValue;
  isConversationBusy: boolean;
  currentModelLabel: string;
  currentSubLabel: string;
  projectState: string;
  projectStateTone: "good" | "warn";
  headerActions: ChatWorkspaceAction[];
  composerMode: ComposerModeValue;
  isQuickPhraseCardOpen: boolean;
  quickPhrases: QuickPhraseViewItem[];
  quickPhraseLimit: number;
  activeUtilityPanel: string | null;
  activeResult: RenderHistoryItem | null;
  canCompareActiveResult: boolean;
  onOpenModelSettings: () => void;
  onSwitchWorkspaceMode: (mode: WorkspaceModeValue) => void;
  onNewGenerationMode: () => void;
  onToggleShortcutDrawer: () => void;
  onToggleQuickPhraseCard: () => void;
  onInsertQuickPhrase: (text: string) => void;
  onOpenResult: (result: RenderHistoryItem | null) => void;
  onOpenComparison: () => void;
}) {
  const isImageWorkspace = workspaceMode === "image";
  const canUseImageResultActions = Boolean(activeResult?.imageUrl);
  const canUseQuickPhrases = composerMode === "new-generation" && quickPhrases.length > 0;

  return (
    <header className={`chatgpt-main__header topbar chatgpt-main__header--${workspaceMode}`}>
      <button
        type="button"
        className="chatgpt-main__model-pill model-trigger"
        onClick={onOpenModelSettings}
        title={localeText(locale, "查看当前模型设置", "View current model setup")}
      >
        <Aperture size={15} />
        <span className="chatgpt-main__model-pill-copy">
          <strong className="model-name" title={currentModelLabel}>{currentModelLabel}</strong>
          <small className="model-sub">{currentSubLabel}</small>
        </span>
        <StatusBadge tone={projectStateTone}>{projectState}</StatusBadge>
      </button>

      <div className="workspace-mode-toggle mode-tabs" aria-label={localeText(locale, "工作区模式", "Workspace mode")}>
        <button
          type="button"
          className={`mode-tab ${workspaceMode === "chat" ? "is-active active" : ""}`}
          aria-pressed={workspaceMode === "chat"}
          onClick={() => onSwitchWorkspaceMode("chat")}
          disabled={isConversationBusy}
        >
          <MessageCircle size={14} />
          {localeText(locale, "聊天", "Chat")}
        </button>
        <button
          type="button"
          className={`mode-tab ${workspaceMode === "image" ? "is-active active" : ""}`}
          aria-pressed={workspaceMode === "image"}
          onClick={() => onSwitchWorkspaceMode("image")}
          disabled={isConversationBusy}
        >
          <Camera size={14} />
          {localeText(locale, "图像", "Image")}
        </button>
      </div>

      <div className={`chatgpt-main__actions top-actions chatgpt-main__actions--${workspaceMode}`}>
        <div className="chatgpt-main__action-group chatgpt-main__action-group--primary">
          {headerActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`icon-btn tool-btn ${action.isActive ? "is-active active selected" : ""}`}
              onClick={action.onClick}
              aria-pressed={action.isActive}
              title={action.title}
            >
              {action.icon}
              <span className="chatgpt-main__action-label">{action.title}</span>
            </button>
          ))}
        </div>

        <div className="chatgpt-main__action-group">
          {isImageWorkspace && composerMode === "edit-selected-result" && (
            <button
              type="button"
              className="tool-btn"
              onClick={onNewGenerationMode}
              aria-label={localeText(locale, "回到新生成", "Back to new generation")}
              title={localeText(locale, "回到新生成", "Back to new generation")}
            >
              <RotateCcw size={14} />
              <span className="chatgpt-main__action-label">{localeText(locale, "回到新生成", "Back to new")}</span>
            </button>
          )}
          <div className="quick-phrase-popover">
            <div className="quick-phrase-popover__actions">
                <button
                  type="button"
                  className={`tool-btn ${activeUtilityPanel === "shortcuts" ? "is-active selected" : ""}`}
                  onClick={onToggleShortcutDrawer}
                  disabled={!isImageWorkspace}
                  aria-label={localeText(locale, "管理快捷短语", "Manage shortcut phrases")}
                  title={localeText(locale, "自定义、编辑或删除快捷短语", "Customize, edit, or delete shortcut phrases")}
                >
                  <Edit3 size={14} />
                  <span className="chatgpt-main__action-label">{localeText(locale, "管理短语", "Manage phrases")}</span>
                </button>
                <button
                  type="button"
                  className={`tool-btn ${isQuickPhraseCardOpen ? "is-active selected" : ""}`}
                  onClick={onToggleQuickPhraseCard}
                  disabled={!isImageWorkspace || !canUseQuickPhrases}
                  aria-expanded={isQuickPhraseCardOpen}
                  aria-label={localeText(locale, "展开快捷短语", "Open quick phrases")}
                  title={localeText(locale, "展开快捷短语", "Open quick phrases")}
                >
                  <Clipboard size={14} />
                  <span className="chatgpt-main__action-label">{localeText(locale, "快捷短语", "Quick phrases")}</span>
                </button>
            </div>
            {isImageWorkspace && isQuickPhraseCardOpen && canUseQuickPhrases && (
              <div className="quick-phrase-card" role="dialog" aria-label={localeText(locale, "快捷短语", "Quick phrases")}>
                <div className="quick-phrase-card__list">
                  {quickPhrases.slice(0, quickPhraseLimit).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => onInsertQuickPhrase(item.text)}
                      title={localeText(locale, "插入快捷短语", "Insert shortcut phrase")}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="chatgpt-main__action-group chatgpt-main__action-group--result">
          <button
            type="button"
            className="tool-btn"
            onClick={() => onOpenResult(activeResult)}
            disabled={!canUseImageResultActions}
            aria-label={localeText(locale, "预览当前结果", "Preview current result")}
            title={localeText(locale, "预览当前结果", "Preview current result")}
          >
            <Eye size={14} />
            <span className="chatgpt-main__action-label">{localeText(locale, "预览", "Preview")}</span>
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={onOpenComparison}
            disabled={!canCompareActiveResult}
            aria-label={localeText(locale, "对比当前结果", "Compare current result")}
            title={localeText(locale, "对比当前结果", "Compare current result")}
          >
            <FileText size={14} />
            <span className="chatgpt-main__action-label">{localeText(locale, "对比", "Compare")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function EmptyConversationState({
  locale,
  cards,
}: {
  locale: Locale;
  cards: PromptStarterCard[];
}) {
  return (
    <section className="chatgpt-empty empty-state" aria-label={localeText(locale, "新对话起始页", "New conversation start")}>
      <div className="chatgpt-empty__copy">
        <p className="chatgpt-empty__kicker hero-kicker">ATTUNO WORKSPACE</p>
        <h1>{localeText(locale, "我们先把想法变成可执行的下一步。", "Turn the idea into an executable next step.")}</h1>
        <p>
          {localeText(
            locale,
            "你可以直接提问、上传资料、生成图片，或让 Attuno 帮你把零散需求整理成清晰方案。",
            "Ask directly, upload material, generate an image, or let Attuno organize loose requirements into a clear plan."
          )}
        </p>
      </div>
      <div className="chatgpt-empty__starters prompt-grid" aria-label={localeText(locale, "提示词起点", "Prompt starters")}>
        {cards.map((card) => (
          <button type="button" className="prompt-card" key={card.title} onClick={card.onSelect}>
            <span className="chatgpt-empty__starter-icon">{card.icon}</span>
            <span className="chatgpt-empty__starter-copy">
              <strong className="prompt-title">{card.title}</strong>
              <small className="prompt-desc">{card.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ChatComposer({
  locale,
  isEmptyConversation,
  isChatWorkspace,
  isImageWorkspace,
  isImageModeActive,
  composerMode,
  chatInput,
  visibleComposerPlaceholder,
  selectedEditSourceLabel,
  floorPlanPreviews,
  floorPlanExtraCount,
  composerProviderLabel,
  showProviderBadge,
  composerModelValue,
  composerModelOptions,
  chatReasoningEffort,
  chatReasoningEffortOptions,
  isVisibleConversationBusy,
  isVisibleChatResponding,
  composerIsStopping,
  composerStopTitle,
  composerSubmitTitle,
  canSubmitComposer,
  promptModeOptions,
  visibleSelectedPromptModeId,
  isRendering,
  canRunColoredFloorPlan,
  coloredFloorPlanTitle,
  fileInputRef,
  composerRef,
  onSubmit,
  onFileChange,
  onRemoveFloorPlan,
  onComposerInputChange,
  onComposerKeyDown,
  onComposerPaste,
  onAttach,
  onSwitchImageMode,
  onToggleReasoning,
  onComposerModelChange,
  onReasoningEffortChange,
  onStop,
  onSelectPromptMode,
  onNewGenerationMode,
  onRunColoredFloorPlan,
}: {
  locale: Locale;
  isEmptyConversation: boolean;
  isChatWorkspace: boolean;
  isImageWorkspace: boolean;
  isImageModeActive: boolean;
  composerMode: ComposerModeValue;
  chatInput: string;
  visibleComposerPlaceholder: string;
  selectedEditSourceLabel: string;
  floorPlanPreviews: FilePreview[];
  floorPlanExtraCount: number;
  composerProviderLabel: string;
  showProviderBadge: boolean;
  composerModelValue: string;
  composerModelOptions: string[];
  chatReasoningEffort: ChatReasoningEffort;
  chatReasoningEffortOptions: ReasoningEffortOption[];
  isVisibleConversationBusy: boolean;
  isVisibleChatResponding: boolean;
  composerIsStopping: boolean;
  composerStopTitle: string;
  composerSubmitTitle: string;
  canSubmitComposer: boolean;
  promptModeOptions: PromptModeOption[];
  visibleSelectedPromptModeId: string;
  isRendering: boolean;
  canRunColoredFloorPlan: boolean;
  coloredFloorPlanTitle: string;
  fileInputRef: RefObject<HTMLInputElement>;
  composerRef: RefObject<HTMLTextAreaElement>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFloorPlan: (index: number) => void;
  onComposerInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onAttach: () => void;
  onSwitchImageMode: () => void;
  onToggleReasoning: () => void;
  onComposerModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ChatReasoningEffort) => void;
  onStop: () => void;
  onSelectPromptMode: (id: string) => void;
  onNewGenerationMode: () => void;
  onRunColoredFloorPlan: () => void;
}) {
  return (
    <form className={`chatgpt-composer composer ${isEmptyConversation ? "chatgpt-composer--empty-conversation" : ""}`} onSubmit={onSubmit}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={onFileChange}
      />
      <div className={`chatgpt-composer__bar ${isChatWorkspace ? "chatgpt-composer__bar--chat" : ""} ${(selectedEditSourceLabel || floorPlanPreviews.length > 0) ? "chatgpt-composer__bar--has-attachments" : ""}`}>
        {(selectedEditSourceLabel || floorPlanPreviews.length > 0) && (
          <div className="chatgpt-composer__attachments-inner" aria-label={localeText(locale, "已添加的图片", "Attached images")}>
            {selectedEditSourceLabel && <span className="chatgpt-chip chatgpt-chip--accent">{selectedEditSourceLabel}</span>}
            {floorPlanPreviews.slice(0, 4).map((file, index) => (
              <div className="chatgpt-composer__attachment-card" key={file.url}>
                <div className="chatgpt-composer__attachment-card-header">
                  <img src={file.url} alt={file.name} className="chatgpt-composer__attachment-card-thumb" />
                  <span className="chatgpt-composer__attachment-card-name">{file.name}</span>
                  <button
                    type="button"
                    className="chatgpt-composer__attachment-card-close"
                    onClick={() => onRemoveFloorPlan(index)}
                    title={localeText(locale, "移除", "Remove")}
                  >
                    <X size={14} />
                  </button>
                </div>
                <img src={file.url} alt={file.name} className="chatgpt-composer__attachment-card-preview" />
              </div>
            ))}
            {floorPlanExtraCount > 0 && <span className="chatgpt-chip">+{floorPlanExtraCount}</span>}
          </div>
        )}

        <textarea
          ref={composerRef}
          name="composer_text"
          className={chatInput.trim().length > 900 ? "is-long-draft" : ""}
          value={chatInput}
          onChange={onComposerInputChange}
          onKeyDown={onComposerKeyDown}
          onPaste={onComposerPaste}
          placeholder={visibleComposerPlaceholder}
          rows={1}
          aria-label={visibleComposerPlaceholder}
        />

        <div className="chatgpt-composer__inline-actions composer-toolbar">
          <div className="chatgpt-composer__tool-group tool-group">
            <button type="button" className="chatgpt-composer__plus-btn tool-btn" onClick={onAttach} title={localeText(locale, "上传文件", "Upload file")}>
              <Plus size={18} />
              <span>{localeText(locale, "附件", "Attach")}</span>
            </button>
            <button
              type="button"
              className={`chatgpt-composer__image-btn tool-btn ${isImageModeActive ? "is-active selected" : ""}`}
              onClick={onSwitchImageMode}
              disabled={isVisibleConversationBusy && !isImageModeActive}
              title={localeText(locale, "切换到图像模式", "Switch to image mode")}
            >
              <ImagePlus size={18} />
              <span>{localeText(locale, "图片", "Image")}</span>
            </button>
            {isChatWorkspace && (
              <button
                type="button"
                className={`chatgpt-composer__thinking-btn chip-btn ${chatReasoningEffort === "high" ? "is-active selected" : ""}`}
                onClick={onToggleReasoning}
                disabled={isVisibleChatResponding}
                title={localeText(locale, "切换回复深度", "Switch response depth")}
              >
                <Sparkles size={18} />
                <span>{localeText(locale, "深度思考", "Deep thinking")}</span>
              </button>
            )}
          </div>

          <div className="chatgpt-composer__tool-group chatgpt-composer__tool-group--end tool-group">
            {showProviderBadge && (
              <span className="chatgpt-composer__provider-badge" title={composerProviderLabel}>
                <Aperture size={14} aria-hidden="true" />
                <span>{composerProviderLabel}</span>
              </span>
            )}
            <select
              className="chatgpt-composer__model-select chip-btn"
              value={composerModelValue}
              onChange={(event) => onComposerModelChange(event.target.value)}
              disabled={isVisibleConversationBusy}
              aria-label={isChatWorkspace ? localeText(locale, "聊天模型", "Chat model") : localeText(locale, "图像模型", "Image model")}
              title={isChatWorkspace ? localeText(locale, "切换聊天模型", "Switch chat model") : localeText(locale, "切换图像模型", "Switch image model")}
            >
              {!composerModelValue && <option value="">{localeText(locale, "选择模型", "Select model")}</option>}
              {composerModelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            {isChatWorkspace && (
              <select
                className="chatgpt-composer__effort-select"
                value={chatReasoningEffort}
                onChange={(event) => onReasoningEffortChange(event.target.value as ChatReasoningEffort)}
                disabled={isVisibleChatResponding}
                aria-label={localeText(locale, "思考强度", "Reasoning effort")}
                title={localeText(locale, "切换回复深度", "Switch response depth")}
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
              className="chatgpt-composer__send send-btn"
              disabled={composerIsStopping ? false : !canSubmitComposer}
              aria-busy={isVisibleConversationBusy}
              onClick={composerIsStopping ? onStop : undefined}
              title={composerIsStopping ? composerStopTitle : composerSubmitTitle}
            >
              {composerIsStopping ? <Square size={16} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {isImageWorkspace && (
        <div className="chatgpt-composer__meta">
          <div className="chatgpt-composer__mode-row">
            {composerMode === "new-generation" ? promptModeOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={visibleSelectedPromptModeId === option.id ? "is-active" : ""}
                aria-pressed={visibleSelectedPromptModeId === option.id}
                onClick={() => onSelectPromptMode(option.id)}
                disabled={isRendering}
                title={option.description || (locale === "zh" ? option.zh : option.en)}
              >
                {locale === "zh" ? option.zh : option.en}
              </button>
            )) : (
              <button type="button" className="is-active" onClick={onNewGenerationMode}>
                {localeText(locale, "切回新生成", "Back to new")}
              </button>
            )}
          </div>
          {composerMode === "new-generation" && canRunColoredFloorPlan && (
            <div className="chatgpt-composer__utility-row">
              <button type="button" className="chatgpt-tool-action" onClick={onRunColoredFloorPlan} disabled={isVisibleConversationBusy} title={coloredFloorPlanTitle}>
                <Aperture size={14} />
                {localeText(locale, "彩色平面图", "Colored plan")}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
