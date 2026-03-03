/**
 * Long-Term Memory Engine — 专属助理长记忆系统
 *
 * 存储结构 (~/.claude-wps/memory/):
 *   user-profile.json  — 用户画像（行业/职能/名字/偏好）
 *   facts.jsonl         — 事实记忆（一条一行，追加写）
 *   preferences.json    — 使用偏好（模型/风格/常用操作）
 *   skills-usage.json   — Skill 使用频率统计
 *   session-summaries/  — 每次对话的摘要
 */

import {
  readFileSync, writeFileSync, appendFileSync,
  existsSync, mkdirSync, readdirSync, statSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.claude-wps');
const MEMORY_DIR = join(CONFIG_DIR, 'memory');
const PROFILE_PATH = join(MEMORY_DIR, 'user-profile.json');
const FACTS_PATH = join(MEMORY_DIR, 'facts.jsonl');
const PREFS_PATH = join(MEMORY_DIR, 'preferences.json');
const SKILLS_USAGE_PATH = join(MEMORY_DIR, 'skills-usage.json');
const SUMMARIES_DIR = join(MEMORY_DIR, 'session-summaries');

const MAX_FACTS_IN_CONTEXT = 30;
const MAX_FACTS_TOTAL = 500;

// ── Directory setup ──────────────────────────────────────────

export function ensureMemoryDirs() {
  for (const dir of [CONFIG_DIR, MEMORY_DIR, SUMMARIES_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ── User Profile ─────────────────────────────────────────────

export function loadUserProfile() {
  try {
    if (existsSync(PROFILE_PATH)) {
      return JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

export function saveUserProfile(profile) {
  ensureMemoryDirs();
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
}

export function isOnboarded() {
  const profile = loadUserProfile();
  return profile !== null && profile.onboarded === true;
}

// ── Facts (append-only JSONL) ────────────────────────────────

export function appendFacts(facts) {
  ensureMemoryDirs();
  const lines = facts
    .map(f => JSON.stringify({ ...f, ts: Date.now() }))
    .join('\n') + '\n';
  appendFileSync(FACTS_PATH, lines, 'utf-8');
  _trimFactsIfNeeded();
}

export function loadRecentFacts(limit = MAX_FACTS_IN_CONTEXT) {
  try {
    if (!existsSync(FACTS_PATH)) return [];
    const lines = readFileSync(FACTS_PATH, 'utf-8')
      .split('\n')
      .filter(l => l.trim());
    return lines
      .slice(-limit)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function _trimFactsIfNeeded() {
  try {
    if (!existsSync(FACTS_PATH)) return;
    const lines = readFileSync(FACTS_PATH, 'utf-8')
      .split('\n')
      .filter(l => l.trim());
    if (lines.length > MAX_FACTS_TOTAL) {
      const trimmed = lines.slice(-MAX_FACTS_TOTAL);
      writeFileSync(FACTS_PATH, trimmed.join('\n') + '\n', 'utf-8');
    }
  } catch { /* ignore */ }
}

// ── Preferences ──────────────────────────────────────────────

export function loadPreferences() {
  try {
    if (existsSync(PREFS_PATH)) {
      return JSON.parse(readFileSync(PREFS_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

export function savePreferences(prefs) {
  ensureMemoryDirs();
  const existing = loadPreferences();
  const merged = { ...existing, ...prefs };
  writeFileSync(PREFS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
}

// ── Skills Usage ─────────────────────────────────────────────

export function recordSkillUsage(skillNames) {
  ensureMemoryDirs();
  let usage = {};
  try {
    if (existsSync(SKILLS_USAGE_PATH)) {
      usage = JSON.parse(readFileSync(SKILLS_USAGE_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }

  for (const name of skillNames) {
    if (!usage[name]) usage[name] = { count: 0, lastUsed: 0 };
    usage[name].count += 1;
    usage[name].lastUsed = Date.now();
  }
  writeFileSync(SKILLS_USAGE_PATH, JSON.stringify(usage, null, 2), 'utf-8');
}

// ── Session Summaries ────────────────────────────────────────

export function saveSessionSummary(sessionId, summary) {
  ensureMemoryDirs();
  const today = new Date().toISOString().split('T')[0];
  const filePath = join(SUMMARIES_DIR, `${today}_${sessionId}.json`);
  writeFileSync(filePath, JSON.stringify({
    sessionId,
    date: today,
    summary,
    ts: Date.now(),
  }, null, 2), 'utf-8');
}

export function loadLatestSummary() {
  try {
    if (!existsSync(SUMMARIES_DIR)) return null;
    const files = readdirSync(SUMMARIES_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return JSON.parse(readFileSync(join(SUMMARIES_DIR, files[0]), 'utf-8'));
  } catch {
    return null;
  }
}

// ── Build Memory Context (injected into System Prompt) ───────

export function buildMemoryContext() {
  const profile = loadUserProfile();
  const facts = loadRecentFacts();
  const prefs = loadPreferences();
  const lastSession = loadLatestSummary();

  if (!profile && facts.length === 0 && !lastSession) {
    return '';
  }

  let ctx = '\n## 你对用户的了解\n';

  if (profile) {
    const parts = [];
    if (profile.name) parts.push(`用户叫${profile.name}`);
    if (profile.industry) parts.push(`${profile.industry}行业`);
    if (profile.role) parts.push(profile.role);
    if (parts.length > 0) ctx += parts.join('，') + '。\n';
    if (profile.assistantName && profile.assistantName !== '小金') {
      ctx += `用户给你取名叫"${profile.assistantName}"。\n`;
    }
  }

  if (facts.length > 0) {
    ctx += '\n已知事实（自然使用，不要说"根据记忆"）：\n';
    for (const f of facts) {
      ctx += `- ${f.fact || f.content || JSON.stringify(f)}\n`;
    }
  }

  if (prefs && Object.keys(prefs).length > 0) {
    const prefEntries = Object.entries(prefs).slice(0, 10);
    if (prefEntries.length > 0) {
      ctx += '\n用户偏好：\n';
      for (const [k, v] of prefEntries) {
        ctx += `- ${k}: ${v}\n`;
      }
    }
  }

  if (lastSession?.summary) {
    ctx += `\n上次对话（${lastSession.date || '最近'}）：${lastSession.summary}\n`;
  }

  return ctx;
}

// ── Time-Aware Context ───────────────────────────────────────

export function buildTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const profile = loadUserProfile();

  let ctx = '';

  if (hour >= 0 && hour < 6) {
    ctx += '\n[时间感知] 现在是深夜/凌晨，用户可能在加班。回复简洁高效，不寒暄。\n';
  } else if (hour >= 6 && hour < 9) {
    if (profile?.name) {
      ctx += `\n[时间感知] 早上好。如果这是今天第一次对话，可以简短问候"早，${profile.name}"，然后直接进入工作。\n`;
    }
  } else if (hour >= 22) {
    ctx += '\n[时间感知] 已经很晚了，回复简洁，帮用户快速完成。\n';
  }

  return ctx;
}

export { MEMORY_DIR, CONFIG_DIR };
