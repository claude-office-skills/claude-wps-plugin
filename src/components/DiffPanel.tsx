import { memo, useState, useCallback } from "react";
import type { DiffResult } from "../types";
import { navigateToCell } from "../api/wpsAdapter";
import styles from "./DiffPanel.module.css";

interface Props {
  diff: DiffResult;
}

const COLLAPSED_LIMIT = 8;

function DiffPanel({ diff }: Props) {
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

  const handleSheetClick = useCallback(() => {
    navigateToCell(diff.sheetName).catch(() => {});
  }, [diff.sheetName]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.icon}>●</span>
        <span className={styles.title}>
          已修改 {diff.changeCount} 个单元格
        </span>
        <button
          className={styles.sheetLink}
          onClick={handleSheetClick}
          title={`跳转到 ${diff.sheetName}`}
        >
          {diff.sheetName} ↗
        </button>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader}>
          <span className={styles.colCell}>单元格</span>
          <span className={styles.colBefore}>修改前</span>
          <span className={styles.colAfter}>修改后</span>
        </div>
        {visible.map((ch) => (
          <div key={ch.cell} className={styles.row}>
            <button
              className={`${styles.colCell} ${styles.cellLink}`}
              onClick={() => handleCellClick(ch.cell)}
              title={`跳转到 ${ch.cell}`}
            >
              {ch.cell}
            </button>
            <span className={`${styles.colBefore} ${styles.removed}`}>
              {formatVal(ch.before)}
            </span>
            <span className={`${styles.colAfter} ${styles.added}`}>
              {formatVal(ch.after)}
            </span>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          className={styles.toggleBtn}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? "收起"
            : `展开全部 ${diff.changes.length} 项变更`}
          {diff.hasMore && !expanded && " (更多变更未显示)"}
        </button>
      )}
    </div>
  );
}

function formatVal(v: string | number | boolean | null): string {
  if (v === null || v === undefined || v === "") return "(空)";
  return String(v);
}

export default memo(DiffPanel);
