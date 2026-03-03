/**
 * Channel 输出层 — 统一的渠道路由
 *
 * 支持渠道：feishu / email / webhook / chat（回写对话）
 * 配置文件：~/.claude-wps/channels.json（用户本地，不进 Git）
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CHANNELS_CONFIG_PATH = join(homedir(), '.claude-wps', 'channels.json');

function loadChannelsConfig() {
  if (!existsSync(CHANNELS_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CHANNELS_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export async function sendToChannel(channelName, payload) {
  const config = loadChannelsConfig();
  switch (channelName) {
    case 'feishu': {
      const { sendFeishu } = await import('./feishu.js');
      return sendFeishu(config.feishu ?? {}, payload);
    }
    case 'email': {
      const { sendEmail } = await import('./email.js');
      return sendEmail(config.email ?? {}, payload);
    }
    case 'webhook': {
      const { sendWebhook } = await import('./webhook.js');
      return sendWebhook(config.webhook ?? {}, payload);
    }
    case 'chat':
      // 回写到插件对话（由调用方处理 SSE）
      return { ok: true, channel: 'chat' };
    default:
      throw new Error(`Unknown channel: ${channelName}`);
  }
}

export function getConfiguredChannels() {
  const config = loadChannelsConfig();
  return Object.keys(config).filter(k => config[k]?.enabled !== false);
}
