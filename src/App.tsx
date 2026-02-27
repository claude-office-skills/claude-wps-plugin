import { useState, useRef, useEffect, useCallback } from "react";
import { nanoid } from "nanoid";
import { Claude } from "@lobehub/icons";
import MessageBubble from "./components/MessageBubble";
import ModelSelector from "./components/ModelSelector";
import ModeSelector from "./components/ModeSelector";
import AttachmentMenu from "./components/AttachmentMenu";
import QuickActionCards from "./components/QuickActionCards";
import HistoryPanel from "./components/HistoryPanel";
import ThemeToggle from "./components/ThemeToggle";
import AgentTabBar from "./components/AgentTabBar";
import AgentListPanel from "./components/AgentListPanel";
import { useTheme } from "./hooks/useTheme";
import { useAgentManager } from "./hooks/useAgentManager";
import { sendMessage, extractCodeBlocks, checkProxy } from "./api/claudeClient";
import {
  getWpsContext,
  onSelectionChange,
  isWpsAvailable,
  executeCode,
  pollAddToChat,
} from "./api/wpsAdapter";
import {
  saveSession,
  loadSession,
  listSessions,
  generateTitle,
  generateAgentName,
} from "./api/sessionStore";
import type {
  ChatMessage,
  WpsContext,
  CodeBlock,
  AttachmentFile,
  InteractionMode,
} from "./types";
import styles from "./App.module.css";

