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
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function matchSkills(allSkills, userMessage) {
  const matched = [];
  for (const [id, skill] of allSkills) {
    const ctx = skill.context || {};
    if (ctx.always === true || ctx.always === "true") {
      matched.push(skill);
      continue;
    }
    if (Array.isArray(ctx.keywords)) {
      const msg = userMessage.toLowerCase();
      if (ctx.keywords.some((kw) => msg.includes(kw.toLowerCase()))) {
        matched.push(skill);
      }
    }
  }
  return matched;
}

function buildSystemPrompt(skills, todayStr) {
  let prompt = `你是 Claude，嵌入在 WPS Office Excel 中的 AI 数据处理助手。你的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API。\n今天的日期是 ${todayStr}。当用户询问"最近/近期"数据时，以今天为基准。\n\n`;

  for (const skill of skills) {
    prompt += skill.body + "\n\n";
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

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

// ── 系统剪贴板读取（macOS pbpaste）───────────────────────────
app.get("/clipboard", (req, res) => {
  try {
    const text = execSync("pbpaste", {
      encoding: "utf-8",
      timeout: 2000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LANG: "en_US.UTF-8" },
    });
    res.json({ ok: true, text });
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

// ── WPS 上下文中转 ─────────────────────────────────────────
let _wpsContext = {
  workbookName: "",
  sheetNames: [],
  selection: null,
  usedRange: null,
  timestamp: 0,
};

app.post("/wps-context", (req, res) => {
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
  let fullPrompt = buildSystemPrompt(matchedSkills, todayStr) + "\n";

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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n✅ WPS Claude 代理服务器已启动`);
  console.log(`   地址: http://127.0.0.1:${PORT}`);
  console.log(`   健康检查: http://127.0.0.1:${PORT}/health`);
  console.log(`   代码执行桥: /execute-code, /pending-code, /code-result\n`);
});
