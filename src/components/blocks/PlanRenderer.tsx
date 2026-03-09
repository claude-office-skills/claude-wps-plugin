import { useState, useCallback, memo } from "react";
import type { PlanStep, PlanStepStatus } from "../../types";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";

interface Props {
  steps: PlanStep[];
  onStepsChange: (steps: PlanStep[]) => void;
  onConfirmPlan: (steps: PlanStep[]) => void;
  onExecuteStep?: (stepIndex: number) => void;
  onSkipStep?: (stepIndex: number) => void;
  readonly?: boolean;
}

const ICON_SIZE = 16;
const STROKE = "currentColor";

function IconCircle({ index }: { index: number }) {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--text-faint)"
        strokeWidth="1.2"
      />
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fill="var(--text-faint)"
        fontSize="8"
        fontFamily="inherit"
      >
        {index}
      </text>
    </svg>
  );
}

function IconRunning() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--brand-primary)"
        strokeWidth="1.2"
        strokeDasharray="4 2"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 8 8"
          to="360 8 8"
          dur="1.2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="8" cy="8" r="2" fill="var(--brand-primary)" />
    </svg>
  );
}

function IconSuccess() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--success-color, #4ade80)"
        strokeWidth="1.2"
        fill="var(--success-color, #4ade80)"
        fillOpacity="0.15"
      />
      <path
        d="M5 8.5L7 10.5L11 6"
        stroke="var(--success-color, #4ade80)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFailed() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--error-color, #f87171)"
        strokeWidth="1.2"
      />
      <path
        d="M6 6L10 10M10 6L6 10"
        stroke="var(--error-color, #f87171)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSkipped() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--text-faint)"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />
      <path
        d="M5 8H11"
        stroke="var(--text-faint)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 2L10 6L3 10V2Z"
        stroke={STROKE}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSkip() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 6H10"
        stroke={STROKE}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M7.5 2.5L9.5 4.5M2 10L2.5 7.5L9 1L11 3L4.5 9.5L2 10Z"
        stroke={STROKE}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDelete() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 3L9 9M9 3L3 9"
        stroke={STROKE}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 6.5L5 9.5L10 3"
        stroke={STROKE}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect
        x="3"
        y="2.5"
        width="10"
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M6 2.5V1.5A.5.5 0 016.5 1h3a.5.5 0 01.5.5v1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="5.5"
        y1="6"
        x2="10.5"
        y2="6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="5.5"
        y1="8.5"
        x2="10.5"
        y2="8.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="5.5"
        y1="11"
        x2="8.5"
        y2="11"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StepStatusIcon({
  status,
  index,
}: {
  status: PlanStepStatus;
  index: number;
}) {
  switch (status) {
    case "running":
      return <IconRunning />;
    case "success":
      return <IconSuccess />;
    case "failed":
      return <IconFailed />;
    case "skipped":
      return <IconSkipped />;
    default:
      return <IconCircle index={index} />;
  }
}

