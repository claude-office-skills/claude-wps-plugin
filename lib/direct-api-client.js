import { execSync } from "child_process";
import { Agent } from "undici";

const _dispatcher = new Agent({
  connect: { timeout: 5_000 },
  headersTimeout: 60_000,
  bodyTimeout: 300_000,
  keepAliveTimeout: 10_000,
});

const MODEL_MAP = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

const FALLBACK_MODEL_MAP = {
  haiku: "claude-3-haiku-20240307",
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-6",
};

const API_BASE = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

let _cachedToken = null;
let _tokenExpiry = 0;

function _readOAuthToken() {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", timeout: 5000 },
    ).trim();
    const creds = JSON.parse(raw);
    const token = creds?.claudeAiOauth?.accessToken;
    if (!token) throw new Error("No accessToken in credentials");
    return token;
  } catch {
    return null;
  }
}

function _getToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;
  _cachedToken = _readOAuthToken();
  if (_cachedToken) _tokenExpiry = Date.now() + 30 * 60 * 1000;
  return _cachedToken;
}

let _apiReachable = true;
let _lastReachCheck = 0;
const REACHABILITY_RETRY_MS = 60_000;

export function isReady() {
  if (!_getToken()) return false;
  if (!_apiReachable && Date.now() - _lastReachCheck > REACHABILITY_RETRY_MS) {
    _apiReachable = true;
    console.log("[direct-api] Retrying reachability after cooldown");
  }
  return _apiReachable;
}

export function getError() {
  if (!_cachedToken) return "OAuth token not found in Keychain";
  if (!_apiReachable) return "API unreachable (will retry in 60s)";
  return null;
}

let _warmupDone = false;

export function warmup() {
  if (_warmupDone) return;
  _warmupDone = true;
  const token = _getToken();
  if (!token) return;
  console.log("[direct-api] Warming up connection to api.anthropic.com...");
  const start = Date.now();
  const isOAuthToken = token && !token.startsWith("sk-ant-");
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 15000);
  fetch(API_BASE, {
    method: "POST",
    signal: ctrl.signal,
    headers: isOAuthToken
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "anthropic-version": API_VERSION,
        }
      : {
          "Content-Type": "application/json",
          "x-api-key": token,
          "anthropic-version": API_VERSION,
        },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
    }),
    dispatcher: _dispatcher,
  })
    .then(async (r) => {
      clearTimeout(tm);
      try {
        await r.text();
      } catch {}
      _apiReachable = true;
      _lastReachCheck = Date.now();
      console.log(
        `[direct-api] Warmup done: ${r.status} in ${Date.now() - start}ms`,
      );
    })
    .catch((e) => {
      clearTimeout(tm);
      _apiReachable = false;
      _lastReachCheck = Date.now();
      console.log(
        `[direct-api] Warmup failed: ${e.message} (${Date.now() - start}ms) — Direct API disabled, will retry in 60s`,
      );
    });
}

function resolveModelId(shortName) {
  if (shortName?.startsWith("__raw:")) return shortName.slice(6);
  return MODEL_MAP[shortName] || MODEL_MAP.sonnet;
}

/**
 * Stream a direct API call using native fetch + SSE parsing.
 * Bypasses Anthropic SDK to avoid its HTTP client hanging in server processes.
 */
