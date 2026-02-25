import { useState, useEffect } from "react";
import type { QuickAction } from "../types";
import styles from "./QuickActionCards.module.css";

const PROXY_BASE = "http://127.0.0.1:3001";

interface CommandDef {
  id: string;
  icon: string;
  label: string;
  description: string;
  scope: string;
  prompt: string;
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
}

export default function QuickActionCards({
  hasSelection,
  onAction,
  disabled,
}: Props) {
  const [generalCmds, setGeneralCmds] =
    useState<QuickAction[]>(FALLBACK_GENERAL);
  const [selectionCmds, setSelectionCmds] =
    useState<QuickAction[]>(FALLBACK_SELECTION);

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
  }, []);

  const actions = hasSelection ? selectionCmds : generalCmds;

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
}
