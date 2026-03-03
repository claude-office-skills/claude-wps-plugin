/**
 * Agent Team System — 多 Agent 协作引擎
 *
 * 工作流程:
 *   1. Team Lead (haiku) 接收用户目标，拆解为子任务
 *   2. 每个子任务分配给最合适的专业 Agent
 *   3. 子任务可以串行或并行执行
 *   4. 结果汇总给 Team Lead，合成最终输出
 *
 * 用户入口:
 *   - /team <goal>       斜杠命令
 *   - 自动检测复杂请求   (未来实现)
 */

import { nanoid } from "nanoid";
import {
  loadAllAgents,
  getAgentByName,
  renderAgentPrompt,
} from "./agent-loader.js";

const _teams = new Map();

/**
 * 启动一个团队任务
 * @param {string} goal - 用户目标描述
 * @param {object} context - WPS 上下文（可选）
 * @returns {{ id, goal, status, subtasks }}
 */
export async function startTeam(goal, context) {
  const teamId = nanoid(12);
  const agents = loadAllAgents();

  const agentCatalog = agents
    .map((a) => `- ${a.name}: ${(a.description || "").split("\n")[0]}`)
    .join("\n");

  const planPrompt = buildPlanPrompt(goal, agentCatalog, context);

  let subtaskPlan;
  try {
    subtaskPlan = await callTeamLead(planPrompt);
  } catch (err) {
    subtaskPlan = buildFallbackPlan(goal, agents);
  }

  const subtasks = subtaskPlan.map((s, i) => ({
    id: `${teamId}-${i}`,
    agent: s.agent,
    agentColor: agents.find((a) => a.name === s.agent)?.color || "#6B7280",
    description: s.description,
    status: "pending",
    result: undefined,
    order: s.order || i,
    dependsOn: s.dependsOn || [],
  }));

  const team = {
    id: teamId,
    goal,
    status: "running",
    subtasks,
    results: {},
    createdAt: Date.now(),
  };

  _teams.set(teamId, team);

  executeTeam(team).catch((err) => {
    team.status = "failed";
    console.error(`[agent-team] Team ${teamId} failed:`, err.message);
  });

  return {
    id: team.id,
    goal: team.goal,
    status: team.status,
    subtasks: team.subtasks.map(formatSubtask),
  };
}

/**
 * 查询团队状态
 */
export function getTeamStatus(teamId) {
  const team = _teams.get(teamId);
  if (!team) return null;
  return {
    id: team.id,
    goal: team.goal,
    status: team.status,
    subtasks: team.subtasks.map(formatSubtask),
  };
}

function formatSubtask(s) {
  return {
    id: s.id,
    agent: s.agent,
    agentColor: s.agentColor,
    description: s.description,
    status: s.status,
    result: s.result,
  };
}

async function executeTeam(team) {
  const subtasks = [...team.subtasks].sort((a, b) => a.order - b.order);

  for (const subtask of subtasks) {
    if (team.status !== "running") break;

    const pendingDeps = subtask.dependsOn.filter((depId) => {
      const dep = team.subtasks.find((s) => s.id === depId);
      return dep && dep.status !== "done";
    });
    if (pendingDeps.length > 0) continue;

    subtask.status = "running";

    try {
      const result = await executeSubtask(subtask, team);
      subtask.status = "done";
      subtask.result =
        typeof result === "string" ? result : JSON.stringify(result);
      team.results[subtask.id] = result;
    } catch (err) {
      subtask.status = "failed";
      subtask.result = `错误: ${err.message}`;
    }
  }

  const allDone = team.subtasks.every(
    (s) => s.status === "done" || s.status === "failed",
  );
  if (allDone) {
    team.status = team.subtasks.some((s) => s.status === "failed")
      ? "failed"
      : "done";
  }
}

async function executeSubtask(subtask, team) {
  const agent = getAgentByName(subtask.agent);
  if (!agent) {
    return `Agent "${subtask.agent}" 未找到，跳过。`;
  }

  const previousResults = Object.entries(team.results)
    .map(([id, result]) => {
      const prev = team.subtasks.find((s) => s.id === id);
      return prev
        ? `[${prev.agent}] ${prev.description}: ${String(result).slice(0, 200)}`
        : "";
    })
    .filter(Boolean)
    .join("\n");

  const systemPrompt = renderAgentPrompt(agent, {});
  const userPrompt = [
    `## 团队任务`,
    `目标: ${team.goal}`,
    `你的子任务: ${subtask.description}`,
    previousResults ? `\n## 前序 Agent 的结果\n${previousResults}` : "",
    `\n请完成你的子任务并返回结果。只返回最终结果，不需要解释过程。`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callAgent(systemPrompt, userPrompt, agent.model);
  return result;
}

function buildPlanPrompt(goal, agentCatalog, context) {
  return [
    `你是 Team Lead。用户的目标是:\n"${goal}"`,
    context
      ? `\n当前 Excel 上下文:\n- 工作簿: ${context.workbookName}\n- Sheet: ${context.sheetNames?.join(", ")}`
      : "",
    `\n可用的专业 Agent:\n${agentCatalog}`,
    `\n请将任务拆解为 2-5 个子任务，每个分配给一个 Agent。`,
    `严格按以下 JSON 格式返回（不要包含其他文字）:`,
    `[{"agent":"agent-name","description":"子任务描述","order":0}]`,
  ].join("\n");
}

function buildFallbackPlan(goal, agents) {
  const analyst = agents.find((a) => a.name === "excel-analyst");
  const reporter = agents.find((a) => a.name === "report-writer");

  const plan = [];
  if (analyst) {
    plan.push({
      agent: analyst.name,
      description: `分析数据: ${goal}`,
      order: 0,
    });
  }
  if (reporter) {
    plan.push({
      agent: reporter.name,
      description: `基于分析结果生成报告`,
      order: 1,
    });
  }
  if (plan.length === 0 && agents.length > 0) {
    plan.push({
      agent: agents[0].name,
      description: goal,
      order: 0,
    });
  }
  return plan;
}

/**
 * 调用 Team Lead (haiku) 做任务拆解
 */
async function callTeamLead(prompt) {
  const result = await callAgent(
    "你是团队领导。你只输出 JSON 数组，不输出任何其他内容。",
    prompt,
    "haiku",
  );

  try {
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {}

  return [];
}

/**
 * 通过 proxy 的 /chat 接口调用单个 Agent
 */
async function callAgent(systemPrompt, userPrompt, model = "sonnet") {
  const { spawn } = await import("child_process");
  const { existsSync } = await import("fs");

  const claudePaths = [
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
  ];
  const claudePath = claudePaths.find((p) => existsSync(p)) || "claude";

  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--model",
      model,
      "--system-prompt",
      systemPrompt,
      userPrompt,
    ];

    const child = spawn(claudePath, args, {
      env: { ...process.env },
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `claude exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}
