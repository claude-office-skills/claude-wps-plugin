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
import UpdateNotification from "./components/UpdateNotification";
import LongTaskPanel from "./components/LongTaskPanel";
import TeamTaskBoard from "./components/TeamTaskBoard";
import SlashCommandPopup from "./components/SlashCommandPopup";
import AtContextPopup from "./components/AtContextPopup";
import { Onboarding, useOnboardingStatus } from "./components/Onboarding";
import DataConnectorPanel from "./components/DataConnectorPanel";
import { useTheme } from "./hooks/useTheme";
import { useAgentManager } from "./hooks/useAgentManager";
import { useLongTask } from "./hooks/useLongTask";
import { sendMessage, extractCodeBlocks, checkProxy } from "./api/claudeClient";
import { analytics } from "./api/analytics";
import {
  getWpsContext,
  onSelectionChange,
  isWpsAvailable,
  executeCode,
  executePython,
  executeShell,
  previewHtml,
  pollAddToChat,
  BlockedError,
} from "./api/wpsAdapter";
import { friendlyErrorMessage } from "./utils/errorMessages";
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
  PlanStep,
  ActivityEvent,
} from "./types";
import styles from "./App.module.css";

const PLAN_STEP_RE = /^(?:\d+)[.)]\s+(.+)$/;

function parsePlanSteps(text: string, mode: string): PlanStep[] | undefined {
  if (mode !== "plan") return undefined;
  const lines = text.split("\n");
  const steps: PlanStep[] = [];
  let idx = 1;
  for (const line of lines) {
    const m = PLAN_STEP_RE.exec(line.trim());
    if (m) {
      steps.push({ index: idx++, text: m[1].trim(), done: false });
    }
  }
  return steps.length >= 2 ? steps : undefined;
}

