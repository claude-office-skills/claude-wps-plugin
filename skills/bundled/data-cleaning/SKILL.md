---
name: data-cleaning
description: 数据清洗最佳实践 — 空值处理、去重、格式统一、异常值检测、分列操作
version: 1.0.0
tags: [cleaning, dedup, null, format, split]
modes: [agent, plan]
context:
  keywords: [清洗, 去重, 空值, 空白, 缺失, 异常值, 去空行, 补全, 分列, 合并列, 拆分, 填充空白, 规范化, 统一格式]
  selectionHint:
    hasEmptyCells: true
---

## 数据清洗操作规范

### 空值/空白处理策略

根据用户意图选择策略，不要自行决定删除数据：

```javascript
var ws = Application.ActiveSheet;
var ur = ws.UsedRange;
var lastRow = ur.Row + ur.Rows.Count - 1;
var lastCol = ur.Column + ur.Columns.Count - 1;

// 策略1: 删除整行空白行
for (var r = lastRow; r >= 2; r--) {
  var empty = true;
  for (var c = 1; c <= lastCol; c++) {
    if (ws.Range(CL(c) + r).Value2 !== null && ws.Range(CL(c) + r).Value2 !== "") {
      empty = false; break;
    }
  }
  if (empty) ws.Range(r + ":" + r).Delete();
}

// 策略2: 用指定值填充空白
for (var r = 2; r <= lastRow; r++) {
  if (ws.Range(CL(col) + r).Value2 === null || ws.Range(CL(col) + r).Value2 === "") {
    ws.Range(CL(col) + r).Value2 = fillValue;
  }
}

// 策略3: 用上一行值向下填充
for (var r = 3; r <= lastRow; r++) {
  if (ws.Range(CL(col) + r).Value2 === null || ws.Range(CL(col) + r).Value2 === "") {
    ws.Range(CL(col) + r).Value2 = ws.Range(CL(col) + (r - 1)).Value2;
  }
}
```

### 去重逻辑

```javascript
// 按指定列去重，保留首次出现
var seen = {};
var delRows = [];
for (var r = 2; r <= lastRow; r++) {
  var key = String(ws.Range(CL(keyCol) + r).Value2);
  if (seen[key]) { delRows.push(r); }
  else { seen[key] = true; }
}
for (var i = delRows.length - 1; i >= 0; i--) {
  ws.Range(delRows[i] + ":" + delRows[i]).Delete();
}

// 多列组合去重
var key = cols.map(function(c) { return String(ws.Range(CL(c) + r).Value2); }).join("||");
```

### 格式统一

```javascript
// 日期格式统一（文本 → 标准日期）
var v = String(ws.Range(CL(c) + r).Value2);
// 处理 2024/1/5、2024.1.5、20240105 等变体
var m = v.match(/(\d{4})[\/\.\-]?(\d{1,2})[\/\.\-]?(\d{1,2})/);
if (m) {
  ws.Range(CL(c) + r).Value2 = m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
}

// 数字格式统一
ws.Range(CL(c) + "2:" + CL(c) + lastRow).NumberFormat = "#,##0.00";

// 文本去空格/换行
var v = String(ws.Range(CL(c) + r).Value2).replace(/[\s\n\r]+/g, " ").trim();
```

### 异常值检测

```javascript
// IQR 方法检测异常值
var vals = [];
for (var r = 2; r <= lastRow; r++) {
  var v = ws.Range(CL(c) + r).Value2;
  if (typeof v === "number") vals.push(v);
}
vals.sort(function(a, b) { return a - b; });
var q1 = vals[Math.floor(vals.length * 0.25)];
var q3 = vals[Math.floor(vals.length * 0.75)];
var iqr = q3 - q1;
var lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
// 标记异常值（黄色背景）
for (var r = 2; r <= lastRow; r++) {
  var v = ws.Range(CL(c) + r).Value2;
  if (typeof v === "number" && (v < lower || v > upper)) {
    ws.Range(CL(c) + r).Interior.Color = 0x00AAFF; // 橙黄标记
  }
}
```

### 安全规则

- 清洗前询问用户策略，不要自行决定删除/修改
- 大范围操作建议先在新工作表预览结果
- 空值处理必须说明选择了哪种策略及原因
