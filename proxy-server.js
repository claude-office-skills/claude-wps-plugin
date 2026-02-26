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

const __dirname = dirname(fileURLToPath(import.meta.url));

function isPathSafe(filePath, allowedDir) {
  const resolved = resolve(filePath);
  const allowed = resolve(allowedDir);
  return resolved.startsWith(allowed + "/") || resolved === allowed;
}

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

// ── Skill Loader ──────────────────────────────────────────────
function loadSkills() {
  const skillsDir = join(__dirname, "skills", "bundled");
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

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm = {};
  let currentKey = null;
  let currentIndent = 0;

  for (const line of match[1].split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const [, key, val] = kvMatch;
      if (val.startsWith("[") && val.endsWith("]")) {
        fm[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim());
      } else if (val === "" || val === undefined) {
        fm[key] = {};
        currentKey = key;
        currentIndent = 0;
      } else {
        fm[key] = val;
      }
    } else if (currentKey && line.startsWith("  ")) {
      const nested = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
      if (nested) {
        const [, nk, nv] = nested;
        if (typeof fm[currentKey] !== "object") fm[currentKey] = {};
        if (nv.startsWith("[") && nv.endsWith("]")) {
          fm[currentKey][nk] = nv
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim());
        } else if (nv === "true") {
          fm[currentKey][nk] = true;
        } else if (nv === "false") {
          fm[currentKey][nk] = false;
        } else {
          fm[currentKey][nk] = nv;
        }
      }
    }
  }

  return { frontmatter: fm, body: match[2].trim() };
}

function matchSkills(allSkills, userMessage, wpsContext) {
  const matched = [];
  for (const [id, skill] of allSkills) {
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

function buildSystemPrompt(skills, todayStr, userMessage) {
  let prompt = `你是 Claude，嵌入在 WPS Office Excel 中的 AI 数据处理助手。你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。\n今天的日期是 ${todayStr}。当用户询问"最近/近期"数据时，以今天为基准。

## ⚠️ 上下文优先级（最重要）
每次请求都会附带「当前 Excel 上下文」，其中包含当前活动工作表名称和选区信息。
- 你必须**只关注当前活动工作表**，忽略对话历史中提到的其他工作表
- 如果用户切换了工作表，以最新上下文中的表名为准
- 生成的代码必须操作当前活动工作表，不要引用历史对话中的旧表名

## ⚠️ 代码长度限制（必须遵守）
你生成的 JavaScript 代码总长度必须控制在 3000 字符以内。超长代码会被截断导致语法错误！
- 生成超过 20 行数据时，必须用「小数组 + for 循环 + Math.random()」随机组合生成
- 绝对禁止硬编码大量数据行（如手动写 100+ 行数组）
- 使用 ws.Range().Value2 批量写入（二维数组一次写多行），避免逐行写入

## ⚠️ 始终使用 ActiveSheet（必须遵守）
操作当前表时，必须用 var ws = Application.ActiveSheet; 绝对不要用 wb.Sheets.Item("表名") 硬编码 sheet 名称（用户可能已重命名 sheet，会导致操作错误的表或报错）。

\n`;

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
console.log(
  `[skill-loader] 已加载 ${ALL_SKILLS.size} 个 bundled skills: ${[...ALL_SKILLS.keys()].join(", ")}`,
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

app.use(
  cors({
    origin: [
      "http://127.0.0.1:3001",
      "http://localhost:3001",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ],
  }),
);
app.use(express.json({ limit: "50mb" }));

const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

const wpsAddonPath = join(__dirname, "wps-addon");
if (existsSync(wpsAddonPath)) {
  app.use("/wps-addon", express.static(wpsAddonPath));
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
    version: "1.1.0",
    skills: ALL_SKILLS.size,
    commands: ALL_COMMANDS.length,
    skillNames: [...ALL_SKILLS.keys()],
  });
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
let _codeQueue = [];
let _codeResults = {};
let _codeIdCounter = 0;

app.post("/execute-code", (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code 不能为空" });

  const id = `exec-${++_codeIdCounter}-${Date.now()}`;
  _codeQueue.push({ id, code, submittedAt: Date.now() });
  res.json({ ok: true, id });
});

app.get("/pending-code", (req, res) => {
  if (_codeQueue.length === 0) {
    return res.json({ pending: false });
  }
  const item = _codeQueue.shift();
  res.json({ pending: true, ...item });
});

app.post("/code-result", (req, res) => {
  const { id, result, error } = req.body;
  if (!id) return res.status(400).json({ error: "id 不能为空" });

  _codeResults[id] = {
    result: result ?? null,
    error: error ?? null,
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

// ── 模型白名单 ──────────────────────────────────────────────
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
]);

// ── 聊天接口（SSE 流式响应）──────────────────────────────────
app.post("/chat", (req, res) => {
  const { messages, context, model, attachments, webSearch } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages 不能为空" });
  }

  const selectedModel = ALLOWED_MODELS.has(model) ? model : "claude-sonnet-4-6";

  const lastUserMsg = messages[messages.length - 1]?.content || "";
  const todayStr = new Date().toISOString().split("T")[0];
  const matchedSkills = matchSkills(ALL_SKILLS, lastUserMsg);
  let fullPrompt =
    buildSystemPrompt(matchedSkills, todayStr, lastUserMsg) + "\n";

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
  res.flushHeaders();

  // SSE keepalive: prevent browser/WebView timeout during CLI startup
  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }
  }, 5000);

  const claudePath = process.env.CLAUDE_PATH || "claude";
  const cliArgs = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--max-turns",
    "5",
    "--model",
    selectedModel,
  ];

  if (webSearch) {
    cliArgs.push("--allowedTools", "WebSearch");
  }
  const child = spawn(claudePath, cliArgs, { env: { ...process.env } });

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
        } else if (evt.type === "result" && evt.result) {
          resultText = evt.result;
        }
      } catch {
        // non-JSON line — ignore system/verbose output
      }
    }
  });

  child.stderr.on("data", (data) => {
    console.error("[proxy] stderr:", data.toString().trim());
  });

  child.on("close", (code, signal) => {
    if (code !== 0 && !resultText) {
      res.write(
        `data: ${JSON.stringify({ type: "error", message: `claude CLI 退出 (code=${code}, signal=${signal})，请确认已登录：运行 claude 命令` })}\n\n`,
      );
    } else {
      res.write(
        `data: ${JSON.stringify({ type: "done", fullText: resultText.trim() })}\n\n`,
      );
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
