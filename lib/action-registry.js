/**
 * Action Registry — 统一动作注册表
 *
 * 聚合所有动作（wps.* / ai.* / system.* / file.* / notify.* / http.* / local.* / mcp.* / terminal.* / provision.*）
 * Workflow Engine 通过此注册表调度所有步骤
 */

import { systemActions } from "./actions/system.js";
import { fileActions } from "./actions/file.js";
import { notifyActions } from "./actions/notify.js";
import { aiActions } from "./actions/ai.js";
import { mcpActions } from "./actions/mcp.js";
import { terminalActions } from "./actions/terminal.js";
import { provisionActions } from "./actions/provision.js";
import { localActions } from "./actions/local.js";

// http.* — 通用 HTTP 请求动作
const httpActions = {
  "http.get": async ({ url, headers = {} }) => {
    if (!url) throw new Error("url is required");
    const resp = await fetch(url, { headers });
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("json") ? await resp.json() : await resp.text();
    return { ok: resp.ok, status: resp.status, data };
  },
  "http.post": async ({ url, body, headers = {} }) => {
    if (!url) throw new Error("url is required");
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("json") ? await resp.json() : await resp.text();
    return { ok: resp.ok, status: resp.status, data };
  },
};

// 内置 no-op 动作（占位，由工作流引擎内部处理）
const builtinActions = {
  "user.approve": async () => ({ ok: true, approved: true }),
  "user.input": async ({ prompt: _ }) => ({ ok: true, value: null }),
  "workflow.log": async ({ message }) => {
    console.log(`[workflow] ${message}`);
    return { ok: true };
  },
  "workflow.wait": async ({ ms = 1000 }) => {
    await new Promise((r) => setTimeout(r, ms));
    return { ok: true };
  },
};

const registry = {
  ...systemActions,
  ...fileActions,
  ...notifyActions,
  ...httpActions,
  ...builtinActions,
  ...aiActions,
  ...mcpActions,
  ...terminalActions,
  ...provisionActions,
  ...localActions,
};

/**
 * 注册自定义动作
 * @param {string} name  动作名，如 "custom.doSomething"
 * @param {Function} fn  async (params) => result
 */
export function registerAction(name, fn) {
  registry[name] = fn;
}

/**
 * 执行一个动作
 * @param {string} action  动作名
 * @param {object} params  动作参数（支持模板变量，由 Workflow Engine 预处理）
 */
export async function executeAction(action, params = {}) {
  const fn = registry[action];
  if (!fn) throw new Error(`Action not found: ${action}`);
  return fn(params);
}

/**
 * 列出所有已注册动作名
 */
export function listActions() {
  return Object.keys(registry);
}
