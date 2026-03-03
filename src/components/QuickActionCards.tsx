import { useState, useEffect, useRef, memo, useCallback } from "react";
import type { QuickAction, InteractionMode } from "../types";
import styles from "./QuickActionCards.module.css";

const PROXY_BASE = "http://127.0.0.1:3001";
const DEBOUNCE_MS = 1500;
const VISIBLE_COUNT = 4;

// ── Wireframe SVG icons ──────────────────────────────────────────────────
type SvgProps = React.SVGProps<SVGSVGElement> & { children?: React.ReactNode };
function S({ children, ...p }: SvgProps) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      {children}
    </svg>
  );
}

const LABEL_ICONS: Record<string, React.ReactElement> = {
  "\u5206\u6790\u6570\u636e": (
    <S>
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 4 4-4" />
    </S>
  ),
  "\u521b\u5efa\u56fe\u8868": (
    <S>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 17V13M12 17V9M17 17V5" />
    </S>
  ),
  "\u6761\u4ef6\u683c\u5f0f": (
    <S>
      <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m6-18v18M3 9h18M3 15h18" />
    </S>
  ),
  "\u516c\u5f0f\u8c03\u8bd5": (
    <S>
      <path d="M7 8h10M7 12h6M7 16h4" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </S>
  ),
  "\u53bb\u91cd\u590d": (
    <S>
      <circle cx="8" cy="8" r="4" />
      <circle cx="16" cy="16" r="4" />
      <path d="M16 8h.01M8 16h.01" />
    </S>
  ),
  "AI \u667a\u80fd\u586b\u5145": (
    <S>
      <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
    </S>
  ),
  "AI\u667a\u80fd\u586b\u5145": (
    <S>
      <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
    </S>
  ),
  "\u683c\u5f0f\u8f6c\u6362": (
    <S>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
      <path d="M17 14v6M14 17h6" />
    </S>
  ),
  "\u667a\u80fd\u5206\u5217": (
    <S>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18M3 9h18M3 15h18" />
    </S>
  ),
  "\u6392\u5e8f\u6574\u7406": (
    <S>
      <path d="M3 6h18M7 12h10M11 18h2" />
    </S>
  ),
  "\u6570\u636e\u7edf\u8ba1": (
    <S>
      <path d="M2 20h20M6 20V14M10 20V8M14 20V11M18 20V4" />
    </S>
  ),
  "\u751f\u6210\u6570\u636e": (
    <S>
      <path d="M12 5v14M5 12h14" />
    </S>
  ),
  "\u6e05\u6d17\u6570\u636e": (
    <S>
      <path d="M12 22V12M12 12C12 12 7 9 7 5a5 5 0 0110 0c0 4-5 7-5 7z" />
    </S>
  ),
  "\u4e00\u952e\u7f8e\u5316": (
    <S>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </S>
  ),
  "\u5efa\u7acb\u6a21\u578b": (
    <S>
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    </S>
  ),
  "\u51bb\u7ed3\u8868\u5934": (
    <S>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </S>
  ),
  "\u89e3\u8bfb\u5de5\u4f5c\u7c3f": (
    <S>
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </S>
  ),
  "\u64cd\u4f5c\u8868\u683c": (
    <S>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </S>
  ),
  __default: (
    <S>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </S>
  ),
};

function ActionIcon({ label }: { label: string }) {
  return LABEL_ICONS[label] ?? LABEL_ICONS["__default"];
}

interface CommandDef {
  id: string;
  icon: string;
  label: string;
  description: string;
  scope: string;
  prompt: string;
}

interface ModeDef {
  id: string;
  quickActions?: Array<{
    icon: string;
    label: string;
    prompt: string;
    scope?: string;
  }>;
}

const FALLBACK_GENERAL: QuickAction[] = [
  {
    icon: "",
    label: "\u64cd\u4f5c\u8868\u683c",
    prompt:
      "\u5e2e\u6211\u5bf9\u5f53\u524d\u8868\u683c\u6267\u884c\u64cd\u4f5c",
  },
  {
    icon: "",
    label: "\u5efa\u7acb\u6a21\u578b",
    prompt:
      "\u5e2e\u6211\u57fa\u4e8e\u5f53\u524d\u6570\u636e\u5efa\u7acb\u5206\u6790\u6a21\u578b",
  },
  {
    icon: "",
    label: "\u89e3\u8bfb\u5de5\u4f5c\u7c3f",
    prompt:
      "\u89e3\u8bfb\u5f53\u524d\u5de5\u4f5c\u7c3f\u7684\u5185\u5bb9\u548c\u7ed3\u6784",
  },
  {
    icon: "",
    label: "\u6e05\u6d17\u6570\u636e",
    prompt:
      "\u5e2e\u6211\u6e05\u6d17\u5f53\u524d\u6570\u636e\uff08\u53bb\u7a7a\u767d\u3001\u7edf\u4e00\u683c\u5f0f\u3001\u4fee\u6b63\u5f02\u5e38\u5024\uff09",
  },
];

