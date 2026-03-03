/**
 * AgentEffects — Agent 工作状态动效系统
 *
 * 对应设计图 Frame 17_Agent_Loading_Animation_UX:
 * 6 种动效类型:
 *   1. ScanLine     — 扫光效果（消息生成中）
 *   2. SkeletonLine — 骨架屏行（等待内容加载）
 *   3. PulseOrb     — 脉冲光球（思考中）
 *   4. StatusBar    — 全局状态条（顶部/底部指示器）
 *   5. TypeWriter   — 打字光标（流式输出指示）
 *   6. ProgressRing — 环形进度（长任务百分比）
 */

import { memo } from "react";
import styles from "./AgentEffects.module.css";

/** 扫光效果 */
export const ScanLine = memo(function ScanLine({ active = true }: { active?: boolean }) {
  if (!active) return null;
  return (
    <div className={styles.scanLineTrack}>
      <div className={styles.scanLineGlow} />
    </div>
  );
});

/** 骨架屏行 */
export const SkeletonLine = memo(function SkeletonLine({
  lines = 3,
  widths,
}: {
  lines?: number;
  widths?: string[];
}) {
  const defaultWidths = ["85%", "60%", "70%", "45%", "90%"];
  return (
    <div className={styles.skeletonWrap}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={styles.skeletonBar}
          style={{ width: widths?.[i] || defaultWidths[i % defaultWidths.length] }}
        />
      ))}
    </div>
  );
});

/** 脉冲光球 */
export const PulseOrb = memo(function PulseOrb({
  color = "var(--accent)",
  size = 8,
  label,
}: {
  color?: string;
  size?: number;
  label?: string;
}) {
  return (
    <span className={styles.pulseOrbWrap}>
      <span
        className={styles.pulseOrb}
        style={{ width: size, height: size, background: color }}
      />
      {label && <span className={styles.pulseLabel}>{label}</span>}
    </span>
  );
});

/** 全局状态条 */
export const StatusBar = memo(function StatusBar({
  phase,
  active = true,
}: {
  phase: "thinking" | "executing" | "observing" | "complete";
  active?: boolean;
}) {
  if (!active) return null;

  const colors: Record<string, string> = {
    thinking: "#A78BFA",
    executing: "#D97757",
    observing: "#2DD4BF",
    complete: "#34D399",
  };

  return (
    <div className={styles.statusBar}>
      <div
        className={phase === "complete" ? styles.statusFillDone : styles.statusFillActive}
        style={{ background: colors[phase] }}
      />
    </div>
  );
});

/** 打字光标 */
export const TypeCursor = memo(function TypeCursor({
  active = true,
}: {
  active?: boolean;
}) {
  if (!active) return null;
  return <span className={styles.typeCursor} />;
});

/** 环形进度 */
export const ProgressRing = memo(function ProgressRing({
  progress,
  size = 20,
  strokeWidth = 2,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <svg width={size} height={size} className={styles.progressRing}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={styles.progressRingFill}
      />
    </svg>
  );
});
