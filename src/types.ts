// ── Sidebar Block System (v2.3) ──

export type SidebarBlockType =
  | "code-js"
  | "code-python"
  | "code-html"
  | "code-json"
  | "terminal"
  | "mcp-tool"
  | "thinking"
  | "plan-steps"
  | "exec-result"
  | "data-table"
  | "cell-change"
  | "chart-image"
  | "skill-create"
  | "memory"
  | "progress"
  | "approval"
  | "reference";

export type BlockStatus = "idle" | "running" | "success" | "error";

export interface BlockAction {
  id: string;
  label: string;
  icon?: string;
  variant?: "primary" | "danger" | "muted";
  onClick?: () => void;
}

export interface SidebarBlockData {
  id: string;
  type: SidebarBlockType;
  status: BlockStatus;
  title?: string;
  language?: string;
  content: string;
  metadata?: Record<string, unknown>;
  actions?: BlockAction[];
}

// ── Plan Step States (v2.3) ──

export type PlanStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

// ── Core Types ──

export type MessageRole = "user" | "assistant" | "system";

export type InteractionMode = "agent" | "plan" | "ask";

export type AgentStatus = "idle" | "running" | "done" | "failed" | "paused";

export interface ModeEnforcement {
  codeBridge?: boolean | string;
  codeBlockRender?: boolean | string;
  maxTurns?: number;
  autoExecute?: boolean | string;
  stripCodeBlocks?: boolean | string;
  planUI?: boolean | string;
}

export interface ModeDefinition {
  id: string;
  name: string;
  description: string;
  default?: boolean;
  enforcement: ModeEnforcement;
  quickActions?: QuickAction[];
}

export interface PlanStep {
  index: number;
  text: string;
  done: boolean;
  status?: PlanStepStatus;
  codeBlockId?: string;
  result?: string;
  error?: string;
}

export interface Provenance {
  mode?: string;
  model?: string;
  skillsLoaded?: string[];
  promptSummary?: string;
  timestamp?: number;
}

export interface ActivityEvent {
  action: string;
  name: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  codeBlocks?: CodeBlock[];
  isStreaming?: boolean;
  isError?: boolean;
  thinkingMs?: number;
  thinkingContent?: string;
  suggestAgentSwitch?: boolean;
  planSteps?: PlanStep[];
  provenance?: Provenance;
  isAutoContinue?: boolean;
  activities?: ActivityEvent[];
}

export interface CodeBlock {
  id: string;
  language: string;
  code: string;
  executed?: boolean;
  result?: string;
  error?: string;
  diff?: DiffResult | null;
}

export interface AgentDefinition {
  name: string;
  description: string;
  model: string;
  color: string;
  tools: string[];
}

export const AGENT_LABEL_MAP: Record<string, { full: string; short: string }> =
  {
    "excel-analyst": { full: "数据分析师", short: "分析师" },
    "chart-designer": { full: "可视化专家", short: "可视化" },
    "formula-expert": { full: "公式专家", short: "公式" },
    "data-cleaner": { full: "数据清洗师", short: "清洗" },
    "report-writer": { full: "报告撰写师", short: "报告" },
    "quality-checker": { full: "质量审查官", short: "审查" },
  };

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  messages: ChatMessage[];
  mode: InteractionMode;
  model: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  agentRef?: string;
  agentColor?: string;
}

export interface SelectionContext {
  address: string;
  sheetName: string;
  rowCount: number;
  colCount: number;
  /** 最多取样 20 行用于上下文 */
  sampleValues: (string | number | boolean | null)[][];
  hasMoreRows: boolean;
}

export interface UsedRangeContext {
  address: string;
  rowCount: number;
  colCount: number;
  sampleValues: (string | number | boolean | null)[][];
  hasMoreRows: boolean;
}

export interface WpsContext {
  selection: SelectionContext | null;
  usedRange?: UsedRangeContext | null;
  workbookName: string;
  sheetNames: string[];
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  cliModel: string;
  tier: "lightweight" | "mainstay" | "reasoning";
  costRatio: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "sonnet",
    label: "Sonnet 4.6",
    description: "最佳编程模型，速度与质量兼顾",
    cliModel: "sonnet",
    tier: "mainstay",
    costRatio: "1x",
  },
  {
    id: "opus",
    label: "Opus 4.6",
    description: "最强推理能力，适合复杂分析",
    cliModel: "opus",
    tier: "reasoning",
    costRatio: "5x",
  },
  {
    id: "haiku",
    label: "Haiku 4.5",
    description: "极速响应，轻量任务首选",
    cliModel: "haiku",
    tier: "lightweight",
    costRatio: "0.3x",
  },
];

export interface ModelRouteInfo {
  model: string;
  reason: string;
  isAutoRouted: boolean;
}

export interface AttachmentFile {
  name: string;
  content: string;
  size: number;
  type?: "text" | "image" | "table";
  tempPath?: string;
  previewUrl?: string;
}

export interface FixErrorRequest {
  code: string;
  error: string;
  language: string;
}

export interface QuickAction {
  icon: string;
  label: string;
  prompt: string;
}

export interface CellChange {
  cell: string;
  row: number;
  col: number;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

export interface DiffResult {
  sheetName: string;
  changeCount: number;
  changes: CellChange[];
  hasMore: boolean;
}

export interface AddToChatPayload {
  address: string;
  sheetName: string;
  rowCount: number;
  colCount: number;
  values: (string | number | boolean | null)[][];
}
