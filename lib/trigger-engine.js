/**
 * Trigger Engine — 触发器引擎
 *
 * 启动时扫描所有工作流目录，自动注册触发器：
 * - manual   : 通过 /workflow/start 手动触发
 * - cron     : 使用 node-cron 定时触发
 * - webhook  : 通过 POST /trigger/:name 触发
 * - file-watch: 使用 fs.watch 监控文件变化
 */

import { readdirSync, readFileSync, watchFile, existsSync } from 'fs';
import { join } from 'path';
import cron from 'node-cron';
import yaml from 'js-yaml';
import { loadWorkflowFromFile, runWorkflow } from './workflow-engine.js';

const registeredTriggers = new Map(); // name -> trigger info
const cronJobs = new Map();           // name -> cron.ScheduledTask

/**
 * 扫描 workflows 目录，读取所有 workflow.yaml 并注册触发器
 * @param {string} workflowsDir  工作流目录路径
 */
export function scanAndRegisterWorkflows(workflowsDir) {
  if (!existsSync(workflowsDir)) {
    console.log(`[trigger] workflows dir not found, skipping: ${workflowsDir}`);
    return;
  }

  const entries = readdirSync(workflowsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const yamlPath = join(workflowsDir, entry.name, 'workflow.yaml');
    if (!existsSync(yamlPath)) continue;

    try {
      const workflow = loadWorkflowFromFile(yamlPath);
      registerWorkflowTrigger(workflow, yamlPath);
    } catch (err) {
      console.warn(`[trigger] failed to load ${yamlPath}: ${err.message}`);
    }
  }
  console.log(`[trigger] registered ${registeredTriggers.size} workflow(s)`);
}

/**
 * 注册单个工作流的触发器
 */
function registerWorkflowTrigger(workflow, yamlPath) {
  const { name, trigger } = workflow;
  if (!name) {
    console.warn(`[trigger] workflow at ${yamlPath} has no name, skipping`);
    return;
  }

  const triggerInfo = {
    name,
    yamlPath,
    type: trigger?.type || 'manual',
    schedule: trigger?.schedule,
    registeredAt: Date.now(),
  };

  registeredTriggers.set(name, triggerInfo);

  // Cron 触发器
  if (trigger?.type === 'cron' && trigger?.schedule) {
    if (!cron.validate(trigger.schedule)) {
      console.warn(`[trigger] invalid cron expression for "${name}": ${trigger.schedule}`);
      return;
    }
    const job = cron.schedule(trigger.schedule, () => {
      console.log(`[trigger] cron fire: ${name}`);
      fireTrigger(name, {}).catch(err =>
        console.error(`[trigger] cron error (${name}): ${err.message}`)
      );
    }, { timezone: trigger.timezone || 'Asia/Shanghai' });

    cronJobs.set(name, job);
    console.log(`[trigger] cron registered: ${name} @ "${trigger.schedule}"`);
  }

  // 文件监听触发器
  if (trigger?.type === 'file-watch' && trigger?.path) {
    const watchPath = trigger.path;
    if (existsSync(watchPath)) {
      watchFile(watchPath, { interval: 5000 }, () => {
        console.log(`[trigger] file-watch fire: ${name} (${watchPath})`);
        fireTrigger(name, { changedFile: watchPath }).catch(err =>
          console.error(`[trigger] file-watch error (${name}): ${err.message}`)
        );
      });
      console.log(`[trigger] file-watch registered: ${name} @ ${watchPath}`);
    } else {
      console.warn(`[trigger] file-watch: file not found: ${watchPath}`);
    }
  }
}

/**
 * 触发执行一个工作流（无 SSE 回调，后台运行）
 * @param {string} name    工作流名
 * @param {object} inputs  输入变量
 * @param {Function} onEvent  可选事件回调
 */
export async function fireTrigger(name, inputs = {}, onEvent = null) {
  const info = registeredTriggers.get(name);
  if (!info) throw new Error(`Workflow not found: ${name}`);

  const workflow = loadWorkflowFromFile(info.yamlPath);
  return runWorkflow(workflow, { inputs, onEvent });
}

/**
 * 列出所有已注册的触发器
 */
export function listTriggers() {
  return Array.from(registeredTriggers.values());
}

/**
 * 获取单个触发器信息
 */
export function getTrigger(name) {
  return registeredTriggers.get(name) || null;
}

/**
 * 动态注册（或更新）一个工作流触发器
 */
export function addTrigger(yamlPath) {
  const workflow = loadWorkflowFromFile(yamlPath);
  registerWorkflowTrigger(workflow, yamlPath);
  return workflow.name;
}

/**
 * 停止并移除一个 Cron 触发器
 */
export function removeTrigger(name) {
  const job = cronJobs.get(name);
  if (job) {
    job.destroy();
    cronJobs.delete(name);
  }
  registeredTriggers.delete(name);
}
