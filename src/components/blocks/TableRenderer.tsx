import { useState, memo } from "react";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";

interface Props {
  headers: string[];
  rows: (string | number | boolean | null)[][];
  totalRows?: number;
  totalCols?: number;
  onInsertTable?: () => void;
  onExportCSV?: () => void;
}

const PREVIEW_LIMIT = 10;

function TableRenderer({
  headers,
  rows,
  totalRows,
  totalCols,
  onInsertTable,
  onExportCSV,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, PREVIEW_LIMIT);
  const hasMore = rows.length > PREVIEW_LIMIT;
  const total = totalRows ?? rows.length;
  const cols = totalCols ?? headers.length;

  const footer = (
    <>
      <span className={blockStyles.footerInfo}>
        {total} 行 × {cols} 列
        {hasMore && !expanded && ` (显示前 ${PREVIEW_LIMIT} 行)`}
      </span>
      <div className={blockStyles.footerActions}>
        {hasMore && (
          <button
            className={blockStyles.actionBtn}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开全部"}
          </button>
        )}
        {onInsertTable && (
          <button
            className={`${blockStyles.actionBtn} ${blockStyles.actionBtnPrimary}`}
            onClick={onInsertTable}
          >
            插入表格
          </button>
        )}
        {onExportCSV && (
          <button className={blockStyles.actionBtn} onClick={onExportCSV}>
            导出 CSV
          </button>
        )}
      </div>
    </>
  );

  return (
    <SidebarBlock
      type="data-table"
      title={`数据预览 · ${total}行×${cols}列`}
      footer={footer}
    >
      <div
        style={{
          overflowX: "auto",
          fontSize: 11,
          fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            whiteSpace: "nowrap",
          }}
        >
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "4px 10px",
                    textAlign: "left",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                    fontSize: 10,
                    borderBottom: "1px solid var(--border-subtle)",
                    background: "var(--bg-elevated)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "3px 10px",
                      color: "var(--text-secondary)",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    {cell === null || cell === undefined ? (
                      <span style={{ color: "var(--text-faint)" }}>(空)</span>
                    ) : (
                      String(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SidebarBlock>
  );
}

export default memo(TableRenderer);
