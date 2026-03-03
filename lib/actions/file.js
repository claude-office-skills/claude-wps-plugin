/**
 * file.* — 文件操作动作
 *
 * 支持：读取 / 写入 / 追加 / 列目录 / 解析 CSV / 解析 JSON
 */

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, statSync } from 'fs';
import { extname, basename, dirname } from 'path';

function safeRead(filePath) {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return readFileSync(filePath, 'utf-8');
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

export const fileActions = {
  /**
   * file.read — 读取文件内容
   * params: { path: string, encoding?: string, parse?: 'json'|'csv'|'auto' }
   */
  'file.read': async ({ path: filePath, parse = 'auto' }) => {
    const content = safeRead(filePath);
    const ext = extname(filePath).toLowerCase();

    let data;
    if (parse === 'json' || (parse === 'auto' && ext === '.json')) {
      data = JSON.parse(content);
    } else if (parse === 'csv' || (parse === 'auto' && ext === '.csv')) {
      data = parseCsv(content);
    } else {
      data = content;
    }

    return { ok: true, path: filePath, data, size: content.length };
  },

  /**
   * file.write — 写入文件
   * params: { path: string, content: string|object, append?: boolean }
   */
  'file.write': async ({ path: filePath, content, append = false }) => {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    if (append) {
      appendFileSync(filePath, text, 'utf-8');
    } else {
      writeFileSync(filePath, text, 'utf-8');
    }
    return { ok: true, path: filePath, bytes: text.length };
  },

  /**
   * file.list — 列出目录内容
   * params: { path: string, filter?: string }
   */
  'file.list': async ({ path: dirPath, filter }) => {
    if (!existsSync(dirPath)) throw new Error(`Directory not found: ${dirPath}`);
    const entries = readdirSync(dirPath);
    const filtered = filter ? entries.filter(e => e.includes(filter)) : entries;
    return {
      ok: true,
      path: dirPath,
      entries: filtered.map(name => {
        const full = `${dirPath}/${name}`;
        const stat = statSync(full);
        return { name, isDir: stat.isDirectory(), size: stat.size, mtime: stat.mtime };
      }),
    };
  },

  /**
   * file.exists — 检查文件是否存在
   * params: { path: string }
   */
  'file.exists': async ({ path: filePath }) => ({
    ok: true,
    exists: existsSync(filePath),
    path: filePath,
  }),

  /**
   * file.stat — 获取文件元信息
   * params: { path: string }
   */
  'file.stat': async ({ path: filePath }) => {
    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const stat = statSync(filePath);
    return {
      ok: true,
      path: filePath,
      name: basename(filePath),
      dir: dirname(filePath),
      ext: extname(filePath),
      size: stat.size,
      isFile: stat.isFile(),
      isDir: stat.isDirectory(),
      mtime: stat.mtime,
      ctime: stat.ctime,
    };
  },
};
