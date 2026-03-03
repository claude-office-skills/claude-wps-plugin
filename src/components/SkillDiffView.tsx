import { useState, useEffect, memo } from "react";
import styles from "./SkillDiffView.module.css";

const PROXY = "http://127.0.0.1:3001";

interface Props {
  skillName: string;
  onClose: () => void;
}

function SkillDiffView({ skillName, onClose }: Props) {
  const [userContent, setUserContent] = useState("");
  const [systemContent, setSystemContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${PROXY}/v2/user-skills/${skillName}/diff`)
      .then((r) => r.json())
      .then((data) => {
        setUserContent(data.userContent || "");
        setSystemContent(data.systemContent ?? null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [skillName]);

  const userLines = userContent.split("\n");
  const systemLines = (systemContent || "").split("\n");
  const maxLines = Math.max(userLines.length, systemLines.length);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h4 className={styles.title}>Diff: {skillName}</h4>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <div className={styles.loading}>加载中...</div>
        ) : systemContent === null ? (
          <div className={styles.noSystem}>
            系统中没有同名技能，这是一个纯用户技能，不存在覆盖关系。
          </div>
        ) : (
          <div className={styles.diffContainer}>
            <div className={styles.diffHeader}>
              <span className={styles.diffLabel}>系统版本</span>
              <span className={styles.diffLabel}>用户版本</span>
            </div>
            <div className={styles.diffBody}>
              {Array.from({ length: maxLines }, (_, i) => {
                const sysLine = systemLines[i] ?? "";
                const usrLine = userLines[i] ?? "";
                const isDiff = sysLine !== usrLine;

                return (
                  <div
                    key={i}
                    className={`${styles.diffRow} ${isDiff ? styles.diffRowChanged : ""}`}
                  >
                    <span className={styles.lineNum}>{i + 1}</span>
                    <span className={`${styles.diffCell} ${isDiff ? styles.diffRemoved : ""}`}>
                      {sysLine}
                    </span>
                    <span className={`${styles.diffCell} ${isDiff ? styles.diffAdded : ""}`}>
                      {usrLine}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SkillDiffView);
