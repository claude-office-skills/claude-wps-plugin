/**
 * 本地代理服务器
 *
 * 1) 接收浏览器插件的请求，调用本地已认证的 claude CLI 执行，以 SSE 流式返回响应。
 * 2) WPS 上下文中转：Plugin Host POST 数据，Task Pane GET 读取。
 * 3) 代码执行桥：Task Pane 提交代码 → proxy 存入队列 → Plugin Host 轮询执行 → 结果回传。
 *
 * 运行：node proxy-server.js
 * 端口：3001
 */
import express from "express";
import cors from "cors";
import { spawn, exec, execSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  unlinkSync,
  renameSync,
  copyFileSync,
  rmSync,
  statSync,
} from "fs";
import { createWriteStream } from "fs";
import { tmpdir, homedir } from "os";
import { join, dirname, resolve } from "path";
import { createHash } from "crypto";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const yaml = require("js-yaml");

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── v3.2.0: Direct API client for light tier (bypass CLI cold start) ────
import * as directApi from "./lib/direct-api-client.js";
const USE_DIRECT_API = process.env.USE_DIRECT_API !== "false";

// ── v2.2.0: Soul + Memory + Config ──────────────────────────
import {
  loadSoul,
  ensureSoulFile,
  invalidateCache as invalidateSoulCache,
} from "./lib/soul.js";
import {
  ensureMemoryDirs,
  loadUserProfile,
  saveUserProfile,
  isOnboarded,
  appendFacts,
  loadRecentFacts,
  loadPreferences,
  savePreferences,
  recordSkillUsage,
  saveSessionSummary,
  loadLatestSummary,
  buildMemoryContext,
  buildTimeContext,
} from "./lib/memory.js";
import { loadConfig, saveConfig, ensureConfigFile } from "./lib/config.js";
import { parsePlanSteps, associateCodeBlocks } from "./lib/plan-parser.js";
import {
  generateSkillContent,
  buildSkillExtractionPrompt,
  parseSkillResponse,
  validateSkillMeta,
} from "./lib/skill-generator.js";
import { selectModel } from "./lib/model-router.js";
import {
  loadAllAgents,
  getAgentByName,
  matchAgentByIntent,
  renderAgentPrompt,
  listAgentSummaries,
  invalidateAgentCache,
} from "./lib/agent-loader.js";
import { dispatchAgent } from "./lib/agent-dispatcher.js";
import { runHooks } from "./lib/hook-engine.js";
import { startTeam, getTeamStatus } from "./lib/agent-team.js";
import connectorRegistry from "./lib/connector-registry.js";
import { importCredentials, importSingleFile } from "./lib/credential-importer.js";

// Initialize v2.2.0 subsystems on startup
ensureMemoryDirs();
ensureSoulFile();
ensureConfigFile();
const APP_CONFIG = loadConfig();
console.log(
  `[v2.2.0] Soul + Memory + Config initialized. Memory: ${APP_CONFIG.memory.enabled ? "ON" : "OFF"}, Soul: ${APP_CONFIG.soul.name}`,
);

