import type { SidebarBlockType } from "../types";

const LANG_MAP: Record<string, SidebarBlockType> = {
  javascript: "code-js",
  js: "code-js",
  jsx: "code-js",
  typescript: "code-js",
  ts: "code-js",
  python: "code-python",
  py: "code-python",
  html: "code-html",
  htm: "code-html",
  bash: "terminal",
  shell: "terminal",
  sh: "terminal",
  zsh: "terminal",
  json: "code-json",
};

const MARKER_MAP: Record<string, SidebarBlockType> = {
  thinking: "thinking",
  memory: "memory",
  progress: "progress",
  approval: "approval",
  reference: "reference",
  "mcp-call": "mcp-tool",
  "tool-call": "mcp-tool",
  plan: "plan-steps",
  "skill-create": "skill-create",
};

/**
 * Determine SidebarBlockType from a code-fence language tag.
 * Falls back to "code-js" for unrecognized languages (WPS default).
 */
export function blockTypeFromLanguage(language: string): SidebarBlockType {
  const key = language.toLowerCase().trim();
  return LANG_MAP[key] ?? MARKER_MAP[key] ?? "code-js";
}

/**
 * Check if a language tag maps to a special (non-code) block type.
 */
export function isSpecialBlock(language: string): boolean {
  const key = language.toLowerCase().trim();
  return key in MARKER_MAP;
}

/**
 * Parse inline markers like `[thinking]`, `[memory]` in streaming content.
 * Returns the block type if found, null otherwise.
 */
export function parseInlineMarker(text: string): SidebarBlockType | null {
  const match = /^\[(\w[\w-]*)\]/.exec(text.trim());
  if (!match) return null;
  return MARKER_MAP[match[1].toLowerCase()] ?? null;
}

/**
 * Determine if a code block represents a "code execution" type
 * (vs informational/system blocks).
 */
export function isExecutableBlock(type: SidebarBlockType): boolean {
  return (
    type === "code-js" ||
    type === "code-python" ||
    type === "code-html" ||
    type === "terminal"
  );
}

/**
 * Check if a JSON code block is a local action ({"_action": ...}).
 * Only action JSON blocks should be auto-executed.
 */
export function isJsonAction(code: string): boolean {
  return code.trim().startsWith('{"_action"');
}

/**
 * Get a display label for a SidebarBlockType.
 */
export function blockTypeLabel(type: SidebarBlockType): string {
  const labels: Record<SidebarBlockType, string> = {
    "code-js": "JavaScript",
    "code-json": "JSON",
    "code-python": "Python",
    "code-html": "HTML",
    terminal: "Terminal",
    "mcp-tool": "Tool Call",
    thinking: "Thinking",
    "plan-steps": "Plan",
    "exec-result": "执行结果",
    "data-table": "数据预览",
    "cell-change": "表格变更",
    "chart-image": "图表",
    "skill-create": "技能",
    memory: "记忆",
    progress: "进度",
    approval: "确认",
    reference: "引用",
  };
  return labels[type];
}
