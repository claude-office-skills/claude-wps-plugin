/**
 * notify.* — 通知发送动作
 *
 * 包装 channels 层，提供标准化的 notify.xxx 动作接口
 */

import { sendToChannel } from '../channels/index.js';

export const notifyActions = {
  /**
   * notify.feishu — 发送飞书 Webhook 消息
   * params: { message?: string, title?: string, markdown?: string }
   */
  'notify.feishu': async (params) => {
    return sendToChannel('feishu', params);
  },

  /**
   * notify.email — 发送邮件
   * params: { to: string, subject?: string, body?: string, html?: string, attachments?: array }
   */
  'notify.email': async (params) => {
    return sendToChannel('email', params);
  },

  /**
   * notify.webhook — 发送通用 Webhook
   * params: { ...payload }
   */
  'notify.webhook': async (params) => {
    return sendToChannel('webhook', params);
  },

  /**
   * notify.system — macOS 系统通知
   * params: { title?: string, message: string }
   */
  'notify.system': async ({ title = 'Claude for WPS', message }) => {
    const { systemActions } = await import('./system.js');
    return systemActions['system.notify']({ title, message });
  },
};
