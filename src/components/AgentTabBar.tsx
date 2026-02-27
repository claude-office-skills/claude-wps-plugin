import { memo } from "react";
import type { AgentState, AgentStatus } from "../types";
import styles from "./AgentTabBar.module.css";

interface AgentTabBarProps {
  agents: AgentState[];
  activeAgentId: string;
  onSwitch: (agentId: string) => void;
  onClose: (agentId: string) => void;
  onNew: () => void;
  onToggleList: () => void;
  listExpanded: boolean;
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
    return agent.name.length > 8 ? agent.name.slice(0, 8) + "…" : agent.name;
  }
  return "新对话";
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function AgentTabBar({
  agents,
  activeAgentId,
  onSwitch,
  onClose,
  onNew,
  onToggleList,
  listExpanded,
}: AgentTabBarProps) {
  const visibleAgents = agents.slice(0, 8);

  return (
    <div className={styles.tabBar}>
      <button
        className={`${styles.sidebarToggle} ${listExpanded ? styles.sidebarToggleActive : ""}`}
        onClick={onToggleList}
        title={listExpanded ? "收起 Agents (⌘B)" : "展开 Agents (⌘B)"}
      >
        <SidebarIcon />
      </button>
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
      <div className={styles.actions}>
        <button
          className={styles.newBtn}
          onClick={onNew}
          title="新建 Agent (⌘⇧T)"
        >
          <span>+</span>
        </button>
      </div>
    </div>
  );
}

export default memo(AgentTabBar);
