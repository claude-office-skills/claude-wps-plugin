/**
 * Agent Loader — 自动发现并解析 agents/*.md 定义文件
 *
 * 每个 Agent 是一个 Markdown 文件，包含:
 *   - YAML frontmatter: name, description, model, color, tools
 *   - Markdown body: 独立的 System Prompt
 *
 * 支持模板变量: {name}, {userName}, {industry}, {role}
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const BUNDLED_AGENTS_DIR = resolve(import.meta.dirname, "..", "agents");
const USER_AGENTS_DIR = join(homedir(), ".claude-wps", "agents");

const EXAMPLE_RE = /<example>(.*?)<\/example>/gs;

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000;

/**
 * 解析 YAML frontmatter 与 Markdown body
 * @param {string} raw - 文件原始内容
 * @returns {{ meta: object, body: string }}
 */
function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized };

  const yamlStr = match[1];
  const body = match[2].trim();

  const meta = {};
  let currentKey = null;
  let currentValue = "";
  let inMultiline = false;

  for (const line of yamlStr.split("\n")) {
    if (!inMultiline) {
      const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
      if (kvMatch) {
        if (currentKey) {
          meta[currentKey] = parseYamlValue(currentValue.trim());
        }
        currentKey = kvMatch[1];
        const val = kvMatch[2].trim();
        if (val === "|" || val === ">") {
          inMultiline = true;
          currentValue = "";
        } else {
          currentValue = val;
        }
        continue;
      }
      if (line.match(/^\s+-\s+/)) {
        currentValue += "\n" + line;
        continue;
      }
    } else {
      if (line.match(/^\w/) && line.includes(":")) {
        meta[currentKey] = currentValue.trim();
        inMultiline = false;
        const kvMatch2 = line.match(/^(\w[\w-]*):\s*(.*)/);
        if (kvMatch2) {
          currentKey = kvMatch2[1];
          const val = kvMatch2[2].trim();
          if (val === "|" || val === ">") {
            inMultiline = true;
            currentValue = "";
          } else {
            currentValue = val;
          }
        }
        continue;
      }
      currentValue += "\n" + line;
    }
  }
  if (currentKey) {
    meta[currentKey] = inMultiline
      ? currentValue.trim()
      : parseYamlValue(currentValue.trim());
  }

  return { meta, body };
}

function parseYamlValue(val) {
  if (val.startsWith("[") && val.endsWith("]")) {
    return val
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  }
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
  if (val === "true") return true;
  if (val === "false") return false;
  if (/^\d+$/.test(val)) return Number(val);

  if (/^\s*-\s+/.test(val) || val.includes("\n  -")) {
    return val
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }

  return val;
}

/**
 * 从 description 中提取 <example> 标签作为意图触发词
 */
function extractExamples(description) {
  if (!description) return [];
  const examples = [];
  let m;
  while ((m = EXAMPLE_RE.exec(description)) !== null) {
    examples.push(m[1].trim().toLowerCase());
  }
  EXAMPLE_RE.lastIndex = 0;
  return examples;
}

/**
 * 扫描目录加载所有 Agent 定义
 */
function loadAgentsFromDir(dir) {
  const agents = [];
  if (!existsSync(dir)) return agents;

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      if (stat.isDirectory()) continue;

      const raw = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);

      if (!meta.name) continue;

      agents.push({
        name: meta.name,
        description: meta.description || "",
        model: meta.model || "inherit",
        color: meta.color || "#6B7280",
        tools: Array.isArray(meta.tools) ? meta.tools : [],
        examples: extractExamples(meta.description),
        systemPrompt: body,
        source: filePath,
      });
    } catch (e) {
      console.warn(`[agent-loader] Failed to parse ${file}: ${e.message}`);
    }
  }

  return agents;
}

/**
 * 加载所有 Agent（bundled + user），user 同名覆盖 bundled
 */
export function loadAllAgents() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  const bundled = loadAgentsFromDir(BUNDLED_AGENTS_DIR);
  const user = loadAgentsFromDir(USER_AGENTS_DIR);

  const byName = new Map();
  for (const a of bundled) byName.set(a.name, a);
  for (const a of user) byName.set(a.name, a);

  _cache = [...byName.values()];
  _cacheTime = now;

  console.log(
    `[agent-loader] Loaded ${_cache.length} agents: ${_cache.map((a) => a.name).join(", ")}`,
  );

  return _cache;
}

/**
 * 按名称查找 Agent
 */
export function getAgentByName(name) {
  const agents = loadAllAgents();
  return agents.find((a) => a.name === name) || null;
}

/**
 * Level 1 意图匹配：用 <example> 中的关键词做模糊匹配
 * @returns {Array<{agent: object, score: number}>} 匹配结果（按 score 降序）
 */
export function matchAgentByIntent(userMessage) {
  const agents = loadAllAgents();
  const msg = userMessage.toLowerCase();

  const results = [];
  for (const agent of agents) {
    let score = 0;
    for (const example of agent.examples) {
      if (msg.includes(example)) {
        score += example.length;
      } else {
        const words = example.split(/\s+/);
        const matched = words.filter((w) => w.length > 1 && msg.includes(w));
        score += matched.length * 2;
      }
    }
    if (score > 0) {
      results.push({ agent, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 注入模板变量到 Agent System Prompt
 */
export function renderAgentPrompt(agent, userProfile) {
  let prompt = agent.systemPrompt;
  const vars = {
    name: userProfile?.assistantName || "小金",
    userName: userProfile?.name || "用户",
    industry: userProfile?.industry || "",
    role: userProfile?.role || "",
  };

  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }

  return prompt;
}

/**
 * 清除缓存（Agent 文件变更时调用）
 */
export function invalidateAgentCache() {
  _cache = null;
  _cacheTime = 0;
}

/**
 * 列出所有 Agent 的摘要信息（供前端 API 使用）
 */
export function listAgentSummaries() {
  const agents = loadAllAgents();
  return agents.map((a) => ({
    name: a.name,
    description: (a.description || "")
      .replace(/<example>.*?<\/example>/gs, "")
      .trim(),
    model: a.model,
    color: a.color,
    tools: a.tools,
  }));
}
