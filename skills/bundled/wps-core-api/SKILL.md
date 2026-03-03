---
name: wps-core-api
description: WPS ET API 核心参考 — 全局变量、Range 读写、格式化、工作表操作、禁用 API
version: 2.0.0
tags: [wps, api, range, format, core]
modes: [agent, plan]
context:
  always: true
metadata:
  wps:
    minVersion: "6.0"
---

## 全局变量

- `Application` / `app`：WPS 应用对象
- `ActiveWorkbook`（`wb`）：当前工作簿
- `ActiveSheet`（`ws`）：当前活动工作表
- `Selection`：当前选区

## 辅助函数（所有代码顶部必须定义）

```javascript
function CL(c){var s="";while(c>0){c--;s=String.fromCharCode(65+(c%26))+s;c=Math.floor(c/26);}return s;}
function _n(v){return (v===null||v===undefined||isNaN(v))?0:Number(v);}
function toM(v){return _n(v)/1e6;}
```

---

## 核心 API（同步执行，非 Excel.run 模式）

### 读写数据

```javascript
ws.Range("A1").Value2 = "文本";
ws.Range("A1:C3").Value2 = [["a","b","c"],["d","e","f"]];
var vals = ws.Range("A1:C3").Value2;
ws.Range(CL(col)+row).Value2 = 123;
ws.Range("A1").Formula = "=SUM(B1:B10)";
ws.Range("A1:Z100").ClearContents();
ws.Range("A1:Z100").ClearFormats();
ws.Range("A1:Z100").Clear();
```

### 动态区域定位（避免硬编码行数）

```javascript
// End() 方向必须用数字：4=xlDown, 3=xlUp, 2=xlRight, 1=xlLeft
var lastRow = ws.Range("A1").End(4).Row;
var lastRow = ws.Range("A65536").End(3).Row;
var used = ws.UsedRange;
var lastRow = used.Row + used.Rows.Count - 1;

ws.Range("A1").Offset(1, 0).Value2 = "A2";
var r = ws.Range("A1").Resize(10, 5);
var dataRange = ws.Range("A1").CurrentRegion;
```

### 格式化

```javascript
range.Font.Bold = true;
range.Font.Size = 14;
range.Font.Color = 0xFFFFFF;        // BGR 格式
range.Font.Name = "微软雅黑";
range.Font.Italic = true;
range.Interior.Color = 0x8B4513;
range.HorizontalAlignment = -4108; // -4108=居中, -4131=左, -4152=右
range.VerticalAlignment   = -4108;
range.WrapText = true;
range.ShrinkToFit = true;
range.Orientation = 90;             // 文字旋转角度
range.IndentLevel = 2;
range.NumberFormat = "#,##0.00";
range.NumberFormat = "0.00%";
range.NumberFormat = "yyyy-mm-dd";
range.NumberFormat = "#,##0.0,,"M""; // 百万M
range.Locked = false;               // 配合工作表保护
```

### 尺寸与合并

```javascript
ws.Range("A:A").ColumnWidth = 15;
ws.Range("1:1").RowHeight = 30;
ws.Range("A1:P1").Merge();
ws.Range("A1:P1").UnMerge();
```

### 行列操作

```javascript
ws.Range("5:5").Insert();
ws.Range("5:5").Delete();
ws.Range("3:5").Hidden = true;
ws.Range("A:C").Hidden = true;
```

### 排序（Range.Sort）

```javascript
// 按 B 列升序（1=升序/xlAscending, 2=降序; Header 1=xlYes有表头）
ws.Range("A1:E100").Sort(ws.Range("B1"), 1, null, null, null, null, null, 1);

// 多列排序：B升序再C降序
ws.Range("A1:E100").Sort(ws.Range("B1"), 1, ws.Range("C1"), null, 2, null, null, 1);
```

### 查找与替换

```javascript
var found = ws.Range("A:A").Find("目标值");
if (found) { var row = found.Row; }

ws.Range("A1:Z100").Replace("旧值", "新值");
```

### 复制与填充

```javascript
ws.Range("A1:C10").Copy(ws.Range("E1"));
ws.Range("A1:A2").AutoFill(ws.Range("A1:A20"));
ws.Range("A1:E1").FillDown();
```

### 数据验证

```javascript
ws.Range("J4:J100").Validation.Add(3, 1, 1, "选项A,选项B,选项C");
```

### 条件格式

```javascript
range.FormatConditions.Delete();
var fc = range.FormatConditions.Add(1, 5, 0); // 1=xlCellValue, 5=xlGreater
fc.Interior.Color = 0x00AA00;
fc.Font.Color = 0xFFFFFF;
```

### 行列分组（财务模型折叠）

```javascript
ws.Range("5:10").Group();
ws.Range("B:D").Group();
ws.Range("5:10").Ungroup();
ws.Outline.ShowLevels(1);   // 折叠到第1级
ws.Outline.ShowLevels(2);
```

### 自动筛选

```javascript
ws.Range("A1:A10").AutoFilter();
ws.Range("A1").AutoFilter(2, ">1000");
ws.ShowAllData();
```

### 去重

```javascript
ws.Range("A1:E100").RemoveDuplicates([1, 2], 1);
```

