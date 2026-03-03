import { memo, useEffect, useState } from "react";
import type { PermissionStatus } from "../hooks/useLocalAccess";
import styles from "./LocalAccessPanel.module.css";

interface Props {
  permissions: Record<string, PermissionStatus>;
  checking: boolean;
  onCheckAll: () => void;
  onRequest: (capability: string) => Promise<unknown>;
}

const CAPABILITY_ICONS: Record<string, string> = {
  calendar: "📅",
  contacts: "📇",
  mail: "✉️",
  reminders: "🔔",
  finder: "📂",
  "system-events": "⚙️",
  safari: "🧭",
  chrome: "🌐",
  accessibility: "♿",
};

function PermissionCard({
  id,
  perm,
  onRequest,
}: {
  id: string;
  perm: PermissionStatus;
  onRequest: (cap: string) => Promise<unknown>;
}) {
  const [requesting, setRequesting] = useState(false);

  const handleRequest = async () => {
    setRequesting(true);
    await onRequest(id);
    setRequesting(false);
  };

  return (
    <div
      className={`${styles.card} ${perm.granted ? styles.cardGranted : styles.cardDenied}`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>{CAPABILITY_ICONS[id] ?? "🔧"}</span>
        <span className={styles.cardApp}>{perm.app}</span>
        <span
          className={perm.granted ? styles.statusGranted : styles.statusDenied}
        >
          {perm.granted ? "已授权" : "未授权"}
        </span>
      </div>
      <div className={styles.cardDesc}>{perm.description}</div>
      {!perm.granted && (
        <div className={styles.cardActions}>
          <button
            className={styles.requestBtn}
            onClick={handleRequest}
            disabled={requesting}
          >
            {requesting ? "请求中..." : "请求授权"}
          </button>
          <span className={styles.settingsHint}>{perm.settingsPath}</span>
        </div>
      )}
    </div>
  );
}

const LocalAccessPanel = memo(function LocalAccessPanel({
  permissions,
  checking,
  onCheckAll,
  onRequest,
}: Props) {
  const entries = Object.entries(permissions);
  const grantedCount = entries.filter(([, p]) => p.granted).length;

  useEffect(() => {
    if (entries.length === 0) {
      onCheckAll();
    }
  }, [entries.length, onCheckAll]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>本地权限</span>
        <span className={styles.summary}>
          {grantedCount}/{entries.length} 已授权
        </span>
        <button
          className={styles.refreshBtn}
          onClick={onCheckAll}
          disabled={checking}
        >
          {checking ? "检测中..." : "刷新"}
        </button>
      </div>

      {entries.length === 0 && checking && (
        <div className={styles.loading}>正在检测 macOS 权限...</div>
      )}

      <div className={styles.grid}>
        {entries.map(([id, perm]) => (
          <PermissionCard key={id} id={id} perm={perm} onRequest={onRequest} />
        ))}
      </div>
    </div>
  );
});

export default LocalAccessPanel;
