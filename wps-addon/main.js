/**
 * WPS 加载项入口文件
 *
 * 1. Ribbon 按钮：打开 Claude 侧边栏 / JS 调试器
 * 2. 上下文同步：定时将 WPS 数据推送到 proxy-server
 * 3. 代码执行桥：轮询 proxy 的待执行代码队列并在 WPS 上下文中执行
 */

var TASKPANE_URL = "http://127.0.0.1:3001/?_t=" + Date.now();
var PROXY_URL = "http://127.0.0.1:3001";
var CTX_INTERVAL = 2000;
var CODE_POLL_INTERVAL = 150;
var TASKPANE_KEY = "claude_taskpane_id";

var _ctxTimer = null;
var _animState = null;
var _codePollTimer = null;
var _navPollTimer = null;
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

    var createFn =
      typeof wps.CreateTaskPane === "function"
        ? wps.CreateTaskPane
        : typeof wps.createTaskPane === "function"
          ? wps.createTaskPane
          : null;

    if (!createFn) {
      alert("当前 WPS 版本不支持 TaskPane API，请更新 WPS Office 到最新版本。");
      return;
    }

    var taskPane = createFn.call(wps, TASKPANE_URL);
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
        "\n\n请检查：\n1. 代理服务是否在运行（终端运行 curl http://127.0.0.1:3001/health）\n2. 如未运行，进入 ~/claude-wps-plugin 执行 node proxy-server.js",
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
    } else if (
      typeof wps !== "undefined" &&
      typeof wps.openDevTools === "function"
    ) {
      wps.openDevTools();
    } else if (
      typeof Application !== "undefined" &&
      Application.PluginStorage &&
      typeof Application.PluginStorage.openDebugger === "function"
    ) {
      Application.PluginStorage.openDebugger();
    } else if (
      typeof wps !== "undefined" &&
      typeof wps.showDevTools === "function"
    ) {
      wps.showDevTools();
    } else {
      alert(
        "JS 调试器在当前 WPS 版本下不可用。\n\n可尝试：菜单 → 开发工具 → 打开调试器",
      );
    }
  } catch (e) {
    alert("打开调试器失败：" + e.message);
  }
}

