import { useState, useCallback, memo } from "react";
import type { DiffResult } from "../../types";
import { navigateToCell } from "../../api/wpsAdapter";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";

interface Props {
  diff: DiffResult;
  onRevert?: () => void;
}

const COLLAPSED_LIMIT = 8;

function formatVal(v: string | number | boolean | null): string {
  if (v === null || v === undefined || v === "") return "(空)";
  return String(v);
}

function DiffRenderer({ diff, onRevert }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? diff.changes
    : diff.changes.slice(0, COLLAPSED_LIMIT);
  const hasMore = diff.changes.length > COLLAPSED_LIMIT;

  const handleCellClick = useCallback(
    (cellAddress: string) => {
      navigateToCell(diff.sheetName, cellAddress).catch(() => {});
    },
    [diff.sheetName],
  );

  const footer = (
    <>
      <span className={blockStyles.footerInfo}>
        {diff.changeCount} 个单元格变更 · {diff.sheetName}
      </span>
      <div className={blockStyles.footerActions}>
        {hasMore && (
          <button
            className={blockStyles.actionBtn}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : `展开全部 ${diff.changes.length} 项`}
          </button>
        )}
        {onRevert && (
          <button
            className={`${blockStyles.actionBtn} ${blockStyles.actionBtnDanger}`}
            onClick={onRevert}
          >
            撤销
          </button>
        )}
      </div>
    </>
  );

  return (
    <SidebarBlock
      type="cell-change"
      title={`表格变更 · ${diff.sheetName}`}
      badge={`${diff.changeCount} 项`}
      footer={footer}
    >
      <div style={{ fontSize: 11, fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "60px 1fr 1fr",
            padding: "4px 14px",
            fontSize: 9,
            fontWeight: 600,
            textTransform: "uppercase",
            color: "var(--text-muted)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span>单元格</span>
          <span>修改前</span>
          <span>修改后</span>
        </div>
        {visible.map((ch) => (
          <div
            key={ch.cell}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr 1fr",
              padding: "3px 14px",
              borderBottom: "1px solid var(--border-subtle)",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => handleCellClick(ch.cell)}
              style={{
                background: "none",
                border: "none",
                color: "var(--ui-accent)",
                cursor: "pointer",
                padding: 0,
                fontSize: 11,
                fontFamily: "inherit",
                textAlign: "left",
              }}
              title={`跳转到 ${ch.cell}`}
            >
              {ch.cell}
            </button>
            <span style={{ color: "var(--error)", textDecoration: "line-through" }}>
              {formatVal(ch.before)}
            </span>
            <span style={{ color: "var(--success)" }}>
              {formatVal(ch.after)}
            </span>
          </div>
        ))}
      </div>
    </SidebarBlock>
  );
}

export default memo(DiffRenderer);
