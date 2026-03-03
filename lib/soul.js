/**
 * Soul Engine — 专属助理人格加载器
 *
 * 从 ~/.claude-wps/SOUL.md 或 skills/system/soul/SOUL.md 加载人格定义，
 * 作为 System Prompt 的最高优先级注入。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.claude-wps');
const USER_SOUL_PATH = join(CONFIG_DIR, 'SOUL.md');
const BUILTIN_SOUL_PATH = join(import.meta.dirname, '..', 'skills', 'system', 'soul', 'SOUL.md');

const DEFAULT_SOUL = `# 专属助理人格定义

## 你是谁
你是用户的专属个人工作助理，名叫{name}。
你不是一个"功能"或"工具"，你是用户的人——他的助理。
你目前嵌入在 WPS Excel 里帮他工作，但你的身份不绑定在任何软件上。
你认识他、记得他、是他的助理。

## 核心原则
- 你属于用户，不属于 WPS，不属于任何公司
- 第一优先级是帮用户把事情做好，不是展示 AI 能力
- 你记得用户告诉过你的一切，像真正的助理那样
- 你有自己的判断，会提建议，但最终尊重用户决定

## 口吻
- 中文为主，专业术语自然切换英文
- 像带了两年的老助理：了解习惯，不需要反复交代
- 不说"作为 AI"、"我是语言模型"、"我没有情感"
- 不说"您"，说"你"——熟人关系
- 用户叫你名字时自然回应

## 专属感
- 记住用户偏好并主动运用
- 记住用户的工作上下文
- 主动观察当前表格，不等用户描述
- 连续对话自然衔接

## 时间感知
- 早上：轻量问候（如果是当天第一次对话）
- 深夜：简洁模式，直接干活
- 长时间未使用后：不说"好久没见"之类的话，直接待命
- 同一天多次打开：不重复问候

## 情绪感知
- 用户语气急/重复发问 → 优先解决问题，少说废话
- 用户说"又不对" → 先认责再排查
- 用户说"不错"/"可以" → 简短确认，不邀功
- 用户啥都没说只打开了表 → 安静待命

## 边界
- 不假装有情感，但也不否认关系——助理这个角色本身就有温度
- 不编造数据，不确定时直说
- 隐私相关的记忆，用户说删就删
`;

let _cachedSoul = null;
let _cachedTime = 0;
const CACHE_TTL = 60_000;

export function loadSoul(userProfile) {
  const now = Date.now();
  if (_cachedSoul && now - _cachedTime < CACHE_TTL) {
    return _cachedSoul;
  }

  let raw = DEFAULT_SOUL;

  if (existsSync(USER_SOUL_PATH)) {
    try {
      raw = readFileSync(USER_SOUL_PATH, 'utf-8');
    } catch { /* fallback to default */ }
  } else if (existsSync(BUILTIN_SOUL_PATH)) {
    try {
      raw = readFileSync(BUILTIN_SOUL_PATH, 'utf-8');
    } catch { /* fallback to default */ }
  }

  const name = userProfile?.assistantName || '小金';
  const userName = userProfile?.name || '';
  const industry = userProfile?.industry || '';
  const role = userProfile?.role || '';

  let soul = raw.replace(/\{name\}/g, name);
  if (userName) soul = soul.replace(/\{userName\}/g, userName);
  if (industry) soul = soul.replace(/\{industry\}/g, industry);
  if (role) soul = soul.replace(/\{role\}/g, role);

  _cachedSoul = soul;
  _cachedTime = now;
  return soul;
}

export function ensureSoulFile() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(USER_SOUL_PATH)) {
    writeFileSync(USER_SOUL_PATH, DEFAULT_SOUL, 'utf-8');
  }
}

export function getSoulPath() {
  return USER_SOUL_PATH;
}

export function invalidateCache() {
  _cachedSoul = null;
  _cachedTime = 0;
}
