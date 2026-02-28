import { useState, useEffect } from "react";
import styles from "./UpdateNotification.module.css";

const LANDING_URL = "https://wps-ai-landing.pages.dev";
const VERSION_URL = `${LANDING_URL}/version.json`;
const DISMISSED_KEY = "wps-claude-update-dismissed";
const LOCAL_VERSION = __APP_VERSION__;

interface Highlight {
  icon: string;
  title: string;
  description: string;
}

interface VersionManifest {
  version: string;
  date: string;
  highlights: Highlight[];
  downloadUrl: string;
}

function isNewer(remote: string, local: string): boolean {
  const r = remote.replace(/-.*$/, "").split(".").map(Number);
  const l = local.replace(/-.*$/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

export default function UpdateNotification() {
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    const controller = new AbortController();

    fetch(VERSION_URL, { signal: controller.signal, cache: "no-cache" })
      .then((r) => r.json())
      .then((data: VersionManifest) => {
        if (
          isNewer(data.version, LOCAL_VERSION) &&
          dismissed !== data.version
        ) {
          setManifest(data);
          setTimeout(() => setVisible(true), 600);
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  if (!manifest || !visible) return null;

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, manifest.version);
  };

  const handleUpdate = () => {
    window.open(manifest.downloadUrl, "_blank");
    dismiss();
  };

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <button className={styles.close} onClick={dismiss} aria-label="关闭">
          ×
        </button>

        <div className={styles.header}>
          <span className={styles.badge}>What's New</span>
          <h3 className={styles.title}>Claude in WPS {manifest.version}</h3>
        </div>

        <ul className={styles.list}>
          {manifest.highlights.map((h, i) => (
            <li key={i} className={styles.item}>
              <span className={styles.icon}>{h.icon}</span>
              <div>
                <div className={styles.itemTitle}>{h.title}</div>
                <div className={styles.itemDesc}>{h.description}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <button className={styles.later} onClick={dismiss}>
            稍后提醒
          </button>
          <button className={styles.update} onClick={handleUpdate}>
            立即更新
          </button>
        </div>
      </div>
    </div>
  );
}