function resolveClaudePath() {
  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) {
    return process.env.CLAUDE_PATH;
  }
  try {
    const found = execSync(
      "which claude 2>/dev/null || command -v claude 2>/dev/null",
      {
        encoding: "utf-8",
        timeout: 5000,
      },
    ).trim();
    if (found && existsSync(found)) return found;
  } catch {}

  const home = process.env.HOME || "/root";
  const candidates = [
    join(home, ".nvm/versions/node", process.version, "bin/claude"),
    join(dirname(process.execPath), "claude"),
    "/usr/local/bin/claude",
    join(home, ".npm-global/bin/claude"),
    join(home, ".claude/local/claude"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "claude";
}

const RESOLVED_CLAUDE_PATH = resolveClaudePath();

function isPathSafe(filePath, allowedDir) {
  const resolved = resolve(filePath);
  const allowed = resolve(allowedDir);
  return resolved.startsWith(allowed + "/") || resolved === allowed;
}

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

// ── Skill Loader ──────────────────────────────────────────────
function loadSkillsFromDir(subDir) {
  const skillsDir = join(__dirname, "skills", subDir);
  const skills = new Map();

  if (!existsSync(skillsDir)) return skills;

  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = join(skillsDir, dir.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const raw = readFileSync(skillFile, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    skills.set(dir.name, {
      ...frontmatter,
      body,
      name: frontmatter.name || dir.name,
    });
  }

  return skills;
}

function loadSkills() {
  return loadSkillsFromDir("bundled");
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  try {
    const fm = yaml.load(match[1]) || {};
    return { frontmatter: fm, body: match[2].trim() };
  } catch {
    return { frontmatter: {}, body: match[2].trim() };
  }
}

const SKILL_MAX_LOAD = 4;
const CONNECTOR_MAX_LOAD = 2;

function matchSkills(allSkills, userMessage, wpsContext, mode, maxLoad) {
  const scored = [];
  const msg = (userMessage || "").toLowerCase();
  const limit = maxLoad || SKILL_MAX_LOAD;

  for (const [id, skill] of allSkills) {
    if (mode && Array.isArray(skill.modes) && !skill.modes.includes(mode)) {
      continue;
    }

    const ctx = skill.context || {};
    let score = 0;

    if (ctx.always === true || ctx.always === "true") {
      score = 100;
    } else {
      if (Array.isArray(ctx.keywords)) {
        for (const kw of ctx.keywords) {
          if (msg.includes(kw.toLowerCase())) {
            score += kw.length >= 4 ? 10 : 5;
          }
        }
      }
      if (wpsContext && wpsContext.selection) {
        const sel = wpsContext.selection;
        if (
          (ctx.hasEmptyCells === true || ctx.hasEmptyCells === "true") &&
          sel.emptyCellCount > 0
        )
          score += 8;
        if (
          (ctx.hasFormulas === true || ctx.hasFormulas === "true") &&
          sel.hasFormulas
        )
          score += 8;
        if (ctx.minRows && sel.rowCount >= Number(ctx.minRows)) score += 5;
      }
    }

    if (score > 0) {
      const bodyLen = (skill.body || "").length;
      const priority = Number(ctx.priority) || 0;
      scored.push({ skill, score: score + priority, bodyLen });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const result = [];
  let totalBodyLen = 0;
  const BODY_BUDGET = 24000;

  for (const entry of scored) {
    if (result.length >= limit) break;
    const isHighPriority = (Number(entry.skill.context?.priority) || 0) >= 100;
    if (
      entry.skill.context?.always ||
      isHighPriority ||
      totalBodyLen + entry.bodyLen <= BODY_BUDGET
    ) {
      result.push(entry.skill);
      totalBodyLen += entry.bodyLen;
    }
  }

  return result;
}

const CHART_STYLE_OVERRIDE = `
## 图表创建（关键！请严格遵守）

### 0. 核心原则 — 不修改用户原始数据

**绝对禁止修改用户原有 Sheet 上的任何数据！**
- 图表和辅助数据应创建在**新建的 Sheet**（如 "图表分析"）上
- 从原始 Sheet 读取数据，写入到新 Sheet，然后在新 Sheet 上创建图表
- 如果用户明确要求在原 Sheet 上添加图表，则辅助数据写到 AA 列之后

\`\`\`javascript
// 推荐模式：新建 Sheet 放图表
var srcWs = Application.ActiveSheet;
var srcData = srcWs.Range("A1:H20").Value2; // 读取原始数据
var wb = Application.ActiveWorkbook;
var chartWs;
try {
  chartWs = wb.Sheets.Item("图表分析");
  chartWs.UsedRange.Clear(); // 清空旧内容
} catch(e) {
  chartWs = wb.Sheets.Add(null, wb.Sheets.Item(wb.Sheets.Count));
  chartWs.Name = "图表分析";
}
chartWs.Activate();
// 在 chartWs 上写数据和创建图表...
\`\`\`

### 1. API 兼容性（必须遵守，否则图表创建失败）

**Style 参数**：必须用 \`0\`。❌ 禁止 \`-1\`（返回 null）。

**可用 XlChartType**：4(折线) / 51(柱状) / 5(饼图) / 57(条形) / 1(面积)
❌ 绝对禁止 65(xlLineMarkers)——返回 null！

\`\`\`javascript
var shape = ws.Shapes.AddChart2(0, 4, left, top, width, height);
if (!shape) throw new Error("AddChart2 returned null");
\`\`\`

❌ WPS 不支持逗号分隔多区域 Range（如 \`"A1:D1,A3:D4"\`），SetSourceData 会静默失败。

### 2. 准备工作（每次生成图表前必须执行）

\`\`\`javascript
// (a) 删除当前 sheet 上所有已有的图表 shape，避免残留
var _sc = ws.Shapes.Count;
for (var _di = _sc; _di >= 1; _di--) {
  try { if (ws.Shapes.Item(_di).Chart) ws.Shapes.Item(_di).Delete(); } catch(e){}
}
\`\`\`

### 3. 辅助数据区域（写在远处列，不要写在主数据下方）

为图表准备的辅助数据，写到 **AA 列之后**（距主数据区很远），不污染用户可见区域：

\`\`\`javascript
var AUX_COL = "AA"; // 辅助数据从 AA 列开始
var auxRow = 1;
// 第1行：X轴标签（年份）
// 第2行起：每个系列一行，A列=系列名称，后续列=数值
ws.Range(AUX_COL + "1").Value2 = "年份";
ws.Range("AB1").Value2 = "2022A";
ws.Range("AC1").Value2 = "2023A";
// ...
ws.Range(AUX_COL + "2").Value2 = "营业收入";
ws.Range("AB2").Value2 = 1200;
// ...
\`\`\`

### 4. 图表定位

图表放在**主数据区域的右侧**（而非下方），和辅助数据同侧，不遮挡也不需要滚动：

\`\`\`javascript
// 图表放在 H 列右侧（约 500px 偏移），紧贴数据区顶部
var chartLeft = 520;  // 主数据区右侧
var chartTop1 = 20;   // 第一张图贴顶
var chartTop2 = chartTop1 + 380; // 第二张图在第一张下方
\`\`\`

如果用户数据列很多超出 H 列，则根据 UsedRange 动态计算：
\`\`\`javascript
var dataEndCol = ws.UsedRange.Column + ws.UsedRange.Columns.Count;
var chartLeft = Math.max(dataEndCol * 72, 500); // 72px ≈ 1列宽度
\`\`\`

### 5. 量级差异处理（非常重要）

当多个系列的数值量级差异超过 5 倍时（如营业收入 5000 vs EBIT 200），**绝对不要放在同一张图**。
分成独立图表，各自有合适的Y轴刻度：

- 图表1：收入类指标（营业收入、毛利润）—— 量级相近，可共图
- 图表2：利润类指标（EBIT、净利润）—— 量级相近，可共图
- 图表3：现金流指标（FCF）—— 单独
- 图表4：比率指标（毛利率、净利率）—— 百分比，单独

### 6. 颜色和样式

\`\`\`javascript
function setSeriesColor(chart, idx, bgr, w) {
  try {
    var s = chart.SeriesCollection.Item(idx);
    try { s.Border.Color = bgr; s.Border.Weight = w || 2.5; } catch(e) {}
    try { s.Format.Line.ForeColor.RGB = bgr; s.Format.Line.Weight = w || 2.5; } catch(e) {}
  } catch(e) {}
}
\`\`\`

颜色方案（BGR）：0xFF901E(蓝) / 0x3232FF(红) / 0x32CD32(绿) / 0x00CCFF(橙) / 0xCC33CC(紫)

### 7. 完整创建模式

\`\`\`javascript
// 清理旧图表
var _sc = ws.Shapes.Count;
for (var _di = _sc; _di >= 1; _di--) {
  try { if (ws.Shapes.Item(_di).Chart) ws.Shapes.Item(_di).Delete(); } catch(e){}
}

// 辅助数据写入 AA 列
ws.Range("AA1").Value2 = "年份";
ws.Range("AB1").Value2 = "2024A"; ws.Range("AC1").Value2 = "2025E"; // ...
ws.Range("AA2").Value2 = "营业收入";
ws.Range("AB2").Value2 = 3000; ws.Range("AC2").Value2 = 4200; // ...
ws.Range("AA3").Value2 = "毛利润";
ws.Range("AB3").Value2 = 1500; ws.Range("AC3").Value2 = 2100; // ...

// 创建图表（右侧定位）
var shape = ws.Shapes.AddChart2(0, 4, 520, 20, 640, 360);
if (!shape) throw new Error("AddChart2 returned null");
var chart = shape.Chart;
chart.SetSourceData(ws.Range("AA1:AF3"));
chart.HasTitle = true;
chart.ChartTitle.Text = "营业收入与毛利润趋势（百万元）";
setSeriesColor(chart, 1, 0xFF901E, 2.5);
setSeriesColor(chart, 2, 0x32CD32, 2.5);
try { chart.HasLegend = true; chart.Legend.Position = -4107; } catch(e) {}
\`\`\`

### 8. 关键禁止
- ❌ Style=-1 或 Type=65（返回 null）
- ❌ 量级差异 >5x 的数据放同一图表
- ❌ 辅助数据写在主数据下方（用户会看到杂乱行）
- ❌ 图表放在数据正下方需要滚动很远（放右侧）
- ❌ 不清理旧图表就创建新的（会越来越多）
- ❌ 逗号分隔多区域 Range
- ❌ 不设置颜色（默认灰色）
`;

// ── Skill 分段解析：reasoning / responding / rest ────────────
function splitSkillSections(body) {
  const reasoningRe = /^##\s*Reasoning\b.*$/im;
  const respondingRe = /^##\s*Responding\b.*$/im;

  let reasoning = "";
  let responding = "";
  let rest = body;

  const sections = body.split(/(?=^##\s)/m);
  const otherParts = [];

  for (const section of sections) {
    if (reasoningRe.test(section)) {
      reasoning = section.replace(reasoningRe, "").trim();
    } else if (respondingRe.test(section)) {
      responding = section.replace(respondingRe, "").trim();
    } else {
      otherParts.push(section);
    }
  }

  return {
    reasoning,
    responding,
    rest: otherParts.join("").trim(),
  };
}

// ── 智能采样：大表只发列名+样本行+统计摘要 ─────────────────
const CONTEXT_ROW_THRESHOLD = 30;
const CONTEXT_SAMPLE_HEAD = 5;
const CONTEXT_SAMPLE_TAIL = 3;

function smartSampleContext(contextStr) {
  const lines = contextStr.split("\n");
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const tableMatch = line.match(
      /\[(?:完整工作表数据|当前选区)\]\s*.*?(\d+)行\s*×\s*(\d+)列/,
    );

    if (tableMatch) {
      const totalRows = parseInt(tableMatch[1], 10);
      result.push(line);
      i++;

      if (totalRows <= CONTEXT_ROW_THRESHOLD) {
        while (i < lines.length && lines[i].includes("\t")) {
          result.push(lines[i]);
          i++;
        }
      } else {
        const dataLines = [];
        while (i < lines.length && lines[i].includes("\t")) {
          dataLines.push(lines[i]);
          i++;
        }

        if (dataLines.length > 0) {
          result.push(dataLines[0]);
        }

        const headEnd = Math.min(CONTEXT_SAMPLE_HEAD + 1, dataLines.length);
        for (let h = 1; h < headEnd; h++) {
          result.push(dataLines[h]);
        }

        if (dataLines.length > headEnd + CONTEXT_SAMPLE_TAIL) {
          result.push(
            `... (省略 ${dataLines.length - headEnd - CONTEXT_SAMPLE_TAIL} 行，共 ${totalRows} 行)`,
          );
        }

        const tailStart = Math.max(
          headEnd,
          dataLines.length - CONTEXT_SAMPLE_TAIL,
        );
        for (let t = tailStart; t < dataLines.length; t++) {
          result.push(dataLines[t]);
        }

        const numCols = [];
        if (dataLines.length > 1) {
          const colCount = dataLines[0].split("\t").length;
          for (let c = 0; c < colCount; c++)
            numCols.push({ sum: 0, count: 0, min: Infinity, max: -Infinity });
          for (let r = 1; r < dataLines.length; r++) {
            const cells = dataLines[r].split("\t");
            for (let c = 0; c < Math.min(cells.length, colCount); c++) {
              const v = parseFloat(cells[c]);
              if (!isNaN(v)) {
                numCols[c].sum += v;
                numCols[c].count++;
                if (v < numCols[c].min) numCols[c].min = v;
                if (v > numCols[c].max) numCols[c].max = v;
              }
            }
          }
          const headers = dataLines[0].split("\t");
          const stats = [];
          for (let c = 0; c < headers.length; c++) {
            if (numCols[c] && numCols[c].count > 0) {
              const nc = numCols[c];
              stats.push(
                `${headers[c]}: min=${nc.min}, max=${nc.max}, avg=${(nc.sum / nc.count).toFixed(1)}`,
              );
            }
          }
          if (stats.length > 0) {
            result.push(`[数值列统计] ${stats.join(" | ")}`);
          }
        }
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

// ── System Prompt 预缓存 ────────────────────────────────────
// 静态部分在服务启动时构建一次，请求时只追加动态部分 (skills / context / history)
const _STATIC_CORE_PROMPT = `你是 Claude，嵌入在 WPS Office Excel 中的 AI 数据处理助手。你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。

## 响应原则
- **简单对话**（问候、闲聊、简单问题）：直接简短回答，不需要代码，不需要长篇推理。
- **Excel 操作**：先简要说明，再输出代码。简单操作 1 步完成，复杂操作分步执行。
- **回答长度与问题复杂度成正比**：一句话能答的不写一段，一个代码块能解决的不拆多步。

## 上下文优先级
每次请求都会附带「当前 Excel 上下文」。你必须只关注当前活动工作表，忽略对话历史中的旧表名。

## 代码生成要求
- 完整可独立执行的代码块，最后一行返回值字符串
- 超过 20 行数据用循环生成，禁止超 200 行
- 数值安全：写入前检查 NaN/undefined
- 公式安全：禁止在 .Formula 中拼接 JS 变量值

## 分步执行
工作在 Action → Observation 循环中：每次最多 1 个代码块，执行后等结果。任务完成直接总结，不画蛇添足。
- 简单任务（筛选/排序/格式化）：1 步
- 中等任务（图表/多列计算）：2-3 步
- 复杂任务（DCF/多表联动）：4-7 步

## Sheet 引用
- 单表操作用 Application.ActiveSheet
- 新建工作表：\`var ws = wb.Sheets.Add(null, wb.Sheets.Item(wb.Sheets.Count)); ws.Name = "表名"; ws.Activate();\`
- 跨步骤表名必须一致，每步开始先列出所有表名确认

## 字体颜色
设置 Interior.Color 时必须同时设置 Font.Color（深色背景→白字，浅色背景→黑字）

## ⚠️ 空值安全（每次写表格必须遵守）
每个 javascript 代码块**开头必须**写以下空值检查，否则会出现 "Cannot set properties of null" 崩溃：
\`\`\`
var wb = Application.ActiveWorkbook;
if (!wb) { return "错误：请先打开工作簿"; }
var ws = Application.ActiveSheet || wb.Sheets.Item(1);
if (!ws) { return "错误：无法获取工作表"; }
\`\`\`

`;

const _STATIC_CAPABILITY_PROMPT = `## 万物皆可代码 — 执行能力

### Excel 快捷 JSON 指令
格式：\`\`\`json {"_action": "<操作名>", "_args": {<参数>}} \`\`\`
操作: fillColor / setFontColor / clearRange / insertFormula / batchFormula / sortRange / autoFilter / freezePane / createSheet / setValue / setColumnWidth / mergeCells
注意: JSON 指令**仅限 Excel 操作**，所有本地/系统操作必须用 bash 代码。

### 多语言代码执行
| 标记 | 用途 | 环境 |
|------|------|------|
| javascript | Excel 操作 | WPS Plugin Host |
| python | 数据分析/爬虫 | 本地 Python3 |
| bash/terminal | 系统操作/Shell | 本地 macOS Shell |
| html | 交互图表/仪表盘 | 浏览器预览 |

### 本地系统操作（必须用 bash 代码块）
所有本地/系统操作**必须**用 \`\`\`bash 代码块，不要用 JSON。示例：
- 剪贴板读取: \`pbpaste\`　写入: \`echo "内容" | pbcopy\`
- 打开浏览器: \`open "https://url"\` 或 \`open -a "Google Chrome" "https://url"\`
- 打开文件/目录: \`open /path/to/file\`
- 启动应用: \`open -a "应用名"\`　退出: \`osascript -e 'tell app "应用名" to quit'\`
- 运行中的应用: \`ps aux | grep -i app\` 或 \`osascript -e 'tell app "System Events" to name of every process whose background only is false'\`
- 系统信息: \`uname -a && hostname && whoami && uptime\`
- 日历/提醒/邮件/通讯录: 用 osascript (AppleScript)

### 数据流：Python/Bash → Excel
当用 python/bash 抓取或分析数据后，系统会自动将结果回传。收到执行结果后，请：
1. 解析结果数据
2. 生成 javascript 代码（WPS ET API）将数据写入 Excel 表格
3. 包含表头、格式化（列宽、对齐、自动筛选等）

### html 图表说明
html 代码块会在浏览器中预览（不会插入 Excel），适合交互式可视化。
如需在 Excel 内创建图表，请使用 javascript + WPS Chart API（AddChart2）。
**重要：创建图表时，在新 Sheet 上操作，不要修改用户原始数据所在的 Sheet。**

选择原则：万物皆可代码。Excel 操作用 JSON 或 javascript，系统/本地操作**一律用 bash**。

`;

/**
 * 估算当前请求的复杂度（用于 prompt 分级 / thinking 预算 / 超时）
 * 核心判断维度是**当前用户消息**的长度与复杂度，
 * 对话历史只做辅助权重（长对话不代表当前问题复杂）。
 * 返回 "light" | "standard" | "heavy"
 */
function estimatePromptTier(userMessage, messages) {
  const msg = (userMessage || "").trim();
  const msgLow = msg.toLowerCase();
  const msgLen = msg.length;

  const HEAVY_KEYWORDS =
    /dcf|估值模型|建模|财务模型|完整.*模型|多.*sheet|多.*表|分析.*报告|敏感性分析|情景分析|scenario/i;
  if (HEAVY_KEYWORDS.test(msg) || msgLen > 300) {
    _logTier(msg, "heavy", "HEAVY_KW");
    return "heavy";
  }

  const GREETING =
    /^(你好|hi|hello|hey|嗨|谢谢|thanks?|thank you|ok|好的|收到|明白|了解|知道了|嗯|对|是的|没错|不是|test|测试|你是谁|what are you|who are you)[\s!！。.？?]*$/i;
  if (GREETING.test(msg)) {
    _logTier(msg, "light", "GREETING");
    return "light";
  }

  const PURE_QUESTION =
    /^(什么是|是什么|怎么用|如何使用|请问|解释一下|explain|what is|how to|为什么)/i;
  if (msgLen < 50 && PURE_QUESTION.test(msg)) {
    _logTier(msg, "light", "PURE_Q");
    return "light";
  }

  _logTier(msg, "standard", "DEFAULT");
  return "standard";
}
// #region agent log
const _fs34f850 = require("fs");
const _logPath34f850 = "/Users/kingsoft/需求讨论/.cursor/debug-34f850.log";
function _logTier(msg, tier, reason) {
  try {
    _fs34f850.appendFileSync(
      _logPath34f850,
      JSON.stringify({
        sessionId: "34f850",
        location: "proxy-server.js:estimatePromptTier",
        message: "tier-classification",
        data: {
          userMsg: msg.substring(0, 80),
          tier,
          reason,
          msgLen: msg.length,
        },
        timestamp: Date.now(),
        hypothesisId: "H-TIER",
      }) + "\n",
    );
  } catch (e) {}
}
// #endregion

function buildSystemPrompt(skills, todayStr, userMessage, modeSkill, messages) {
  const tier = estimatePromptTier(userMessage, messages || []);

  let prompt = _STATIC_CORE_PROMPT.replace(
    "你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。",
    `你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。\n今天的日期是 ${todayStr}。当用户询问"最近/近期"数据时，以今天为基准。`,
  );

  // light tier (简单对话): 只加载核心 prompt + 能力概览，跳过 skills
  // standard tier: 加载能力详情 + mode skill + matched skills
  // heavy tier: 全量加载
  prompt += _STATIC_CAPABILITY_PROMPT;

  if (tier !== "light" && modeSkill && modeSkill.body) {
    prompt += modeSkill.body + "\n\n";
  }

  if (tier !== "light") {
    let respondingSections = "";
    for (const skill of skills) {
      const { reasoning, responding, rest } = splitSkillSections(
        skill.body || "",
      );
      if (reasoning) {
        prompt += `<internal_reasoning skill="${skill.name}">\n${reasoning}\n</internal_reasoning>\n\n`;
      }
      if (rest) {
        prompt += rest + "\n\n";
      }
      if (responding) {
        respondingSections += `<output_format skill="${skill.name}">\n${responding}\n</output_format>\n\n`;
      }
    }
    if (respondingSections) {
      prompt += "## 输出格式要求\n\n" + respondingSections;
    }
  }

  const chartKw =
    /图表|折线|柱状|饼图|chart|趋势图|走势图|可视化|visualization|图形|数据图/i;
  if (userMessage && chartKw.test(userMessage)) {
    prompt += CHART_STYLE_OVERRIDE + "\n\n";
  }

  console.log(
    `[prompt] tier=${tier}, skills=${skills.length}, chars=${prompt.length}`,
  );
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "eab716",
    },
    body: JSON.stringify({
      sessionId: "eab716",
      location: "proxy-server.js:buildSystemPrompt",
      message: "Skills loaded for prompt",
      data: {
        tier,
        skillCount: skills.length,
        skillNames: skills.map((s) => s.name),
        promptChars: prompt.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return prompt;
}

// v2.2.0: Three-tier skill loading (system → bundled → connector)
const ALL_SYSTEM_SKILLS = loadSkillsFromDir("system");
const ALL_SKILLS = loadSkills();
const ALL_MODES = loadSkillsFromDir("modes");
const ALL_CONNECTORS = loadSkillsFromDir("connectors");
const ALL_WORKFLOWS = loadSkillsFromDir("workflows");

// v2.3.0: User/Project skill loading (user > project > system)
const USER_SKILLS_DIR = join(homedir(), ".claude-wps", "user-skills");

function ensureUserSkillsDir() {
  if (!existsSync(USER_SKILLS_DIR)) {
    mkdirSync(USER_SKILLS_DIR, { recursive: true });
  }
}
ensureUserSkillsDir();

function loadSkillsFromPath(dir) {
  const skills = new Map();
  if (!existsSync(dir)) return skills;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const raw = readFileSync(skillFile, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    skills.set(entry.name, {
      ...frontmatter,
      body,
      name: frontmatter.name || entry.name,
      _source: dir,
    });
  }
  return skills;
}

function getProjectSkillsDir() {
  const ctx = _wpsContext || {};
  if (!ctx.workbookName) return null;
  const workbookDir = ctx._workbookDir;
  return workbookDir ? join(workbookDir, ".wps-ai", "skills") : null;
}

let ALL_USER_SKILLS = loadSkillsFromPath(USER_SKILLS_DIR);

function reloadUserSkills() {
  ALL_USER_SKILLS = loadSkillsFromPath(USER_SKILLS_DIR);
}

function mergeSkillPools() {
  const merged = new Map();
  for (const [k, v] of ALL_SYSTEM_SKILLS)
    merged.set(k, { ...v, _layer: "system" });
  for (const [k, v] of ALL_SKILLS) merged.set(k, { ...v, _layer: "bundled" });
  for (const [k, v] of ALL_CONNECTORS)
    merged.set(k, { ...v, _layer: "connector" });

  const projDir = getProjectSkillsDir();
  if (projDir) {
    const projSkills = loadSkillsFromPath(projDir);
    for (const [k, v] of projSkills) merged.set(k, { ...v, _layer: "project" });
  }

  for (const [k, v] of ALL_USER_SKILLS) merged.set(k, { ...v, _layer: "user" });
  return merged;
}

function detectSkillConflicts() {
  const conflicts = [];
  const layers = ["system", "bundled", "connector"];
  for (const [name] of ALL_USER_SKILLS) {
    for (const layer of layers) {
      const pool =
        layer === "system"
          ? ALL_SYSTEM_SKILLS
          : layer === "bundled"
            ? ALL_SKILLS
            : ALL_CONNECTORS;
      if (pool.has(name)) {
        conflicts.push({ name, userOverrides: layer });
      }
    }
  }
  return conflicts;
}

console.log(
  `[skill-loader] system: ${ALL_SYSTEM_SKILLS.size} (${[...ALL_SYSTEM_SKILLS.keys()].join(", ")})`,
);
console.log(
  `[skill-loader] bundled: ${ALL_SKILLS.size} (${[...ALL_SKILLS.keys()].join(", ")})`,
);
console.log(
  `[skill-loader] modes: ${ALL_MODES.size} (${[...ALL_MODES.keys()].join(", ")})`,
);
console.log(
  `[skill-loader] connectors: ${ALL_CONNECTORS.size}, workflows: ${ALL_WORKFLOWS.size}`,
);
console.log(
  `[skill-loader] user-skills: ${ALL_USER_SKILLS.size}${ALL_USER_SKILLS.size > 0 ? ` (${[...ALL_USER_SKILLS.keys()].join(", ")})` : ""}`,
);
const conflicts = detectSkillConflicts();
if (conflicts.length > 0) {
  console.log(
    `[skill-loader] conflicts: ${conflicts.map((c) => `${c.name}(overrides ${c.userOverrides})`).join(", ")}`,
  );
}

// v2.3.0: Startup version compatibility check
const SYSTEM_VERSION = "2.3.0";

function parseVersion(v) {
  const parts = String(v || "0.0.0")
    .split(".")
    .map(Number);
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function isVersionCompatible(required, current) {
  const req = parseVersion(required);
  const cur = parseVersion(current);
  if (cur.major !== req.major) return cur.major > req.major;
  if (cur.minor !== req.minor) return cur.minor > req.minor;
  return cur.patch >= req.patch;
}

function checkUserSkillCompatibility() {
  const warnings = [];
  for (const [name, skill] of ALL_USER_SKILLS) {
    const minVer = skill.minSystemVersion;
    if (minVer && !isVersionCompatible(minVer, SYSTEM_VERSION)) {
      warnings.push({
        name,
        minSystemVersion: minVer,
        currentVersion: SYSTEM_VERSION,
      });
    }
  }
  if (warnings.length > 0) {
    console.warn(
      `[skill-loader] ${warnings.length} user skill(s) require newer system version:`,
    );
    for (const w of warnings) {
      console.warn(
        `  - ${w.name}: requires >=${w.minSystemVersion}, current=${w.currentVersion}`,
      );
    }
  }
  return warnings;
}

const versionWarnings = checkUserSkillCompatibility();

// ── Command Loader ────────────────────────────────────────────
function loadCommands() {
  const cmdsDir = join(__dirname, "commands");
  const commands = [];

  if (!existsSync(cmdsDir)) return commands;

  for (const file of readdirSync(cmdsDir)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(join(cmdsDir, file), "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    commands.push({
      id: file.replace(/\.md$/, ""),
      icon: frontmatter.icon || "📌",
      label: frontmatter.label || file.replace(/\.md$/, ""),
      description: frontmatter.description || "",
      scope: frontmatter.scope || "general",
      prompt: body.trim(),
    });
  }

  return commands;
}

const ALL_COMMANDS = loadCommands();
console.log(`[command-loader] 已加载 ${ALL_COMMANDS.length} 个 commands`);

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

const ALLOWED_ORIGINS = [
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  "http://127.0.0.1:3001",
  "http://localhost:3001",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  }),
);
// 普通 JSON 请求限制 10mb（含附件文本内容）；图片走 /upload-temp 单独上传
app.use(express.json({ limit: "10mb" }));

const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(
    express.static(distPath, {
      etag: false,
      lastModified: false,
      index: false,
      fallthrough: true,
      setHeaders: (res) => {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, max-age=0",
        );
        res.setHeader("Pragma", "no-cache");
      },
    }),
  );
}

const wpsAddonPath = join(__dirname, "wps-addon");
if (existsSync(wpsAddonPath)) {
  app.use(
    "/wps-addon",
    express.static(wpsAddonPath, {
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, max-age=0",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      },
    }),
  );
}

// ── 系统剪贴板读取（macOS）─────────────────────────────────────
app.get("/clipboard", (req, res) => {
  try {
    let hasImage = false;
    try {
      const types = execSync(
        `osascript -e 'clipboard info' 2>/dev/null | head -5`,
        { encoding: "utf-8", timeout: 2000 },
      );
      hasImage = /TIFF|PNG|JPEG|picture/i.test(types);
    } catch {}

    if (hasImage) {
      try {
        const imgName = `clipboard-${Date.now()}.png`;
        const imgPath = join(TEMP_DIR, imgName);
        execSync(
          `osascript -e 'set pngData to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${imgPath}" with write permission' -e 'write pngData to fp' -e 'close access fp'`,
          { timeout: 5000 },
        );
        return res.json({
          ok: true,
          type: "image",
          filePath: imgPath,
          fileName: imgName,
        });
      } catch {}
    }

    const text = execSync("pbpaste", {
      encoding: "utf-8",
      timeout: 2000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });
    res.json({ ok: true, type: "text", text });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PDF 文本提取 ──────────────────────────────────────────────
app.post("/extract-pdf", async (req, res) => {
  try {
    const { base64, filePath } = req.body;
    let buffer;

    if (filePath) {
      if (!isPathSafe(filePath, TEMP_DIR)) {
        return res.status(400).json({ ok: false, error: "filePath 不合法" });
      }
      buffer = readFileSync(filePath);
    } else if (base64) {
      buffer = Buffer.from(base64, "base64");
    } else {
      return res
        .status(400)
        .json({ ok: false, error: "需要 base64 或 filePath" });
    }

    const uint8 = new Uint8Array(buffer);
    const parser = new pdfParse.PDFParse(uint8);
    // load() must be called before getText()
    await parser.load();
    const data = await parser.getText();
    const text = (typeof data === "string" ? data : data?.text) || "";
    const pages =
      data?.total || data?.pages?.length || parser.getInfo?.()?.numPages || 0;

    const MAX_CHARS = 100000;
    const truncated = text.length > MAX_CHARS;
    const content = truncated ? text.slice(0, MAX_CHARS) : text;

    res.json({
      ok: true,
      text: content,
      pages,
      totalChars: text.length,
      truncated,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 图片临时文件上传 ─────────────────────────────────────────
const TEMP_DIR = join(tmpdir(), "wps-claude-uploads");
try {
  mkdirSync(TEMP_DIR, { recursive: true });
} catch {}

let _tempFileCounter = 0;

// 定期清理超过 1 小时的临时文件，防止磁盘积累
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;
setInterval(
  () => {
    try {
      const now = Date.now();
      const files = readdirSync(TEMP_DIR);
      for (const file of files) {
        const filePath = join(TEMP_DIR, file);
        try {
          const { mtimeMs } = require("fs").statSync(filePath);
          if (now - mtimeMs > TEMP_FILE_MAX_AGE_MS) {
            unlinkSync(filePath);
          }
        } catch {}
      }
    } catch {}
  },
  10 * 60 * 1000,
);

app.post("/upload-temp", (req, res) => {
  try {
    const { base64, fileName } = req.body;
    if (!base64 || !fileName) {
      return res
        .status(400)
        .json({ ok: false, error: "需要 base64 和 fileName" });
    }
    const ext = fileName.includes(".")
      ? fileName.slice(fileName.lastIndexOf("."))
      : ".bin";
    const safeName = `upload-${++_tempFileCounter}-${Date.now()}${ext}`;
    const filePath = join(TEMP_DIR, safeName);
    writeFileSync(filePath, Buffer.from(base64, "base64"));
    res.json({ ok: true, filePath, fileName: safeName });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Commands API ──────────────────────────────────────────────
app.get("/commands", (req, res) => {
  const scope = req.query.scope;
  const filtered = scope
    ? ALL_COMMANDS.filter((c) => c.scope === scope)
    : ALL_COMMANDS;
  res.json(filtered);
});

// ── 金融数据缓存（TTL 1 小时）──────────────────────────────
const _financeCache = new Map();
const FINANCE_CACHE_TTL = 60 * 60 * 1000;

function getCached(key) {
  const entry = _financeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > FINANCE_CACHE_TTL) {
    _financeCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  _financeCache.set(key, { data, ts: Date.now() });
  if (_financeCache.size > 200) {
    const oldest = _financeCache.keys().next().value;
    _financeCache.delete(oldest);
  }
}

// ── 金融数据 API（via yfinance Python bridge）────────────────
function runYfinance(script) {
  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["-c", script], { timeout: 30000 });
    let stdout = "",
      stderr = "";
    py.stdout.on("data", (d) => {
      stdout += d;
    });
    py.stderr.on("data", (d) => {
      stderr += d;
    });
    py.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(stderr.trim().substring(0, 300) || `exit ${code}`),
        );
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("JSON parse: " + stdout.substring(0, 200)));
      }
    });
  });
}

app.get("/finance-data/:ticker", async (req, res) => {
  const ticker = req.params.ticker.replace(/[^a-zA-Z0-9._-]/g, "");
  const cacheKey = `info:${ticker}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ ...cached, _cached: true });
  }
  try {
    const data = await runYfinance(`
import yfinance as yf, json, sys, math
t = yf.Ticker("${ticker}")
info = t.info or {}
if not info.get("shortName"):
    print(json.dumps({"error":"ticker not found","ticker":"${ticker}"}))
    sys.exit(0)
def s(v):
    if v is None: return None
    try:
        if math.isnan(float(v)): return None
    except: pass
    return v
_sm = {k:s(info.get(k)) for k in ["shortName","currency","currentPrice","targetMeanPrice","targetHighPrice","targetLowPrice","recommendationKey","totalRevenue","revenueGrowth","grossMargins","ebitdaMargins","operatingMargins","profitMargins","totalCash","totalDebt","debtToEquity","returnOnEquity","returnOnAssets","freeCashflow","operatingCashflow","earningsGrowth"]}
_sm["grossProfit"] = s(info.get("grossProfits")) or s(info.get("grossProfit"))
_sm["netIncome"] = s(info.get("netIncomeToCommon")) or s(info.get("netIncome"))
_sm["operatingIncome"] = s(info.get("operatingIncome"))
out = {"ticker":"${ticker}","fetchedAt":__import__("datetime").datetime.now().isoformat(),
  "summary":_sm,
  "keyStats":{k:s(info.get(k)) for k in ["beta","trailingPE","forwardPE","priceToBook","enterpriseValue","enterpriseToRevenue","enterpriseToEbitda","pegRatio","sharesOutstanding","bookValue","dividendYield","marketCap"]}}
def to_camel(name):
    parts = name.replace(" ","_").lower().split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])
def extract_df(df, fields):
    if df is None or df.empty: return []
    rows = []
    for col in df.columns[:4]:
        r = {"endDate": col.strftime("%Y-%m-%d") if hasattr(col,"strftime") else str(col)}
        for f in fields:
            if f in df.index:
                v = df.loc[f, col]
                r[to_camel(f)] = None if (v is None or (isinstance(v,float) and math.isnan(v))) else float(v)
        rows.append(r)
    return rows
try: out["incomeStatements"] = extract_df(t.income_stmt, ["Total Revenue","Cost Of Revenue","Gross Profit","Operating Income","Net Income","EBIT","EBITDA"])
except: out["incomeStatements"] = []
try: out["balanceSheets"] = extract_df(t.balance_sheet, ["Total Assets","Total Liabilities Net Minority Interest","Stockholders Equity","Cash And Cash Equivalents","Long Term Debt"])
except: out["balanceSheets"] = []
try: out["cashFlows"] = extract_df(t.cashflow, ["Operating Cash Flow","Capital Expenditure","Free Cash Flow","Depreciation And Amortization"])
except: out["cashFlows"] = []
print(json.dumps(out))
`);
    if (data.error) return res.status(404).json(data);
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error(`[finance-data] ${ticker} error:`, err.message);
    res.status(500).json({ error: err.message, ticker });
  }
});

app.get("/finance-data/:ticker/price", async (req, res) => {
  const ticker = req.params.ticker.replace(/[^a-zA-Z0-9._-]/g, "");
  const range = (req.query.range || "1y").replace(/[^a-z0-9]/gi, "");
  const interval = (req.query.interval || "1d").replace(/[^a-z0-9]/gi, "");
  const priceCacheKey = `price:${ticker}:${range}:${interval}`;
  const cachedPrice = getCached(priceCacheKey);
  if (cachedPrice) {
    return res.json({ ...cachedPrice, _cached: true });
  }
  try {
    const data = await runYfinance(`
import yfinance as yf, json
t = yf.Ticker("${ticker}")
h = t.history(period="${range}", interval="${interval}")
if h.empty:
    print(json.dumps({"error":"no price data","ticker":"${ticker}"}))
else:
    ps = [{"date":i.strftime("%Y-%m-%d"),"open":round(r["Open"],2),"high":round(r["High"],2),"low":round(r["Low"],2),"close":round(r["Close"],2),"volume":int(r["Volume"])} for i,r in h.iterrows()]
    print(json.dumps({"ticker":"${ticker}","count":len(ps),"prices":ps}))
`);
    if (data.error) return res.status(404).json(data);
    setCache(priceCacheKey, data);
    res.json(data);
  } catch (err) {
    console.error(`[finance-data] ${ticker}/price error:`, err.message);
    res.status(500).json({ error: err.message, ticker });
  }
});

// ── Data Bridge API（可插拔连接器统一入口）──────────────────────

app.post("/data-bridge/pull", async (req, res) => {
  const { connectorId, action, params } = req.body || {};
  if (!connectorId || !action) {
    return res.status(400).json({
      ok: false,
      error: "缺少 connectorId 或 action",
      code: "BAD_REQUEST",
    });
  }
  const result = await connectorRegistry.pull(connectorId, action, params || {});
  const status = result.ok ? 200 : (result.code === "CONNECTOR_NOT_FOUND" ? 404 : 400);
  res.status(status).json(result);
});

app.get("/data-bridge/connectors", (_req, res) => {
  res.json(connectorRegistry.list());
});

app.post("/data-bridge/connectors/:id/credentials", (req, res) => {
  const { id } = req.params;
  const creds = req.body;
  if (!creds || typeof creds !== "object") {
    return res.status(400).json({ error: "请求体需为 JSON 对象" });
  }
  if (!connectorRegistry.has(id)) {
    return res.status(404).json({ error: `连接器 "${id}" 未找到` });
  }
  connectorRegistry.setCredentials(id, creds);
  const status = connectorRegistry.getCredentialStatus(id);
  res.json({ ok: true, message: `连接器 "${id}" 凭证已更新（加密存储）`, status });
});

app.delete("/data-bridge/connectors/:id/credentials", (req, res) => {
  const { id } = req.params;
  if (!connectorRegistry.has(id)) {
    return res.status(404).json({ error: `连接器 "${id}" 未找到` });
  }
  connectorRegistry.removeCredentials(id);
  res.json({ ok: true, message: `连接器 "${id}" 凭证已清除` });
});

app.get("/data-bridge/connectors/:id/credential-status", (req, res) => {
  const status = connectorRegistry.getCredentialStatus(req.params.id);
  if (!status) return res.status(404).json({ error: "连接器未找到" });
  res.json({ connectorId: req.params.id, credentials: status });
});

app.get("/data-bridge/connectors/:id/credential-schema", (req, res) => {
  const schema = connectorRegistry.getCredentialSchema(req.params.id);
  if (!schema) return res.status(404).json({ error: "连接器未找到" });
  res.json(schema);
});

app.post("/data-bridge/connectors/:id/toggle", (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body || {};
  if (!connectorRegistry.has(id)) {
    return res.status(404).json({ error: `连接器 "${id}" 未找到` });
  }
  connectorRegistry.setEnabled(id, enabled !== false);
  res.json({ ok: true, enabled: enabled !== false });
});

app.post("/data-bridge/reload", async (_req, res) => {
  await connectorRegistry.reload();
  res.json({ ok: true, count: connectorRegistry.size, connectors: connectorRegistry.list() });
});

app.post("/data-bridge/import-credentials", (req, res) => {
  const result = importCredentials(connectorRegistry);
  res.json({ ok: true, ...result });
});

app.post("/data-bridge/import-file", (req, res) => {
  const { filePath, connectorId } = req.body || {};
  if (!filePath) return res.status(400).json({ ok: false, error: "缺少 filePath" });
  const result = importSingleFile(filePath, connectorId, connectorRegistry);
  res.json(result);
});

app.post("/data-bridge/connectors/create", async (req, res) => {
  const result = await connectorRegistry.createUserConnector(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.delete("/data-bridge/connectors/:id", async (req, res) => {
  const result = await connectorRegistry.removeUserConnector(req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ── Skills 列表 API（调试用）─────────────────────────────────
app.get("/skills", (req, res) => {
  const list = [...ALL_SKILLS.entries()].map(([id, s]) => ({
    id,
    name: s.name,
    description: s.description,
    tags: s.tags,
    context: s.context,
  }));
  res.json(list);
});

// ── v3.1: Agent System API ───────────────────────────────────

app.get("/v3/agents", (_req, res) => {
  try {
    const summaries = listAgentSummaries();
    res.json({ ok: true, agents: summaries });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/v3/agents/:name", (req, res) => {
  const agent = getAgentByName(req.params.name);
  if (!agent)
    return res.status(404).json({ ok: false, error: "Agent not found" });
  res.json({
    ok: true,
    agent: {
      name: agent.name,
      description: (agent.description || "")
        .replace(/<example>.*?<\/example>/gs, "")
        .trim(),
      model: agent.model,
      color: agent.color,
      tools: agent.tools,
    },
  });
});

app.post("/v3/agents/match", (req, res) => {
  const { message } = req.body;
  if (!message)
    return res.status(400).json({ ok: false, error: "message required" });
  const matches = matchAgentByIntent(message);
  res.json({
    ok: true,
    matches: matches.map((m) => ({
      name: m.agent.name,
      score: m.score,
      color: m.agent.color,
    })),
    recommended: matches.length > 0 ? matches[0].agent.name : null,
  });
});

app.post("/v3/agents/reload", (_req, res) => {
  invalidateAgentCache();
  const agents = loadAllAgents();
  res.json({
    ok: true,
    count: agents.length,
    agents: agents.map((a) => a.name),
  });
});

// ── v3.2: Agent Team API ─────────────────────────────────────

app.post("/v3/team/start", (req, res) => {
  const { goal, context } = req.body || {};
  if (!goal) return res.status(400).json({ ok: false, error: "goal required" });

  try {
    const team = startTeam(goal, context);
    res.json({ ok: true, team });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/v3/team/status/:teamId", (req, res) => {
  const team = getTeamStatus(req.params.teamId);
  if (!team)
    return res.status(404).json({ ok: false, error: "Team not found" });
  res.json({ ok: true, team });
});

// ── v2.3.0: User Skills CRUD ─────────────────────────────────

app.get("/v2/user-skills", (_req, res) => {
  reloadUserSkills();
  const list = [...ALL_USER_SKILLS.entries()].map(([id, s]) => ({
    id,
    name: s.name,
    description: s.description || "",
    tags: s.tags || [],
    body: s.body || "",
  }));
  res.json({ skills: list, conflicts: detectSkillConflicts() });
});

app.get("/v2/user-skills/compatibility", (_req, res) => {
  reloadUserSkills();
  const warnings = checkUserSkillCompatibility();
  const skillConflicts = detectSkillConflicts();
  res.json({
    systemVersion: SYSTEM_VERSION,
    warnings,
    conflicts: skillConflicts,
    userSkillCount: ALL_USER_SKILLS.size,
  });
});

app.get("/v2/user-skills/:name", (req, res) => {
  const name = req.params.name;
  if (!SESSION_ID_RE.test(name))
    return res.status(400).json({ error: "Invalid name" });
  const skillDir = join(USER_SKILLS_DIR, name);
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile))
    return res.status(404).json({ error: "Skill not found" });
  const raw = readFileSync(skillFile, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  res.json({ name, frontmatter, body, raw });
});

app.post("/v2/user-skills/create", (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name || !content)
      return res.status(400).json({ error: "name and content required" });
    if (!SESSION_ID_RE.test(name))
      return res.status(400).json({ error: "Invalid skill name" });

    const skillDir = join(USER_SKILLS_DIR, name);
    if (existsSync(skillDir))
      return res.status(409).json({ error: "Skill already exists" });

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
    reloadUserSkills();
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/v2/user-skills/:name", (req, res) => {
  try {
    const name = req.params.name;
    if (!SESSION_ID_RE.test(name))
      return res.status(400).json({ error: "Invalid name" });
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });

    const skillDir = join(USER_SKILLS_DIR, name);
    if (!existsSync(skillDir))
      return res.status(404).json({ error: "Skill not found" });

    writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
    reloadUserSkills();
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/v2/user-skills/:name", (req, res) => {
  try {
    const name = req.params.name;
    if (!SESSION_ID_RE.test(name))
      return res.status(400).json({ error: "Invalid name" });

    const skillDir = join(USER_SKILLS_DIR, name);
    if (!existsSync(skillDir))
      return res.status(404).json({ error: "Skill not found" });

    rmSync(skillDir, { recursive: true, force: true });
    reloadUserSkills();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/user-skills/:name/diff", (req, res) => {
  try {
    const name = req.params.name;
    if (!SESSION_ID_RE.test(name))
      return res.status(400).json({ error: "Invalid name" });

    const userFile = join(USER_SKILLS_DIR, name, "SKILL.md");
    if (!existsSync(userFile))
      return res.status(404).json({ error: "User skill not found" });
    const userContent = readFileSync(userFile, "utf-8");

    let systemContent = null;
    const systemFile = join(__dirname, "skills", "bundled", name, "SKILL.md");
    if (existsSync(systemFile)) {
      systemContent = readFileSync(systemFile, "utf-8");
    } else {
      const sysFile = join(__dirname, "skills", "system", name, "SKILL.md");
      if (existsSync(sysFile)) systemContent = readFileSync(sysFile, "utf-8");
    }

    res.json({
      name,
      userContent,
      systemContent,
      hasSystemVersion: systemContent !== null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/skills/merged", (_req, res) => {
  const merged = mergeSkillPools();
  const list = [...merged.entries()].map(([id, s]) => ({
    id,
    name: s.name,
    description: s.description || "",
    layer: s._layer,
  }));
  res.json({ skills: list, total: list.length });
});

// ── v2.3.0: AI Skill Generation ─────────────────────────────

app.post("/v2/user-skills/generate-preview", (req, res) => {
  try {
    const { intent, context } = req.body;
    if (!intent) return res.status(400).json({ error: "intent required" });

    const prompt = buildSkillExtractionPrompt(intent, context || "");
    const meta = {
      name: intent
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      description: intent,
      tags: [],
      keywords: intent.split(/\s+/).filter((w) => w.length > 2),
      triggers: [intent],
      body: `## ${intent}\n\n(AI will generate full instructions here)\n`,
    };

    const content = generateSkillContent(meta);
    const validation = validateSkillMeta(meta);

    res.json({
      meta,
      content,
      validation,
      prompt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/v2/user-skills/from-ai-response", (req, res) => {
  try {
    const { aiResponse, intent } = req.body;
    if (!aiResponse)
      return res.status(400).json({ error: "aiResponse required" });

    const meta = parseSkillResponse(aiResponse);
    if (!meta) {
      return res
        .status(422)
        .json({ error: "Failed to parse AI response as skill metadata" });
    }

    const validation = validateSkillMeta(meta);
    if (!validation.valid) {
      return res.status(422).json({
        error: "Invalid skill metadata",
        errors: validation.errors,
        meta,
      });
    }

    const content = generateSkillContent(meta);
    res.json({ meta, content, validation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 健康检查
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "3.0.0",
    skills: ALL_SKILLS.size,
    modes: ALL_MODES.size,
    connectors: ALL_CONNECTORS.size,
    workflows: ALL_WORKFLOWS.size,
    commands: ALL_COMMANDS.length,
    skillNames: [...ALL_SKILLS.keys()],
    modeNames: [...ALL_MODES.keys()],
    financeCache: _financeCache.size,
    features: [
      "finance-cache-1h",
      "skill-weight-scoring",
      "smart-context-sampling",
      "action-registry",
      "reasoning-responding-split",
      "provenance-tracking",
      "plan-editable",
    ],
  });
});

app.get("/modes", (_req, res) => {
  const modes = [];
  for (const [id, skill] of ALL_MODES) {
    modes.push({
      id,
      name: skill.name,
      description: skill.description,
      default: skill.default === true || skill.default === "true",
      enforcement: skill.enforcement || {},
      quickActions: skill.quickActions || [],
    });
  }
  res.json(modes);
});

// ── 会话历史存储 ─────────────────────────────────────────────
const HISTORY_DIR = join(__dirname, ".chat-history");
const MEMORY_FILE = join(HISTORY_DIR, "memory.json");
try {
  mkdirSync(HISTORY_DIR, { recursive: true });
} catch {}

function loadMemory() {
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, "utf-8"));
  } catch {
    return {
      preferences: {},
      frequentActions: [],
      lastModel: "claude-sonnet-4-6",
    };
  }
}

function saveMemory(mem) {
  writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

app.get("/sessions", (req, res) => {
  try {
    if (!existsSync(HISTORY_DIR)) return res.json([]);
    const files = readdirSync(HISTORY_DIR)
      .filter((f) => f.endsWith(".json") && f !== "memory.json")
      .map((f) => {
        try {
          const data = JSON.parse(readFileSync(join(HISTORY_DIR, f), "utf-8"));
          return {
            id: data.id,
            title: data.title || "未命名会话",
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            messageCount: data.messages?.length || 0,
            preview:
              data.messages
                ?.find((m) => m.role === "user")
                ?.content?.slice(0, 60) || "",
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/sessions/:id", (req, res) => {
  try {
    if (!SESSION_ID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "无效的会话 ID" });
    }
    const filePath = join(HISTORY_DIR, `${req.params.id}.json`);
    if (!existsSync(filePath))
      return res.status(404).json({ error: "会话不存在" });
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/sessions", (req, res) => {
  try {
    const { id, title, messages, model } = req.body;
    if (!id) return res.status(400).json({ error: "id 不能为空" });
    if (!SESSION_ID_RE.test(id)) {
      return res.status(400).json({ error: "无效的会话 ID" });
    }
    const now = Date.now();
    const filePath = join(HISTORY_DIR, `${id}.json`);

    let session;
    if (existsSync(filePath)) {
      session = JSON.parse(readFileSync(filePath, "utf-8"));
      session.messages = messages || session.messages;
      session.title = title || session.title;
      session.model = model || session.model;
      session.updatedAt = now;
    } else {
      session = {
        id,
        title: title || "新会话",
        messages: messages || [],
        model,
        createdAt: now,
        updatedAt: now,
      };
    }

    writeFileSync(filePath, JSON.stringify(session, null, 2));

    const mem = loadMemory();
    if (model) mem.lastModel = model;
    saveMemory(mem);

    res.json({
      ok: true,
      session: {
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/sessions/:id", (req, res) => {
  try {
    if (!SESSION_ID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "无效的会话 ID" });
    }
    const filePath = join(HISTORY_DIR, `${req.params.id}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/memory", (req, res) => {
  res.json(loadMemory());
});

app.post("/memory", (req, res) => {
  try {
    const mem = loadMemory();
    Object.assign(mem, req.body);
    saveMemory(mem);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── v2.2.0: Onboarding + Profile + Memory API ──────────────

app.get("/v2/onboarding/status", (_req, res) => {
  res.json({
    onboarded: isOnboarded(),
    profile: loadUserProfile(),
  });
});

app.post("/v2/onboarding/complete", (req, res) => {
  try {
    const { name, industry, role, assistantName, mainTasks } = req.body;
    const profile = {
      name: name || "",
      industry: industry || "",
      role: role || "",
      assistantName: assistantName || APP_CONFIG.soul.name,
      mainTasks: mainTasks || [],
      onboarded: true,
      createdAt: Date.now(),
    };
    saveUserProfile(profile);
    invalidateSoulCache();
    if (name) appendFacts([{ fact: `用户名字是${name}`, category: "profile" }]);
    if (industry)
      appendFacts([{ fact: `用户在${industry}行业`, category: "profile" }]);
    if (role)
      appendFacts([{ fact: `用户的角色是${role}`, category: "profile" }]);
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/profile", (_req, res) => {
  res.json(loadUserProfile() || {});
});

app.post("/v2/profile", (req, res) => {
  try {
    const existing = loadUserProfile() || {};
    const updated = { ...existing, ...req.body, updatedAt: Date.now() };
    saveUserProfile(updated);
    invalidateSoulCache();
    res.json({ ok: true, profile: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/facts", (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(loadRecentFacts(limit));
});

app.post("/v2/facts", (req, res) => {
  try {
    const { facts } = req.body;
    if (Array.isArray(facts) && facts.length > 0) {
      appendFacts(facts);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/preferences", (_req, res) => {
  res.json(loadPreferences());
});

app.post("/v2/preferences", (req, res) => {
  try {
    savePreferences(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/config", (_req, res) => {
  res.json(loadConfig(true));
});

app.post("/v2/config", (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ ok: true, config: loadConfig(true) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/v2/session-summary", (req, res) => {
  try {
    const { sessionId, summary } = req.body;
    if (!sessionId || !summary) {
      return res.status(400).json({ error: "sessionId and summary required" });
    }
    saveSessionSummary(sessionId, summary);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/last-summary", (_req, res) => {
  res.json(loadLatestSummary() || {});
});

app.get("/v2/soul", (_req, res) => {
  const profile = loadUserProfile();
  const soul = loadSoul(profile);
  res.json({
    soul,
    profile,
    config: loadConfig().soul,
  });
});

app.post("/v2/soul/reset-cache", (_req, res) => {
  invalidateSoulCache();
  res.json({ ok: true });
});

// ── v2.3.0: Plan Mode — 步骤持久化 & 执行 ────────────────────

const _planSessions = new Map();

app.post("/v2/plan/save", (req, res) => {
  try {
    const { sessionId, steps, currentStep } = req.body;
    if (!sessionId)
      return res.status(400).json({ error: "sessionId required" });
    _planSessions.set(sessionId, {
      steps: steps || [],
      currentStep: currentStep ?? 0,
      status: "idle",
      updatedAt: Date.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/v2/plan/status/:sessionId", (req, res) => {
  const plan = _planSessions.get(req.params.sessionId);
  if (!plan) return res.status(404).json({ error: "No plan for this session" });
  res.json(plan);
});

app.post("/v2/plan/parse", (req, res) => {
  try {
    const { content, codeBlocks } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });
    let steps = parsePlanSteps(content);
    if (codeBlocks) {
      steps = associateCodeBlocks(steps, codeBlocks, content);
    }
    res.json({ steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/v2/plan/execute-step", async (req, res) => {
  try {
    const { sessionId, stepIndex, code, language } = req.body;
    if (!sessionId || stepIndex === undefined) {
      return res
        .status(400)
        .json({ error: "sessionId and stepIndex required" });
    }

    const plan = _planSessions.get(sessionId);
    if (!plan)
      return res.status(404).json({ error: "No plan for this session" });

    const step = plan.steps.find((s) => s.index === stepIndex);
    if (!step)
      return res.status(404).json({ error: `Step ${stepIndex} not found` });

    step.status = "running";
    plan.currentStep = stepIndex;
    plan.status = "running";

    if (code) {
      const codeId = `plan-step-${++_codeIdCounter}-${Date.now()}`;
      _codeQueue.push({
        id: codeId,
        code,
        language: language || "javascript",
        agentId: null,
        submittedAt: Date.now(),
      });
      _codeResults[codeId] = undefined;

      const maxWait = 30000;
      const start = Date.now();
      const poll = setInterval(() => {
        const result = _codeResults[codeId];
        if (result !== undefined) {
          clearInterval(poll);
          step.status = result.error ? "failed" : "success";
          step.result = result.result;
          step.error = result.error;
          step.done = !result.error;
          plan.status = "idle";
          delete _codeResults[codeId];
          res.json({ ok: true, step, result });
        } else if (Date.now() - start > maxWait) {
          clearInterval(poll);
          step.status = "failed";
          step.error = "Execution timeout";
          plan.status = "idle";
          res.json({ ok: false, step, error: "timeout" });
        }
      }, 200);
    } else {
      step.status = "success";
      step.done = true;
      plan.status = "idle";
      res.json({ ok: true, step });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/v2/plan/skip-step", (req, res) => {
  try {
    const { sessionId, stepIndex } = req.body;
    if (!sessionId || stepIndex === undefined) {
      return res
        .status(400)
        .json({ error: "sessionId and stepIndex required" });
    }
    const plan = _planSessions.get(sessionId);
    if (!plan)
      return res.status(404).json({ error: "No plan for this session" });

    const step = plan.steps.find((s) => s.index === stepIndex);
    if (!step)
      return res.status(404).json({ error: `Step ${stepIndex} not found` });

    step.status = "skipped";
    step.done = false;
    res.json({ ok: true, step });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WPS 上下文中转 ─────────────────────────────────────────
let _wpsContext = {
  workbookName: "",
  sheetNames: [],
  selection: null,
  usedRange: null,
  timestamp: 0,
};

app.post("/wps-context", (req, res) => {
  if (!req.body.workbookName && _wpsContext.workbookName) {
    res.json({ ok: true, skipped: true });
    return;
  }
  _wpsContext = { ...req.body, timestamp: Date.now() };
  res.json({ ok: true });
});

app.get("/wps-context", (req, res) => {
  res.json(_wpsContext);
});

// ── 代码执行桥 ─────────────────────────────────────────────
const CODE_QUEUE_MAX = 50;
let _codeQueue = [];
let _codeResults = {};
let _codeIdCounter = 0;
let _codeChunkMap = {};

app.post("/execute-code", async (req, res) => {
  const { code, agentId, force } = req.body;
  if (!code) return res.status(400).json({ error: "code 不能为空" });

  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f532b6",
    },
    body: JSON.stringify({
      sessionId: "f532b6",
      location: "proxy-server.js:execute-code",
      message: "Code execution request",
      data: {
        force: !!force,
        codeLen: code.length,
        codeSnippet: code.substring(0, 80),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  // v3.2: PreCodeExecute Hook — 危险操作拦截（force=true 时用户已确认，跳过）
  if (!force) {
    const preHook = runHooks("PreCodeExecute", {
      code,
      agentId: agentId || "",
    });
    if (preHook.blocked) {
      console.log(`[hook] PreCodeExecute BLOCKED: ${preHook.reason}`);
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "f532b6",
          },
          body: JSON.stringify({
            sessionId: "f532b6",
            location: "proxy-server.js:execute-code-blocked",
            message: "Code blocked by hook",
            data: { reason: preHook.reason },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
      return res.json({ blocked: true, reason: preHook.reason });
    }
    if (preHook.logs.length > 0) {
      console.log(`[hook] PreCodeExecute: ${preHook.logs.join("; ")}`);
    }
  }

  // v3.2: Agent tools 权限检查
  if (agentId && _sessionAgentMap.has(agentId)) {
    const sessionAgent = _sessionAgentMap.get(agentId);
    if (sessionAgent.tools.length > 0) {
      const isJsonAction = code.trim().startsWith("{");
      if (isJsonAction) {
        try {
          const parsed = JSON.parse(code);
          const actionName = parsed._action || "";
          const actionNs = actionName.split(".")[0];
          const allowed = sessionAgent.tools.some(
            (t) => actionName.startsWith(t) || t.startsWith(actionNs + "."),
          );
          if (!allowed) {
            console.log(
              `[agent-perm] BLOCKED: ${actionName} not in ${sessionAgent.name}'s tools [${sessionAgent.tools.join(",")}]`,
            );
            return res.json({
              ok: true,
              id: `perm-${Date.now()}`,
              localResult: {
                ok: false,
                error: `⚠️ ${sessionAgent.name} 没有执行 ${actionName} 的权限。请切换到合适的 Agent。`,
              },
            });
          }
        } catch {}
      }
    }
  }

  // Step 1: Try parsing as JSON — parse failure means normal code, fall through
  let _parsed = null;
  try {
    _parsed = JSON.parse(code);
  } catch (_) {
    /* not JSON, fall through */
  }

  // Step 2: If it's a valid local.* action, handle entirely here (never fall through)
  if (_parsed && _parsed._action && _parsed._action.startsWith("local.")) {
    const actionName = _parsed._action;
    const actionParams = Array.isArray(_parsed._args)
      ? _parsed._args[0] || {}
      : _parsed._args || {};

    try {
      const perms = await import("./lib/local-permissions.js");
      const guard = await perms.guardLocalAction(actionName);
      if (!guard.allowed) {
        return res.json({
          ok: true,
          id: `local-${Date.now()}`,
          localResult: {
            error: "permission_required",
            message: guard.userMessage,
          },
        });
      }

      const { executeAction } = await import("./lib/action-registry.js");
      const result = await executeAction(actionName, actionParams);
      return res.json({
        ok: true,
        id: `local-${Date.now()}`,
        localResult: result,
      });
    } catch (actionErr) {
      console.error("[local-action]", actionErr.message);
      return res.json({
        ok: true,
        id: `local-${Date.now()}`,
        localResult: { ok: false, error: actionErr.message },
      });
    }
  }

  // Step 3: If it's a JSON action (non-local), handle via action-registry
  if (_parsed && _parsed._action) {
    try {
      const { executeAction } = await import("./lib/action-registry.js");
      const result = await executeAction(_parsed._action, _parsed._args || {});
      return res.json({
        ok: true,
        id: `action-${Date.now()}`,
        localResult: result,
      });
    } catch (actionErr) {
      return res.json({
        ok: true,
        id: `action-${Date.now()}`,
        localResult: { ok: false, error: actionErr.message },
      });
    }
  }

  if (_codeQueue.length >= CODE_QUEUE_MAX) {
    return res.status(429).json({ error: "代码执行队列已满，请稍后重试" });
  }

  const parentId = `exec-${++_codeIdCounter}-${Date.now()}`;
  // #region agent log
  try {
    _fs34f850.appendFileSync(
      _logPath34f850,
      JSON.stringify({
        sessionId: "34f850",
        location: "proxy-server.js:execute-code-js",
        message: "JS code queued for WPS",
        data: {
          parentId,
          codeLen: code.length,
          codeFirst200: code.substring(0, 200),
          codeLast100: code.substring(Math.max(0, code.length - 100)),
        },
        timestamp: Date.now(),
        hypothesisId: "H-TRANSLATE",
      }) + "\n",
    );
  } catch (e) {}
  // #endregion

  let cleanCode = code.replace(/\/\/\s*---ROW---/g, "");

  // Sheets.Add() 安全网：替换无参数 Add() 为带参数形式
  cleanCode = cleanCode.replace(
    /wb\.Sheets\.Add\(\s*\)\s*;?\s*(var\s+\w+\s*=\s*)?wb\.ActiveSheet/g,
    (match) => {
      const varMatch = match.match(/var\s+(\w+)/);
      const varName = varMatch ? varMatch[1] : "ws";
      return `var ${varName} = wb.Sheets.Add(null, wb.Sheets.Item(wb.Sheets.Count))`;
    },
  );
  cleanCode = cleanCode.replace(
    /\.Sheets\.Add\(\s*\)/g,
    ".Sheets.Add(null, wb.Sheets.Item(wb.Sheets.Count))",
  );

  // Activate 安全网：防止对 null sheet 调用 Activate
  cleanCode = cleanCode.replace(
    /(\bvar\s+\w+\s*=\s*wb\.Sheets\.Item\([^)]+\))\s*;\s*(\w+)\.Activate\(\)/g,
    (match, assignment, varName) => {
      return `${assignment}; if(${varName})${varName}.Activate()`;
    },
  );

  // NaN 安全网：防止 JavaScript NaN 被嵌入 Excel 公式
  cleanCode = cleanCode.replace(
    /\.Formula\s*=\s*"([^"]*?)"/g,
    (match, formula) => {
      const sanitized = formula.replace(/\bNaN\b/g, "0");
      if (sanitized !== formula) {
        return `.Formula = "${sanitized}"`;
      }
      return match;
    },
  );
  // Columns/Rows 安全网：ws.Columns("D:D") → ws.Range("D:D")
  cleanCode = cleanCode.replace(
    /\.Columns\(\s*"([A-Z]+:[A-Z]+)"\s*\)/g,
    '.Range("$1")',
  );
  cleanCode = cleanCode.replace(
    /\.Columns\(\s*"([A-Z]+)"\s*\)/g,
    '.Range("$1:$1")',
  );
  cleanCode = cleanCode.replace(/\.Rows\(\s*"(\d+:\d+)"\s*\)/g, '.Range("$1")');
  cleanCode = cleanCode.replace(/\.Rows\(\s*(\d+)\s*\)/g, '.Range("$1:$1")');

  // WPS JSAPI 集合访问安全网：.SeriesCollection(n) → .SeriesCollection.Item(n)
  cleanCode = cleanCode.replace(
    /\.SeriesCollection\(\s*(\d+)\s*\)/g,
    ".SeriesCollection.Item($1)",
  );

  // WPS JSAPI Cells 安全网：ws.Cells(row, col) → ws.Cells.Item(row, col)
  cleanCode = cleanCode.replace(
    /\.Cells\(\s*([^)]+?)\s*,\s*([^)]+?)\s*\)/g,
    ".Cells.Item($1, $2)",
  );

  // WPS JSAPI ActiveSheet/ActiveWorkbook 安全网
  // lookbehind: 不匹配 Application.ActiveSheet / wb.ActiveSheet（已有对象前缀）
  cleanCode = cleanCode.replace(
    /(?<!\.)(?<!\w)ActiveSheet\b/g,
    "Application.ActiveSheet",
  );
  cleanCode = cleanCode.replace(
    /(?<!\.)(?<!\w)ActiveWorkbook\b/g,
    "Application.ActiveWorkbook",
  );

  // Cells.Clear → UsedRange.Clear 安全网
  cleanCode = cleanCode.replace(/\.Cells\.Clear\(\)/g, ".UsedRange.Clear()");

  // finance-data API 响应路径安全网：data.data.X → data.X（API 返回平坦 JSON）
  cleanCode = cleanCode.replace(
    /\b(data|resp|result|json)\.(data)\.(summary|keyStats|incomeStatements|balanceSheets|cashFlows|ticker|fetchedAt)\b/g,
    "$1.$3",
  );

  // 添加运行时 NaN 守卫函数，AI 代码中的数值赋值会被自动保护
  const nanGuard = `function _n(v){return(typeof v==="number"&&isNaN(v))?0:v===undefined?0:v===null?0:v;}\n`;
  if (/\.Value2?\s*=/.test(cleanCode) && !/function _n/.test(cleanCode)) {
    cleanCode = nanGuard + cleanCode;
  }

  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "eab716",
    },
    body: JSON.stringify({
      sessionId: "eab716",
      location: "proxy-server.js:queue-push",
      message: "Pushing JS code to queue",
      data: {
        parentId,
        codeLen: cleanCode.length,
        codeHead: cleanCode.substring(0, 120),
        queueLen: _codeQueue.length,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  _codeQueue.push({
    id: parentId,
    code: cleanCode,
    agentId: agentId || null,
    submittedAt: Date.now(),
  });
  res.json({ ok: true, id: parentId });
});

app.get("/pending-code", (req, res) => {
  if (_codeQueue.length === 0) {
    return res.json({ pending: false });
  }
  const item = _codeQueue.shift();
  res.json({ pending: true, ...item });
});

app.post("/code-result", (req, res) => {
  const { id, result, error, diff } = req.body;
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "eab716",
    },
    body: JSON.stringify({
      sessionId: "eab716",
      location: "proxy-server.js:code-result-received",
      message: "WPS sent code result",
      data: {
        id,
        hasResult: !!result,
        resultLen: result?.length,
        hasError: !!error,
        errorMsg: error?.substring?.(0, 200),
        hasDiff: !!diff,
        diffChanges: diff?.changeCount,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!id) return res.status(400).json({ error: "id 不能为空" });

  const chunkMatch = id.match(/^(.+)_chunk_\d+$/);
  if (chunkMatch) {
    const parentId = chunkMatch[1];
    const parent = _codeChunkMap[parentId];
    if (parent) {
      parent.completed++;
      if (error) parent.errors.push(error);
      if (diff) parent.diffs.push(diff);

      if (parent.completed >= parent.total) {
        const mergedDiff =
          parent.diffs.length > 0
            ? {
                changeCount: parent.diffs.reduce(
                  (s, d) => s + (d.changeCount || 0),
                  0,
                ),
                changes: parent.diffs.flatMap((d) => d.changes || []),
              }
            : null;
        _codeResults[parentId] = {
          result: parent.errors.length > 0 ? null : (result ?? "执行成功"),
          error: parent.errors.length > 0 ? parent.errors.join("; ") : null,
          diff: mergedDiff,
          completedAt: Date.now(),
        };
        setTimeout(() => {
          delete _codeResults[parentId];
          delete _codeChunkMap[parentId];
        }, 60000);
      }
    }
    return res.json({ ok: true });
  }

  _codeResults[id] = {
    result: result ?? null,
    error: error ?? null,
    diff: diff ?? null,
    completedAt: Date.now(),
  };

  setTimeout(() => {
    delete _codeResults[id];
  }, 60000);
  res.json({ ok: true });
});

app.get("/code-result/:id", (req, res) => {
  const entry = _codeResults[req.params.id];
  if (!entry) return res.json({ ready: false });
  res.json({ ready: true, ...entry });
});

// ── v2.2.0: Multi-language code execution ─────────────────

const PYTHON_CMD = process.env.PYTHON_PATH || "python3";
// "万物皆可代码" — 安全由 PreCodeExecute Hook 守护，不再用白名单限制能力
const SHELL_DENY_LIST = [
  "rm",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init",
];
const TEMP_DIR_BASE = join(tmpdir(), "claude-wps");
try {
  mkdirSync(TEMP_DIR_BASE, { recursive: true });
} catch {}

app.post("/execute-python", async (req, res) => {
  const { code, timeout = 30000 } = req.body;
  if (!code) return res.status(400).json({ error: "code is required" });

  const tmpFile = join(TEMP_DIR_BASE, `exec_${Date.now()}.py`);
  try {
    writeFileSync(tmpFile, code, "utf-8");
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(PYTHON_CMD, [tmpFile], {
        timeout,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(stderr || `exit code ${code}`));
        else resolve({ stdout, stderr });
      });
      child.on("error", reject);
    });
    res.json({ ok: true, result: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
});

app.post("/execute-shell", async (req, res) => {
  const { command, timeout = 15000 } = req.body;
  if (!command) return res.status(400).json({ error: "command is required" });

  const firstWord = command.trim().split(/\s+/)[0];
  if (SHELL_DENY_LIST.includes(firstWord)) {
    return res
      .status(403)
      .json({ error: `命令 "${firstWord}" 被安全策略拦截，需要确认后执行` });
  }

  try {
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      exec(
        command,
        { timeout, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        },
      );
    });
    res.json({ ok: true, result: stdout.trim(), stderr: stderr.trim() });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/preview-html", (req, res) => {
  const { html, title = "Preview" } = req.body;
  if (!html) return res.status(400).json({ error: "html is required" });

  const fileName = `preview_${Date.now()}.html`;
  const filePath = join(TEMP_DIR_BASE, fileName);
  writeFileSync(filePath, html, "utf-8");
  exec(`open "${filePath}"`);
  res.json({ ok: true, path: filePath, url: `file://${filePath}` });
});

// ── Add to Chat（右键菜单数据） ────────────────────────────
let _addToChatQueue = [];

app.post("/add-to-chat", (req, res) => {
  _addToChatQueue.push({ ...req.body, receivedAt: Date.now() });
  if (_addToChatQueue.length > 10) _addToChatQueue.shift();
  res.json({ ok: true });
});

app.get("/add-to-chat/poll", (_req, res) => {
  if (_addToChatQueue.length === 0) {
    return res.json({ pending: false });
  }
  const item = _addToChatQueue.shift();
  res.json({ pending: true, ...item });
});

// ── 单元格导航桥 ────────────────────────────────────────────
let _navigateQueue = [];

app.post("/navigate-to", (req, res) => {
  const { sheetName, cellAddress } = req.body;
  if (!sheetName && !cellAddress) {
    return res.status(400).json({ error: "需要 sheetName 或 cellAddress" });
  }
  _navigateQueue.push({
    sheetName: sheetName || "",
    cellAddress: cellAddress || "",
    timestamp: Date.now(),
  });
  res.json({ ok: true });
});

app.get("/pending-navigate", (_req, res) => {
  if (_navigateQueue.length === 0) {
    return res.json({ pending: false });
  }
  const item = _navigateQueue.shift();
  res.json({ pending: true, ...item });
});

// ── 模型白名单 ──────────────────────────────────────────────
const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku"]);

// ── Agent 语义命名：用 AI 从对话中提取简短名称 ──────
app.post("/generate-agent-name", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.json({ name: "" });
  }

  const userMessages = messages
    .filter((m) => m.role === "user")
    .slice(0, 3)
    .map((m) => m.content.slice(0, 200));

  if (userMessages.length === 0) return res.json({ name: "" });

  const combined = userMessages.join(" | ");
  const keywords = combined.replace(/[📎\[\]（）()]/g, "").trim();

  if (keywords.length <= 6) {
    return res.json({ name: keywords });
  }

  const NAMING_PATTERNS = [
    { re: /(?:清洗|清理|整理)[^\s,，。]*/i, prefix: "" },
    { re: /(?:排序|sort)[^\s,，。]*/i, prefix: "" },
    { re: /(?:图表|chart|可视化|柱状|折线|饼图)[^\s,，。]*/i, prefix: "" },
    { re: /(?:去重|duplicate|重复)[^\s,，。]*/i, prefix: "" },
    { re: /(?:筛选|过滤|filter)[^\s,，。]*/i, prefix: "" },
    { re: /(?:公式|formula|计算|汇总|求和|统计)[^\s,，。]*/i, prefix: "" },
    { re: /(?:格式|format|颜色|字体|样式)[^\s,，。]*/i, prefix: "" },
    { re: /(?:导入|导出|import|export)[^\s,，。]*/i, prefix: "" },
    { re: /(?:模板|template)[^\s,，。]*/i, prefix: "" },
    { re: /(?:分析|analysis|预测)[^\s,，。]*/i, prefix: "" },
  ];

  for (const { re } of NAMING_PATTERNS) {
    const match = combined.match(re);
    if (match) {
      const name = match[0].slice(0, 10);
      return res.json({ name });
    }
  }

  const shortName = keywords
    .replace(/请|帮我|帮忙|我想|我要|可以|能不能|一下|吗|啊|呢/g, "")
    .trim()
    .slice(0, 10);

  res.json({ name: shortName || "新任务" });
});

// ── 聊天速率限制（Multi-Agent 并行支持）──────
let _activeChats = 0;
const CHAT_CONCURRENCY_MAX = 6;

// v3.2: Session → Agent 映射 (用于 execute-code 权限检查)
const _sessionAgentMap = new Map();
let _lastChatTime = 0;
const CHAT_MIN_INTERVAL_MS = 300;

// ── v2.2.0: Post-conversation memory extraction ──────────────
async function _extractAndStoreMemory(userMsg, assistantResponse) {
  try {
    const combined = `用户: ${userMsg}\n助手: ${assistantResponse.substring(0, 2000)}`;

    const factPatterns = [
      {
        re: /(?:我(?:是|在|做|从事|负责|叫|的名字是))\s*(.{2,30})/g,
        category: "profile",
      },
      { re: /(?:我们公司|我们团队|我们部门)\s*(.{2,40})/g, category: "work" },
      {
        re: /(?:每次都|总是|一般|通常|习惯)\s*(.{2,40})/g,
        category: "preference",
      },
      { re: /(?:不要|别|不喜欢|不用)\s*(.{2,30})/g, category: "preference" },
      {
        re: /(?:用|使用|偏好)\s*(.*?(?:格式|模板|样式|公式|函数))/g,
        category: "preference",
      },
    ];

    const newFacts = [];
    for (const { re, category } of factPatterns) {
      let match;
      while ((match = re.exec(combined)) !== null) {
        const fact = match[0].trim();
        if (fact.length > 5 && fact.length < 100) {
          newFacts.push({ fact, category });
        }
      }
    }

    if (newFacts.length > 0) {
      appendFacts(newFacts);
      console.log(
        `[memory] Extracted ${newFacts.length} facts from conversation`,
      );
    }
  } catch (err) {
    console.error("[memory] Extraction error:", err.message);
  }
}

// ── 聊天接口（SSE 流式响应）──────────────────────────────────
app.post("/chat", async (req, res) => {
  const now = Date.now();
  if (_activeChats >= CHAT_CONCURRENCY_MAX) {
    return res.status(429).json({ error: "当前并发请求过多，请稍后重试" });
  }
  if (now - _lastChatTime < CHAT_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: "请求过于频繁，请稍后重试" });
  }
  _lastChatTime = now;
  _activeChats++;
  const { messages, context, model, attachments, webSearch, mode, agentName } =
    req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages 不能为空" });
  }

  // ── v3.1: Agent 系统 + 自动分派 ────────────────────────────────
  const lastUserContent = messages[messages.length - 1]?.content || "";
  const dispatch = dispatchAgent(lastUserContent, agentName);
  const resolvedAgent = dispatch.agent;
  if (dispatch.method === "auto-l1") {
    console.log(
      `[dispatcher] Auto-matched agent: ${resolvedAgent.name} (confidence=${dispatch.confidence.toFixed(2)})`,
    );
  }

  const currentMode = mode || "agent";
  const modeSkill = ALL_MODES.get(currentMode) || ALL_MODES.get("agent");

  // ── v2.4: 动态模型路由（v3.1: Agent 可覆盖模型选择）─────────
  const agentModelHint =
    resolvedAgent && resolvedAgent.model !== "inherit"
      ? resolvedAgent.model
      : undefined;
  const routeResult = selectModel({
    mode: currentMode,
    modelHint:
      agentModelHint || (ALLOWED_MODELS.has(model) ? model : undefined),
    messages,
    hasCode: /```|<code|function |def |class /.test(lastUserContent),
    defaultModel: APP_CONFIG.agent?.model?.split("-")[1] || "sonnet",
  });
  const selectedModel = routeResult.model;
  console.log(
    `[model-router] mode=${currentMode} → ${selectedModel} (${routeResult.reason})`,
  );
  const enforcement = modeSkill?.enforcement || {};
  const skipCodeBridge =
    enforcement.codeBridge === false || enforcement.codeBridge === "false";

  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const todayStr = new Date().toISOString().split("T")[0];

  // skill matching: only use recent messages to avoid stale keywords from old turns
  const allUserText = messages
    .filter((m) => m.role === "user")
    .slice(-4)
    .map((m) => m.content || "")
    .join(" ");

  // v2.3.0: Five-tier matching — system → bundled → connectors → project → user
  // User skills override same-name system/bundled skills via mergeSkillPools
  const mergedPool = mergeSkillPools();
  const matchedSystem = matchSkills(
    ALL_SYSTEM_SKILLS,
    allUserText,
    null,
    currentMode,
    10,
  );
  const matchedSkills = matchSkills(ALL_SKILLS, allUserText, null, currentMode);

  const matchedConnectors = matchSkills(
    ALL_CONNECTORS,
    allUserText,
    null,
    currentMode,
    CONNECTOR_MAX_LOAD,
  );
  const matchedUserSkills = matchSkills(
    ALL_USER_SKILLS,
    allUserText,
    null,
    currentMode,
    SKILL_MAX_LOAD,
  );
  const allMatched = [
    ...matchedSystem,
    ...matchedSkills,
    ...matchedConnectors,
    ...matchedUserSkills,
  ];

  // ── v2.2.0: SOUL + Memory + Time injection ──────────────────
  const userProfile = loadUserProfile();
  const soulPrompt = APP_CONFIG.memory.enabled ? loadSoul(userProfile) : "";

  let fullPrompt = "";
  if (soulPrompt) {
    fullPrompt += soulPrompt + "\n\n";
  }

  if (APP_CONFIG.memory.enabled) {
    const memoryCtx = buildMemoryContext();
    if (memoryCtx) fullPrompt += memoryCtx + "\n";
    const timeCtx = buildTimeContext();
    if (timeCtx) fullPrompt += timeCtx + "\n";
  }

  fullPrompt +=
    buildSystemPrompt(allMatched, todayStr, lastUserMsg, modeSkill, messages) +
    "\n";

  // v2.2.0: Record skill usage for preference learning
  if (APP_CONFIG.memory.enabled && allMatched.length > 0) {
    recordSkillUsage(allMatched.map((s) => s.name));
  }

  // Legacy memory compat: still load old preferences from memory.json
  const memory = loadMemory();
  if (memory.preferences && Object.keys(memory.preferences).length > 0) {
    fullPrompt += `[用户偏好记忆]\n`;
    for (const [k, v] of Object.entries(memory.preferences)) {
      fullPrompt += `- ${k}: ${v}\n`;
    }
    fullPrompt += "\n";
  }

  // ── v3.1: Agent 专属 System Prompt（放在通用规则之后，Agent 行为规则优先级更高）
  if (resolvedAgent) {
    const agentPrompt = renderAgentPrompt(resolvedAgent, userProfile);
    fullPrompt += `\n## 当前专业 Agent: ${resolvedAgent.name}\n\n`;
    fullPrompt += agentPrompt + "\n\n";
    if (resolvedAgent.tools.length > 0) {
      fullPrompt += `[权限限制] 本 Agent 仅允许使用以下工具: ${resolvedAgent.tools.join(", ")}。超出此范围的任务请告知用户切换到合适的 Agent。\n\n`;
    }
    console.log(
      `[agent] Using specialized agent: ${resolvedAgent.name} (model=${resolvedAgent.model}, tools=${resolvedAgent.tools.length})`,
    );
  }

  // v3.2: 记录 agentId → Agent 映射（用于 execute-code 权限检查）
  const reqAgentId = req.body.agentId || req.headers["x-agent-id"];
  if (reqAgentId && resolvedAgent) {
    _sessionAgentMap.set(reqAgentId, resolvedAgent);
  }

  if (context) {
    fullPrompt += `[当前 Excel 上下文]\n${smartSampleContext(context)}\n\n`;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    const textAtts = attachments.filter((a) => a.type !== "image");
    const imageAtts = attachments.filter((a) => a.type === "image");

    if (textAtts.length > 0) {
      fullPrompt += "[用户附件]\n";
      textAtts.forEach((att) => {
        fullPrompt += `--- ${att.name} ---\n${att.content}\n\n`;
      });
    }

    if (imageAtts.length > 0) {
      fullPrompt += `[用户上传了 ${imageAtts.length} 张图片]\n`;
      imageAtts.forEach((att) => {
        if (att.tempPath) {
          if (!isPathSafe(att.tempPath, TEMP_DIR)) {
            fullPrompt += `图片 ${att.name}: 路径无效，已跳过\n`;
            return;
          }
          try {
            const imgBuf = readFileSync(att.tempPath);
            const ext = att.name?.split(".").pop()?.toLowerCase() || "png";
            const mime =
              {
                jpg: "jpeg",
                jpeg: "jpeg",
                png: "png",
                gif: "gif",
                webp: "webp",
                bmp: "bmp",
                svg: "svg+xml",
              }[ext] || "png";
            const b64 = imgBuf.toString("base64");
            fullPrompt += `图片 ${att.name}: data:image/${mime};base64,${b64.substring(0, 200)}... (${imgBuf.length} bytes, 已作为附件传入)\n`;
          } catch (e) {
            fullPrompt += `图片 ${att.name}: 无法读取 (${e.message})\n`;
          }
        }
      });
      fullPrompt +=
        "请根据图片描述和用户指令来完成任务。如果用户要求参考图片中的表格/界面来创建模板，请尽量还原图片中的布局和字段。\n\n";
    }
  }

  const systemOnlyPrompt = fullPrompt;

  if (messages.length > 1) {
    fullPrompt += "[对话历史]\n";
    messages.slice(0, -1).forEach((m) => {
      const role = m.role === "user" ? "用户" : "助手";
      fullPrompt += `${role}: ${m.content}\n\n`;
    });
  }

  const lastMsg = messages[messages.length - 1];
  fullPrompt += `用户: ${lastMsg.content}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (resolvedAgent) {
    res.setHeader("X-Agent-Name", resolvedAgent.name);
    res.setHeader("X-Agent-Color", resolvedAgent.color);
  }
  res.flushHeaders();

  // v3.1: Send agent metadata as first SSE event
  if (resolvedAgent) {
    res.write(
      `data: ${JSON.stringify({
        type: "agent_info",
        agent: resolvedAgent.name,
        color: resolvedAgent.color,
        model: selectedModel,
      })}\n\n`,
    );
  }

  // SSE keepalive: prevent browser/WebView timeout during CLI startup
  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }
  }, 5000);

  const promptTier = estimatePromptTier(lastUserMsg, messages);

  // ── v3.2.0: Direct API fast path for light tier ────────────
  //    Bypasses CLI cold start (~15s) for simple queries.
  //    Falls back to CLI on any error. Disable with USE_DIRECT_API=false.
  //    Note: Step execution stays on CLI (model needs prompt caching for 30K+ prompts).
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "abaffc",
    },
    body: JSON.stringify({
      sessionId: "abaffc",
      location: "proxy-server.js:route-decision",
      message: "Direct API routing check",
      data: {
        promptTier,
        USE_DIRECT_API,
        directApiReady: directApi.isReady(),
        currentMode,
        willUseDirectApi:
          promptTier === "light" &&
          USE_DIRECT_API &&
          directApi.isReady() &&
          currentMode !== "team",
        lastUserMsgPrefix: (lastUserMsg || "").substring(0, 80),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/654d9aa3-fbba-48f2-b4ce-e7b9fc0ed511", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "abaffc",
    },
    body: JSON.stringify({
      sessionId: "abaffc",
      location: "proxy-server.js:route-decision-abaffc",
      message: "Route decision for this request",
      data: {
        promptTier,
        currentMode,
        webSearch: !!webSearch,
        model: model || "default",
        hasStepMarker: /请执行以下步骤（仅这一步）/.test(lastUserMsg || ""),
        lastUserMsgPrefix: (lastUserMsg || "").substring(0, 120),
      },
      timestamp: Date.now(),
      hypothesisId: "H1-stepExec-regex",
    }),
  }).catch(() => {});
  // #endregion
  if (
    promptTier === "light" &&
    USE_DIRECT_API &&
    directApi.isReady() &&
    currentMode !== "team"
  ) {
    const apiStartTime = Date.now();
    let apiSystemPrompt = _STATIC_CORE_PROMPT.replace(
      "你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。",
      `你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。\n今天是 ${todayStr}。`,
    );
    apiSystemPrompt += _STATIC_CAPABILITY_PROMPT;
    if (context)
      apiSystemPrompt += `\n[当前 Excel 上下文]\n${smartSampleContext(context)}\n`;

    const apiMessages = [];
    if (messages.length > 1) {
      messages.slice(-3, -1).forEach((m) => {
        apiMessages.push({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        });
      });
    }
    // Build last user message — add image attachments as vision content blocks
    const lastUserContent = messages[messages.length - 1].content;
    const imageAttsForApi = Array.isArray(attachments)
      ? attachments.filter((a) => a.type === "image" && a.tempPath)
      : [];
    const textAttsForApi = Array.isArray(attachments)
      ? attachments.filter((a) => a.type !== "image")
      : [];

    if (textAttsForApi.length > 0) {
      let textPrefix = "[用户附件]\n";
      textAttsForApi.forEach((a) => {
        textPrefix += `--- ${a.name} ---\n${a.content}\n\n`;
      });
      apiSystemPrompt += textPrefix;
    }

    if (imageAttsForApi.length > 0) {
      // Build multipart content for vision
      const contentBlocks = [{ type: "text", text: lastUserContent }];
      for (const att of imageAttsForApi) {
        try {
          if (!isPathSafe(att.tempPath, TEMP_DIR)) continue;
          const imgBuf = readFileSync(att.tempPath);
          const ext = att.name?.split(".").pop()?.toLowerCase() || "png";
          const mime =
            {
              jpg: "jpeg",
              jpeg: "jpeg",
              png: "png",
              gif: "gif",
              webp: "webp",
              bmp: "bmp",
            }[ext] || "png";
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: `image/${mime}`,
              data: imgBuf.toString("base64"),
            },
          });
        } catch (e) {
          console.warn(`[direct-api] image read failed: ${e.message}`);
        }
      }
      apiMessages.push({ role: "user", content: contentBlocks });
    } else {
      apiMessages.push({ role: "user", content: lastUserContent });
    }

    const abortController = new AbortController();
    const apiTimeout = setTimeout(() => abortController.abort(), 10_000);

    // #region agent log
    fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "abaffc",
      },
      body: JSON.stringify({
        sessionId: "abaffc",
        location: "proxy-server.js:direct-api-start",
        message: "Starting Direct API for light tier",
        data: {
          model: selectedModel,
          systemPromptLen: apiSystemPrompt.length,
          msgCount: apiMessages.length,
          timeoutMs: 10000,
        },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
    // #endregion

    try {
      const keepaliveApi = setInterval(() => {
        if (!res.writableEnded) res.write(`: keepalive ${Date.now()}\n\n`);
      }, 5000);

      const result = await directApi.streamChat({
        systemPrompt: apiSystemPrompt,
        messages: apiMessages,
        model: selectedModel,
        maxTokens: 4096,
        signal: abortController.signal,
        onEvent: (evt) => {
          if (res.writableEnded) return;
          // #region agent log
          if (evt.type === "token" || evt.type === "thinking") {
            fetch(
              "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "abaffc",
                },
                body: JSON.stringify({
                  sessionId: "abaffc",
                  location: "proxy-server.js:onEvent-directApi",
                  message: `Direct API SSE: ${evt.type}`,
                  data: {
                    type: evt.type,
                    textLen: evt.text?.length || 0,
                    elapsedMs: Date.now() - apiStartTime,
                  },
                  timestamp: Date.now(),
                }),
              },
            ).catch(() => {});
          }
          // #endregion
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        },
      });

      clearTimeout(apiTimeout);
      clearInterval(keepaliveApi);

      console.log(
        `[direct-api] ✅ ${selectedModel} totalMs=${result.totalMs} ttFirst=${result.ttFirstToken} chars=${result.resultText.length} thinkingChars=${result.thinkingText?.length ?? 0}`,
      );
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "proxy-server.js:direct-api-done",
            message: "Direct API done",
            data: {
              resultTextLen: result.resultText.length,
              thinkingTextLen: result.thinkingText?.length ?? 0,
              totalMs: result.totalMs,
              ttFirstToken: result.ttFirstToken,
              model: selectedModel,
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion

      if (!res.writableEnded) {
        const doneEvt = {
          type: "done",
          fullText: result.resultText,
          provenance: {
            mode: currentMode,
            model: selectedModel,
            skillsLoaded: allMatched.map((s) => s.name),
            promptSummary: lastUserMsg?.substring(0, 50),
            timestamp: Date.now(),
          },
        };
        res.write(`data: ${JSON.stringify(doneEvt)}\n\n`);
        res.end();
      }
      _activeChats--;
      return;
    } catch (apiErr) {
      clearTimeout(apiTimeout);
      const fallbackMs = Date.now() - apiStartTime;
      console.warn(
        `[direct-api] ⚠️ Falling back to CLI: ${apiErr.message} (${fallbackMs}ms)`,
      );
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "proxy-server.js:direct-api-fallback",
            message: "Direct API failed, falling back to CLI",
            data: {
              errMsg: apiErr.message,
              errName: apiErr.name,
              fallbackMs,
              model: selectedModel,
              promptTier,
            },
            timestamp: Date.now(),
            hypothesisId: "H1",
          }),
        },
      ).catch(() => {});
      // #endregion
    }
  }

  // ── Plan-first path: 复杂任务先用 Direct API 快速生成计划 ────
  // 参考 Cursor Plan Mode / Claude Code TodoWrite / Manus PlanningAgent
  // 用 Haiku 快速分类：任务是否需要多步骤规划（取代硬编码关键词）
  const isStepExecution =
    /(\[前序步骤结果\]|请执行以下步骤（仅这一步）|\[执行结果\s*\d+\/\d+\]|代码执行出错（自动重试\s*\d+\/\d+）)/.test(
      (lastUserMsg || "").trim(),
    );
  const PLAN_REQUIRED_KW =
    /dcf|估值模型|建模|财务模型|完整.*模型|多.*sheet|多.*表|分析.*报告|敏感性分析|情景分析|scenario/i;
  const kwPlanMatch = PLAN_REQUIRED_KW.test(lastUserMsg || "");

  let isPlanFirstCandidate = false;
  if (
    !isStepExecution &&
    (promptTier === "standard" || promptTier === "heavy") &&
    currentMode !== "plan" &&
    currentMode !== "ask"
  ) {
    if (kwPlanMatch) {
      isPlanFirstCandidate = true;
      console.log(
        `[classify] Keyword match → isPlanFirst=true for: ${(lastUserMsg || "").substring(0, 50)}`,
      );
    } else if (USE_DIRECT_API && directApi.isReady()) {
      try {
        const classifyAbort = new AbortController();
        const classifyTimer = setTimeout(() => classifyAbort.abort(), 8000);
        let classifyResult = "";
        await directApi.streamChat({
          systemPrompt:
            "你是任务复杂度分类器。判断用户任务是否需要分步骤规划才能完成。\n" +
            "需要规划(YES)：涉及多个依赖步骤的复杂任务，如DCF建模、跨多表关联分析、多阶段工作流、需要先收集数据再计算再验证等。\n" +
            "不需要规划(NO)：单步可完成的任务，如搜索信息并列表、生成一张表格、简单计算、格式设置、画一个图表、写公式、翻译、问答等。\n" +
            "只回复 YES 或 NO，不要解释。",
          messages: [{ role: "user", content: lastUserMsg }],
          model: "haiku",
          maxTokens: 8,
          signal: classifyAbort.signal,
          onEvent: (evt) => {
            if (evt.type === "token") classifyResult += evt.text;
          },
        });
        clearTimeout(classifyTimer);
        isPlanFirstCandidate = /yes/i.test(classifyResult.trim());
        console.log(
          `[classify] Haiku says "${classifyResult.trim()}" → isPlanFirst=${isPlanFirstCandidate} for: ${(lastUserMsg || "").substring(0, 50)}`,
        );
      } catch (classifyErr) {
        console.log(
          `[classify] Failed (${classifyErr.message}), skipping plan-first`,
        );
        isPlanFirstCandidate = false;
      }
    }
  }

  // #region agent log - console fallback
  console.log(
    `[route] isStepExec=${isStepExecution} isPlanFirst=${isPlanFirstCandidate} tier=${promptTier} msg="${(lastUserMsg || "").substring(0, 80).replace(/\n/g, "↵")}"`,
  );
  // #endregion
  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "eab716",
    },
    body: JSON.stringify({
      sessionId: "eab716",
      location: "proxy-server.js:route-decision",
      message: "Routing decision",
      data: {
        isStepExecution,
        isPlanFirstCandidate,
        kwPlanMatch,
        promptTier,
        directApiReady: USE_DIRECT_API && directApi.isReady(),
        msgSnippet: (lastUserMsg || "").substring(0, 60),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (isPlanFirstCandidate) {
    const apiStartPlan = Date.now();
    try {
      let planText = "";
      const directApiOk = USE_DIRECT_API && directApi.isReady();

      if (directApiOk) {
        try {
          console.log(
            `[plan-first] Generating plan via Direct API for: ${lastUserMsg.substring(0, 60)}...`,
          );

          const plannerAgent = getAgentByName("planner");
          const plannerSystemPrompt = plannerAgent
            ? plannerAgent.systemPrompt +
              "\n\n**重要**: 只输出编号步骤列表（1. 2. 3. ...），每步不超过 20 字。不要输出完整的计划文档。"
            : "你是一个任务规划助手。只输出结构化的步骤列表，不要输出代码或其他解释。";

          let planUserMsg = `用户要求:\n\n"${lastUserMsg}"\n\n`;
          if (context) {
            planUserMsg += `[当前工作簿上下文]\n${smartSampleContext(context)}\n\n`;
          }
          planUserMsg +=
            `请将这个任务分解为 3-8 个可独立执行的步骤。\n` +
            `输出格式（严格遵守）:\n` +
            `1. 步骤描述\n2. 步骤描述\n...\n\n` +
            `规则:\n- 每步不超过 20 个字\n- 第一步通常是准备数据/框架\n- 最后一步是验证和总结\n- 不要输出其他内容，只输出编号列表`;

          const planAbort = new AbortController();
          const planTimeout = setTimeout(() => planAbort.abort(), 75000);

          await directApi.streamChat({
            systemPrompt: plannerSystemPrompt,
            messages: [{ role: "user", content: planUserMsg }],
            model: plannerAgent?.model || "sonnet",
            maxTokens: 1024,
            signal: planAbort.signal,
            onEvent: (evt) => {
              if (evt.type === "token") planText += evt.text;
            },
          });
          clearTimeout(planTimeout);
        } catch (apiPlanErr) {
          console.warn(
            `[plan-first] Direct API plan failed: ${apiPlanErr.message}, trying template fallback`,
          );
          planText = "";
        }
      }

      if (!planText && /dcf|估值模型|财务模型/i.test(lastUserMsg || "")) {
        console.log(`[plan-first] Using DCF template`);
        const companyHint =
          (lastUserMsg || "")
            .replace(/^.*?(新建|创建|生成|做|帮我)/, "")
            .replace(/(dcf|DCF|分析|估值|模型|报告)/gi, "")
            .trim() || "目标公司";
        planText =
          `1. 创建工作簿框架和"关键假设"Sheet\n` +
          `2. 搜集${companyHint}历史财务数据并填入"历史数据"Sheet\n` +
          `3. 建立营收预测模型（公式驱动）\n` +
          `4. 建立利润表和现金流预测（引用假设表参数）\n` +
          `5. 构建DCF估值模型（WACC/终值/折现）\n` +
          `6. 添加敏感性分析表\n` +
          `7. 格式化和交叉验证所有公式`;
      } else if (!planText) {
        console.log(`[plan-first] No plan generated and no template match`);
      }

      const planSteps = parsePlanSteps(planText);
      if (planSteps.length >= 2) {
        console.log(
          `[plan-first] ✅ Generated ${planSteps.length} steps in ${Date.now() - apiStartPlan}ms`,
        );

        // #region agent log
        fetch(
          "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "eab716",
            },
            body: JSON.stringify({
              sessionId: "eab716",
              location: "proxy-server.js:plan-first-success",
              message: "Plan generated successfully",
              data: {
                stepCount: planSteps.length,
                planText: planText.substring(0, 200),
                elapsedMs: Date.now() - apiStartPlan,
              },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion

        const planSummary = planSteps
          .map((s) => `${s.index}. ${s.text}`)
          .join("\n");
        res.write(
          `data: ${JSON.stringify({
            type: "plan_created",
            steps: planSteps,
            originalTask: lastUserMsg,
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            type: "token",
            text: `我已为您制定了执行计划：\n\n${planSummary}\n\n点击 **▶ 全部执行** 逐步完成，或点击单个步骤的 ▶ 按钮单步执行。`,
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            type: "done",
            fullText: `我已为您制定了执行计划：\n\n${planSummary}\n\n点击 **▶ 全部执行** 逐步完成，或点击单个步骤的 ▶ 按钮单步执行。`,
            provenance: {
              mode: currentMode,
              model: selectedModel,
              skillsLoaded: allMatched.map((s) => s.name),
              promptSummary: lastUserMsg.substring(0, 50),
              timestamp: Date.now(),
            },
          })}\n\n`,
        );
        clearInterval(keepalive);
        res.end();
        _activeChats--;
        return;
      }
    } catch (planErr) {
      console.warn(
        `[plan-first] ⚠️ Plan generation failed: ${planErr.name}:${planErr.message} (elapsed:${Date.now() - apiStartPlan}ms), continuing with CLI`,
      );
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "eab716",
          },
          body: JSON.stringify({
            sessionId: "eab716",
            location: "proxy-server.js:plan-first-fail",
            message: "Plan generation failed",
            data: { error: planErr.message },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
    }
  }

  // ── Step Execution via Direct API: 真正的 thinking 流式传输 ────
  // CLI 的 stream-json 不发送 thinking_delta 增量事件（只在完成后一次性返回 assistant 消息）
  // Direct API 支持 thinking_delta 实时流式，用户可以看到 AI 思考过程
  if (isStepExecution && USE_DIRECT_API && directApi.isReady()) {
    const apiStepStart = Date.now();
    console.log(
      `[step-exec] Using Direct API for streaming thinking (step execution)`,
    );
    // #region agent log
    fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "abaffc",
      },
      body: JSON.stringify({
        sessionId: "abaffc",
        location: "proxy-server.js:step-exec-direct-api",
        message: "Step execution via Direct API",
        data: {
          promptTier,
          model: selectedModel,
          systemPromptLen: systemOnlyPrompt.length,
          msgCount: messages.length,
          lastMsgLen: (lastUserMsg || "").length,
          lastMsgHead: (lastUserMsg || "").substring(0, 120),
        },
        timestamp: apiStepStart,
        hypothesisId: "DirectAPI",
      }),
    }).catch(() => {});
    // #endregion
    try {
      let stepResultText = "";
      const stepAbort = new AbortController();
      const stepTimeoutMs = promptTier === "heavy" ? 300_000 : 120_000;
      const stepTimeout = setTimeout(() => stepAbort.abort(), stepTimeoutMs);
      const keepaliveApi = setInterval(() => {
        if (!res.writableEnded) res.write(`: keepalive ${Date.now()}\n\n`);
      }, 5000);
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "proxy-server.js:step-exec-timeout-config",
            message: "Step timeout configured",
            data: { promptTier, stepTimeoutMs, model: selectedModel },
            timestamp: Date.now(),
            hypothesisId: "H-timeout",
          }),
        },
      ).catch(() => {});
      // #endregion

      let _apiFirstThinkMs = 0;
      let _apiFirstTokenMs = 0;
      let _apiThinkChars = 0;

      await directApi.streamChat({
        systemPrompt: systemOnlyPrompt,
        messages: messages,
        model: selectedModel,
        maxTokens: 16384,
        enableThinking: true,
        thinkingBudget: 10000,
        signal: stepAbort.signal,
        onEvent: (evt) => {
          if (res.writableEnded) return;
          if (evt.type === "thinking") {
            if (!_apiFirstThinkMs) {
              _apiFirstThinkMs = Date.now() - apiStepStart;
              // #region agent log
              fetch(
                "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Debug-Session-Id": "abaffc",
                  },
                  body: JSON.stringify({
                    sessionId: "abaffc",
                    location: "proxy-server.js:step-exec-first-thinking",
                    message: "First thinking delta from Direct API",
                    data: {
                      msFromStart: _apiFirstThinkMs,
                      textLen: evt.text.length,
                    },
                    timestamp: Date.now(),
                    hypothesisId: "DirectAPI",
                  }),
                },
              ).catch(() => {});
              // #endregion
            }
            _apiThinkChars += evt.text.length;
            res.write(
              `data: ${JSON.stringify({ type: "thinking", text: evt.text })}\n\n`,
            );
          } else if (evt.type === "token") {
            if (!_apiFirstTokenMs) {
              _apiFirstTokenMs = Date.now() - apiStepStart;
              // #region agent log
              fetch(
                "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Debug-Session-Id": "abaffc",
                  },
                  body: JSON.stringify({
                    sessionId: "abaffc",
                    location: "proxy-server.js:step-exec-first-token",
                    message: "First token from Direct API",
                    data: {
                      msFromStart: _apiFirstTokenMs,
                      thinkChars: _apiThinkChars,
                    },
                    timestamp: Date.now(),
                    hypothesisId: "DirectAPI",
                  }),
                },
              ).catch(() => {});
              // #endregion
            }
            stepResultText += evt.text;
            res.write(
              `data: ${JSON.stringify({ type: "token", text: evt.text })}\n\n`,
            );
          }
        },
      });

      clearTimeout(stepTimeout);
      clearInterval(keepaliveApi);

      const provenance = {
        mode: currentMode,
        model: selectedModel,
        skillsLoaded: allMatched.map((s) => s.name),
        timestamp: Date.now(),
      };
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ type: "done", fullText: stepResultText, provenance })}\n\n`,
        );
      }
      clearInterval(keepalive);
      res.end();
      _activeChats--;
      console.log(
        `[step-exec] Direct API done: ${stepResultText.length} chars in ${Date.now() - apiStepStart}ms`,
      );
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "proxy-server.js:step-exec-direct-api-done",
            message: "Step execution Direct API success",
            data: {
              resultLen: stepResultText.length,
              elapsedMs: Date.now() - apiStepStart,
            },
            timestamp: Date.now(),
            hypothesisId: "DirectAPI",
          }),
        },
      ).catch(() => {});
      // #endregion
      return;
    } catch (stepApiErr) {
      console.warn(
        `[step-exec] Direct API failed: ${stepApiErr.message}, falling back to CLI`,
      );
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "proxy-server.js:step-exec-direct-api-fail",
            message: "Step execution Direct API failed, falling back to CLI",
            data: {
              error: stepApiErr.message,
              elapsedMs: Date.now() - apiStepStart,
            },
            timestamp: Date.now(),
            hypothesisId: "DirectAPI",
          }),
        },
      ).catch(() => {});
      // #endregion
    }
  }

  const claudePath = RESOLVED_CLAUDE_PATH;
  const maxTurns = String(
    enforcement.maxTurns || (currentMode === "ask" ? 1 : 5),
  );
  const cliArgs = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--max-turns",
    promptTier === "light" ? "1" : maxTurns,
    "--model",
    selectedModel,
  ];

  // ── Light Tier 快速路径：
  //    用 --system-prompt 传入预缓存的核心 prompt（保留全部 Excel/代码/JSON 能力），
  //    --setting-sources user：只加载用户级配置（启用 Statsig 缓存 = 更快 init），
  //    同时跳过项目级 SessionStart hook（实测节省 15-20s）。
  //    --disable-slash-commands 跳过 skills 加载（skills 在 standard/heavy tier 按需注入）。
  //    实测：默认 CLI ~22-34s → 快速路径 ~5-9s
  if (promptTier === "light") {
    let lightPrompt = _STATIC_CORE_PROMPT.replace(
      "你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。",
      `你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。\n今天是 ${todayStr}。`,
    );
    lightPrompt += _STATIC_CAPABILITY_PROMPT;
    if (context)
      lightPrompt += `\n[当前 Excel 上下文]\n${smartSampleContext(context)}\n`;
    // --setting-sources user：保留用户设置（Statsig 缓存）、跳过项目 SessionStart hook
    cliArgs.push(
      "--system-prompt",
      lightPrompt,
      "--disable-slash-commands",
      "--setting-sources",
      "user",
    );
  }
  // effort 策略：根据 prompt 复杂度 + 模式动态决定
  // 参考 Claude Code: effort 控制 Opus 4.6 的 adaptive reasoning 深度
  // light → low, standard → medium, heavy/plan/team → high
  const effortLevel =
    promptTier === "heavy" || currentMode === "plan" || currentMode === "team"
      ? "high"
      : promptTier === "standard"
        ? "medium"
        : "low";
  if (effortLevel === "high") {
    cliArgs.push("--effort", "high");
  } else if (effortLevel === "medium") {
    cliArgs.push("--effort", "medium");
  } else {
    cliArgs.push("--effort", "low");
  }

  // 禁止 CLI 直接执行 Bash/Read/Write — 所有执行走我们的管道（带用户确认）
  cliArgs.push("--disallowedTools", "Bash,Write,Edit");

  if (webSearch) {
    cliArgs.push("--allowedTools", "WebSearch");
  }
  const ENV_WHITELIST = [
    "HOME",
    "USER",
    "PATH",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "NODE_PATH",
    "NVM_DIR",
    "NVM_BIN",
    "NVM_INC",
    "CLAUDE_PATH",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  ];
  const cleanEnv = {};
  cleanEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "32000";
  if (promptTier === "light") {
    cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING = "1";
    cleanEnv.MAX_THINKING_TOKENS = "500";
  } else if (promptTier === "standard") {
    cleanEnv.MAX_THINKING_TOKENS = "16000";
  } else {
    cleanEnv.MAX_THINKING_TOKENS = "32000";
  }
  for (const key of ENV_WHITELIST) {
    if (process.env[key]) cleanEnv[key] = process.env[key];
  }
  const spawnEnv = cleanEnv;
  const child = spawn(claudePath, cliArgs, { env: spawnEnv });

  // #region agent log
  const _cliSpawnTime = Date.now();
  fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "abaffc",
    },
    body: JSON.stringify({
      sessionId: "abaffc",
      location: "proxy-server.js:cli-spawn",
      message: "CLI process spawned",
      data: {
        promptTier,
        effortLevel,
        model: selectedModel,
        isStepExecution,
        maxThinkingTokens: cleanEnv.MAX_THINKING_TOKENS,
        disableAdaptiveThinking:
          cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING || "unset",
        cliArgsCount: cliArgs.length,
      },
      timestamp: _cliSpawnTime,
      hypothesisId: "H2,H4",
    }),
  }).catch(() => {});
  // #endregion

  // CLI 超时保护：light 45s, standard 300s, heavy 600s
  // 复杂任务（如 DCF 建模）需要多轮代码生成+执行，120s 远不够
  const CLI_TIMEOUT_MS =
    promptTier === "light"
      ? 45_000
      : promptTier === "standard"
        ? 300_000
        : 600_000;
  const cliTimer = setTimeout(() => {
    if (!child.killed) {
      console.log(
        `[chat] CLI timeout after ${CLI_TIMEOUT_MS}ms, killing process`,
      );
      child.kill("SIGTERM");
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ type: "result", subtype: "text", text: "\n\n⚠️ 响应超时，请重试或换用更快的模型。" })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ type: "done", fullText: "⚠️ 响应超时，请重试或换用更快的模型。", provenance: { mode: currentMode, model: selectedModel, timestamp: Date.now() } })}\n\n`,
        );
        res.end();
      }
    }
  }, CLI_TIMEOUT_MS);

  const provenance = {
    mode: currentMode,
    model: selectedModel,
    skillsLoaded: allMatched.map((s) => s.name),
    promptSummary: lastUserMsg.substring(0, 80),
    timestamp: Date.now(),
  };

  res.write(
    `data: ${JSON.stringify({ type: "mode", mode: currentMode, enforcement, provenance })}\n\n`,
  );

  // v2.2.0+: System/framework skills are invisible — only show operational skills to users
  const HIDDEN_SKILLS = new Set([
    // System / always-on skills
    "soul-engine",
    "memory-manager",
    "onboarding",
    "soul",
    // Framework skills that "load" capabilities (not direct user actions)
    "financial-modeling",
    "equity-valuation",
    "code-rules",
    "knowledge-base",
    "template-generation",
  ]);
  // v2.3.0: No longer emit skill_loaded activities upfront — activities
  // are now driven by actual tool_use events detected from the CLI stream.

  // Light tier: 系统 prompt 已通过 --system-prompt 传入，stdin 只传用户消息 + 必要历史
  if (promptTier === "light") {
    let lightInput = "";
    if (messages.length > 1) {
      messages.slice(-3, -1).forEach((m) => {
        const role = m.role === "user" ? "用户" : "助手";
        lightInput += `${role}: ${m.content}\n\n`;
      });
    }
    lightInput += messages[messages.length - 1].content;
    child.stdin.write(lightInput);
  } else {
    child.stdin.write(fullPrompt);
  }
  child.stdin.end();

  let resultText = "";
  let responseDone = false;
  let _lineBuf = "";
  let _tokenCount = 0;
  let _thinkingText = "";
  let _evtTypeSeen = {};
  const _streamStartTime = Date.now();
  let _firstTokenTime = 0;
  let _firstThinkTime = 0;

  const CLI_IDLE_TIMEOUT = isStepExecution ? 240_000 : 120_000;
  const CLI_TOTAL_TIMEOUT = 600_000;
  let _lastDataTime = Date.now();

  const _idleTimer = setInterval(() => {
    if (responseDone) {
      clearInterval(_idleTimer);
      return;
    }
    const idleMs = Date.now() - _lastDataTime;
    const totalMs = Date.now() - _streamStartTime;
    if (idleMs > CLI_IDLE_TIMEOUT || totalMs > CLI_TOTAL_TIMEOUT) {
      clearInterval(_idleTimer);
      if (!child.killed) child.kill();
      if (!res.writableEnded) {
        const reason =
          idleMs > CLI_IDLE_TIMEOUT
            ? `Claude CLI ${Math.round(idleMs / 1000)} 秒无响应`
            : `请求总时长超过 ${Math.round(CLI_TOTAL_TIMEOUT / 1000)} 秒`;
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            message: `${reason}，已自动终止。网络延迟较高，建议：\n1. 切换到 Haiku 模型（更快）\n2. 检查网络连接\n3. 重试`,
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ type: "done", fullText: `⚠️ ${reason}，已自动终止。`, provenance: { mode: currentMode, model: selectedModel, timestamp: Date.now() } })}\n\n`,
        );
        clearInterval(keepalive);
        responseDone = true;
        res.end();
      }
    }
  }, 5000);

  let _streamChunkQueue = [];
  let _chunkDraining = false;

  function _drainChunks() {
    if (_chunkDraining || _streamChunkQueue.length === 0) return;
    _chunkDraining = true;
    const chunk = _streamChunkQueue.shift();
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    const delay = chunk.type === "thinking" ? 8 : 15;
    setTimeout(() => {
      _chunkDraining = false;
      _drainChunks();
    }, delay);
  }

  function _enqueueText(fullText, type) {
    const chunkSize = type === "thinking" ? 30 : 12;
    for (let i = 0; i < fullText.length; i += chunkSize) {
      _streamChunkQueue.push({ type, text: fullText.slice(i, i + chunkSize) });
    }
    _drainChunks();
  }

  let _stdoutFirstChunk = true;
  let _firstStdoutTime = 0;
  let _firstParsedEvtTime = 0;
  let _firstThinkEvtTime = 0;
  let _firstTokenEvtTime = 0;
  let _parsedEvtTypes = {};
  // #region agent log
  let _toolUseCount = 0;
  let _toolUseLog = [];
  // #endregion
  child.stdout.on("data", (data) => {
    _lastDataTime = Date.now();
    // #region agent log
    if (!_firstStdoutTime) {
      _firstStdoutTime = Date.now();
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "proxy-server.js:cli-first-stdout",
            message: "First CLI stdout chunk",
            data: {
              msSinceSpawn: _firstStdoutTime - _cliSpawnTime,
              chunkLen: data.length,
              chunkHead: data.toString().substring(0, 200),
            },
            timestamp: _firstStdoutTime,
            hypothesisId: "H3",
          }),
        },
      ).catch(() => {});
    }
    // #endregion
    _lineBuf += data.toString();
    const lines = _lineBuf.split("\n");
    _lineBuf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const evt = JSON.parse(line);

        // #region agent log
        if (!_firstParsedEvtTime) {
          _firstParsedEvtTime = Date.now();
          fetch(
            "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Debug-Session-Id": "abaffc",
              },
              body: JSON.stringify({
                sessionId: "abaffc",
                location: "proxy-server.js:cli-first-parsed",
                message: "First parsed CLI event",
                data: {
                  msSinceSpawn: _firstParsedEvtTime - _cliSpawnTime,
                  evtType: evt.type,
                  subType: evt.event?.type || evt.message?.role || "n/a",
                },
                timestamp: _firstParsedEvtTime,
                hypothesisId: "H3,H4",
              }),
            },
          ).catch(() => {});
        }
        _parsedEvtTypes[evt.type] = (_parsedEvtTypes[evt.type] || 0) + 1;
        // #endregion

        if (evt.type === "stream_event") {
          const se = evt.event;
          if (se.type === "content_block_delta") {
            if (se.delta?.type === "text_delta" && se.delta.text) {
              if (!_firstTokenTime) _firstTokenTime = Date.now();
              // #region agent log
              if (!_firstTokenEvtTime) {
                _firstTokenEvtTime = Date.now();
                fetch(
                  "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Debug-Session-Id": "abaffc",
                    },
                    body: JSON.stringify({
                      sessionId: "abaffc",
                      location: "proxy-server.js:cli-first-token",
                      message: "First text_delta from CLI",
                      data: {
                        msSinceSpawn: _firstTokenEvtTime - _cliSpawnTime,
                        textLen: se.delta.text.length,
                      },
                      timestamp: _firstTokenEvtTime,
                      hypothesisId: "H2",
                    }),
                  },
                ).catch(() => {});
              }
              // #endregion
              resultText += se.delta.text;
              _tokenCount++;
              res.write(
                `data: ${JSON.stringify({ type: "token", text: se.delta.text })}\n\n`,
              );
            } else if (
              se.delta?.type === "thinking_delta" &&
              se.delta.thinking
            ) {
              if (!_firstThinkTime) _firstThinkTime = Date.now();
              // #region agent log
              if (!_firstThinkEvtTime) {
                _firstThinkEvtTime = Date.now();
                fetch(
                  "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Debug-Session-Id": "abaffc",
                    },
                    body: JSON.stringify({
                      sessionId: "abaffc",
                      location: "proxy-server.js:cli-first-thinking-delta",
                      message: "First thinking_delta from CLI (stream_event)",
                      data: {
                        msSinceSpawn: _firstThinkEvtTime - _cliSpawnTime,
                        thinkingLen: se.delta.thinking.length,
                        thinkingHead: se.delta.thinking.substring(0, 60),
                      },
                      timestamp: _firstThinkEvtTime,
                      hypothesisId: "H1,H4",
                    }),
                  },
                ).catch(() => {});
              }
              // #endregion
              _thinkingText += se.delta.thinking;
              res.write(
                `data: ${JSON.stringify({ type: "thinking", text: se.delta.thinking })}\n\n`,
              );
            }
          }
          if (
            se.type === "content_block_start" &&
            se.content_block?.type === "tool_use" &&
            !res.writableEnded
          ) {
            // #region agent log
            _toolUseCount++;
            const _tuTime = Date.now();
            _toolUseLog.push({
              name: se.content_block.name,
              ms: _tuTime - _cliSpawnTime,
            });
            fetch(
              "http://127.0.0.1:7244/ingest/654d9aa3-fbba-48f2-b4ce-e7b9fc0ed511",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "abaffc",
                },
                body: JSON.stringify({
                  sessionId: "abaffc",
                  location: "proxy-server.js:cli-tool-use",
                  message: `CLI tool_use #${_toolUseCount}: ${se.content_block.name}`,
                  data: {
                    toolName: se.content_block.name,
                    toolUseIndex: _toolUseCount,
                    msSinceSpawn: _tuTime - _cliSpawnTime,
                    promptTier,
                  },
                  timestamp: _tuTime,
                  hypothesisId: "H2,H3",
                }),
              },
            ).catch(() => {});
            // #endregion
            res.write(
              `data: ${JSON.stringify({ type: "activity", action: "tool_use", name: se.content_block.name })}\n\n`,
            );
          }
        } else if (evt.type === "assistant" && evt.message?.content) {
          if (!_firstTokenTime) _firstTokenTime = Date.now();
          // #region agent log
          const blockTypes = evt.message.content.map((b) => b.type);
          const textBlocks = evt.message.content.filter(
            (b) => b.type === "text",
          );
          const thinkBlocks = evt.message.content.filter(
            (b) => b.type === "thinking",
          );
          fetch(
            "http://127.0.0.1:7244/ingest/654d9aa3-fbba-48f2-b4ce-e7b9fc0ed511",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Debug-Session-Id": "abaffc",
              },
              body: JSON.stringify({
                sessionId: "abaffc",
                location: "proxy-server.js:cli-assistant-msg",
                message: "CLI assistant message arrived (batch)",
                data: {
                  msSinceSpawn: Date.now() - _cliSpawnTime,
                  blockTypes,
                  thinkingLen: thinkBlocks[0]?.thinking?.length || 0,
                  textLen: textBlocks.reduce(
                    (s, b) => s + (b.text?.length || 0),
                    0,
                  ),
                  toolUseSoFar: _toolUseCount,
                },
                timestamp: Date.now(),
                hypothesisId: "H2,H5",
              }),
            },
          ).catch(() => {});
          if (thinkBlocks.length > 0 && !_firstThinkEvtTime) {
            _firstThinkEvtTime = Date.now();
            fetch(
              "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Debug-Session-Id": "abaffc",
                },
                body: JSON.stringify({
                  sessionId: "abaffc",
                  location: "proxy-server.js:cli-assistant-thinking",
                  message: "Thinking from assistant msg (NOT streaming)",
                  data: {
                    msSinceSpawn: _firstThinkEvtTime - _cliSpawnTime,
                    blockTypes,
                    thinkingLen: thinkBlocks[0].thinking?.length || 0,
                    thinkingHead: (thinkBlocks[0].thinking || "").substring(
                      0,
                      60,
                    ),
                  },
                  timestamp: _firstThinkEvtTime,
                  hypothesisId: "H4",
                }),
              },
            ).catch(() => {});
          }
          // #endregion
          for (const block of evt.message.content) {
            if (block.type === "thinking" && block.thinking) {
              _thinkingText += block.thinking;
              _enqueueText(block.thinking, "thinking");
            } else if (block.type === "text" && block.text) {
              resultText += block.text;
              _enqueueText(block.text, "token");
            } else if (
              block.type === "tool_use" &&
              block.name &&
              !res.writableEnded
            ) {
              // CLI delivers tool_use as assistant-message blocks (not stream_event)
              // Emit activity so the frontend shows progress instead of blank "Thinking..."
              _toolUseCount++;
              _toolUseLog.push({
                name: block.name,
                ms: Date.now() - _cliSpawnTime,
              });
              res.write(
                `data: ${JSON.stringify({ type: "activity", action: "tool_use", name: block.name })}\n\n`,
              );
            }
          }
        } else if (evt.type === "result") {
          const rt =
            typeof evt.result === "string"
              ? evt.result
              : evt.result?.text || "";
          if (rt && !resultText) resultText = rt;
        }
      } catch (parseErr) {
        // unparseable CLI line - skip
      }
    }
  });

  let _stderrBuf = "";
  child.stderr.on("data", (data) => {
    const chunk = data.toString().trim();
    _stderrBuf += chunk + "\n";
    console.error("[proxy] stderr:", chunk);
  });

  child.on("close", (code, signal) => {
    clearTimeout(cliTimer);
    clearInterval(_idleTimer);
    // #region agent log
    fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "eab716",
      },
      body: JSON.stringify({
        sessionId: "eab716",
        location: "proxy-server.js:cli-close",
        message: "CLI process closed",
        data: {
          code,
          signal,
          resultTextLen: resultText?.length || 0,
          stderrLen: _stderrBuf?.length || 0,
          stderrHead: (_stderrBuf || "").substring(0, 300),
          resultHead: (resultText || "").substring(0, 200),
          responseDone,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.log(
      `[cli-close] code=${code} signal=${signal} resultLen=${resultText?.length || 0} stderrLen=${_stderrBuf?.length || 0} stderr="${(_stderrBuf || "").substring(0, 150)}"`,
    );
    // #endregion
    // #region agent log
    fetch("http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "abaffc",
      },
      body: JSON.stringify({
        sessionId: "abaffc",
        location: "proxy-server.js:cli-timeline-summary",
        message: "CLI thinking timeline summary",
        data: {
          totalMs: Date.now() - _cliSpawnTime,
          firstStdoutMs: _firstStdoutTime
            ? _firstStdoutTime - _cliSpawnTime
            : -1,
          firstParsedEvtMs: _firstParsedEvtTime
            ? _firstParsedEvtTime - _cliSpawnTime
            : -1,
          firstThinkingMs: _firstThinkEvtTime
            ? _firstThinkEvtTime - _cliSpawnTime
            : -1,
          firstTokenMs: _firstTokenEvtTime
            ? _firstTokenEvtTime - _cliSpawnTime
            : -1,
          thinkingChars: _thinkingText.length,
          resultChars: resultText.length,
          parsedEvtTypes: _parsedEvtTypes,
          toolUseCount: _toolUseCount,
          toolUseLog: _toolUseLog,
          isStepExecution,
          promptTier,
        },
        timestamp: Date.now(),
        hypothesisId: "H1,H2,H3,H4",
      }),
    }).catch(() => {});
    // #endregion
    // #region agent log
    fetch("http://127.0.0.1:7244/ingest/654d9aa3-fbba-48f2-b4ce-e7b9fc0ed511", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "abaffc",
      },
      body: JSON.stringify({
        sessionId: "abaffc",
        location: "proxy-server.js:cli-close-summary",
        message: "CLI total time breakdown",
        data: {
          totalMs: Date.now() - _cliSpawnTime,
          startupMs: _firstStdoutTime ? _firstStdoutTime - _cliSpawnTime : -1,
          firstThinkingMs: _firstThinkEvtTime
            ? _firstThinkEvtTime - _cliSpawnTime
            : -1,
          firstTokenMs: _firstTokenEvtTime
            ? _firstTokenEvtTime - _cliSpawnTime
            : -1,
          thinkingChars: _thinkingText.length,
          resultChars: resultText.length,
          toolUseCount: _toolUseCount,
          toolUseLog: _toolUseLog,
          promptTier,
          model: selectedModel,
          effortLevel,
          maxTurns,
          webSearch: !!webSearch,
          code,
          signal,
        },
        timestamp: Date.now(),
        hypothesisId: "H1,H2,H3,H4,H5",
      }),
    }).catch(() => {});
    // #endregion
    const TOKEN_LIMIT_RE =
      /exceeded the \d+ output token maximum|output_token.*limit|max_tokens_exceeded/i;
    const isTokenLimit =
      TOKEN_LIMIT_RE.test(resultText) || TOKEN_LIMIT_RE.test(_stderrBuf);

    if (isTokenLimit && resultText) {
      const cleanedText = resultText
        .replace(/API Error:.*?environment variable\.\s*/gs, "")
        .trim();
      if (!res.writableEnded) {
        if (cleanedText) {
          res.write(
            `data: ${JSON.stringify({ type: "token", text: "\n\n⚠️ _输出已截断（token 超限），正在通过分步执行自动重试…_" })}\n\n`,
          );
        }
        res.write(
          `data: ${JSON.stringify({ type: "done", fullText: (cleanedText || resultText).trim(), provenance, tokenLimitHit: true })}\n\n`,
        );
      }
      clearInterval(keepalive);
      responseDone = true;
      res.end();
      return;
    }

    // #region agent log
    const _maxTurnsInt = parseInt(maxTurns, 10) || 5;
    const _turnsTruncated =
      _toolUseCount >= _maxTurnsInt && resultText.length < 200;
    if (_turnsTruncated) {
      fetch("http://127.0.0.1:7244/ingest/654d9aa3-fbba-48f2-b4ce-e7b9fc0ed511", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "abaffc" },
        body: JSON.stringify({
          sessionId: "abaffc",
          location: "proxy-server.js:maxturns-truncation",
          message: "Response likely truncated by maxTurns",
          data: { maxTurns: _maxTurnsInt, toolUseCount: _toolUseCount, resultChars: resultText.length },
          timestamp: Date.now(),
          hypothesisId: "H1,H4",
        }),
      }).catch(() => {});
      console.log(
        `[maxturns-truncation] ⚠️ toolUseCount=${_toolUseCount} >= maxTurns=${_maxTurnsInt}, resultChars=${resultText.length} — response likely truncated`,
      );
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ type: "token", text: "\n\n⚠️ _AI 使用了大量工具但未生成完整结果（工具轮次已耗尽），正在自动重试…_" })}\n\n`,
        );
      }
    }
    // #endregion

    if (code !== 0 && !resultText) {
      const stderrHint = _stderrBuf.trim().substring(0, 300);
      let userMsg = `Claude CLI 异常退出 (code=${code})`;
      if (stderrHint.includes("unknown option")) {
        userMsg +=
          "：CLI 版本不支持某些参数，请升级 claude: npm i -g @anthropic-ai/claude-code@latest";
      } else if (
        stderrHint.includes("needs an update") ||
        stderrHint.includes("newer version")
      ) {
        userMsg +=
          "：CLI 版本过低，请升级: npm i -g @anthropic-ai/claude-code@latest";
      } else if (
        stderrHint.includes("vertex") ||
        stderrHint.includes("Vertex")
      ) {
        userMsg +=
          "：检测到 Vertex AI 配置冲突，请检查环境变量 CLAUDE_CODE_USE_VERTEX";
      } else if (stderrHint) {
        userMsg += `\n详情: ${stderrHint}`;
      } else {
        userMsg += "，请确认已登录：运行 claude 命令";
      }
      res.write(
        `data: ${JSON.stringify({ type: "error", message: userMsg })}\n\n`,
      );
    } else {
      const _finalize = () => {
        if (_streamChunkQueue.length > 0 || _chunkDraining) {
          setTimeout(_finalize, 50);
          return;
        }
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({ type: "done", fullText: resultText.trim(), provenance })}\n\n`,
          );
        }
        clearInterval(keepalive);
        responseDone = true;
        res.end();

        // v2.2.0: Post-conversation memory extraction (async, non-blocking)
        if (APP_CONFIG.memory.enabled && resultText) {
          _extractAndStoreMemory(lastUserMsg, resultText).catch(() => {});
        }
      };
      _finalize();
      return;
    }
    clearInterval(keepalive);
    responseDone = true;
    res.end();
  });

  child.on("error", (err) => {
    console.error("[proxy] spawn error:", err);
    res.write(
      `data: ${JSON.stringify({ type: "error", message: `无法启动 claude CLI: ${err.message}` })}\n\n`,
    );
    clearInterval(keepalive);
    responseDone = true;
    res.end();
  });

  res.on("close", () => {
    clearTimeout(cliTimer);
    clearInterval(keepalive);
    clearInterval(_idleTimer);
    _activeChats = Math.max(0, _activeChats - 1);
    if (!responseDone && !child.killed) child.kill();
  });
});

