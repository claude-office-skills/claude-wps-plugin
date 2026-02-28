/**
 * WPS 数据适配层
 *
 * 架构：Plugin Host main.js 定时将 ET 数据 POST 到 proxy-server，
 * 本模块通过 GET /wps-context 获取最新数据。
 * 代码执行：POST /execute-code 提交 → 轮询 /code-result/:id 获取结果。
 */
import type { WpsContext } from "../types";

const PROXY_URL = "http://127.0.0.1:3001";

let _wpsAvailable = false;

export function isWpsAvailable(): boolean {
  return _wpsAvailable;
}

export async function getWpsContext(): Promise<WpsContext> {
  try {
    const res = await fetch(`${PROXY_URL}/wps-context`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (
      data.error ||
      (!data.workbookName && !data.selection && !data.sheetNames?.length)
    ) {
      _wpsAvailable = false;
      return getMockContext();
    }

    _wpsAvailable = true;
    return {
      workbookName: data.workbookName ?? "",
      sheetNames: data.sheetNames ?? [],
      selection: data.selection ?? null,
      usedRange: data.usedRange ?? null,
    };
  } catch (err) {
    _wpsAvailable = false;
    return getMockContext();
  }
}

const CODE_RESULT_POLL_MS = 300;
const CODE_RESULT_TIMEOUT_MS = 30000;

import type { DiffResult, AddToChatPayload } from "../types";

export interface ExecuteResult {
  result: string;
  diff: DiffResult | null;
}

export async function executeCode(
  code: string,
  agentId?: string,
): Promise<ExecuteResult> {
  const submitRes = await fetch(`${PROXY_URL}/execute-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, agentId }),
  });

  if (!submitRes.ok) {
    throw new Error(`提交代码失败: HTTP ${submitRes.status}`);
  }

  const { id } = await submitRes.json();

  const deadline = Date.now() + CODE_RESULT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(CODE_RESULT_POLL_MS);

    const pollRes = await fetch(`${PROXY_URL}/code-result/${id}`);
    if (!pollRes.ok) continue;

    const data = await pollRes.json();
    if (!data.ready) continue;

    if (data.error) {
      throw new Error(data.error);
    }
    return {
      result: data.result ?? "执行成功",
      diff: data.diff ?? null,
    };
  }

  throw new Error("代码执行超时（30秒）");
}

export async function navigateToCell(
  sheetName: string,
  cellAddress?: string,
): Promise<void> {
  await fetch(`${PROXY_URL}/navigate-to`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheetName, cellAddress }),
    signal: AbortSignal.timeout(3000),
  });
}

export async function pollAddToChat(): Promise<AddToChatPayload | null> {
  try {
    const res = await fetch(`${PROXY_URL}/add-to-chat/poll`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pending) return null;
    return data as AddToChatPayload;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let _lastCtxJson = "";
let _lastSelectionCtx: WpsContext | null = null;
let _selNullCount = 0;
const SEL_NULL_GRACE = 2;

export function onSelectionChange(
  callback: (ctx: WpsContext) => void,
): () => void {
  let active = true;
  const POLL_INTERVAL = 2500;

  const poll = async () => {
    if (!active) return;
    try {
      const ctx = await getWpsContext();

      if (!ctx.selection && _lastSelectionCtx?.selection) {
        _selNullCount++;
        if (_selNullCount <= SEL_NULL_GRACE) {
          if (active) setTimeout(poll, POLL_INTERVAL);
          return;
        }
      } else {
        _selNullCount = 0;
      }

      if (ctx.selection) {
        _lastSelectionCtx = ctx;
      }

      const json = JSON.stringify({
        workbookName: ctx.workbookName,
        sheetNames: ctx.sheetNames,
        selAddr: ctx.selection?.address,
        selSheet: ctx.selection?.sheetName,
        selRows: ctx.selection?.rowCount,
        selCols: ctx.selection?.colCount,
      });

      if (json !== _lastCtxJson) {
        _lastCtxJson = json;
        callback(ctx);
      }
    } catch {
      // ignore
    }
    if (active) setTimeout(poll, POLL_INTERVAL);
  };

  setTimeout(poll, POLL_INTERVAL);
  return () => {
    active = false;
  };
}

function getMockContext(): WpsContext {
  return {
    workbookName: "示例工作簿.xlsx",
    sheetNames: ["Sheet1", "销售数据", "汇总"],
    selection: {
      address: "A1:D5",
      sheetName: "Sheet1",
      rowCount: 5,
      colCount: 4,
      hasMoreRows: false,
      sampleValues: [
        ["姓名", "部门", "销售额", "日期"],
        ["张三", "销售部", 12500, "2024-01-15"],
        ["李四", "销售部", 8900, "2024-01-16"],
        ["张三", "销售部", 12500, "2024-01-17"],
        ["王五", "市场部", 15200, "2024-01-18"],
      ],
    },
  };
}
