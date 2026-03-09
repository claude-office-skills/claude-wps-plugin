import { type ReactNode, memo } from "react";
import type { SidebarBlockType, BlockStatus } from "../types";
import { getBlockConfig, bgColor, titleColor } from "../config/blockConfig";
import styles from "./SidebarBlock.module.css";

interface SidebarBlockProps {
  type: SidebarBlockType;
  status?: BlockStatus;
  title?: string;
  badge?: string;
  /** Override the config icon with a ReactNode (e.g. SVG) */
  iconNode?: ReactNode;
  /** Collapsible: controlled externally */
  collapsed?: boolean;
  onToggle?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
}

function SidebarBlock({
  type,
  status = "idle",
  title,
  badge,
  iconNode,
  collapsed,
  onToggle,
  children,
  footer,
  headerActions,
}: SidebarBlockProps) {
  const config = getBlockConfig(type) ?? {
    stripeVar: "--border-primary",
    bgVar: "--bg-surface",
    titleColorVar: "--text-muted",
    icon: "?",
    defaultTitle: type ?? "Block",
    actions: [],
    prominence: "standard" as const,
  };
  const isAmbient = config.prominence === "ambient";
  const isRunning = status === "running";

  const blockStyle = {
    background: bgColor(type),
  } as React.CSSProperties;

  const blockCls = [styles.block, isAmbient ? styles.ambientBlock : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={blockCls} style={blockStyle}>
      {/* Left stripe */}
      <div
        className={`${styles.stripe} ${isRunning ? styles.stripeRunning : ""}`}
      />

      {/* Header */}
      <div
        className={styles.header}
        onClick={onToggle}
        style={onToggle ? { cursor: "pointer" } : undefined}
      >
        <div className={styles.headerLeft}>
          {onToggle !== undefined && (
            <span
              className={`${styles.toggleArrow} ${!collapsed ? styles.toggleArrowOpen : ""}`}
              style={{
                display: "inline-block",
                padding: "2px 4px",
                fontSize: 8,
              }}
            >
              ▶
            </span>
          )}
          {(iconNode || config.icon) && (
            <span
              className={styles.headerIcon}
              style={{ color: titleColor(type) }}
            >
              {iconNode ?? config.icon}
            </span>
          )}
          <span
            className={styles.headerTitle}
            style={{ color: titleColor(type) }}
          >
            {title ?? config.defaultTitle}
          </span>
          {badge && <span className={styles.headerBadge}>{badge}</span>}
          {status === "running" && (
            <span className={styles.statusRunning}>running</span>
          )}
          {status === "success" && (
            <span className={styles.statusSuccess}>✓</span>
          )}
          {status === "error" && <span className={styles.statusError}>✗</span>}
        </div>
        {headerActions && (
          <div className={styles.headerActions}>{headerActions}</div>
        )}
      </div>

      {/* Body */}
      {!collapsed && <div className={styles.body}>{children}</div>}

      {/* Footer */}
      {!collapsed && footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

export default memo(SidebarBlock);

export { styles as blockStyles };
