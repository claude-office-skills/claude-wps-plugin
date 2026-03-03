/**
 * Capability Resolver — 自治补全引擎
 *
 * 在 Workflow 执行前，自动检测所有依赖能力是否就绪：
 *   - MCP server 是否已安装 & 认证
 *   - npm/pip 包是否已安装
 *   - 系统命令是否可用
 *   - API Key / OAuth Token 是否已配置
 *
 * 如果发现缺失，自动触发 provision.resolve 进行补全。
 * 补全后需要用户操作的（如 OAuth 授权），通过 SSE 推送给前端。
 *
 * 典型流程（如图中 OpenClaw 的 Gmail 示例）：
 *   1. 用户: "发30封个性化冷邮件"
 *   2. Agent 分析 → 需要 gmail MCP + research-assistant skill
 *   3. Resolver 检测 → gmail 未连接
 *   4. 自动安装 gmail MCP server
 *   5. 发起 OAuth → 推送授权链接给用户
 *   6. 用户完成授权 → 继续执行
 */

import { executeAction } from "./action-registry.js";

/**
 * 从 workflow YAML 定义中提取所需的能力列表
 */
export function extractRequiredCapabilities(workflow) {
  const capabilities = new Set();

  for (const step of workflow.steps || []) {
    const { action, params } = step;

    // mcp.call / mcp.proxy → 需要对应的 MCP server
    if (action === "mcp.call" || action === "mcp.proxy") {
      if (params?.server) capabilities.add(params.server);
    }

    // ai.* → 需要 python3
    if (action?.startsWith("ai.")) {
      capabilities.add("python3");
    }

    // terminal.* → 各种系统依赖
    if (action === "terminal.npmInstall") {
      capabilities.add("npm");
    }
    if (action === "terminal.pipInstall") {
      capabilities.add("pip3");
    }

    // 自定义 requires 字段
    if (step.requires) {
      const reqs = Array.isArray(step.requires)
        ? step.requires
        : [step.requires];
      for (const r of reqs) capabilities.add(r);
    }
  }

  return Array.from(capabilities);
}

/**
 * 对单个能力执行检测 + 补全
 *
 * @returns {{ capability, ready, resolved, userActionsRequired }}
 */
async function resolveOne(capability, options = {}) {
  const { autoInstall = true, secrets = {}, onProgress } = options;

  // Step 1: 检查是否已就绪
  const check = await executeAction("provision.check", { capability });

  if (check.ready) {
    return {
      capability,
      ready: true,
      resolved: false,
      userActionsRequired: [],
    };
  }

  // Step 2: 尝试自动补全
  if (onProgress) {
    onProgress({
      phase: "resolving",
      capability,
      message: `自动补全: ${capability}`,
    });
  }

  const resolution = await executeAction("provision.resolve", {
    capability,
    autoInstall,
    secrets,
    onProgress,
  });

  return {
    capability,
    ready: resolution.fullyResolved ?? false,
    resolved: true,
    steps: resolution.steps,
    userActionsRequired: resolution.userActionsRequired || [],
  };
}

/**
 * 批量解析 Workflow 的所有依赖能力
 *
 * @param {object} workflow       工作流定义
 * @param {object} options
 *   @param {boolean} autoInstall    自动安装包（默认 true）
 *   @param {object}  secrets        预提供的密钥
 *   @param {Function} onProgress    进度回调
 *   @param {boolean} parallel       是否并行解析（默认 true）
 *
 * @returns {{
 *   allReady: boolean,
 *   results: Array,
 *   userActionsRequired: Array,
 *   summary: string
 * }}
 */
export async function resolveWorkflowCapabilities(workflow, options = {}) {
  const {
    autoInstall = true,
    secrets = {},
    onProgress,
    parallel = true,
  } = options;

  const capabilities = extractRequiredCapabilities(workflow);

  if (capabilities.length === 0) {
    return {
      allReady: true,
      results: [],
      userActionsRequired: [],
      summary: "无外部依赖，可直接执行",
    };
  }

  if (onProgress) {
    onProgress({
      phase: "scanning",
      message: `检测到 ${capabilities.length} 项能力依赖: ${capabilities.join(", ")}`,
      capabilities,
    });
  }

  let results;
  if (parallel) {
    results = await Promise.all(
      capabilities.map((cap) =>
        resolveOne(cap, { autoInstall, secrets, onProgress }),
      ),
    );
  } else {
    results = [];
    for (const cap of capabilities) {
      results.push(await resolveOne(cap, { autoInstall, secrets, onProgress }));
    }
  }

  const userActionsRequired = results.flatMap(
    (r) => r.userActionsRequired || [],
  );
  const allReady = results.every((r) => r.ready);

  const readyCount = results.filter((r) => r.ready).length;
  const resolvedCount = results.filter((r) => r.resolved).length;

  let summary;
  if (allReady) {
    summary = `所有 ${capabilities.length} 项能力就绪${resolvedCount > 0 ? ` (自动补全 ${resolvedCount} 项)` : ""}`;
  } else {
    const pending = userActionsRequired.length;
    summary = `${readyCount}/${capabilities.length} 项就绪, ${pending} 项需要用户操作`;
  }

  if (onProgress) {
    onProgress({ phase: "resolved", message: summary, allReady });
  }

  return { allReady, results, userActionsRequired, summary };
}

/**
 * 预检 + 自动补全 + 执行 Workflow 的一体化入口
 *
 * 如果所有能力就绪 → 直接开始
 * 如果缺少 → 先补全，能补的自动补
 * 如果还有需要用户操作的 → 返回 pending 列表，等用户完成后可重试
 */
export async function resolveAndRun(workflow, options = {}) {
  const {
    inputs = {},
    secrets = {},
    autoInstall = true,
    onProgress,
    onEvent,
    onApprove,
  } = options;

  // Phase 1: 能力解析
  const resolution = await resolveWorkflowCapabilities(workflow, {
    autoInstall,
    secrets,
    onProgress,
  });

  // 需要用户操作 → 返回 pending
  if (!resolution.allReady) {
    return {
      status: "pending_user_action",
      summary: resolution.summary,
      userActionsRequired: resolution.userActionsRequired,
      resolution,
    };
  }

  // Phase 2: 执行工作流
  const { runWorkflow } = await import("./workflow-engine.js");
  const result = await runWorkflow(workflow, { inputs, onEvent, onApprove });

  return {
    status: result.status,
    summary: `工作流执行${result.status === "completed" ? "成功" : "失败"}`,
    workflowResult: result,
    resolution,
  };
}
