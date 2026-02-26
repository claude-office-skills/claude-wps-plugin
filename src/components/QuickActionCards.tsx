import { useState, useEffect, useRef, memo } from "react";
import type { QuickAction, InteractionMode } from "../types";
import styles from "./QuickActionCards.module.css";

const PROXY_BASE = "http://127.0.0.1:3001";
const DEBOUNCE_MS = 1500;

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
  { icon: "⚡", label: "操作表格", prompt: "帮我对当前表格执行操作" },
  { icon: "📊", label: "建立模型", prompt: "帮我基于当前数据建立分析模型" },
  { icon: "📝", label: "解读工作簿", prompt: "解读当前工作簿的内容和结构" },
  {
    icon: "🧹",
    label: "清洗数据",
    prompt: "帮我清洗当前数据（去空白、统一格式、修正异常值）",
  },
];

const FALLBACK_SELECTION: QuickAction[] = [
  { icon: "🔄", label: "去重复", prompt: "去除选区中的重复数据" },
  { icon: "📐", label: "格式转换", prompt: "转换选区中的数据格式" },
  { icon: "📈", label: "数据统计", prompt: "对选区数据进行统计分析" },
  { icon: "🔢", label: "排序整理", prompt: "对选区数据进行排序整理" },
  { icon: "🐛", label: "公式调试", prompt: "检查并调试选区中的公式" },
];

function toQuickAction(cmd: CommandDef): QuickAction {
  return { icon: cmd.icon, label: cmd.label, prompt: cmd.prompt };
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
                .map((a) => ({
                  icon: a.icon,
                  label: a.label,
                  prompt: a.prompt,
                })),
              selection: m.quickActions
                .filter((a) => a.scope === "selection")
                .map((a) => ({
                  icon: a.icon,
                  label: a.label,
                  prompt: a.prompt,
                })),
            };
          }
        }
        setModeActions(result);
      })
      .catch(() => {});
  }, []);

  const modeSpecific = modeActions[mode];
  let actions: QuickAction[];
  if (modeSpecific) {
    actions =
      stableHasSelection && modeSpecific.selection.length > 0
        ? modeSpecific.selection
        : modeSpecific.general.length > 0
          ? modeSpecific.general
          : stableHasSelection
            ? selectionCmds
            : generalCmds;
  } else {
    actions = stableHasSelection ? selectionCmds : generalCmds;
  }

  return (
    <div className={styles.grid}>
      {actions.map((action) => (
        <button
          key={action.label}
          className={styles.card}
          onClick={() => onAction(action.prompt)}
          disabled={disabled}
        >
          <span className={styles.cardIcon}>{action.icon}</span>
          <span className={styles.cardLabel}>{action.label}</span>
        </button>
      ))}
    </div>
  );
});

export default QuickActionCards;
