/**
 * connector-registry.js — 可插拔数据连接器注册表
 *
 * 职责：
 *   1. 扫描 connectors/ 目录，加载 manifest.yaml + handler.js
 *   2. 提供统一 pull(connectorId, action, params) 接口
 *   3. 支持热重载、启用/禁用
 *   4. 凭证注入（从 CredentialVault 读取，不暴露给外部）
 *
 * 连接器目录结构：
 *   connectors/<id>/manifest.yaml  — 元数据 + 能力声明
 *   connectors/<id>/handler.js     — Node.js 数据拉取逻辑（export { pull })
 *   connectors/<id>/skill.md       — 可选，给 AI 的使用说明
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { pathToFileURL } from "url";
import yaml from "js-yaml";
import vault from "./credential-vault.js";

const BUNDLED_DIR = resolve(import.meta.dirname, "..", "connectors");
const USER_DIR = join(homedir(), ".claude-wps", "connectors");
const LEGACY_CREDENTIALS_PATH = join(homedir(), ".claude-wps", "connector-credentials.json");

const _cache = new Map();
const CACHE_TTL = 3600_000;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function parseManifest(dir) {
  const yamlPath = join(dir, "manifest.yaml");
  const ymlPath = join(dir, "manifest.yml");
  const jsonPath = join(dir, "manifest.json");

  let raw;
  if (existsSync(yamlPath)) {
    raw = readFileSync(yamlPath, "utf-8");
    return yaml.load(raw);
  }
  if (existsSync(ymlPath)) {
    raw = readFileSync(ymlPath, "utf-8");
    return yaml.load(raw);
  }
  if (existsSync(jsonPath)) {
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
  }
  return null;
}

async function loadHandler(dir) {
  const handlerPath = join(dir, "handler.js");
  if (!existsSync(handlerPath)) return null;
  const mod = await import(pathToFileURL(handlerPath).href);
  return mod.default || mod;
}

function migrateIfNeeded() {
  if (existsSync(LEGACY_CREDENTIALS_PATH)) {
    const count = vault.migrateFromPlaintext(LEGACY_CREDENTIALS_PATH);
    if (count > 0) {
      console.log(`[connector-registry] Migrated ${count} credentials from plaintext to encrypted vault`);
      const backupPath = LEGACY_CREDENTIALS_PATH + ".bak";
      try {
        renameSync(LEGACY_CREDENTIALS_PATH, backupPath);
        console.log(`[connector-registry] Old plaintext credentials backed up to ${backupPath}`);
      } catch {}
    }
  }
}

const cacheStore = {
  get(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > (entry.ttl || CACHE_TTL)) {
      _cache.delete(key);
      return null;
    }
    return entry.value;
  },
  set(key, value, ttlSeconds) {
    _cache.set(key, { value, ts: Date.now(), ttl: (ttlSeconds || 3600) * 1000 });
  },
  clear() {
    _cache.clear();
  },
};

class ConnectorRegistry {
  constructor() {
    this._connectors = new Map();
    this._configPath = join(homedir(), ".claude-wps", "connectors-config.json");
  }

  async load() {
    this._connectors.clear();
    ensureDir(USER_DIR);
    migrateIfNeeded();

    await this._scanDir(BUNDLED_DIR, "bundled");
    await this._scanDir(USER_DIR, "user");

    const config = this._loadConfig();
    for (const [id, conn] of this._connectors) {
      if (config[id]?.enabled === false) {
        conn.enabled = false;
      }
    }

    console.log(
      `[connector-registry] Loaded ${this._connectors.size} connectors: ${[...this._connectors.keys()].join(", ")}`,
    );
  }

  async _scanDir(baseDir, layer) {
    if (!existsSync(baseDir)) return;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(baseDir, entry.name);
      try {
        const manifest = parseManifest(dir);
        if (!manifest?.id) continue;

        const handler = await loadHandler(dir);
        if (!handler?.pull) {
          console.warn(`[connector-registry] ${manifest.id}: handler.js missing pull(), skipped`);
          continue;
        }

        this._connectors.set(manifest.id, {
          manifest,
          handler,
          dir,
          layer,
          enabled: true,
        });
      } catch (err) {
        console.error(`[connector-registry] Failed to load ${entry.name}:`, err.message);
      }
    }
  }

  _loadConfig() {
    if (!existsSync(this._configPath)) return {};
    try {
      return JSON.parse(readFileSync(this._configPath, "utf-8"));
    } catch {
      return {};
    }
  }

  async pull(connectorId, action, params) {
    const conn = this._connectors.get(connectorId);
    if (!conn) {
      return { ok: false, error: `连接器 "${connectorId}" 未找到`, code: "CONNECTOR_NOT_FOUND" };
    }
    if (!conn.enabled) {
      return { ok: false, error: `连接器 "${connectorId}" 已禁用`, code: "CONNECTOR_DISABLED" };
    }

    const validActions = conn.manifest.actions?.map((a) => a.id) || [];
    if (validActions.length > 0 && !validActions.includes(action)) {
      return {
        ok: false,
        error: `连接器 "${connectorId}" 不支持 action "${action}"，可用: ${validActions.join(", ")}`,
        code: "UNKNOWN_ACTION",
      };
    }

    const credentials = vault.get(connectorId);

    const requiredCreds = (conn.manifest.credentials || []).filter((c) => c.required);
    const missingCreds = requiredCreds.filter((c) => !credentials[c.key]);
    if (missingCreds.length > 0) {
      return {
        ok: false,
        error: `连接器 "${connectorId}" 缺少凭证: ${missingCreds.map((c) => c.label || c.key).join(", ")}`,
        code: "CREDENTIAL_MISSING",
        missingCredentials: missingCreds.map((c) => ({ key: c.key, label: c.label })),
      };
    }

    try {
      const result = await conn.handler.pull({
        action,
        params: params || {},
        credentials,
        cache: cacheStore,
      });

      return {
        ...result,
        connectorId,
        action,
        fetchedAt: result.fetchedAt || new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        connectorId,
        action,
        error: `连接器执行错误: ${err.message}`,
        code: "HANDLER_ERROR",
      };
    }
  }

  list() {
    const result = [];
    for (const [id, conn] of this._connectors) {
      result.push({
        id,
        name: conn.manifest.name || id,
        version: conn.manifest.version || "0.0.0",
        description: conn.manifest.description || "",
        layer: conn.layer,
        enabled: conn.enabled,
        actions: (conn.manifest.actions || []).map((a) => ({
          id: a.id,
          name: a.name || a.id,
          description: a.description || "",
          params: a.params || [],
        })),
        requiresCredentials: (conn.manifest.credentials || []).length > 0,
        hasCredentials: (() => {
          const required = (conn.manifest.credentials || []).filter((c) => c.required);
          return required.every((c) => vault.has(id, c.key));
        })(),
        credentialStatus: vault.getStatus(id, conn.manifest.credentials || []),
      });
    }
    return result;
  }

  getCredentialSchema(connectorId) {
    const conn = this._connectors.get(connectorId);
    if (!conn) return null;
    return (conn.manifest.credentials || []).map((c) => ({
      key: c.key,
      label: c.label || c.key,
      required: !!c.required,
    }));
  }

  setCredentials(connectorId, creds) {
    vault.set(connectorId, creds);
  }

  removeCredentials(connectorId) {
    vault.remove(connectorId);
  }

  getCredentialStatus(connectorId) {
    const conn = this._connectors.get(connectorId);
    if (!conn) return null;
    return vault.getStatus(connectorId, conn.manifest.credentials || []);
  }

  setEnabled(connectorId, enabled) {
    const conn = this._connectors.get(connectorId);
    if (conn) conn.enabled = enabled;

    const config = this._loadConfig();
    config[connectorId] = { ...(config[connectorId] || {}), enabled };
    ensureDir(join(homedir(), ".claude-wps"));
    writeFileSync(this._configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async reload() {
    await this.load();
  }

  has(connectorId) {
    return this._connectors.has(connectorId);
  }

  get(connectorId) {
    return this._connectors.get(connectorId);
  }

  get size() {
    return this._connectors.size;
  }
}

const registry = new ConnectorRegistry();

export default registry;
export { ConnectorRegistry };
