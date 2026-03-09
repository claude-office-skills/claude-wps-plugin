/**
 * Agent Team System — 多 Agent 协作引擎
 *
 * 工作流程:
 *   1. /team/start 立即返回 teamId（status: "planning"）
 *   2. Team Lead (haiku) 后台拆解子任务
 *   3. 无依赖的子任务并行执行，有依赖的等前置完成后再跑
 *   4. 前端通过 /team/status/:id 轮询实时进度
 */

import { nanoid } from "nanoid";
import { appendFileSync as _dbgAppend } from "fs";
import {
  loadAllAgents,
  getAgentByName,
  renderAgentPrompt,
} from "./agent-loader.js";

const _teams = new Map();

/**
 * 启动一个团队任务（立即返回，后台运行）
 */
export function startTeam(goal, context) {
  const teamId = nanoid(12);
  const team = {
    id: teamId,
    goal,
    status: "planning",
    subtasks: [],
    results: {},
    createdAt: Date.now(),
  };

  _teams.set(teamId, team);

  // #region agent log
  try {
    _dbgAppend(
      "/Users/kingsoft/需求讨论/.cursor/debug-eab716.log",
      JSON.stringify({
        sessionId: "eab716",
        location: "agent-team.js:startTeam",
        message: "team created, returning immediately",
        data: { teamId, goal, status: team.status },
        timestamp: Date.now(),
      }) + "\n",
    );
  } catch {}
  // #endregion

  planAndExecute(team, context).catch((err) => {
    if (team.status === "planning") {
      team.status = "failed";
      team.error = `规划失败: ${err.message}`;
    } else {
      team.status = "failed";
    }
    console.error(`[agent-team] Team ${teamId} failed:`, err.message);
  });

  return { id: team.id, goal: team.goal, status: team.status, subtasks: [] };
}

/**
 * 后台：规划 + 执行
 */
async function planAndExecute(team, context) {
  const agents = loadAllAgents();
  const agentCatalog = agents
    .map((a) => `- ${a.name}: ${(a.description || "").split("\n")[0]}`)
    .join("\n");

  const planPrompt = buildPlanPrompt(team.goal, agentCatalog, context);

  let subtaskPlan;
  try {
    subtaskPlan = await callTeamLead(planPrompt);
  } catch {
    subtaskPlan = buildFallbackPlan(team.goal, agents);
  }

  if (!subtaskPlan || subtaskPlan.length === 0) {
    subtaskPlan = buildFallbackPlan(team.goal, agents);
  }

  team.subtasks = subtaskPlan.map((s, i) => ({
    id: `${team.id}-${i}`,
    agent: s.agent,
    agentColor: agents.find((a) => a.name === s.agent)?.color || "#6B7280",
    description: s.description,
    status: "pending",
    result: undefined,
    order: s.order ?? i,
    dependsOn: s.dependsOn || [],
  }));

  team.status = "running";
  // #region agent log
  try {
    _dbgAppend(
      "/Users/kingsoft/需求讨论/.cursor/debug-eab716.log",
      JSON.stringify({
        sessionId: "eab716",
        location: "agent-team.js:planAndExecute",
        message: "planning done, moving to running",
        data: {
          teamId: team.id,
          subtaskCount: team.subtasks.length,
          subtasks: team.subtasks.map((s) => ({
            agent: s.agent,
            desc: s.description,
          })),
        },
        timestamp: Date.now(),
      }) + "\n",
    );
  } catch {}
  // #endregion
  await executeTeam(team);
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
    error: team.error,
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

/**
 * 执行引擎：支持并行（同 order 且无未完成依赖的任务一起跑）
 */
async function executeTeam(team) {
  while (team.status === "running") {
    const ready = team.subtasks.filter((s) => {
      if (s.status !== "pending") return false;
      const unmetDeps = s.dependsOn.filter((depId) => {
        const dep = team.subtasks.find((t) => t.id === depId);
        return dep && dep.status !== "done";
      });
      return unmetDeps.length === 0;
    });

    if (ready.length === 0) break;

    ready.forEach((s) => {
      s.status = "running";
    });

    await Promise.allSettled(
      ready.map(async (subtask) => {
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
      }),
    );
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

  return await callAgent(systemPrompt, userPrompt, agent.model);
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
