import { useState, memo, useMemo, useCallback, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, PlanStep } from "../types";
import { blockTypeFromLanguage, isJsonAction } from "../utils/blockParser";
import {
  CodeRenderer,
  ThinkingRenderer,
  ToolCallRenderer,
  PlanRenderer,
} from "./blocks";
import styles from "./MessageBubble.module.css";

interface Props {
  message: ChatMessage;
  onCodeExecuted: (
    msgId: string,
    blockId: string,
    result: string,
    error?: string,
    diff?: import("../types").DiffResult | null,
  ) => void;
  onApplyCode?: (msgId: string) => void;
  onRetryFix?: (code: string, error: string, language: string) => void;
  isApplying?: boolean;
  onSwitchToAgent?: () => void;
  onPlanStepsChange?: (msgId: string, steps: PlanStep[]) => void;
  onConfirmPlan?: (msgId: string, steps: PlanStep[]) => void;
  onExecuteStep?: (msgId: string, stepIndex: number) => void;
  onSkipStep?: (msgId: string, stepIndex: number) => void;
  onResubmit?: (msgId: string, content: string) => void;
  isLatestUser?: boolean;
  onRevert?: (msgId: string) => void;
}

function buildMarkdownComponents(
  message: ChatMessage,
  onCodeExecuted: Props["onCodeExecuted"],
  onRetryFix?: Props["onRetryFix"],
  isStreaming?: boolean,
) {
  return {
    pre({ children }: { children?: ReactNode }) {
      return <>{children}</>;
    },
    code({
      className,
      children,
    }: {
      className?: string;
      children?: ReactNode;
    }) {
      const isInline = !className && !String(children).includes("\n");
      if (isInline) {
        return <code className={styles.inlineCode}>{children}</code>;
      }

      const lang = /language-(\w+)/.exec(className || "")?.[1] || "javascript";
      const codeStr = String(children).replace(/\n$/, "");
      const blockType = blockTypeFromLanguage(lang);

      const matchedBlock = message.codeBlocks?.find(
        (b) => b.code === codeStr && b.language === lang,
      );

      const block = matchedBlock ?? {
        id: `inline-${codeStr.slice(0, 8)}`,
        language: lang,
        code: codeStr,
      };

      return (
        <CodeRenderer
          block={block}
          blockType={blockType}
          isStreaming={isStreaming}
          onExecuted={(blockId, result, error, diff) =>
            onCodeExecuted(message.id, blockId, result, error, diff)
          }
          onRetryFix={onRetryFix}
        />
      );
    },
    p({ children }: { children?: ReactNode }) {
      return <p className={styles.paragraph}>{children}</p>;
    },
    table({ children }: { children?: ReactNode }) {
      return (
        <div className={styles.tableWrap}>
          <table>{children}</table>
        </div>
      );
    },
  };
}

const remarkPlugins = [remarkGfm];

