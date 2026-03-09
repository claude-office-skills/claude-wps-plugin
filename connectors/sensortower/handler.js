/**
 * SensorTower 连接器 handler
 *
 * 通过 SensorTower REST API 获取移动应用下载量、收入、活跃用户等数据。
 * 认证方式：auth_token 查询参数
 * API Base: https://app.sensortower.com/api/v1
 */

const BASE = "https://app.sensortower.com/api/v1";
const MAX_SEGMENT_DAYS = { daily: 7, weekly: 90, monthly: 365, quarterly: 730 };

function sanitize(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._,-]/g, "");
}

function dateSegments(start, end, granularity) {
  const segDays = MAX_SEGMENT_DAYS[granularity] || 365;
  const segments = [];
  let cur = new Date(start);
  const endDate = new Date(end);
  while (cur <= endDate) {
    const segEnd = new Date(cur);
    segEnd.setDate(segEnd.getDate() + segDays - 1);
    const actualEnd = segEnd > endDate ? endDate : segEnd;
    segments.push({
      start: cur.toISOString().slice(0, 10),
      end: actualEnd.toISOString().slice(0, 10),
    });
    cur = new Date(actualEnd);
    cur.setDate(cur.getDate() + 1);
  }
  return segments;
}

async function apiFetch(path, params, authToken) {
  const qs = new URLSearchParams({ auth_token: authToken, ...params });
  const url = `${BASE}/${path}?${qs}`;
  const resp = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`SensorTower ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function pullAppSales(params, credentials, cache) {
  const os = sanitize(params.os || "ios");
  const appId = sanitize(params.app_id);
  const countries = sanitize(params.countries || "US");
  const granularity = sanitize(params.date_granularity || "monthly");
  const startDate = sanitize(params.start_date);
  const endDate = sanitize(params.end_date);
  const token = credentials.auth_token;

  if (!appId) return { ok: false, error: "缺少 app_id 参数" };
  if (!startDate || !endDate) return { ok: false, error: "缺少 start_date / end_date" };

  const cacheKey = `st:sales:${os}:${appId}:${countries}:${startDate}:${endDate}:${granularity}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const segments = dateSegments(startDate, endDate, granularity);
  const allRows = [];

  for (const seg of segments) {
    const raw = await apiFetch(`${os}/sales_report_estimates`, {
      app_ids: appId,
      countries,
      start_date: seg.start,
      end_date: seg.end,
      date_granularity: granularity,
    }, token);

    if (Array.isArray(raw)) {
      for (const row of raw) {
        const parsed = {
          date: row.d,
          country: row.cc || row.c,
          appId: row.aid,
        };
        if (os === "ios") {
          parsed.iphoneDownloads = row.iu || 0;
          parsed.ipadDownloads = row.au || 0;
          parsed.totalDownloads = (row.iu || 0) + (row.au || 0);
          parsed.iphoneRevenue = (row.ir || 0) / 100;
          parsed.ipadRevenue = (row.ar || 0) / 100;
          parsed.totalRevenue = parsed.iphoneRevenue + parsed.ipadRevenue;
        } else {
          parsed.downloads = row.u || 0;
          parsed.revenue = (row.r || 0) / 100;
        }
        allRows.push(parsed);
      }
    }
  }

  const data = {
    os,
    appId,
    countries,
    startDate,
    endDate,
    granularity,
    records: allRows,
    recordCount: allRows.length,
  };

  cache?.set(cacheKey, data, 3600);
  return { ok: true, data };
}

async function pullActiveUsers(params, credentials, cache) {
  const os = sanitize(params.os || "ios");
  const appId = sanitize(params.app_id);
  const countries = sanitize(params.countries || "US");
  const granularity = sanitize(params.date_granularity || "monthly");
  const metric = sanitize(params.metric || "dau");
  const startDate = sanitize(params.start_date);
  const endDate = sanitize(params.end_date);
  const token = credentials.auth_token;

  if (!appId) return { ok: false, error: "缺少 app_id 参数" };
  if (!startDate || !endDate) return { ok: false, error: "缺少 start_date / end_date" };

  const cacheKey = `st:users:${os}:${appId}:${countries}:${metric}:${startDate}:${endDate}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const segments = dateSegments(startDate, endDate, granularity);
  const allRows = [];

  for (const seg of segments) {
    const raw = await apiFetch(`${os}/active_users`, {
      app_ids: appId,
      countries,
      start_date: seg.start,
      end_date: seg.end,
      date_granularity: granularity,
      metric,
    }, token);

    if (Array.isArray(raw)) {
      for (const row of raw) {
        allRows.push({
          date: row.d || row.date,
          country: row.cc || row.c || row.country,
          appId: row.aid || appId,
          [metric]: row.value || row[metric] || row.v || 0,
        });
      }
    }
  }

  const data = { os, appId, countries, metric, startDate, endDate, records: allRows, recordCount: allRows.length };
  cache?.set(cacheKey, data, 3600);
  return { ok: true, data };
}

export async function pull(ctx) {
  const { action, params, credentials, cache } = ctx;

  if (!credentials?.auth_token) {
    return { ok: false, error: "缺少 SensorTower auth_token 凭证", code: "CREDENTIAL_MISSING" };
  }

  if (action === "app_sales") return pullAppSales(params, credentials, cache);
  if (action === "app_active_users") return pullActiveUsers(params, credentials, cache);

  return { ok: false, error: `未知 action: ${action}`, code: "UNKNOWN_ACTION" };
}