export default function App() {
  const { theme, cycleTheme } = useTheme();
  const onboardingStatus = useOnboardingStatus();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const agentMgr = useAgentManager();
  const {
    agents,
    activeAgentId,
    activeAgent,
    createNewAgent,
    switchAgent,
    removeAgent,
    updateActiveMessages,
    updateAgentMessages,
    setActiveStatus,
    setAgentStatus,
    setActiveName,
    setActiveMode,
    setActiveModel,
    setActiveAgentRef,
    createAbortController,
    abortAgent,
    canStartRequest,
    pruneIdleAgents,
    limits,
  } = agentMgr;

  const messages = activeAgent.messages;
  const currentMode = activeAgent.mode;
  const selectedModel = activeAgent.model;

  const longTask = useLongTask();
  const [teamTask, setTeamTask] = useState<{
    id: string;
    goal: string;
    status: "planning" | "running" | "done" | "failed";
    error?: string;
    subtasks: Array<{
      id: string;
      agent: string;
      agentColor: string;
      description: string;
      status: "pending" | "running" | "done" | "failed";
      result?: string;
    }>;
  } | null>(null);

  const [input, setInput] = useState("");
  const [wpsCtx, setWpsCtx] = useState<WpsContext | null>(null);
  const [proxyMissing, setProxyMissing] = useState(false);
  const [heartbeatOk, setHeartbeatOk] = useState<boolean | null>(null);
  const [applyingMsgId, setApplyingMsgId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachmentFile[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem("wps-claude-webSearch");
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [pinnedSelection, setPinnedSelection] = useState<{
    label: string;
    address: string;
    sheetName: string;
    rowCount: number;
    colCount: number;
  } | null>(null);

  const [slashPopup, setSlashPopup] = useState<{
    visible: boolean;
    filter: string;
  }>({ visible: false, filter: "" });
  const [atPopup, setAtPopup] = useState<{
    visible: boolean;
    filter: string;
  }>({ visible: false, filter: "" });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [agentListOpen, setAgentListOpen] = useState(true);

  const SIDEBAR_MIN = 140;
  const SIDEBAR_MAX = 360;
  const SIDEBAR_DEFAULT = 200;

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("wps-sidebar-width");
      if (saved) {
        const v = parseInt(saved, 10);
        if (v >= SIDEBAR_MIN && v <= SIDEBAR_MAX) return v;
      }
    } catch {
      /* ignore */
    }
    return SIDEBAR_DEFAULT;
  });

  const sidebarDragRef = useRef<{ startX: number; startW: number } | null>(
    null,
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragRef.current = {
      startX: e.clientX,
      startW: sidebarWidthRef.current,
    };
    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const delta = ev.clientX - sidebarDragRef.current.startX;
      const next = Math.max(
        SIDEBAR_MIN,
        Math.min(SIDEBAR_MAX, sidebarDragRef.current.startW + delta),
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      try {
        localStorage.setItem(
          "wps-sidebar-width",
          String(sidebarWidthRef.current),
        );
      } catch {
        /* ignore */
      }
      sidebarDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const loading = activeAgent.status === "running";

  const [inputBoxHeight, setInputBoxHeight] = useState(148);
  const lastSentInputRef = useRef<string>("");
  const autoContinueRoundRef = useRef(0);
  const maxAutoContinueRef = useRef(3);
  const autoRetryCountRef = useRef(0);
  const MAX_AUTO_CONTINUE_HARD_CAP = 8;
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const _lastProxyPasteTs = useRef(0);
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

  // v2.2.0: Onboarding detection
  useEffect(() => {
    if (onboardingStatus.loaded && !onboardingStatus.onboarded) {
      setShowOnboarding(true);
    }
  }, [onboardingStatus.loaded, onboardingStatus.onboarded]);

  // v2.2.0 心跳状态轮询（15s 一次，通过 /health/v2）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const PROXY_BASE = "http://127.0.0.1:3001";

    const poll = async () => {
      if (stopped) return;
      try {
        const resp = await fetch(`${PROXY_BASE}/health/v2`, {
          signal: AbortSignal.timeout(3000),
        });
        setHeartbeatOk(resp.ok);
      } catch {
        setHeartbeatOk(false);
      }
      timer = setTimeout(poll, 15_000);
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

  // 启动时恢复会话：优先使用 localStorage（已由 useAgentManager 自动加载）
  // 只有 localStorage 无数据时才从服务器拉取最新会话（兜底）
  useEffect(() => {
    const restoreLastSession = async () => {
      try {
        // 若 localStorage 已有有效 agent 数据则跳过，避免覆盖多 agent 状态
        const hasLocalData = agents.some(
          (a) =>
            a.messages.filter((m) => !m.id.startsWith("welcome")).length > 0,
        );
        if (hasLocalData) return;

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

  // 自动滚动：新用户消息 → 滚动到该消息位置（顶部对齐）；流式响应 → 滚动到底部
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const isStreaming = messages.some((m) => m.isStreaming);
    const lastUserMsg = [...messages]
      .reverse()
      .find((m) => m.role === "user" && !m.isAutoContinue);
    const msgCountGrew = messages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (isStreaming) {
      const container = bottomRef.current?.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
    } else if (msgCountGrew && lastUserMsg) {
      const el = document.querySelector(`[data-msg-id="${lastUserMsg.id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
      const MANUAL_LANGS = [
        "python",
        "py",
        "bash",
        "shell",
        "sh",
        "zsh",
        "terminal",
      ];
      const msg = messagesRef.current.find((m) => m.id === msgId);
      const block = msg?.codeBlocks?.find((b) => b.id === blockId);
      const lang = (block?.language || "").toLowerCase();
      const isManualLang = MANUAL_LANGS.includes(lang);

      updateActiveMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedBlocks = m.codeBlocks?.map((b) =>
            b.id === blockId
              ? { ...b, executed: true, result, error, diff }
              : b,
          );
          const isLocalJson =
            block?.language?.toLowerCase() === "json" &&
            block?.code?.trim().startsWith('{"_action"');
          let extraActivity: ActivityEvent | null = null;
          if (isLocalJson && !error) {
            try {
              const parsed = JSON.parse(block!.code);
              extraActivity = {
                action: "local_action",
                name: parsed._action || "local",
                timestamp: Date.now(),
              };
            } catch {}
          }
          return {
            ...m,
            codeBlocks: updatedBlocks,
            activities: extraActivity
              ? [...(m.activities ?? []), extraActivity]
              : m.activities,
          };
        }),
      );

      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "eab716",
          },
          body: JSON.stringify({
            sessionId: "eab716",
            location: "App.tsx:handleCodeExecuted",
            message: "code executed callback",
            data: {
              msgId,
              blockId,
              lang,
              isManualLang,
              hasError: !!error,
              hasResult: !!result,
              resultLen: result?.length,
              currentMode,
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion

      if (!error && result && isManualLang && currentMode === "agent") {
        // #region agent log
        fetch(
          "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "eab716",
            },
            body: JSON.stringify({
              sessionId: "eab716",
              location: "App.tsx:handleCodeExecuted:autoContinue",
              message: "triggering auto-continue for manual lang",
              data: { lang, currentMode, resultPreview: result?.slice(0, 200) },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
        setTimeout(async () => {
          const originalUserMsg =
            messagesRef.current.find(
              (m) => m.role === "user" && !m.isAutoContinue,
            )?.content || "";
          let sheetList = "";
          try {
            const freshCtx = await getWpsContext();
            if (freshCtx?.sheetNames?.length) {
              sheetList = freshCtx.sheetNames.join(", ");
            }
          } catch {}
          const displayText = `[${lang} 执行结果]\n${result.slice(0, 300)}${result.length > 300 ? "..." : ""}`;
          const promptText =
            `[${lang} 执行结果]\n${result}\n\n` +
            `原始任务: ${originalUserMsg}\n` +
            (sheetList ? `当前工作簿的 Sheet: ${sheetList}\n` : "") +
            `上一步代码已成功执行，获取到了数据。请将数据写入 Excel 表格：\n` +
            `- 生成 javascript 代码（WPS ET API），把数据填充到工作表\n` +
            `- 包含表头和格式化（列宽、对齐等）\n` +
            `- 使用 Application.ActiveWorkbook 和合适的 Sheet\n` +
            `- 如果数据量大，分批写入避免超时`;
          // #region agent log
          fetch(
            "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Debug-Session-Id": "eab716",
              },
              body: JSON.stringify({
                sessionId: "eab716",
                location: "App.tsx:handleCodeExecuted:sendingPrompt",
                message: "sending auto-continue prompt",
                data: {
                  promptLen: promptText.length,
                  displayText: displayText.slice(0, 100),
                },
                timestamp: Date.now(),
              }),
            },
          ).catch(() => {});
          // #endregion
          handleSendRef.current(promptText, true, displayText);
        }, 100);
      }
    },
    [updateActiveMessages, currentMode],
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
          const lang = (block.language || "javascript").toLowerCase();
          const isShell = ["bash", "shell", "sh", "zsh", "terminal"].includes(
            lang,
          );
          let execResult: {
            result: string;
            diff?: import("./types").DiffResult | null;
          };
          if (lang === "python" || lang === "py") {
            execResult = await executePython(block.code);
          } else if (isShell) {
            execResult = await executeShell(block.code);
          } else if (lang === "html" || lang === "htm") {
            execResult = await previewHtml(block.code);
          } else {
            execResult = await executeCode(block.code, activeAgentId);
          }
          const { result, diff } = execResult;
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

  const handleSendRef = useRef<
    (
      text?: string,
      autoContinue?: boolean,
      displayOverride?: string,
      isStepExecution?: boolean,
    ) => Promise<void>
  >(
    null as unknown as (
      text?: string,
      autoContinue?: boolean,
      displayOverride?: string,
      isStepExecution?: boolean,
    ) => Promise<void>,
  );

  const loadingRef = useRef(loading);
  loadingRef.current = loading;

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

  const [selectionDismissed, setSelectionDismissed] = useState(false);
  const prevSelKeyRef = useRef("");

  useEffect(() => {
    if (!wpsCtx?.selection) {
      prevSelKeyRef.current = "";
      return;
    }
    const key = `${wpsCtx.selection.sheetName}!${wpsCtx.selection.address}`;
    if (key !== prevSelKeyRef.current) {
      prevSelKeyRef.current = key;
      setSelectionDismissed(false);
    }
  }, [wpsCtx?.selection]);

  const handleDismissSelection = useCallback(() => {
    setSelectionDismissed(true);
    setPinnedSelection(null);
  }, []);

  const handlePinSelection = useCallback(() => {
    if (!wpsCtx?.selection) return;
    const sel = wpsCtx.selection;
    setSelectionDismissed(false);
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
      analytics.modeChange(activeAgent?.mode ?? "unknown", mode);
      setActiveMode(mode);
    },
    [setActiveMode, activeAgent],
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
      const val = e.target.value;
      if (val.length > MAX_INPUT_LENGTH) return;
      setInput(val);

      const showSlash = val.startsWith("/") && !val.includes(" ");
      const atMatch = val.match(/@(\S*)$/);
      const showAt = !!(atMatch && val.endsWith(atMatch[0]));

      if (showAt) {
        setAtPopup({ visible: true, filter: atMatch![1] });
        setSlashPopup({ visible: false, filter: "" });
      } else if (showSlash) {
        setSlashPopup({
          visible: true,
          filter: val === "/" ? "" : val.slice(1),
        });
        setAtPopup({ visible: false, filter: "" });
      } else {
        setSlashPopup({ visible: false, filter: "" });
        setAtPopup({ visible: false, filter: "" });
      }
    },
    [],
  );

  const handleQuickAction = useCallback((prompt: string) => {
    handleSendRef.current(prompt);
  }, []);

  const handleToggleWebSearch = useCallback(() => {
    setWebSearchEnabled((v) => {
      const next = !v;
      try {
        localStorage.setItem("wps-claude-webSearch", String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleSendClick = useCallback(() => {
    handleSendRef.current();
  }, []);

  /** 点击历史用户消息重新提交：截断该消息之后的所有消息，然后重发 */
  const handleResubmit = useCallback(
    (msgId: string, content: string) => {
      if (loading) return;
      updateActiveMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msgId);
        if (idx < 0) return prev;
        // 保留该 user 消息之前的所有消息（不含本条）
        return prev.slice(0, idx);
      });
      // 用截断后的上下文重新发送
      setTimeout(() => handleSendRef.current(content), 0);
    },
    [loading, updateActiveMessages],
  );

  const handleOpenHistory = useCallback(() => {
    setHistoryOpen(true);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  const handleNewChat = useCallback(() => {
    pruneIdleAgents();
    createNewAgent();
    setApplyingMsgId(null);
    setPinnedSelection(null);
    setAttachedFiles([]);
  }, [createNewAgent, pruneIdleAgents]);

  const handleSwitchAgent = useCallback(
    (targetId: string) => {
      // #region agent log
      const streamingAgent = agents.find((a) =>
        a.messages.some((m) => m.isStreaming),
      );
      if (streamingAgent) {
        const streamingMsg = streamingAgent.messages.find((m) => m.isStreaming);
        fetch(
          "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "f532b6",
            },
            body: JSON.stringify({
              sessionId: "f532b6",
              location: "App.tsx:handleSwitchAgent",
              message: "switching during stream",
              hypothesisId: "B",
              data: {
                fromAgentId: activeAgentId,
                toAgentId: targetId,
                streamingAgentId: streamingAgent.id,
                hasThinkingContent: !!streamingMsg?.thinkingContent,
                thinkingLen: streamingMsg?.thinkingContent?.length ?? 0,
                isStreaming: streamingMsg?.isStreaming,
              },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
      }
      // #endregion
      switchAgent(targetId);
    },
    [agents, activeAgentId, switchAgent],
  );

  const handleSwitchToAgent = useCallback(() => {
    setActiveMode("agent");
  }, [setActiveMode]);

  const handlePlanStepsChange = useCallback(
    (msgId: string, steps: PlanStep[]) => {
      updateActiveMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, planSteps: steps } : m)),
      );
    },
    [updateActiveMessages],
  );

  const planStepQueueRef = useRef<{
    msgId: string;
    steps: PlanStep[];
    idx: number;
  } | null>(null);

  const handleExecuteStep = useCallback(
    async (msgId: string, stepIndex: number) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg?.planSteps) return;
      const step = msg.planSteps.find((s) => s.index === stepIndex);
      if (!step || step.status === "running") return;

      updateActiveMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                planSteps: m.planSteps?.map((s) =>
                  s.index === stepIndex
                    ? { ...s, status: "running" as const }
                    : s,
                ),
              }
            : m,
        ),
      );

      const totalSteps = msg.planSteps.length;
      const prevResults = (msg.planSteps || [])
        .filter((s) => s.status === "success" && s.result)
        .map((s) => `步骤 ${s.index} 结果: ${s.result}`)
        .join("\n");

      let sheetList = "";
      try {
        const freshCtx = await getWpsContext();
        if (freshCtx?.sheetNames?.length) {
          sheetList = freshCtx.sheetNames.join(", ");
        }
      } catch {}

      const originalTask =
        messagesRef.current.find(
          (m) => m.role === "user" && !m.isAutoContinue && !m.isStepExecution,
        )?.content || "";

      const contextLines: string[] = [];
      if (prevResults) contextLines.push(`[前序步骤结果]\n${prevResults}`);
      if (sheetList)
        contextLines.push(`当前工作簿的 Sheet: ${sheetList}`);
      if (originalTask) contextLines.push(`原始任务: ${originalTask}`);

      const contextPrefix =
        contextLines.length > 0 ? contextLines.join("\n") + "\n\n" : "";

      setActiveMode("agent");
      handleSend(
        `${contextPrefix}请执行以下步骤（仅这一步）：\n\n${step.text}\n\n请联网搜索获取最新信息（如果涉及公司/股票/财务数据），然后生成可执行的代码。要求：\n- 如果联网搜索超时或失败，直接使用行业合理估计值，不要反复重试搜索\n- 数值参数使用蓝色字体，方便分析师后续调整\n- 完成后简要说明结果。`,
        true,
        `▶ 执行步骤 ${stepIndex}/${totalSteps}: ${step.text}`,
        true,
      );
    },
    [messages, updateActiveMessages, setActiveMode],
  );

  const handleSkipStep = useCallback(
    (msgId: string, stepIndex: number) => {
      updateActiveMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                planSteps: m.planSteps?.map((s) =>
                  s.index === stepIndex
                    ? { ...s, status: "skipped" as const }
                    : s,
                ),
              }
            : m,
        ),
      );
    },
    [updateActiveMessages],
  );

  const handleConfirmPlan = useCallback(
    (msgId: string, steps: PlanStep[]) => {
      const pending = steps.filter((s) => !s.status || s.status === "pending");
      if (pending.length === 0) return;

      planStepQueueRef.current = { msgId, steps, idx: 0 };
      handleExecuteStep(msgId, pending[0].index);
    },
    [handleExecuteStep],
  );

  const handleSend = async (
    text?: string,
    _autoContinue?: boolean,
    _displayOverride?: string,
    _isStepExecution?: boolean,
  ) => {
    const userText = (text ?? input).trim();
    if (!userText || (loading && !_autoContinue)) return;

    // #region debug command
    if (userText === "/debug-storage") {
      setInput("");
      try {
        const storageKey = "wps-claude-agents-v2";
        const raw = localStorage.getItem(storageKey);
        const persistDebug = localStorage.getItem("wps-claude-persist-debug");
        const loadDebug = localStorage.getItem("wps-claude-load-debug");
        const pd = persistDebug ? JSON.parse(persistDebug) : null;
        const ld = loadDebug ? JSON.parse(loadDebug) : null;
        const agentCount = raw ? (JSON.parse(raw)?.agents?.length ?? 0) : 0;
        const info = [
          `📦 存储调试报告`,
          `主存储: ${raw ? `${raw.length} 字节, ${agentCount} 个对话` : "❌ 无数据"}`,
          `上次保存: ${pd ? `${new Date(pd.ts).toLocaleTimeString()} | ${pd.agentCount} 个对话 | ${pd.payloadBytes} 字节${pd.fallback ? " ⚠️ 降级保存(只保存当前)" : ""}` : "无记录"}`,
          `上次加载: ${ld ? `${new Date(ld.ts).toLocaleTimeString()} | 找到数据: ${ld.found} | ${ld.rawBytes} 字节` : "无记录"}`,
        ].join("\n");
        updateActiveMessages((prev) => [
          ...prev,
          {
            id: `dbg-${Date.now()}`,
            role: "user" as const,
            content: "/debug-storage",
            timestamp: Date.now(),
          },
          {
            id: `dbg-r-${Date.now()}`,
            role: "assistant" as const,
            content: info,
            timestamp: Date.now(),
          },
        ]);
      } catch (e) {
        updateActiveMessages((prev) => [
          ...prev,
          {
            id: `dbg-err-${Date.now()}`,
            role: "assistant" as const,
            content: `调试出错: ${e}`,
            timestamp: Date.now(),
          },
        ]);
      }
      return;
    }
    // #endregion debug command

    // ── 斜杠命令: /workflow <name> [inputs] ──
    const workflowMatch = userText.match(/^\/workflow\s+(\S+)(?:\s+(.*))?$/i);
    if (workflowMatch) {
      setInput("");
      const wfName = workflowMatch[1];
      const wfInputsRaw = workflowMatch[2];
      let wfInputs: Record<string, unknown> = {};
      try {
        if (wfInputsRaw) wfInputs = JSON.parse(wfInputsRaw);
      } catch {}
      updateActiveMessages((prev) => [
        ...prev,
        {
          id: nanoid(),
          role: "user",
          content: userText,
          timestamp: Date.now(),
        },
        {
          id: nanoid(),
          role: "assistant",
          content: `⏳ 正在启动工作流 **${wfName}**...`,
          timestamp: Date.now(),
        },
      ]);
      try {
        await longTask.startWorkflow(
          `skills/workflows/${wfName}/workflow.yaml`,
          wfInputs,
        );
      } catch (err) {
        updateActiveMessages((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: "assistant",
            content: `**提示**：工作流启动失败 — ${friendlyErrorMessage(err instanceof Error ? err.message : String(err))}`,
            timestamp: Date.now(),
            isError: true,
          },
        ]);
      }
      return;
    }

    // ── 斜杠命令: /team <goal> ──
    const teamMatch = userText.match(/^\/team\s+(.+)$/i);
    if (teamMatch) {
      setInput("");
      const goal = teamMatch[1].trim();
      updateActiveMessages((prev) => [
        ...prev,
        {
          id: nanoid(),
          role: "user",
          content: userText,
          timestamp: Date.now(),
        },
      ]);
      try {
        const resp = await fetch("http://127.0.0.1:3001/v3/team/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, context: wpsCtx }),
        });
        const data = await resp.json();
        if (data.ok && data.team) {
          setTeamTask(data.team);
        } else {
          throw new Error(data.error || "启动失败");
        }
      } catch (err) {
        updateActiveMessages((prev) => [
          ...prev,
          {
            id: nanoid(),
            role: "assistant",
            content: `**提示**：团队启动失败 — ${friendlyErrorMessage(err instanceof Error ? err.message : String(err))}`,
            timestamp: Date.now(),
            isError: true,
          },
        ]);
      }
      return;
    }

    // ── 斜杠命令: /help ──
    if (userText === "/help") {
      setInput("");
      updateActiveMessages((prev) => [
        ...prev,
        { id: nanoid(), role: "user", content: "/help", timestamp: Date.now() },
        {
          id: nanoid(),
          role: "assistant",
          content: [
            "## 可用命令",
            "",
            "| 命令 | 说明 |",
            "|------|------|",
            "| `/team <目标>` | 组建 Agent 团队协作完成复杂任务 |",
            "| `/workflow <名称>` | 启动预定义工作流（如 monthly-report） |",
            "| `/help` | 显示此帮助信息 |",
            "",
            "**示例:**",
            "- `/team 分析这份销售数据，清洗后做可视化报告`",
            "- `/workflow monthly-report`",
            "",
            "💡 **提示**: 发送复杂请求时，AI 会自动建议使用团队模式。",
          ].join("\n"),
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    if (!_autoContinue) {
      autoContinueRoundRef.current = 0;
      autoRetryCountRef.current = 0;
      const COMPLEX_TASK =
        /dcf|估值|建模|财务模型|完整.*模型|多.*sheet|多.*表|分析.*报告|全面|comprehensive/i;
      const MEDIUM_TASK = /图表|chart|可视化|dashboard|仪表盘|对比.*分析|趋势/i;
      const TEAM_SUGGEST =
        /清洗.*可视化|分析.*报告.*图表|多步.*流程|数据.*清洗.*分析|全面.*报告|整理.*分析.*汇报/i;
      if (COMPLEX_TASK.test(userText)) {
        maxAutoContinueRef.current = MAX_AUTO_CONTINUE_HARD_CAP;
      } else if (MEDIUM_TASK.test(userText)) {
        maxAutoContinueRef.current = 4;
      } else {
        maxAutoContinueRef.current = 2;
      }

      if (TEAM_SUGGEST.test(userText) && !teamTask) {
        updateActiveMessages((prev) => [
          ...prev,
          {
            id: `team-hint-${Date.now()}`,
            role: "assistant",
            content:
              "💡 **提示**: 这个任务涉及多个专业领域。你可以使用 `/team " +
              userText.slice(0, 50) +
              "` 来让多个专业 Agent 协作完成，效果更好。\n\n当前会继续以单 Agent 模式执行。",
            timestamp: Date.now(),
          },
        ]);
      }
    }

    if (!canStartRequest()) {
      updateActiveMessages((prev) => [
        ...prev,
        {
          id: nanoid(),
          role: "assistant",
          content: `**提示**：当前已有 ${limits.maxConcurrent} 个 Agent 正在并行运行，请等待其中一个完成后再发送。`,
          timestamp: Date.now(),
          isError: true,
        },
      ]);
      return;
    }

    const agentId = activeAgentId;
    const currentAttachments = [...attachedFiles];
    const currentPinned = pinnedSelection;
    lastSentInputRef.current = userText;
    setInput("");
    setAttachedFiles([]);
    setPinnedSelection(null);

    let displayContent = _displayOverride || userText;
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
      isAutoContinue: !!_autoContinue,
      isStepExecution: !!_isStepExecution,
    };

    const assistantMsgId = nanoid();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };

    updateAgentMessages(agentId, (prev) => [...prev, userMsg, assistantMsg]);
    setAgentStatus(agentId, "running");

    const controller = createAbortController(agentId);

    let fullText = "";
    let thinkingText = "";
    const thinkingStart = Date.now();
    let firstTokenReceived = false;
    let aborted = false;

    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });

    const modeSnapshot = currentMode;
    const modelSnapshot = selectedModel;

    analytics.chatSend(modeSnapshot, modelSnapshot);

    let liveCtx = wpsCtx ?? {
      workbookName: "",
      sheetNames: [],
      selection: null,
    };
    try {
      const fresh = await getWpsContext();
      if (fresh?.sheetNames?.length) {
        liveCtx = fresh;
        setWpsCtx(fresh);
      }
    } catch {}

    try {
      await sendMessage(
        userText,
        messages.filter((m) => !m.id.startsWith("welcome")),
        liveCtx,
        {
          onThinking: (text) => {
            if (aborted) return;
            thinkingText += text;
            // #region agent log
            fetch(
              "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "34f850",
                },
                body: JSON.stringify({
                  sessionId: "34f850",
                  location: "App.tsx:onThinking",
                  message: "onThinking callback fired",
                  data: {
                    chunkLen: text.length,
                    totalLen: thinkingText.length,
                    agentId,
                    msgId: assistantMsgId,
                  },
                  timestamp: Date.now(),
                  hypothesisId: "H-THINK",
                }),
              },
            ).catch(() => {});
            // #endregion
            updateAgentMessages(agentId, (prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, thinkingContent: thinkingText }
                  : m,
              ),
            );
          },
          onToken: (token) => {
            // #region agent log
            if (!firstTokenReceived) {
              fetch(
                "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Debug-Session-Id": "eab716",
                  },
                  body: JSON.stringify({
                    sessionId: "eab716",
                    location: "App.tsx:onToken",
                    message: "First token received",
                    data: { tokenLen: token.length, aborted },
                    timestamp: Date.now(),
                  }),
                },
              ).catch(() => {});
            }
            // #endregion
            if (aborted) return;
            fullText += token;
            const updates: Partial<ChatMessage> = { content: fullText };
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              updates.thinkingMs = Date.now() - thinkingStart;
              setProxyMissing(false);
            }
            updateAgentMessages(agentId, (prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, ...updates } : m,
              ),
            );
          },
          onActivity: (activity: ActivityEvent) => {
            if (aborted) return;
            updateAgentMessages(agentId, (prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, activities: [...(m.activities ?? []), activity] }
                  : m,
              ),
            );
          },
          onAgentInfo: (info) => {
            if (aborted) return;
            setActiveAgentRef(info.name, info.color);
          },
          onPlanCreated: (steps, originalTask) => {
            if (aborted) return;
            const planSteps = steps.map((s) => ({
              ...s,
              status: "pending" as const,
            }));
            updateAgentMessages(agentId, (prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      planSteps,
                      content:
                        m.content ||
                        `正在为以下任务制定执行计划...\n\n> ${originalTask}`,
                    }
                  : m,
              ),
            );
          },
          onComplete: async (text, provenance, flags) => {
            // #region agent log
            fetch(
              "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "eab716",
                },
                body: JSON.stringify({
                  sessionId: "eab716",
                  location: "App.tsx:onComplete",
                  message: "onComplete called",
                  data: {
                    textLen: text?.length || 0,
                    aborted,
                    hasProvenance: !!provenance,
                  },
                  timestamp: Date.now(),
                }),
              },
            ).catch(() => {});
            // #endregion
            if (aborted) return;
            const tokenLimitHit = flags?.tokenLimitHit ?? false;
            const prov = provenance
              ? {
                  mode: String(provenance.mode || ""),
                  model: String(provenance.model || ""),
                  skillsLoaded: Array.isArray(provenance.skillsLoaded)
                    ? (provenance.skillsLoaded as string[])
                    : [],
                  promptSummary: String(provenance.promptSummary || ""),
                  timestamp: Number(provenance.timestamp) || Date.now(),
                }
              : undefined;
            if (modeSnapshot === "ask") {
              const strippedText = text.replace(
                /```[\w]*\n[\s\S]*?```/g,
                "_(此处为代码操作，请切换至 Agent 模式执行)_",
              );

              const hadCode = strippedText !== text;
              const ACTION_HINTS =
                /切换.{0,4}Agent|switch.{0,6}agent|需要执行|需要操作|建议.{0,4}Agent/i;
              const suggestSwitch = hadCode || ACTION_HINTS.test(text);

              updateAgentMessages(agentId, (prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: strippedText,
                        isStreaming: false,
                        codeBlocks: [],
                        suggestAgentSwitch: suggestSwitch,
                        provenance: prov,
                      }
                    : m,
                ),
              );
              setAgentStatus(agentId, "done");
              return;
            }

            const rawBlocks = extractCodeBlocks(text);
            const codeBlocks: CodeBlock[] = rawBlocks.map((b) => ({
              id: nanoid(),
              language: b.language,
              code: b.code,
            }));

            const planSteps = parsePlanSteps(text, modeSnapshot);

            updateAgentMessages(agentId, (prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: text,
                      isStreaming: false,
                      codeBlocks,
                      planSteps: planSteps ?? m.planSteps,
                      provenance: prov,
                    }
                  : m,
              ),
            );

            const shouldAutoExecute = modeSnapshot === "agent";

            if (
              !planStepQueueRef.current &&
              tokenLimitHit &&
              codeBlocks.length === 0 &&
              shouldAutoExecute &&
              !aborted &&
              autoContinueRoundRef.current < maxAutoContinueRef.current
            ) {
              autoContinueRoundRef.current++;
              const round = autoContinueRoundRef.current;
              const originalUserMsg =
                messagesRef.current.find(
                  (m) => m.role === "user" && !m.isAutoContinue,
                )?.content || "";
              setAgentStatus(agentId, "idle");
              await handleSend(
                `[输出被截断 ${round}/${maxAutoContinueRef.current}] 你的回复超出了 token 限制被截断了。\n原始任务: ${originalUserMsg}\n请从断点继续，每次只输出 1 个代码块。`,
                true,
                `[输出被截断] 自动从断点继续...`,
              );
              return;
            }

            // 只自动执行 JS 和 JSON action；Shell/Python/HTML 需要用户手动确认
            const CONFIRM_LANGS = [
              "bash",
              "shell",
              "sh",
              "zsh",
              "terminal",
              "python",
              "py",
              "html",
              "htm",
            ];
            const execBlocks = codeBlocks.filter((b) => {
              const lang = (b.language || "").toLowerCase();
              if (CONFIRM_LANGS.includes(lang)) return false;
              if (lang === "json" && !b.code.trim().startsWith('{"_action"'))
                return false;
              return true;
            });

            if (shouldAutoExecute && execBlocks.length > 0) {
              setApplyingMsgId(assistantMsgId);
              const execResults: string[] = [];
              let execFailed = false;
              for (let _bi = 0; _bi < execBlocks.length; _bi++) {
                const block = execBlocks[_bi];
                try {
                  let execResult: {
                    result: string;
                    diff?: import("./types").DiffResult | null;
                  };
                  try {
                    execResult = await executeCode(block.code, agentId);
                  } catch (firstErr) {
                    // #region agent log
                    fetch(
                      "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "X-Debug-Session-Id": "f532b6",
                        },
                        body: JSON.stringify({
                          sessionId: "f532b6",
                          location: "App.tsx:catch-first",
                          message: "caught error from executeCode",
                          data: {
                            errName: (firstErr as Error)?.name,
                            errMsg: (firstErr as Error)?.message,
                            isBlockedError: firstErr instanceof BlockedError,
                          },
                          timestamp: Date.now(),
                        }),
                      },
                    ).catch(() => {});
                    // #endregion
                    if (firstErr instanceof BlockedError) {
                      // #region agent log
                      fetch(
                        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "X-Debug-Session-Id": "f532b6",
                          },
                          body: JSON.stringify({
                            sessionId: "f532b6",
                            location: "App.tsx:retry-force",
                            message: "Retrying with force=true",
                            data: { agentId },
                            timestamp: Date.now(),
                          }),
                        },
                      ).catch(() => {});
                      // #endregion
                      execResult = await executeCode(block.code, agentId, true);
                    } else {
                      throw firstErr;
                    }
                  }
                  const { result, diff } = execResult;
                  execResults.push(
                    `[OK] ${result || "执行成功"}` +
                      (diff?.changeCount
                        ? ` (修改了 ${diff.changeCount} 个单元格)`
                        : ""),
                  );
                  updateAgentMessages(agentId, (prev) =>
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
                  // #region agent log
                  fetch(
                    "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "X-Debug-Session-Id": "eab716",
                      },
                      body: JSON.stringify({
                        sessionId: "eab716",
                        location: "App.tsx:autoExec:error",
                        message: "Auto-exec JS failed",
                        data: {
                          errorMsg,
                          blockLang: block.language,
                          codeHead: block.code?.substring(0, 120),
                        },
                        timestamp: Date.now(),
                      }),
                    },
                  ).catch(() => {});
                  // #endregion
                  execResults.push(`[ERR] 执行失败: ${errorMsg}`);
                  execFailed = true;
                  updateAgentMessages(agentId, (prev) =>
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

              // 计划步骤模式下跳过 autoContinue，由步骤队列统一推进
              const inPlanStepMode = !!planStepQueueRef.current;

              if (
                !inPlanStepMode &&
                !execFailed &&
                !aborted &&
                autoContinueRoundRef.current < maxAutoContinueRef.current
              ) {
                autoContinueRoundRef.current++;
                const round = autoContinueRoundRef.current;
                const maxRound = maxAutoContinueRef.current;
                const originalUserMsg =
                  messagesRef.current.find(
                    (m) => m.role === "user" && !m.isAutoContinue,
                  )?.content || "";
                let sheetList = wpsCtx?.sheetNames?.join(", ") || "";
                try {
                  const freshCtx = await getWpsContext();
                  if (freshCtx?.sheetNames?.length) {
                    sheetList = freshCtx.sheetNames.join(", ");
                  }
                } catch {}
                const displayText = `[执行结果]\n${execResults.join("\n")}`;
                const promptText =
                  `[执行结果 ${round}/${maxRound}]\n${execResults.join("\n")}\n\n` +
                  `原始任务: ${originalUserMsg}\n` +
                  (sheetList ? `当前工作簿的 Sheet: ${sheetList}\n` : "") +
                  `上一步已成功执行。请判断原始任务是否已经完成：\n` +
                  `- 如果任务已完成，直接给出简短总结（不要输出代码块）\n` +
                  `- 如果还有必要的后续步骤，继续下一步（输出 1 个代码块）\n` +
                  `引用 Sheet 时必须使用上面列出的准确表名。`;
                setAgentStatus(agentId, "idle");
                await handleSend(promptText, true, displayText);
                return;
              }
              if (execFailed) {
                const retryRound = (autoRetryCountRef.current ?? 0) + 1;
                const MAX_AUTO_RETRY = 2;
                if (retryRound <= MAX_AUTO_RETRY) {
                  autoRetryCountRef.current = retryRound;
                  const failedBlock = execBlocks.find(
                    (b) => execResults.some((r) => r.startsWith("[ERR]")) && b,
                  );
                  const failedError =
                    execResults
                      .find((r) => r.startsWith("[ERR]"))
                      ?.replace("[ERR] 执行失败: ", "") || "未知错误";
                  const codeSnippet =
                    failedBlock?.code?.substring(0, 600) || "";
                  // #region agent log
                  fetch(
                    "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "X-Debug-Session-Id": "eab716",
                      },
                      body: JSON.stringify({
                        sessionId: "eab716",
                        location: "App.tsx:autoRetry",
                        message: "Auto-retrying after exec failure",
                        data: {
                          retryRound,
                          failedError,
                          codeLen: codeSnippet.length,
                        },
                        timestamp: Date.now(),
                      }),
                    },
                  ).catch(() => {});
                  // #endregion
                  const retryPrompt =
                    `代码执行出错（自动重试 ${retryRound}/${MAX_AUTO_RETRY}），请修复并重新生成完整代码。\n\n` +
                    `**错误信息：**\n\`\`\`\n${failedError}\n\`\`\`\n\n` +
                    `**失败代码片段：**\n\`\`\`javascript\n${codeSnippet}\n\`\`\`\n\n` +
                    `请分析错误原因，直接输出修复后的完整 JavaScript 代码块。严格要求：\n` +
                    `- 代码块内只能有合法 JavaScript，绝对不能混入中文说明、数字标注或注释性文字\n` +
                    `- 外部API数据需做防御性检查（判断返回值是否 undefined）\n` +
                    `- 使用 try/catch 包裹可能出错的操作\n` +
                    `- 不要假设 API 返回固定结构\n` +
                    `- 文字说明放在代码块外面，代码块内只有纯代码`;
                  setAgentStatus(agentId, "idle");
                  await handleSend(
                    retryPrompt,
                    true,
                    `[自动修复 ${retryRound}/${MAX_AUTO_RETRY}] ${failedError}`,
                  );
                  return;
                }
                autoRetryCountRef.current = 0;
                const failQueue = planStepQueueRef.current;
                if (failQueue) {
                  const failPending = failQueue.steps.filter(
                    (s) => !s.status || s.status === "pending",
                  );
                  const failCurrent = failPending[failQueue.idx];
                  if (failCurrent) {
                    const failError =
                      execResults
                        .find((r) => r.startsWith("[ERR]"))
                        ?.replace("[ERR] 执行失败: ", "") || "重试后仍然失败";
                    updateActiveMessages((prev) =>
                      prev.map((m) =>
                        m.id === failQueue.msgId
                          ? {
                              ...m,
                              planSteps: m.planSteps?.map((s) =>
                                s.index === failCurrent.index
                                  ? {
                                      ...s,
                                      status: "failed" as const,
                                      error: failError,
                                    }
                                  : s,
                              ),
                            }
                          : m,
                      ),
                    );
                  }
                  failQueue.idx++;
                  const failNext = failPending[failQueue.idx];
                  if (failNext) {
                    setAgentStatus(agentId, "idle");
                    setTimeout(() => {
                      handleExecuteStep(failQueue.msgId, failNext.index);
                    }, 1000);
                    return;
                  }
                  planStepQueueRef.current = null;
                }
                setAgentStatus(agentId, "failed");
                return;
              }
            }
            setAgentStatus(agentId, "done");

            // Plan step-by-step: 标记当前步骤完成，推进下一步
            const queue = planStepQueueRef.current;
            if (queue) {
              const pendingSteps = queue.steps.filter(
                (s) => !s.status || s.status === "pending",
              );
              const currentStep = pendingSteps[queue.idx];
              if (currentStep) {
                updateActiveMessages((prev) =>
                  prev.map((m) =>
                    m.id === queue.msgId
                      ? {
                          ...m,
                          planSteps: m.planSteps?.map((s) =>
                            s.index === currentStep.index
                              ? { ...s, status: "success" as const, done: true }
                              : s,
                          ),
                        }
                      : m,
                  ),
                );
              }

              queue.idx++;
              const nextPending = pendingSteps[queue.idx];
              if (nextPending) {
                setTimeout(() => {
                  handleExecuteStep(queue.msgId, nextPending.index);
                }, 500);
              } else {
                planStepQueueRef.current = null;
              }
            }
          },
          onError: (err) => {
            const raw = err.message || String(err);
            // #region agent log
            fetch(
              "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "abaffc",
                },
                body: JSON.stringify({
                  sessionId: "abaffc",
                  location: "App.tsx:onError",
                  message: "SSE onError triggered",
                  data: { raw, friendlyMsg: friendlyErrorMessage(raw) },
                  timestamp: Date.now(),
                }),
              },
            ).catch(() => {});
            // #endregion
            const isProxyError =
              raw.includes("fetch") ||
              raw.includes("Failed") ||
              raw.includes("代理") ||
              /ECONNREFUSED/.test(raw);
            const userMsg = isProxyError
              ? "无法连接代理服务器，请确认后台服务已启动。"
              : friendlyErrorMessage(raw);
            updateAgentMessages(agentId, (prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: `**提示**：${userMsg}`,
                      isStreaming: false,
                      isError: true,
                    }
                  : m,
              ),
            );
            setAgentStatus(agentId, isProxyError ? "failed" : "done", raw);
            if (isProxyError) setProxyMissing(true);

            const queue = planStepQueueRef.current;
            if (queue) {
              const pendingSteps = queue.steps.filter(
                (s) => !s.status || s.status === "pending",
              );
              const currentStep = pendingSteps[queue.idx];
              if (currentStep) {
                updateActiveMessages((prev) =>
                  prev.map((m) =>
                    m.id === queue.msgId
                      ? {
                          ...m,
                          planSteps: m.planSteps?.map((s) =>
                            s.index === currentStep.index
                              ? {
                                  ...s,
                                  status: "failed" as const,
                                  error: err.message,
                                }
                              : s,
                          ),
                        }
                      : m,
                  ),
                );
              }

              queue.idx++;
              const nextPending = pendingSteps[queue.idx];
              if (nextPending && !isProxyError) {
                setTimeout(() => {
                  handleExecuteStep(queue.msgId, nextPending.index);
                }, 1000);
              } else {
                planStepQueueRef.current = null;
              }
            }
          },
        },
        {
          model: modelSnapshot,
          mode: modeSnapshot,
          agentName: activeAgent.agentRef,
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
      const errStack =
        unexpectedErr instanceof Error
          ? unexpectedErr.stack?.substring(0, 300)
          : "";
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "App.tsx:unexpectedErr",
            message: "Unexpected error in handleSend",
            data: {
              errMsg,
              errStack,
              friendlyMsg: friendlyErrorMessage(errMsg),
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
      const isProxyError =
        errMsg.includes("fetch") ||
        errMsg.includes("Failed") ||
        errMsg.includes("代理") ||
        /ECONNREFUSED/.test(errMsg);
      const userMsg = isProxyError
        ? "无法连接代理服务器，请确认后台服务已启动。"
        : friendlyErrorMessage(errMsg);
      updateAgentMessages(agentId, (prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `**提示**：${userMsg}`,
                isStreaming: false,
                isError: true,
              }
            : m,
        ),
      );
      setAgentStatus(agentId, isProxyError ? "failed" : "done", errMsg);
      if (isProxyError) setProxyMissing(true);
      setApplyingMsgId(null);

      const queue = planStepQueueRef.current;
      if (queue) {
        const pendingSteps = queue.steps.filter(
          (s) => !s.status || s.status === "pending",
        );
        const currentStep = pendingSteps[queue.idx];
        if (currentStep) {
          updateActiveMessages((prev) =>
            prev.map((m) =>
              m.id === queue.msgId
                ? {
                    ...m,
                    planSteps: m.planSteps?.map((s) =>
                      s.index === currentStep.index
                        ? {
                            ...s,
                            status: "failed" as const,
                            error: errMsg,
                          }
                        : s,
                    ),
                  }
                : m,
            ),
          );
        }
        queue.idx++;
        const nextPending = pendingSteps[queue.idx];
        if (nextPending && !isProxyError) {
          setTimeout(() => {
            handleExecuteStep(queue.msgId, nextPending.index);
          }, 1000);
        } else {
          planStepQueueRef.current = null;
        }
      }
    }

    if (aborted) {
      setAgentStatus(agentId, "idle");
    }

    lastSentInputRef.current = "";
  };

  handleSendRef.current = handleSend;

  const handleStop = () => {
    abortAgent(activeAgentId);

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
    // WPS WebView: keydown preventDefault 不阻止 paste 事件，用时间戳去重
    if (Date.now() - _lastProxyPasteTs.current < 500) {
      e.preventDefault();
      return;
    }
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

  const handleSlashSelect = useCallback(
    (cmd: {
      prompt: string;
      label: string;
      isSystem?: boolean;
      inputTemplate?: string;
    }) => {
      setSlashPopup({ visible: false, filter: "" });
      if (cmd.isSystem && cmd.inputTemplate) {
        const tpl = cmd.inputTemplate;
        // /help 这类不需要补参数的命令直接执行
        if (!tpl.endsWith(" ")) {
          setInput("");
          handleSendRef.current(tpl);
        } else {
          // /team 、/workflow 等需要补参数的命令：填入输入框等用户补充
          setInput(tpl);
          requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) {
              ta.focus();
              ta.setSelectionRange(tpl.length, tpl.length);
            }
          });
        }
      } else {
        setInput("");
        handleSendRef.current(cmd.prompt);
      }
    },
    [],
  );

  const handleAtSelect = useCallback((opt: { insertText: string }) => {
    setAtPopup({ visible: false, filter: "" });
    setInput((prev) => {
      const atIdx = prev.lastIndexOf("@");
      return atIdx >= 0
        ? prev.slice(0, atIdx) + opt.insertText + " "
        : prev + opt.insertText + " ";
    });
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashPopup.visible || atPopup.visible) {
      if (["ArrowDown", "ArrowUp", "Tab"].includes(e.key)) return;
      if (e.key === "Enter" && !e.shiftKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashPopup({ visible: false, filter: "" });
        setAtPopup({ visible: false, filter: "" });
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;

    if (e.key === "v") {
      e.preventDefault();
      _lastProxyPasteTs.current = Date.now();
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

  const chatColumnRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, h: inputBoxHeightRef.current };
    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      const delta = dragStartRef.current.y - ev.clientY;
      const colH = chatColumnRef.current?.clientHeight ?? 600;
      const maxH = Math.min(400, colH * 0.45);
      const next = Math.max(
        110,
        Math.min(maxH, dragStartRef.current.h + delta),
      );
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
      {/* v2.2.0: Onboarding */}
      {showOnboarding && (
        <Onboarding
          onComplete={() => {
            setShowOnboarding(false);
          }}
        />
      )}
      {/* 顶部 Header */}
      <header className={styles.header}>
        <div className={styles.logoRow}>
          <div className={styles.logoIcon}>
            <Claude.Color size={20} />
          </div>
          <div className={styles.logoName}>Claude for Excel</div>
          <span className={styles.betaBadge}>v 2.3.0</span>
          {heartbeatOk !== null && (
            <span
              className={styles.heartbeatDot}
              style={{ background: heartbeatOk ? "var(--accent)" : "#999" }}
              title={heartbeatOk ? "服务运行正常" : "心跳检测失败"}
            />
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            className={`${styles.headerBtn} ${agentListOpen ? styles.headerBtnActive : ""}`}
            onClick={() => setAgentListOpen((v) => !v)}
            title={agentListOpen ? "收起 Agents (⌘B)" : "展开 Agents (⌘B)"}
          >
            <SidebarToggleIcon />
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleNewChat}
            title="新建 Agent"
          >
            <AddIcon />
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleOpenHistory}
            title="历史记录"
          >
            <HistoryIcon />
          </button>
          <button
            className={styles.headerBtn}
            onClick={() => setConnectorsOpen(true)}
            title="数据源管理"
          >
            <DataSourceIcon />
          </button>
          <ThemeToggle theme={theme} onCycle={cycleTheme} />
        </div>
      </header>

      {/* 主体区域：Cursor 风格左侧 Agent 侧边栏 + 右侧聊天列 */}
      <div className={styles.mainBody}>
        <AgentListPanel
          agents={agents}
          activeAgentId={activeAgentId}
          expanded={agentListOpen}
          width={sidebarWidth}
          onSwitch={handleSwitchAgent}
          onNew={handleNewChat}
          onRemove={removeAgent}
        />

        {agentListOpen && (
          <div
            className={styles.sidebarResizeHandle}
            onMouseDown={handleSidebarDragStart}
          />
        )}

        <div className={styles.chatColumn} ref={chatColumnRef}>
          {/* Tab 栏 — 仅在侧边栏收起时显示 */}
          {!agentListOpen && (
            <AgentTabBar
              agents={agents}
              activeAgentId={activeAgentId}
              onSwitch={handleSwitchAgent}
              onClose={removeAgent}
            />
          )}

          {/* 选区上下文条 */}
          {wpsCtx?.selection && (
            <div className={styles.ctxBar}>
              <TableIcon />
              <span className={styles.ctxText}>
                {wpsCtx.selection.sheetName}!{wpsCtx.selection.address}（
                {wpsCtx.selection.rowCount} 行 × {wpsCtx.selection.colCount}{" "}
                列）
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
            {(() => {
              // 找出最后一条非 autoContinue 的 user 消息 id（用于 sticky 吸顶）
              const lastUserMsgId = [...messages]
                .reverse()
                .find((m) => m.role === "user" && !m.isAutoContinue)?.id;
              return messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onCodeExecuted={handleCodeExecuted}
                  onApplyCode={handleApplyCode}
                  onRetryFix={handleRetryFix}
                  isApplying={applyingMsgId === msg.id}
                  onSwitchToAgent={handleSwitchToAgent}
                  onPlanStepsChange={handlePlanStepsChange}
                  onConfirmPlan={handleConfirmPlan}
                  onExecuteStep={handleExecuteStep}
                  onSkipStep={handleSkipStep}
                  onResubmit={!loading ? handleResubmit : undefined}
                  isLatestUser={msg.id === lastUserMsgId}
                />
              ));
            })()}

            {/* 长任务进度面板 */}
            {longTask.task.status !== "idle" && (
              <LongTaskPanel
                task={longTask.task}
                onAbort={longTask.abort}
                onReset={longTask.reset}
              />
            )}

            {/* Agent 团队任务面板 */}
            {teamTask && (
              <TeamTaskBoard
                team={teamTask}
                onDismiss={() => setTeamTask(null)}
              />
            )}

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
                  {pinnedSelection && !selectionDismissed && (
                    <span
                      className={`${styles.inlineChip} ${styles.chipSelection}`}
                      title={`引用: ${pinnedSelection.label}`}
                    >
                      <TableIcon />
                      <span className={styles.chipLabel}>
                        {pinnedSelection.label}（{pinnedSelection.rowCount}行 ×{" "}
                        {pinnedSelection.colCount}列）
                      </span>
                      <span className={styles.chipBadge}>
                        {isWpsAvailable() ? "引用" : "mock"}
                      </span>
                      <button
                        className={styles.chipRemove}
                        onClick={handleDismissSelection}
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

                {/* / 指令弹窗 */}
                <SlashCommandPopup
                  visible={slashPopup.visible}
                  filter={slashPopup.filter}
                  onSelect={handleSlashSelect}
                  onClose={() => setSlashPopup({ visible: false, filter: "" })}
                />

                {/* @ 上下文引用弹窗 */}
                <AtContextPopup
                  visible={atPopup.visible}
                  filter={atPopup.filter}
                  wpsCtx={wpsCtx}
                  onSelect={handleAtSelect}
                  onClose={() => setAtPopup({ visible: false, filter: "" })}
                />

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
                      : "发个指令...（/ 指令 · @ 引用 · Enter 发送）"
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
                    onOpenConnectors={() => setConnectorsOpen(true)}
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
        </div>
        {/* end chatColumn */}
      </div>
      {/* end mainBody */}

      <HistoryPanel
        visible={historyOpen}
        onClose={handleCloseHistory}
        currentSessionId={activeAgentId}
        onSelectSession={async (id) => {
          const session = await loadSession(id);
          if (!session) return;
          abortAgent(activeAgentId);
          agentMgr.loadAgentsFromSessions([
            {
              id: session.id,
              title: session.title || "",
              messages: session.messages,
              model: session.model,
            },
          ]);
          setApplyingMsgId(null);
        }}
      />
      <DataConnectorPanel
        visible={connectorsOpen}
        onClose={() => setConnectorsOpen(false)}
      />
      <UpdateNotification />
    </div>
  );
}

function SidebarToggleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
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

function DataSourceIcon() {
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
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
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
