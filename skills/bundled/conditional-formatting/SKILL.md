---
name: conditional-formatting
description: 条件格式与表格美化 — FormatConditions API、数据条、色阶、一键美化方案
version: 1.0.0
tags: [format, conditional, beautify, color, style]
modes: [agent, plan]
context:
  keywords: [条件格式, 高亮, 标记, 颜色, 数据条, 色阶, 图标集, 美化, 着色, 红绿, 斑马纹, 交替色, 样式, 好看, 漂亮, 整齐]
---

## 条件格式 API

### FormatConditions.Add 基本用法

```javascript
// 参数: Type, Operator, Formula1, Formula2
// Type: 1=xlCellValue, 2=xlExpression
// Operator: 1=Between, 3=Equal, 5=Greater, 6=Less, 7=GreaterEqual, 8=LessEqual

// 示例: 大于 90 的单元格标绿
var rng = ws.Range("B2:B100");
var fc = rng.FormatConditions.Add(1, 5, "90");
fc.Interior.Color = 0x00AA00;
fc.Font.Color = 0xFFFFFF;

// 示例: 等于"已完成"标绿，等于"逾期"标红
var rng = ws.Range("E2:E100");
var fc1 = rng.FormatConditions.Add(1, 3, '"已完成"');
fc1.Interior.Color = 0x00AA00;
fc1.Font.Color = 0xFFFFFF;
var fc2 = rng.FormatConditions.Add(1, 3, '"逾期"');
fc2.Interior.Color = 0x0000FF;
fc2.Font.Color = 0xFFFFFF;
var fc3 = rng.FormatConditions.Add(1, 3, '"进行中"');
fc3.Interior.Color = 0xFF8800;
fc3.Font.Color = 0xFFFFFF;
```

### 基于公式的条件格式

```javascript
// 交替行斑马纹（用 xlExpression）
var fc = rng.FormatConditions.Add(2, 0, "=MOD(ROW(),2)=0");
fc.Interior.Color = 0xFFF0E0;

// 整行高亮（当 E 列="逾期" 时整行变红）
var fc = ws.Range("A2:Z100").FormatConditions.Add(2, 0, '=$E2="逾期"');
fc.Interior.Color = 0xCCCCFF;
```

### 清除条件格式

```javascript
ws.Range("A1:Z1000").FormatConditions.Delete();
```

## 一键美化方案

当用户要求"美化表格"时，按以下标准执行：

```javascript
function CL(c){var s="";while(c>0){c--;s=String.fromCharCode(65+(c%26))+s;c=Math.floor(c/26);}return s;}
var ws = ActiveSheet;
var ur = ws.UsedRange;
var r1 = ur.Row, c1 = ur.Column;
var rEnd = r1 + ur.Rows.Count - 1;
var cEnd = c1 + ur.Columns.Count - 1;

// 1. 表头样式（首行）
var hdr = ws.Range(CL(c1) + r1 + ":" + CL(cEnd) + r1);
hdr.Font.Bold = true;
hdr.Font.Color = 0xFFFFFF;
hdr.Interior.Color = 0x8B4513;
hdr.HorizontalAlignment = -4108;
ws.Range(r1 + ":" + r1).RowHeight = 32;

// 2. 数据区域
var data = ws.Range(CL(c1) + (r1 + 1) + ":" + CL(cEnd) + rEnd);
data.Font.Size = 11;
data.VerticalAlignment = -4108;

// 3. 交替行背景色
for (var r = r1 + 1; r <= rEnd; r++) {
  if ((r - r1) % 2 === 0) {
    ws.Range(CL(c1) + r + ":" + CL(cEnd) + r).Interior.Color = 0xFFF0E0;
  }
}

// 4. 自动列宽
for (var c = c1; c <= cEnd; c++) {
  ws.Range(CL(c) + ":" + CL(c)).ColumnWidth = 15;
}

// 5. 数字列自动格式化
// 检测列内容类型，设置合适的 NumberFormat
```

### 美化配色方案

| 方案 | 表头 BGR | 交替行 BGR | 适用场景 |
|------|---------|-----------|---------|
| 商务蓝 | 0x8B4513 | 0xFFF0E0 | 通用/报表 |
| 清新绿 | 0x006633 | 0xE0FFE0 | 数据分析 |
| 优雅灰 | 0x666666 | 0xF5F5F5 | 简约/打印 |
| 活力橙 | 0x0055D9 | 0xE0EEFF | 营销/展示 |
