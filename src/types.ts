export type MessageRole = "user" | "assistant" | "system";

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
}

export interface CodeBlock {
  id: string;
  language: string;
  code: string;
  executed?: boolean;
  result?: string;
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
