/**
 * ToolCallRenderer — Tool/Skill/MCP 调用卡片
 *
 * 对应设计图 Frame 16_Skills_MCP_Chat_UX:
 * 三种卡片类型:
 *   - inline:   单行内联（简单 Skill 加载）
 *   - expanded: 展开式（代码执行、数据分析，显示输入/输出）
 *   - mcp:      MCP 工具卡片（外部服务调用，显示 server + 授权状态）
 */

import { useState, memo } from "react";
import type { ActivityEvent } from "../../types";
import SidebarBlock from "../SidebarBlock";
import { blockStyles } from "../SidebarBlock";
import styles from "./ToolCallRenderer.module.css";

export type ToolCardType = "inline" | "expanded" | "mcp";

interface Props {
  activities: ActivityEvent[];
  isStreaming: boolean;
}

const TOOL_USE_PHRASES: Record<string, string> = {
  Agent: "智能分析",
  ToolSearch: "查找工具",
  WebSearch: "搜索网络",
  WebFetch: "获取网页",
  Read: "读取文件",
  Write: "写入文件",
  Edit: "编辑文件",
  Bash: "执行命令",
  Grep: "搜索代码",
  Glob: "查找文件",
  SemanticSearch: "语义搜索",
  Task: "执行子任务",
  TodoWrite: "更新任务",
  execute_code: "执行代码",
  code_execution: "执行代码",
};

const MCP_SERVERS = new Set([
  "notion",
  "gmail",
  "stripe",
  "figma",
  "github",
  "slack",
  "google-calendar",
  "tavily-search",
]);

const LOCAL_ACTION_PHRASES: Record<string, string> = {
  "local.calendar.list": "📅 读取日历",
  "local.calendar.create": "📅 创建日历事件",
  "local.contacts.search": "👤 搜索通讯录",
  "local.mail.send": "📧 发送邮件",
  "local.mail.unread": "📧 读取邮件",
  "local.reminders.list": "🔔 读取提醒",
  "local.reminders.create": "🔔 创建提醒",
  "local.finder.open": "📁 打开 Finder",
  "local.finder.selection": "📁 获取选中文件",
  "local.clipboard.get": "📋 读取剪贴板",
  "local.clipboard.set": "📋 写入剪贴板",
  "local.browser.tabs": "🌐 获取标签页",
  "local.browser.open": "🌐 打开网页",
  "local.apps.list": "💻 列出应用",
  "local.apps.launch": "💻 启动应用",
  "local.apps.quit": "💻 退出应用",
  "local.system.info": "💻 获取系统信息",
  "local.applescript": "⚙️ 执行脚本",
};

function classifyActivity(a: ActivityEvent): ToolCardType {
  if (MCP_SERVERS.has(a.name) || a.action === "mcp_call") return "mcp";
  if (a.action === "execute_code" || a.action === "code_execution")
    return "expanded";
  if (
    a.action === "tool_use" &&
    (a.name === "Bash" || a.name === "Write" || a.name === "Edit")
  )
    return "expanded";
  return "inline";
}

function getPhrase(action: string, name: string): string {
  if (action === "local_action" && LOCAL_ACTION_PHRASES[name])
    return LOCAL_ACTION_PHRASES[name];
  if (action === "local_action") return `⚙️ ${name.replace("local.", "")}`;
  if (action === "tool_use" && TOOL_USE_PHRASES[name])
    return TOOL_USE_PHRASES[name];
  if (action === "tool_use") return `使用${name}工具`;
  if (action === "mcp_call") return `连接 ${name}`;
  if (TOOL_USE_PHRASES[name]) return TOOL_USE_PHRASES[name];
  return name;
}