// ── Self-update ──────────────────────────────────────────────

const VERSION_MANIFEST_URL = "https://wps-ai-landing.pages.dev/version.json";
let _updateState = { status: "idle", progress: 0, message: "" };

function setUpdateState(status, progress, message) {
  _updateState = { status, progress, message };
  console.log(`[update] ${status} (${progress}%) ${message}`);
}

app.get("/update-status", (_req, res) => {
  res.json(_updateState);
});

// Capability probe — old proxy versions don't have this endpoint
app.get("/supports-self-update", (_req, res) => {
  res.json({ supported: true, version: "2.2.0" });
});

app.post("/self-update", async (_req, res) => {
  if (_updateState.status === "running") {
    return res.json({ ok: false, error: "Update already in progress" });
  }

  res.json({ ok: true, message: "Update started" });

  try {
    setUpdateState("running", 5, "正在检查最新版本…");

    // 1. Fetch manifest
    const manifestRes = await fetch(VERSION_MANIFEST_URL, {
      cache: "no-store",
    });
    const manifest = await manifestRes.json();
    const { downloadUrl, sha256, version } = manifest;

    if (!downloadUrl || !sha256) {
      return setUpdateState("error", 0, "版本信息不完整，请稍后再试");
    }

    setUpdateState("running", 15, `正在下载 v${version}…`);

    // 2. Download tarball to tmp
    const tmpFile = join(tmpdir(), `claude-wps-update-${Date.now()}.tar.gz`);
    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
    const fileStream = createWriteStream(tmpFile);
    await pipeline(dlRes.body, fileStream);

    setUpdateState("running", 55, "正在校验完整性…");

    // 3. Verify SHA256
    const hash = createHash("sha256");
    hash.update(readFileSync(tmpFile));
    const actual = hash.digest("hex");
    if (actual !== sha256) {
      unlinkSync(tmpFile);
      return setUpdateState("error", 0, `SHA256 校验失败，下载可能已损坏`);
    }

    setUpdateState("running", 65, "正在解压安装…");

    // 4. Extract to a sibling staging dir
    const installDir = dirname(__dirname); // parent of claude-wps-plugin/
    const stageDir = join(installDir, `_update_stage_${Date.now()}`);
    mkdirSync(stageDir, { recursive: true });

    try {
      const { execSync: exec } = await import("child_process");
      exec(`tar -xzf "${tmpFile}" -C "${stageDir}"`);
    } catch (e) {
      rmSync(stageDir, { recursive: true, force: true });
      unlinkSync(tmpFile);
      return setUpdateState("error", 0, `解压失败: ${e.message}`);
    }

    unlinkSync(tmpFile);
    setUpdateState("running", 80, "正在替换文件…");

    // 5. Find extracted dir (should be claude-wps-plugin/)
    const entries = readdirSync(stageDir);
    if (entries.length === 0) {
      rmSync(stageDir, { recursive: true, force: true });
      return setUpdateState("error", 0, "解压内容为空");
    }
    const extractedPlugin = join(stageDir, entries[0]);

    // 6. Swap directories: backup old → move new in
    const pluginDir = __dirname;
    const backupDir = `${pluginDir}_backup_${Date.now()}`;
    renameSync(pluginDir, backupDir);
    renameSync(extractedPlugin, pluginDir);
    rmSync(stageDir, { recursive: true, force: true });

    // Preserve user data: node_modules symlink/copy from backup
    const newModules = join(pluginDir, "node_modules");
    const oldModules = join(backupDir, "node_modules");
    if (!existsSync(newModules) && existsSync(oldModules)) {
      renameSync(oldModules, newModules);
    }

    setUpdateState("running", 90, "正在安装新依赖…");
    try {
      const { execSync: exec2 } = await import("child_process");
      exec2("npm install --omit=dev", { cwd: pluginDir, stdio: "pipe" });
    } catch (_) {
      // non-fatal, existing node_modules may work
    }

    // Clean up backup after successful swap
    try {
      rmSync(backupDir, { recursive: true, force: true });
    } catch (_) {}

    setUpdateState("done", 100, `v${version} 安装成功，正在重启服务…`);

    // 7. Restart self after short delay (let response finish)
    setTimeout(async () => {
      try {
        const { spawn: sp } = await import("child_process");
        const child = sp(
          process.execPath,
          [join(pluginDir, "proxy-server.js")],
          {
            detached: true,
            stdio: "ignore",
            cwd: pluginDir,
            env: { ...process.env },
          },
        );
        child.unref();
      } catch (_) {}
      process.exit(0);
    }, 1500);
  } catch (err) {
    setUpdateState("error", 0, `更新失败: ${err.message}`);
  }
});

