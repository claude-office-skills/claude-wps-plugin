import { useState, useRef, useEffect, memo, useCallback } from "react";
import type { AgentDefinition } from "../types";
import { AGENT_LABEL_MAP } from "../types";
import styles from "./AgentSelector.module.css";

const PROXY_BASE = "http://127.0.0.1:3001";

interface Props {
  value: string | undefined;
  onChange: (agentName: string | undefined, color?: string) => void;
  disabled?: boolean;
}

const AgentSelector = memo(function AgentSelector({
  value,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const resp = await fetch(`${PROXY_BASE}/v3/agents`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.ok && Array.isArray(data.agents)) {
        setAgents(data.agents);
      }
    } catch {
      /* server not ready */
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const current = agents.find((a) => a.name === value);
  const displayName = current
    ? AGENT_LABEL_MAP[current.name]?.full || current.name
    : "通用助手";

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={`${styles.trigger} ${current ? styles.triggerAgent : styles.triggerDefault}`}
        onClick={() => {
          if (!open && agents.length === 0) fetchAgents();
          setOpen((v) => !v);
        }}
        disabled={disabled}
        title={
          current ? `专业 Agent: ${displayName}` : "通用助手（无专业 Agent）"
        }
      >
        {current && (
          <span
            className={styles.colorDot}
            style={{ backgroundColor: current.color }}
          />
        )}
        <span className={styles.agentName}>{displayName}</span>
        <span className={styles.arrow}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <button
            className={`${styles.noAgentOption} ${!value ? styles.optionActive : ""}`}
            onClick={() => {
              onChange(undefined, undefined);
              setOpen(false);
            }}
          >
            <span
              className={styles.optDot}
              style={{ backgroundColor: "#888" }}
            />
            <span className={styles.optInfo}>
              <span className={styles.optName}>通用助手</span>
              <span className={styles.optDesc}>默认模式，无专业角色限制</span>
            </span>
            {!value && <span className={styles.optCheck}>✓</span>}
          </button>

          {agents.length > 0 && (
            <span className={styles.defaultLabel}>专业 Agent</span>
          )}

          {agents.map((agent) => {
            const isActive = agent.name === value;
            const label = AGENT_LABEL_MAP[agent.name]?.full || agent.name;
            return (
              <button
                key={agent.name}
                className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
                onClick={() => {
                  onChange(agent.name, agent.color);
                  setOpen(false);
                }}
              >
                <span
                  className={styles.optDot}
                  style={{ backgroundColor: agent.color }}
                />
                <span className={styles.optInfo}>
                  <span className={styles.optName}>{label}</span>
                  <span className={styles.optDesc}>
                    {agent.description.split("\n")[0]}
                  </span>
                </span>
                {isActive && <span className={styles.optCheck}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default AgentSelector;