const FALLBACK_SELECTION: QuickAction[] = [
  {
    icon: "",
    label: "\u53bb\u91cd\u590d",
    prompt: "\u53bb\u9664\u9009\u533a\u4e2d\u7684\u91cd\u590d\u6570\u636e",
  },
  {
    icon: "",
    label: "\u683c\u5f0f\u8f6c\u6362",
    prompt: "\u8f6c\u6362\u9009\u533a\u4e2d\u7684\u6570\u636e\u683c\u5f0f",
  },
  {
    icon: "",
    label: "\u6570\u636e\u7edf\u8ba1",
    prompt:
      "\u5bf9\u9009\u533a\u6570\u636e\u8fdb\u884c\u7edf\u8ba1\u5206\u6790",
  },
  {
    icon: "",
    label: "\u6392\u5e8f\u6574\u7406",
    prompt:
      "\u5bf9\u9009\u533a\u6570\u636e\u8fdb\u884c\u6392\u5e8f\u6574\u7406",
  },
  {
    icon: "",
    label: "\u516c\u5f0f\u8c03\u8bd5",
    prompt:
      "\u68c0\u67e5\u5e76\u8c03\u8bd5\u9009\u533a\u4e2d\u7684\u516c\u5f0f",
  },
];

function toQuickAction(cmd: CommandDef): QuickAction {
  return { icon: "", label: cmd.label, prompt: cmd.prompt };
}

interface Props {
  hasSelection: boolean;
  onAction: (prompt: string) => void;
  disabled?: boolean;
  mode?: InteractionMode;
}

const QuickActionCards = memo(function QuickActionCards({
  hasSelection,
  onAction,
  disabled,
  mode = "agent",
}: Props) {
  const [generalCmds, setGeneralCmds] =
    useState<QuickAction[]>(FALLBACK_GENERAL);
  const [selectionCmds, setSelectionCmds] =
    useState<QuickAction[]>(FALLBACK_SELECTION);
  const [modeActions, setModeActions] = useState<
    Record<string, { general: QuickAction[]; selection: QuickAction[] }>
  >({});
  const [stableHasSelection, setStableHasSelection] = useState(hasSelection);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hasSelection === stableHasSelection) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(() => {
      setStableHasSelection(hasSelection);
      timerRef.current = null;
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hasSelection, stableHasSelection]);

  useEffect(() => {
    fetch(`${PROXY_BASE}/commands`)
      .then((r) => r.json())
      .then((cmds: CommandDef[]) => {
        const gen = cmds
          .filter((c) => c.scope === "general")
          .map(toQuickAction);
        const sel = cmds
          .filter((c) => c.scope === "selection")
          .map(toQuickAction);
        if (gen.length > 0) setGeneralCmds(gen);
        if (sel.length > 0) setSelectionCmds(sel);
      })
      .catch(() => {});

    fetch(`${PROXY_BASE}/modes`)
      .then((r) => r.json())
      .then((modes: ModeDef[]) => {
        const result: Record<
          string,
          { general: QuickAction[]; selection: QuickAction[] }
        > = {};
        for (const m of modes) {
          if (m.quickActions && m.quickActions.length > 0) {
            result[m.id] = {
              general: m.quickActions
                .filter((a) => !a.scope || a.scope === "general")
                .map((a) => ({ icon: "", label: a.label, prompt: a.prompt })),
              selection: m.quickActions
                .filter((a) => a.scope === "selection")
                .map((a) => ({ icon: "", label: a.label, prompt: a.prompt })),
            };
          }
        }
        setModeActions(result);
      })
      .catch(() => {});
  }, []);

  const modeSpecific = modeActions[mode];
  const allActions: QuickAction[] = [];
  const seen = new Set<string>();
  const addUnique = (list: QuickAction[]) => {
    for (const a of list) {
      if (!seen.has(a.label)) {
        seen.add(a.label);
        allActions.push(a);
      }
    }
  };

  if (stableHasSelection) {
    if (modeSpecific?.selection.length) addUnique(modeSpecific.selection);
    addUnique(selectionCmds);
    if (modeSpecific?.general.length) addUnique(modeSpecific.general);
    addUnique(generalCmds);
  } else {
    if (modeSpecific?.general.length) addUnique(modeSpecific.general);
    addUnique(generalCmds);
    if (modeSpecific?.selection.length) addUnique(modeSpecific.selection);
    addUnique(selectionCmds);
  }

  const [expanded, setExpanded] = useState(false);
  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);
  const hasMore = allActions.length > VISIBLE_COUNT;
  const visibleActions = expanded
    ? allActions
    : allActions.slice(0, VISIBLE_COUNT);

  return (
    <div className={styles.gridWrap}>
      <div className={`${styles.grid} ${expanded ? styles.gridExpanded : ""}`}>
        {visibleActions.map((action) => (
          <button
            key={action.label}
            className={styles.card}
            onClick={() => onAction(action.prompt)}
            disabled={disabled}
          >
            <span className={styles.cardIcon}>
              <ActionIcon label={action.label} />
            </span>
            <span className={styles.cardLabel}>{action.label}</span>
          </button>
        ))}
        {hasMore && (
          <button
            className={`${styles.card} ${styles.moreBtn}`}
            onClick={toggleExpand}
          >
            <span className={styles.cardIcon}>
              {expanded ? (
                <S>
                  <path d="M15 18l-6-6 6-6" />
                </S>
              ) : (
                <S>
                  <path d="M9 18l6-6-6-6" />
                </S>
              )}
            </span>
            <span className={styles.cardLabel}>
              {expanded
                ? "\u6536\u8d77"
                : `\u66f4\u591a+${allActions.length - VISIBLE_COUNT}`}
            </span>
          </button>
        )}
      </div>
    </div>
  );
});

export default QuickActionCards;
