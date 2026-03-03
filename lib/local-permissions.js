/**
 * local-permissions.js — macOS 权限检测 & 引导授权
 *
 * macOS 对日历、通讯录、邮件等系统应用有独立的隐私权限控制。
 * 当 osascript 首次访问这些应用时，系统会弹出权限请求。
 *
 * 本模块提供：
 *   1. 权限预检测（probe）— 尝试轻量操作，检测是否已获授权
 *   2. 权限状态缓存 — 避免重复检测
 *   3. 引导信息 — 告诉用户如何手动授权（系统偏好设置路径）
 *   4. 批量检测 — 一次检测多个能力
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 每个系统能力的探针配置
 *   probe:     轻量的 osascript 命令，成功 = 已授权
 *   app:       对应的 macOS 应用名
 *   settingsPath: 引导用户手动授权的系统偏好设置路径
 *   description: 人类可读的描述
 */
const PERMISSION_PROBES = {
  calendar: {
    probe: 'osascript -e \'tell application "Calendar" to name of first calendar\'',
    app: 'Calendar',
    settingsPath: '系统设置 → 隐私与安全性 → 日历',
    description: '读取和创建日历事件',
  },
  contacts: {
    probe: 'osascript -e \'tell application "Contacts" to count every person\'',
    app: 'Contacts',
    settingsPath: '系统设置 → 隐私与安全性 → 通讯录',
    description: '搜索和读取联系人',
  },
  mail: {
    probe: 'osascript -e \'tell application "Mail" to count every account\'',
    app: 'Mail',
    settingsPath: '系统设置 → 隐私与安全性 → 自动化 → 允许 Terminal/osascript 控制 Mail',
    description: '读取和发送邮件',
  },
  reminders: {
    probe: 'osascript -e \'tell application "Reminders" to count every list\'',
    app: 'Reminders',
    settingsPath: '系统设置 → 隐私与安全性 → 提醒事项',
    description: '读取和创建提醒',
  },
  finder: {
    probe: 'osascript -e \'tell application "Finder" to name of home\'',
    app: 'Finder',
    settingsPath: '系统设置 → 隐私与安全性 → 自动化 → 允许控制 Finder',
    description: '文件浏览和管理',
  },
  'system-events': {
    probe: 'osascript -e \'tell application "System Events" to count every process\'',
    app: 'System Events',
    settingsPath: '系统设置 → 隐私与安全性 → 辅助功能',
    description: '查看运行中的应用和系统状态',
  },
  safari: {
    probe: 'osascript -e \'tell application "Safari" to count every window\'',
    app: 'Safari',
    settingsPath: '系统设置 → 隐私与安全性 → 自动化 → 允许控制 Safari',
    description: '读取 Safari 标签页',
  },
  chrome: {
    probe: 'osascript -e \'tell application "Google Chrome" to count every window\'',
    app: 'Google Chrome',
    settingsPath: '系统设置 → 隐私与安全性 → 自动化 → 允许控制 Chrome',
    description: '读取 Chrome 标签页',
  },
  accessibility: {
    probe: 'osascript -e \'tell application "System Events" to get name of first process\'',
    app: 'System Events',
    settingsPath: '系统设置 → 隐私与安全性 → 辅助功能 → 添加终端/Cursor',
    description: '键盘输入、窗口管理等辅助功能',
  },
};

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function isCacheValid(entry) {
  return entry && (Date.now() - entry.ts < CACHE_TTL);
}

/**
 * 检测单个权限状态
 * @returns { granted: boolean, app: string, settingsPath: string, description: string, error?: string }
 */
