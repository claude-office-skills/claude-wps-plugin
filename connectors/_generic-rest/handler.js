/**
 * 通用 REST API 连接器 handler
 *
 * 根据用户配置的 API 模板动态发起 HTTP 请求。
 * 支持 Header / Query / Bearer 三种认证方式。
 */

export async function pull(ctx) {
  const { action, params, credentials, config } = ctx;

  if (!config?.baseUrl) {
    return { ok: false, error: "连接器未配置 baseUrl", code: "NOT_CONFIGURED" };
  }

  const endpoint = config.endpoints?.[action];
  if (!endpoint) {
    return {
      ok: false,
      error: `未知 action: ${action}，可用: ${Object.keys(config.endpoints || {}).join(", ")}`,
      code: "UNKNOWN_ACTION",
    };
  }

  const method = (endpoint.method || "GET").toUpperCase();
  let url = `${config.baseUrl.replace(/\/$/, "")}/${(endpoint.path || "").replace(/^\//, "")}`;

  const headers = { "Accept": "application/json" };
  const queryParams = new URLSearchParams();

  if (config.authType === "header" && config.authHeaderName) {
    headers[config.authHeaderName] = credentials[config.authCredentialKey || "api_key"] || "";
  } else if (config.authType === "bearer") {
    headers["Authorization"] = `Bearer ${credentials[config.authCredentialKey || "token"] || ""}`;
  } else if (config.authType === "query" && config.authQueryParam) {
    queryParams.set(config.authQueryParam, credentials[config.authCredentialKey || "token"] || "");
  }

  for (const [key, val] of Object.entries(params || {})) {
    if (endpoint.pathParams?.includes(key)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(val)));
    } else {
      queryParams.set(key, String(val));
    }
  }

  const qs = queryParams.toString();
  if (qs) url += `?${qs}`;

  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: method !== "GET" && params ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `API ${resp.status}: ${body.slice(0, 300)}`, code: "API_ERROR" };
    }

    const data = await resp.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message, code: "FETCH_ERROR" };
  }
}
