/**
 * credential-importer.js — 凭证文件自动导入器
 *
 * 用户只需将凭证文件放入 ~/.claude-wps/credentials/ 目录，
 * 系统自动识别格式、匹配连接器、加密存储到 Vault。
 *
 * 支持的文件格式：
 *   1. JSON 对象：{"api_key": "xxx", "secret": "yyy"} → 直接作为凭证键值对
 *   2. 裸字符串/Token：ST0_AyJSe7nc_... → 作为 manifest 中第一个 required credential key
 *   3. 文件名匹配：sensortower.json → 连接器 ID "sensortower"
 *      也支持模糊匹配：senstowerapi.json → 匹配到 "sensortower"
 *
 * 导入后原文件被移到 .imported/ 子目录（留底但不再被扫描）。
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";
import vault from "./credential-vault.js";

const CREDS_DIR = join(homedir(), ".claude-wps", "credentials");
const IMPORTED_DIR = join(CREDS_DIR, ".imported");

const ALIAS_MAP = {
  sensortower: "sensortower",
  senstower: "sensortower",
  senstowerapi: "sensortower",
  sensor_tower: "sensortower",
  "sensor-tower": "sensortower",
  st: "sensortower",

  similarweb: "similarweb",
  similar_web: "similarweb",
  "similar-web": "similarweb",
  sw: "similarweb",

  yahoo: "yahoo-finance",
  "yahoo-finance": "yahoo-finance",
  yahoo_finance: "yahoo-finance",
  yfinance: "yahoo-finance",

  github: "github",
  gh: "github",
};

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function resolveConnectorId(filename, registeredIds) {
  const name = basename(filename, extname(filename)).toLowerCase().trim();

  if (registeredIds.has(name)) return name;

  const aliased = ALIAS_MAP[name];
  if (aliased && registeredIds.has(aliased)) return aliased;

  for (const [alias, connId] of Object.entries(ALIAS_MAP)) {
    if (name.includes(alias) && registeredIds.has(connId)) return connId;
  }

  for (const id of registeredIds) {
    if (name.includes(id) || id.includes(name)) return id;
  }

  return null;
}

function parseCredentialFile(filePath) {
  const raw = readFileSync(filePath, "utf-8").trim();

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { type: "object", value: parsed };
    }
    if (typeof parsed === "string") {
      return { type: "token", value: parsed };
    }
  } catch {
    // not JSON
  }

  if (raw.length > 0 && raw.length < 500 && !raw.includes("\n")) {
    return { type: "token", value: raw };
  }

  return null;
}

function getPrimaryCredentialKey(connectorId, registry) {
  if (!registry) return null;
  const conn = registry.get(connectorId);
  if (!conn?.manifest?.credentials) return null;
  const required = conn.manifest.credentials.filter((c) => c.required);
  return required.length > 0 ? required[0].key : conn.manifest.credentials[0]?.key;
}

/**
 * 扫描凭证目录，自动导入新的凭证文件
 * @param {ConnectorRegistry} registry - 连接器注册表实例
 * @returns {{ imported: string[], skipped: string[], errors: string[] }}
 */
export function importCredentials(registry) {
  ensureDir(CREDS_DIR);
  ensureDir(IMPORTED_DIR);

  const result = { imported: [], skipped: [], errors: [] };

  const registeredIds = new Set();
  if (registry) {
    for (const conn of registry.list()) {
      registeredIds.add(conn.id);
    }
  }

  let files;
  try {
    files = readdirSync(CREDS_DIR).filter((f) => {
      if (f.startsWith(".")) return false;
      const ext = extname(f).toLowerCase();
      return [".json", ".txt", ".key", ".token", ".env"].includes(ext);
    });
  } catch {
    return result;
  }

  for (const file of files) {
    const filePath = join(CREDS_DIR, file);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      const connectorId = resolveConnectorId(file, registeredIds);
      if (!connectorId) {
        result.skipped.push(`${file} → 无法匹配到已注册的连接器`);
        continue;
      }

      const parsed = parseCredentialFile(filePath);
      if (!parsed) {
        result.errors.push(`${file} → 无法解析文件内容`);
        continue;
      }

      let creds;
      if (parsed.type === "object") {
        creds = parsed.value;
      } else {
        const primaryKey = getPrimaryCredentialKey(connectorId, registry);
        if (!primaryKey) {
          result.errors.push(`${file} → 连接器 "${connectorId}" 未定义凭证字段，无法映射裸 token`);
          continue;
        }
        creds = { [primaryKey]: parsed.value };
      }

      vault.set(connectorId, creds);

      const importedPath = join(IMPORTED_DIR, `${file}.${Date.now()}`);
      renameSync(filePath, importedPath);

      const keys = Object.keys(creds);
      result.imported.push(`${file} → ${connectorId} [${keys.join(", ")}]`);
      console.log(`[credential-importer] Imported: ${file} → ${connectorId} (keys: ${keys.join(", ")})`);
    } catch (err) {
      result.errors.push(`${file} → ${err.message}`);
    }
  }

  if (result.imported.length > 0) {
    console.log(`[credential-importer] Total imported: ${result.imported.length} credentials`);
  }

  return result;
}

/**
 * 从指定路径导入单个凭证文件
 */
export function importSingleFile(filePath, connectorId, registry) {
  if (!existsSync(filePath)) {
    return { ok: false, error: `文件不存在: ${filePath}` };
  }

  const parsed = parseCredentialFile(filePath);
  if (!parsed) {
    return { ok: false, error: "无法解析文件内容" };
  }

  if (!connectorId) {
    const registeredIds = new Set();
    if (registry) {
      for (const conn of registry.list()) {
        registeredIds.add(conn.id);
      }
    }
    connectorId = resolveConnectorId(basename(filePath), registeredIds);
  }

  if (!connectorId) {
    return { ok: false, error: "无法确定目标连接器，请指定 connectorId" };
  }

  let creds;
  if (parsed.type === "object") {
    creds = parsed.value;
  } else {
    const primaryKey = getPrimaryCredentialKey(connectorId, registry);
    if (!primaryKey) {
      return { ok: false, error: `连接器 "${connectorId}" 未定义凭证字段` };
    }
    creds = { [primaryKey]: parsed.value };
  }

  vault.set(connectorId, creds);
  return { ok: true, connectorId, keys: Object.keys(creds) };
}

export default { importCredentials, importSingleFile };
