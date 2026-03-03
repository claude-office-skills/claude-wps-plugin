import { useState, useCallback, useRef, useEffect } from "react";
import { nanoid } from "nanoid";
import type {
  AgentState,
  AgentStatus,
  ChatMessage,
  InteractionMode,
} from "../types";

const STORAGE_KEY = "wps-claude-agents-v2";
const MAX_PERSISTED_AGENTS = 20;
const MAX_AGENTS = 12;
const MAX_CONCURRENT_RUNNING = 3;
const MAX_MESSAGES_PER_AGENT = 100;

function buildWelcomeContent(): string {
  try {
    const profileStr = localStorage.getItem("wps-claude-profile");
    if (profileStr) {
      const profile = JSON.parse(profileStr);
      const name = profile.assistantName || "小金";
      const userName = profile.name;
      if (userName) {
        return `${userName}，我是${name}。有什么需要帮忙的，直接说。`;
      }
      return `你好，我是${name}，你的专属工作助理。选中数据区域，告诉我你需要什么。`;
    }
  } catch {
    /* fallback */
  }
  return "你好，我是你的专属工作助理。\n\n选中一个数据区域，告诉我你需要什么帮助。";
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: buildWelcomeContent(),
  timestamp: Date.now(),
};

function createAgent(overrides?: Partial<AgentState>): AgentState {
  const now = Date.now();
  return {
    id: nanoid(),
    name: "",
    status: "idle",
    messages: [
      { ...WELCOME_MESSAGE, id: `welcome-${nanoid(6)}`, timestamp: now },
    ],
    mode:
      (localStorage.getItem("wps-claude-mode") as InteractionMode) || "agent",
    model: "claude-sonnet-4-6",
    createdAt: now,
    updatedAt: now,
    agentRef: undefined,
    agentColor: undefined,
    ...overrides,
  };
}

interface PersistedState {
  agents: AgentState[];
  activeAgentId: string;
}

function loadPersistedAgents(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(data.agents) || data.agents.length === 0) return null;
    const restored = data.agents.map((a) => ({
      ...a,
      status: (a.status === "running" ? "paused" : a.status) as AgentStatus,
    }));
    return { agents: restored, activeAgentId: data.activeAgentId };
  } catch {
    return null;
  }
}

const MAX_MSG_CONTENT_CHARS = 3000;
const MAX_STORAGE_BYTES = 3.5 * 1024 * 1024; // 3.5 MB safety limit (localStorage is typically 5 MB)

/** Strip heavy fields from a message before persisting (content, code blobs, diffs) */
function slimMessage(
  m: import("../types").ChatMessage,
): import("../types").ChatMessage {
  const content =
    m.content.length > MAX_MSG_CONTENT_CHARS
      ? m.content.slice(0, MAX_MSG_CONTENT_CHARS) + "\n…[已截断]"
      : m.content;
  const slimBlocks = (m.codeBlocks ?? []).map((b) => ({
    ...b,
    code:
      b.code.length > 500
        ? b.code.slice(0, 500) + "\n/* …truncated… */"
        : b.code,
    diff: b.diff
      ? {
          sheetName: b.diff.sheetName,
          changeCount: b.diff.changeCount,
          changes: [],
          hasMore: b.diff.hasMore,
        }
      : b.diff,
  }));
  return {
    ...m,
    content,
    thinkingContent: undefined,
    codeBlocks: slimBlocks,
  };
}

function serializeAgents(agents: AgentState[], activeAgentId: string): string {
  return JSON.stringify({
    agents: agents.map((a) => ({
      ...a,
      messages: a.messages.map(slimMessage),
    })),
    activeAgentId,
  });
}

