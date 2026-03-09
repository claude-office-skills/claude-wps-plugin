/**
 * credential-vault.js — 加密凭证保险库
 *
 * 安全模型：
 *   1. AES-256-GCM 加密存储，每个凭证独立 IV + authTag
 *   2. 主密钥派生自机器指纹（MAC 地址 + 用户名 + 固定盐），无需用户输入密码
 *   3. 支持环境变量 CLAUDE_WPS_VAULT_KEY 自定义主密钥
 *   4. 凭证仅在 proxy 进程内存中解密，不暴露给 WPS/前端
 *   5. 审计日志：每次读写操作记录到 audit.log
 *   6. 凭证轮换：原子写入，失败不破坏原文件
 *
 * 存储位置：~/.claude-wps/vault/
 *   credentials.enc  — 加密凭证数据
 *   vault.key        — 派生密钥校验标记（非密钥本身）
 *   audit.log        — 访问审计日志
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "fs";
import { join } from "path";
import { homedir, hostname, userInfo } from "os";

const VAULT_DIR = join(homedir(), ".claude-wps", "vault");
const ENC_PATH = join(VAULT_DIR, "credentials.enc");
const VERIFY_PATH = join(VAULT_DIR, "vault.verify");
const AUDIT_PATH = join(VAULT_DIR, "audit.log");
const ALGO = "aes-256-gcm";
const SALT = "claude-wps-vault-v1";
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;

function ensureVaultDir() {
  if (!existsSync(VAULT_DIR)) {
    mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
}

function deriveKey() {
  const envKey = process.env.CLAUDE_WPS_VAULT_KEY;
  if (envKey) {
    return scryptSync(envKey, SALT, KEY_LEN);
  }

  const fingerprint = [
    hostname(),
    userInfo().username,
    homedir(),
    SALT,
  ].join("|");

  return scryptSync(fingerprint, SALT, KEY_LEN);
}

function getVerifyToken(key) {
  return createHash("sha256").update(key).update("verify").digest("hex").slice(0, 32);
}

function audit(action, connectorId, detail) {
  ensureVaultDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    action,
    connectorId: connectorId || "-",
    detail: detail || "",
    pid: process.pid,
  });
  try {
    appendFileSync(AUDIT_PATH, line + "\n", { mode: 0o600 });
  } catch {
    // audit is best-effort
  }
}

function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(buffer, key) {
  if (buffer.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Encrypted data too short");
  }
  const iv = buffer.subarray(0, IV_LEN);
  const tag = buffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buffer.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, undefined, "utf-8") + decipher.final("utf-8");
}

class CredentialVault {
  constructor() {
    this._key = null;
    this._data = null;
  }

  _ensureKey() {
    if (this._key) return;
    this._key = deriveKey();
    ensureVaultDir();

    if (existsSync(VERIFY_PATH)) {
      const stored = readFileSync(VERIFY_PATH, "utf-8").trim();
      const expected = getVerifyToken(this._key);
      if (stored !== expected) {
        console.warn(
          "[vault] Key mismatch — vault key changed (env var or machine). Credentials will be reset.",
        );
        this._data = {};
        this._persist();
        return;
      }
    } else {
      writeFileSync(VERIFY_PATH, getVerifyToken(this._key), { mode: 0o600 });
    }

    this._load();
  }

  _load() {
    if (!existsSync(ENC_PATH)) {
      this._data = {};
      return;
    }
    try {
      const buf = readFileSync(ENC_PATH);
      const json = decrypt(buf, this._key);
      this._data = JSON.parse(json);
      audit("load", null, `Loaded ${Object.keys(this._data).length} connector credentials`);
    } catch (err) {
      console.error("[vault] Failed to decrypt credentials:", err.message);
      this._data = {};
    }
  }

  _persist() {
    ensureVaultDir();
    const json = JSON.stringify(this._data);
    const encrypted = encrypt(json, this._key);
    const tmpPath = ENC_PATH + ".tmp";
    writeFileSync(tmpPath, encrypted, { mode: 0o600 });
    renameSync(tmpPath, ENC_PATH);
  }

  /**
   * 获取某个连接器的全部凭证（解密后）
   * 仅在 proxy 进程内使用，不暴露给外部
   */
  get(connectorId) {
    this._ensureKey();
    audit("get", connectorId);
    return { ...(this._data[connectorId] || {}) };
  }

  /**
   * 设置/更新某个连接器的凭证
   * 支持增量更新（merge），不会清除未指定的字段
   */
  set(connectorId, creds) {
    this._ensureKey();
    const existing = this._data[connectorId] || {};
    this._data[connectorId] = { ...existing, ...creds };
    this._persist();
    const keys = Object.keys(creds);
    audit("set", connectorId, `Updated keys: ${keys.join(", ")}`);
  }

  /**
   * 删除某个连接器的全部凭证
   */
  remove(connectorId) {
    this._ensureKey();
    delete this._data[connectorId];
    this._persist();
    audit("remove", connectorId);
  }

  /**
   * 删除某个连接器的指定凭证字段
   */
  removeKey(connectorId, key) {
    this._ensureKey();
    if (this._data[connectorId]) {
      delete this._data[connectorId][key];
      if (Object.keys(this._data[connectorId]).length === 0) {
        delete this._data[connectorId];
      }
      this._persist();
      audit("removeKey", connectorId, `Removed key: ${key}`);
    }
  }

  /**
   * 检查某个连接器是否有指定凭证
   * 不返回凭证值，仅返回 boolean
   */
  has(connectorId, key) {
    this._ensureKey();
    return !!(this._data[connectorId]?.[key]);
  }

  /**
   * 列出某个连接器已配置的凭证键名（不含值）
   */
  listKeys(connectorId) {
    this._ensureKey();
    return Object.keys(this._data[connectorId] || {});
  }

  /**
   * 列出所有有凭证的连接器 ID
   */
  listConnectors() {
    this._ensureKey();
    return Object.keys(this._data);
  }

  /**
   * 获取凭证状态（不含值）— 安全的状态查询，可返回给前端
   */
  getStatus(connectorId, requiredKeys) {
    this._ensureKey();
    const stored = this._data[connectorId] || {};
    return (requiredKeys || []).map((k) => ({
      key: typeof k === "string" ? k : k.key,
      label: typeof k === "string" ? k : (k.label || k.key),
      configured: !!(stored[typeof k === "string" ? k : k.key]),
    }));
  }

  /**
   * 迁移：从旧的明文 JSON 导入凭证
   */
  migrateFromPlaintext(plainPath) {
    if (!existsSync(plainPath)) return 0;
    try {
      const plain = JSON.parse(readFileSync(plainPath, "utf-8"));
      let count = 0;
      for (const [connId, creds] of Object.entries(plain)) {
        if (creds && typeof creds === "object") {
          this.set(connId, creds);
          count++;
        }
      }
      audit("migrate", null, `Imported ${count} connectors from ${plainPath}`);
      return count;
    } catch {
      return 0;
    }
  }
}

const vault = new CredentialVault();
export default vault;
export { CredentialVault };
