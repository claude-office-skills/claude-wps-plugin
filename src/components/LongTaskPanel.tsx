import { memo } from "react";
import SidebarBlock from "./SidebarBlock";
import { blockStyles } from "./SidebarBlock";
import type { LongTaskState } from "../hooks/useLongTask";

interface Props {
  task: LongTaskState;
  onAbort: () => void;
  onReset: () => void;
}

function LongTaskPanel({ task, onAbort, onReset }: Props) {
  if (task.status === "idle") return null;

  const { progress, status, error, taskId } = task;

  const pct =
    progress?.total && progress.total > 0
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : undefined;

  const statusLabel: Record<string, string> = {
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    aborted: "已中止",
  };

  const footer = (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}
    >
      {pct !== undefined && status === "running" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <div className={blockStyles.progressBar}>
            <div
              className={blockStyles.progressFill}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={blockStyles.footerInfo}>{pct}%</span>
        </div>
      )}
      {status === "running" && (
        <button className={blockStyles.actionBtn} onClick={onAbort}>
          中止
        </button>
      )}
      {(status === "completed" ||
        status === "failed" ||
        status === "aborted") && (
        <button className={blockStyles.actionBtn} onClick={onReset}>
          关闭
        </button>
      )}
    </div>
  );

  return (
    <SidebarBlock
      type="progress"
      status={status === "running" ? "running" : "idle"}
      title={`${statusLabel[status] ?? status} · ${taskId?.slice(0, 10) ?? ""}`}
      footer={footer}
    >
      <div style={{ padding: "6px 14px", fontSize: 12 }}>
        {progress?.message && (
          <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>
            {progress.phase && (
              <span
                style={{
                  display: "inline-block",
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "var(--bg-elevated)",
                  color: "var(--text-muted)",
                  fontSize: 10,
                  marginRight: 6,
                }}
              >
                {progress.phase}
              </span>
            )}
            {progress.message}
          </div>
        )}
        {error && (
          <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>
        )}
        {status === "completed" && task.result != null ? (
          <div
            style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}
          >
            {typeof task.result === "object" &&
            task.result !== null &&
            "path" in (task.result as Record<string, unknown>)
              ? `输出: ${String((task.result as Record<string, unknown>).path)}`
              : "任务完成"}
          </div>
        ) : null}
      </div>
    </SidebarBlock>
  );
}

export default memo(LongTaskPanel);
