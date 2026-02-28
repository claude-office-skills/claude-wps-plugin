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
}

export interface Provenance {
  mode?: string;
  model?: string;
  skillsLoaded?: string[];
  promptSummary?: string;
  timestamp?: number;
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
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "sonnet",
    label: "Sonnet 4.6",
    description: "最佳编程模型，速度与质量兼顾",
    cliModel: "claude-sonnet-4-6",
  },
  {
    id: "opus",
    label: "Opus 4.6",
    description: "最强推理能力，适合复杂分析",
    cliModel: "claude-opus-4-6",
  },
  {
    id: "haiku",
    label: "Haiku 4.5",
    description: "极速响应，轻量任务首选",
    cliModel: "claude-haiku-4-5",
  },
];

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
