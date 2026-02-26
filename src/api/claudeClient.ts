/**
 * Claude API 调用层
 *
 * 通过本地代理服务器（proxy-server.js）调用 claude CLI，
 * 绕过 OAuth token 无法直接调用 Anthropic 公开 API 的限制。
 */
import type { WpsContext, ChatMessage, AttachmentFile } from "../types";

const PROXY_BASE = "http://127.0.0.1:3001";

// #region agent log
function _feDbg(loc: string, msg: string, data?: Record<string, unknown>) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${PROXY_BASE}/wps-debug-log`, false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ sessionId: "165bed", location: `fe:${loc}`, message: msg, data: data || {}, timestamp: Date.now() }));
  } catch {}
}
// #endregion

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
  onModeInfo?: (mode: string, enforcement: Record<string, unknown>) => void;
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
  mode?: string;
}

/**
 * SSE line parser — shared by both XHR onprogress and fetch fallback.
 * Processes complete lines from `buffer`, dispatches callbacks, returns the
 * remaining (possibly incomplete) tail of the buffer.
 */
function processSseLines(
  buffer: string,
  fullTextRef: { v: string },
  callbacks: StreamCallbacks,
): string {
  const lines = buffer.split("\n");
  const tail = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const event = JSON.parse(data);
      if (event.type === "mode") {
        callbacks.onModeInfo?.(event.mode, event.enforcement);
      } else if (event.type === "token") {
        fullTextRef.v += event.text;
        callbacks.onToken(event.text);
      } else if (event.type === "thinking") {
        callbacks.onThinking?.(event.text);
      } else if (event.type === "done") {
        if (event.fullText && !fullTextRef.v) fullTextRef.v = event.fullText;
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
  return tail;
}

/** 流式发送消息给 Claude（通过本地代理） — 使用 XHR onprogress 实现流式 */
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

  const payload: Record<string, unknown> = { messages, context };
  if (options?.model) payload.model = options.model;
  if (options?.mode) payload.mode = options.mode;
  if (options?.webSearch) payload.webSearch = true;
  if (options?.attachments?.length) {
    payload.attachments = options.attachments.map((f) => ({
      name: f.name,
      content: f.content,
      type: f.type ?? "text",
      tempPath: f.tempPath,
    }));
  }

  const fullTextRef = { v: "" };
  const streamStart = Date.now();
  let progressCount = 0;
  let prevLen = 0;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${PROXY_BASE}/chat`, true);
    xhr.setRequestHeader("Content-Type", "application/json");

    let buffer = "";
    let aborted = false;

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        xhr.abort();
      });
    }

    // #region agent log
    _feDbg("xhr-open", "XHR opening", { url: `${PROXY_BASE}/chat`, payloadLen: JSON.stringify(payload).length });
    // #endregion

    xhr.onprogress = () => {
      const newData = xhr.responseText.slice(prevLen);
      prevLen = xhr.responseText.length;
      if (!newData) return;

      progressCount++;
      buffer += newData;

      // #region agent log
      if (progressCount <= 3 || progressCount % 50 === 0) {
        _feDbg("xhr-progress", "onprogress", { progressCount, newDataLen: newData.length, totalLen: prevLen, elapsed: Date.now() - streamStart, fullTextLen: fullTextRef.v.length, bufferPreview: buffer.substring(0, 200) });
      }
      // #endregion

      try {
        buffer = processSseLines(buffer, fullTextRef, callbacks);
      } catch (err) {
        // #region agent log
        _feDbg("xhr-progress-error", "processSseLines threw", { message: (err as Error).message, fullTextLen: fullTextRef.v.length, bufferPreview: buffer.substring(0, 300) });
        // #endregion
        aborted = true;
        xhr.abort();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    xhr.onload = () => {
      // #region agent log
      _feDbg("xhr-onload", "XHR onload fired", { status: xhr.status, aborted, responseLen: xhr.responseText.length, fullTextLen: fullTextRef.v.length, elapsed: Date.now() - streamStart, progressCount });
      // #endregion
      if (aborted) return;
      if (xhr.status !== 200) {
        reject(new Error(`代理服务器错误 ${xhr.status}: ${xhr.responseText}`));
        return;
      }
      const remaining = xhr.responseText.slice(prevLen);
      if (remaining) {
        buffer += remaining;
        try {
          processSseLines(buffer, fullTextRef, callbacks);
        } catch (err) {
          // #region agent log
          _feDbg("xhr-onload-error", "processSseLines threw in onload", { message: (err as Error).message });
          // #endregion
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
      }
      callbacks.onComplete(fullTextRef.v);
      resolve();
    };

    xhr.onerror = () => {
      // #region agent log
      _feDbg("xhr-onerror", "XHR onerror fired", { aborted, readyState: xhr.readyState, status: xhr.status, fullTextLen: fullTextRef.v.length, elapsed: Date.now() - streamStart, progressCount });
      // #endregion
      if (aborted) {
        callbacks.onComplete(fullTextRef.v || "（已中止生成）");
        resolve();
        return;
      }
      reject(new Error("无法连接代理服务器，请检查 proxy-server 是否运行"));
    };

    xhr.onabort = () => {
      // #region agent log
      _feDbg("xhr-onabort", "XHR onabort fired", { fullTextLen: fullTextRef.v.length, elapsed: Date.now() - streamStart, progressCount });
      // #endregion
      callbacks.onComplete(fullTextRef.v || "（已中止生成）");
      resolve();
    };

    xhr.send(JSON.stringify(payload));
  });
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
