---
name: financial-data
type: connector
description: 金融数据连接器 — 通过 Yahoo Finance 获取实时股票、财务报表、估值比率等结构化数据，供投行级模型使用
version: 1.3.0
modes: [agent, plan, ask]
context:
  keywords: [股票, 股价, 财报, 财务数据, 市盈率, 市净率, 收入, 利润, 现金流, 资产负债, ticker, 上市公司, A股, 美股, 港股, 紫金, 茅台, 苹果, apple, AAPL, 腾讯, 阿里, 特斯拉, 比亚迪, 宁德时代, 中国平安, 招商银行, 万科, 格力, 美的, PE, PB, EPS, ROE, EBITDA, beta, 分红, 股息, 市值, 企业价值, 营收, 净利, 毛利率, 负债率, yahoo, 雅虎, 数据源, 金融数据, 实时数据, 历史价格, K线, 走势]
---

## 金融数据连接器（Yahoo Finance）v1.3

本插件内置 Yahoo Finance 数据接口，获取全球上市公司的结构化金融数据。数据缓存 1 小时。

### 数据端点

基础地址 `http://127.0.0.1:3001`。

#### 1) 综合财务数据 `GET /finance-data/{ticker}`

返回：公司概况、关键比率、历史损益表、资产负债表、现金流量表。

```javascript
var xhr = new XMLHttpRequest();
xhr.open("GET", "http://127.0.0.1:3001/finance-data/AAPL", false);
xhr.send();
var data = JSON.parse(xhr.responseText);
```

**响应字段（全部 camelCase）：**

| 路径 | 字段 | 说明 |
|------|------|------|
| `data.summary` | shortName, sector, industry, currency, currentPrice, totalRevenue, grossProfit, netIncome, operatingCashflow, freeCashflow, totalCash, totalDebt, grossMargins, operatingMargins, profitMargins, ebitdaMargins, revenueGrowth, earningsGrowth, debtToEquity, returnOnEquity, returnOnAssets, fullTimeEmployees | 最新汇总 |
| `data.keyStats` | beta, trailingPE, forwardPE, priceToBook, enterpriseValue, enterpriseToRevenue, enterpriseToEbitda, pegRatio, sharesOutstanding, bookValue, dividendYield, marketCap | 估值指标 |
| `data.incomeStatements[i]` | endDate, totalRevenue, costOfRevenue, grossProfit, operatingIncome, netIncome, ebit, ebitda, interestExpense, taxProvision, researchDevelopment, sellingGeneralAdministrative | 历年损益表 |
| `data.balanceSheets[i]` | endDate, totalAssets, totalCurrentAssets, totalLiabilitiesNetMinorityInterest, totalCurrentLiabilities, stockholdersEquity, cashAndCashEquivalents, longTermDebt, totalDebt, netDebt, propertyPlantEquipment, inventory, receivables, minorityInterest | 历年资产负债 |
| `data.cashFlows[i]` | endDate, operatingCashFlow, capitalExpenditure, freeCashFlow, depreciationAndAmortization, changeInWorkingCapital | 历年现金流 |

#### 2) 历史价格 `GET /finance-data/{ticker}/price?range=1y&interval=1d`

```javascript
var xhr2 = new XMLHttpRequest();
xhr2.open("GET", "http://127.0.0.1:3001/finance-data/AAPL/price?range=1y&interval=1d", false);
xhr2.send();
var priceData = JSON.parse(xhr2.responseText);
```

### Ticker 格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 美股 | 直接代码 | AAPL, MSFT, TSLA |
| 港股 | 代码.HK | 0700.HK, 9988.HK |
| A股(沪) | 代码.SS | 601899.SS, 600519.SS |
| A股(深) | 代码.SZ | 000858.SZ, 002594.SZ |

### 数据获取与单位转换（配合 financial-modeling v3.0）

**重要**：Yahoo Finance 返回的是原始单位（如人民币元），模型统一使用 **millions**，因此需要除以 1,000,000：

```javascript
function _n(v) { return (typeof v === "number" && isNaN(v)) ? 0 : (v == null ? 0 : v); }
function RGB(r,g,b) { return r + g*256 + b*65536; }
function toM(v) { return _n(v) / 1000000; }

var xhr = new XMLHttpRequest();
xhr.open("GET", "http://127.0.0.1:3001/finance-data/" + ticker, false);
xhr.send();
if (xhr.status !== 200) return "获取数据失败: " + xhr.statusText;
var data = JSON.parse(xhr.responseText);
if (data.error) return "数据源错误: " + data.error;

// 写入 Income Statement 历史数据时使用 toM() 转百万
ws.Range("B3").Value2 = toM(data.incomeStatements[0].totalRevenue);
```

### Cover 页数据填充

```javascript
// 从 data.summary 和 data.keyStats 填充 Cover 页
ws.Range("D8").Value2 = data.ticker;
ws.Range("D9").Value2 = data.summary.currency || "RMB";
ws.Range("D10").Value2 = "~RMB " + Math.round(_n(data.keyStats.marketCap)/1e9) + "B";
ws.Range("D11").Value2 = Math.round(_n(data.keyStats.sharesOutstanding)/1e6).toLocaleString() + "M";
ws.Range("B8").Value2 = data.summary.sector || "N/A";
ws.Range("B9").Value2 = data.summary.industry || "N/A";
ws.Range("B11").Value2 = data.summary.fullTimeEmployees ? "~" + data.summary.fullTimeEmployees.toLocaleString() : "N/A";
```

### 重要规则

- **先获取数据再建模型**：永远先创建数据表，模型表用公式引用数据表
- **单位统一到 millions**：原始数据 ÷ 1,000,000，用 `toM()` 函数
- **数据异常处理**：xhr.status !== 200 时告知用户
- **A 股注意后缀**：上海 .SS，深圳 .SZ
- **字段名全部 camelCase**：totalRevenue, grossProfit, costOfRevenue 等
- **禁止在公式中拼接 JS 变量**：公式只能包含单元格引用、常量和 Excel 函数
- **跨表引用中文表名加单引号**：`='数据源_601899'!B11`