function ExpandedCard({
  activity,
  isLast,
  isStreaming,
}: {
  activity: ActivityEvent;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const phrase = getPhrase(activity.action, activity.name);

  return (
    <div className={styles.expandedCard}>
      <div
        className={styles.expandedHeader}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.expandedIcon}>▸</span>
        <span className={styles.expandedLabel}>
          {isStreaming && isLast ? (
            <span className={blockStyles.statusRunning}>{phrase}...</span>
          ) : (
            phrase
          )}
        </span>
        <span className={styles.expandedToggle}>{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className={styles.expandedBody}>
          <div className={styles.expandedMeta}>
            <span>action: {activity.action}</span>
            <span>name: {activity.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function McpCard({
  activity,
  isLast,
  isStreaming,
}: {
  activity: ActivityEvent;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const phrase = getPhrase(activity.action, activity.name);

  return (
    <div className={styles.mcpCard}>
      <div className={styles.mcpHeader}>
        <span className={styles.mcpBadge}>MCP</span>
        <span className={styles.mcpServer}>{activity.name}</span>
        {isStreaming && isLast && (
          <span className={styles.mcpStatus}>calling...</span>
        )}
      </div>
      <div className={styles.mcpBody}>{phrase}</div>
    </div>
  );
}

interface GroupedActivity {
  activity: ActivityEvent;
  type: ToolCardType;
  count: number;
  phrase: string;
}

function deduplicateInline(
  items: { activity: ActivityEvent; type: ToolCardType }[],
): GroupedActivity[] {
  const seen = new Map<string, GroupedActivity>();
  const result: GroupedActivity[] = [];
  for (const item of items) {
    const phrase = getPhrase(item.activity.action, item.activity.name);
    const existing = seen.get(phrase);
    if (existing) {
      existing.count++;
      existing.activity = item.activity;
    } else {
      const entry: GroupedActivity = { ...item, count: 1, phrase };
      seen.set(phrase, entry);
      result.push(entry);
    }
  }
  return result;
}

function ToolCallRenderer({ activities, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (!activities || activities.length === 0) return null;

  const classified = activities.map((a) => ({
    activity: a,
    type: classifyActivity(a),
  }));

  const hasMcp = classified.some((c) => c.type === "mcp");
  const hasExpanded = classified.some((c) => c.type === "expanded");

  const inlineItems = classified.filter((c) => c.type === "inline");
  const grouped = deduplicateInline(inlineItems);

  const uniqueCount =
    classified.filter((c) => c.type !== "inline").length + grouped.length;

  const status = isStreaming ? ("running" as const) : ("success" as const);
  const title = isStreaming
    ? `使用 ${uniqueCount} 个工具...`
    : `已使用 ${uniqueCount} 个工具`;

  return (
    <SidebarBlock
      type="mcp-tool"
      status={status}
      title={title}
      collapsed={!expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className={styles.cardList}>
        {hasMcp && <div className={styles.sectionLabel}>外部服务</div>}
        {classified
          .filter((c) => c.type === "mcp")
          .map((c, i) => (
            <McpCard
              key={`mcp-${i}`}
              activity={c.activity}
              isLast={
                i === classified.filter((x) => x.type === "mcp").length - 1
              }
              isStreaming={isStreaming}
            />
          ))}

        {hasExpanded && <div className={styles.sectionLabel}>代码执行</div>}
        {classified
          .filter((c) => c.type === "expanded")
          .map((c, i) => (
            <ExpandedCard
              key={`exp-${i}`}
              activity={c.activity}
              isLast={
                i === classified.filter((x) => x.type === "expanded").length - 1
              }
              isStreaming={isStreaming}
            />
          ))}

        {grouped.map((g, i) => (
          <div key={`inl-${i}`} className={styles.inlineCard}>
            <span className={styles.inlineIcon}>⚙</span>
            {isStreaming && i === grouped.length - 1 ? (
              <span className={blockStyles.statusRunning}>
                正在{g.phrase}...
              </span>
            ) : (
              <span>{g.phrase}</span>
            )}
          </div>
        ))}
      </div>
    </SidebarBlock>
  );
}

export default memo(ToolCallRenderer);
