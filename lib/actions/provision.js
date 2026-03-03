/**
 * provision.* — 自动配置 & 自治补全动作
 *
 * 当 Agent 检测到缺少某个 MCP server / npm 包 / API Key 时,
 * 自动触发安装、配置、认证流程。
 *
 * 工作流程:
 *   1. provision.check     — 检查某项能力是否可用
 *   2. provision.resolve   — 自动补全缺失的能力（安装/配置/提示授权）
 *   3. provision.oauth     — 发起 OAuth 授权流（如 Gmail, Notion）
 *   4. provision.apiKey    — 提示并安全存储 API Key
 *   5. provision.mcpServer — 自动安装 & 注册 MCP server
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.claude-wps');
const SECRETS_PATH = join(CONFIG_DIR, 'secrets.json');
const MCP_CONFIG_PATH = join(CONFIG_DIR, 'mcp-servers.json');

// MCP 服务器安装配方
const MCP_RECIPES = {
  'notion': {
    npm: '@notionhq/notion-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    requiredSecrets: ['NOTION_API_KEY'],
    description: 'Notion workspace 读写',
    oauthUrl: 'https://api.notion.com/v1/oauth/authorize',
  },
  'gmail': {
    npm: '@anthropic/gmail-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/gmail-mcp-server'],
    requiredSecrets: ['GMAIL_OAUTH_TOKEN'],
    description: 'Gmail 收发邮件',
    oauthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauthScopes: ['https://mail.google.com/'],
  },
  'stripe': {
    npm: '@anthropic/stripe-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/stripe-mcp-server'],
    requiredSecrets: ['STRIPE_SECRET_KEY'],
    description: 'Stripe 支付管理',
  },
  'figma': {
    npm: '@anthropic/figma-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/figma-mcp-server'],
    requiredSecrets: ['FIGMA_ACCESS_TOKEN'],
    description: 'Figma 设计文件',
    oauthUrl: 'https://www.figma.com/oauth',
  },
  'github': {
    npm: '@anthropic/github-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/github-mcp-server'],
    requiredSecrets: ['GITHUB_TOKEN'],
    description: 'GitHub 仓库 / Issues / PR',
  },
  'slack': {
    npm: '@anthropic/slack-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/slack-mcp-server'],
    requiredSecrets: ['SLACK_BOT_TOKEN'],
    description: 'Slack 消息 & 频道',
    oauthUrl: 'https://slack.com/oauth/v2/authorize',
  },
  'google-calendar': {
    npm: '@anthropic/google-calendar-mcp-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/google-calendar-mcp-server'],
    requiredSecrets: ['GOOGLE_OAUTH_TOKEN'],
    description: 'Google Calendar 日程管理',
    oauthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauthScopes: ['https://www.googleapis.com/auth/calendar'],
  },
  'tavily-search': {
    npm: 'tavily-mcp-server',
    type: 'http',
    url: 'http://127.0.0.1:3002',
    requiredSecrets: ['TAVILY_API_KEY'],
    description: 'Tavily 网络搜索',
  },
};

function loadSecrets() {
  if (!existsSync(SECRETS_PATH)) return {};
  try { return JSON.parse(readFileSync(SECRETS_PATH, 'utf-8')); } catch { return {}; }
}

function saveSecrets(secrets) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), 'utf-8');
}

function loadMcpConfig() {
  if (!existsSync(MCP_CONFIG_PATH)) return { servers: {} };
  try { return JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8')); } catch { return { servers: {} }; }
}

function saveMcpConfig(config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export const provisionActions = {
  /**
   * provision.check — 检测某项能力是否就绪
   *
   * params:
   *   capability: 能力名（如 'notion', 'gmail', 'python3', 'npm:express'）
   */
  'provision.check': async ({ capability }) => {
    if (!capability) throw new Error('capability is required');

    // 检查 MCP server
    if (MCP_RECIPES[capability]) {
      const recipe = MCP_RECIPES[capability];
      const config = loadMcpConfig();
      const serverConfigured = !!config.servers[capability];

      const secrets = loadSecrets();
      const missingSecrets = (recipe.requiredSecrets || [])
        .filter(k => !secrets[k] && !process.env[k]);

      return {
        ok: true,
        capability,
        type: 'mcp_server',
        ready: serverConfigured && missingSecrets.length === 0,
        serverConfigured,
        secretsMissing: missingSecrets,
        recipe: {
          npm: recipe.npm,
          description: recipe.description,
          oauthRequired: !!recipe.oauthUrl,
        },
      };
    }

    // 检查系统命令
    if (!capability.includes(':') && !capability.includes('/')) {
      const { spawn } = await import('child_process');
      const available = await new Promise(resolve => {
        const c = spawn('which', [capability], { timeout: 3000 });
        c.on('close', code => resolve(code === 0));
        c.on('error', () => resolve(false));
      });
      return { ok: true, capability, type: 'system_command', ready: available };
    }

    // 检查 npm 包
    if (capability.startsWith('npm:')) {
      const pkg = capability.slice(4);
      const { spawn } = await import('child_process');
      const installed = await new Promise(resolve => {
        const c = spawn('npm', ['list', pkg, '--depth=0'], { timeout: 5000 });
        let out = '';
        c.stdout.on('data', d => { out += d; });
        c.on('close', code => resolve(code === 0 && out.includes(pkg)));
        c.on('error', () => resolve(false));
      });
      return { ok: true, capability, type: 'npm_package', ready: installed, package: pkg };
    }

    return { ok: true, capability, type: 'unknown', ready: false };
  },

  /**
   * provision.resolve — 自动补全一项缺失的能力
   *
   * 根据能力类型自动执行安装/配置，返回需要用户操作的项目。
   *
   * params:
   *   capability:   能力名
   *   autoInstall:  是否自动安装 npm 包（默认 true）
   *   secrets:      用户提供的密钥（可选，如 { NOTION_API_KEY: 'xxx' }）
   */
  'provision.resolve': async ({ capability, autoInstall = true, secrets: userSecrets = {}, onProgress }) => {
    if (!capability) throw new Error('capability is required');

    const steps = [];
    const userActionsRequired = [];

    if (onProgress) onProgress({ phase: 'checking', message: `检查能力: ${capability}` });

    // MCP server 补全
    if (MCP_RECIPES[capability]) {
      const recipe = MCP_RECIPES[capability];
      const config = loadMcpConfig();

      // Step 1: 安装 npm 包（如需要）
      if (recipe.npm && autoInstall) {
        if (onProgress) onProgress({ phase: 'installing', message: `安装 ${recipe.npm}...` });
        const { spawn } = await import('child_process');
        const installResult = await new Promise((resolve) => {
          const c = spawn('npm', ['install', '-g', recipe.npm], { timeout: 120000 });
          let out = '', err = '';
          c.stdout.on('data', d => { out += d; });
          c.stderr.on('data', d => { err += d; });
          c.on('close', code => resolve({ code, stdout: out, stderr: err }));
          c.on('error', e => resolve({ code: 1, stderr: e.message }));
        });
        steps.push({
          action: 'npm_install',
          package: recipe.npm,
          success: installResult.code === 0,
          output: installResult.code === 0 ? installResult.stdout : installResult.stderr,
        });
      }

      // Step 2: 存储用户提供的密钥
      const allSecrets = loadSecrets();
      for (const [key, value] of Object.entries(userSecrets)) {
        allSecrets[key] = value;
      }
      saveSecrets(allSecrets);

      // Step 3: 检查还缺哪些密钥
      const missingSecrets = (recipe.requiredSecrets || [])
        .filter(k => !allSecrets[k] && !process.env[k] && !userSecrets[k]);

      if (missingSecrets.length > 0) {
        for (const secret of missingSecrets) {
          userActionsRequired.push({
            type: recipe.oauthUrl ? 'oauth' : 'api_key',
            secret,
            description: `需要提供 ${secret} 才能使用 ${capability}`,
            ...(recipe.oauthUrl ? { oauthUrl: recipe.oauthUrl, scopes: recipe.oauthScopes } : {}),
          });
        }
      }

      // Step 4: 注册 MCP server 配置
      if (recipe.type === 'stdio') {
        config.servers[capability] = {
          type: 'stdio',
          command: recipe.command,
          args: recipe.args,
          description: recipe.description,
          env: Object.fromEntries(
            (recipe.requiredSecrets || []).map(k => [k, `\${${k}}`])
          ),
        };
      } else if (recipe.type === 'http') {
        config.servers[capability] = {
          type: 'http',
          url: recipe.url,
          description: recipe.description,
        };
      }
      saveMcpConfig(config);
      steps.push({ action: 'mcp_configure', server: capability, success: true });

      if (onProgress) onProgress({ phase: 'done', message: `${capability} 配置完成` });

      return {
        ok: true,
        capability,
        steps,
        fullyResolved: userActionsRequired.length === 0,
        userActionsRequired,
      };
    }

    // npm 包补全
    if (capability.startsWith('npm:') && autoInstall) {
      const pkg = capability.slice(4);
      if (onProgress) onProgress({ phase: 'installing', message: `npm install ${pkg}` });

      const { spawn } = await import('child_process');
      const result = await new Promise(resolve => {
        const c = spawn('npm', ['install', pkg], { timeout: 120000 });
        let out = '', err = '';
        c.stdout.on('data', d => { out += d; });
        c.stderr.on('data', d => { err += d; });
        c.on('close', code => resolve({ code, stdout: out, stderr: err }));
        c.on('error', e => resolve({ code: 1, stderr: e.message }));
      });

      return {
        ok: result.code === 0,
        capability,
        steps: [{ action: 'npm_install', package: pkg, success: result.code === 0 }],
        fullyResolved: result.code === 0,
        userActionsRequired: [],
      };
    }

    return {
      ok: false,
      capability,
      error: `不知道如何补全能力: ${capability}`,
      steps: [],
      userActionsRequired: [{ type: 'manual', description: `请手动安装/配置 ${capability}` }],
    };
  },

  /**
   * provision.oauth — 发起 OAuth 授权流程
   *
   * 返回授权 URL，用户在浏览器中完成后回调。
   *
   * params:
   *   provider:    服务名（如 'gmail', 'notion'）
   *   callbackUrl: 回调地址（默认本地 proxy）
   *   clientId:    OAuth client ID（从环境变量或参数）
   */
  'provision.oauth': async ({ provider, callbackUrl, clientId }) => {
    if (!provider) throw new Error('provider is required');

    const recipe = MCP_RECIPES[provider];
    if (!recipe?.oauthUrl) {
      throw new Error(`${provider} 不支持 OAuth 或不在已知服务列表中`);
    }

    const cbUrl = callbackUrl || 'http://127.0.0.1:3001/oauth/callback';
    const cid = clientId || process.env[`${provider.toUpperCase()}_CLIENT_ID`] || '';

    const params = new URLSearchParams({
      client_id: cid,
      redirect_uri: cbUrl,
      response_type: 'code',
      ...(recipe.oauthScopes ? { scope: recipe.oauthScopes.join(' ') } : {}),
      state: `claude-wps:${provider}:${Date.now()}`,
    });

    const authUrl = `${recipe.oauthUrl}?${params}`;

    return {
      ok: true,
      provider,
      authUrl,
      callbackUrl: cbUrl,
      message: `请在浏览器中打开以下链接完成 ${provider} 授权`,
      instructions: [
        `1. 打开: ${authUrl}`,
        `2. 登录并授权`,
        `3. 完成后令牌将自动保存`,
      ],
    };
  },

  /**
   * provision.apiKey — 安全存储 API Key
   *
   * params:
   *   name:   密钥名（如 'NOTION_API_KEY'）
   *   value:  密钥值
   */
  'provision.apiKey': async ({ name, value }) => {
    if (!name) throw new Error('name is required');
    if (!value) throw new Error('value is required');

    const secrets = loadSecrets();
    secrets[name] = value;
    saveSecrets(secrets);

    return { ok: true, name, stored: true };
  },

  /**
   * provision.mcpServer — 自动安装并注册一个 MCP server
   *
   * params:
   *   name:      server 名
   *   npm:       npm 包名（可选，自动从 recipe 中获取）
   *   type:      'stdio' | 'http'
   *   command:   stdio 命令
   *   args:      stdio 参数
   *   url:       http URL
   */
  'provision.mcpServer': async ({ name, npm: npmPkg, type, command, args, url, onProgress }) => {
    if (!name) throw new Error('name is required');

    const recipe = MCP_RECIPES[name];
    const pkg = npmPkg || recipe?.npm;
    const sType = type || recipe?.type || 'stdio';

    // 安装 npm 包
    if (pkg) {
      if (onProgress) onProgress({ phase: 'installing', message: `安装 ${pkg}...` });
      const { spawn } = await import('child_process');
      await new Promise(resolve => {
        const c = spawn('npm', ['install', '-g', pkg], { timeout: 120000 });
        c.on('close', resolve);
        c.on('error', () => resolve(1));
      });
    }

    // 写入 MCP 配置
    const config = loadMcpConfig();
    if (sType === 'stdio') {
      config.servers[name] = {
        type: 'stdio',
        command: command || recipe?.command || 'npx',
        args: args || recipe?.args || ['-y', pkg],
        description: recipe?.description || `MCP server: ${name}`,
      };
    } else {
      config.servers[name] = {
        type: 'http',
        url: url || recipe?.url || `http://127.0.0.1:3001`,
        description: recipe?.description || `MCP server: ${name}`,
      };
    }

    saveMcpConfig(config);
    if (onProgress) onProgress({ phase: 'done', message: `${name} 已注册` });

    return { ok: true, server: name, type: sType, installed: !!pkg };
  },

  /**
   * provision.listRecipes — 列出所有已知的 MCP server 配方
   */
  'provision.listRecipes': async () => {
    return {
      ok: true,
      recipes: Object.entries(MCP_RECIPES).map(([name, r]) => ({
        name,
        npm: r.npm,
        description: r.description,
        requiredSecrets: r.requiredSecrets,
        oauthSupported: !!r.oauthUrl,
      })),
    };
  },
};
