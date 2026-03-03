import { useState, useCallback, useEffect } from "react";
import styles from "./Onboarding.module.css";

const PROXY_BASE = "http://127.0.0.1:3001";

interface OnboardingProps {
  onComplete: (profile: UserProfile) => void;
}

interface UserProfile {
  name: string;
  industry: string;
  role: string;
  assistantName: string;
  mainTasks: string[];
}

const INDUSTRY_OPTIONS = [
  "金融/投资", "互联网/科技", "制造业", "咨询",
  "会计/审计", "教育", "医疗", "房地产", "其他",
];

const TASK_OPTIONS = [
  { id: "data-clean", label: "数据清洗整理" },
  { id: "financial-model", label: "财务建模" },
  { id: "report", label: "报表生成" },
  { id: "formula", label: "公式计算" },
  { id: "chart", label: "图表可视化" },
  { id: "data-analysis", label: "数据分析" },
  { id: "template", label: "模板制作" },
  { id: "other", label: "其他" },
];

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [assistantName, setAssistantName] = useState("小金");
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleTask = useCallback((taskId: string) => {
    setSelectedTasks((prev) =>
      prev.includes(taskId)
        ? prev.filter((t) => t !== taskId)
        : [...prev, taskId],
    );
  }, []);

  const handleComplete = useCallback(async () => {
    setSubmitting(true);
    const profile: UserProfile = {
      name,
      industry,
      role,
      assistantName,
      mainTasks: selectedTasks,
    };
    try {
      await fetch(`${PROXY_BASE}/v2/onboarding/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
    } catch {
      // offline fallback: still complete locally
    }
    setSubmitting(false);
    try {
      localStorage.setItem("wps-claude-profile", JSON.stringify(profile));
    } catch { /* ignore */ }
    onComplete(profile);
  }, [name, industry, role, assistantName, selectedTasks, onComplete]);

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {/* Progress indicator */}
        <div className={styles.progress}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`${styles.dot} ${i <= step ? styles.dotActive : ""}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className={styles.stepContent}>
            <div className={styles.greeting}>
              <span className={styles.wave}>👋</span>
            </div>
            <h2 className={styles.title}>你好，我是你的专属助理</h2>
            <p className={styles.desc}>
              我会记住你的偏好和工作习惯，帮你更高效地处理 Excel 工作。
              <br />
              先简单认识一下？
            </p>
            <button
              className={styles.primaryBtn}
              onClick={() => setStep(1)}
            >
              开始
            </button>
            <button
              className={styles.skipBtn}
              onClick={() => {
                onComplete({
                  name: "",
                  industry: "",
                  role: "",
                  assistantName: "小金",
                  mainTasks: [],
                });
              }}
            >
              先跳过，直接开始用
            </button>
          </div>
        )}

        {step === 1 && (
          <div className={styles.stepContent}>
            <h2 className={styles.title}>怎么称呼你？</h2>
            <input
              className={styles.input}
              type="text"
              placeholder="你的名字"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) setStep(2);
              }}
            />

            <label className={styles.label}>你的行业</label>
            <div className={styles.tagGroup}>
              {INDUSTRY_OPTIONS.map((ind) => (
                <button
                  key={ind}
                  className={`${styles.tag} ${industry === ind ? styles.tagSelected : ""}`}
                  onClick={() => setIndustry(ind)}
                >
                  {ind}
                </button>
              ))}
            </div>

            <label className={styles.label}>你的角色</label>
            <input
              className={styles.input}
              type="text"
              placeholder="如：分析师、财务经理、研究员..."
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />

            <label className={styles.label}>
              给助理取个名字（默认叫"小金"）
            </label>
            <input
              className={styles.input}
              type="text"
              placeholder="小金"
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
            />

            <div className={styles.btnRow}>
              <button className={styles.backBtn} onClick={() => setStep(0)}>
                返回
              </button>
              <button
                className={styles.primaryBtn}
                disabled={!name.trim()}
                onClick={() => setStep(2)}
              >
                下一步
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={styles.stepContent}>
            <h2 className={styles.title}>你平时用 Excel 做什么？</h2>
            <p className={styles.desc}>
              选几个常用场景，我会优先加载对应能力
            </p>
            <div className={styles.tagGroup}>
              {TASK_OPTIONS.map((task) => (
                <button
                  key={task.id}
                  className={`${styles.tag} ${selectedTasks.includes(task.id) ? styles.tagSelected : ""}`}
                  onClick={() => toggleTask(task.id)}
                >
                  {task.label}
                </button>
              ))}
            </div>

            <div className={styles.btnRow}>
              <button className={styles.backBtn} onClick={() => setStep(1)}>
                返回
              </button>
              <button
                className={styles.primaryBtn}
                disabled={submitting}
                onClick={handleComplete}
              >
                {submitting ? "准备中..." : "完成，开始工作"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to check onboarding status
 */
export function useOnboardingStatus() {
  const [status, setStatus] = useState<{
    loaded: boolean;
    onboarded: boolean;
    profile: UserProfile | null;
  }>({ loaded: false, onboarded: false, profile: null });

  useEffect(() => {
    fetch(`${PROXY_BASE}/v2/onboarding/status`)
      .then((r) => r.json())
      .then((data) => {
        setStatus({
          loaded: true,
          onboarded: data.onboarded || false,
          profile: data.profile || null,
        });
      })
      .catch(() => {
        setStatus({ loaded: true, onboarded: true, profile: null });
      });
  }, []);

  return status;
}
