/**
 * WPS 加载项入口文件（仅在 Plugin Host 上下文中有效）
 *
 * 架构说明：
 * - Plugin Host：WPS 加载 publish.xml 中的 URL，注入 wps 全局对象（含完整 ET API）
 * - Task Pane：由 CreateTaskPane 打开的独立 WebView，无 ET API
 * - 通信方式：Plugin Host 定时读取 ET 数据 → POST 到 proxy-server → Task Pane GET 获取
 * - 代码执行：Task Pane → proxy /execute-code → Plugin Host 轮询 /pending-code → 执行 → /code-result
 *
 * WPS JS API 关键规则（通过运行时探测证实）：
 *   .Value2       → 直接返回 2D JS 数组（最佳读值方式）
 *   .Value/.Address → 是函数（getter），需要 .Address() 调用
 *   .Rows.Count   → 直接属性
 *   .Sheets.Item(i) → 访问工作表
 */

var PLUGIN_URL = "http://127.0.0.1:5173";
var PROXY_URL = "http://127.0.0.1:3001";

var _isPluginHost =
  typeof wps !== "undefined" && typeof wps.CreateTaskPane === "function";

if (_isPluginHost) {
  function OnOpenClaudePanel() {
    try {
      var taskPane = wps.CreateTaskPane(PLUGIN_URL + "/index.html");
      taskPane.Visible = true;
    } catch (e) {
      alert("打开 Claude 面板失败：" + e.message);
    }
  }

  function GetClaudeIcon() {
    return "claude-icon.png";
  }

  function GetDebugIcon() {
    return "debug-icon.png";
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
      } else {
        alert("JS 调试器在当前环境下不可用");
      }
    } catch (e) {
      alert("打开调试器失败：" + e.message);
    }
  }

  function OnAddinLoad(ribbonUI) {
    return true;
  }

  // ── 辅助函数 ──

  function extractValues(range, limit) {
    var raw = range.Value2;
    var out = [];
    if (Array.isArray(raw)) {
      var n = Math.min(raw.length, limit);
      for (var r = 0; r < n; r++) {
        out.push(Array.isArray(raw[r]) ? raw[r] : [raw[r]]);
      }
    } else if (raw !== null && raw !== undefined) {
      out = [[raw]];
    }
    return out;
  }

  function getAddress(range) {
    try {
      var addr = range.Address();
      if (addr) return addr;
    } catch (e) {}
    try {
      var addr2 = range.Address;
      if (addr2 !== undefined && addr2 !== null) return String(addr2);
    } catch (e2) {}
    try {
      return "$" + range.Column + ":" + range.Row;
    } catch (e3) {}
    return "";
  }

  // ── ET API 数据读取 ──

  var SAMPLE_LIMIT = 50;

  function readWpsContext() {
    var result = {
      workbookName: "",
      sheetNames: [],
      selection: null,
      usedRange: null,
    };

    try {
      var app = Application;
      var wb = app.ActiveWorkbook;
      if (!wb) {
        result.error = "no-workbook";
        return result;
      }
      result.workbookName = wb.Name || "";
    } catch (e0) {
      result.error = "workbook: " + e0.message;
      return result;
    }

    var wb = Application.ActiveWorkbook;
    var ws;
    try {
      ws = wb.ActiveSheet;
    } catch (e1) {
    }

    try {
      var sheetsCol = wb.Sheets;
      if (!sheetsCol) sheetsCol = wb.Worksheets;
      if (sheetsCol && typeof sheetsCol.Count !== "undefined") {
        for (var i = 1; i <= sheetsCol.Count; i++) {
          result.sheetNames.push(sheetsCol.Item(i).Name);
        }
      }
    } catch (e2) {
    }

    try {
      var sel = Application.Selection;
      if (sel && ws) {
        var rc = 1,
          cc = 1;
        try {
          rc = sel.Rows.Count;
        } catch (e) {}
        try {
          cc = sel.Columns.Count;
        } catch (e) {}

        var MAX_CELLS_EXTRACT = 5000;
        var selAddr = getAddress(sel);
        var totalCells = rc * cc;

        if (totalCells > MAX_CELLS_EXTRACT) {
          result.selection = {
            address: selAddr,
            sheetName: ws.Name || "",
            rowCount: rc,
            colCount: cc,
            sampleValues: [],
            hasMoreRows: true,
            tooLargeToRead: true,
          };
        } else {
          result.selection = {
            address: selAddr,
            sheetName: ws.Name || "",
            rowCount: rc,
            colCount: cc,
            sampleValues: extractValues(sel, SAMPLE_LIMIT),
            hasMoreRows: rc > SAMPLE_LIMIT,
          };
        }
      }
    } catch (e3) {
    }

    try {
      if (ws) {
        var ur = ws.UsedRange;
        if (ur) {
          var urc = 1,
            ucc = 1;
          try {
            urc = ur.Rows.Count;
          } catch (e) {}
          try {
            ucc = ur.Columns.Count;
          } catch (e) {}
          result.usedRange = {
            address: getAddress(ur),
            rowCount: urc,
            colCount: ucc,
            sampleValues: extractValues(ur, SAMPLE_LIMIT),
            hasMoreRows: urc > SAMPLE_LIMIT,
          };
        }
      }
    } catch (e4) {
    }

    return result;
  }

  // ── 定时上报 ──

  function pushContextToProxy() {
    try {
      var ctx = readWpsContext();
      fetch(PROXY_URL + "/wps-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ctx),
      }).catch(function () {});
    } catch (e) {}
  }

  setTimeout(pushContextToProxy, 1000);
  setInterval(pushContextToProxy, 2000);

  // ── 代码执行桥 ──

  function pollAndExecuteCode() {
    fetch(PROXY_URL + "/pending-code")
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.pending) return;

        var id = data.id;
        var code = data.code;
        var result = null;
        var error = null;

        try {
          var _cellHelper =
            "function __CELL(ws,r,c){" +
            'var s="";var n=c;while(n>0){n--;s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26);}' +
            "return ws.Range(s+r);" +
            "}\n";
          var _safeCode =
            _cellHelper + code.replace(/(\b\w+)\.Cells\s*\(/g, "__CELL($1,");

          var fn = new Function(
            "Application",
            "ActiveWorkbook",
            "ActiveSheet",
            "Selection",
            _safeCode,
          );
          result = fn(
            Application,
            Application.ActiveWorkbook,
            Application.ActiveWorkbook.ActiveSheet,
            Application.Selection,
          );
          if (result === undefined || result === null) {
            result = "执行成功（无返回值）";
          } else {
            result = String(result);
          }
        } catch (e) {
          error = e.message || String(e);
        }

        fetch(PROXY_URL + "/code-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id, result: result, error: error }),
        }).catch(function () {});

        pushContextToProxy();
      })
      .catch(function () {});
  }

  setInterval(pollAndExecuteCode, 500);

  // ── Ribbon UI ──

  window.ribbon_bindUI = function (bindUI) {
    bindUI({
      OnOpenClaudePanel: OnOpenClaudePanel,
      OnOpenJSDebugger: OnOpenJSDebugger,
      GetClaudeIcon: GetClaudeIcon,
      GetDebugIcon: GetDebugIcon,
      OnAddinLoad: OnAddinLoad,
    });
  };
}
