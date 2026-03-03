import { useState, useRef, useEffect, memo } from "react";
import type { ModelOption, ModelRouteInfo } from "../types";
import { MODEL_OPTIONS } from "../types";
import styles from "./ModelSelector.module.css";

interface Props {
  value: string;
  onChange: (cliModel: string) => void;
  disabled?: boolean;
  routeInfo?: ModelRouteInfo | null;
  mode?: string;
}

const ModelSelector = memo(function ModelSelector({
  value,
  onChange,
  disabled,
  routeInfo,
  mode,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current =
    MODEL_OPTIONS.find((m) => m.cliModel === value) ?? MODEL_OPTIONS[0];

  const effectiveModel = routeInfo?.isAutoRouted
    ? (MODEL_OPTIONS.find((m) => m.cliModel === routeInfo.model) ?? current)
    : current;

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

  const handleSelect = (opt: ModelOption) => {
    onChange(opt.cliModel);
    setOpen(false);
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={
          routeInfo?.isAutoRouted
            ? `自动路由: ${effectiveModel.label} (${routeInfo.reason})`
            : `当前模型: ${current.label}`
        }
      >
        {routeInfo?.isAutoRouted && (
          <span className={styles.routeBadge} title="动态路由">
            A
          </span>
        )}
        <span className={styles.modelName}>{effectiveModel.label}</span>
        <span className={styles.arrow}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          {routeInfo?.isAutoRouted && (
            <div className={styles.routeHint}>
              <span className={styles.routeHintIcon}>A</span>
              <span>{routeInfo.reason}</span>
            </div>
          )}
          {MODEL_OPTIONS.map((opt) => {
            const isActive = opt.cliModel === value;
            const isRouted =
              routeInfo?.isAutoRouted && opt.cliModel === routeInfo.model;
            return (
              <button
                key={opt.id}
                className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
                onClick={() => handleSelect(opt)}
              >
                <div className={styles.optHeader}>
                  <span className={styles.optLabel}>{opt.label}</span>
                  <span className={styles.optCost}>{opt.costRatio}</span>
                </div>
                <div className={styles.optDesc}>{opt.description}</div>
                {mode && (
                  <div className={styles.optMode}>
                    {opt.tier === "lightweight" && "Chat / 轻量问答"}
                    {opt.tier === "mainstay" && "Agent / Plan / 编程"}
                    {opt.tier === "reasoning" && "Plan / 深度分析"}
                  </div>
                )}
                {isActive && !isRouted && (
                  <span className={styles.optCheck}>✓</span>
                )}
                {isRouted && <span className={styles.optRouted}>AUTO</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ModelSelector;