function persistAgents(agents: AgentState[], activeAgentId: string): void {
  // Sort: active agent first, then by most-recently-updated, cap at MAX_PERSISTED_AGENTS
  const sorted = [
    ...agents.filter((a) => a.id === activeAgentId),
    ...agents
      .filter((a) => a.id !== activeAgentId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  ].slice(0, MAX_PERSISTED_AGENTS);

  // Progressively reduce until payload fits within storage budget
  let subset = sorted;
  while (subset.length > 0) {
    try {
      const payload = serializeAgents(subset, activeAgentId);
      if (payload.length > MAX_STORAGE_BYTES && subset.length > 1) {
        // Too large: drop the oldest half of non-active agents
        const active = subset.filter((a) => a.id === activeAgentId);
        const rest = subset.filter((a) => a.id !== activeAgentId);
        subset = [
          ...active,
          ...rest.slice(0, Math.max(1, Math.floor(rest.length * 0.6))),
        ];
        continue;
      }
      localStorage.setItem(STORAGE_KEY, payload);
      return;
    } catch {
      if (subset.length <= 1) break;
      const active = subset.filter((a) => a.id === activeAgentId);
      const rest = subset.filter((a) => a.id !== activeAgentId);
      subset = [
        ...active,
        ...rest.slice(0, Math.max(0, Math.floor(rest.length * 0.6))),
      ];
    }
  }

  // Last resort: active agent only
  try {
    const active = agents.find((a) => a.id === activeAgentId);
    if (active) {
      const fallback = serializeAgents([active], activeAgentId);
      localStorage.setItem(STORAGE_KEY, fallback);
    }
  } catch {
    /* truly full */
  }
}

export interface AgentManagerActions {
  createNewAgent: () => string;
  switchAgent: (agentId: string) => void;
  removeAgent: (agentId: string) => void;
  updateActiveMessages: (
    updater: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  updateAgentMessages: (
    agentId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  setActiveStatus: (status: AgentStatus, error?: string) => void;
  setAgentStatus: (
    agentId: string,
    status: AgentStatus,
    error?: string,
  ) => void;
  setActiveName: (name: string) => void;
  setAgentName: (agentId: string, name: string) => void;
  setActiveMode: (mode: InteractionMode) => void;
  setActiveModel: (model: string) => void;
  setActiveAgentRef: (
    agentRef: string | undefined,
    agentColor?: string,
  ) => void;
  getAgent: (agentId: string) => AgentState | undefined;
  /** Per-agent AbortController for parallel requests */
  createAbortController: (agentId: string) => AbortController;
  abortAgent: (agentId: string) => void;
  getAbortController: (agentId: string) => AbortController | undefined;
  isAgentLoading: (agentId: string) => boolean;
  /** Returns count of currently running agents */
  runningCount: () => number;
  /** Whether a new request can be started (under concurrency limit) */
  canStartRequest: () => boolean;
  /** Prune old idle agents to keep total under MAX_AGENTS */
  pruneIdleAgents: () => void;
  /** Trim messages for an agent to MAX_MESSAGES_PER_AGENT */
  trimAgentMessages: (agentId: string) => void;
  /** Concurrency & resource limits for UI display */
  limits: { maxConcurrent: number; maxAgents: number; maxMessages: number };
  loadAgentsFromSessions: (
    sessions: Array<{
      id: string;
      title: string;
      messages: ChatMessage[];
      model?: string;
      mode?: string;
      updatedAt?: number;
      createdAt?: number;
    }>,
  ) => void;
}

export interface AgentManagerState {
  agents: AgentState[];
  activeAgentId: string;
  activeAgent: AgentState;
  runningAgentCount: number;
}

export function useAgentManager(): AgentManagerState & AgentManagerActions {
  const [agents, setAgents] = useState<AgentState[]>(() => {
    const persisted = loadPersistedAgents();
    return persisted ? persisted.agents : [createAgent()];
  });
  const [activeAgentId, setActiveAgentId] = useState<string>(() => {
    const persisted = loadPersistedAgents();
    return persisted?.activeAgentId ?? agents[0]?.id ?? "";
  });

  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const activeAgentIdRef = useRef(activeAgentId);
  activeAgentIdRef.current = activeAgentId;

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Immediately persist when app closes (beforeunload + unmount fallback)
  useEffect(() => {
    const flush = () => {
      const cur = agentsRef.current;
      const hasStreaming = cur.some((a) =>
        a.messages.some((m) => m.isStreaming),
      );
      if (!hasStreaming) persistAgents(cur, activeAgentIdRef.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush(); // also save synchronously on unmount
    };
  }, []); // runs once, uses refs so always sees latest state

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const hasStreaming = agents.some((a) =>
        a.messages.some((m) => m.isStreaming),
      );
      if (!hasStreaming) {
        persistAgents(agents, activeAgentId);
      }
    }, 500);
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      // No longer cancel without saving — beforeunload effect handles final flush
    };
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0];

  const createNewAgent = useCallback((): string => {
    const agent = createAgent();
    setAgents((prev) => [agent, ...prev]);
    setActiveAgentId(agent.id);
    return agent.id;
  }, []);

  const switchAgent = useCallback((agentId: string) => {
    const exists = agentsRef.current.some((a) => a.id === agentId);
    if (exists) {
      setActiveAgentId(agentId);
    }
  }, []);

  const removeAgent = useCallback((agentId: string) => {
    const ctrl = abortControllersRef.current.get(agentId);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(agentId);
    }
    setAgents((prev) => {
      const filtered = prev.filter((a) => a.id !== agentId);
      if (filtered.length === 0) {
        const fresh = createAgent();
        return [fresh];
      }
      return filtered;
    });
    setActiveAgentId((prevId) => {
      if (prevId === agentId) {
        const remaining = agentsRef.current.filter((a) => a.id !== agentId);
        return remaining[0]?.id ?? "";
      }
      return prevId;
    });
  }, []);

  const updateAgent = useCallback(
    (agentId: string, patch: Partial<AgentState>) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agentId ? { ...a, ...patch, updatedAt: Date.now() } : a,
        ),
      );
    },
    [],
  );

  const updateActiveMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === activeAgentId
            ? { ...a, messages: updater(a.messages), updatedAt: Date.now() }
            : a,
        ),
      );
    },
    [activeAgentId],
  );

  const updateAgentMessages = useCallback(
    (agentId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agentId
            ? { ...a, messages: updater(a.messages), updatedAt: Date.now() }
            : a,
        ),
      );
    },
    [],
  );

  const setActiveStatus = useCallback(
    (status: AgentStatus, error?: string) => {
      updateAgent(activeAgentId, { status, error });
    },
    [activeAgentId, updateAgent],
  );

  const setAgentStatus = useCallback(
    (agentId: string, status: AgentStatus, error?: string) => {
      updateAgent(agentId, { status, error });
    },
    [updateAgent],
  );

  const setActiveName = useCallback(
    (name: string) => {
      updateAgent(activeAgentId, { name });
    },
    [activeAgentId, updateAgent],
  );

  const setAgentName = useCallback(
    (agentId: string, name: string) => {
      updateAgent(agentId, { name });
    },
    [updateAgent],
  );

  const createAbortController = useCallback((agentId: string) => {
    const existing = abortControllersRef.current.get(agentId);
    if (existing) existing.abort();
    const controller = new AbortController();
    abortControllersRef.current.set(agentId, controller);
    return controller;
  }, []);

  const abortAgent = useCallback((agentId: string) => {
    const ctrl = abortControllersRef.current.get(agentId);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(agentId);
    }
  }, []);

  const getAbortController = useCallback((agentId: string) => {
    return abortControllersRef.current.get(agentId);
  }, []);

  const isAgentLoading = useCallback((agentId: string) => {
    return agentsRef.current.some(
      (a) => a.id === agentId && a.status === "running",
    );
  }, []);

  const runningCount = useCallback(() => {
    return agentsRef.current.filter((a) => a.status === "running").length;
  }, []);

  const canStartRequest = useCallback(() => {
    return (
      agentsRef.current.filter((a) => a.status === "running").length <
      MAX_CONCURRENT_RUNNING
    );
  }, []);

  const runningAgentCount = agents.filter((a) => a.status === "running").length;

  const pruneIdleAgents = useCallback(() => {
    setAgents((prev) => {
      if (prev.length <= MAX_AGENTS) return prev;
      const running = prev.filter((a) => a.status === "running");
      const nonRunning = prev.filter((a) => a.status !== "running");
      nonRunning.sort((a, b) => b.updatedAt - a.updatedAt);
      const kept = nonRunning.slice(0, MAX_AGENTS - running.length);
      return [...running, ...kept].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const trimAgentMessages = useCallback((agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== agentId || a.messages.length <= MAX_MESSAGES_PER_AGENT)
          return a;
        const trimmed = a.messages.slice(-MAX_MESSAGES_PER_AGENT);
        return { ...a, messages: trimmed, updatedAt: Date.now() };
      }),
    );
  }, []);

  const limits = {
    maxConcurrent: MAX_CONCURRENT_RUNNING,
    maxAgents: MAX_AGENTS,
    maxMessages: MAX_MESSAGES_PER_AGENT,
  };

  const setActiveMode = useCallback(
    (mode: InteractionMode) => {
      updateAgent(activeAgentId, { mode });
      localStorage.setItem("wps-claude-mode", mode);
    },
    [activeAgentId, updateAgent],
  );

  const setActiveModel = useCallback(
    (model: string) => {
      updateAgent(activeAgentId, { model });
    },
    [activeAgentId, updateAgent],
  );

  const setActiveAgentRef = useCallback(
    (agentRef: string | undefined, agentColor?: string) => {
      updateAgent(activeAgentId, { agentRef, agentColor });
    },
    [activeAgentId, updateAgent],
  );

  const getAgent = useCallback(
    (agentId: string) => agentsRef.current.find((a) => a.id === agentId),
    [],
  );

  const loadAgentsFromSessions = useCallback(
    (
      sessions: Array<{
        id: string;
        title: string;
        messages: ChatMessage[];
        model?: string;
        mode?: string;
        updatedAt?: number;
        createdAt?: number;
      }>,
    ) => {
      if (sessions.length === 0) return;

      const loaded: AgentState[] = sessions.map((s) => ({
        id: s.id,
        name: s.title || "",
        status: "done" as AgentStatus,
        messages: s.messages,
        mode: (s.mode as InteractionMode) || "agent",
        model: s.model || "claude-sonnet-4-6",
        createdAt: s.createdAt || Date.now(),
        updatedAt: s.updatedAt || Date.now(),
        agentRef: undefined,
        agentColor: undefined,
      }));

      setAgents(loaded);
      setActiveAgentId(loaded[0].id);
    },
    [],
  );

  return {
    agents,
    activeAgentId,
    activeAgent,
    runningAgentCount,
    createNewAgent,
    switchAgent,
    removeAgent,
    updateActiveMessages,
    updateAgentMessages,
    setActiveStatus,
    setAgentStatus,
    setActiveName,
    setAgentName,
    setActiveMode,
    setActiveModel,
    setActiveAgentRef,
    getAgent,
    createAbortController,
    abortAgent,
    getAbortController,
    isAgentLoading,
    runningCount,
    canStartRequest,
    pruneIdleAgents,
    trimAgentMessages,
    limits,
    loadAgentsFromSessions,
  };
}