function PlanRenderer({
  steps,
  onStepsChange,
  onConfirmPlan,
  onExecuteStep,
  onSkipStep,
  readonly,
}: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const doneCount = steps.filter(
    (s) => s.status === "success" || s.done,
  ).length;
  const totalCount = steps.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const handleToggleDone = useCallback(
    (idx: number) => {
      if (readonly) return;
      const updated = steps.map((s) =>
        s.index === idx ? { ...s, done: !s.done } : s,
      );
      onStepsChange(updated);
    },
    [steps, onStepsChange, readonly],
  );

  const handleStartEdit = useCallback(
    (idx: number, text: string) => {
      if (readonly) return;
      setEditingIdx(idx);
      setEditText(text);
    },
    [readonly],
  );

  const handleSaveEdit = useCallback(() => {
    if (editingIdx === null) return;
    const updated = steps.map((s) =>
      s.index === editingIdx ? { ...s, text: editText } : s,
    );
    onStepsChange(updated);
    setEditingIdx(null);
  }, [editingIdx, editText, steps, onStepsChange]);

  const handleDelete = useCallback(
    (idx: number) => {
      const updated = steps
        .filter((s) => s.index !== idx)
        .map((s, i) => ({ ...s, index: i + 1 }));
      onStepsChange(updated);
    },
    [steps, onStepsChange],
  );

  const handleAddStep = useCallback(() => {
    const newStep: PlanStep = {
      index: steps.length + 1,
      text: "新步骤",
      done: false,
      status: "pending",
    };
    onStepsChange([...steps, newStep]);
  }, [steps, onStepsChange]);

  const isAnyRunning = steps.some((s) => s.status === "running");
  const blockStatus = isAnyRunning
    ? ("running" as const)
    : doneCount === totalCount && totalCount > 0
      ? ("success" as const)
      : ("idle" as const);

  const footer = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <div className={blockStyles.progressBar}>
          <div
            className={blockStyles.progressFill}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className={blockStyles.footerInfo}>
          {doneCount}/{totalCount}
        </span>
      </div>
      {!readonly && (
        <div className={blockStyles.footerActions}>
          <button className={blockStyles.actionBtn} onClick={handleAddStep}>
            + 添加
          </button>
          <button
            className={`${blockStyles.actionBtn} ${blockStyles.actionBtnPrimary}`}
            onClick={() => onConfirmPlan(steps)}
            disabled={isAnyRunning}
          >
            <IconPlay /> 全部执行
          </button>
        </div>
      )}
    </>
  );

  return (
    <SidebarBlock
      type="plan-steps"
      status={blockStatus}
      title="执行计划"
      badge={`${doneCount}/${totalCount}`}
      iconNode={<IconClipboard />}
      footer={footer}
    >
      <div style={{ padding: "4px 0" }}>
        {steps.map((step) => {
          const effectiveStatus: PlanStepStatus =
            step.status ?? (step.done ? "success" : "pending");
          const isDone = effectiveStatus === "success";
          const isSkippedOrFailed =
            effectiveStatus === "skipped" || effectiveStatus === "failed";

          return (
            <div
              key={step.index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 14px",
                minHeight: 28,
                opacity: isSkippedOrFailed ? 0.5 : 1,
              }}
            >
              <button
                className={`${blockStyles.stepDot} ${
                  effectiveStatus === "running"
                    ? blockStyles.stepRunning
                    : effectiveStatus === "success"
                      ? blockStyles.stepSuccess
                      : effectiveStatus === "failed"
                        ? blockStyles.stepFailed
                        : effectiveStatus === "skipped"
                          ? blockStyles.stepSkipped
                          : blockStyles.stepPending
                }`}
                onClick={() => handleToggleDone(step.index)}
                disabled={readonly}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "none",
                  border: "none",
                  cursor: readonly ? "default" : "pointer",
                  padding: 0,
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                }}
              >
                <StepStatusIcon status={effectiveStatus} index={step.index} />
              </button>

              {editingIdx === step.index ? (
                <div style={{ display: "flex", gap: 4, flex: 1 }}>
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") setEditingIdx(null);
                    }}
                    autoFocus
                    style={{
                      flex: 1,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: 4,
                      color: "var(--text-primary)",
                      padding: "2px 6px",
                      fontSize: 11,
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    className={blockStyles.iconBtn}
                    onClick={handleSaveEdit}
                  >
                    <IconCheck />
                  </button>
                  <button
                    className={blockStyles.iconBtn}
                    onClick={() => setEditingIdx(null)}
                  >
                    <IconDelete />
                  </button>
                </div>
              ) : (
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: isDone
                      ? "var(--text-faint)"
                      : isSkippedOrFailed
                        ? "var(--text-faint)"
                        : "var(--text-secondary)",
                    textDecoration:
                      isDone || effectiveStatus === "skipped"
                        ? "line-through"
                        : "none",
                    cursor: readonly ? "default" : "text",
                  }}
                  onDoubleClick={() => handleStartEdit(step.index, step.text)}
                >
                  {step.text}
                </span>
              )}

              {!readonly && editingIdx !== step.index && (
                <div
                  style={{
                    display: "flex",
                    gap: 2,
                    flexShrink: 0,
                    alignItems: "center",
                  }}
                >
                  {onExecuteStep && effectiveStatus === "pending" && (
                    <button
                      className={blockStyles.actionBtn}
                      onClick={() => onExecuteStep(step.index)}
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                      title="执行此步骤"
                    >
                      <IconPlay />
                    </button>
                  )}
                  {onSkipStep && effectiveStatus === "pending" && (
                    <button
                      className={blockStyles.iconBtn}
                      onClick={() => onSkipStep(step.index)}
                      title="跳过"
                    >
                      <IconSkip />
                    </button>
                  )}
                  {effectiveStatus === "pending" && (
                    <button
                      className={blockStyles.iconBtn}
                      onClick={() => handleStartEdit(step.index, step.text)}
                      title="编辑"
                    >
                      <IconEdit />
                    </button>
                  )}
                  {effectiveStatus === "pending" && (
                    <button
                      className={blockStyles.iconBtn}
                      onClick={() => handleDelete(step.index)}
                      title="删除"
                    >
                      <IconDelete />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SidebarBlock>
  );
}

export default memo(PlanRenderer);
