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

function stepStatusClass(status: PlanStepStatus | undefined): string {
  switch (status) {
    case "running": return blockStyles.stepRunning;
    case "success": return blockStyles.stepSuccess;
    case "failed": return blockStyles.stepFailed;
    case "skipped": return blockStyles.stepSkipped;
    default: return blockStyles.stepPending;
  }
}

function stepStatusIcon(status: PlanStepStatus | undefined, index: number): string {
  switch (status) {
    case "running": return "◎";
    case "success": return "✓";
    case "failed": return "✗";
    case "skipped": return "–";
    default: return String(index);
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
          >
            ▶ 全部执行
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
      footer={footer}
    >
      <div style={{ padding: "4px 0" }}>
        {steps.map((step) => {
          const effectiveStatus: PlanStepStatus =
            step.status ?? (step.done ? "success" : "pending");

          return (
            <div
              key={step.index}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 14px",
                minHeight: 28,
              }}
            >
              <button
                className={`${blockStyles.stepDot} ${stepStatusClass(effectiveStatus)}`}
                onClick={() => handleToggleDone(step.index)}
                disabled={readonly}
              >
                {stepStatusIcon(effectiveStatus, step.index)}
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
                  <button className={blockStyles.iconBtn} onClick={handleSaveEdit}>✓</button>
                  <button className={blockStyles.iconBtn} onClick={() => setEditingIdx(null)}>✕</button>
                </div>
              ) : (
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color:
                      effectiveStatus === "skipped"
                        ? "var(--text-faint)"
                        : "var(--text-secondary)",
                    textDecoration:
                      effectiveStatus === "skipped" ? "line-through" : "none",
                    cursor: readonly ? "default" : "text",
                  }}
                  onDoubleClick={() => handleStartEdit(step.index, step.text)}
                >
                  {step.text}
                </span>
              )}

              {!readonly && editingIdx !== step.index && (
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  {onExecuteStep && effectiveStatus === "pending" && (
                    <button
                      className={blockStyles.actionBtn}
                      onClick={() => onExecuteStep(step.index)}
                      style={{ fontSize: 9, padding: "1px 6px" }}
                    >
                      ▶
                    </button>
                  )}
                  {onSkipStep && effectiveStatus === "pending" && (
                    <button
                      className={blockStyles.iconBtn}
                      onClick={() => onSkipStep(step.index)}
                      title="跳过"
                    >
                      –
                    </button>
                  )}
                  <button
                    className={blockStyles.iconBtn}
                    onClick={() => handleStartEdit(step.index, step.text)}
                    title="编辑"
                  >
                    ✎
                  </button>
                  <button
                    className={blockStyles.iconBtn}
                    onClick={() => handleDelete(step.index)}
                    title="删除"
                  >
                    ✕
                  </button>
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
