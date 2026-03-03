import { useState, useEffect, useCallback, memo } from "react";
import styles from "./SkillPreview.module.css";

const PROXY = "http://127.0.0.1:3001";

interface Props {
  skillName: string;
  onClose: () => void;
  onSaved?: () => void;
}

function SkillPreview({ skillName, onClose, onSaved }: Props) {
  const [raw, setRaw] = useState("");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${PROXY}/v2/user-skills/${skillName}`)
      .then((r) => r.json())
      .then((data) => {
        setRaw(data.raw || "");
        setEditContent(data.raw || "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [skillName]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${PROXY}/v2/user-skills/${skillName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      const data = await resp.json();
      if (data.ok) {
        setRaw(editContent);
        setEditing(false);
        onSaved?.();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [skillName, editContent, onSaved]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h4 className={styles.title}>{skillName}</h4>
          <div className={styles.headerActions}>
            {editing ? (
              <>
                <button
                  className={styles.saveBtn}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                <button
                  className={styles.cancelBtn}
                  onClick={() => {
                    setEditing(false);
                    setEditContent(raw);
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                className={styles.editBtn}
                onClick={() => setEditing(true)}
              >
                编辑
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>加载中...</div>
          ) : editing ? (
            <textarea
              className={styles.editor}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              spellCheck={false}
            />
          ) : (
            <pre className={styles.content}>{raw}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(SkillPreview);
