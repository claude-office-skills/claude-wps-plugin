import { useState, useRef, useEffect, memo } from "react";
import type { AttachmentFile } from "../types";
import styles from "./AttachmentMenu.module.css";

interface Props {
  onFileAttach: (file: AttachmentFile) => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  disabled?: boolean;
}

const AttachmentMenu = memo(function AttachmentMenu({
  onFileAttach,
  webSearchEnabled,
  onToggleWebSearch,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

  const toBase64 = (buf: ArrayBuffer): string =>
    btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ""));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();

    try {
      if (IMAGE_EXTS.some((ext) => lower.endsWith(ext))) {
        const arrayBuf = await file.arrayBuffer();
        const base64 = toBase64(arrayBuf);
        const resp = await fetch("http://127.0.0.1:3001/upload-temp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, fileName: file.name }),
        });
        const result = await resp.json();
        if (result.ok) {
          const previewUrl = URL.createObjectURL(file);
          onFileAttach({
            name: file.name,
            content: `[图片: ${file.name}]`,
            size: file.size,
            type: "image",
            tempPath: result.filePath,
            previewUrl,
          });
        } else {
          onFileAttach({
            name: file.name,
            content: `[图片上传失败: ${result.error}]`,
            size: file.size,
          });
        }
      } else if (lower.endsWith(".pdf")) {
        const arrayBuf = await file.arrayBuffer();
        const base64 = toBase64(arrayBuf);
        const resp = await fetch("http://127.0.0.1:3001/extract-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64 }),
        });
        const result = await resp.json();
        if (result.ok) {
          const header = `[PDF: ${file.name}, ${result.pages} 页, ${result.totalChars} 字符${result.truncated ? "（已截断至 100k）" : ""}]\n\n`;
          onFileAttach({
            name: file.name,
            content: header + result.text,
            size: file.size,
          });
        } else {
          onFileAttach({
            name: file.name,
            content: `[PDF 解析失败: ${result.error}]`,
            size: file.size,
          });
        }
      } else {
        const content = await file.text();
        onFileAttach({ name: file.name, content, size: file.size });
      }
    } catch (err) {
      onFileAttach({
        name: file.name,
        content: `[无法读取文件: ${file.name} - ${err instanceof Error ? err.message : String(err)}]`,
        size: file.size,
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
    setOpen(false);
  };

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={styles.plusBtn}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="附件菜单"
      >
        <PlusIcon />
      </button>

      {open && (
        <div className={styles.menu}>
          <button className={styles.menuItem} onClick={handleFileClick}>
            <span className={styles.menuIcon}><PaperclipIcon /></span>
            <span className={styles.menuLabel}>上传文件 / 图片 / PDF</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={() => {
              onToggleWebSearch();
            }}
          >
            <span className={styles.menuIcon}><GlobeIcon /></span>
            <span className={styles.menuLabel}>联网搜索</span>
            <span
              className={`${styles.menuToggle} ${webSearchEnabled ? styles.menuToggleOn : ""}`}
            >
              {webSearchEnabled && <CheckSmallIcon />}
            </span>
          </button>

          <button
            className={`${styles.menuItem} ${styles.menuItemDisabled}`}
            disabled
          >
            <span className={styles.menuIcon}><LinkIcon /></span>
            <span className={styles.menuLabel}>连接器</span>
            <span className={styles.menuSoon}>Coming soon</span>
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.json,.xlsx,.xls,.tsv,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
});

export default AttachmentMenu;

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckSmallIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
