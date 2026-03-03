/**
 * terminal.* — 终端执行能力
 *
 * 赋予 Agent 直接运行 shell 命令的能力，
 * 用于自动安装 npm/pip 包、克隆仓库、配置环境等 Self-Provisioning 场景。
 *
 * 安全边界:
 *   - 默认白名单模式 + 用户确认
 *   - 危险命令拦截（rm -rf /, sudo 等）
 *   - 执行日志完整记录
 *   - 超时保护
 */

import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync, appendFileSync, mkdirSync } from "fs";

const LOG_DIR = join(homedir(), ".claude-wps", "logs");
const TERMINAL_LOG = join(LOG_DIR, "terminal.log");

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+\//,
  /mkfs\./,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /chmod\s+777\s+\//,
  /:(){ :\|:& };:/,
];

const SAFE_COMMAND_PREFIXES = [
  "npm install",
  "npm i ",
  "npm ci",
  "npm list",
  "npm ls",
  "npm view",
  "npx ",
  "pip install",
  "pip3 install",
  "pip list",
  "pip show",
  "python -m pip",
  "python3 -m pip",
  "brew install",
  "brew list",
  "brew info",
  "git clone",
  "git pull",
  "git status",
  "git log",
  "node ",
  "python ",
  "python3 ",
  "which ",
  "where ",
  "type ",
  "ls ",
  "cat ",
  "head ",
  "tail ",
  "wc ",
  "echo ",
  "printenv",
  "env ",
  "curl ",
  "wget ",
  "mkdir ",
  "touch ",
  "docker ",
  "docker-compose ",
  "hostname",
  "whoami",
  "uptime",
  "pmset ",
  "df ",
  "pbpaste",
  "pbcopy",
  "screencapture ",
  "osascript ",
  "open ",
  "say ",
  "defaults read",
];

function isDangerous(cmd) {
  return DANGEROUS_PATTERNS.some((p) => p.test(cmd));
}

function isSafeCommand(cmd) {
  const trimmed = cmd.trim();
  return SAFE_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function logExecution(entry) {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`;
  appendFileSync(TERMINAL_LOG, line, "utf-8");
}

function execCommand(command, options = {}) {
  const { cwd = process.cwd(), timeout = 60000, env: extraEnv = {} } = options;

  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, ...extraEnv },
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.on("error", (err) => {
      reject(new Error(`Spawn failed: ${err.message}`));
    });
  });
}

export const terminalActions = {
  /**
   * terminal.exec — 执行 shell 命令
   *
   * params:
   *   command:      要执行的命令
   *   cwd:          工作目录（默认当前目录）
   *   timeout:      超时（ms，默认 60000）
   *   env:          额外环境变量
   *   requireSafe:  是否要求白名单命令（默认 true）
   */
  "terminal.exec": async ({
    command,
    cwd,
    timeout = 60000,
    env,
    requireSafe = true,
    onProgress,
  }) => {
    if (!command) throw new Error("command is required");

    if (isDangerous(command)) {
      logExecution({ command, status: "BLOCKED", reason: "dangerous pattern" });
      throw new Error(`危险命令已拦截: ${command}`);
    }

    if (requireSafe && !isSafeCommand(command)) {
      logExecution({ command, status: "BLOCKED", reason: "not in safe list" });
      throw new Error(
        `命令不在安全白名单中: "${command}". 设置 requireSafe: false 可强制执行（需用户确认）`,
      );
    }

    if (onProgress) onProgress({ phase: "executing", message: `$ ${command}` });
    logExecution({ command, cwd, status: "STARTED" });

    const result = await execCommand(command, { cwd, timeout, env });

    logExecution({
      command,
      status: result.code === 0 ? "SUCCESS" : "FAILED",
      exitCode: result.code,
    });
    if (onProgress)
      onProgress({ phase: "done", message: `exit code: ${result.code}` });

    return {
      ok: result.code === 0,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },

  /**
   * terminal.npmInstall — 安装 npm 包
   *
   * params:
   *   packages:  包名数组，如 ['express', 'cors@2']
   *   dev:       是否装 devDependencies（默认 false）
   *   global:    是否全局安装（默认 false）
   *   cwd:       项目目录
   */
  "terminal.npmInstall": async ({
    packages = [],
    dev = false,
    global: isGlobal = false,
    cwd,
    onProgress,
  }) => {
    if (!packages.length) throw new Error("packages array is required");

    const flags = [dev ? "--save-dev" : "", isGlobal ? "-g" : ""]
      .filter(Boolean)
      .join(" ");

    const cmd = `npm install ${packages.join(" ")} ${flags}`.trim();
    if (onProgress)
      onProgress({
        phase: "installing",
        message: `npm: ${packages.join(", ")}`,
      });

    const result = await execCommand(cmd, { cwd, timeout: 120000 });
    logExecution({
      action: "npmInstall",
      packages,
      status: result.code === 0 ? "SUCCESS" : "FAILED",
    });

    return {
      ok: result.code === 0,
      packages,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },

  /**
   * terminal.pipInstall — 安装 Python 包
   *
   * params:
   *   packages:  包名数组
   *   cwd:       工作目录
   */
  "terminal.pipInstall": async ({ packages = [], cwd, onProgress }) => {
    if (!packages.length) throw new Error("packages array is required");

    const cmd = `pip3 install ${packages.join(" ")}`;
    if (onProgress)
      onProgress({
        phase: "installing",
        message: `pip: ${packages.join(", ")}`,
      });

    const result = await execCommand(cmd, { cwd, timeout: 120000 });
    logExecution({
      action: "pipInstall",
      packages,
      status: result.code === 0 ? "SUCCESS" : "FAILED",
    });

    return {
      ok: result.code === 0,
      packages,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },

  /**
   * terminal.which — 检查命令是否可用
   *
   * params:
   *   command:  要检查的命令名
   */
  "terminal.which": async ({ command: cmd }) => {
    if (!cmd) throw new Error("command is required");
    const result = await execCommand(`which ${cmd}`, { timeout: 5000 });
    return {
      ok: result.code === 0,
      available: result.code === 0,
      path: result.stdout || null,
    };
  },

  /**
   * terminal.checkEnv — 检查运行环境
   * 返回 node/npm/python/pip/git 等工具的可用性和版本
   */
  "terminal.checkEnv": async () => {
    const tools = [
      "node",
      "npm",
      "npx",
      "python3",
      "pip3",
      "git",
      "docker",
      "brew",
    ];
    const results = {};

    for (const tool of tools) {
      try {
        const w = await execCommand(`which ${tool}`, { timeout: 3000 });
        if (w.code === 0) {
          const v = await execCommand(`${tool} --version`, { timeout: 5000 });
          results[tool] = {
            available: true,
            path: w.stdout,
            version: v.stdout,
          };
        } else {
          results[tool] = { available: false };
        }
      } catch {
        results[tool] = { available: false };
      }
    }

    return { ok: true, environment: results };
  },
};
