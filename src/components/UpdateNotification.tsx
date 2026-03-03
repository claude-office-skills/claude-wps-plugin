import { useState, useEffect, useCallback } from "react";
import styles from "./UpdateNotification.module.css";
import { analytics } from "../api/analytics";

const LANDING_URL = "https://wps-ai-landing.pages.dev";
const VERSION_URL = `${LANDING_URL}/version.json`;
const PROXY_URL = "http://127.0.0.1:3001";
const DISMISSED_KEY = "wps-claude-update-dismissed";
const LOCAL_VERSION = __APP_VERSION__;

type UpdateStep = "idle" | "confirm" | "updating" | "done" | "error";

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
  sha256?: string;
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
  const [step, setStep] = useState<UpdateStep>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [canSelfUpdate, setCanSelfUpdate] = useState<boolean | null>(null);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    const controller = new AbortController();

    fetch(VERSION_URL, { signal: controller.signal, cache: "no-cache" })
      .then((r) => r.json())
      .then(async (data: VersionManifest) => {
        if (!isNewer(data.version, LOCAL_VERSION) || dismissed === data.version) return;
        setManifest(data);
        // Probe if this proxy supports self-update
        try {
          const probe = await fetch(`${PROXY_URL}/supports-self-update`, { signal: controller.signal });
          const cap = await probe.json();
          setCanSelfUpdate(cap.supported === true);
        } catch {
          setCanSelfUpdate(false);
        }
        setTimeout(() => setVisible(true), 600);
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  // Poll update-status while updating
  useEffect(() => {
    if (step !== "updating") return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${PROXY_URL}/update-status`);
        const data = await r.json();
        setProgress(data.progress ?? 0);
        setStatusMsg(data.message ?? "");
        if (data.status === "done") {
          setStep("done");
          clearInterval(timer);
          // Wait for proxy to restart, then reload
          setTimeout(() => pollUntilAlive(), 2000);
        } else if (data.status === "error") {
          setStep("error");
          setStatusMsg(data.message);
          clearInterval(timer);
        }
      } catch (_) {}
    }, 800);
    return () => clearInterval(timer);
  }, [step]);

  const pollUntilAlive = useCallback(async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const r = await fetch(`${PROXY_URL}/health`);
        if (r.ok) {
          window.location.reload();
          return;
        }
      } catch (_) {}
    }
    setStatusMsg("重启超时，请手动刷新页面");
  }, []);

  if (!manifest || !visible) return null;

  const dismiss = () => {
    if (step === "updating") return;
    setVisible(false);
    if (step !== "done") {
      localStorage.setItem(DISMISSED_KEY, manifest.version);
    }
  };

  const handleUpdate = async () => {
    analytics.updateClick(canSelfUpdate === true);
    if (!canSelfUpdate) {
      window.open("https://wps-ai-landing.pages.dev#install", "_blank");
      dismiss();
      return;
    }
    setStep("updating");
    setProgress(0);
    setStatusMsg("正在启动更新…");
    try {
      const r = await fetch(`${PROXY_URL}/self-update`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (_) {
      setStep("error");
      setStatusMsg("代理服务连接失败，请重新运行安装脚本");
      analytics.updateError("proxy_unreachable");
    }
  };

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        {step !== "updating" && (
          <button className={styles.close} onClick={dismiss} aria-label="关闭">
            ×
          </button>
        )}

        <div className={styles.header}>
          <span className={styles.badge}>What's New</span>
          <h3 className={styles.title}>Claude in WPS {manifest.version}</h3>
        </div>

        {step === "idle" || step === "confirm" ? (
          <>
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
                {canSelfUpdate === false ? "前往更新" : "一键更新"}
              </button>
            </div>
          </>
        ) : step === "updating" ? (
          <div className={styles.updating}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className={styles.progressLabel}>{statusMsg}</div>
          </div>
        ) : step === "done" ? (
          <div className={styles.updating}>
            <div className={styles.doneIcon}>✓</div>
            <div className={styles.progressLabel}>更新成功，正在重启…</div>
          </div>
        ) : (
          <div className={styles.updating}>
            <div className={styles.errorMsg}>{statusMsg}</div>
            <div className={styles.actions}>
              <button className={styles.later} onClick={dismiss}>
                关闭
              </button>
              <button
                className={styles.update}
                onClick={() => window.open(manifest.downloadUrl, "_blank")}
              >
                手动下载
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
