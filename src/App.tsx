import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { nanoid } from "nanoid";
import { Claude } from "@lobehub/icons";
import MessageBubble from "./components/MessageBubble";
import ModelSelector from "./components/ModelSelector";
import ModeSelector from "./components/ModeSelector";
import AttachmentMenu from "./components/AttachmentMenu";
import QuickActionCards from "./components/QuickActionCards";
import HistoryPanel from "./components/HistoryPanel";
import { sendMessage, extractCodeBlocks, checkProxy } from "./api/claudeClient";
import {
  getWpsContext,
  onSelectionChange,
  isWpsAvailable,
  executeCode,
} from "./api/wpsAdapter";
import {
  saveSession,
  loadSession,
  listSessions,
  generateTitle,
} from "./api/sessionStore";
import type {
  ChatMessage,
  WpsContext,
  CodeBlock,
  AttachmentFile,
  InteractionMode,
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

  const [sessionId, setSessionId] = useState<string>(nanoid());
  const [historyOpen, setHistoryOpen] = useState(false);

  const [inputBoxHeight, setInputBoxHeight] = useState(120);
  const [currentMode, setCurrentMode] = useState<InteractionMode>(
    () =>
      (localStorage.getItem("wps-claude-mode") as InteractionMode) || "agent",
  );

  const abortRef = useRef<AbortController | null>(null);
  const lastSentInputRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

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

  // 检查代理服务器是否在运行（带重试）
  useEffect(() => {
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      const ok = await checkProxy();
      if (ok) {
        setProxyMissing(false);
        return;
      }
      attempts++;
      if (attempts < 10) {
        timer = setTimeout(check, 2000);
      } else {
        setProxyMissing(true);
      }
    };

    check();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 启动时恢复最近会话
  useEffect(() => {
    const restoreLastSession = async () => {
      try {
        const sessions = await listSessions();
        if (sessions.length === 0) return;
        const latest = sessions[0];
        const session = await loadSession(latest.id);
        if (!session || !session.messages || session.messages.length === 0)
          return;
        setSessionId(session.id);
        setMessages([WELCOME_MESSAGE, ...session.messages]);
        if (session.model) setSelectedModel(session.model);
      } catch {
        // ignore
      }
    };
    restoreLastSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动保存：消息变化后 1 秒去抖保存
  useEffect(() => {
    const realMessages = messages.filter((m) => m.id !== "welcome");
    if (realMessages.length === 0) return;
    const hasStreaming = realMessages.some((m) => m.isStreaming);
    if (hasStreaming) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const title = generateTitle(realMessages);
      saveSession(sessionId, realMessages, { title, model: selectedModel });
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, sessionId, selectedModel]);

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

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleApplyCode = useCallback(async (msgId: string) => {
    const msg = messagesRef.current.find((m) => m.id === msgId);
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
              b.id === block.id ? { ...b, executed: true, error: errorMsg } : b,
            );
            return { ...m, codeBlocks: updated };
          }),
        );
        break;
      }
    }

    setApplyingMsgId(null);
  }, []);

  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const handleSendRef = useRef<(text?: string) => Promise<void>>(
    null as unknown as (text?: string) => Promise<void>,
  );

  const handleRetryFix = useCallback(
    (code: string, error: string, language: string) => {
      if (loadingRef.current) return;
      const fixPrompt = `代码执行出错，请修复以下所有错误并重新生成完整代码。

**错误信息：**
\`\`\`
${error}
\`\`\`

**原始代码（${language}）：**
\`\`\`${language}
${code}
\`\`\`

请修复所有问题，生成可直接执行的完整代码。注意：
1. 修复必须覆盖所有列和所有行的相关操作，不能遗漏
2. 使用 WPS 兼容的 API（避免 .Borders、FormatConditions 不支持的参数等）
3. 对可能失败的操作添加 try/catch 保护
4. 必须使用 Application.ActiveSheet 而不是硬编码 sheet 名称`;
      handleSendRef.current(fixPrompt);
    },
    [],
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

  const handleModeChange = useCallback((mode: InteractionMode) => {
    setCurrentMode(mode);
    localStorage.setItem("wps-claude-mode", mode);
  }, []);

  const handleFileAttach = useCallback((file: AttachmentFile) => {
    setAttachedFiles((prev) => [...prev, file]);
  }, []);

  const handleRemoveFile = useCallback((name: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    [],
  );

  const handleQuickAction = useCallback((prompt: string) => {
    handleSendRef.current(prompt);
  }, []);

  const handleToggleWebSearch = useCallback(() => {
    setWebSearchEnabled((v) => !v);
  }, []);

  const handleSendClick = useCallback(() => {
    handleSendRef.current();
  }, []);

  const handleOpenHistory = useCallback(() => {
    setHistoryOpen(true);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  const handleNewChat = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setSessionId(nanoid());
    setMessages([WELCOME_MESSAGE]);
    setLoading(false);
    setApplyingMsgId(null);
    setPinnedSelection(null);
    setAttachedFiles([]);
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
      const tableAttachments = currentAttachments.filter(
        (f) => f.type === "table",
      );
      const otherAttachments = currentAttachments.filter(
        (f) => f.type !== "table",
      );
      if (otherAttachments.length > 0) {
        displayContent += `\n\n[附件: ${otherAttachments.map((f) => f.name).join(", ")}]`;
      }
      if (tableAttachments.length > 0) {
        displayContent += `\n\n[粘贴表格: ${tableAttachments.map((f) => f.name).join(", ")}]`;
      }
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

    const isAskMode = currentMode === "ask";

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
          const rawBlocks = isAskMode ? [] : extractCodeBlocks(text);
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
            setApplyingMsgId(assistantMsgId);
            for (let _bi = 0; _bi < codeBlocks.length; _bi++) {
              const block = codeBlocks[_bi];
              try {
                const result = await executeCode(block.code);
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
        mode: currentMode,
        attachments:
          currentAttachments.length > 0 ? currentAttachments : undefined,
        signal: controller.signal,
        webSearch: webSearchEnabled,
      },
    );

    abortRef.current = null;
    lastSentInputRef.current = "";
  };

  handleSendRef.current = handleSend;

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
      return prev.filter((_, i) => i !== streamingIdx && i !== userMsgIdx);
    });

    setInput(savedInput);
    setLoading(false);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const toBase64 = (buf: ArrayBuffer): string =>
    btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ""));

  const parseHtmlTable = (html: string): string | null => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (!table) return null;
    const rows = table.querySelectorAll("tr");
    if (rows.length === 0) return null;
    const lines: string[] = [];
    rows.forEach((tr) => {
      const cells = tr.querySelectorAll("th, td");
      const vals: string[] = [];
      cells.forEach((cell) => vals.push(cell.textContent?.trim() ?? ""));
      lines.push(vals.join("\t"));
    });
    return lines.join("\n");
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const imageItem = Array.from(clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      try {
        const arrayBuf = await file.arrayBuffer();
        const base64 = toBase64(arrayBuf);
        const ext = file.type.split("/")[1] || "png";
        const fileName = `clipboard-${Date.now()}.${ext}`;
        const resp = await fetch("http://127.0.0.1:3001/upload-temp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, fileName }),
        });
        const result = await resp.json();
        if (result.ok) {
          const previewUrl = URL.createObjectURL(file);
          setAttachedFiles((prev) => [
            ...prev,
            {
              name: fileName,
              content: `[图片: ${fileName}]`,
              size: file.size,
              type: "image",
              tempPath: result.filePath,
              previewUrl,
            },
          ]);
        }
      } catch {
        /* ignore upload failure */
      }
      return;
    }

    const htmlData = clipboardData.getData("text/html");
    if (htmlData) {
      const tableText = parseHtmlTable(htmlData);
      if (tableText) {
        e.preventDefault();
        const rows = tableText.split("\n");
        const cols = rows[0]?.split("\t").length ?? 0;
        const name = `表格数据 (${rows.length}行×${cols}列)`;
        setAttachedFiles((prev) => [
          ...prev,
          {
            name,
            content: tableText,
            size: tableText.length,
            type: "table",
          },
        ]);
        return;
      }
    }

    const plainText = clipboardData.getData("text/plain");
    if (plainText) {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      setInput((prev) => prev.slice(0, start) + plainText + prev.slice(end));
      requestAnimationFrame(() => {
        const pos = start + plainText.length;
        if (textareaRef.current) {
          textareaRef.current.selectionStart = pos;
          textareaRef.current.selectionEnd = pos;
        }
      });
    }
  };

  const pasteViaProxy = async () => {
    try {
      const resp = await fetch("http://127.0.0.1:3001/clipboard");
      const data = await resp.json();
      if (!data.ok) return;

      if (data.type === "image" && data.filePath) {
        const fileName = data.fileName || `clipboard-${Date.now()}.png`;
        setAttachedFiles((prev) => [
          ...prev,
          {
            name: fileName,
            content: `[图片: ${fileName}]`,
            size: 0,
            type: "image" as const,
            tempPath: data.filePath,
          },
        ]);
        return;
      }

      if (data.text) {
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const pasteText = data.text;
        setInput((prev) => prev.slice(0, start) + pasteText + prev.slice(end));
        requestAnimationFrame(() => {
          const pos = start + pasteText.length;
          if (textareaRef.current) {
            textareaRef.current.selectionStart = pos;
            textareaRef.current.selectionEnd = pos;
          }
        });
      }
    } catch {
      /* proxy unreachable */
    }
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
      pasteViaProxy();
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

  const inputBoxHeightRef = useRef(inputBoxHeight);
  inputBoxHeightRef.current = inputBoxHeight;

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, h: inputBoxHeightRef.current };
    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const delta = dragStartRef.current.y - ev.clientY;
      const next = Math.max(80, Math.min(400, dragStartRef.current.h + delta));
      setInputBoxHeight(next);
    };
    const onUp = () => {
      dragStartRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

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
            onClick={handleOpenHistory}
            title="历史记录"
          >
            <HistoryIcon />
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleNewChat}
            title="新对话"
          >
            <NewChatIcon />
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
            onRetryFix={handleRetryFix}
            isApplying={applyingMsgId === msg.id}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className={styles.inputArea}>
        {/* 智能快捷卡片 - 水平滚动行 */}
        <QuickActionCards
          hasSelection={!!wpsCtx?.selection}
          onAction={handleQuickAction}
          disabled={loading}
          mode={currentMode}
        />

        <div className={styles.inputBox} style={{ height: inputBoxHeight }}>
          {/* 拖拽手柄 */}
          <div className={styles.dragHandle} onMouseDown={handleDragStart}>
            <div className={styles.dragDots} />
          </div>

          {/* 输入主体 */}
          <div className={styles.inputBody}>
            {/* inline chips */}
            <div className={styles.inputChips}>
              {pinnedSelection && (
                <span className={styles.inlineChip}>
                  <TableIcon />
                  <span className={styles.chipLabel}>
                    {pinnedSelection.label}（{pinnedSelection.rowCount}×
                    {pinnedSelection.colCount}）
                  </span>
                  <button
                    className={styles.chipRemove}
                    onClick={() => setPinnedSelection(null)}
                  >
                    ×
                  </button>
                </span>
              )}
              {attachedFiles.map((f) => (
                <span
                  key={f.name}
                  className={`${styles.inlineChip} ${f.type === "table" ? styles.chipTable : ""} ${f.type === "image" ? styles.chipImage : ""}`}
                >
                  {f.type === "image" ? (
                    f.previewUrl ? (
                      <img
                        src={f.previewUrl}
                        alt={f.name}
                        className={styles.chipThumb}
                      />
                    ) : (
                      <ImageIcon />
                    )
                  ) : f.type === "table" ? (
                    <TableIcon />
                  ) : (
                    <span className={styles.chipFileIcon}>📎</span>
                  )}
                  <span className={styles.chipLabel}>{f.name}</span>
                  <button
                    className={styles.chipRemove}
                    onClick={() => handleRemoveFile(f.name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            {/* 文本输入 */}
            <textarea
              ref={textareaRef}
              className={styles.inlineTextarea}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                pinnedSelection || attachedFiles.length > 0
                  ? "描述你想做什么..."
                  : "发个指令...（Enter 发送，Shift+Enter 换行）"
              }
              rows={1}
              disabled={loading}
            />
          </div>

          {/* 底部工具栏 */}
          <div className={styles.inputToolbar}>
            <div className={styles.toolbarLeft}>
              <AttachmentMenu
                onFileAttach={handleFileAttach}
                webSearchEnabled={webSearchEnabled}
                onToggleWebSearch={handleToggleWebSearch}
                disabled={loading}
              />
              <ModeSelector
                mode={currentMode}
                onChange={handleModeChange}
                disabled={loading}
              />
            </div>
            <div className={styles.toolbarRight}>
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
                  onClick={handleSendClick}
                  disabled={!input.trim()}
                  title="发送"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <HistoryPanel
        visible={historyOpen}
        onClose={handleCloseHistory}
        currentSessionId={sessionId}
        onSelectSession={async (id) => {
          const session = await loadSession(id);
          if (!session) return;
          if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
          setSessionId(session.id);
          setMessages(
            session.messages.length > 0
              ? [WELCOME_MESSAGE, ...session.messages]
              : [WELCOME_MESSAGE],
          );
          if (session.model) setSelectedModel(session.model);
          setLoading(false);
          setApplyingMsgId(null);
        }}
      />
    </div>
  );
}

function HistoryIcon() {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
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

function ImageIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
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
