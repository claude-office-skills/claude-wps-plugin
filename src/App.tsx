import { useState, useRef, useEffect, useCallback } from "react";
import { nanoid } from "nanoid";
import { Claude } from "@lobehub/icons";
import MessageBubble from "./components/MessageBubble";
import ModelSelector from "./components/ModelSelector";
import AttachmentMenu from "./components/AttachmentMenu";
import QuickActionCards from "./components/QuickActionCards";
import { sendMessage, extractCodeBlocks, checkProxy } from "./api/claudeClient";
import {
  getWpsContext,
  onSelectionChange,
  isWpsAvailable,
  executeCode,
} from "./api/wpsAdapter";
import type {
  ChatMessage,
  WpsContext,
  CodeBlock,
  AttachmentFile,
} from "./types";
import styles from "./App.module.css";

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "你好！我是 Claude，你的 WPS Excel AI 助手。\n\n我可以帮你：\n- **清洗数据**（去重、删除空白、统一格式）\n- **转换格式**（日期、数字、文本类型）\n- **批量操作**（填充、替换、计算）\n\n请先**选中一个区域**，然后告诉我你想做什么。",
  timestamp: Date.now(),
};

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [wpsCtx, setWpsCtx] = useState<WpsContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [proxyMissing, setProxyMissing] = useState(false);
  const [applyingMsgId, setApplyingMsgId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6");
  const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [pinnedSelection, setPinnedSelection] = useState<{
    label: string;
    address: string;
    sheetName: string;
    rowCount: number;
    colCount: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastSentInputRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 初始化：获取 WPS 上下文 + 订阅选区变化
  useEffect(() => {
    const initCtx = async () => {
      try {
        const ctx = await getWpsContext();
        setWpsCtx(ctx);
      } catch {
        // 非 WPS 环境，使用 mock
        const ctx = await getWpsContext();
        setWpsCtx(ctx);
      }
    };
    initCtx();

    const unsubscribe = onSelectionChange((ctx) => setWpsCtx(ctx));
    return unsubscribe;
  }, []);

  // 检查代理服务器是否在运行
  useEffect(() => {
    checkProxy().then((ok) => {
      if (!ok) setProxyMissing(true);
    });
  }, []);

  // 全局 Cmd+C：WPS WebView 中原生 copy 不生效，手动写入剪贴板
  useEffect(() => {
    const handleGlobalCopy = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "c") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement
      )
        return;

      const sel = window.getSelection();
      const text = sel?.toString();
      if (!text) return;

      e.preventDefault();
      navigator.clipboard?.writeText(text).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      });
    };
    document.addEventListener("keydown", handleGlobalCopy);
    return () => document.removeEventListener("keydown", handleGlobalCopy);
  }, []);

  // 自动滚动到底部 — 流式时直接跳转，非流式时平滑
  useEffect(() => {
    const isStreaming = messages.some((m) => m.isStreaming);
    if (isStreaming) {
      const container = bottomRef.current?.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleCodeExecuted = useCallback(
    (msgId: string, blockId: string, result: string, error?: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== msgId) return msg;
          const updatedBlocks = msg.codeBlocks?.map((b) =>
            b.id === blockId ? { ...b, executed: true, result, error } : b,
          );
          return { ...msg, codeBlocks: updatedBlocks };
        }),
      );
    },
    [],
  );

  const handleApplyCode = useCallback(
    async (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      const blocks = msg?.codeBlocks?.filter((b) => !b.executed);
      if (!blocks?.length) return;

      setApplyingMsgId(msgId);

      for (const block of blocks) {
        try {
          const result = await executeCode(block.code);
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msgId) return m;
              const updated = m.codeBlocks?.map((b) =>
                b.id === block.id ? { ...b, executed: true, result } : b,
              );
              return { ...m, codeBlocks: updated };
            }),
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msgId) return m;
              const updated = m.codeBlocks?.map((b) =>
                b.id === block.id
                  ? { ...b, executed: true, error: errorMsg }
                  : b,
              );
              return { ...m, codeBlocks: updated };
            }),
          );
          break;
        }
      }

      setApplyingMsgId(null);
    },
    [messages],
  );

  const handlePinSelection = useCallback(() => {
    if (!wpsCtx?.selection) return;
    const sel = wpsCtx.selection;
    setPinnedSelection({
      label: `${sel.sheetName}!${sel.address}`,
      address: sel.address,
      sheetName: sel.sheetName,
      rowCount: sel.rowCount,
      colCount: sel.colCount,
    });
    textareaRef.current?.focus();
  }, [wpsCtx]);

  const handleFileAttach = useCallback((file: AttachmentFile) => {
    setAttachedFiles((prev) => [...prev, file]);
  }, []);

  const handleRemoveFile = useCallback((name: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handleSend = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const currentAttachments = [...attachedFiles];
    const currentPinned = pinnedSelection;
    lastSentInputRef.current = userText;
    setInput("");
    setAttachedFiles([]);
    setPinnedSelection(null);

    let displayContent = userText;
    if (currentPinned) {
      displayContent += `\n\n📎 引用选区: ${currentPinned.label}（${currentPinned.rowCount} 行 × ${currentPinned.colCount} 列）`;
    }
    if (currentAttachments.length > 0) {
      displayContent += `\n\n[附件: ${currentAttachments.map((f) => f.name).join(", ")}]`;
    }

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
    };

    const assistantMsgId = nanoid();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = "";
    let thinkingText = "";
    const thinkingStart = Date.now();
    let firstTokenReceived = false;

    await sendMessage(
      userText,
      messages.filter((m) => m.id !== "welcome"),
      wpsCtx ?? { workbookName: "", sheetNames: [], selection: null },
      {
        onThinking: (text) => {
          thinkingText += text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, thinkingContent: thinkingText }
                : m,
            ),
          );
        },
        onToken: (token) => {
          fullText += token;
          const updates: Partial<ChatMessage> = { content: fullText };
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            updates.thinkingMs = Date.now() - thinkingStart;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, ...updates } : m,
            ),
          );
        },
        onComplete: async (text) => {
          const rawBlocks = extractCodeBlocks(text);
          const codeBlocks: CodeBlock[] = rawBlocks.map((b) => ({
            id: nanoid(),
            language: b.language,
            code: b.code,
          }));

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: text, isStreaming: false, codeBlocks }
                : m,
            ),
          );
          setLoading(false);

          if (codeBlocks.length > 0) {
            // #region agent log
            fetch(
              "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "fc5e63",
                },
                body: JSON.stringify({
                  sessionId: "fc5e63",
                  location: "App.tsx:autoExec",
                  message: "Auto-exec start",
                  data: {
                    blockCount: codeBlocks.length,
                    blockLangs: codeBlocks.map((b) => b.language),
                    blockSizes: codeBlocks.map((b) => b.code.length),
                  },
                  timestamp: Date.now(),
                  hypothesisId: "H2",
                }),
              },
            ).catch(() => {});
            // #endregion
            setApplyingMsgId(assistantMsgId);
            for (let _bi = 0; _bi < codeBlocks.length; _bi++) {
              const block = codeBlocks[_bi];
              try {
                const result = await executeCode(block.code);
                // #region agent log
                fetch(
                  "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Debug-Session-Id": "fc5e63",
                    },
                    body: JSON.stringify({
                      sessionId: "fc5e63",
                      location: "App.tsx:autoExec:success",
                      message: "Block executed OK",
                      data: {
                        blockIndex: _bi,
                        resultSnippet: String(result).slice(0, 200),
                      },
                      timestamp: Date.now(),
                      hypothesisId: "H4",
                    }),
                  },
                ).catch(() => {});
                // #endregion
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantMsgId) return m;
                    const updated = m.codeBlocks?.map((b) =>
                      b.id === block.id ? { ...b, executed: true, result } : b,
                    );
                    return { ...m, codeBlocks: updated };
                  }),
                );
              } catch (err) {
                const errorMsg =
                  err instanceof Error ? err.message : String(err);
                // #region agent log
                fetch(
                  "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Debug-Session-Id": "fc5e63",
                    },
                    body: JSON.stringify({
                      sessionId: "fc5e63",
                      location: "App.tsx:autoExec:error",
                      message: "Block execution FAILED",
                      data: {
                        blockIndex: _bi,
                        error: errorMsg,
                        codeSnippet: block.code.slice(0, 300),
                      },
                      timestamp: Date.now(),
                      hypothesisId: "H1",
                    }),
                  },
                ).catch(() => {});
                // #endregion
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantMsgId) return m;
                    const updated = m.codeBlocks?.map((b) =>
                      b.id === block.id
                        ? { ...b, executed: true, error: errorMsg }
                        : b,
                    );
                    return { ...m, codeBlocks: updated };
                  }),
                );
                break;
              }
            }
            setApplyingMsgId(null);
          }
        },
        onError: (err) => {
          const isProxyError =
            err.message.includes("fetch") ||
            err.message.includes("Failed") ||
            err.message.includes("代理");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: isProxyError
                      ? "**错误**：无法连接代理服务器。\n\n请在终端运行：\n```\ncd ~/需求讨论/claude-wps-plugin\nnode proxy-server.js\n```"
                      : `**错误**：${err.message}`,
                    isStreaming: false,
                    isError: true,
                  }
                : m,
            ),
          );
          setProxyMissing(true);
          setLoading(false);
        },
      },
      {
        model: selectedModel,
        attachments:
          currentAttachments.length > 0 ? currentAttachments : undefined,
        signal: controller.signal,
        webSearch: webSearchEnabled,
      },
    );

    abortRef.current = null;
    lastSentInputRef.current = "";
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const savedInput = lastSentInputRef.current;
    lastSentInputRef.current = "";

    setMessages((prev) => {
      const streamingIdx = prev.findIndex((m) => m.isStreaming);
      if (streamingIdx === -1) return prev;
      const userMsgIdx = streamingIdx - 1;
      return prev.filter(
        (_, i) => i !== streamingIdx && i !== userMsgIdx,
      );
    });

    setInput(savedInput);
    setLoading(false);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;

    if (e.key === "v") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      fetch("http://127.0.0.1:3001/clipboard")
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && data.text) {
            setInput(
              (prev) => prev.slice(0, start) + data.text + prev.slice(end),
            );
            requestAnimationFrame(() => {
              const pos = start + data.text.length;
              if (textareaRef.current) {
                textareaRef.current.selectionStart = pos;
                textareaRef.current.selectionEnd = pos;
              }
            });
          }
        })
        .catch(() => {});
      return;
    }

    if (e.key === "a") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta) {
        ta.selectionStart = 0;
        ta.selectionEnd = ta.value.length;
      }
    }

    if (e.key === "x") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end) return;
      const selectedText = input.slice(start, end);
      navigator.clipboard?.writeText(selectedText).catch(() => {});
      setInput(input.slice(0, start) + input.slice(end));
      requestAnimationFrame(() => {
        ta.selectionStart = start;
        ta.selectionEnd = start;
      });
    }

    if (e.key === "c") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end) return;
      navigator.clipboard?.writeText(input.slice(start, end)).catch(() => {});
    }
  };

  return (
    <div className={styles.shell}>
      {/* 顶部 Header */}
      <header className={styles.header}>
        <div className={styles.logoRow}>
          <div className={styles.logoIcon}>
            <Claude.Color size={20} />
          </div>
          <div className={styles.logoName}>Claude for WPS</div>
          <span className={styles.betaBadge}>Beta</span>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.headerBtn}
            onClick={() => {
              if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
              }
              setMessages([WELCOME_MESSAGE]);
              setLoading(false);
              setApplyingMsgId(null);
              setPinnedSelection(null);
              setAttachedFiles([]);
            }}
            title="新对话"
          >
            <NewChatIcon />
          </button>
          <button className={styles.headerBtn} title="更多">
            <MoreIcon />
          </button>
        </div>
      </header>

      {/* 选区上下文条 */}
      {wpsCtx?.selection && (
        <div className={styles.ctxBar}>
          <TableIcon />
          <span className={styles.ctxText}>
            {wpsCtx.selection.sheetName}!{wpsCtx.selection.address}（
            {wpsCtx.selection.rowCount} 行 × {wpsCtx.selection.colCount} 列）
          </span>
          <button
            className={styles.ctxPinBtn}
            onClick={handlePinSelection}
            title="引用选区到输入框"
          >
            <PinIcon /> 引用
          </button>
          <span className={styles.ctxBadge}>
            {isWpsAvailable() ? "WPS" : "mock"}
          </span>
        </div>
      )}

      {/* 代理服务器警告 */}
      {proxyMissing && (
        <div className={styles.warning}>
          ⚠ 代理服务器未运行，请在终端执行：node proxy-server.js
        </div>
      )}

      {/* 消息列表 */}
      <div className={styles.chatArea}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onCodeExecuted={handleCodeExecuted}
            onApplyCode={handleApplyCode}
            isApplying={applyingMsgId === msg.id}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className={styles.inputArea}>
        {/* 已引用选区标签 */}
        {pinnedSelection && (
          <div className={styles.attachedBar}>
            <span className={styles.pinnedTag}>
              <TableIcon />
              <span className={styles.attachedName}>
                {pinnedSelection.label}（{pinnedSelection.rowCount}×
                {pinnedSelection.colCount}）
              </span>
              <button
                className={styles.attachedRemove}
                onClick={() => setPinnedSelection(null)}
              >
                ×
              </button>
            </span>
          </div>
        )}

        {/* 已附件文件标签 */}
        {attachedFiles.length > 0 && (
          <div className={styles.attachedBar}>
            {attachedFiles.map((f) => (
              <span key={f.name} className={styles.attachedTag}>
                {f.type === "image" && f.previewUrl ? (
                  <img
                    src={f.previewUrl}
                    alt={f.name}
                    className={styles.attachedThumb}
                  />
                ) : (
                  <span className={styles.attachedIcon}>📎</span>
                )}
                <span className={styles.attachedName}>{f.name}</span>
                <button
                  className={styles.attachedRemove}
                  onClick={() => handleRemoveFile(f.name)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 智能快捷卡片 - 水平滚动行 */}
        <QuickActionCards
          hasSelection={!!wpsCtx?.selection}
          onAction={(prompt) => handleSend(prompt)}
          disabled={loading}
        />

        <div className={styles.inputBox}>
          <AttachmentMenu
            onFileAttach={handleFileAttach}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={() => setWebSearchEnabled((v) => !v)}
            disabled={loading}
          />
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="发个指令...（Enter 发送，Shift+Enter 换行）"
            rows={2}
            disabled={loading}
          />
          <ModelSelector
            value={selectedModel}
            onChange={setSelectedModel}
            disabled={loading}
          />
          {loading ? (
            <button
              className={`${styles.sendBtn} ${styles.stopBtn}`}
              onClick={handleStop}
              title="停止生成"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              className={styles.sendBtn}
              onClick={() => handleSend()}
              disabled={!input.trim()}
              title="发送"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TableIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94l18.04-8.01a.75.75 0 0 0 0-1.37L3.478 2.404Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <line x1="9" y1="10" x2="15" y2="10" />
      <line x1="12" y1="7" x2="12" y2="13" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}
