/**
 * mcp.* — MCP (Model Context Protocol) 桥接动作
 *
 * 让 Workflow Engine / Long Task Manager 能直接调用 MCP 工具，
 * 将 Skills + MCP + AI Actions 统一为可编排的步骤。
 *
 * 支持三种调用方式：
 *   mcp.call    — 通用 JSON-RPC 调用（stdio / HTTP）
 *   mcp.http    — 简化 HTTP-based MCP server 调用
 *   mcp.proxy   — 通过 proxy-server 中转（调用已配置的 MCP server）
 *
 * MCP Server 配置来源：
 *   1. ~/.claude-wps/mcp-servers.json（用户自定义）
 *   2. 项目 .mcp.json（项目级）
 *   3. 内置默认（proxy-server 自有端点）
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

const CONFIG_DIR = join(homedir(), '.claude-wps');
const MCP_CONFIG_PATH = join(CONFIG_DIR, 'mcp-servers.json');
const PROXY_BASE = 'http://127.0.0.1:3001';

let _mcpConfigCache = null;

function loadMcpConfig() {
  if (_mcpConfigCache) return _mcpConfigCache;

  let config = { servers: {} };

  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
    } catch {}
  }

  // 内置 proxy 端点作为默认 MCP server
  config.servers = {
    'local-proxy': { type: 'http', url: PROXY_BASE, description: 'Local proxy server endpoints' },
    ...config.servers,
  };

  _mcpConfigCache = config;
  return config;
}

function invalidateConfig() {
  _mcpConfigCache = null;
}

/**
 * 通过 HTTP 调用 MCP server 的 JSON-RPC 端点
 */
async function callMcpHttp(serverUrl, method, params = {}) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };

  const resp = await fetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`MCP HTTP error: ${resp.status} ${await resp.text()}`);
  }

  const result = await resp.json();
  if (result.error) {
    throw new Error(`MCP RPC error: ${result.error.message || JSON.stringify(result.error)}`);
  }
  return result.result ?? result;
}

/**
 * 通过 stdio 调用 MCP server（spawn 子进程，发送 JSON-RPC）
 */
function callMcpStdio(command, args = [], method, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    const rpcRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }) + '\n';

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`MCP stdio error (exit ${code}): ${stderr}`));
      }
      try {
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        const result = JSON.parse(lastLine);
        if (result.error) {
          reject(new Error(`MCP RPC error: ${result.error.message}`));
        } else {
          resolve(result.result ?? result);
        }
      } catch (e) {
        reject(new Error(`Failed to parse MCP response: ${stdout.slice(0, 500)}`));
      }
    });

    child.on('error', reject);
    child.stdin.write(rpcRequest);
    child.stdin.end();
  });
}

