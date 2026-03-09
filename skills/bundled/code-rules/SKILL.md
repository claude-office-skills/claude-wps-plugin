---
name: code-rules
description: WPS 代码生成规则 — 单块规则、禁止拆分、数据保护、新建工作表模式
version: 1.0.0
tags: [code, rules, safety]
modes: [agent, plan]
context:
  always: true
---

## 代码生成规则（严格遵守）

⚠️ 最重要的规则：所有操作必须在一个代码块中完成！

### 绝对禁止拆分代码

- 禁止将代码拆成 "Part 1", "Part 2", "Part 3" 等多段
- 禁止写 "先运行这段，再运行下一段"
- 无论任务多复杂（DCF 建模、财务分析、仪表板），都必须在一个 javascript 块中完成
- 如果代码太长（>300行），优先简化设计而非拆分代码

### 代码规范

1. 一个代码块完成所有逻辑（不可拆分！）
2. 代码顶部必须定义 CL() 辅助函数
3. 禁止使用 ws.Cells()、ws.Rows()、ws.Columns()，全部用 ws.Range() 替代
4. 代码最后一行是返回值字符串
5. 始终用中文回复和注释
6. 列宽用 ws.Range("A:A").ColumnWidth = N
7. 行高用 ws.Range("1:1").RowHeight = N

### ⚠️ 始终使用 ActiveSheet（禁止硬编码 sheet 名称）

操作当前表时，必须用 `Application.ActiveSheet`，绝对不要用 `wb.Sheets.Item("表名")` 硬编码 sheet 名称。因为用户可能已经重命名了 sheet，硬编码名称会导致代码操作错误的 sheet 或报错。

```javascript
// ✅ 正确
var ws = Application.ActiveSheet;

// ❌ 错误：sheet 可能已被重命名
// var ws = wb.Sheets.Item("库存管理系统");
```

仅在明确需要跨 sheet 操作（如从源表读数据写到新表）时，才通过 WPS 上下文提供的 sheetName 引用特定 sheet。

### 不要覆盖用户已有数据

- 数据分析/趋势分析/建模任务：必须新建工作表，不得在现有工作表上执行 Clear() 或覆盖数据

```javascript
// 创建新工作表（正确模式）
var wb = Application.ActiveWorkbook;
var srcWs = Application.ActiveSheet; // 先保存原始数据表引用
var ws;
try { ws = wb.Sheets.Item("分析结果"); ws.UsedRange.Clear(); } catch(e) {
  wb.Sheets.Add();
  ws = wb.ActiveSheet;
  ws.Name = "分析结果";
}
ws.Activate(); // 必须激活新工作表
// 从 srcWs 读取原始数据，写入 ws 做分析
```

- ⚠️ wb.Sheets.Add() 返回 null，必须用 wb.ActiveSheet 获取新建的工作表引用
- ⚠️ 新建工作表后必须调用 ws.Activate() 让用户能看到结果
- 仅当用户明确说"修改/替换/清除现有数据"时，才在 ActiveSheet 上操作

### WPS JSAPI 兼容性（VS Excel VBA / Office.js 关键差异）

⚠️ **这是 WPS Office JS 宏环境，不是 Excel VBA 也不是 Office.js！** 以下差异必须严格遵守：

| VBA / Office.js 写法（❌ 错误） | WPS JSAPI 写法（✅ 正确） |
|---|---|
| `ws.Cells(row, col)` | `ws.Cells.Item(row, col)` 或 `ws.Range(CL(col)+row)` |
| `ws.Rows(5)` | `ws.Range("5:5")` |
| `ws.Columns("D")` | `ws.Range("D:D")` |
| `ws.Columns("D:F")` | `ws.Range("D:F")` |
| `Worksheets(1)` | `Worksheets.Item(1)` |
| `wb.Sheets("名称")` | `wb.Sheets.Item("名称")` |
| `chart.SeriesCollection(1)` | `chart.SeriesCollection.Item(1)` |
| `Range("A1").Value` | `Range("A1").Value2`（写入）/ `Range("A1").Value()`（读取） |
| `ActiveSheet`（无前缀） | `Application.ActiveSheet` |
| `ActiveWorkbook`（无前缀） | `Application.ActiveWorkbook` |
| `[A1] = 5` | `Range("A1").Value2 = 5` |
| `.Select` / `.Activate`（无括号） | `.Select()` / `.Activate()`（必须加括号） |
| `AddChart2(-1, type, ...)` | `AddChart2(0, type, ...)`（Style -1 返回 null） |
| `chartWs.Cells.Clear()` | `chartWs.UsedRange.Clear()` |

**核心原则**：
1. 集合访问必须用 `.Item()`：`Sheets.Item(1)`、`SeriesCollection.Item(1)`
2. 方法调用必须加括号：`.Select()`、`.Activate()`、`.Clear()`
3. JS 大小写敏感：`Value2` 不是 `value2`
4. 读值用 `Value()` 方法或 `Value2` 属性；写值用 `Value2` 属性
5. 不支持 `[A1]` 方括号单元格引用（JS 会解析为解构赋值）

### 严禁

- ❌ 只生成表头不写数据
- ❌ 使用 ws.Cells()、ws.Rows()、ws.Columns()（用 ws.Range() / ws.Cells.Item()）
- ❌ 使用 ws.ChartObjects.Add()（必须用 Shapes.AddChart2）
- ❌ 使用 .Borders、.BorderAround()（WPS 不支持，会崩溃）
- ❌ 用文字描述功能代替实际代码
- ❌ 把代码拆成多个代码块
- ❌ 生成超过 300 行的代码
- ❌ 使用 Excel VBA 语法（Dim、Set、Sub/End Sub）
- ❌ 集合直接括号访问（用 .Item()）
- ❌ AddChart2 的 Style 参数用 -1 或 ChartType 用 65

✅ 图表：用户要求图表时，必须使用 ws.Shapes.AddChart2() 并包裹 try/catch 降级为趋势符号
