import { useState, useCallback, useRef, useEffect } from "react";

const PROXY = "http://127.0.0.1:3001";

export interface LongTaskEvent {
  type: string;
  taskId: string;
  timestamp: number;
  phase?: string;
  message?: string;
  current?: number;
  total?: number;
  result?: unknown;
  error?: string;
}

export interface LongTaskState {
  taskId: string | null;
  status: "idle" | "running" | "completed" | "failed" | "aborted";
  events: LongTaskEvent[];
  result: unknown;
  error: string | null;
  progress: {
    phase: string;
    message: string;
    current?: number;
    total?: number;
  } | null;
}

interface UseLongTaskReturn {
  task: LongTaskState;
  startAction: (
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<string>;
  startWorkflow: (
    workflowPath: string,
    inputs?: Record<string, unknown>,
  ) => Promise<string>;
  abort: () => Promise<void>;
  reset: () => void;
}

const INITIAL_STATE: LongTaskState = {
  taskId: null,
  status: "idle",
  events: [],
  result: null,
  error: null,
  progress: null,
};

export function useLongTask(): UseLongTaskReturn {
  const [task, setTask] = useState<LongTaskState>(INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connectSSE = useCallback((taskId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${PROXY}/long-task/events/${taskId}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt: LongTaskEvent = JSON.parse(e.data);

        setTask((prev) => {
          const updated = { ...prev, events: [...prev.events, evt] };

          if (evt.type === "task.progress") {
            updated.progress = {
              phase: evt.phase || "",
              message: evt.message || "",
              current: evt.current,
              total: evt.total,
            };
          }

          if (evt.type === "task.done") {
            updated.status = "completed";
            updated.result = evt.result;
          } else if (evt.type === "task.error") {
            updated.status = "failed";
            updated.error = evt.error || "Unknown error";
          } else if (evt.type === "task.aborted") {
            updated.status = "aborted";
          }

          return updated;
        });

        if (
          evt.type === "task.done" ||
          evt.type === "task.error" ||
          evt.type === "task.aborted"
        ) {
          es.close();
          eventSourceRef.current = null;
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const startAction = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      const resp = await fetch(`${PROXY}/long-task/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error);

      setTask({
        ...INITIAL_STATE,
        taskId: data.taskId,
        status: "running",
      });
      connectSSE(data.taskId);
      return data.taskId;
    },
    [connectSSE],
  );

  const startWorkflow = useCallback(
    async (workflowPath: string, inputs: Record<string, unknown> = {}) => {
      const resp = await fetch(`${PROXY}/long-task/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: workflowPath, inputs }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error);

      setTask({
        ...INITIAL_STATE,
        taskId: data.taskId,
        status: "running",
      });
      connectSSE(data.taskId);
      return data.taskId;
    },
    [connectSSE],
  );

  const abort = useCallback(async () => {
    if (!task.taskId) return;
    await fetch(`${PROXY}/long-task/abort/${task.taskId}`, { method: "POST" });
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setTask((prev) => ({ ...prev, status: "aborted" }));
  }, [task.taskId]);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setTask(INITIAL_STATE);
  }, []);

  return { task, startAction, startWorkflow, abort, reset };
}
