/**
 * system.* — 系统级动作（macOS/WPS 跨 App 操作）
 *
 * 安全白名单控制：只允许执行明确允许的命令前缀
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 允许的命令白名单（前缀匹配）
const ALLOWED_COMMANDS = [
  'open ',
  'osascript ',
  'defaults read',
  'defaults write',
  'ls ',
  'mkdir ',
  'cp ',
  'mv ',
  'echo ',
  'cat ',
  'say ',
];

function isAllowed(cmd) {
  return ALLOWED_COMMANDS.some(prefix => cmd.trimStart().startsWith(prefix));
}

export const systemActions = {
  /**
   * system.run — 执行白名单 shell 命令
   * params: { command: string, timeout?: number }
   */
  'system.run': async ({ command, timeout = 30000 }) => {
    if (!command) throw new Error('command is required');
    if (!isAllowed(command)) {
      throw new Error(`Command not in whitelist: "${command}"`);
    }
    const { stdout, stderr } = await execAsync(command, { timeout });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  },

  /**
   * system.openFile — 用默认 App 打开文件
   * params: { path: string }
   */
  'system.openFile': async ({ path: filePath }) => {
    if (!filePath) throw new Error('path is required');
    const { stdout } = await execAsync(`open "${filePath}"`);
    return { ok: true, stdout };
  },

  /**
   * system.screenshot — 截图到指定路径
   * params: { output?: string }
   */
  'system.screenshot': async ({ output = '/tmp/screenshot.png' }) => {
    await execAsync(`screencapture -x "${output}"`);
    return { ok: true, path: output };
  },

  /**
   * system.notify — macOS 系统通知
   * params: { title: string, message: string, sound?: string }
   */
  'system.notify': async ({ title = 'Claude for WPS', message = '', sound = 'default' }) => {
    const safeTitle = title.replace(/"/g, '\\"');
    const safeMsg = message.replace(/"/g, '\\"');
    const script = `display notification "${safeMsg}" with title "${safeTitle}" sound name "${sound}"`;
    await execAsync(`osascript -e '${script}'`);
    return { ok: true };
  },

  /**
   * system.speak — 文字转语音（macOS say 命令）
   * params: { text: string, voice?: string }
   */
  'system.speak': async ({ text, voice = 'Tingting' }) => {
    if (!text) throw new Error('text is required');
    const safeText = text.replace(/"/g, '\\"');
    await execAsync(`say -v "${voice}" "${safeText}"`);
    return { ok: true };
  },
};
