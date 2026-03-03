import { useState, useRef, useEffect, memo } from "react";
import type { InteractionMode } from "../types";
import styles from "./ModeSelector.module.css";

const MODE_CONFIG: Record<
  InteractionMode,
  { label: string; desc: string; dotClass: string; textClass: string }
> = {
  agent: {
    label: "Agent",
    desc: "自动执行代码",
    dotClass: styles.dotAgent,
    textClass: styles.textAgent,
  },
  plan: {
    label: "Plan",
    desc: "生成步骤规划",
    dotClass: styles.dotPlan,
    textClass: styles.textPlan,
  },
  ask: {
    label: "Ask",
    desc: "只读分析问答",
    dotClass: styles.dotAsk,
    textClass: styles.textAsk,
  },
};

const MODES: InteractionMode[] = ["agent", "plan", "ask"];

interface Props {
  mode: InteractionMode;
  onChange: (mode: InteractionMode) => void;
  disabled?: boolean;
}

const ModeSelector = memo(function ModeSelector({
  mode,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const current = MODE_CONFIG[mode];

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={`当前模式: ${current.label} — ${current.desc}`}
      >
        <span className={`${styles.modeDot} ${current.dotClass}`} />
        <span className={`${styles.modeName} ${current.textClass}`}>
          {current.label}
        </span>
        <span className={`${styles.arrow} ${current.textClass}`}>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          {MODES.map((m) => {
            const cfg = MODE_CONFIG[m];
            const isActive = m === mode;
            return (
              <button
                key={m}
                className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <div className={styles.optRow}>
                  <span className={`${styles.optDot} ${cfg.dotClass}`} />
                  <span className={styles.optLabel}>{cfg.label}</span>
                </div>
                <div className={styles.optDesc}>{cfg.desc}</div>
                {isActive && (
                  <span className={`${styles.optCheck} ${cfg.textClass}`}>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ModeSelector;