export default function App() {
  const { theme, cycleTheme } = useTheme();
  const agentMgr = useAgentManager();
  const {
    agents,
    activeAgentId,
    activeAgent,
    createNewAgent,
    switchAgent,
    removeAgent,
    updateActiveMessages,
    setActiveStatus,
    setActiveName,
    setActiveMode,
    setActiveModel,
  } = agentMgr;

  const messages = activeAgent.messages;
  const currentMode = activeAgent.mode;
  const selectedModel = activeAgent.model;

  const [input, setInput] = useState("");
  const [wpsCtx, setWpsCtx] = useState<WpsContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [proxyMissing, setProxyMissing] = useState(false);
  const [applyingMsgId, setApplyingMsgId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [pinnedSelection, setPinnedSelection] = useState<{
    label: string;
    address: string;
    sheetName: string;
    rowCount: number;
    colCount: number;
  } | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [agentListOpen, setAgentListOpen] = useState(true);

  const [inputBoxHeight, setInputBoxHeight] = useState(120);
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      const ok = await checkProxy();
      setProxyMissing(!ok);
      timer = setTimeout(poll, ok ? 30000 : 3000);
    };

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 轮询右键 "Add to Chat" 事件
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const data = await pollAddToChat();
        if (data) {
          const label = `${data.sheetName}!${data.address}`;
          const rows = data.values
            .slice(0, 10)
            .map((r) => r.join("\t"))
            .join("\n");
          const preview =
            data.rowCount > 10 ? rows + `\n... (共 ${data.rowCount} 行)` : rows;
          setInput((prev) =>
            prev
              ? `${prev}\n\n📎 [${label}]\n${preview}`
              : `📎 [${label}]\n${preview}`,
          );
          setPinnedSelection({
            label,
            address: data.address,
            sheetName: data.sheetName,
            rowCount: data.rowCount,
            colCount: data.colCount,
          });
        }
      } catch {
        /* ignore */
      }
      if (!stopped) setTimeout(poll, 1000);
    };
    poll();
    return () => {
      stopped = true;
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
        agentMgr.loadAgentsFromSessions([
          {
            id: session.id,
            title: session.title || "",
            messages: session.messages,
            model: session.model,
          },
        ]);
      } catch {
        // ignore
      }
    };
    restoreLastSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动保存：消息变化后 1 秒去抖保存 + 自动命名
  useEffect(() => {
    const realMessages = messages.filter((m) => !m.id.startsWith("welcome"));
    if (realMessages.length === 0) return;
    const hasStreaming = realMessages.some((m) => m.isStreaming);
    if (hasStreaming) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let title = activeAgent.name;
      if (!title) {
        title = await generateAgentName(realMessages);
        if (title) setActiveName(title);
      }
      if (!title) title = generateTitle(realMessages);
      saveSession(activeAgentId, realMessages, { title, model: selectedModel });
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, activeAgentId, selectedModel, activeAgent.name, setActiveName]);

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

  useEffect(() => {
    const handleSidebarToggle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setAgentListOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handleSidebarToggle);
    return () => document.removeEventListener("keydown", handleSidebarToggle);
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
    (
      msgId: string,
      blockId: string,
      result: string,
      error?: string,
      diff?: import("./types").DiffResult | null,
    ) => {
      updateActiveMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== msgId) return msg;
          const updatedBlocks = msg.codeBlocks?.map((b) =>
            b.id === blockId
              ? { ...b, executed: true, result, error, diff }
              : b,
          );
          return { ...msg, codeBlocks: updatedBlocks };
        }),
      );
    },
    [updateActiveMessages],
  );

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleApplyCode = useCallback(
    async (msgId: string) => {
      const msg = messagesRef.current.find((m) => m.id === msgId);
      const blocks = msg?.codeBlocks?.filter((b) => !b.executed);
      if (!blocks?.length) return;

      setApplyingMsgId(msgId);

      for (const block of blocks) {
        try {
          const { result, diff } = await executeCode(block.code, activeAgentId);
          updateActiveMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msgId) return m;
              const updated = m.codeBlocks?.map((b) =>
                b.id === block.id ? { ...b, executed: true, result, diff } : b,
              );
              return { ...m, codeBlocks: updated };
            }),
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          updateActiveMessages((prev) =>
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
    [updateActiveMessages],
  );

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

  const handleModeChange = useCallback(
    (mode: InteractionMode) => {
      setActiveMode(mode);
    },
    [setActiveMode],
  );

  const handleFileAttach = useCallback((file: AttachmentFile) => {
    setAttachedFiles((prev) => [...prev, file]);
  }, []);

  const handleRemoveFile = useCallback((name: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const MAX_INPUT_LENGTH = 20000;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (e.target.value.length <= MAX_INPUT_LENGTH) {
        setInput(e.target.value);
      }
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
    createNewAgent();
    setLoading(false);
    setApplyingMsgId(null);
    setPinnedSelection(null);
    setAttachedFiles([]);
  }, [createNewAgent]);

  const handleSwitchToAgent = useCallback(() => {
    setActiveMode("agent");
  }, [setActiveMode]);

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

    updateActiveMessages((prev) => [...prev, userMsg, assistantMsg]);
    setActiveStatus("running");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = "";
    let thinkingText = "";
    const thinkingStart = Date.now();
    let firstTokenReceived = false;
    let aborted = false;

    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });

    const modeSnapshot = currentMode;

    try {
      await sendMessage(
        userText,
        messages.filter((m) => !m.id.startsWith("welcome")),
        wpsCtx ?? { workbookName: "", sheetNames: [], selection: null },
        {
          onThinking: (text) => {
            if (aborted) return;
            thinkingText += text;
            updateActiveMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, thinkingContent: thinkingText }
                  : m,
              ),
            );
          },
          onToken: (token) => {
            if (aborted) return;
            fullText += token;
            const updates: Partial<ChatMessage> = { content: fullText };
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              updates.thinkingMs = Date.now() - thinkingStart;
              setProxyMissing(false);
            }
            updateActiveMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, ...updates } : m,
              ),
            );
          },
          onComplete: async (text) => {
            if (aborted) return;
            if (modeSnapshot === "ask") {
              const strippedText = text.replace(
                /```[\w]*\n[\s\S]*?```/g,
                "_(此处为代码操作，请切换至 Agent 模式执行)_",
              );

              const hadCode = strippedText !== text;
              const ACTION_HINTS =
                /切换.{0,4}Agent|switch.{0,6}agent|需要执行|需要操作|建议.{0,4}Agent/i;
              const suggestSwitch = hadCode || ACTION_HINTS.test(text);

              updateActiveMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: strippedText,
                        isStreaming: false,
                        codeBlocks: [],
                        suggestAgentSwitch: suggestSwitch,
                      }
                    : m,
                ),
              );
              setActiveStatus("done");
              setLoading(false);
              return;
            }

            const rawBlocks = extractCodeBlocks(text);
            const codeBlocks: CodeBlock[] = rawBlocks.map((b) => ({
              id: nanoid(),
              language: b.language,
              code: b.code,
            }));

            updateActiveMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: text, isStreaming: false, codeBlocks }
                  : m,
              ),
            );

            const shouldAutoExecute = modeSnapshot === "agent";

            if (shouldAutoExecute && codeBlocks.length > 0) {
              setApplyingMsgId(assistantMsgId);
              for (let _bi = 0; _bi < codeBlocks.length; _bi++) {
                const block = codeBlocks[_bi];
                try {
                  const { result, diff } = await executeCode(
                    block.code,
                    activeAgentId,
                  );
                  updateActiveMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantMsgId) return m;
                      const updated = m.codeBlocks?.map((b) =>
                        b.id === block.id
                          ? { ...b, executed: true, result, diff }
                          : b,
                      );
                      return { ...m, codeBlocks: updated };
                    }),
                  );
                } catch (err) {
                  const errorMsg =
                    err instanceof Error ? err.message : String(err);
                  updateActiveMessages((prev) =>
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
                  setActiveStatus("failed", errorMsg);
                  break;
                }
              }
              setApplyingMsgId(null);
            }
            setActiveStatus("done");
            setLoading(false);
          },
          onError: (err) => {
            const isProxyError =
              err.message.includes("fetch") ||
              err.message.includes("Failed") ||
              err.message.includes("代理");
            updateActiveMessages((prev) =>
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
            setActiveStatus("failed", err.message);
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
    } catch (unexpectedErr) {
      const errMsg =
        unexpectedErr instanceof Error
          ? unexpectedErr.message
          : String(unexpectedErr);
      updateActiveMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `**错误**：${errMsg}`,
                isStreaming: false,
                isError: true,
              }
            : m,
        ),
      );
      setActiveStatus("failed", errMsg);
      setLoading(false);
      setApplyingMsgId(null);
    }

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

    updateActiveMessages((prev) => {
      const streamingIdx = prev.findIndex((m) => m.isStreaming);
      if (streamingIdx === -1) return prev;
      const userMsgIdx = streamingIdx - 1;
      return prev.filter((_, i) => i !== streamingIdx && i !== userMsgIdx);
    });

    setActiveStatus("idle");
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

  const insertTextAtCursor = (pasteText: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setInput((prev) => prev.slice(0, start) + pasteText + prev.slice(end));
    requestAnimationFrame(() => {
      const pos = start + pasteText.length;
      if (textareaRef.current) {
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
      }
    });
  };

  const fallbackNativePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) insertTextAtCursor(text);
    } catch {
      /* native clipboard also unavailable */
    }
  };

  const pasteViaProxy = async () => {
    try {
      const resp = await fetch("http://127.0.0.1:3001/clipboard");
      const data = await resp.json();
      if (!data.ok) {
        await fallbackNativePaste();
        return;
      }

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
        insertTextAtCursor(data.text);
      }
    } catch {
      await fallbackNativePaste();
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
          <div className={styles.logoName}>Claude for Excel</div>
          <span className={styles.betaBadge}>v 1.0</span>
        </div>
        <div className={styles.headerActions}>
          <ThemeToggle theme={theme} onCycle={cycleTheme} />
          <button
            className={styles.headerBtn}
            onClick={handleOpenHistory}
            title="历史记录"
          >
            <HistoryIcon />
          </button>
        </div>
      </header>

      {/* 主体区域：Cursor 风格左侧 Agent 侧边栏 + 右侧聊天列 */}
      <div className={styles.mainBody}>
        <AgentListPanel
          agents={agents}
          activeAgentId={activeAgentId}
          expanded={agentListOpen}
          onSwitch={switchAgent}
          onNew={handleNewChat}
          onRemove={removeAgent}
        />

        <div className={styles.chatColumn}>
          {/* Multi-Agent Tab 栏 — 始终固定在聊天列顶部 */}
          <AgentTabBar
            agents={agents}
            activeAgentId={activeAgentId}
            onSwitch={switchAgent}
            onClose={removeAgent}
            onNew={handleNewChat}
            onToggleList={() => setAgentListOpen((v) => !v)}
            listExpanded={agentListOpen}
          />

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
                onSwitchToAgent={handleSwitchToAgent}
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
                onChange={setActiveModel}
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
        </div>{/* end chatColumn */}
      </div>{/* end mainBody */}

      <HistoryPanel
        visible={historyOpen}
        onClose={handleCloseHistory}
        currentSessionId={activeAgentId}
        onSelectSession={async (id) => {
          const session = await loadSession(id);
          if (!session) return;
          if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
          agentMgr.loadAgentsFromSessions([
            {
              id: session.id,
              title: session.title || "",
              messages: session.messages,
              model: session.model,
            },
          ]);
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
