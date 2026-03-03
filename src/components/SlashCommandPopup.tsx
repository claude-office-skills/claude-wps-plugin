import { useState, useEffect, useCallback, useRef, memo } from "react";
import styles from "./SlashCommandPopup.module.css";

interface Command {
  id: string;
  icon: string;
  label: string;
  description: string;
  scope: string;
  prompt: string;
  /** 系统内置命令（填入输入框让用户补全参数，而非直接执行） */
  isSystem?: boolean;
  /** 系统命令的输入框占位模板，如 "/team " */
  inputTemplate?: string;
}

interface Props {
  visible: boolean;
  filter: string;
  onSelect: (cmd: Command) => void;
  onClose: () => void;
}

const PROXY_BASE = "http://127.0.0.1:3001";

/** 内置系统命令（不走 /commands API） */
const SYSTEM_COMMANDS: Command[] = [
  {
    id: "team",
    icon: "",
    label: "team",
    description: "组建 Agent 团队协作完成复杂任务",
    scope: "system",
    prompt: "",
    isSystem: true,
    inputTemplate: "/team ",
  },
  {
    id: "workflow",
    icon: "",
    label: "workflow",
    description: "启动预定义工作流（如 /workflow monthly-report）",
    scope: "system",
    prompt: "",
    isSystem: true,
    inputTemplate: "/workflow ",
  },
  {
    id: "help",
    icon: "",
    label: "help",
    description: "显示所有可用命令",
    scope: "system",
    prompt: "/help",
    isSystem: true,
    inputTemplate: "/help",
  },
];

const ICON_MAP: Record<string, string> = {
  // 系统命令图标
  team: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  workflow: "M12 2L2 7l10 5 10-5-10-5M2 17l10 5 10-5M2 12l10 5 10-5",
  help: "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01",
  // 普通指令图标
  "beautify-table":
    "M4 3h16a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1m0 6h16M3 15h16M9 3v18",
  "build-model": "M3 3v18h18M7 16l4-8 4 4 4-6",
  "clean-data": "M12 2L2 7l10 5 10-5-10-5M2 17l10 5 10-5M2 12l10 5 10-5",
  "conditional-format":
    "M12 2a10 10 0 100 20 10 10 0 000-20m-2 15l-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8l-9 9",
  "debug-formula": "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  deduplicate: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  "fill-cells":
    "M12 2v6m0 4v6m-4-8H2m20 0h-6M4.93 4.93l4.24 4.24m5.66 5.66l4.24 4.24m0-14.14l-4.24 4.24m-5.66 5.66l-4.24 4.24",
  "format-convert":
    "M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3",
  "freeze-header": "M12 2v20M2 12h20M2 2h20v20H2z",
  "interpret-workbook":
    "M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zm20 0h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z",
  "operate-sheet":
    "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
  "smart-split": "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  "sort-data": "M3 6h7M3 12h5M3 18h3M16 6l4 4-4 4",
  statistics: "M18 20V10M12 20V4M6 20v-6",
};

const DEFAULT_ICON = "M4 17l6-6 4 4 6-8";

function CmdIcon({ id }: { id: string }) {
  const d = ICON_MAP[id] || DEFAULT_ICON;
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
      <path d={d} />
    </svg>
  );
}

function SlashCommandPopup({ visible, filter, onSelect, onClose }: Props) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    fetch(`${PROXY_BASE}/commands`)
      .then((r) => r.json())
      .then((data) => {
        const apiCmds = Array.isArray(data) ? data : [];
        setCommands([...SYSTEM_COMMANDS, ...apiCmds]);
      })
      .catch(() => {
        setCommands(SYSTEM_COMMANDS);
      });
  }, [visible]);

  const filtered = commands.filter((cmd) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q)
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
      const buttons = listRef.current.querySelectorAll("button");
      const el = buttons[activeIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  if (!visible || filtered.length === 0) return null;

  const systemFiltered = filtered.filter((c) => c.scope === "system");
  const normalFiltered = filtered.filter((c) => c.scope !== "system");

  let globalIdx = 0;
  const renderItem = (cmd: Command) => {
    const i = globalIdx++;
    return (
      <button
        key={cmd.id}
        className={`${styles.item} ${i === activeIdx ? styles.itemActive : ""}`}
        onClick={() => onSelect(cmd)}
        onMouseEnter={() => setActiveIdx(i)}
      >
        <CmdIcon id={cmd.id} />
        <span className={styles.info}>
          <span className={styles.name}>/{cmd.label}</span>
          <span className={styles.desc}>{cmd.description}</span>
        </span>
      </button>
    );
  };

  return (
    <div className={styles.popup} ref={popupRef}>
      <div className={styles.list} ref={listRef}>
        {systemFiltered.length > 0 && (
          <>
            <div className={styles.header}>Agent 模式</div>
            {systemFiltered.map(renderItem)}
          </>
        )}
        {normalFiltered.length > 0 && (
          <>
            <div className={styles.header}>指令</div>
            {normalFiltered.map(renderItem)}
          </>
        )}
      </div>
      <div className={styles.hint}>
        <kbd>↑↓</kbd> 选择 <kbd>Enter</kbd> 确认 <kbd>Esc</kbd> 关闭
      </div>
    </div>
  );
}

export default memo(SlashCommandPopup);
