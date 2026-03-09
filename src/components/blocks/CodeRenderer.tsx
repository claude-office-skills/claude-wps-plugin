import { useState, useRef, useLayoutEffect, memo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  executeCode,
  executePython,
  executeShell,
  previewHtml,
  BlockedError,
} from "../../api/wpsAdapter";
import type {
  CodeBlock as CodeBlockType,
  DiffResult,
  SidebarBlockType,
} from "../../types";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";
import DiffPanel from "../DiffPanel";

const COLLAPSE_THRESHOLD = 12;

interface Props {
  block: CodeBlockType;
  blockType: SidebarBlockType;
  onExecuted: (
    blockId: string,
    result: string,
    error?: string,
    diff?: DiffResult | null,
  ) => void;
  onRetryFix?: (code: string, error: string, language: string) => void;
  isStreaming?: boolean;
}

function CodeRenderer({
  block,
  blockType,
  onExecuted,
  onRetryFix,
  isStreaming,
}: Props) {
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const lineCount = block.code.split("\n").length;
  const shouldCollapse = lineCount > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(isStreaming || !shouldCollapse);
  const wasStreaming = useRef(isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCodeLen = useRef(0);

  useLayoutEffect(() => {
    if (wasStreaming.current && !isStreaming && shouldCollapse) {
      setExpanded(false);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, shouldCollapse]);

  useLayoutEffect(() => {
    if (!isStreaming || !expanded || !scrollRef.current) return;
    if (block.code.length <= prevCodeLen.current) return;
    prevCodeLen.current = block.code.length;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [block.code, isStreaming, expanded]);

  const runCode = async (force?: boolean) => {
    setRunning(true);
    setBlockedReason(null);
    try {
      const lang = (block.language || "javascript").toLowerCase();
      const isShell = ["bash", "shell", "sh", "zsh", "terminal"].includes(lang);
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
            location: "CodeRenderer.tsx:runCode:start",
            message: "Starting code execution",
            data: {
              lang,
              isShell,
              force,
              codeLen: block.code.length,
              codeHead: block.code.substring(0, 100),
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
      let execResult: { result: string; diff?: DiffResult | null };
      if (lang === "python" || lang === "py") {
        execResult = await executePython(block.code);
      } else if (isShell) {
        execResult = await executeShell(block.code);
      } else if (lang === "html" || lang === "htm") {
        execResult = await previewHtml(block.code);
      } else {
        execResult = await executeCode(block.code, undefined, force);
      }
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
            location: "CodeRenderer.tsx:runCode:success",
            message: "Code execution succeeded",
            data: {
              lang,
              resultLen: execResult.result?.length,
              resultHead: execResult.result?.substring(0, 100),
              hasDiff: !!execResult.diff,
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
      onExecuted(block.id, execResult.result, undefined, execResult.diff);
    } catch (err) {
      if (err instanceof BlockedError) {
        setBlockedReason(err.reason);
        return;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
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
            location: "CodeRenderer.tsx:runCode:error",
            message: "Code execution failed",
            data: { lang, errMsg, codeHead: block.code.substring(0, 100) },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
      onExecuted(block.id, "", errMsg);
    } finally {
      setRunning(false);
    }
  };

  const handleRun = () => runCode(false);
  const handleForceRun = () => runCode(true);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(block.code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = block.code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isJson = (block.language || "").toLowerCase() === "json";
  const isLocalAction = isJson && block.code.trim().startsWith('{"_action"');
  const isReadOnlyJson = isJson && !isLocalAction;

  // Local actions that executed successfully render as a compact success line
  if (isLocalAction && block.executed && !block.error) {
    let actionLabel = "操作已执行";
    try {
      const parsed = JSON.parse(block.code);
      const action = (parsed._action || "") as string;
      const labelMap: Record<string, string> = {
        "local.calendar.list": "📅 已读取日历",
        "local.calendar.create": "📅 已创建日历事件",
        "local.contacts.search": "👤 已搜索通讯录",
        "local.mail.send": "📧 邮件已发送",
        "local.mail.unread": "📧 已读取邮件",
        "local.reminders.list": "🔔 已读取提醒",
        "local.reminders.create": "🔔 已创建提醒",
        "local.finder.open": "📁 已打开 Finder",
        "local.finder.selection": "📁 已获取选中文件",
        "local.clipboard.get": "📋 已读取剪贴板",
        "local.clipboard.set": "📋 已写入剪贴板",
        "local.browser.tabs": "🌐 已获取标签页",
        "local.browser.open": "🌐 已打开网页",
        "local.apps.list": "💻 已列出应用",
        "local.apps.launch": "💻 已启动应用",
        "local.apps.quit": "💻 已退出应用",
        "local.system.info": "💻 已获取系统信息",
        "local.applescript": "⚙️ 已执行脚本",
      };
      actionLabel = labelMap[action] || `✅ ${action}`;
    } catch {}
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 6,
          background: "var(--sidebar-bg)",
          fontSize: 12,
          color: "var(--text-muted)",
          margin: "2px 0",
        }}
      >
        <span>{actionLabel}</span>
        {block.result && (
          <span style={{ opacity: 0.6, fontSize: 11 }}>
            — {block.result.slice(0, 60)}
            {block.result.length > 60 ? "…" : ""}
          </span>
        )}
      </div>
    );
  }

  const status = running
    ? ("running" as const)
    : block.error
      ? ("error" as const)
      : block.executed
        ? ("success" as const)
        : ("idle" as const);

  const lang = (block.language || "").toLowerCase();
  const needsConfirm = [
    "bash",
    "shell",
    "sh",
    "zsh",
    "terminal",
    "python",
    "py",
  ].includes(lang);
  const badge = isLocalAction ? "本地操作" : `${lineCount} 行`;

  const headerActions = (
    <>
      <button className={blockStyles.iconBtn} onClick={handleCopy} title="复制">
        {copied ? "✓" : <CopyIcon />}
      </button>
      {!block.executed && !isReadOnlyJson && !needsConfirm && (
        <button
          className={`${blockStyles.actionBtn} ${blockStyles.actionBtnPrimary}`}
          onClick={handleRun}
          disabled={running}
        >
          {running ? <SpinnerIcon /> : "▶ 执行"}
        </button>
      )}
    </>
  );

  const blockedFooter = blockedReason ? (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
      }}
    >
      <div
        style={{
          color: "var(--error)",
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14 }}>⚠</span>
        <span>{blockedReason}</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          className={`${blockStyles.actionBtn} ${blockStyles.actionBtnDanger}`}
          onClick={handleForceRun}
          style={{ flex: 1, justifyContent: "center" }}
        >
          确认执行
        </button>
        <button
          className={blockStyles.actionBtn}
          onClick={() => setBlockedReason(null)}
          style={{ flex: 1, justifyContent: "center" }}
        >
          取消
        </button>
      </div>
    </div>
  ) : null;

  // Shell/Python: Cursor 风格确认栏
  const confirmLangLabel: Record<string, string> = {
    bash: "Terminal",
    shell: "Terminal",
    sh: "Terminal",
    zsh: "Terminal",
    terminal: "Terminal",
    python: "Python",
    py: "Python",
  };
  const confirmFooter =
    needsConfirm && !block.executed && !block.error && !blockedReason ? (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          width: "100%",
        }}
      >
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>
            需要授权 · {confirmLangLabel[lang] || lang} 命令将在本地执行
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={`${blockStyles.actionBtn} ${blockStyles.actionBtnPrimary}`}
            onClick={handleRun}
            disabled={running}
            style={{ flex: 1, justifyContent: "center" }}
          >
            {running ? <SpinnerIcon /> : "✓ 允许执行"}
          </button>
        </div>
      </div>
    ) : null;

  const resultFooter = block.result ? (
    <div className={blockStyles.footerInfo}>
      <span
        style={{
          color: "var(--text-muted)",
          fontSize: 9,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        输出
      </span>{" "}
      <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {block.result.slice(0, 200)}
        {block.result.length > 200 ? "..." : ""}
      </span>
    </div>
  ) : block.error ? (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
      }}
    >
      <div
        style={{
          color: "var(--error)",
          fontSize: 11,
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {block.error}
      </div>
      {onRetryFix && (
        <button
          className={`${blockStyles.actionBtn} ${blockStyles.actionBtnDanger}`}
          onClick={() => onRetryFix(block.code, block.error!, block.language)}
          style={{ width: "100%", justifyContent: "center" }}
        >
          修复错误
        </button>
      )}
    </div>
  ) : null;

  return (
    <SidebarBlock
      type={blockType}
      status={status}
      badge={isStreaming ? "streaming" : badge}
      collapsed={!expanded && shouldCollapse && !isStreaming}
      onToggle={shouldCollapse ? () => setExpanded((v) => !v) : undefined}
      headerActions={headerActions}
      footer={blockedFooter ?? confirmFooter ?? resultFooter}
    >
      <div
        ref={scrollRef}
        style={{
          maxHeight: 300,
          overflowY: "auto",
          overflowX: "auto",
          background: "var(--code-bg)",
        }}
      >
        <SyntaxHighlighter
          language={block.language}
          style={vscDarkPlus}
          showLineNumbers
          lineNumberStyle={{
            minWidth: "2.5em",
            paddingRight: "1em",
            color: "#555",
            fontSize: 10,
            userSelect: "none",
          }}
          customStyle={{
            margin: 0,
            padding: "10px 0",
            fontSize: 11.5,
            lineHeight: "1.6",
            background: "transparent",
            overflowX: "auto",
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
          }}
          wrapLines
        >
          {block.code}
        </SyntaxHighlighter>
      </div>
      {block.diff && block.diff.changeCount > 0 && (
        <DiffPanel diff={block.diff} />
      )}
    </SidebarBlock>
  );
}

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="spin"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

export default memo(CodeRenderer);
