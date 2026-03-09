---
name: data-analysis
description: 数据解读与分析 — 统计方法、趋势分析、透视汇总、结论输出规范
version: 1.0.0
tags: [analysis, statistics, insight, trend, pivot]
modes: [agent, plan, ask]
context:
  keywords: [分析, 报告, 洞察, 趋势, 统计, 均值, 标准差, 归因, 汇总分析, 透视, 对比, 环比, 同比, 描述性统计, 占比, 分布, 相关性, 回归, 预测]
---

## 数据分析输出规范

### 核心原则

- 分析结果必须新建工作表，不修改原始数据
- 结果包含：数据概况 → 统计指标 → 可视化 → 结论
- 所有计算用 .Formula 写入，用户可溯源验证

### 新建分析表的标准结构

```javascript
function CL(c){var s="";while(c>0){c--;s=String.fromCharCode(65+(c%26))+s;c=Math.floor(c/26);}return s;}
var wb = Application.ActiveWorkbook;
var srcWs = Application.ActiveSheet;
var srcName = srcWs.Name;

wb.Sheets.Add();
var ws = Application.ActiveSheet;
ws.Name = "数据分析";
ws.Activate();

// 区域 A: 标题
ws.Range("A1").Value2 = "数据分析报告 — " + srcName;
ws.Range("A1").Font.Size = 16;
ws.Range("A1").Font.Bold = true;
ws.Range("A1").Interior.Color = 0x8B4513;
ws.Range("A1").Font.Color = 0xFFFFFF;

// 区域 B: 数据概况
ws.Range("A3").Value2 = "数据概况";
ws.Range("A3").Font.Bold = true;
ws.Range("A4").Value2 = "数据源";
ws.Range("B4").Value2 = srcName;
ws.Range("A5").Value2 = "总行数";
ws.Range("B5").Formula = "=COUNTA('" + srcName + "'!A:A)-1";
// ... 列数、空值数等

// 区域 C: 描述性统计表
// 每个数值列: 均值/中位数/最大/最小/标准差/四分位
```

### 描述性统计公式

| 指标 | 公式 |
|------|------|
| 均值 | `=AVERAGE('源表'!B2:B1000)` |
| 中位数 | `=MEDIAN('源表'!B2:B1000)` |
| 标准差 | `=STDEV('源表'!B2:B1000)` |
| 最大值 | `=MAX('源表'!B2:B1000)` |
| 最小值 | `=MIN('源表'!B2:B1000)` |
| 计数 | `=COUNTA('源表'!B2:B1000)` |
| 空值数 | `=COUNTBLANK('源表'!B2:B1000)` |

### 趋势与对比分析

```javascript
// 环比增长率
ws.Range("C" + r).Formula = "=('" + srcName + "'!B" + r + "-'" + srcName + "'!B" + (r-1) + ")/'" + srcName + "'!B" + (r-1);
ws.Range("C" + r).NumberFormat = "0.0%";

// 占比计算
ws.Range("D" + r).Formula = "='" + srcName + "'!B" + r + "/SUM('" + srcName + "'!B2:B" + lastRow + ")";
ws.Range("D" + r).NumberFormat = "0.0%";
```

### 透视汇总（手动实现）

WPS 加载项中不支持 PivotTable API，需手动聚合：

```javascript
// 按分类列汇总
var groups = {};
for (var r = 2; r <= lastRow; r++) {
  var cat = String(ws.Range(CL(catCol) + r).Value2);
  var val = Number(ws.Range(CL(valCol) + r).Value2) || 0;
  if (!groups[cat]) groups[cat] = { sum: 0, count: 0 };
  groups[cat].sum += val;
  groups[cat].count++;
}
// 写入汇总表
var keys = Object.keys(groups);
for (var i = 0; i < keys.length; i++) {
  ws.Range("A" + (startRow + i)).Value2 = keys[i];
  ws.Range("B" + (startRow + i)).Value2 = groups[keys[i]].sum;
  ws.Range("C" + (startRow + i)).Value2 = groups[keys[i]].count;
  ws.Range("D" + (startRow + i)).Value2 = groups[keys[i]].sum / groups[keys[i]].count;
}
```

### 分析结论输出

在分析表底部，用文本形式写出关键发现：

```javascript
var conclusionRow = lastOutputRow + 2;
ws.Range("A" + conclusionRow).Value2 = "分析结论";
ws.Range("A" + conclusionRow).Font.Bold = true;
ws.Range("A" + conclusionRow).Font.Size = 14;
// 结论内容由 AI 根据计算结果生成
ws.Range("A" + (conclusionRow + 1)).Value2 = "1. 总销售额为 XXX 万元，环比增长 XX%";
ws.Range("A" + (conclusionRow + 2)).Value2 = "2. TOP3 品类占总额的 XX%";
```
