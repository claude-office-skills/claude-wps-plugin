import { useState, useCallback, memo } from "react";
import type { PlanStep } from "../types";
import styles from "./PlanEditor.module.css";

interface Props {
  steps: PlanStep[];
  onStepsChange: (steps: PlanStep[]) => void;
  onConfirmPlan: (steps: PlanStep[]) => void;
  readonly?: boolean;
}

function PlanEditor({ steps, onStepsChange, onConfirmPlan, readonly }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

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
    setEditText("");
  }, [editingIdx, editText, steps, onStepsChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingIdx(null);
    setEditText("");
  }, []);

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
    };
    onStepsChange([...steps, newStep]);
  }, [steps, onStepsChange]);

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.icon}>📋</span>
        <span className={styles.title}>执行计划</span>
        <span className={styles.progress}>
          {doneCount}/{steps.length}
        </span>
      </div>

      <div className={styles.stepList}>
        {steps.map((step) => (
          <div
            key={step.index}
            className={`${styles.stepRow} ${step.done ? styles.stepDone : ""}`}
          >
            <button
              className={styles.checkbox}
              onClick={() => handleToggleDone(step.index)}
              disabled={readonly}
            >
              {step.done ? "✓" : step.index}
            </button>

            {editingIdx === step.index ? (
              <div className={styles.editRow}>
                <input
                  className={styles.editInput}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit();
                    if (e.key === "Escape") handleCancelEdit();
                  }}
                  autoFocus
                />
                <button className={styles.editBtn} onClick={handleSaveEdit}>
                  ✓
                </button>
                <button className={styles.editBtn} onClick={handleCancelEdit}>
                  ✕
                </button>
              </div>
            ) : (
              <span
                className={styles.stepText}
                onDoubleClick={() => handleStartEdit(step.index, step.text)}
              >
                {step.text}
              </span>
            )}

            {!readonly && editingIdx !== step.index && (
              <div className={styles.stepActions}>
                <button
                  className={styles.miniBtn}
                  onClick={() => handleStartEdit(step.index, step.text)}
                  title="编辑"
                >
                  ✎
                </button>
                <button
                  className={styles.miniBtn}
                  onClick={() => handleDelete(step.index)}
                  title="删除"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!readonly && (
        <div className={styles.footer}>
          <button className={styles.addBtn} onClick={handleAddStep}>
            + 添加步骤
          </button>
          <button
            className={styles.confirmBtn}
            onClick={() => onConfirmPlan(steps)}
          >
            ▶ 确认并执行
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(PlanEditor);
