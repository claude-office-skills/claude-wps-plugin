import { memo, useState, useMemo, useRef, useEffect } from "react";
import type { AgentState, AgentStatus } from "../types";
import styles from "./AgentListPanel.module.css";

interface AgentListPanelProps {
  agents: AgentState[];
  activeAgentId: string;
  expanded: boolean;
  width: number;
  onSwitch: (agentId: string) => void;
  onNew: () => void;
  onRemove: (agentId: string) => void;
}

const STATUS_CONFIG: Record<AgentStatus, { color: string }> = {
  idle: { color: "#888" },
  running: { color: "#D97757" },
  done: { color: "#4ade80" },
  failed: { color: "#ef4444" },
  paused: { color: "#3b82f6" },
};

const COLLAPSED_LIMIT = 5;

function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function agentPreview(agent: AgentState): string {
  const lastUserMsg = [...agent.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserMsg) {
    const text = lastUserMsg.content;
    return text.length > 24 ? text.slice(0, 24) + "…" : text;
  }
  return "新对话";
}

function AgentListPanel({
  agents,
  activeAgentId,
  expanded,
  width,
  onSwitch,
  onNew,
  onRemove,
}: AgentListPanelProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [agents, search]);

  const needsMore = filtered.length > COLLAPSED_LIMIT && !search.trim();
  const visibleAgents =
    needsMore && !showAll ? filtered.slice(0, COLLAPSED_LIMIT) : filtered;
  const hiddenCount = filtered.length - COLLAPSED_LIMIT;

  useEffect(() => {
    if (expanded && listRef.current) {
      const el = listRef.current.querySelector(`[data-active="true"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [expanded, activeAgentId]);

  if (!expanded) return null;

  return (
    <div className={styles.sidebar} style={{ width, minWidth: width }}>
      {/* 顶部：Search + New Agent */}
      <div className={styles.topBar}>
        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            placeholder="Search Agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className={styles.newAgentBtn}
          onClick={onNew}
          title="New Agent"
        >
          New Agent
        </button>
      </div>

      {/* Agents 标题 */}
      <div className={styles.sectionTitle}>Agents</div>

      {/* Agent 列表 */}
      <div className={styles.list} ref={listRef}>
        {visibleAgents.map((agent) => {
          const isActive = agent.id === activeAgentId;
          const cfg = STATUS_CONFIG[agent.status];
          const isRunning = agent.status === "running";

          return (
            <div
              key={agent.id}
              role="button"
              tabIndex={0}
              data-active={isActive ? "true" : undefined}
              className={`${styles.item} ${isActive ? styles.activeItem : ""}`}
              onClick={() => onSwitch(agent.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSwitch(agent.id);
              }}
            >
              <span
                className={`${styles.dot} ${isRunning ? styles.pulsing : ""}`}
                style={{ backgroundColor: cfg.color }}
              />
              <div className={styles.itemText}>
                <span className={styles.itemName}>
                  {agent.name || "新对话"}
                </span>
                <span className={styles.itemPreview}>
                  {agentPreview(agent)}
                </span>
              </div>
              <span className={styles.itemTime}>
                {timeAgo(agent.updatedAt)}
              </span>
              {agents.length > 1 && (
                <button
                  className={styles.removeBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(agent.id);
                  }}
                  title="删除"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {/* ...More 折叠按钮 */}
        {needsMore && !showAll && (
          <button className={styles.moreBtn} onClick={() => setShowAll(true)}>
            ... More ({hiddenCount})
          </button>
        )}

        {/* 展开后可收起 */}
        {needsMore && showAll && (
          <button className={styles.moreBtn} onClick={() => setShowAll(false)}>
            Show Less
          </button>
        )}

        {filtered.length === 0 && (
          <div className={styles.empty}>
            {search ? `未找到 "${search}"` : "暂无 Agent"}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(AgentListPanel);
