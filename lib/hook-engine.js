/**
 * Hook Engine — 声明式生命周期钩子引擎
 *
 * 5 个事件:
 *   - PreCodeExecute:   代码发送到 WPS 前，可拦截危险操作
 *   - PostCodeExecute:  代码在 WPS 执行后，审计与学习
 *   - PreAgentDispatch: 分派 Agent 前，意图审计
 *   - AgentStop:        Agent 完成/失败时，质量控制
 *   - SessionStart:     每日首次对话，上下文预热
 *
 * 两种 Hook 类型:
 *   - "block": 拦截操作，返回 { blocked: true, reason }
 *   - "log":   仅记录审计日志，不阻断
 *
 * 配置文件: hooks/hooks.json
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";

const BUNDLED_HOOKS_PATH = resolve(import.meta.dirname, "..", "hooks", "hooks.json");
const USER_HOOKS_PATH = join(homedir(), ".claude-wps", "hooks.json");

let _hookConfig = null;
let _hookConfigTime = 0;
const HOOK_CACHE_TTL = 30_000;

/**
 * @typedef {Object} HookRule
 * @property {string} event - 事件名 (PreCodeExecute, PostCodeExecute, etc.)
 * @property {string} type - "block" | "log"
 * @property {string} name - 规则名称
 * @property {Array<{field: string, operator: string, pattern: string}>} conditions
 * @property {string} [message] - 阻断时的提示消息
 */

function loadHookConfig() {
  const now = Date.now();
  if (_hookConfig && now - _hookConfigTime < HOOK_CACHE_TTL) return _hookConfig;

  const hooks = [];

  for (const path of [BUNDLED_HOOKS_PATH, USER_HOOKS_PATH]) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.hooks)) {
        hooks.push(...parsed.hooks);
      }
    } catch (e) {
      console.warn(`[hook-engine] Failed to load ${path}: ${e.message}`);
    }
  }

  _hookConfig = hooks;
  _hookConfigTime = now;
  return hooks;
}

const REGEX_CACHE = new Map();
function getCachedRegex(pattern) {
  if (REGEX_CACHE.has(pattern)) return REGEX_CACHE.get(pattern);
  try {
    const re = new RegExp(pattern, "i");
    if (REGEX_CACHE.size > 128) REGEX_CACHE.clear();
    REGEX_CACHE.set(pattern, re);
    return re;
  } catch {
    return null;
  }
}

function evaluateCondition(condition, data) {
  const value = String(data[condition.field] || "");
  const { operator, pattern } = condition;

  switch (operator) {
    case "regex_match": {
      const re = getCachedRegex(pattern);
      return re ? re.test(value) : false;
    }
    case "contains":
      return value.toLowerCase().includes(pattern.toLowerCase());
    case "not_contains":
      return !value.toLowerCase().includes(pattern.toLowerCase());
    case "equals":
      return value === pattern;
    case "starts_with":
      return value.startsWith(pattern);
    case "ends_with":
      return value.endsWith(pattern);
    default:
      return false;
  }
}

/**
 * 执行指定事件的所有 Hook 规则
 *
 * @param {string} event - 事件名
 * @param {Record<string, string>} data - 事件数据 (field → value)
 * @returns {{ blocked: boolean, reason?: string, logs: string[] }}
 */
export function runHooks(event, data) {
  const hooks = loadHookConfig();
  const matched = hooks.filter((h) => h.event === event);
  const logs = [];
  let blocked = false;
  let reason = "";

  for (const hook of matched) {
    const allMatch = (hook.conditions || []).every((c) =>
      evaluateCondition(c, data),
    );
    if (!allMatch) continue;

    if (hook.type === "block") {
      blocked = true;
      reason = hook.message || `Blocked by hook: ${hook.name}`;
      logs.push(`[BLOCK] ${hook.name}: ${reason}`);
      break;
    }

    logs.push(`[LOG] ${hook.name}: matched on ${event}`);
  }

  return { blocked, reason, logs };
}

export function invalidateHookCache() {
  _hookConfig = null;
  _hookConfigTime = 0;
}
