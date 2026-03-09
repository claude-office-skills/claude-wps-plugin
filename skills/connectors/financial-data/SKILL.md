---
name: financial-data
type: connector
description: 金融数据连接器 — 通过 Data Bridge 获取实时股票、财务报表、估值比率等结构化数据
version: 2.0.0
modes: [agent, plan, ask]
context:
  keywords: [股票, 股价, 财报, 财务数据, 市盈率, 市净率, 收入, 利润, 现金流, 资产负债, ticker, 上市公司, A股, 美股, 港股, 紫金, 茅台, 苹果, apple, AAPL, 腾讯, 阿里, 特斯拉, 比亚迪, 宁德时代, 中国平安, 招商银行, 万科, 格力, 美的, PE, PB, EPS, ROE, EBITDA, beta, 分红, 股息, 市值, 企业价值, 营收, 净利, 毛利率, 负债率, yahoo, 雅虎, 数据源, 金融数据, 实时数据, 历史价格, K线, 走势]
---

## 金融数据连接器 v2.0（Data Bridge）

使用内置 `dataBridgePull()` 函数获取金融数据，**无需手写 XHR**。

### 获取综合财务数据

```javascript
var resp = dataBridgePull("yahoo-finance", "stock_info", { ticker: "AAPL" });
if (!resp || !resp.ok) return "获取数据失败: " + (resp ? resp.error : "网络错误");
var d = resp.data;

// d.summary — 公司概况
// d.keyStats — 估值指标
// d.incomeStatements — 历年损益表
// d.balanceSheets — 历年资产负债表
// d.cashFlows — 历年现金流量表
```

### 获取历史价格

```javascript
var resp = dataBridgePull("yahoo-finance", "stock_price", {
  ticker: "AAPL",
  range: "1y",
  interval: "1d"
});
if (!resp || !resp.ok) return "获取价格数据失败";
var prices = resp.data.prices; // [{date, open, high, low, close, volume}, ...]
```

### 数据字段参考

| 路径 | 字段 | 说明 |
|------|------|------|
| `d.summary` | shortName, sector, industry, currency, currentPrice, totalRevenue, grossProfit, netIncome, operatingCashflow, freeCashflow, totalCash, totalDebt, grossMargins, operatingMargins, profitMargins, ebitdaMargins, revenueGrowth, earningsGrowth, debtToEquity, returnOnEquity, returnOnAssets, fullTimeEmployees | 最新汇总 |
| `d.keyStats` | beta, trailingPE, forwardPE, priceToBook, enterpriseValue, enterpriseToRevenue, enterpriseToEbitda, pegRatio, sharesOutstanding, bookValue, dividendYield, marketCap | 估值指标 |
| `d.incomeStatements[i]` | endDate, totalRevenue, costOfRevenue, grossProfit, operatingIncome, netIncome, ebit, ebitda, interestExpense, taxProvision, researchDevelopment, sellingGeneralAdministrative | 损益表 |
| `d.balanceSheets[i]` | endDate, totalAssets, totalCurrentAssets, totalLiabilitiesNetMinorityInterest, totalCurrentLiabilities, stockholdersEquity, cashAndCashEquivalents, longTermDebt, totalDebt, netDebt, propertyPlantEquipment, inventory, receivables, minorityInterest | 资产负债 |
| `d.cashFlows[i]` | endDate, operatingCashFlow, capitalExpenditure, freeCashFlow, depreciationAndAmortization, changeInWorkingCapital | 现金流 |

### Ticker 格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 美股 | 直接代码 | AAPL, MSFT, TSLA |
| 港股 | 代码.HK | 0700.HK, 9988.HK |
| A股(沪) | 代码.SS | 601899.SS, 600519.SS |
| A股(深) | 代码.SZ | 000858.SZ, 002594.SZ |

### 单位转换（配合建模）

Yahoo Finance 返回原始单位（如元），建模统一使用 millions：

```javascript
function _n(v) { return (typeof v === "number" && isNaN(v)) ? 0 : (v == null ? 0 : v); }
function toM(v) { return _n(v) / 1000000; }

ws.Range("B3").Value2 = toM(d.incomeStatements[0].totalRevenue);
```

### 重要规则

- **使用 `dataBridgePull`**：不要手写 XHR，直接调用 `dataBridgePull("yahoo-finance", "stock_info", { ticker: "..." })`
- **检查 `resp.ok`**：数据获取可能失败，必须检查
- **单位统一到 millions**：原始数据 ÷ 1,000,000，用 `toM()` 函数
- **数据安全访问**：`d.incomeStatements && d.incomeStatements.length > 0 ? d.incomeStatements[0].totalRevenue : 0`
- **字段名全部 camelCase**
- **A 股注意后缀**：上海 .SS，深圳 .SZ
