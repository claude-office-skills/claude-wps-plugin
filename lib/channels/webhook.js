/**
 * 通用 Webhook 渠道
 * 配置：{ url, method?, headers? }
 */

export async function sendWebhook(config, payload) {
  const { url, method = 'POST', headers = {} } = config;
  if (!url) throw new Error('webhook.url not configured');

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Webhook failed: ${resp.status} ${await resp.text()}`);
  }

  const ct = resp.headers.get('content-type') || '';
  const result = ct.includes('json') ? await resp.json() : await resp.text();
  return { ok: true, channel: 'webhook', result };
}
