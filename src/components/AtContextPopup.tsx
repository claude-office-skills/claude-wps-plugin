import { useState, useEffect, useCallback, useRef, memo } from "react";
import type { WpsContext } from "../types";
import styles from "./AtContextPopup.module.css";

interface AtOption {
  id: string;
  iconType: "selection" | "range" | "sheet";
  label: string;
  description: string;
  insertText: string;
  section: string;
}

interface Props {
  visible: boolean;
  filter: string;
  wpsCtx: WpsContext | null;
  onSelect: (opt: AtOption) => void;
  onClose: () => void;
}

function CtxIcon({ type }: { type: AtOption["iconType"] }) {
  const paths: Record<string, string> = {
    selection:
      "M5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2H5zm4 7h6m-6 4h6",
    range: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    sheet:
      "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1v5h5",
  };
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
      className={styles.icon}
    >
      <path d={paths[type] || paths.sheet} />
    </svg>
  );
}

function buildOptions(ctx: WpsContext | null): AtOption[] {
  const opts: AtOption[] = [];

  if (ctx?.selection) {
    opts.push({
      id: "current-selection",
      iconType: "selection",
      label: "@当前选区",
      description: `${ctx.selection.address} · ${ctx.selection.sheetName} · ${ctx.selection.rowCount}行×${ctx.selection.colCount}列`,
      insertText: `@当前选区(${ctx.selection.address})`,
      section: "当前上下文",
    });
  }

  if (ctx?.usedRange) {
    opts.push({
      id: "used-range",
      iconType: "range",
      label: "@使用区域",
      description: `${ctx.usedRange.address} · ${ctx.usedRange.rowCount}行×${ctx.usedRange.colCount}列`,
      insertText: `@使用区域(${ctx.usedRange.address})`,
      section: "当前上下文",
    });
  }

  if (ctx?.sheetNames) {
    for (const name of ctx.sheetNames) {
      opts.push({
        id: `sheet-${name}`,
        iconType: "sheet",
        label: `@${name}`,
        description: `工作表 · ${ctx.workbookName}`,
        insertText: `@${name}`,
        section: "工作表",
      });
    }
  }

  return opts;
}

function AtContextPopup({ visible, filter, wpsCtx, onSelect, onClose }: Props) {
  const options = buildOptions(wpsCtx);
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const filtered = options.filter((opt) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      opt.label.toLowerCase().includes(q) ||
      opt.description.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setActiveIdx(0);
  }, [filter]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || filtered.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSelect(filtered[activeIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [visible, filtered, activeIdx, onSelect, onClose],
  );

  useEffect(() => {
    if (!visible) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, handleKeyDown]);

  useEffect(() => {
    if (!visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popupRef.current && !popupRef.current.contains(target)) {
        const parent = popupRef.current.parentElement;
        if (parent && parent.contains(target)) return;
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible, onClose]);

  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  if (!visible || filtered.length === 0) return null;

  let lastSection = "";

  return (
    <div className={styles.popup} ref={popupRef}>
      <div className={styles.list} ref={listRef}>
        {filtered.map((opt, i) => {
          const showSection = opt.section !== lastSection;
          lastSection = opt.section;
          return (
            <div key={opt.id}>
              {showSection && (
                <div className={styles.section}>{opt.section}</div>
              )}
              <button
                className={`${styles.item} ${i === activeIdx ? styles.itemActive : ""}`}
                onClick={() => onSelect(opt)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <CtxIcon type={opt.iconType} />
                <span className={styles.info}>
                  <span className={styles.name}>{opt.label}</span>
                  <span className={styles.desc}>{opt.description}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className={styles.hint}>
        <kbd>↑↓</kbd> 选择 <kbd>Enter</kbd> 插入 <kbd>Esc</kbd> 关闭
      </div>
    </div>
  );
}

export default memo(AtContextPopup);