function GetImage(control) {
  var controlId = "";
  try {
    controlId = control.Id || control.id || "";
  } catch (e) {}

  var basePath = "";
  try {
    if (typeof __dirname !== "undefined") {
      basePath = __dirname + "/";
    } else if (typeof wps !== "undefined" && wps.Env && wps.Env.GetPluginPath) {
      basePath = wps.Env.GetPluginPath() + "/";
    }
  } catch (e) {}

  if (controlId === "OpenDebugger") {
    return basePath + "images/debug-icon.png";
  }
  return basePath + "images/claude-icon.png";
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
    var rawAddr2 =
      typeof sel.Address === "function" ? sel.Address() : sel.Address;
    var addr = String(rawAddr2).replace(/\$/g, "");
    var sheetName = ws.Name || "";
    var rowCount = sel.Rows.Count;
    var colCount = sel.Columns.Count;
    var sampleRows = Math.min(rowCount, 50);
    var sampleCols = Math.min(colCount, 20);

    var values = [];
    try {
      var topLeft = CL(sel.Column) + sel.Row;
      var botRight =
        CL(sel.Column + sampleCols - 1) + (sel.Row + sampleRows - 1);
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
              outRow.push(
                srcRow === undefined || srcRow === null ? "" : srcRow,
              );
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
    try {
      tsId = wps.PluginStorage.getItem(TASKPANE_KEY);
    } catch (e) {}
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
  startBackgroundSync();
}

window.ribbon_bindUI = function (bindUI) {
  bindUI({
    OnOpenClaudePanel: OnOpenClaudePanel,
    OnOpenJSDebugger: OnOpenJSDebugger,
    GetImage: GetImage,
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
  if (_navPollTimer) {
    try {
      clearInterval(_navPollTimer);
    } catch (e) {}
  }
  _syncToken = "sync_" + Date.now();
  pushWpsContext();
  _ctxTimer = setInterval(pushWpsContext, CTX_INTERVAL);
  _codePollTimer = setInterval(pollAndExecuteCode, CODE_POLL_INTERVAL);
  _navPollTimer = setInterval(pollAndNavigate, 300);
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
        var rawAddr =
          typeof sel.Address === "function" ? sel.Address() : sel.Address;
        var addr = String(rawAddr).replace(/\$/g, "");
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
        var urAddr =
          typeof ur.Address === "function" ? ur.Address() : ur.Address;
        var urRowCount = ur.Rows.Count;
        var urColCount = ur.Columns.Count;
        var urSampleRows = Math.min(urRowCount, 50);
        var urSampleCols = Math.min(urColCount, 20);
        var urSampleValues = [];
        try {
          var urTopLeft = CL(ur.Column) + ur.Row;
          var urBotRight =
            CL(ur.Column + urSampleCols - 1) + (ur.Row + urSampleRows - 1);
          var urVals = ws2.Range(urTopLeft + ":" + urBotRight).Value2;
          if (urVals) {
            if (urSampleRows === 1 && urSampleCols === 1) {
              urSampleValues = [[urVals === undefined ? "" : urVals]];
            } else if (urSampleRows === 1) {
              urSampleValues = [urVals];
            } else {
              for (var uri = 0; uri < urVals.length; uri++) {
                var urRow = urVals[uri];
                var urOutRow = [];
                if (Array.isArray(urRow)) {
                  for (var uci = 0; uci < urRow.length; uci++) {
                    var uv = urRow[uci];
                    urOutRow.push(uv === undefined || uv === null ? "" : uv);
                  }
                } else {
                  urOutRow.push(
                    urRow === undefined || urRow === null ? "" : urRow,
                  );
                }
                urSampleValues.push(urOutRow);
              }
            }
          }
        } catch (e) {
          urSampleValues = [];
        }
        result.usedRange = {
          address: String(urAddr).replace(/\$/g, ""),
          rowCount: urRowCount,
          colCount: urColCount,
          hasMoreRows: urRowCount > 50,
          hasMoreCols: urColCount > 20,
          sampleValues: urSampleValues,
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
      address: String(
        typeof ur.Address === "function" ? ur.Address() : ur.Address,
      ).replace(/\$/g, ""),
      grid: grid,
    };
  } catch (e) {
    return null;
  }
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
  var changes = [];
  var maxRows = Math.max(before.grid.length, after.grid.length);
  var maxCols = 0;
  for (var i = 0; i < maxRows; i++) {
    var bRow = before.grid[i] || [];
    var aRow = after.grid[i] || [];
    var cols = Math.max(bRow.length, aRow.length);
    if (cols > maxCols) maxCols = cols;
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
      if (
        beforeSnap &&
        afterSnap &&
        beforeSnap.sheetName !== afterSnap.sheetName
      ) {
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
  for (var k in rowMap) {
    if (rowMap.hasOwnProperty(k)) rowKeys.push(Number(k));
  }
  rowKeys.sort(function (a, b) {
    return a - b;
  });

  try {
    var ws = Application.ActiveSheet;
    for (var ri = 0; ri < rowKeys.length; ri++) {
      var cells = rowMap[rowKeys[ri]];
      for (var ci = 0; ci < cells.length; ci++) {
        try {
          ws.Range(cells[ci].cell).Value2 = "";
        } catch (e2) {}
      }
    }
  } catch (e) {}

  _animState = {
    rowMap: rowMap,
    rowKeys: rowKeys,
    currentIdx: 0,
    tickWait: 0,
    id: id,
    result: result,
    diff: diff,
  };
}

function _processAnimRow() {
  var st = _animState;
  if (!st) return;

  if (st.tickWait > 0) {
    st.tickWait--;
    return;
  }

  if (st.currentIdx >= st.rowKeys.length) {
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
    for (var ci = 0; ci < rowCells.length; ci++) {
      var c = rowCells[ci];
      try {
        ws.Range(c.cell).Value2 = c.after;
      } catch (e2) {}
    }
    var firstCell = rowCells[0].cell;
    var lastCell = rowCells[rowCells.length - 1].cell;
    ws.Range(firstCell + ":" + lastCell).Select();
  } catch (e) {}

  st.currentIdx++;
  st.tickWait = 1;
}

// ── 预注册函数表 — AI 可直接调用，避免生成完整代码 ──────
var actionRegistry = {
  fillColor: function (range, bgrColor) {
    var ws = Application.ActiveSheet;
    ws.Range(range).Interior.Color = bgrColor;
    return "已将 " + range + " 背景色设为 " + bgrColor;
  },
  setFontColor: function (range, bgrColor) {
    var ws = Application.ActiveSheet;
    ws.Range(range).Font.Color = bgrColor;
    return "已将 " + range + " 字体色设为 " + bgrColor;
  },
  clearRange: function (range) {
    var ws = Application.ActiveSheet;
    ws.Range(range).Clear();
    return "已清空 " + range;
  },
  insertFormula: function (cell, formula) {
    var ws = Application.ActiveSheet;
    ws.Range(cell).Formula = formula;
    return "已在 " + cell + " 插入公式 " + formula;
  },
  batchFormula: function (startCell, formula, count, direction) {
    var ws = Application.ActiveSheet;
    var r = ws.Range(startCell);
    var row = r.Row,
      col = r.Column;
    for (var i = 0; i < count; i++) {
      var target =
        direction === "down" ? ws.Cells.Item(row + i, col) : ws.Cells.Item(row, col + i);
      target.Formula = formula;
    }
    return "已批量填充 " + count + " 个单元格";
  },
  sortRange: function (range, colIndex, ascending) {
    var ws = Application.ActiveSheet;
    var rng = ws.Range(range);
    var order = ascending !== false ? 1 : 2;
    rng.Sort(rng.Columns.Item(colIndex || 1), order);
    return "已排序 " + range;
  },
  autoFilter: function (range) {
    var ws = Application.ActiveSheet;
    ws.Range(range).AutoFilter();
    return "已为 " + range + " 添加筛选";
  },
  freezePane: function (row, col) {
    var ws = Application.ActiveSheet;
    ws.Cells.Item(row || 2, col || 1).Select();
    Application.ActiveWindow.FreezePanes = true;
    return "已冻结窗格";
  },
  createSheet: function (name) {
    var wb = Application.ActiveWorkbook;
    var ws = wb.Sheets.Add(null, wb.Sheets.Item(wb.Sheets.Count));
    if (name) ws.Name = name;
    return "已创建工作表 " + (name || ws.Name);
  },
  setValue: function (range, value) {
    var ws = Application.ActiveSheet;
    ws.Range(range).Value2 = value;
    return "已设置 " + range + " = " + value;
  },
  setColumnWidth: function (range, width) {
    var ws = Application.ActiveSheet;
    ws.Range(range).ColumnWidth = width;
    return "已设置 " + range + " 列宽 " + width;
  },
  mergeCells: function (range) {
    var ws = Application.ActiveSheet;
    ws.Range(range).Merge();
    return "已合并 " + range;
  },
};

function executeInWps(code) {
  try {
    var parsed = JSON.parse(code);
    if (parsed && parsed._action && actionRegistry[parsed._action]) {
      var args = parsed._args || [];
      return actionRegistry[parsed._action].apply(null, args);
    }
  } catch (e) {}

  var prevAlerts = true;
  var prevScreenUpdating = true;
  try {
    prevAlerts = Application.DisplayAlerts;
  } catch (e) {}
  try {
    prevScreenUpdating = Application.ScreenUpdating;
  } catch (e) {}
  try {
    Application.DisplayAlerts = false;
  } catch (e) {}
  try {
    Application.ScreenUpdating = false;
  } catch (e) {}
  try {
    var safeSheetGet =
      "function _sheet(name){var wb=Application.ActiveWorkbook;" +
      "for(var i=1;i<=wb.Sheets.Count;i++){if(wb.Sheets.Item(i).Name===name)return wb.Sheets.Item(i);}" +
      "return null;}\n";
    var wrappedCode = safeSheetGet + code;
    var fn = new Function(wrappedCode);
    var result = fn();
    return result === undefined ? "执行成功" : String(result);
  } finally {
    try {
      Application.ScreenUpdating = prevScreenUpdating;
    } catch (e) {}
    try {
      Application.DisplayAlerts = prevAlerts;
    } catch (e) {}
  }
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

// ── 单元格/子表导航 ──────────────────────────────────────────

function pollAndNavigate() {
  try {
    var resp = httpGet(PROXY_URL + "/pending-navigate");
    if (!resp) return;
    var data = JSON.parse(resp);
    if (!data.pending) return;
    navigateInWps(data.sheetName, data.cellAddress);
  } catch (e) {}
}

function navigateInWps(sheetName, cellAddress) {
  try {
    var wb = Application.ActiveWorkbook;
    if (!wb) return;

    if (sheetName) {
      var found = false;
      var count = wb.Sheets.Count;
      for (var i = 1; i <= count; i++) {
        if (wb.Sheets.Item(i).Name === sheetName) {
          wb.Sheets.Item(i).Activate();
          found = true;
          break;
        }
      }
      if (!found) return;
    }

    if (cellAddress) {
      var ws = Application.ActiveSheet;
      try {
        ws.Range(cellAddress).Select();
      } catch (e) {}
    }
  } catch (e) {}
}
