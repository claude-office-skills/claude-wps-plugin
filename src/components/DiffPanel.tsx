import { memo, useState } from "react";
import type { DiffResult } from "../types";
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

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.icon}>📊</span>
        <span className={styles.title}>
          已修改 {diff.changeCount} 个单元格
        </span>
        <span className={styles.sheet}>{diff.sheetName}</span>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader}>
          <span className={styles.colCell}>单元格</span>
          <span className={styles.colBefore}>修改前</span>
          <span className={styles.colAfter}>修改后</span>
        </div>
        {visible.map((ch) => (
          <div key={ch.cell} className={styles.row}>
            <span className={styles.colCell}>{ch.cell}</span>
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