export const mcpActions = {
  /**
   * mcp.call — 通用 MCP 工具调用
   *
   * params:
   *   server:     MCP server 名（在 mcp-servers.json 中配置）
   *   tool:       工具名（如 'notion_query_database'）
   *   arguments:  工具参数对象
   *   timeout:    超时（ms，默认 30000）
   */
  'mcp.call': async ({ server, tool, arguments: toolArgs = {}, timeout = 30000, onProgress }) => {
    if (!server) throw new Error('server name is required');
    if (!tool) throw new Error('tool name is required');

    const config = loadMcpConfig();
    const serverConfig = config.servers[server];
    if (!serverConfig) {
      throw new Error(`MCP server not found: "${server}". Available: ${Object.keys(config.servers).join(', ')}`);
    }

    if (onProgress) onProgress({ phase: 'connecting', message: `连接 MCP server: ${server}` });

    let result;
    if (serverConfig.type === 'http') {
      const url = serverConfig.url.replace(/\/$/, '');
      result = await callMcpHttp(`${url}/mcp`, 'tools/call', { name: tool, arguments: toolArgs });
    } else if (serverConfig.type === 'stdio') {
      result = await callMcpStdio(
        serverConfig.command,
        serverConfig.args || [],
        'tools/call',
        { name: tool, arguments: toolArgs },
        timeout,
      );
    } else {
      throw new Error(`Unsupported MCP transport: ${serverConfig.type}`);
    }

    if (onProgress) onProgress({ phase: 'done', message: `MCP 调用完成: ${tool}` });
    return { ok: true, server, tool, result };
  },

  /**
   * mcp.http — 简化 HTTP 调用（直接 POST 到 MCP server URL）
   *
   * 适用于不走标准 JSON-RPC 协议的 HTTP 端点（如我们自己的 proxy-server 接口）
   *
   * params:
   *   url:        完整 URL（或相对于 proxy 的路径，如 '/finance-data/AAPL'）
   *   method:     HTTP 方法，默认 'GET'
   *   body:       POST body（对象，自动 JSON 序列化）
   *   headers:    额外 headers
   */
  'mcp.http': async ({ url, method = 'GET', body, headers = {}, onProgress }) => {
    if (!url) throw new Error('url is required');

    const fullUrl = url.startsWith('http') ? url : `${PROXY_BASE}${url}`;

    if (onProgress) onProgress({ phase: 'requesting', message: `${method} ${fullUrl}` });

    const opts = { method, headers: { ...headers } };
    if (body && method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(fullUrl, opts);
    const ct = resp.headers.get('content-type') || '';
    const data = ct.includes('json') ? await resp.json() : await resp.text();

    if (!resp.ok) {
      throw new Error(`MCP HTTP ${resp.status}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data)}`);
    }

    if (onProgress) onProgress({ phase: 'done', message: '请求完成' });
    return { ok: true, status: resp.status, data };
  },

  /**
   * mcp.proxy — 通过本地 proxy-server 中转调用外部 MCP 工具
   *
   * proxy-server 上的 /mcp/call 端点负责实际 MCP 通信。
   * 这样 Workflow YAML 里只需写 server + tool，proxy 处理认证和传输。
   *
   * params:
   *   server:     MCP server 名
   *   tool:       工具名
   *   arguments:  工具参数
   */
  'mcp.proxy': async ({ server, tool, arguments: toolArgs = {}, onProgress }) => {
    if (!server) throw new Error('server is required');
    if (!tool) throw new Error('tool is required');

    if (onProgress) onProgress({ phase: 'calling', message: `Proxy → ${server}.${tool}` });

    const resp = await fetch(`${PROXY_BASE}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server, tool, arguments: toolArgs }),
    });

    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'MCP proxy call failed');

    if (onProgress) onProgress({ phase: 'done', message: `完成: ${tool}` });
    return data;
  },

  /**
   * mcp.list — 列出已配置的 MCP server
   */
  'mcp.list': async () => {
    const config = loadMcpConfig();
    return {
      ok: true,
      servers: Object.entries(config.servers).map(([name, cfg]) => ({
        name,
        type: cfg.type,
        description: cfg.description || '',
        url: cfg.type === 'http' ? cfg.url : undefined,
        command: cfg.type === 'stdio' ? cfg.command : undefined,
      })),
    };
  },

  /**
   * mcp.configure — 添加/更新 MCP server 配置
   *
   * params:
   *   name:        server 名
   *   type:        'http' | 'stdio'
   *   url:         HTTP server URL (type=http)
   *   command:     可执行命令 (type=stdio)
   *   args:        命令参数 (type=stdio)
   *   description: 描述
   */
  'mcp.configure': async ({ name, type, url, command, args, description }) => {
    if (!name) throw new Error('name is required');
    if (!type) throw new Error('type is required (http or stdio)');

    const config = loadMcpConfig();

    config.servers[name] = {
      type,
      ...(type === 'http' ? { url } : { command, args: args || [] }),
      ...(description ? { description } : {}),
    };

    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    invalidateConfig();

    return { ok: true, server: name, type };
  },
};
