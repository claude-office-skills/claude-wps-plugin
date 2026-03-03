import { useState, useCallback, useRef } from "react";
import type { PlanStep, PlanStepStatus } from "../types";

const PROXY = "http://127.0.0.1:3001";

interface PlanState {
  steps: PlanStep[];
  currentStep: number;
  status: "idle" | "running" | "done";
}

interface UsePlanReturn {
  plan: PlanState;
  setSteps: (steps: PlanStep[]) => void;
  executeStep: (stepIndex: number, code?: string, language?: string) => Promise<void>;
  executeAll: (getCodeForStep?: (step: PlanStep) => { code: string; language: string } | null) => Promise<void>;
  skipStep: (stepIndex: number) => void;
  resetPlan: () => void;
  savePlan: (sessionId: string) => Promise<void>;
  loadPlan: (sessionId: string) => Promise<void>;
  parsePlanFromContent: (content: string, codeBlocks?: { id: string; language: string; code: string }[]) => Promise<PlanStep[]>;
}

export function usePlan(sessionId: string): UsePlanReturn {
  const [plan, setPlan] = useState<PlanState>({
    steps: [],
    currentStep: 0,
    status: "idle",
  });
  const abortRef = useRef(false);

  const setSteps = useCallback((steps: PlanStep[]) => {
    setPlan((prev) => ({ ...prev, steps }));
  }, []);

  const updateStep = useCallback(
    (stepIndex: number, update: Partial<PlanStep>) => {
      setPlan((prev) => ({
        ...prev,
        steps: prev.steps.map((s) =>
          s.index === stepIndex ? { ...s, ...update } : s,
        ),
      }));
    },
    [],
  );

  const executeStep = useCallback(
    async (stepIndex: number, code?: string, language?: string) => {
      updateStep(stepIndex, { status: "running" as PlanStepStatus });
      setPlan((prev) => ({ ...prev, currentStep: stepIndex, status: "running" }));

      try {
        const resp = await fetch(`${PROXY}/v2/plan/execute-step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, stepIndex, code, language }),
        });
        const data = await resp.json();
        if (data.ok && data.step) {
          updateStep(stepIndex, {
            status: data.step.status,
            done: data.step.done,
            result: data.step.result,
            error: data.step.error,
          });
        } else {
          updateStep(stepIndex, {
            status: "failed" as PlanStepStatus,
            error: data.error || "Unknown error",
          });
        }
      } catch (err) {
        updateStep(stepIndex, {
          status: "failed" as PlanStepStatus,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPlan((prev) => ({ ...prev, status: "idle" }));
      }
    },
    [sessionId, updateStep],
  );

  const executeAll = useCallback(
    async (
      getCodeForStep?: (step: PlanStep) => { code: string; language: string } | null,
    ) => {
      abortRef.current = false;
      const pending = plan.steps.filter(
        (s) => s.status === "pending" || s.status === undefined,
      );
      for (const step of pending) {
        if (abortRef.current) break;
        const codeInfo = getCodeForStep?.(step);
        await executeStep(step.index, codeInfo?.code, codeInfo?.language);
      }
      setPlan((prev) => ({ ...prev, status: "done" }));
    },
    [plan.steps, executeStep],
  );

  const skipStep = useCallback(
    (stepIndex: number) => {
      updateStep(stepIndex, { status: "skipped" as PlanStepStatus, done: false });
      fetch(`${PROXY}/v2/plan/skip-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, stepIndex }),
      }).catch(() => {});
    },
    [sessionId, updateStep],
  );

  const resetPlan = useCallback(() => {
    abortRef.current = true;
    setPlan({ steps: [], currentStep: 0, status: "idle" });
  }, []);

  const savePlan = useCallback(
    async (sid: string) => {
      await fetch(`${PROXY}/v2/plan/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          steps: plan.steps,
          currentStep: plan.currentStep,
        }),
      });
    },
    [plan],
  );

  const loadPlan = useCallback(async (sid: string) => {
    try {
      const resp = await fetch(`${PROXY}/v2/plan/status/${sid}`);
      if (resp.ok) {
        const data = await resp.json();
        setPlan({
          steps: data.steps || [],
          currentStep: data.currentStep || 0,
          status: data.status || "idle",
        });
      }
    } catch {
      // Plan not found, ignore
    }
  }, []);

  const parsePlanFromContent = useCallback(
    async (
      content: string,
      codeBlocks?: { id: string; language: string; code: string }[],
    ): Promise<PlanStep[]> => {
      try {
        const resp = await fetch(`${PROXY}/v2/plan/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, codeBlocks }),
        });
        const data = await resp.json();
        const steps = (data.steps || []).map((s: PlanStep) => ({
          ...s,
          status: "pending" as PlanStepStatus,
        }));
        setPlan((prev) => ({ ...prev, steps }));
        return steps;
      } catch {
        return [];
      }
    },
    [],
  );

  return {
    plan,
    setSteps,
    executeStep,
    executeAll,
    skipStep,
    resetPlan,
    savePlan,
    loadPlan,
    parsePlanFromContent,
  };
}
