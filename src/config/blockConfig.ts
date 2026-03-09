import type { SidebarBlockType } from "../types";

export interface BlockConfig {
  /** CSS variable name for left stripe color */
  stripeVar: string;
  /** CSS variable name for background */
  bgVar: string;
  /** CSS variable name for header title color */
  titleColorVar: string;
  /** Default header icon (text/emoji) */
  icon: string;
  /** Default title */
  defaultTitle: string;
  /** Available action button ids */
  actions: string[];
  /** Visual priority: "prominent" | "standard" | "ambient" */
  prominence: "prominent" | "standard" | "ambient";
}

/**
 * Maps each SidebarBlockType to design-system tokens.
 *
 * Color rules (from design system 28_Design_System_Final):
 *   --accent (#D97757)      = executable / CTA
 *   --ui-accent (#7B8EC8)   = info / data display
 *   --success (#8BA88B)     = success
 *   --error (#C87B7B)       = error / danger
 *   Plan signal (#e5b45a)   = plan mode
 *   --border-primary (#333) = ambient / passive
 *
 * Backgrounds: --bg-surface (#212121) or --thinking-bg (#141414)
 */
export const BLOCK_CONFIGS: Record<SidebarBlockType, BlockConfig> = {
  "code-js": {
    stripeVar: "--accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "JS",
    defaultTitle: "JavaScript · WPS ET",
    actions: ["execute", "copy", "expand"],
    prominence: "prominent",
  },
  "code-python": {
    stripeVar: "--accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "PY",
    defaultTitle: "Python · 数据分析",
    actions: ["execute", "copy"],
    prominence: "prominent",
  },
  "code-html": {
    stripeVar: "--accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "</>",
    defaultTitle: "HTML · 可视化",
    actions: ["preview", "insertTable", "copy"],
    prominence: "prominent",
  },
  "code-json": {
    stripeVar: "--ui-accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-muted",
    icon: "{}",
    defaultTitle: "JSON",
    actions: ["copy"],
    prominence: "standard",
  },
  terminal: {
    stripeVar: "--text-placeholder",
    bgVar: "--thinking-bg",
    titleColorVar: "--text-muted",
    icon: "$",
    defaultTitle: "Terminal",
    actions: ["execute", "copy"],
    prominence: "standard",
  },
  "mcp-tool": {
    stripeVar: "--border-primary",
    bgVar: "--bg-surface",
    titleColorVar: "--text-muted",
    icon: "⚙",
    defaultTitle: "MCP Tool",
    actions: ["expandParams"],
    prominence: "standard",
  },
  thinking: {
    stripeVar: "--border-primary",
    bgVar: "--bg-base",
    titleColorVar: "--text-muted",
    icon: "",
    defaultTitle: "Thinking...",
    actions: [],
    prominence: "ambient",
  },
  "plan-steps": {
    stripeVar: "--border-primary",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "",
    defaultTitle: "Plan",
    actions: ["executeStep", "executeAll", "skip"],
    prominence: "prominent",
  },
  "exec-result": {
    stripeVar: "--success",
    bgVar: "--bg-surface",
    titleColorVar: "--success",
    icon: "✓",
    defaultTitle: "执行成功",
    actions: ["retry"],
    prominence: "standard",
  },
  "data-table": {
    stripeVar: "--ui-accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "📊",
    defaultTitle: "数据预览",
    actions: ["insertTable", "exportCSV"],
    prominence: "standard",
  },
  "cell-change": {
    stripeVar: "--accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "📄",
    defaultTitle: "表格变更",
    actions: ["undo", "locate"],
    prominence: "standard",
  },
  "chart-image": {
    stripeVar: "--ui-accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "📈",
    defaultTitle: "图表输出",
    actions: ["insertTable", "download", "zoom"],
    prominence: "standard",
  },
  "skill-create": {
    stripeVar: "--accent",
    bgVar: "--bg-surface",
    titleColorVar: "--accent",
    icon: "✦",
    defaultTitle: "新建技能",
    actions: ["confirm", "edit", "cancel"],
    prominence: "prominent",
  },
  memory: {
    stripeVar: "--border-primary",
    bgVar: "--thinking-bg",
    titleColorVar: "--text-muted",
    icon: "💡",
    defaultTitle: "记忆",
    actions: [],
    prominence: "ambient",
  },
  progress: {
    stripeVar: "--accent",
    bgVar: "--bg-surface",
    titleColorVar: "--text-secondary",
    icon: "⏳",
    defaultTitle: "处理中",
    actions: ["cancel"],
    prominence: "standard",
  },
  approval: {
    stripeVar: "--error",
    bgVar: "--bg-surface",
    titleColorVar: "--error",
    icon: "⚠",
    defaultTitle: "需要确认",
    actions: ["confirm", "cancel"],
    prominence: "prominent",
  },
  reference: {
    stripeVar: "--border-primary",
    bgVar: "--thinking-bg",
    titleColorVar: "--text-muted",
    icon: "📌",
    defaultTitle: "引用上下文",
    actions: ["expand"],
    prominence: "ambient",
  },
};

const FALLBACK_CONFIG: BlockConfig = {
  stripeVar: "--border-primary",
  bgVar: "--bg-surface",
  titleColorVar: "--text-muted",
  icon: "?",
  defaultTitle: "Unknown",
  actions: ["copy"],
  prominence: "standard",
};

export function getBlockConfig(type: SidebarBlockType): BlockConfig {
  return BLOCK_CONFIGS[type] ?? FALLBACK_CONFIG;
}

/** Resolve a CSS variable name to use in inline styles via var() */
export function stripeColor(type: SidebarBlockType): string {
  return `var(${getBlockConfig(type).stripeVar})`;
}

export function bgColor(type: SidebarBlockType): string {
  return `var(${getBlockConfig(type).bgVar})`;
}

export function titleColor(type: SidebarBlockType): string {
  return `var(${getBlockConfig(type).titleColorVar})`;
}