---

## 工作表操作

```javascript
// 创建（WPS 特殊：Add() 返回 null，必须用 ActiveSheet）
wb.Sheets.Add();
var ws = wb.ActiveSheet;
ws.Name = "新工作表";

// 访问（必须用 .Item()）
var ws = wb.Sheets.Item("Sheet1");
var ws = wb.Sheets.Item(1);
var count = wb.Sheets.Count;

// 属性
ws.Visible = false;
ws.Tab.Color = 0x0055D9;   // 标签颜色 BGR
ws.Activate();

// 复制/移动/删除
ws.Copy(null, wb.Sheets.Item(wb.Sheets.Count));
Application.DisplayAlerts = false;
ws.Delete();
Application.DisplayAlerts = true;

// 保护
ws.Protect("密码");
ws.Unprotect("密码");

// 命名区域
wb.Names.Add("收入", "=财务!:");
ws.Names.Add("本表总计", ws.Range("E100"));
```

---

## 图表操作

```javascript
// 必须用 Shapes.AddChart2（ChartObjects.Add 不可用）
// 类型：57=折线, 51=簇状柱形, 5=面积, 65=饼图
var shape = ws.Shapes.AddChart2(-1, 57, left, top, width, height);
var chart = shape.Chart;
chart.HasTitle = true;
chart.ChartTitle.Text = "标题";
chart.SetSourceData(ws.Range("A1:C20"));

var s = chart.SeriesCollection(1);
s.Name = "系列名";
s.XValues = ws.Range("A2:A20");
s.Values  = ws.Range("B2:B20");
```

---

## Application 级别

```javascript
// 大批量操作前必须关闭，操作后必须恢复
Application.ScreenUpdating = false;
Application.DisplayAlerts  = false;
// ... 操作 ...
Application.ScreenUpdating = true;
Application.DisplayAlerts  = true;

// 内置工作表函数
Application.WorksheetFunction.Sum(ws.Range("B2:B100"));
Application.WorksheetFunction.Average(ws.Range("B2:B100"));
Application.WorksheetFunction.VLookup("key", ws.Range("A:B"), 2, false);
Application.WorksheetFunction.Max(ws.Range("C:C"));
Application.WorksheetFunction.CountIf(ws.Range("A:A"), ">0");

// 合并不连续区域
var union = Application.Union(ws.Range("A1:A10"), ws.Range("C1:C10"));
union.Font.Bold = true;
```

---

## BGR 常用颜色速查

| 用途 | BGR 值 | RGB 等价 |
|------|--------|---------|
| 深蓝表头/品牌色 | `0x8B4513` | `#13458B` |
| 鲜明蓝（图表主色）| `0xFF4500` | `#0045FF` |
| 橙色强调 | `0x0055D9` | `#D95500` |
| 金橙色（图表柱状）| `0xE8A040` | `#40A0E8` |
| 浅灰背景 | `0xF0F0F0` | `#F0F0F0` |
| 浅蓝交替行 | `0xFFF0E0` | `#E0F0FF` |
| 白色 | `0xFFFFFF` | `#FFFFFF` |
| 黑色 | `0x000000` | `#000000` |
| 红色（跌/警告）| `0x0000FF` | `#FF0000` |
| 绿色（涨/完成）| `0x00AA00` | `#00AA00` |
| 橙黄（进行中）| `0x00AAFF` | `#FFAA00` |
| 蓝色（信息）| `0xFF8800` | `#0088FF` |

---

## ❌ 不可用 API（WPS 加载项严禁，会崩溃）

| 禁用 API | 原因 | 正确替代 |
|---------|------|---------|
| `ws = wb.Sheets.Add()` | 返回 null | `wb.Sheets.Add(); ws = wb.ActiveSheet;` |
| `ws.Cells(row, col)` | 不支持 | `ws.Range(CL(col)+row)` |
| `ws.Rows(n)` | 不可用 | `ws.Range("n:n")` |
| `ws.Columns("A")` | 不可用 | `ws.Range("A:A")` |
| `ws.Columns("A").AutoFit()` | 不可用 | 手动设 `ColumnWidth` |
| `ws.ListObjects` | 不可用 | 普通 Range 模拟 |
| `ws.ChartObjects.Add()` | 不可用 | `ws.Shapes.AddChart2()` |
| `.Borders` / `.BorderAround()` | 直接崩溃 | 用背景色区分区域 |
| `wb.Sheets("名称")` | 括号形式不可用 | `wb.Sheets.Item("名称")` |
| `End(xlDown)` 字面量 | 枚举不可用 | 用数字：4=下,3=上,2=右,1=左 |

## ⚠️ WPS 特殊注意

1. **颜色是 BGR 不是 RGB**：`0xFF0000` = 蓝色！红色是 `0x0000FF`
2. **Sheets.Add() 返回 null**，必须用 `wb.ActiveSheet` 获取新表
3. **End() 用数字**：4=xlDown, 3=xlUp, 2=xlRight, 1=xlLeft
4. **大批量写入前**必须 `Application.ScreenUpdating = false`，否则 WPS 崩溃
5. **边框完全不可用**：用深色背景+白字替代视觉分隔
