import { memo } from "react";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";

interface Props {
  current: number;
  total: number;
  label?: string;
  elapsed?: number;
  onCancel?: () => void;
}

function ProgressRenderer({ current, total, label, elapsed, onCancel }: Props) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const remaining =
    elapsed && current > 0
      ? Math.round((elapsed / current) * (total - current))
      : undefined;

  const formatTime = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
  };

  const footer = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <div className={blockStyles.progressBar}>
          <div
            className={blockStyles.progressFill}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={blockStyles.footerInfo}>
          {pct}%
          {remaining !== undefined && ` · 约 ${formatTime(remaining)}`}
        </span>
      </div>
      {onCancel && (
        <button className={blockStyles.actionBtn} onClick={onCancel}>
          取消
        </button>
      )}
    </>
  );

  return (
    <SidebarBlock
      type="progress"
      status="running"
      title={`处理中 · ${current}/${total}`}
      footer={footer}
    >
      {label && (
        <div
          style={{
            padding: "6px 14px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          {label}
          {elapsed !== undefined && (
            <span style={{ marginLeft: 8, color: "var(--text-faint)" }}>
              已用 {formatTime(elapsed)}
            </span>
          )}
        </div>
      )}
    </SidebarBlock>
  );
}

export default memo(ProgressRenderer);
