/**
 * Claude API 调用层
 *
 * 通过本地代理服务器（proxy-server.js）调用 claude CLI，
 * 绕过 OAuth token 无法直接调用 Anthropic 公开 API 的限制。
 */
import type { WpsContext, ChatMessage, AttachmentFile } from "../types";

const PROXY_BASE = "http://127.0.0.1:3001";

/** 构建 Excel 上下文字符串 */
function buildContextString(wpsCtx: WpsContext): string {
  const { selection, workbookName, sheetNames, usedRange } = wpsCtx;
  const activeSheet = selection?.sheetName || "";

  let ctx = `工作簿: ${workbookName}\n`;
  ctx += `所有工作表: ${sheetNames.join(", ")}\n`;
  if (activeSheet) {
    ctx += `\n⚠️ 当前活动工作表: 「${activeSheet}」— 请务必基于此表进行操作，忽略历史对话中提到的其他工作表。\n`;
  }

  if (usedRange) {
    ctx += `\n[当前表已用范围] ${usedRange.address}，${usedRange.rowCount} 行 × ${usedRange.colCount} 列\n`;
    if (usedRange.sampleValues && usedRange.sampleValues.length > 0) {
      usedRange.sampleValues.forEach((row, i) => {
        ctx += `  ${i + 1}: ${row.map((v) => JSON.stringify(v)).join(" | ")}\n`;
      });
      if (usedRange.hasMoreRows)
        ctx += `  ... (共 ${usedRange.rowCount} 行，仅展示前 50 行)\n`;
    }
  }

  if (selection) {
    const {
      address,
      sheetName,
      rowCount,
      colCount,
      sampleValues,
      hasMoreRows,
    } = selection;
    ctx += `\n[当前选区] ${sheetName}!${address}，${rowCount} 行 × ${colCount} 列\n`;
    ctx += `⚠️ 用户选定的操作范围是「${sheetName}」表的 ${address}。生成的代码必须操作此表此范围，不要操作其他工作表。\n`;
    if (sampleValues.length > 0) {
      sampleValues.forEach((row, i) => {
        ctx += `  ${i + 1}: ${row.map((v) => JSON.stringify(v)).join(" | ")}\n`;
      });
      if (hasMoreRows) ctx += `  ... (共 ${rowCount} 行，仅展示前 50 行)\n`;
    }
  } else {
    ctx += "\n当前无选区\n";
  }
  return ctx;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onThinking?: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (err: Error) => void;
}

/** 检查代理服务器是否在运行 */
export async function checkProxy(): Promise<boolean> {
  try {
    const resp = await fetch(`${PROXY_BASE}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export interface SendMessageOptions {
  model?: string;
  attachments?: AttachmentFile[];
  signal?: AbortSignal;
  webSearch?: boolean;
}

/** 流式发送消息给 Claude（通过本地代理） */
export async function sendMessage(
  userMessage: string,
  history: ChatMessage[],
  wpsCtx: WpsContext,
  callbacks: StreamCallbacks,
  options?: SendMessageOptions,
): Promise<void> {
  const messages = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user" as const, content: userMessage },
  ];

  const context = buildContextString(wpsCtx);
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "fc5e63",
    },
    body: JSON.stringify({
      sessionId: "fc5e63",
      location: "claudeClient.ts:sendMessage",
      message: "Built context string",
      data: {
        contextPreview: context.substring(0, 600),
        selSheet: wpsCtx.selection?.sheetName,
        selAddr: wpsCtx.selection?.address,
        selSampleCount: wpsCtx.selection?.sampleValues?.length || 0,
        usedRangeAddr: wpsCtx.usedRange?.address,
        historyLen: history.length,
      },
      timestamp: Date.now(),
      hypothesisId: "H1-H5",
    }),
  }).catch(() => {});
  // #endregion
  let fullText = "";

  const payload: Record<string, unknown> = { messages, context };
  if (options?.model) payload.model = options.model;
  if (options?.webSearch) payload.webSearch = true;
  if (options?.attachments?.length) {
    payload.attachments = options.attachments.map((f) => ({
      name: f.name,
      content: f.content,
      type: f.type ?? "text",
      tempPath: f.tempPath,
    }));
  }

  try {
    const resp = await fetch(`${PROXY_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`代理服务器错误 ${resp.status}: ${errBody}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        try {
          const event = JSON.parse(data);
          if (event.type === "token") {
            fullText += event.text;
            callbacks.onToken(event.text);
          } else if (event.type === "thinking") {
            callbacks.onThinking?.(event.text);
          } else if (event.type === "done") {
            if (event.fullText && !fullText) fullText = event.fullText;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        } catch (parseErr) {
          if (
            parseErr instanceof Error &&
            parseErr.message !== "Unexpected token"
          ) {
            throw parseErr;
          }
        }
      }
    }

    callbacks.onComplete(fullText);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      callbacks.onComplete(fullText || "（已中止生成）");
      return;
    }
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

/** 从 Claude 回复文本中提取代码块 */
export function extractCodeBlocks(
  text: string,
): Array<{ language: string; code: string }> {
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks: Array<{ language: string; code: string }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ language: match[1] || "javascript", code: match[2].trim() });
  }
  return blocks;
}
