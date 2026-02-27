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
import { spawn, execSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const yaml = require("js-yaml");

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function matchSkills(allSkills, userMessage, wpsContext, mode) {
  const matched = [];
  for (const [id, skill] of allSkills) {
    if (mode && Array.isArray(skill.modes) && !skill.modes.includes(mode)) {
      continue;
    }

    const ctx = skill.context || {};
    if (ctx.always === true || ctx.always === "true") {
      matched.push(skill);
      continue;
    }
    let keywordHit = false;
    if (Array.isArray(ctx.keywords)) {
      const msg = userMessage.toLowerCase();
      if (ctx.keywords.some((kw) => msg.includes(kw.toLowerCase()))) {
        keywordHit = true;
      }
    }
    let contextHit = false;
    if (wpsContext && wpsContext.selection) {
      const sel = wpsContext.selection;
      if (
        (ctx.hasEmptyCells === true || ctx.hasEmptyCells === "true") &&
        sel.emptyCellCount > 0
      )
        contextHit = true;
      if (
        (ctx.hasFormulas === true || ctx.hasFormulas === "true") &&
        sel.hasFormulas
      )
        contextHit = true;
      if (ctx.minRows && sel.rowCount >= Number(ctx.minRows)) contextHit = true;
    }
    if (keywordHit || contextHit) {
      matched.push(skill);
    }
  }
  return matched;
}

const CHART_STYLE_OVERRIDE = `
## 图表创建（关键！请严格遵守）

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
    var s = chart.SeriesCollection(idx);
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

function buildSystemPrompt(skills, todayStr, userMessage, modeSkill) {
  let prompt = `你是 Claude，嵌入在 WPS Office Excel 中的 AI 数据处理助手。你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。\n今天的日期是 ${todayStr}。当用户询问"最近/近期"数据时，以今天为基准。

## ⚠️ 上下文优先级（最重要）
每次请求都会附带「当前 Excel 上下文」，其中包含当前活动工作表名称和选区信息。
- 你必须**只关注当前活动工作表**，忽略对话历史中提到的其他工作表
- 如果用户切换了工作表，以最新上下文中的表名为准
- 生成的代码必须操作当前活动工作表，不要引用历史对话中的旧表名

## ⚠️ 代码生成要求（必须遵守）
- 代码必须是一个完整的、可独立执行的 JavaScript 块
- 生成超过 20 行数据时，优先用 for 循环 + 数组 生成，避免逐行硬编码
- 禁止生成超过 200 行的代码，优先简化设计
- 代码最后一行必须是一个返回值字符串（如 "已完成"）

## ⚠️ 始终使用 ActiveSheet（必须遵守）
操作当前表时，必须用 var ws = Application.ActiveSheet; 绝对不要用 wb.Sheets.Item("表名") 硬编码 sheet 名称（用户可能已重命名 sheet，会导致操作错误的表或报错）。

## ⚠️ 字体颜色规则（必须遵守）
设置单元格背景色（Interior.Color）时，**必须同时设置对比鲜明的字体颜色**（Font.Color），否则文字会因颜色与背景相同而"隐身"。
- 深色背景 → 白色字体：ws.Range("A1").Font.Color = RGB(255,255,255)
- 浅色背景 → 黑色字体：ws.Range("A1").Font.Color = RGB(0,0,0)
- **绝对禁止**只设 Interior.Color 不设 Font.Color
- 先写入数据（Value2），再设置格式（Font.Color、Interior.Color）

\n`;

  if (modeSkill && modeSkill.body) {
    prompt += modeSkill.body + "\n\n";
  }

  for (const skill of skills) {
    prompt += skill.body + "\n\n";
  }

  const chartKw =
    /图表|折线|柱状|饼图|chart|趋势图|走势图|可视化|visualization|图形|数据图/i;
  if (userMessage && chartKw.test(userMessage)) {
    prompt += CHART_STYLE_OVERRIDE + "\n\n";
  }

  return prompt;
}

const ALL_SKILLS = loadSkills();
const ALL_MODES = loadSkillsFromDir("modes");
const ALL_CONNECTORS = loadSkillsFromDir("connectors");
const ALL_WORKFLOWS = loadSkillsFromDir("workflows");

console.log(
  `[skill-loader] bundled: ${ALL_SKILLS.size} (${[...ALL_SKILLS.keys()].join(", ")})`,
);
console.log(
  `[skill-loader] modes: ${ALL_MODES.size} (${[...ALL_MODES.keys()].join(", ")})`,
);
console.log(
  `[skill-loader] connectors: ${ALL_CONNECTORS.size}, workflows: ${ALL_WORKFLOWS.size}`,
);

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
const PORT = 3001;

const ALLOWED_ORIGINS = [
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
    const data = await parser.getText();
    const text = data.text || "";
    const pages = data.total || data.pages?.length || 0;

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

// 健康检查
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "2.0.0",
    skills: ALL_SKILLS.size,
    modes: ALL_MODES.size,
    connectors: ALL_CONNECTORS.size,
    workflows: ALL_WORKFLOWS.size,
    commands: ALL_COMMANDS.length,
    skillNames: [...ALL_SKILLS.keys()],
    modeNames: [...ALL_MODES.keys()],
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

app.post("/execute-code", (req, res) => {
  const { code, agentId } = req.body;
  if (!code) return res.status(400).json({ error: "code 不能为空" });

  if (_codeQueue.length >= CODE_QUEUE_MAX) {
    return res.status(429).json({ error: "代码执行队列已满，请稍后重试" });
  }

  const parentId = `exec-${++_codeIdCounter}-${Date.now()}`;

  const cleanCode = code.replace(/\/\/\s*---ROW---/g, "");
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

// ── 模型白名单 ──────────────────────────────────────────────
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "claude-haiku-4-5",
]);

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
let _lastChatTime = 0;
const CHAT_MIN_INTERVAL_MS = 300;

// ── 聊天接口（SSE 流式响应）──────────────────────────────────
app.post("/chat", (req, res) => {
  const now = Date.now();
  if (_activeChats >= CHAT_CONCURRENCY_MAX) {
    return res.status(429).json({ error: "当前并发请求过多，请稍后重试" });
  }
  if (now - _lastChatTime < CHAT_MIN_INTERVAL_MS) {
    return res.status(429).json({ error: "请求过于频繁，请稍后重试" });
  }
  _lastChatTime = now;
  _activeChats++;
  const { messages, context, model, attachments, webSearch, mode } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages 不能为空" });
  }

  const selectedModel = ALLOWED_MODELS.has(model) ? model : "claude-sonnet-4-6";

  const currentMode = mode || "agent";
  const modeSkill = ALL_MODES.get(currentMode) || ALL_MODES.get("agent");
  const enforcement = modeSkill?.enforcement || {};
  const skipCodeBridge =
    enforcement.codeBridge === false || enforcement.codeBridge === "false";

  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const todayStr = new Date().toISOString().split("T")[0];
  const matchedSkills = matchSkills(ALL_SKILLS, lastUserMsg, null, currentMode);

  const matchedConnectors = matchSkills(
    ALL_CONNECTORS,
    lastUserMsg,
    null,
    currentMode,
  );
  const allMatched = [...matchedSkills, ...matchedConnectors];

  let fullPrompt =
    buildSystemPrompt(allMatched, todayStr, lastUserMsg, modeSkill) + "\n";

  const memory = loadMemory();
  if (memory.preferences && Object.keys(memory.preferences).length > 0) {
    fullPrompt += `[用户偏好记忆]\n`;
    for (const [k, v] of Object.entries(memory.preferences)) {
      fullPrompt += `- ${k}: ${v}\n`;
    }
    fullPrompt += "\n";
  }

  if (context) {
    fullPrompt += `[当前 Excel 上下文]\n${context}\n\n`;
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
  res.flushHeaders();

  // SSE keepalive: prevent browser/WebView timeout during CLI startup
  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }
  }, 5000);

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
    maxTurns,
    "--model",
    selectedModel,
  ];

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
    "CLAUDE_PATH",
    "ANTHROPIC_API_KEY",
  ];
  const cleanEnv = {};
  for (const key of ENV_WHITELIST) {
    if (process.env[key]) cleanEnv[key] = process.env[key];
  }
  const child = spawn(claudePath, cliArgs, { env: cleanEnv });

  res.write(
    `data: ${JSON.stringify({ type: "mode", mode: currentMode, enforcement })}\n\n`,
  );

  child.stdin.write(fullPrompt);
  child.stdin.end();

  let resultText = "";
  let responseDone = false;
  let _lineBuf = "";
  let _tokenCount = 0;
  let _thinkingText = "";
  const _streamStartTime = Date.now();
  let _firstTokenTime = 0;
  let _firstThinkTime = 0;

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

  child.stdout.on("data", (data) => {
    _lineBuf += data.toString();
    const lines = _lineBuf.split("\n");
    _lineBuf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const evt = JSON.parse(line);

        if (evt.type === "stream_event") {
          const se = evt.event;
          if (se.type === "content_block_delta") {
            if (se.delta?.type === "text_delta" && se.delta.text) {
              if (!_firstTokenTime) _firstTokenTime = Date.now();
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
              _thinkingText += se.delta.thinking;
              res.write(
                `data: ${JSON.stringify({ type: "thinking", text: se.delta.thinking })}\n\n`,
              );
            }
          }
        } else if (evt.type === "assistant" && evt.message?.content) {
          if (!_firstTokenTime) _firstTokenTime = Date.now();
          for (const block of evt.message.content) {
            if (block.type === "thinking" && block.thinking) {
              _thinkingText += block.thinking;
              _enqueueText(block.thinking, "thinking");
            } else if (block.type === "text" && block.text) {
              resultText += block.text;
              _enqueueText(block.text, "token");
            }
          }
        } else if (evt.type === "result") {
          const rt =
            typeof evt.result === "string"
              ? evt.result
              : evt.result?.text || "";
          if (rt && !resultText) resultText = rt;
        }
      } catch {
        // non-JSON line — ignore
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
            `data: ${JSON.stringify({ type: "done", fullText: resultText.trim() })}\n\n`,
          );
        }
        clearInterval(keepalive);
        responseDone = true;
        res.end();
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
    clearInterval(keepalive);
    _activeChats = Math.max(0, _activeChats - 1);
    if (!responseDone && !child.killed) child.kill();
  });
});

if (existsSync(distPath)) {
  app.get("/{*path}", (req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n✅ WPS Claude 代理服务器已启动`);
  console.log(`   地址: http://127.0.0.1:${PORT}`);
  console.log(`   健康检查: http://127.0.0.1:${PORT}/health`);
  if (existsSync(distPath)) {
    console.log(`   前端: http://127.0.0.1:${PORT}/ (dist 静态文件)`);
  }
  console.log(`   代码执行桥: /execute-code, /pending-code, /code-result\n`);
});
