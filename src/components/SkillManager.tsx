import { useState, useEffect, useCallback, memo } from "react";
import SkillPreview from "./SkillPreview";
import SkillDiffView from "./SkillDiffView";
import styles from "./SkillManager.module.css";

const PROXY = "http://127.0.0.1:3001";

interface SkillItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  body: string;
}

interface Conflict {
  name: string;
  userOverrides: string;
}

type Tab = "user" | "system" | "all";

function SkillManager({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("user");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [allSkills, setAllSkills] = useState<{ id: string; name: string; layer: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [diffSkill, setDiffSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUserSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${PROXY}/v2/user-skills`);
      const data = await resp.json();
      setSkills(data.skills || []);
      setConflicts(data.conflicts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllSkills = useCallback(async () => {
    try {
      const resp = await fetch(`${PROXY}/v2/skills/merged`);
      const data = await resp.json();
      setAllSkills(data.skills || []);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    fetchUserSkills();
    fetchAllSkills();
  }, [fetchUserSkills, fetchAllSkills]);

  const handleDelete = useCallback(
    async (name: string) => {
      if (!confirm(`确定删除技能 "${name}"？此操作不可撤销。`)) return;
      try {
        await fetch(`${PROXY}/v2/user-skills/${name}`, { method: "DELETE" });
        fetchUserSkills();
        if (selectedSkill === name) setSelectedSkill(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    },
    [fetchUserSkills, selectedSkill],
  );

  const handleCreate = useCallback(async () => {
    const name = prompt("技能名称 (kebab-case，例如: my-data-tool):");
    if (!name) return;
    const content = `---\nname: ${name}\ndescription: ""\nversion: "1.0.0"\nminSystemVersion: "2.3.0"\ntags: []\nmodes: [agent, plan, ask]\ncontext:\n  keywords: []\n  triggers: []\n---\n\n# ${name}\n\n在此编写技能说明...\n`;
    try {
      const resp = await fetch(`${PROXY}/v2/user-skills/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      const data = await resp.json();
      if (data.ok) {
        fetchUserSkills();
        setSelectedSkill(name);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }, [fetchUserSkills]);

  const isConflict = (name: string) =>
    conflicts.some((c) => c.name === name);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>技能管理</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.tabs}>
          {(["user", "system", "all"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "user" ? "用户技能" : t === "system" ? "系统技能" : "全部"}
            </button>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>加载中...</div>
          ) : tab === "user" ? (
            <>
              <div className={styles.toolbar}>
                <button className={styles.createBtn} onClick={handleCreate}>
                  + 新建技能
                </button>
                <span className={styles.count}>
                  {skills.length} 个用户技能
                </span>
              </div>
              {skills.length === 0 ? (
                <div className={styles.empty}>
                  暂无用户技能。你可以在对话中说"帮我创建一个技能"，或点击上方按钮手动创建。
                </div>
              ) : (
                <div className={styles.list}>
                  {skills.map((s) => (
                    <div key={s.id} className={styles.item}>
                      <div className={styles.itemLeft}>
                        <span className={styles.itemName}>{s.name}</span>
                        {isConflict(s.id) && (
                          <span className={styles.conflictBadge}>覆盖</span>
                        )}
                        <span className={styles.itemDesc}>{s.description}</span>
                      </div>
                      <div className={styles.itemActions}>
                        <button
                          className={styles.itemBtn}
                          onClick={() => setSelectedSkill(s.id)}
                        >
                          查看
                        </button>
                        {isConflict(s.id) && (
                          <button
                            className={styles.itemBtn}
                            onClick={() => setDiffSkill(s.id)}
                          >
                            对比
                          </button>
                        )}
                        <button
                          className={`${styles.itemBtn} ${styles.itemBtnDanger}`}
                          onClick={() => handleDelete(s.id)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : tab === "all" ? (
            <div className={styles.list}>
              {allSkills.map((s) => (
                <div key={`${s.layer}-${s.id}`} className={styles.item}>
                  <div className={styles.itemLeft}>
                    <span className={styles.itemName}>{s.name}</span>
                    <span
                      className={styles.layerBadge}
                      data-layer={s.layer}
                    >
                      {s.layer}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.list}>
              {allSkills
                .filter((s) => s.layer === "system" || s.layer === "bundled")
                .map((s) => (
                  <div key={s.id} className={styles.item}>
                    <div className={styles.itemLeft}>
                      <span className={styles.itemName}>{s.name}</span>
                      <span className={styles.layerBadge} data-layer={s.layer}>
                        {s.layer}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {selectedSkill && (
          <SkillPreview
            skillName={selectedSkill}
            onClose={() => setSelectedSkill(null)}
            onSaved={fetchUserSkills}
          />
        )}

        {diffSkill && (
          <SkillDiffView
            skillName={diffSkill}
            onClose={() => setDiffSkill(null)}
          />
        )}
      </div>
    </div>
  );
}

export default memo(SkillManager);
