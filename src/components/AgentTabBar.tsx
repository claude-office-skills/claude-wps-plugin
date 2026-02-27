import { memo } from "react";
import type { AgentState, AgentStatus } from "../types";
import styles from "./AgentTabBar.module.css";

interface AgentTabBarProps {
  agents: AgentState[];
  activeAgentId: string;
  onSwitch: (agentId: string) => void;
  onClose: (agentId: string) => void;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#888888",
  running: "#D97757",
  done: "#4ade80",
  failed: "#ef4444",
  paused: "#3b82f6",
};

function tabLabel(agent: AgentState): string {
  if (agent.name) {
    return agent.name.length > 10 ? agent.name.slice(0, 10) + "…" : agent.name;
  }
  return "新对话";
}

function AgentTabBar({
  agents,
  activeAgentId,
  onSwitch,
  onClose,
}: AgentTabBarProps) {
  const visibleAgents = agents.slice(0, 8);

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabs}>
        {visibleAgents.map((agent) => {
          const isActive = agent.id === activeAgentId;
          const isRunning = agent.status === "running";
          return (
            <button
              key={agent.id}
              className={`${styles.tab} ${isActive ? styles.active : ""}`}
              onClick={() => onSwitch(agent.id)}
              title={agent.name || "新对话"}
            >
              <span
                className={`${styles.statusDot} ${isRunning ? styles.pulsing : ""}`}
                style={{ backgroundColor: STATUS_COLORS[agent.status] }}
              />
              <span className={styles.tabLabel}>{tabLabel(agent)}</span>
              {agents.length > 1 && (
                <span
                  className={styles.closeTab}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(agent.id);
                  }}
                  title="关闭"
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(AgentTabBar);
