/**
 * Office Add-in Adapter for Excel
 *
 * Implements the same interface as WPS main.js but using Office.js APIs.
 * Runs in the TaskPane (browser context). Must be loaded after Office.js.
 *
 * 1. Context sync: Collect workbook/selection data via Excel.run, POST to proxy
 * 2. Code execution: Poll /pending-code, interpret WPS-like code → Office.js, POST result
 */

(function () {
  "use strict";

  const PROXY_URL = "http://127.0.0.1:3001";
  const CTX_INTERVAL = 2000;
  const CODE_POLL_INTERVAL = 300;

  let _ctxTimer = null;
  let _codePollTimer = null;

  function isOfficeEnvironment() {
    return typeof Office !== "undefined" && Office.context && Office.context.host;
  }

  function httpPost(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
    })
      .then((r) => r.text())
      .catch(() => null);
  }

  function httpGet(url) {
    return fetch(url)
      .then((r) => r.text())
      .catch(() => null);
  }

  function columnLetter(col) {
    let s = "";
    while (col > 0) {
      col--;
      s = String.fromCharCode(65 + (col % 26)) + s;
      col = Math.floor(col / 26);
    }
    return s;
  }

  function collectExcelContext() {
    return Excel.run(function (ctx) {
      const workbook = ctx.workbook;
      const activeSheet = workbook.worksheets.getActiveWorksheet();
      const selection = workbook.getSelectedRange();
      workbook.load("name");
      activeSheet.load("name");
      workbook.worksheets.load("items/name");
      selection.load("address, rowCount, columnCount, values");
      const usedRange = activeSheet.getUsedRange();
      usedRange.load("address, rowCount, columnCount");
      return ctx.sync().then(function () {
        const sheetNames = workbook.worksheets.items.map(function (ws) {
          return ws.name;
        });
        const addr = (selection.address || "").replace(/\$/g, "");
        const sampleRows = Math.min(selection.rowCount, 20);
        const sampleCols = Math.min(selection.columnCount, 15);
        let sampleValues = [];
        if (selection.values && selection.rowCount > 0 && selection.columnCount > 0) {
          const rows = selection.values;
          for (let ri = 0; ri < Math.min(rows.length, sampleRows); ri++) {
            const row = rows[ri];
            const outRow = [];
            const arr = Array.isArray(row) ? row : [row];
            for (let ci = 0; ci < Math.min(arr.length, sampleCols); ci++) {
              const v = arr[ci];
              outRow.push(v === undefined || v === null ? "" : v);
            }
            sampleValues.push(outRow);
          }
        }
        const result = {
          workbookName: workbook.name || "",
          sheetNames: sheetNames,
          selection: addr
            ? {
                address: addr,
                sheetName: activeSheet.name || "",
                rowCount: selection.rowCount,
                colCount: selection.columnCount,
                hasMoreRows: selection.rowCount > 20,
                hasMoreCols: selection.columnCount > 15,
                totalCells: selection.rowCount * selection.columnCount,
                sampleValues: sampleValues,
              }
            : null,
          usedRange: usedRange.address
            ? {
                address: usedRange.address.replace(/\$/g, ""),
                rowCount: usedRange.rowCount,
                colCount: usedRange.columnCount,
              }
            : null,
        };
        return result;
      });
    }).catch(function (err) {
      console.warn("Office adapter collectContext:", err);
      return { workbookName: "", sheetNames: [], selection: null, usedRange: null };
    });
  }

  function pushContext() {
    collectExcelContext().then(function (ctx) {
      if (!ctx.workbookName) return;
      httpPost(PROXY_URL + "/wps-context", JSON.stringify(ctx));
    });
  }

  function parseAddress(addr) {
    const m = (addr || "").match(/^([A-Z]+)(\d+)/i);
    if (!m) return { row: 1, col: 1 };
    let col = 0;
    for (let i = 0; i < m[1].length; i++) {
      col = col * 26 + (m[1].toUpperCase().charCodeAt(i) - 64);
    }
    return { row: parseInt(m[2], 10), col: col };
  }

  function snapshotUsedRange() {
    return Excel.run(function (ctx) {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      const usedRange = sheet.getUsedRange();
      sheet.load("name");
      usedRange.load("address, rowCount, columnCount, values");
      return ctx.sync().then(function () {
        const rc = Math.min(usedRange.rowCount, 100);
        const cc = Math.min(usedRange.columnCount, 30);
        const vals = usedRange.values || [];
        const parsed = parseAddress((usedRange.address || "").split(":")[0]);
        const grid = [];
        for (let r = 0; r < rc && r < vals.length; r++) {
          const row = vals[r];
          const out = [];
          const arr = Array.isArray(row) ? row : [row];
          for (let c = 0; c < cc && c < arr.length; c++) {
            const v = arr[c];
            out.push(v === undefined || v === null ? "" : v);
          }
          grid.push(out);
        }
        return {
          sheetName: sheet.name || "",
          startRow: parsed.row,
          startCol: parsed.col,
          rowCount: rc,
          colCount: cc,
          address: (usedRange.address || "").replace(/\$/g, "").split(":")[0],
          grid: grid,
        };
      });
    }).catch(function () {
      return null;
    });
  }

  function computeDiff(before, after) {
    if (!after) return null;
    if (!before) {
      before = {
        grid: [],
        startRow: after.startRow,
        startCol: after.startCol,
        sheetName: after.sheetName,
        rowCount: 0,
        colCount: 0,
      };
    }
    const changes = [];
    const maxRows = Math.max(before.grid.length, after.grid.length);
    for (let i = 0; i < maxRows; i++) {
      const bRow = before.grid[i] || [];
      const aRow = after.grid[i] || [];
      const cols = Math.max(bRow.length, aRow.length);
      for (let j = 0; j < cols; j++) {
        const bVal = j < bRow.length ? bRow[j] : "";
        const aVal = j < aRow.length ? aRow[j] : "";
        if (String(bVal) !== String(aVal)) {
          changes.push({
            cell: columnLetter(before.startCol + j) + (before.startRow + i),
            row: before.startRow + i,
            col: before.startCol + j,
            before: bVal,
            after: aVal,
          });
        }
      }
    }
    return {
      sheetName: after.sheetName,
      changeCount: changes.length,
      changes: changes.slice(0, 500),
      hasMore: changes.length > 500,
    };
  }

  /**
   * Execute WPS-like code via Office.js.
   * Supports patterns: Range("addr").Value2 = values; return "msg";
   * For complex code, extend the interpreter per docs/office-compatibility-evaluation.md
   */
  function interpretAndExecute(code) {
    const rangeSetRe = /\.Range\s*\(\s*["']([A-Za-z0-9:]+)["']\s*\)\s*\.\s*Value2\s*=\s*([\s\S]+?)\s*;/g;
    const returnRe = /return\s+([\s\S]+?)\s*;?\s*$/m;
    const assignments = [];
    let m;
    while ((m = rangeSetRe.exec(code)) !== null) {
      assignments.push({ address: m[1], valuesExpr: m[2].trim() });
    }
    const returnMatch = code.match(returnRe);
    const returnExpr = returnMatch ? returnMatch[1].trim() : null;

    return Excel.run(function (ctx) {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      for (let i = 0; i < assignments.length; i++) {
        try {
          const values = eval(assignments[i].valuesExpr);
          const arr = Array.isArray(values) ? values : [[values]];
          const rows = arr.length === 1 && !Array.isArray(arr[0]) ? [arr] : arr;
          const range = sheet.getRange(assignments[i].address);
          range.values = rows;
        } catch (e) {
          return Promise.reject(new Error("Range assignment failed: " + e.message));
        }
      }
      return ctx.sync().then(function () {
        if (returnExpr) {
          try {
            return String(eval(returnExpr));
          } catch (e) {
            return "执行成功";
          }
        }
        return "执行成功";
      });
    });
  }

  function pollAndExecuteCode() {
    httpGet(PROXY_URL + "/pending-code").then(function (resp) {
      if (!resp) return;
      try {
        const data = JSON.parse(resp);
        if (!data.pending) return;
      } catch (e) {
        return;
      }
      const id = data.id;
      const code = data.code;
      snapshotUsedRange()
        .then(function (beforeSnap) {
          return interpretAndExecute(code).then(
            function (execResult) {
              return snapshotUsedRange().then(function (afterSnap) {
                if (beforeSnap && afterSnap && beforeSnap.sheetName !== afterSnap.sheetName) {
                  beforeSnap = null;
                }
                const diff = computeDiff(beforeSnap, afterSnap);
                return httpPost(
                  PROXY_URL + "/code-result",
                  JSON.stringify({ id: id, result: execResult, diff: diff })
                );
              });
            },
            function (execErr) {
              return httpPost(
                PROXY_URL + "/code-result",
                JSON.stringify({ id: id, error: execErr.message || String(execErr) })
              );
            }
          );
        })
        .catch(function () {});
    });
  }

  function startBackgroundSync() {
    if (_ctxTimer) clearInterval(_ctxTimer);
    if (_codePollTimer) clearInterval(_codePollTimer);
    pushContext();
    _ctxTimer = setInterval(pushContext, CTX_INTERVAL);
    _codePollTimer = setInterval(pollAndExecuteCode, CODE_POLL_INTERVAL);
  }

  function init() {
    if (!isOfficeEnvironment()) return;
    Office.onReady().then(function () {
      startBackgroundSync();
    });
  }

  if (typeof window !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