// ── Analytics (GA4 Measurement Protocol) ─────────────────────
const GA_MP_URL = "https://www.google-analytics.com/mp/collect";
const GA_ID = process.env.GA_MEASUREMENT_ID ?? "";
const GA_API_SECRET = process.env.GA_API_SECRET ?? "";
const _analyticsClientId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function sendAnalyticsEvent(name, params = {}) {
  if (!GA_ID || !GA_API_SECRET) return;
  try {
    await fetch(
      `${GA_MP_URL}?measurement_id=${GA_ID}&api_secret=${GA_API_SECRET}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: _analyticsClientId,
          events: [{ name, params: { plugin_version: "2.2.0", ...params } }],
        }),
      },
    );
  } catch (_) {}
}

// Track plugin startup
sendAnalyticsEvent("plugin_start");

// Analytics endpoint — frontend can send events through proxy (avoids CORS with GA)
app.post("/analytics", express.json(), (req, res) => {
  const { name, params } = req.body ?? {};
  if (typeof name === "string") sendAnalyticsEvent(name, params ?? {});
  res.json({ ok: true });
});

// SPA fallback 移到所有 API 路由之后（见文件末尾 listen 前）

// ── v2.2.0 模块集成（加法，不修改现有端点）─────────────────────
let _heartbeat = null;
let _triggerEngine = null;

async function initV220Modules() {
  try {
    // Heartbeat
    const hb = await import("./lib/heartbeat.js");
    hb.startHeartbeat();
    _heartbeat = hb;

    // Trigger Engine：扫描 skills/workflows/ 注册定时任务
    const te = await import("./lib/trigger-engine.js");
    const workflowsDir = join(__dirname, "skills", "workflows");
    te.scanAndRegisterWorkflows(workflowsDir);
    _triggerEngine = te;

    console.log("   [v2.2.0] Heartbeat + Trigger Engine 已启动");

    if (USE_DIRECT_API) directApi.warmup();
  } catch (err) {
    console.warn(`   [v2.2.0] 模块初始化警告: ${err.message}`);
  }
}

// v2.2.0 工作流 API 端点 ──────────────────────────────────────
app.post("/workflow/start", async (req, res) => {
  const { name, inputs = {} } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!_triggerEngine)
    return res.status(503).json({ error: "Trigger engine not ready" });

  const events = [];
  try {
    const result = await _triggerEngine.fireTrigger(name, inputs, (evt) =>
      events.push(evt),
    );
    res.json({ ok: true, ...result, events });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/workflow/status/:runId", async (req, res) => {
  const { getRunStatus } = await import("./lib/workflow-engine.js");
  const status = getRunStatus(req.params.runId);
  if (!status) return res.status(404).json({ error: "Run not found" });
  res.json(status);
});

app.post("/workflow/abort/:runId", async (req, res) => {
  const { abortWorkflow } = await import("./lib/workflow-engine.js");
  const ok = abortWorkflow(req.params.runId);
  res.json({ ok });
});

app.get("/triggers", (_req, res) => {
  if (!_triggerEngine) return res.json([]);
  res.json(_triggerEngine.listTriggers());
});

app.post("/trigger/:name", async (req, res) => {
  const { name } = req.params;
  const inputs = req.body || {};
  if (!_triggerEngine)
    return res.status(503).json({ error: "Trigger engine not ready" });
  try {
    const result = await _triggerEngine.fireTrigger(name, inputs);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 增强版 /health：追加心跳状态（不覆盖原路由，改为 /health/v2）
app.get("/health/v2", (_req, res) => {
  const base = {
    status: "ok",
    version: "2.2.0",
    skills: ALL_SKILLS.size,
    modes: ALL_MODES.size,
    workflows: ALL_WORKFLOWS.size,
    features: [
      "heartbeat",
      "workflow-engine",
      "trigger-engine",
      "action-registry",
      "channels",
      "finance-cache-1h",
      "skill-weight-scoring",
    ],
  };
  const heartbeatStatus = _heartbeat
    ? _heartbeat.getStatus()
    : { status: "not-started" };
  const triggers = _triggerEngine ? _triggerEngine.listTriggers() : [];
  res.json({ ...base, heartbeat: heartbeatStatus, triggers });
});

// Action Registry 端点
// ── v2.4: MCP 代理调用端点 ─────────────────────────────────
app.post("/mcp/call", async (req, res) => {
  const { server, tool, arguments: toolArgs = {} } = req.body || {};
  if (!server || !tool) {
    return res
      .status(400)
      .json({ ok: false, error: "server and tool are required" });
  }
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("mcp.call", {
      server,
      tool,
      arguments: toolArgs,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/mcp/servers", async (_req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("mcp.list", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/mcp/configure", async (req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("mcp.configure", req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── v2.5: Self-Provisioning — 自治补全 API ───────────────────
app.post("/provision/check", async (req, res) => {
  const { capability } = req.body || {};
  if (!capability)
    return res.status(400).json({ ok: false, error: "capability is required" });
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("provision.check", { capability });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/provision/resolve", async (req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("provision.resolve", req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/provision/resolve-workflow", async (req, res) => {
  const { workflow, autoInstall = true, secrets = {} } = req.body || {};
  if (!workflow)
    return res.status(400).json({ ok: false, error: "workflow is required" });
  try {
    const { resolveWorkflowCapabilities } =
      await import("./lib/capability-resolver.js");
    const result = await resolveWorkflowCapabilities(workflow, {
      autoInstall,
      secrets,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/provision/oauth", async (req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("provision.oauth", req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/provision/api-key", async (req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("provision.apiKey", req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/provision/recipes", async (_req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("provision.listRecipes", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/provision/env", async (_req, res) => {
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction("terminal.checkEnv", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/actions", async (_req, res) => {
  const { listActions } = await import("./lib/action-registry.js");
  res.json({ actions: listActions() });
});

app.post("/action/execute", async (req, res) => {
  const { action, params = {} } = req.body || {};
  if (!action) return res.status(400).json({ error: "action is required" });
  try {
    const { executeAction } = await import("./lib/action-registry.js");
    const result = await executeAction(action, params);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── v2.4: Long Task API — 后台长任务执行 + SSE 进度推送 ─────────
app.post("/long-task/start", async (req, res) => {
  const { action, params = {}, workflow, inputs } = req.body || {};
  const ltm = await import("./lib/long-task-manager.js");

  if (workflow) {
    const { loadWorkflowFromFile } = await import("./lib/workflow-engine.js");
    try {
      const wf = loadWorkflowFromFile(workflow);
      const { taskId } = ltm.startWorkflowTask(wf, inputs || {});
      return res.json({ ok: true, taskId });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  if (!action)
    return res.status(400).json({ error: "action or workflow is required" });
  const { taskId } = ltm.startActionTask(action, params);
  res.json({ ok: true, taskId });
});

app.get("/long-task/status/:taskId", async (req, res) => {
  const ltm = await import("./lib/long-task-manager.js");
  const status = ltm.getTaskStatus(req.params.taskId);
  if (!status) return res.status(404).json({ error: "Task not found" });
  res.json(status);
});

app.get("/long-task/events/:taskId", async (req, res) => {
  const ltm = await import("./lib/long-task-manager.js");
  const taskId = req.params.taskId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const unsubscribe = ltm.subscribe(taskId, (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
    if (
      evt.type === "task.done" ||
      evt.type === "task.error" ||
      evt.type === "task.aborted"
    ) {
      setTimeout(() => res.end(), 500);
    }
  });

  if (!unsubscribe) {
    res.write(
      `data: ${JSON.stringify({ type: "error", message: "Task not found" })}\n\n`,
    );
    return res.end();
  }

  req.on("close", () => {
    if (unsubscribe) unsubscribe();
  });
});

app.post("/long-task/abort/:taskId", async (req, res) => {
  const ltm = await import("./lib/long-task-manager.js");
  const ok = ltm.abortTask(req.params.taskId);
  res.json({ ok });
});

app.get("/long-task/list", async (_req, res) => {
  const ltm = await import("./lib/long-task-manager.js");
  res.json({ tasks: ltm.listTasks() });
});

// ── v2.6: Local Computer Access — 本地计算机操作 API ────────────

app.get("/local/permissions", async (_req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const result = await perms.checkAllPermissions();
  res.json({ ok: true, permissions: result });
});

app.post("/local/permissions/check", async (req, res) => {
  const { capability } = req.body;
  if (!capability)
    return res.status(400).json({ error: "capability required" });
  const perms = await import("./lib/local-permissions.js");
  const result = await perms.checkPermission(capability);
  res.json({ ok: true, ...result });
});

app.post("/local/permissions/request", async (req, res) => {
  const { capability } = req.body;
  if (!capability)
    return res.status(400).json({ error: "capability required" });
  const perms = await import("./lib/local-permissions.js");
  const result = await perms.requestPermission(capability);
  res.json(result);
});

app.get("/local/permissions/list", async (_req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const known = perms.listKnownPermissions();
  res.json({ ok: true, permissions: known });
});

app.post("/local/calendar/list", async (req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const guard = await perms.guardLocalAction("local.calendar.list");
  if (!guard.allowed)
    return res
      .status(403)
      .json({ ok: false, error: "permission_required", ...guard });

  const { executeAction } = await import("./lib/action-registry.js");
  const result = await executeAction("local.calendar.list", req.body);
  res.json(result);
});

app.post("/local/calendar/create", async (req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const guard = await perms.guardLocalAction("local.calendar.create");
  if (!guard.allowed)
    return res
      .status(403)
      .json({ ok: false, error: "permission_required", ...guard });

  const { executeAction } = await import("./lib/action-registry.js");
  const result = await executeAction("local.calendar.create", req.body);
  res.json(result);
});

app.post("/local/contacts/search", async (req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const guard = await perms.guardLocalAction("local.contacts.search");
  if (!guard.allowed)
    return res
      .status(403)
      .json({ ok: false, error: "permission_required", ...guard });

  const { executeAction } = await import("./lib/action-registry.js");
  const result = await executeAction("local.contacts.search", req.body);
  res.json(result);
});

app.post("/local/mail/send", async (req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const guard = await perms.guardLocalAction("local.mail.send");
  if (!guard.allowed)
    return res
      .status(403)
      .json({ ok: false, error: "permission_required", ...guard });

  const { executeAction } = await import("./lib/action-registry.js");
  const result = await executeAction("local.mail.send", req.body);
  res.json(result);
});

app.post("/local/mail/unread", async (req, res) => {
  const perms = await import("./lib/local-permissions.js");
  const guard = await perms.guardLocalAction("local.mail.unread");
  if (!guard.allowed)
    return res
      .status(403)
      .json({ ok: false, error: "permission_required", ...guard });

  const { executeAction } = await import("./lib/action-registry.js");
  const result = await executeAction("local.mail.unread", req.body);
  res.json(result);
});

app.post("/local/action", async (req, res) => {
  const { action, params = {} } = req.body;
  if (!action || !action.startsWith("local.")) {
    return res.status(400).json({ error: "action must start with 'local.'" });
  }

  const perms = await import("./lib/local-permissions.js");
  const guard = await perms.guardLocalAction(action);
  if (!guard.allowed)
    return res
      .status(403)
      .json({ ok: false, error: "permission_required", ...guard });

  const { executeAction } = await import("./lib/action-registry.js");
  const result = await executeAction(action, params);
  res.json(result);
});

// ── SPA fallback（必须在所有 API 路由之后）──────────────────────
if (existsSync(distPath)) {
  app.get("/{*path}", (req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
}

connectorRegistry.load().then(() => {
  console.log(`[connector-registry] Ready (${connectorRegistry.size} connectors)`);
  const importResult = importCredentials(connectorRegistry);
  if (importResult.imported.length > 0) {
    console.log(`[credential-importer] Auto-imported ${importResult.imported.length} credentials on startup`);
  }
}).catch((err) => {
  console.error("[connector-registry] Init failed:", err.message);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n✅ WPS Claude 代理服务器 v2.6.0 已启动`);
  console.log(`   地址: http://127.0.0.1:${PORT}`);
  console.log(`   健康检查: http://127.0.0.1:${PORT}/health`);
  if (existsSync(distPath)) {
    console.log(`   前端: http://127.0.0.1:${PORT}/ (dist 静态文件)`);
  }
  console.log(`   代码执行桥: /execute-code, /pending-code, /code-result`);
  console.log(`   工作流 API: /workflow/start, /triggers, /trigger/:name`);
  console.log(`   长任务 API: /long-task/start, /long-task/events/:id (SSE)`);
  console.log(`   MCP 桥接:   /mcp/call, /mcp/servers, /mcp/configure`);
  console.log(
    `   自治补全:   /provision/check, /provision/resolve, /provision/env`,
  );
  console.log(
    `   本地操作:   /local/permissions, /local/calendar/*, /local/mail/*`,
  );
  console.log(`   动作 API:   /actions, /action/execute\n`);

  // 异步初始化 v2.2.0 模块（不阻塞启动）
  initV220Modules();
});

// 防止未捕获异常/未处理 Promise 拒绝导致进程崩溃
process.on("uncaughtException", (err) => {
  console.error(`[crash-guard] uncaughtException: ${err.message}`);
  console.error(err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[crash-guard] unhandledRejection:`, reason);
});
