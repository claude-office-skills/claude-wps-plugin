---
name: wps-core-api
description: WPS ET API 核心参考 — 全局变量、Range 读写、格式化、工作表操作、禁用 API
version: 1.0.0
tags: [wps, api, range, format, core]
modes: [agent, plan]
context:
  always: true
metadata:
  wps:
    minVersion: "6.0"
---

## 全局变量

- Application / app：WPS 应用对象
- ActiveWorkbook：当前工作簿
- ActiveSheet：当前活动工作表
- Selection：当前选区

## 动态单元格访问 — CL() 辅助函数（必须使用）

在所有代码顶部定义此函数，用于将列号转为字母：

```javascript
function CL(c){var s="";while(c>0){c--;s=String.fromCharCode(65+(c%26))+s;c=Math.floor(c/26);}return s;}
```

用法：
- ws.Range(CL(3)+"5").Value2 = 100;   // 等价于 C5
- ws.Range(CL(c)+r).Value2 = data;    // 动态行列

## 核心 API（同步执行，非 Excel.run 模式）

### 读写数据

- ws.Range("A1").Value2 = "文本";
- ws.Range("A1:C3").Value2 = [["a","b","c"],["d","e","f"],["g","h","i"]];
- var vals = ws.Range("A1:C3").Value2;  // 返回 2D 数组
- ws.Range(CL(col)+row).Value2 = 123;  // 动态行列访问

### 格式化

- range.Font.Bold = true;
- range.Font.Size = 14;
- range.Font.Color = 0xFFFFFF;          // 0xBBGGRR（BGR 格式）
- range.Font.Name = "微软雅黑";
- range.Interior.Color = 0x8B4513;      // 背景色 BGR
- range.HorizontalAlignment = -4108;    // -4108=居中, -4131=左对齐, -4152=右对齐
- range.VerticalAlignment = -4108;      // 垂直居中
- range.WrapText = true;                // 自动换行
- range.NumberFormat = "#,##0.00";       // 数字格式
- range.NumberFormat = "yyyy-mm-dd";     // 日期格式
- range.NumberFormat = "0.00%";          // 百分比格式

### 尺寸与合并

- ws.Range("A:A").ColumnWidth = 15;
- ws.Range("1:1").RowHeight = 30;
- ws.Range("A1:P1").Merge();
- ws.Range("A1:P1").MergeCells = true;

### 行列操作

- ws.Range("5:5").Insert();             // 插入行
- ws.Range("A1:A10").AutoFilter();       // 自动筛选

### 工作表

- wb.Sheets.Item(1).Name                // 获取表名
- wb.Sheets.Add(); var ws = wb.ActiveSheet; ws.Name = "新表";  // Add() 返回 null，必须用 ActiveSheet
- ws.Activate();                        // 新建后必须激活

### 数据验证

- ws.Range("J4:J100").Validation.Add(3, 1, 1, "选项1,选项2,选项3");

## 不可用 API（严禁使用，会报错！）

- ❌ ws = wb.Sheets.Add() — Add() 返回 null！必须写成：wb.Sheets.Add(); ws = wb.ActiveSheet;
- ❌ ws.Cells() — 严禁使用！必用 ws.Range(CL(col)+row) 代替
- ❌ ws.Rows() — 严禁使用！用 ws.Range("5:5") 代替
- ❌ ws.Columns() — 不可用，用 ws.Range("A:A") 代替
- ❌ ws.Columns("A").AutoFit() — 不可用
- ❌ ws.ListObjects — 不可用
- ❌ ws.ChartObjects.Add() — 不可用，必须用 ws.Shapes.AddChart2()
- ❌ .Borders — 严禁使用！ws.Range(...).Borders 会直接报错崩溃
- ❌ .BorderAround() — 会直接报错崩溃
- ⚠️ WPS 加载项中不支持任何边框 API，完全不要尝试设置边框
- 替代方案：用背景色区分区域（如表头深色背景 + 白色文字）
- ⚠️ 访问工作表必须用 wb.Sheets.Item("名称") 或 wb.Sheets.Item(1)，禁止 wb.Sheets("名称")

## BGR 常用颜色速查

| 用途 | BGR 值 | RGB 等价 |
|------|--------|---------|
| 深蓝表头/品牌色 | 0x8B4513 | #13458B |
| 鲜明蓝(图表主色) | 0xFF4500 | #0045FF |
| 橙色强调 | 0x0055D9 | #D95500 |
| 金橙色(图表柱状) | 0xE8A040 | #40A0E8 |
| 浅灰背景 | 0xF0F0F0 | #F0F0F0 |
| 浅蓝交替行 | 0xFFF0E0 | #E0F0FF |
| 白色 | 0xFFFFFF | #FFFFFF |
| 黑色 | 0x000000 | #000000 |
| 红色 | 0x0000FF | #FF0000 |
| 绿色(完成/涨) | 0x00AA00 | #00AA00 |
| 橙黄(进行中/警告) | 0x00AAFF | #FFAA00 |
| 蓝色(信息) | 0xFF8800 | #0088FF |
