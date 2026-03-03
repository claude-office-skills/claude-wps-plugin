/**
 * Long Task Manager — 长任务生命周期管理
 *
 * 提供后台执行 + SSE 进度推送 + 任务状态查询/中止。
 * 将 Workflow Engine 的 onEvent 映射为 SSE data: 格式。
 *
 * 任务类型:
 *   - workflow: 通过 Workflow Engine 执行多步骤工作流
 *   - action:   直接执行单个 AI Action（如 ai.generateImage）
 */

import { nanoid } from "nanoid";
import { executeAction } from "./action-registry.js";
import { runWorkflow, abortWorkflow } from "./workflow-engine.js";

const tasks = new Map();
const TASK_TTL = 30 * 60 * 1000; // 30 分钟后自动清理

/**
 * @typedef {object} LongTask
 * @property {string} id
 * @property {'workflow'|'action'} type
 * @property {'queued'|'running'|'completed'|'failed'|'aborted'} status
 * @property {number} startedAt
 * @property {number|null} completedAt
 * @property {Array} events - 所有进度事件
 * @property {Set} subscribers - 活跃的 SSE 回调
 * @property {*} result
 * @property {string|null} error
 */

function createTask(type, meta = {}) {
  const id = `lt-${nanoid(8)}`;
  const task = {
    id,
    type,
    status: "queued",
    startedAt: Date.now(),
    completedAt: null,
    events: [],
    subscribers: new Set(),
    result: null,
    error: null,
    meta,
  };
  tasks.set(id, task);
  scheduleCleaner(id);
  return task;
}

function scheduleCleaner(taskId) {
  setTimeout(() => tasks.delete(taskId), TASK_TTL);
}

function emit(task, event) {
  const evt = { ...event, taskId: task.id, timestamp: Date.now() };
  task.events.push(evt);
  for (const cb of task.subscribers) {
    try {
      cb(evt);
    } catch {}
  }
}

/**
 * 启动一个单 Action 长任务
 *
 * @param {string} actionName  如 'ai.generateImage'
 * @param {object} params      Action 参数
 * @returns {{ taskId: string }}
 */
export function startActionTask(actionName, params = {}) {
  const task = createTask("action", { actionName });

  (async () => {
    task.status = "running";
    emit(task, { type: "task.start", actionName });

    try {
      const result = await executeAction(actionName, {
        ...params,
        onProgress: (progress) => {
          emit(task, { type: "task.progress", ...progress });
        },
      });
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      emit(task, { type: "task.done", result });
    } catch (err) {
      task.status = "failed";
      task.error = err.message;
      task.completedAt = Date.now();
      emit(task, { type: "task.error", error: err.message });
    }
  })();

  return { taskId: task.id };
}

/**
 * 启动一个 Workflow 长任务
 *
 * @param {object} workflow  已解析的工作流定义
 * @param {object} inputs    工作流输入
 * @returns {{ taskId: string }}
 */
export function startWorkflowTask(workflow, inputs = {}) {
  const task = createTask("workflow", { workflowName: workflow.name });

  (async () => {
    task.status = "running";
    emit(task, { type: "task.start", workflowName: workflow.name });

    try {
      const result = await runWorkflow(workflow, {
        inputs,
        onEvent: (evt) => {
          emit(task, { type: "workflow.event", ...evt });
        },
      });
      task.status = result.status === "completed" ? "completed" : "failed";
      task.result = result;
      task.completedAt = Date.now();
      emit(task, { type: "task.done", result });
    } catch (err) {
      task.status = "failed";
      task.error = err.message;
      task.completedAt = Date.now();
      emit(task, { type: "task.error", error: err.message });
    }
  })();

  return { taskId: task.id };
}

/**
 * 订阅任务的 SSE 事件流
 * 返回取消订阅函数
 */
export function subscribe(taskId, callback) {
  const task = tasks.get(taskId);
  if (!task) return null;

  // 先推送已有的历史事件
  for (const evt of task.events) {
    try {
      callback(evt);
    } catch {}
  }

  task.subscribers.add(callback);
  return () => task.subscribers.delete(callback);
}

/**
 * 中止任务
 */
export function abortTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status !== "running") return false;

  if (task.type === "workflow" && task.meta?.runId) {
    abortWorkflow(task.meta.runId);
  }

  task.status = "aborted";
  task.completedAt = Date.now();
  emit(task, { type: "task.aborted" });
  return true;
}

/**
 * 获取任务状态
 */
export function getTaskStatus(taskId) {
  const task = tasks.get(taskId);
  if (!task) return null;
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    result: task.result,
    error: task.error,
    meta: task.meta,
    eventCount: task.events.length,
  };
}

/**
 * 列出所有活跃任务
 */
export function listTasks() {
  return Array.from(tasks.values()).map((t) => ({
    id: t.id,
    type: t.type,
    status: t.status,
    startedAt: t.startedAt,
    meta: t.meta,
  }));
}
