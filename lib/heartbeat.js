/**
 * Heartbeat — Proxy 常驻心跳模块
 *
 * 功能：
 * 1. 每 30s 记录心跳，写入 ~/.claude-wps/heartbeat.json
 * 2. 暴露 getStatus() 供 /health 端点使用
 * 3. 追踪 WPS Plugin Host 连接状态（通过 /context POST 更新）
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.claude-wps');
const HEARTBEAT_FILE = join(CONFIG_DIR, 'heartbeat.json');
const HEARTBEAT_INTERVAL_MS = 30_000;

const state = {
  startedAt: Date.now(),
  lastBeat: Date.now(),
  wpsConnected: false,
  wpsLastSeen: null,
  activeSessions: 0,
  workflowsRunning: 0,
  version: '2.2.0',
};

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function writeHeartbeat() {
  state.lastBeat = Date.now();
  try {
    ensureConfigDir();
    writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      ...state,
      uptime: Math.floor((Date.now() - state.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    }, null, 2));
  } catch {
    // 写入失败不中断主流程
  }
}

export function markWpsConnected() {
  state.wpsConnected = true;
  state.wpsLastSeen = Date.now();
}

export function markWpsDisconnected() {
  state.wpsConnected = false;
}

export function setActiveSessions(n) {
  state.activeSessions = n;
}

export function setWorkflowsRunning(n) {
  state.workflowsRunning = n;
}

export function getStatus() {
  const now = Date.now();
  const wpsStale = state.wpsLastSeen && (now - state.wpsLastSeen > 10_000);
  return {
    status: 'ok',
    version: state.version,
    uptime: Math.floor((now - state.startedAt) / 1000),
    lastBeat: state.lastBeat,
    wpsConnected: state.wpsConnected && !wpsStale,
    wpsLastSeen: state.wpsLastSeen,
    activeSessions: state.activeSessions,
    workflowsRunning: state.workflowsRunning,
    timestamp: now,
  };
}

export function startHeartbeat() {
  writeHeartbeat();
  const timer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  timer.unref(); // 不阻止进程退出
  console.log(`[heartbeat] started, writing to ${HEARTBEAT_FILE}`);
  return timer;
}
