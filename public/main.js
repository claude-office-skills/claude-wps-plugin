/**
 * WPS 加载项入口文件
 *
 * 1. Ribbon 按钮：打开 Claude 侧边栏 / JS 调试器
 * 2. 上下文同步：定时将 WPS 数据推送到 proxy-server
 * 3. 代码执行桥：轮询 proxy 的待执行代码队列并在 WPS 上下文中执行
 */

var TASKPANE_URL = "http://127.0.0.1:5173/";
var PROXY_URL = "http://127.0.0.1:3001";
var CTX_INTERVAL = 2000;
var CODE_POLL_INTERVAL = 150;
var TASKPANE_KEY = "claude_taskpane_id";

var _ctxTimer = null;
var _codePollTimer = null;
var _animState = null;
var _syncToken = "sync_" + Date.now();

// ── Ribbon 按钮回调 ──────────────────────────────────────────

function OnOpenClaudePanel() {
  try {
    var tsId = null;
    try {
      tsId = wps.PluginStorage.getItem(TASKPANE_KEY);
    } catch (e) {}

    if (tsId) {
      try {
        var existing = wps.GetTaskPane(tsId);
        if (existing) {
          existing.Visible = !existing.Visible;
          startBackgroundSync();
          return;
        }
      } catch (e) {}
    }

    var taskPane = wps.CreateTaskPane(TASKPANE_URL);
    taskPane.DockPosition =
      wps.Enum && wps.Enum.JSKsoEnum_msoCTPDockPositionLeft
        ? wps.Enum.JSKsoEnum_msoCTPDockPositionLeft
        : 0;
    taskPane.Visible = true;

    try {
      wps.PluginStorage.setItem(TASKPANE_KEY, taskPane.ID);
    } catch (e) {}
    startBackgroundSync();
  } catch (e) {
    alert(
      "打开 Claude 面板失败：" +
        e.message +
        "\n\n请确保开发服务器已启动：\ncd ~/需求讨论/claude-wps-plugin && npm run dev",
    );
  }
}

function OnOpenJSDebugger() {
  try {
    if (
      typeof wps !== "undefined" &&
      wps.PluginStorage &&
      typeof wps.PluginStorage.openDebugger === "function"
    ) {
      wps.PluginStorage.openDebugger();
    } else if (typeof wps !== "undefined" && typeof wps.openDevTools === "function") {
      wps.openDevTools();
    } else if (
      typeof Application !== "undefined" &&
      Application.PluginStorage &&
      typeof Application.PluginStorage.openDebugger === "function"
    ) {
      Application.PluginStorage.openDebugger();
    } else if (typeof wps !== "undefined" && typeof wps.showDevTools === "function") {
      wps.showDevTools();
    } else {
      alert("JS 调试器在当前 WPS 版本下不可用。\n\n可尝试：菜单 → 开发工具 → 打开调试器");
    }
  } catch (e) {
    alert("打开调试器失败：" + e.message);
  }
}

function GetClaudeIcon() {
  return "claude-icon.png";
}

function GetDebugIcon() {
  return "debug-icon.png";
}

// ── 右键 "Add to Chat" ─────────────────────────────────────
function OnAddToChat() {
  try {
    var sel = Application.Selection;
    if (!sel || !sel.Address) {
      alert("请先选中单元格或区域");
      return;
    }

    var ws = Application.ActiveSheet;
    var addr = sel.Address.replace(/\$/g, "");
    var sheetName = ws.Name || "";
    var rowCount = sel.Rows.Count;
    var colCount = sel.Columns.Count;
    var sampleRows = Math.min(rowCount, 50);
    var sampleCols = Math.min(colCount, 20);

    var values = [];
    try {
      var topLeft = CL(sel.Column) + sel.Row;
      var botRight = CL(sel.Column + sampleCols - 1) + (sel.Row + sampleRows - 1);
      var batchVal = ws.Range(topLeft + ":" + botRight).Value2;
      if (batchVal) {
        if (sampleRows === 1 && sampleCols === 1) {
          values = [[batchVal === undefined ? "" : batchVal]];
        } else if (sampleRows === 1) {
          values = [batchVal];
        } else {
          for (var ri = 0; ri < batchVal.length; ri++) {
            var srcRow = batchVal[ri];
            var outRow = [];
            if (Array.isArray(srcRow)) {
              for (var ci = 0; ci < srcRow.length; ci++) {
                var cv = srcRow[ci];
                outRow.push(cv === undefined || cv === null ? "" : cv);
              }
            } else {
              outRow.push(srcRow === undefined || srcRow === null ? "" : srcRow);
            }
            values.push(outRow);
          }
        }
      }
    } catch (e) {
      values = [];
    }

    var payload = {
      type: "add-to-chat",
      address: addr,
      sheetName: sheetName,
      rowCount: rowCount,
      colCount: colCount,
      values: values,
      timestamp: Date.now(),
    };

    httpPost(PROXY_URL + "/add-to-chat", JSON.stringify(payload));

    var tsId = null;
    try { tsId = wps.PluginStorage.getItem(TASKPANE_KEY); } catch (e) {}
    if (tsId) {
      try {
        var tp = wps.GetTaskPane(tsId);
        if (tp && !tp.Visible) tp.Visible = true;
      } catch (e) {}
    }
  } catch (e) {
    alert("Add to Chat 失败：" + e.message);
  }
}

