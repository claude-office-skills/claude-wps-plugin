/**
 * 飞书渠道 — Webhook 发送
 * 配置：{ webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx" }
 */

export async function sendFeishu(config, payload) {
  const { webhookUrl } = config;
  if (!webhookUrl) throw new Error('feishu.webhookUrl not configured');

  const { message, title, markdown } = payload;

  let body;
  if (markdown) {
    body = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: title || 'Claude for WPS' },
          template: 'blue',
        },
        elements: [{
          tag: 'markdown',
          content: markdown,
        }],
      },
    };
  } else {
    body = {
      msg_type: 'text',
      content: { text: message || '' },
    };
  }

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Feishu webhook failed: ${resp.status} ${await resp.text()}`);
  }

  const result = await resp.json();
  if (result.code !== 0) {
    throw new Error(`Feishu error: ${result.msg}`);
  }

  return { ok: true, channel: 'feishu' };
}
