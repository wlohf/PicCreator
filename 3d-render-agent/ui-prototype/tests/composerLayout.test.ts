// @ts-ignore Node's builtin types are not part of this lightweight test harness.
import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

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
  appSource.includes('handleRunColoredFloorPlanTool') &&
  appSource.includes('runConversationFlow(undefined, "colored_floor_plan")') &&
  appSource.includes('className="chatgpt-tool-action"'),
  "colored floor plan should be available as an explicit floor-plan tool action instead of a primary mode",
);

assert(
  appSource.includes("function isRenderMessageComparisonDisabled") &&
  appSource.includes("sourceResultId: historyItem.id") &&
  appSource.includes("sourceResultId: message.sourceResultId") &&
  appSource.includes("!messageSourceResult?.floorPlanUrl && !floorPlanPreviews[0]?.url"),
  "chat-thread compare actions should resolve the persisted source result and stay available when floor-plan metadata is already stored",
);

assert(
  appSource.includes('className="chatgpt-sidebar__footer"') &&
  appSource.includes('chatgpt-sidebar__settings-trigger') &&
  appSource.includes('aria-haspopup="menu"') &&
  appSource.includes('chatgpt-sidebar__settings-popover') &&
  appSource.includes('panel: "preferences"') &&
  appSource.includes('panel: "generation"') &&
  appSource.includes('panel: "setup"') &&
  appSource.includes('panel: "prompts"') &&
  appSource.includes('activeUtilityPanel === "prompts"') &&
  appSource.includes('openSettingsPanel(item.panel)'),
  "sidebar footer should expose a single settings trigger with separate model/api and prompt destinations",
);

assert(
  styles.includes(".chatgpt-sidebar__settings-popover") &&
  styles.includes(".chatgpt-sidebar__menu-item"),
  "settings trigger should open a vertical popup menu for focused categories",
);

assert(
  styles.includes("--chatgpt-sidebar-width") &&
  styles.includes("--chatgpt-drawer-width") &&
  styles.includes(".chatgpt-layout__resize-handle--sidebar") &&
  styles.includes(".chatgpt-layout__resize-handle--drawer") &&
  styles.includes("body.is-resizing-layout"),
  "desktop layout should support persistent draggable sidebar and drawer widths",
);