function OnAddinLoad(ribbonUI) {
  if (typeof ribbonUI === "object") {
    // ribbon 引用
  }
  startBackgroundSync();
}

window.ribbon_bindUI = function (bindUI) {
  bindUI({
    OnOpenClaudePanel: OnOpenClaudePanel,
    OnOpenJSDebugger: OnOpenJSDebugger,
    GetClaudeIcon: GetClaudeIcon,
    GetDebugIcon: GetDebugIcon,
  });
};

// ── 后台同步启动 ─────────────────────────────────────────────

function startBackgroundSync() {
  if (_ctxTimer) {
    try {
      clearInterval(_ctxTimer);
    } catch (e) {}
  }
  if (_codePollTimer) {
    try {
      clearInterval(_codePollTimer);
    } catch (e) {}
  }
  _syncToken = "sync_" + Date.now();
  pushWpsContext();
  _ctxTimer = setInterval(pushWpsContext, CTX_INTERVAL);
  _codePollTimer = setInterval(pollAndExecuteCode, CODE_POLL_INTERVAL);
}

// ── 上下文推送 ───────────────────────────────────────────────

function CL(c) {
  var s = "";
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

function pushWpsContext() {
  try {
    var ctx = collectWpsContext();
    if (!ctx.workbookName) return;
    httpPost(PROXY_URL + "/wps-context", JSON.stringify(ctx));
  } catch (e) {
    // 静默失败，避免影响 WPS 主线程
  }
}

function collectWpsContext() {
  var result = {
    workbookName: "",
    sheetNames: [],
    selection: null,
    usedRange: null,
  };

  try {
    var wb = Application.ActiveWorkbook;
    if (!wb) return result;

    result.workbookName = wb.Name || "";

    try {
      var count = wb.Sheets.Count;
      for (var i = 1; i <= count; i++) {
        result.sheetNames.push(wb.Sheets.Item(i).Name);
      }
    } catch (e) {}

    try {
      var ws = Application.ActiveSheet;
      var sel = Application.Selection;

      if (sel && sel.Address) {
        var addr = sel.Address.replace(/\$/g, "");
        var rowCount = sel.Rows.Count;
        var colCount = sel.Columns.Count;
        var totalCells = rowCount * colCount;

        var sampleRows = Math.min(rowCount, 20);
        var sampleCols = Math.min(colCount, 15);
        var sampleValues = [];

        if (totalCells <= 5000) {
          try {
            var topLeft = CL(sel.Column) + sel.Row;
            var botRight =
              CL(sel.Column + sampleCols - 1) + (sel.Row + sampleRows - 1);
            var batchVal = ws.Range(topLeft + ":" + botRight).Value2;
            if (batchVal) {
              if (sampleRows === 1 && sampleCols === 1) {
                sampleValues = [[batchVal === undefined ? "" : batchVal]];
              } else if (sampleRows === 1) {
                sampleValues = [batchVal];
              } else {
                for (var ri = 0; ri < batchVal.length; ri++) {
                  var srcRow = batchVal[ri];
                  var outRow = [];
                  if (Array.isArray(srcRow)) {
                    for (var ci = 0; ci < srcRow.length; ci++) {
                      var cv = srcRow[ci];
                      outRow.push(cv === undefined || cv === null ? "" : cv);
                    }
                  } else {
                    outRow.push(
                      srcRow === undefined || srcRow === null ? "" : srcRow,
                    );
                  }
                  sampleValues.push(outRow);
                }
              }
            }
          } catch (e) {
            sampleValues = [];
          }
        }

        result.selection = {
          address: addr,
          sheetName: ws.Name || "",
          rowCount: rowCount,
          colCount: colCount,
          hasMoreRows: rowCount > 20,
          hasMoreCols: colCount > 15,
          totalCells: totalCells,
          sampleValues: sampleValues,
        };
      }
    } catch (e) {}

    try {
      var ws2 = Application.ActiveSheet;
      var ur = ws2.UsedRange;
      if (ur && ur.Address) {
        result.usedRange = {
          address: ur.Address.replace(/\$/g, ""),
          rowCount: ur.Rows.Count,
          colCount: ur.Columns.Count,
        };
      }
    } catch (e) {}
  } catch (e) {}

  return result;
}

// ── 代码执行桥 ───────────────────────────────────────────────

function snapshotUsedRange() {
  try {
    var ws = Application.ActiveSheet;
    if (!ws) return null;
    var ur = ws.UsedRange;
    if (!ur || !ur.Address) return null;

    var startRow = ur.Row;
    var startCol = ur.Column;
    var rowCount = Math.min(ur.Rows.Count, 100);
    var colCount = Math.min(ur.Columns.Count, 30);
    var topLeft = CL(startCol) + startRow;
    var botRight = CL(startCol + colCount - 1) + (startRow + rowCount - 1);
    var vals = ws.Range(topLeft + ":" + botRight).Value2;

    var grid = [];
    if (vals) {
      if (rowCount === 1 && colCount === 1) {
        grid = [[vals === undefined ? "" : vals]];
      } else if (rowCount === 1) {
        grid = [vals];
      } else {
        for (var r = 0; r < vals.length; r++) {
          var row = vals[r];
          var outRow = [];
          if (Array.isArray(row)) {
            for (var c = 0; c < row.length; c++) {
              var v = row[c];
              outRow.push(v === undefined || v === null ? "" : v);
            }
          } else {
            outRow.push(row === undefined || row === null ? "" : row);
          }
          grid.push(outRow);
        }
      }
    }

    return {
      sheetName: ws.Name || "",
      startRow: startRow,
      startCol: startCol,
      rowCount: rowCount,
      colCount: colCount,
      address: ur.Address.replace(/\$/g, ""),
      grid: grid,
    };
  } catch (e) {
    return null;
  }
}

function computeDiff(before, after) {
  if (!after) return null;
  if (!before) {
    before = { grid: [], startRow: after.startRow, startCol: after.startCol, sheetName: after.sheetName, rowCount: 0, colCount: 0 };
  }
  var changes = [];
  var maxRows = Math.max(
    before.grid.length,
    after.grid.length
  );
  for (var i = 0; i < maxRows; i++) {
    var bRow = before.grid[i] || [];
    var aRow = after.grid[i] || [];
    var cols = Math.max(bRow.length, aRow.length);
    for (var j = 0; j < cols; j++) {
      var bVal = j < bRow.length ? bRow[j] : "";
      var aVal = j < aRow.length ? aRow[j] : "";
      if (String(bVal) !== String(aVal)) {
        changes.push({
          cell: CL(before.startCol + j) + (before.startRow + i),
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

function pollAndExecuteCode() {
  if (_animState) {
    _processAnimRow();
    return;
  }

  try {
    var resp = httpGet(PROXY_URL + "/pending-code");
    if (!resp) return;

    var data = JSON.parse(resp);
    if (!data.pending) return;

    var id = data.id;
    var code = data.code;

    var beforeSnap = snapshotUsedRange();

    try {
      var execResult = executeInWps(code);

      var afterSnap = snapshotUsedRange();
      if (beforeSnap && afterSnap && beforeSnap.sheetName !== afterSnap.sheetName) {
        beforeSnap = null;
      }
      var diff = computeDiff(beforeSnap, afterSnap);

      if (diff && diff.changes && diff.changes.length > 3) {
        _startAnimation(diff.changes, id, execResult, diff);
      } else {
        httpPost(
          PROXY_URL + "/code-result",
          JSON.stringify({ id: id, result: execResult, diff: diff }),
        );
      }
    } catch (execErr) {
      httpPost(
        PROXY_URL + "/code-result",
        JSON.stringify({ id: id, error: execErr.message || String(execErr) }),
      );
    }
  } catch (e) {
    // 网络错误静默
  }
}

function _startAnimation(changes, id, result, diff) {
  var rowMap = {};
  for (var i = 0; i < changes.length; i++) {
    var r = changes[i].row;
    if (!rowMap[r]) rowMap[r] = [];
    rowMap[r].push(changes[i]);
  }
  var rowKeys = [];
  for (var k in rowMap) { if (rowMap.hasOwnProperty(k)) rowKeys.push(Number(k)); }
  rowKeys.sort(function(a, b) { return a - b; });

  try {
    Application.ScreenUpdating = true;
    var ws = Application.ActiveSheet;
    for (var i = 0; i < changes.length; i++) {
      ws.Range(changes[i].cell).Value2 = "";
    }
  } catch (e) {}

  _animState = {
    rowMap: rowMap,
    rowKeys: rowKeys,
    currentIdx: 0,
    id: id,
    result: result,
    diff: diff
  };
}

function _processAnimRow() {
  var st = _animState;
  if (!st) return;

  if (st.currentIdx >= st.rowKeys.length) {
    try { Application.ScreenUpdating = true; } catch(e){}
    httpPost(
      PROXY_URL + "/code-result",
      JSON.stringify({ id: st.id, result: st.result, diff: st.diff }),
    );
    _animState = null;
    return;
  }

  var rowNum = st.rowKeys[st.currentIdx];
  var rowCells = st.rowMap[rowNum];

  try {
    var ws = Application.ActiveSheet;
    for (var j = 0; j < rowCells.length; j++) {
      ws.Range(rowCells[j].cell).Value2 = rowCells[j].after;
    }
  } catch (e) {}

  st.currentIdx++;
}

function executeInWps(code) {
  var fn = new Function(code);
  var result = fn();
  return result === undefined ? "执行成功" : String(result);
}

// ── HTTP 工具（同步 XHR）─────────────────────────────────────

function httpPost(url, body) {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, false);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(body);
    return xhr.responseText;
  } catch (e) {
    return null;
  }
}

function httpGet(url) {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send();
    return xhr.responseText;
  } catch (e) {
    return null;
  }
}