export async function checkPermission(capability) {
  const config = PERMISSION_PROBES[capability];
  if (!config) {
    return {
      granted: false,
      app: capability,
      settingsPath: '未知',
      description: `未知能力: ${capability}`,
      error: 'unknown_capability',
    };
  }

  const cached = cache.get(capability);
  if (isCacheValid(cached)) return cached.result;

  try {
    await execAsync(config.probe, { timeout: 8000 });
    const result = {
      granted: true,
      app: config.app,
      settingsPath: config.settingsPath,
      description: config.description,
    };
    cache.set(capability, { ts: Date.now(), result });
    return result;
  } catch (err) {
    const errMsg = err.stderr || err.message || '';
    const isDenied = errMsg.includes('not allowed')
      || errMsg.includes('assistive access')
      || errMsg.includes('denied')
      || errMsg.includes('errAEPrivilegeError')
      || errMsg.includes('-1743');

    const result = {
      granted: false,
      app: config.app,
      settingsPath: config.settingsPath,
      description: config.description,
      error: isDenied ? 'permission_denied' : 'app_unavailable',
      errorDetail: errMsg.slice(0, 200),
    };
    cache.set(capability, { ts: Date.now(), result });
    return result;
  }
}

/**
 * 批量检测多个权限
 * @returns Record<string, PermissionResult>
 */
export async function checkPermissions(capabilities) {
  const entries = await Promise.all(
    capabilities.map(async (cap) => [cap, await checkPermission(cap)]),
  );
  return Object.fromEntries(entries);
}

/**
 * 检测所有已知权限
 */
export async function checkAllPermissions() {
  return checkPermissions(Object.keys(PERMISSION_PROBES));
}

/**
 * 根据 local.* action 名称推断所需权限
 */
export function inferRequiredPermission(actionName) {
  const mapping = {
    'local.calendar.list': 'calendar',
    'local.calendar.create': 'calendar',
    'local.contacts.search': 'contacts',
    'local.mail.send': 'mail',
    'local.mail.unread': 'mail',
    'local.finder.open': 'finder',
    'local.finder.selection': 'finder',
    'local.reminders.list': 'reminders',
    'local.reminders.create': 'reminders',
    'local.system.info': null,
    'local.clipboard.get': null,
    'local.clipboard.set': null,
    'local.browser.tabs': null,
    'local.browser.open': null,
    'local.apps.list': 'system-events',
    'local.apps.launch': null,
    'local.apps.quit': null,
    'local.applescript': null,
  };
  return mapping[actionName] ?? null;
}

/**
 * 在执行 local.* action 前自动检测权限
 * @returns { allowed: boolean, permissionResult?: PermissionResult }
 */
export async function guardLocalAction(actionName) {
  const required = inferRequiredPermission(actionName);
  if (!required) return { allowed: true };

  const result = await checkPermission(required);
  if (result.granted) return { allowed: true, permissionResult: result };

  return {
    allowed: false,
    permissionResult: result,
    userMessage: `需要 macOS 权限才能${result.description}。\n\n请前往: ${result.settingsPath}\n\n将本应用（Terminal / Cursor）添加到允许列表后重试。`,
  };
}

/**
 * 尝试触发 macOS 权限弹窗（通过执行探针命令）
 * 用户授权后权限立即生效
 */
export async function requestPermission(capability) {
  const config = PERMISSION_PROBES[capability];
  if (!config) throw new Error(`Unknown capability: ${capability}`);

  cache.delete(capability);

  try {
    await execAsync(config.probe, { timeout: 30000 });
    return { granted: true, capability };
  } catch {
    return {
      granted: false,
      capability,
      settingsPath: config.settingsPath,
      message: `macOS 权限请求已发送。如果没有看到弹窗，请手动前往:\n${config.settingsPath}`,
    };
  }
}

/**
 * 清除权限缓存
 */
export function clearPermissionCache() {
  cache.clear();
}

/**
 * 列出所有已知的可检测权限
 */
export function listKnownPermissions() {
  return Object.entries(PERMISSION_PROBES).map(([key, val]) => ({
    id: key,
    app: val.app,
    description: val.description,
    settingsPath: val.settingsPath,
  }));
}
