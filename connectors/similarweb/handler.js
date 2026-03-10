/**
 * SimilarWeb 连接器 handler
 *
 * 通过 SimilarWeb REST API V5 获取网站流量、排名、营销渠道等数据。
 * 认证方式：Header api_key
 * API Base: https://api.similarweb.com
 */

const BASE = "https://api.similarweb.com";

function sanitizeDomain(d) {
  return String(d || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

function sanitize(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "");
}

async function apiFetch(path, params, apiKey, _retries = 0) {
  const qs = new URLSearchParams(params);
  const url = `${BASE}/${path}?${qs}`;
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        "api-key": apiKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (fetchErr) {
    if (_retries < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (_retries + 1)));
      return apiFetch(path, params, apiKey, _retries + 1);
    }
    throw new Error(`SimilarWeb 网络错误 (${fetchErr.message})，请稍后重试`);
  }
  if (resp.status === 429 && _retries < 2) {
    await new Promise((r) => setTimeout(r, 2000 * (_retries + 1)));
    return apiFetch(path, params, apiKey, _retries + 1);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    let errMsg = `SimilarWeb ${resp.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.meta?.error_message) {
        errMsg += `: ${parsed.meta.error_message}`;
      } else {
        errMsg += `: ${body.slice(0, 500)}`;
      }
    } catch {
      errMsg += `: ${body.slice(0, 500)}`;
    }
    throw new Error(errMsg);
  }
  return resp.json();
}

async function pullTrafficEngagement(params, apiKey, cache) {
  const domain = sanitizeDomain(params.domain);
  const startDate = sanitize(params.start_date);
  const endDate = sanitize(params.end_date);
  const granularity = sanitize(params.granularity || "monthly");
  const country = sanitize(params.country || "world");

  if (!domain) return { ok: false, error: "缺少 domain 参数" };
  if (!startDate || !endDate) return { ok: false, error: "缺少 start_date / end_date" };

  const cacheKey = `sw:te:${domain}:${country}:${startDate}:${endDate}:${granularity}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await apiFetch("v5/website-analysis/websites/traffic-and-engagement", {
    domain,
    start_date: startDate,
    end_date: endDate,
    granularity,
    country,
    metrics: "visits,bounce_rate,average_visit_duration,pages_per_visit,unique_visitors",
  }, apiKey);

  const result = { domain, country, startDate, endDate, granularity, ...data };
  cache?.set(cacheKey, result, 3600);
  return { ok: true, data: result };
}

async function pullWebsiteRanking(params, apiKey, cache) {
  const domain = sanitizeDomain(params.domain);
  if (!domain) return { ok: false, error: "缺少 domain 参数" };

  const now = new Date();
  const startDate = sanitize(params.start_date) || `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;
  const endDate = sanitize(params.end_date) || startDate;
  const country = sanitize(params.country || "world");

  const cacheKey = `sw:rank:${domain}:${country}:${startDate}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await apiFetch("v5/website-analysis/websites/website-rank", {
    domain,
    start_date: startDate,
    end_date: endDate,
    granularity: "monthly",
    country,
  }, apiKey);

  const result = { domain, country, startDate, endDate, ...data };
  cache?.set(cacheKey, result, 3600);
  return { ok: true, data: result };
}

async function pullTrafficSources(params, apiKey, cache) {
  const domain = sanitizeDomain(params.domain);
  const startDate = sanitize(params.start_date);
  const endDate = sanitize(params.end_date);
  const country = sanitize(params.country || "world");

  if (!domain) return { ok: false, error: "缺少 domain 参数" };
  if (!startDate || !endDate) return { ok: false, error: "缺少 start_date / end_date" };

  const cacheKey = `sw:sources:${domain}:${country}:${startDate}:${endDate}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await apiFetch("v5/website-analysis/websites/marketing-channel-sources", {
    domain,
    start_date: startDate,
    end_date: endDate,
    country,
  }, apiKey);

  const result = { domain, country, startDate, endDate, ...data };
  cache?.set(cacheKey, result, 3600);
  return { ok: true, data: result };
}

async function pullTrafficGeography(params, apiKey, cache) {
  const domain = sanitizeDomain(params.domain);
  const startDate = sanitize(params.start_date);
  const endDate = sanitize(params.end_date);

  if (!domain) return { ok: false, error: "缺少 domain 参数" };
  if (!startDate || !endDate) return { ok: false, error: "缺少 start_date / end_date" };

  const cacheKey = `sw:geo:${domain}:${startDate}:${endDate}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await apiFetch("v5/website-analysis/websites/traffic-geography", {
    domain,
    start_date: startDate,
    end_date: endDate,
  }, apiKey);

  const result = { domain, startDate, endDate, ...data };
  cache?.set(cacheKey, result, 3600);
  return { ok: true, data: result };
}

async function pullAppDetails(params, apiKey, cache) {
  const appId = sanitize(params.app_id);
  const store = sanitize(params.store || "google");

  if (!appId) return { ok: false, error: "缺少 app_id 参数" };

  const cacheKey = `sw:app:${store}:${appId}`;
  const cached = cache?.get(cacheKey);
  if (cached) return { ok: true, data: cached, _cached: true };

  const data = await apiFetch("v5/app-analysis/app-details", {
    app_id: appId,
    store,
  }, apiKey);

  const result = { appId, store, ...data };
  cache?.set(cacheKey, result, 3600);
  return { ok: true, data: result };
}

const ACTIONS = {
  traffic_engagement: pullTrafficEngagement,
  website_ranking: pullWebsiteRanking,
  traffic_sources: pullTrafficSources,
  traffic_geography: pullTrafficGeography,
  app_details: pullAppDetails,
};

export async function pull(ctx) {
  const { action, params, credentials, cache } = ctx;

  if (!credentials?.api_key) {
    return { ok: false, error: "缺少 SimilarWeb api_key 凭证", code: "CREDENTIAL_MISSING" };
  }

  const handler = ACTIONS[action];
  if (!handler) {
    return { ok: false, error: `未知 action: ${action}，可用: ${Object.keys(ACTIONS).join(", ")}`, code: "UNKNOWN_ACTION" };
  }

  return handler(params, credentials.api_key, cache);
}
