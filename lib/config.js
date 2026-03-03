/**
 * Config System — 层级配置加载器
 *
 * 优先级（高→低）：
 * 1. 环境变量 CLAUDE_WPS_*
 * 2. ~/.claude-wps/config.json（用户配置）
 * 3. 内置默认值
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.claude-wps');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  agent: {
    model: 'claude-sonnet-4-6',
    fallback: 'claude-haiku-4-5',
    thinkingLevel: 'medium',
    maxOutputTokens: 32000,
  },
  soul: {
    name: '小金',
    locale: 'zh-CN',
    style: 'professional-warm',
  },
  memory: {
    enabled: true,
    factExtractionModel: 'haiku',
    maxFacts: 500,
    maxFactsInContext: 30,
    sessionSummaryRetention: 30,
  },
  channels: {
    feishu: { enabled: false, webhookUrl: '' },
    email: { enabled: false, smtp: {}, from: '' },
    webhook: { enabled: false, url: '', events: [] },
  },
  scheduler: { enabled: false, tasks: [] },
  heartbeat: {
    interval: 30000,
    reconnectDelay: 5000,
    maxRetries: 10,
  },
  skills: {
    bundledDir: 'skills/bundled',
    connectorsDir: 'skills/connectors',
    maxLoad: 4,
    maxBodySize: 12000,
  },
};

let _cached = null;

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadConfig(forceReload = false) {
  if (_cached && !forceReload) return _cached;

  let userConfig = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      userConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { /* ignore malformed config */ }
  }

  let config = deepMerge(DEFAULTS, userConfig);

  const envModel = process.env.CLAUDE_WPS_MODEL;
  if (envModel) config.agent.model = envModel;

  const envSoulName = process.env.CLAUDE_WPS_SOUL_NAME;
  if (envSoulName) config.soul.name = envSoulName;

  const envMemory = process.env.CLAUDE_WPS_MEMORY;
  if (envMemory === 'false' || envMemory === '0') config.memory.enabled = false;

  _cached = config;
  return config;
}

export function saveConfig(updates) {
  let existing = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch { /* ignore */ }
  }
  const merged = deepMerge(existing, updates);
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  _cached = null;
}

export function ensureConfigFile() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      agent: { model: 'claude-sonnet-4-6' },
      soul: { name: '小金' },
      memory: { enabled: true },
    }, null, 2), 'utf-8');
  }
}

export function getConfigDir() {
  return CONFIG_DIR;
}

export { CONFIG_PATH, DEFAULTS };