function MessageBubble({
  message,
  onCodeExecuted,
  onApplyCode,
  onRetryFix,
  isApplying,
  onSwitchToAgent,
  onPlanStepsChange,
  onConfirmPlan,
  onExecuteStep,
  onSkipStep,
  onResubmit,
  isLatestUser,
  onRevert,
}: Props) {
  const isUser = message.role === "user";
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [showRevertDialog, setShowRevertDialog] = useState(false);

  const handlePlanStepsChange = useCallback(
    (steps: PlanStep[]) => onPlanStepsChange?.(message.id, steps),
    [message.id, onPlanStepsChange],
  );
  const handleConfirmPlan = useCallback(
    (steps: PlanStep[]) => onConfirmPlan?.(message.id, steps),
    [message.id, onConfirmPlan],
  );
  const handleExecuteStep = useCallback(
    (stepIndex: number) => onExecuteStep?.(message.id, stepIndex),
    [message.id, onExecuteStep],
  );
  const handleSkipStep = useCallback(
    (stepIndex: number) => onSkipStep?.(message.id, stepIndex),
    [message.id, onSkipStep],
  );

  const codeBlocks = message.codeBlocks ?? [];
  const executableBlocks = codeBlocks.filter(
    (b) => b.language !== "json" || isJsonAction(b.code),
  );
  const hasUnexecutedCode =
    !isUser &&
    !message.isStreaming &&
    executableBlocks.length > 0 &&
    executableBlocks.some((b) => !b.executed);

  const streamingComponents = useMemo(
    () => buildMarkdownComponents(message, onCodeExecuted, onRetryFix, true),
    [message, onCodeExecuted, onRetryFix],
  );

  const doneComponents = useMemo(
    () => buildMarkdownComponents(message, onCodeExecuted, onRetryFix, false),
    [message, onCodeExecuted, onRetryFix],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message.content;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  if (isUser) {
    if (message.isStepExecution) {
      return null;
    }

    if (message.isAutoContinue) {
      const lines = message.content.split("\n").slice(0, 5);
      return (
        <div className={styles.msgRow}>
          <div className={styles.autoContinueBubble}>
            <span className={styles.autoContinueIcon}>▸</span>
            <span className={styles.autoContinueText}>{lines.join("\n")}</span>
          </div>
        </div>
      );
    }

    const handleResubmitClick = () => {
      if (!onResubmit) return;
      if (editing) {
        onResubmit(message.id, editText.trim() || message.content);
        setEditing(false);
      } else {
        setEditing(true);
        setEditText(message.content);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Let all native shortcuts (Cmd+A, Cmd+C, Cmd+V, Cmd+Z, etc.) pass through
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        setEditing(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onResubmit?.(message.id, editText.trim() || message.content);
        setEditing(false);
      }
      if (e.key === "Escape") setEditing(false);
    };

    return (
      <div
        className={`${styles.msgRow} ${isLatestUser ? styles.stickyUserRow : ""}`}
        data-msg-id={message.id}
      >
        <div className={styles.userBox}>
          {editing ? (
            <div className={styles.userEditWrap}>
              <textarea
                className={styles.userEditArea}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                rows={3}
              />
              <div className={styles.userEditActions}>
                <button
                  className={styles.userEditCancel}
                  onClick={() => setEditing(false)}
                >
                  取消
                </button>
                <button
                  className={styles.userEditSubmit}
                  onClick={handleResubmitClick}
                >
                  重新提交
                </button>
              </div>
            </div>
          ) : (
            <p
              className={styles.userText}
              title={onResubmit ? "点击编辑并重新提交" : undefined}
              onClick={onResubmit ? handleResubmitClick : undefined}
              style={onResubmit ? { cursor: "text" } : undefined}
            >
              {message.content}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Show thinking block while streaming (even after content starts arriving)
  // or after done if thinkingMs was recorded
  const isThinking =
    !!message.isStreaming && (!!message.thinkingContent || !message.content);
  const isStreamingContent = !!message.isStreaming && !!message.content;
  const isDone = !message.isStreaming;

  // #region agent log
  if (message.isStreaming) {
    fetch('http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f532b6'},body:JSON.stringify({sessionId:'f532b6',location:'MessageBubble.tsx:render',message:'streaming msg render',hypothesisId:'B',data:{msgId:message.id,isThinking,hasThinkingContent:!!message.thinkingContent,thinkingLen:message.thinkingContent?.length??0,hasContent:!!message.content,contentLen:message.content?.length??0},timestamp:Date.now()})}).catch(()=>{});
  }
  // #endregion

  return (
    <div className={styles.msgRow}>
      <div className={styles.assistBubble}>
        <ThinkingRenderer
          isThinking={isThinking}
          thinkingMs={message.thinkingMs}
          thinkingContent={message.thinkingContent}
          startTime={message.timestamp}
        />

        {message.activities && message.activities.length > 0 && (
          <ToolCallRenderer
            activities={message.activities}
            isStreaming={!!message.isStreaming}
          />
        )}

        {/* Streaming content — partial Markdown rendering */}
        {isStreamingContent && (
          <div
            className={`${styles.assistContent} ${styles.assistContentStreaming}`}
          >
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              components={streamingComponents}
            >
              {message.content}
            </ReactMarkdown>
            <span className={styles.cursor} />
          </div>
        )}

        {/* Final rendered content */}
        {isDone && message.content && (
          <div className={styles.assistContent}>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              components={doneComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {message.planSteps && message.planSteps.length > 0 && (
          <PlanRenderer
            steps={message.planSteps}
            onStepsChange={handlePlanStepsChange}
            onConfirmPlan={handleConfirmPlan}
            onExecuteStep={handleExecuteStep}
            onSkipStep={handleSkipStep}
          />
        )}

        {executableBlocks.length > 0 &&
          !message.isStreaming &&
          (() => {
            const langs = executableBlocks.map((b) =>
              (b.language || "javascript").toLowerCase(),
            );
            const isLocal = executableBlocks.some((b) =>
              b.code.trim().startsWith('{"_action"'),
            );
            let actionLabel = "应用到表格";
            let doneLabel = "已应用到表格";
            if (isLocal) {
              try {
                const parsed = JSON.parse(
                  executableBlocks.find((b) =>
                    b.code.trim().startsWith('{"_action"'),
                  )!.code,
                );
                const a = (parsed._action || "") as string;
                const localLabels: Record<string, [string, string]> = {
                  "local.browser.open": ["打开网页", "已打开网页"],
                  "local.browser.tabs": ["获取标签页", "已获取标签页"],
                  "local.finder.open": ["打开 Finder", "已打开 Finder"],
                  "local.apps.launch": ["启动应用", "已启动应用"],
                  "local.apps.quit": ["退出应用", "已退出应用"],
                  "local.apps.list": ["列出应用", "已列出应用"],
                  "local.calendar.list": ["查看日历", "已查看日历"],
                  "local.calendar.create": ["创建日历事件", "已创建日历事件"],
                  "local.mail.send": ["发送邮件", "已发送邮件"],
                  "local.mail.unread": ["查看未读邮件", "已查看未读邮件"],
                  "local.clipboard.get": ["读取剪贴板", "已读取剪贴板"],
                  "local.clipboard.set": ["写入剪贴板", "已写入剪贴板"],
                  "local.system.info": ["获取系统信息", "已获取系统信息"],
                  "local.applescript": ["执行脚本", "已执行脚本"],
                };
                if (localLabels[a]) {
                  [actionLabel, doneLabel] = localLabels[a];
                } else {
                  actionLabel = a.replace("local.", "");
                  doneLabel = `已执行 ${actionLabel}`;
                }
              } catch {}
            } else if (
              langs.some((l) =>
                ["bash", "shell", "sh", "zsh", "terminal"].includes(l),
              )
            ) {
              actionLabel = "执行命令";
              doneLabel = "已执行命令";
            } else if (langs.some((l) => ["python", "py"].includes(l))) {
              actionLabel = "执行 Python";
              doneLabel = "已执行 Python";
            } else if (langs.some((l) => ["html", "htm"].includes(l))) {
              actionLabel = "预览 HTML";
              doneLabel = "已预览 HTML";
            }
            return (
              <div className={styles.applyBar}>
                {hasUnexecutedCode ? (
                  <button
                    className={styles.applyBtn}
                    onClick={() => onApplyCode?.(message.id)}
                    disabled={isApplying}
                  >
                    {isApplying ? (
                      <>
                        <SpinnerIcon /> 执行中...
                      </>
                    ) : (
                      <>
                        <PlayIcon /> {actionLabel}
                      </>
                    )}
                  </button>
                ) : (
                  <span className={styles.applyDone}>
                    <CheckIcon /> {doneLabel}
                  </span>
                )}
              </div>
            );
          })()}

        {message.suggestAgentSwitch && onSwitchToAgent && (
          <div className={styles.modeSwitchBanner}>
            <span className={styles.modeSwitchIcon}>→</span>
            <span className={styles.modeSwitchText}>
              该操作需要在 Agent 模式下执行
            </span>
            <button className={styles.modeSwitchBtn} onClick={onSwitchToAgent}>
              切换至 Agent
            </button>
          </div>
        )}

        {!message.isStreaming && (
          <div className={styles.actionBar}>
            <button
              className={styles.actionBtn}
              onClick={handleCopy}
              title="复制"
            >
              <CopyIcon />
            </button>
            <button
              className={`${styles.actionBtn} ${feedback === "up" ? styles.actionActive : ""}`}
              onClick={() => setFeedback(feedback === "up" ? null : "up")}
              title="有帮助"
            >
              <ThumbUpIcon />
            </button>
            <button
              className={`${styles.actionBtn} ${feedback === "down" ? styles.actionActive : ""}`}
              onClick={() => setFeedback(feedback === "down" ? null : "down")}
              title="没帮助"
            >
              <ThumbDownIcon />
            </button>
            {onRevert &&
              codeBlocks.some((b) => b.executed && b.diff?.changeCount) && (
                <button
                  className={styles.revertBtn}
                  onClick={() => setShowRevertDialog(true)}
                  title="撤回此次 Excel 修改"
                >
                  <RevertIcon />
                  撤回
                </button>
              )}
          </div>
        )}

        {/* 撤回确认弹窗 */}
        {showRevertDialog && (
          <div
            className={styles.revertOverlay}
            onClick={() => setShowRevertDialog(false)}
          >
            <div
              className={styles.revertDialog}
              onClick={(e) => e.stopPropagation()}
            >
              <p className={styles.revertDialogTitle}>撤消对表格的修改？</p>
              <p className={styles.revertDialogDesc}>
                将还原此次 AI 操作对 Excel 所做的全部修改。此操作无法再次撤销。
              </p>
              <div className={styles.revertDialogActions}>
                <button
                  className={styles.revertCancelBtn}
                  onClick={() => setShowRevertDialog(false)}
                >
                  取消（Esc）
                </button>
                <button
                  className={styles.revertConfirmBtn}
                  onClick={() => {
                    setShowRevertDialog(false);
                    onRevert?.(message.id);
                  }}
                >
                  继续
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
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

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
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

function ThumbUpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3m7-2V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 2H20a2 2 0 012 2v7a2 2 0 01-2 2h-3m-7 2v4a3 3 0 003 3l4-9V2H6.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10" />
    </svg>
  );
}

function RevertIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7h10a5 5 0 0 1 0 10H3" />
      <path d="M7 3l-4 4 4 4" />
    </svg>
  );
}

export default memo(MessageBubble, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.isApplying === next.isApplying &&
    prev.onCodeExecuted === next.onCodeExecuted &&
    prev.onApplyCode === next.onApplyCode &&
    prev.onRetryFix === next.onRetryFix &&
    prev.onSwitchToAgent === next.onSwitchToAgent &&
    prev.onPlanStepsChange === next.onPlanStepsChange &&
    prev.onConfirmPlan === next.onConfirmPlan
  );
});
