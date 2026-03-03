/**
 * Workflow Engine — 核心工作流执行引擎
 *
 * 支持：
 * - YAML 工作流定义
 * - 顺序/并行步骤执行
 * - 条件分支（condition 字段）
 * - 模板变量插值（{{ $stepId.field }} 语法）
 * - 用户审批门（action: user.approve）
 * - 步骤超时
 * - 事件流回调（供 SSE 推送进度）
 */

import yaml from 'js-yaml';
import { readFileSync, existsSync } from 'fs';
import { nanoid } from 'nanoid';
import { executeAction } from './action-registry.js';

// 活跃中的工作流执行实例
const activeRuns = new Map();

/**
 * 从文件加载工作流定义
 * @param {string} filePath  workflow.yaml 路径
 */
export function loadWorkflowFromFile(filePath) {
  if (!existsSync(filePath)) throw new Error(`Workflow file not found: ${filePath}`);
  const content = readFileSync(filePath, 'utf-8');
  return yaml.load(content);
}

/**
 * 从 YAML 字符串解析工作流定义
 */
export function parseWorkflow(yamlStr) {
  return yaml.load(yamlStr);
}

/**
 * 模板变量插值
 * 支持 {{ $stepId.field }} 和 {{ $stepId }} 两种形式
 */
function interpolate(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*\$([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split('.');
    let val = context;
    for (const p of parts) {
      val = val?.[p];
    }
    return val ?? '';
  });
}

function interpolateDeep(obj, context) {
  if (typeof obj === 'string') return interpolate(obj, context);
  if (Array.isArray(obj)) return obj.map(v => interpolateDeep(v, context));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, interpolateDeep(v, context)])
    );
  }
  return obj;
}

/**
 * 简单条件求值
 * 支持：$stepId.field > 0、$stepId.ok == true 等
 */
function evaluateCondition(condition, context) {
  if (!condition) return true;
  try {
    // 替换 $xxx 变量引用为实际 JSON 值
    const expr = condition.replace(/\$([\w.]+)/g, (_, path) => {
      const parts = path.split('.');
      let val = context;
      for (const p of parts) val = val?.[p];
      return JSON.stringify(val ?? null);
    });
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`return (${expr})`)());
  } catch {
    console.warn(`[workflow] condition eval failed: ${condition}`);
    return true;
  }
}

/**
 * 执行工作流
 *
 * @param {object} workflow  已解析的工作流定义
 * @param {object} options
 *   @param {object}   options.inputs      外部输入变量
 *   @param {Function} options.onEvent     事件回调 (event) => void
 *   @param {Function} options.onApprove   用户审批回调，返回 Promise<{approved}>
 *   @param {string}   options.runId       可选，指定执行 ID
 */
export async function runWorkflow(workflow, options = {}) {
  const { inputs = {}, onEvent, onApprove, runId: providedRunId } = options;
  const runId = providedRunId || nanoid(10);
  const startedAt = Date.now();

  const emit = (type, data = {}) => {
    if (onEvent) onEvent({ type, runId, workflow: workflow.name, ...data });
  };

  const run = {
    id: runId,
    workflowName: workflow.name,
    status: 'running',
    startedAt,
    steps: {},
    abort: false,
  };
  activeRuns.set(runId, run);

  emit('workflow.start', { steps: workflow.steps?.length ?? 0 });

  // 构建步骤上下文
  const context = { inputs, ...inputs };

  try {
    const steps = workflow.steps || [];

    for (const step of steps) {
      if (run.abort) break;

      const { id: stepId, action, params = {}, condition, timeout = 60_000, continueOnError = false } = step;

      // 条件检查
      if (!evaluateCondition(condition, context)) {
        emit('step.skip', { stepId, reason: `condition false: ${condition}` });
        continue;
      }

      // 插值参数
      const resolvedParams = interpolateDeep(params, context);

      emit('step.start', { stepId, action });

      // 用户审批门
      if (action === 'user.approve' && onApprove) {
        emit('step.approve', { stepId, message: resolvedParams.message });
        const { approved } = await onApprove({ runId, stepId, params: resolvedParams });
        run.steps[stepId] = { action, approved, completedAt: Date.now() };
        context[stepId] = { approved };
        if (!approved) {
          emit('step.rejected', { stepId });
          run.status = 'rejected';
          return { runId, status: 'rejected', context };
        }
        emit('step.done', { stepId, result: { approved } });
        continue;
      }

      // 执行动作（带超时）
      let result;
      try {
        result = await Promise.race([
          executeAction(action, resolvedParams),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Step timeout: ${stepId} (${timeout}ms)`)), timeout)
          ),
        ]);
      } catch (err) {
        emit('step.error', { stepId, action, error: err.message });
        run.steps[stepId] = { action, error: err.message, completedAt: Date.now() };
        context[stepId] = { error: err.message, ok: false };

        if (!continueOnError) {
          run.status = 'failed';
          activeRuns.set(runId, run);
          return { runId, status: 'failed', failedStep: stepId, error: err.message, context };
        }
        continue;
      }

      run.steps[stepId] = { action, result, completedAt: Date.now() };
      context[stepId] = result;
      emit('step.done', { stepId, action, result });
    }

    run.status = run.abort ? 'aborted' : 'completed';
    emit('workflow.done', { status: run.status, duration: Date.now() - startedAt });
    return { runId, status: run.status, context };

  } catch (err) {
    run.status = 'error';
    emit('workflow.error', { error: err.message });
    return { runId, status: 'error', error: err.message };
  } finally {
    // 5 分钟后清理
    setTimeout(() => activeRuns.delete(runId), 5 * 60 * 1000);
  }
}

/**
 * 中止正在运行的工作流
 */
export function abortWorkflow(runId) {
  const run = activeRuns.get(runId);
  if (!run) return false;
  run.abort = true;
  return true;
}

/**
 * 获取工作流执行状态
 */
export function getRunStatus(runId) {
  const run = activeRuns.get(runId);
  if (!run) return null;
  return {
    id: run.id,
    workflowName: run.workflowName,
    status: run.status,
    startedAt: run.startedAt,
    steps: run.steps,
  };
}

/**
 * 列出所有活跃工作流
 */
export function listActiveRuns() {
  return Array.from(activeRuns.values()).map(r => ({
    id: r.id,
    workflowName: r.workflowName,
    status: r.status,
    startedAt: r.startedAt,
  }));
}
