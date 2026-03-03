import { memo, useState, useEffect, useRef } from "react";
import SidebarBlock from "./SidebarBlock";
import styles from "./TeamTaskBoard.module.css";

interface Subtask {
  id: string;
  agent: string;
  agentColor: string;
  description: string;
  status: "pending" | "running" | "done" | "failed";
  result?: string;
}

interface TeamState {
  id: string;
  goal: string;
  status: "running" | "done" | "failed";
  subtasks: Subtask[];
}

interface Props {
  team: TeamState;
  onDismiss: () => void;
}

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  running: "◉",
  done: "✓",
  failed: "✗",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-muted)",
  running: "var(--accent)",
  done: "var(--success)",
  failed: "var(--error)",
};

function TeamTaskBoard({ team, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(true);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [liveTeam, setLiveTeam] = useState(team);

  useEffect(() => {
    setLiveTeam(team);
  }, [team]);

  useEffect(() => {
    if (liveTeam.status !== "running") {
      if (pollerRef.current) clearInterval(pollerRef.current);
      return;
    }
    pollerRef.current = setInterval(async () => {
      try {
        const resp = await fetch(
          `http://127.0.0.1:3001/v3/team/status/${liveTeam.id}`,
        );
        const data = await resp.json();
        if (data.ok && data.team) {
          setLiveTeam(data.team);
        }
      } catch {}
    }, 2000);
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
    };
  }, [liveTeam.id, liveTeam.status]);

  const doneCount = liveTeam.subtasks.filter((s) => s.status === "done").length;
  const total = liveTeam.subtasks.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const overallStatus =
    liveTeam.status === "running"
      ? "running"
      : liveTeam.status === "done"
        ? "success"
        : "error";

  return (
    <SidebarBlock
      type="progress"
      status={overallStatus as "running" | "success" | "error" | "idle"}
      title={`🤝 团队任务 · ${doneCount}/${total}`}
      badge={liveTeam.status === "running" ? `${pct}%` : liveTeam.status}
      collapsed={!expanded}
      onToggle={() => setExpanded((v) => !v)}
      headerActions={
        liveTeam.status !== "running" ? (
          <button className={styles.dismissBtn} onClick={onDismiss}>
            关闭
          </button>
        ) : undefined
      }
    >
      <div className={styles.board}>
        <div className={styles.goalRow}>
          <span className={styles.goalLabel}>目标</span>
          <span className={styles.goalText}>{liveTeam.goal}</span>
        </div>

        <div className={styles.subtaskList}>
          {liveTeam.subtasks.map((sub) => (
            <div
              key={sub.id}
              className={`${styles.subtaskRow} ${sub.status === "running" ? styles.subtaskActive : ""}`}
            >
              <span
                className={styles.subtaskIcon}
                style={{ color: STATUS_COLOR[sub.status] }}
              >
                {STATUS_ICON[sub.status]}
              </span>
              <span
                className={styles.agentDot}
                style={{ backgroundColor: sub.agentColor }}
              />
              <span className={styles.agentName}>{sub.agent}</span>
              <span className={styles.subtaskDesc}>{sub.description}</span>
              {sub.status === "done" && sub.result && (
                <span className={styles.subtaskResult} title={sub.result}>
                  {sub.result.slice(0, 40)}
                  {sub.result.length > 40 ? "…" : ""}
                </span>
              )}
              {sub.status === "running" && <span className={styles.spinner} />}
            </div>
          ))}
        </div>

        {liveTeam.status === "running" && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </SidebarBlock>
  );
}

export default memo(TeamTaskBoard);
