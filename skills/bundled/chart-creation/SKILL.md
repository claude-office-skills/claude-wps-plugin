---
name: chart-creation
description: WPS 图表创建 — AddChart2 方法、图表类型、配色方案、最佳实践
version: 1.0.0
tags: [chart, visualization, wps]
modes: [agent, plan]
context:
  keywords: [图表, 折线图, 柱状图, 饼图, 可视化, chart, 趋势, 走势, 成交量]
metadata:
  wps:
    requires:
      apis: [Shapes.AddChart2]
---

## 图表创建（WPS JS API）

⚠️ 重要：WPS 加载项中创建图表必须使用 ws.Shapes.AddChart2() 方法！
❌ 禁止使用 ws.ChartObjects.Add()（WPS 中不支持此方法）

AddChart2(Style, XlChartType, Left, Top, Width, Height) 参数：
- Style：图表样式编号（必须用 0 或正整数，禁止 -1）
- XlChartType：4=xlLine(折线), 51=xlColumnClustered(柱状), 5=xlPie(饼图), 54=xlColumnStacked(堆叠柱状)
- Left/Top/Width/Height：位置和大小（像素）

### 不支持的图表类型（会崩溃或空白）

- ❌ K线图/蜡烛图/OHLC (88/89/90) — WPS 不支持
- ❌ 股价图 (88/89/90) — WPS 不支持
- 股价数据请改用折线图（收盘价走势）+ 柱状图（成交量），分两个图表展示

### 图表最佳实践

- 每个图表至少 560×320 像素，别太小
- 多个图表之间留 340px 纵向间距
- 一个图表只展示一个主题，别把所有数据塞一张图

### 图表颜色和样式

创建图表后，必须为每条数据系列单独设置颜色，避免默认灰色：

```javascript
try {
  var dataRange = ws.Range("A1:C20");
  var lastRow = 20;
  var chartTop = (lastRow + 2) * 20;
  var shape = ws.Shapes.AddChart2(0, 4, 20, chartTop, 600, 340);
  var chart = shape.Chart;
  chart.SetSourceData(dataRange);
  chart.HasTitle = true;
  chart.ChartTitle.Text = "趋势分析";

  try {
    chart.SeriesCollection(1).Format.Line.ForeColor.RGB = 0xFF4500;
    chart.SeriesCollection(1).Format.Line.Weight = 2.5;
    chart.SeriesCollection(2).Format.Line.ForeColor.RGB = 0x0000FF;
    chart.SeriesCollection(2).Format.Line.Weight = 2.5;
    chart.SeriesCollection(3).Format.Line.ForeColor.RGB = 0x00AA00;
    chart.SeriesCollection(3).Format.Line.Weight = 2.5;
  } catch(ce) {}

  try {
    chart.SeriesCollection(1).Format.Fill.ForeColor.RGB = 0xE8A040;
  } catch(ce) {}
} catch(e) {
  ws.Range("F1").Value2 = "趋势";
  for (var i = 2; i <= lastRow; i++) {
    var cur = ws.Range("B"+i).Value2, prev = ws.Range("B"+(i-1)).Value2;
    ws.Range("F"+i).Value2 = cur > prev ? "▲" : (cur < prev ? "▼" : "→");
  }
}
```

### 图表配色方案（BGR 格式）

| 用途 | BGR 颜色值 | 视觉效果 |
|------|-----------|---------|
| 系列1(主线/收盘价) | 0xFF4500 | 鲜明蓝 |
| 系列2(对比线/开盘价) | 0x0000FF | 红色 |
| 系列3(辅助线/均价) | 0x00AA00 | 绿色 |
| 系列4(参考线) | 0x00CCFF | 橙色 |
| 柱状图(成交量) | 0xE8A040 | 金橙色 |
| 涨日柱 | 0x0000FF | 红色 |
| 跌日柱 | 0x00AA00 | 绿色 |

⚠️ 图表代码必须包裹在 try/catch 中。颜色设置也要 try/catch。