export async function streamChat({
  systemPrompt,
  messages,
  model = "haiku",
  maxTokens = 4096,
  onEvent,
  signal,
  enableThinking = false,
  thinkingBudget = 10000,
}) {
  const token = _getToken();
  if (!token) throw new Error("Direct API client not available");

  const modelId = resolveModelId(model);

  const rawMsgs = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  const apiMessages = [];
  for (const m of rawMsgs) {
    if (
      apiMessages.length > 0 &&
      apiMessages[apiMessages.length - 1].role === m.role
    ) {
      apiMessages[apiMessages.length - 1].content += "\n" + m.content;
    } else {
      apiMessages.push({ ...m });
    }
  }
  if (apiMessages.length > 0 && apiMessages[0].role !== "user") {
    apiMessages.shift();
  }

  const startTime = Date.now();
  let resultText = "";
  let thinkingText = "";
  let firstTokenTime = 0;

  // OAuth access tokens use Bearer auth; API keys use x-api-key
  function _buildHeaders(tok) {
    const isOAuth = tok && !tok.startsWith("sk-ant-");
    if (isOAuth) {
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tok}`,
        "anthropic-version": API_VERSION,
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      };
    }
    return {
      "Content-Type": "application/json",
      "x-api-key": tok,
      "anthropic-version": API_VERSION,
    };
  }

  const bodyObj = {
    model: modelId,
    max_tokens: maxTokens,
    stream: true,
    system: systemPrompt,
    messages: apiMessages,
  };
  if (enableThinking) {
    bodyObj.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  }
  const reqBody = JSON.stringify(bodyObj);
  let reqHeaders = _buildHeaders(token);

  let resp;
  let lastFetchErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await fetch(API_BASE, {
        method: "POST",
        signal,
        headers: reqHeaders,
        body: reqBody,
        dispatcher: _dispatcher,
      });
      lastFetchErr = null;
      // Retry on 401: refresh token and rebuild headers
      if (resp.status === 401 && attempt < 2) {
        console.log(
          `[direct-api] 401 on attempt ${attempt}, refreshing token...`,
        );
        _cachedToken = null;
        _tokenExpiry = 0;
        const freshToken = _getToken();
        if (freshToken) {
          reqHeaders = _buildHeaders(freshToken);
          continue;
        }
      }
      break;
    } catch (fetchErr) {
      lastFetchErr = fetchErr;
      // #region agent log
      fetch(
        "http://127.0.0.1:7244/ingest/63acb95d-6f91-4165-a07a-5bab2abb61eb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "abaffc",
          },
          body: JSON.stringify({
            sessionId: "abaffc",
            location: "direct-api-client.js:fetch-error",
            message: "Fetch attempt failed",
            data: {
              attempt,
              errName: fetchErr.name,
              errMsg: fetchErr.message,
              errCause: fetchErr.cause?.message || "none",
              signalAborted: !!signal?.aborted,
              modelId,
            },
            timestamp: Date.now(),
            hypothesisId: "H1,H2",
          }),
        },
      ).catch(() => {});
      // #endregion
      if (signal?.aborted) break;
      if (attempt === 0) {
        _cachedToken = null;
        _tokenExpiry = 0;
        const freshToken = _getToken();
        if (freshToken) reqHeaders = _buildHeaders(freshToken);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  if (lastFetchErr) {
    _apiReachable = false;
    _lastReachCheck = Date.now();
    throw lastFetchErr;
  }

  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 404) {
      const fallbackId = FALLBACK_MODEL_MAP[model];
      if (fallbackId && fallbackId !== modelId) {
        console.log(
          `[direct-api] Model ${modelId} not found, trying fallback ${fallbackId}`,
        );
        return streamChat({
          systemPrompt,
          messages,
          model: "__raw:" + fallbackId,
          maxTokens,
          onEvent,
          signal,
        });
      }
    }
    if (resp.status === 401) {
      _cachedToken = null;
      _tokenExpiry = 0;
    }
    throw new Error(`API error ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta" && event.delta.text) {
            if (!firstTokenTime) firstTokenTime = Date.now();
            resultText += event.delta.text;
            onEvent({ type: "token", text: event.delta.text });
          } else if (
            event.delta?.type === "thinking_delta" &&
            event.delta.thinking
          ) {
            thinkingText += event.delta.thinking;
            onEvent({ type: "thinking", text: event.delta.thinking });
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // If AI only produced thinking but no text output, something went wrong.
  // Log it so we can detect this pattern in proxy-server logs.
  if (!resultText && thinkingText) {
    console.warn(
      `[direct-api] ⚠️ Only thinking, no text output. thinkingLen=${thinkingText.length}`,
    );
  }

  return {
    ok: true,
    resultText,
    thinkingText,
    model: modelId,
    totalMs: Date.now() - startTime,
    ttFirstToken: firstTokenTime ? firstTokenTime - startTime : -1,
  };
}
