/**
 * AgentLoopRenderer — Thinking → Action → Observation 循环可视化
 *
 * 对应设计图 Frame 15_Thinking_Action_Loop_UX:
 * 用户发出请求后，AI 进入可见的推理-执行循环，整个过程透明、可追溯、可中断。
 *
 * 四个阶段：
 *   Thinking   — 推理思考中，显示扫光 + 思考内容
 *   Action     — 调用工具/写代码/操作表格
 *   Observation — 观察工具执行结果
 *   Response   — 最终回复用户
 */

import { memo, useState } from "react";
import type { ActivityEvent } from "../../types";
import styles from "./AgentLoopRenderer.module.css";

export type LoopPhase = "thinking" | "action" | "observation" | "response" | "idle";

export interface LoopStep {
  id: string;
  phase: LoopPhase;
  label: string;
  detail?: string;
  durationMs?: number;
  activity?: ActivityEvent;
  status: "running" | "done" | "error";
}

interface Props {
  steps: LoopStep[];
  currentPhase: LoopPhase;
  isActive: boolean;
  onAbort?: () => void;
}

const PHASE_CONFIG: Record<LoopPhase, { icon: string; color: string; label: string }> = {
  thinking: { icon: "◎", color: "#A78BFA", label: "Thinking" },
  action: { icon: "▸", color: "#D97757", label: "Action" },
  observation: { icon: "◉", color: "#2DD4BF", label: "Observation" },
  response: { icon: "◆", color: "#60A5FA", label: "Response" },
  idle: { icon: "○", color: "#666", label: "Idle" },
};

function LoopStepItem({ step, isLast }: { step: LoopStep; isLast: boolean }) {
  const config = PHASE_CONFIG[step.phase];
  const isRunning = step.status === "running";

  return (
    <div className={styles.stepItem}>
      <div className={styles.stepTimeline}>
        <span
          className={`${styles.stepDot} ${isRunning ? styles.stepDotActive : ""}`}
          style={{ color: config.color }}
        >
          {config.icon}
        </span>
        {!isLast && <div className={styles.stepLine} />}
      </div>
      <div className={styles.stepContent}>
        <div className={styles.stepHeader}>
          <span
            className={styles.phaseBadge}
            style={{ background: `${config.color}20`, color: config.color }}
          >
            {config.label}
          </span>
          <span className={styles.stepLabel}>{step.label}</span>
          {step.durationMs !== undefined && step.durationMs > 0 && (
            <span className={styles.stepDuration}>
              {step.durationMs < 1000
                ? `${step.durationMs}ms`
                : `${(step.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
        {step.detail && (
          <div className={styles.stepDetail}>{step.detail}</div>
        )}
      </div>
    </div>
  );
}

function AgentLoopRenderer({ steps, currentPhase, isActive, onAbort }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (steps.length === 0 && !isActive) return null;

  const config = PHASE_CONFIG[currentPhase];
  const runningCount = steps.filter((s) => s.status === "running").length;
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.header}
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className={styles.headerLeft}>
          {isActive && (
            <span className={styles.pulseIndicator} style={{ background: config.color }} />
          )}
          <span className={styles.headerTitle}>
            {isActive
              ? `${config.label}...`
              : `Agent Loop · ${doneCount} steps`}
          </span>
          {runningCount > 0 && (
            <span className={styles.runningBadge}>{runningCount} running</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {isActive && onAbort && (
            <button
              className={styles.abortBtn}
              onClick={(e) => {
                e.stopPropagation();
                onAbort();
              }}
            >
              Stop
            </button>
          )}
          <span className={styles.collapseIcon}>
            {collapsed ? "▸" : "▾"}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div className={styles.body}>
          {steps.map((step, i) => (
            <LoopStepItem
              key={step.id}
              step={step}
              isLast={i === steps.length - 1}
            />
          ))}
          {isActive && steps.length > 0 && (
            <div className={styles.activeIndicator}>
              <span className={styles.scanLine} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(AgentLoopRenderer);
