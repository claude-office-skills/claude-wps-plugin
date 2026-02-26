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
var CODE_POLL_INTERVAL = 800;
var TASKPANE_KEY = "claude_taskpane_id";

var _ctxTimer = null;
var _codePollTimer = null;
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
      wps.Enum && wps.Enum.JSKsoEnum_msoCTPDockPositionRight
        ? wps.Enum.JSKsoEnum_msoCTPDockPositionRight
        : 2;
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
      typeof wps.PluginStorage !== "undefined" &&
      typeof wps.PluginStorage.openDebugger === "function"
    ) {
      wps.PluginStorage.openDebugger();
    } else if (typeof wps.openDevTools === "function") {
      wps.openDevTools();
    } else if (
      typeof Application !== "undefined" &&
      typeof Application.PluginStorage !== "undefined"
    ) {
      Application.PluginStorage.openDebugger();
    } else {
      alert("JS 调试器在当前环境下不可用");
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

function pollAndExecuteCode() {
  try {
    var resp = httpGet(PROXY_URL + "/pending-code");
    if (!resp) return;

    var data = JSON.parse(resp);
    if (!data.pending) return;

    var id = data.id;
    var code = data.code;

    try {
      var execResult = executeInWps(code);
      httpPost(
        PROXY_URL + "/code-result",
        JSON.stringify({ id: id, result: execResult }),
      );
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
