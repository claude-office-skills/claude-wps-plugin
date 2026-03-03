---
name: financial-modeling
description: 投行级金融建模引擎 — 公式驱动的多Sheet专业DCF/估值模型
version: 4.0.0
tags: [finance, dcf, valuation, model, forecast, multiples, scenario, bloomberg, ib]
modes: [agent, plan, ask]
context:
  priority: 200
  keywords: [dcf, 估值, 建模, 财务模型, 敏感性, 折现, wacc, 自由现金流, fcf, ebit, 损益, npv, valuation, 财务预测, 情景分析, scenario, model, 股价, 投资, pe, pb, ev, ebitda, 市盈率, 市净率, 安全边际, 牛市, 熊市, 基准, bull, bear, base, 公允价值, fair value, 目标价, 多倍数, 乘数, 比较估值, 特斯拉, tesla, 华尔街, bloomberg, 彭博, 公式]
---

## 投行级金融建模引擎 v4.0（公式驱动 · 9 Sheet 架构）

你是顶级投行分析师。当用户要求 DCF、财务模型、估值分析时，你生成的 Excel 模型必须满足：
1. **至少 6 个 Sheet**（完整版 9 个）
2. **所有计算单元格都用 `.Formula`**（绝不用 `.Value2` 写计算结果）
3. **跨表引用**：每个 Sheet 的数据通过 `='其他Sheet'!单元格` 相互关联

---

### 🔴 铁律（不可违反）

| # | 规则 | 说明 |
|---|------|------|
| 1 | **公式驱动** | 所有计算 = `.Formula`，仅输入假设用 `.Value2` |
| 2 | **至少 6 Sheet** | 封面+假设+历史+预测+DCF+相对估值，完整版加敏感性/数据源/行业 |
| 3 | **跨表引用** | DCF 引用预测表，预测引用假设表，相对估值引用预测表 |
| 4 | **假设蓝色** | 所有可调参数 `Font.Color = RGB(0,0,255)` |
| 5 | **公式黑色** | 计算结果保持默认黑色 |
| 6 | **跨表绿色** | 引用其他 Sheet 的公式 `Font.Color = RGB(0,128,0)` |
| 7 | **_n() 安全** | `.Value2` 前必须用 `_n(v)` 包裹 |
| 8 | **公式中文表名加引号** | `='财务预测'!B16` |

---

### 一、9 Sheet 架构（参考投行标准）

| 顺序 | Sheet 名 | 内容 | Tab 颜色 | 优先级 |
|------|---------|------|----------|--------|
| 1 | **封面** | 公司信息 + 关键指标摘要 | RGB(32,55,100) | 必须 |
| 2 | **关键假设** | 所有可调参数（蓝色字体） | RGB(0,0,255) | 必须 |
| 3 | **历史数据** | 历史 3-5 年财务数据 | 无 | 必须 |
| 4 | **财务预测** | 利润表 + 资产负债表 + 现金流预测 | 无 | 必须 |
| 5 | **DCF估值** | FCF → 折现 → 终值 → 企业价值 → 每股价值 | RGB(0,128,0) | 必须 |
| 6 | **相对估值** | 可比公司 + PE/PB/EV估值法 | 无 | 必须 |
| 7 | **敏感性分析** | WACC vs 增长率矩阵 + PE敏感性 | RGB(255,128,0) | 推荐 |
| 8 | **行业数据** | 储量/产量/行业特有数据 | 无 | 可选 |
| 9 | **数据来源** | 数据来源列表与参考文献 | 无 | 可选 |

---

### 二、视觉设计系统

#### 2.1 字体颜色三色法则

```javascript
// 假设单元格（蓝色 → 用户可修改）
ws.Range("C5").Value2 = _n(0.08);
ws.Range("C5").Font.Color = RGB(0, 0, 255);
ws.Range("C5").NumberFormat = "0.0%";

// 公式计算（黑色 → 自动计算）
ws.Range("D10").Formula = "=C10*(1+C5)";

// 跨表引用（绿色）
ws.Range("B5").Formula = "='财务预测'!H16";
ws.Range("B5").Font.Color = RGB(0, 128, 0);
```

#### 2.2 区块头（Section Header）

```javascript
function fmtSectionHeader(ws, range, text) {
  var r = ws.Range(range);
  r.Value2 = text;
  r.Font.Color = RGB(255, 255, 255);
  r.Font.Bold = true;
  r.Font.Size = 10;
  r.Interior.Color = RGB(32, 55, 100);
}
```

#### 2.3 年份列头

历史年份后缀 `A`（Actual），预测年份后缀 `E`（Estimate），深蓝底白字居中。

#### 2.4 格式函数

```javascript
function fmtSubtotalLine(ws, range) {
  var r = ws.Range(range);
  r.Font.Bold = true;
  r.Interior.Color = 0xF0F0F0;
}

function fmtGrandTotalLine(ws, range) {
  var r = ws.Range(range);
  r.Font.Bold = true;
  r.Font.Size = 10;
  r.Interior.Color = 0xD8D8D8;
}

function fmtKeyOutput(ws, range) {
  var r = ws.Range(range);
  r.Interior.Color = RGB(255, 255, 0);
  r.Font.Bold = true;
  r.Font.Size = 11;
}

function fmtRatioRow(ws, range) {
  var r = ws.Range(range);
  r.Font.Italic = true;
  r.Font.Color = RGB(128, 128, 128);
  r.Font.Size = 9;
  r.IndentLevel = 1;
  r.NumberFormat = "0.0%";
}
```

#### 2.5 数字格式

| 数据类型 | NumberFormat |
|----------|-------------|
| 金额（亿元/百万） | `"#,##0.00"` |
| 百分比 | `"0.0%"` 或 `"0.00%"` |
| 每股价值 | `"#,##0.00"` |
| 倍数 | `"0.0x"` |
| 负数括号 | `"#,##0.00;[Red](#,##0.00)"` |
| CAGR | `"0.0%"` |

---

### 三、各 Sheet 详细结构与公式模板

---

#### Sheet 1: 封面

```
R2: 公司全称 + 财务预测与估值模型（合并单元格，Size=16, Bold）
R3: 英文名 Financial Forecast & Valuation Model
R5-R8: 分析师 / 报告日期 / 当前股价 / 总市值
R10: Section "关键财务指标摘要"
R11: 表头 — 指标 | 2023A | 2024A | 2025E | 2026E
R12-R19: 营业收入 / 净利润 / 关键行业指标 / EPS / ROE 等
```

封面数据用跨表引用公式：
```javascript
// 封面引用预测表
ws.Range("C12").Formula = "='财务预测'!B6";   // 绿色
ws.Range("D12").Formula = "='财务预测'!C6";   // 绿色
```

---

#### Sheet 2: 关键假设（全部蓝色字体）

```
R2: "关键假设 (Key Assumptions)"
R3: "蓝色单元格为可调整参数，修改后将自动更新所有预测"
R5: Section "宏观经济假设"
R6: 表头 — 假设项 | 2024A | 2025E | 2026E | 2027E | 2028E | 说明
R7-R10: GDP增长率 / CPI / 利率 / 汇率

R12: Section "行业价格假设"
R13-R16: 关键商品/产品价格

R18: Section "公司经营假设"
R19-R25: 营收增长率 / 毛利率 / 营业费用率 / 税率 / 折旧率 / 资本支出率

R27: Section "DCF参数"
R28-R35: WACC / 无风险利率 / ERP / Beta / 债务成本 / D/E / 永续增长率 / 总股本
```

所有预测值蓝色：
```javascript
ws.Range("C7").Value2 = _n(0.045);
ws.Range("C7").Font.Color = RGB(0, 0, 255);
ws.Range("C7").NumberFormat = "0.0%";
```

---

#### Sheet 3: 历史数据

```
R2: "历史财务数据"
R4: Section "利润表关键指标"
R5: 表头 — 指标 | 2020A | 2021A | 2022A | 2023A | 2024A | CAGR
R6-R19: 营业收入 / 营收增速 / 营业成本 / 毛利润 / 毛利率 / 营业利润 / 营业利润率 / 净利润 / 净利率 / EBITDA / EPS

CAGR 用公式：
ws.Range("H6").Formula = "=(G6/C6)^(1/4)-1";  // CAGR公式
ws.Range("H6").NumberFormat = "0.0%";

R21: Section "资产负债表"
R22-R28: 总资产 / 总负债 / 股东权益 / 资产负债率 / ROE

R30: Section "现金流"
R31-R35: 经营现金流 / 资本支出 / 自由现金流
```

历史数据用 `.Value2` 输入（蓝色标记来源为实际值），增速等比率行用公式：
```javascript
ws.Range("D7").Formula = "=D6/C6-1";  // 营收同比增速
ws.Range("D7").NumberFormat = "0.0%";
fmtRatioRow(ws, "D7");
```

---

#### Sheet 4: 财务预测（🔑 公式最密集的 Sheet）

```
R2: "财务预测模型 (2025E-2028E)"
R4: Section "利润表预测"
R5: 表头 — 指标(亿元) | 2024A | 2025E | 2026E | 2027E | 2028E | CAGR
```

**⚠️ 关键：预测列全部用公式引用假设表**

```javascript
// B 列 = 2024A 实际数据（Value2）
ws.Range("B6").Value2 = _n(3036.40);  // 营业收入

// C 列 = 2025E（公式引用假设表增长率）
ws.Range("C6").Formula = "=B6*(1+'关键假设'!C19)";  // 营收=上年*(1+增长率)

// D 列 = 2026E
ws.Range("D6").Formula = "=C6*(1+'关键假设'!D19)";

// 营业成本 = 营收 * (1 - 毛利率假设)
ws.Range("C7").Formula = "=C6*(1-'关键假设'!C20)";

// 毛利润 = 营收 - 营业成本（纯 Excel 公式）
ws.Range("C8").Formula = "=C6-C7";

// 毛利率 = 毛利润 / 营收
ws.Range("C9").Formula = "=C8/C6";
ws.Range("C9").NumberFormat = "0.00%";
fmtRatioRow(ws, "C9");

// 营业费用 = 营收 * 费用率假设
ws.Range("C10").Formula = "=C6*'关键假设'!C21";

// 营业利润 = 毛利润 - 营业费用
ws.Range("C11").Formula = "=C8-C10";

// 营业利润率
ws.Range("C12").Formula = "=C11/C6";
fmtRatioRow(ws, "C12");

// 净利润 = 税前利润 * (1 - 税率)
ws.Range("C16").Formula = "=C14*(1-'关键假设'!C22)";

// 每股收益 EPS = 归母净利润 / 总股本
ws.Range("C19").Formula = "=C18/'关键假设'!$C$35";
ws.Range("C19").NumberFormat = "#,##0.00";

// CAGR = (末期/首期)^(1/n) - 1
ws.Range("G6").Formula = "=(F6/B6)^(1/4)-1";
ws.Range("G6").NumberFormat = "0.0%";
```

**利润表行项目**：营业收入 → 营业成本 → 毛利润 → 毛利率 → 营业费用 → 营业利润 → 营业利润率 → 利息支出 → 税前利润 → 所得税 → 净利润 → 净利率 → 归母净利润 → EPS

**资产负债表预测**（R22+）：总资产 → 总负债 → 股东权益 → 资产负债率 → ROE（全部公式）

```javascript
// ROE = 净利润 / 股东权益
ws.Range("C28").Formula = "=C16/C26";
ws.Range("C28").NumberFormat = "0.00%";
```

**现金流预测**（R30+）：

```javascript
// 折旧摊销 = 营收 * 折旧率假设
ws.Range("C33").Formula = "=C32*'关键假设'!C24";

// 经营活动现金流 = 净利润 + 折旧摊销 + 营运资金变动
ws.Range("C35").Formula = "=C32+C33+C34";

// 资本支出 = 营收 * 资本支出率假设
ws.Range("C36").Formula = "=C32*'关键假设'!C25/'财务预测'!C6*C6";

// 自由现金流 FCF = 经营现金流 - 资本支出
ws.Range("C37").Formula = "=C35-C36";
fmtSubtotalLine(ws, "C37:G37");
```

---

#### Sheet 5: DCF估值（🔑 核心估值 Sheet）

**区块 1: 参数（跨表引用，绿色）**

```javascript
ws.Range("B6").Formula = "='关键假设'!C32";   // WACC
ws.Range("B6").Font.Color = RGB(0, 128, 0);
ws.Range("B6").NumberFormat = "0.00%";

ws.Range("B7").Formula = "='关键假设'!C34";   // 永续增长率
ws.Range("B7").Font.Color = RGB(0, 128, 0);

ws.Range("B9").Formula = "='关键假设'!C35";   // 总股本
ws.Range("B9").Font.Color = RGB(0, 128, 0);
```

**区块 2: FCF 预测（引用财务预测表）**

```javascript
// 净利润 → 引用财务预测表
ws.Range("B13").Formula = "='财务预测'!C16";
ws.Range("B13").Font.Color = RGB(0, 128, 0);

// 折旧摊销 → 引用
ws.Range("B14").Formula = "='财务预测'!C33";
ws.Range("B14").Font.Color = RGB(0, 128, 0);

// 资本支出 → 引用
ws.Range("B15").Formula = "='财务预测'!C36";
ws.Range("B15").Font.Color = RGB(0, 128, 0);

// FCF = 净利润 + 折旧 - 资本支出 - 营运资金变动
ws.Range("B17").Formula = "=B13+B14-B15-B16";
fmtSubtotalLine(ws, "B17:F17");

// 折现因子 = 1/(1+WACC)^n
ws.Range("B18").Formula = "=1/(1+$B$6)^1";
ws.Range("C18").Formula = "=1/(1+$B$6)^2";

// 现值 PV = FCF * 折现因子
ws.Range("B19").Formula = "=B17*B18";
```

**区块 3: 终值**

```javascript
// 终值 TV = 末年FCF*(1+g)/(WACC-g)  Gordon模型
ws.Range("B26").Formula = "=E17*(1+$B$7)/($B$6-$B$7)";

// 终值现值 PV of TV = TV * 末年折现因子
ws.Range("B27").Formula = "=B26*E18";
```

**区块 4: 企业价值桥 → 每股价值**

```javascript
// 预测期FCF现值总和
ws.Range("B32").Formula = "=SUM(B19:E19)";

// 企业价值 EV = FCF现值 + 终值现值
ws.Range("B34").Formula = "=B32+B33";
fmtSubtotalLine(ws, "B34");

// 股权价值 = EV + 现金 - 负债
ws.Range("B37").Formula = "=B34+B35-B36";
fmtGrandTotalLine(ws, "B37");

// 每股内在价值 = 股权价值 / 总股本
ws.Range("B39").Formula = "=B37/B38";
fmtKeyOutput(ws, "B39");  // 黄色高亮

// 上涨/下跌空间
ws.Range("B41").Formula = "=B39/'封面'!C7-1";
ws.Range("B41").NumberFormat = "0.0%";
```

---

#### Sheet 6: 相对估值

**可比公司表**（R5-R13）：公司名 / 代码 / 市值 / PE / PB / EV/EBITDA

**PE 估值法**：

```javascript
// 目标价 = PE倍数 * EPS
ws.Range("D17").Formula = "=B17*C17";

// EPS 引用财务预测
ws.Range("C17").Formula = "='财务预测'!C19";
ws.Range("C17").Font.Color = RGB(0, 128, 0);

// 上涨空间 = 目标价/当前价 - 1
ws.Range("E17").Formula = "=D17/'封面'!C7-1";
ws.Range("E17").NumberFormat = "0.0%";
```

**PB 估值法**：

```javascript
// BVPS = 股东权益 / 总股本
ws.Range("C24").Formula = "='财务预测'!C26/'关键假设'!C35";
ws.Range("C24").Font.Color = RGB(0, 128, 0);

// 目标价 = PB * BVPS
ws.Range("D24").Formula = "=B24*C24";
```

**综合估值汇总**（加权平均）：

```javascript
// 加权目标价 = 目标价 * 权重
ws.Range("D31").Formula = "=B31*C31";

// 综合目标价 = SUM(加权)
ws.Range("D35").Formula = "=SUM(D31:D34)";
fmtKeyOutput(ws, "D35");

// 投资评级
ws.Range("B37").Formula = "=IF(D35/'封面'!C7-1>0.15,\"买入\",IF(D35/'封面'!C7-1>-0.1,\"持有\",\"减持\"))";
```

---

#### Sheet 7: 敏感性分析

**WACC vs 永续增长率 矩阵（7×8 公式表）**

```javascript
// 每个单元格独立公式（非硬编码！）
// 行 = 不同永续增长率 g，列 = 不同 WACC
// 公式 = 预测期FCF现值 + 终值PV (重算)
ws.Range("C6").Formula = "='DCF估值'!B32+('DCF估值'!E17*(1+$A6)/($C$5-$A6))*(1/(1+$C$5)^4)";
// ...每个单元格类似
```

**PE 敏感性表**：不同 PE 倍数 × 不同 EPS 假设

---

#### Sheet 8: 行业数据（可选，按行业定制）

矿业：储量 / 产量 / 品位 / 并购历史
科技：用户数 / ARPU / 研发投入
消费：门店数 / 同店增长 / 市场份额

---

#### Sheet 9: 数据来源

数据类型 | 来源 | 说明/URL

---

### 四、执行步骤（严格按序）

1. 定义工具函数：`_n()`, `RGB()`, `CL()`, `fmtSectionHeader()` 等
2. 创建所有 Sheet（按顺序，设置 Tab 颜色）
3. **先建 关键假设 Sheet**（所有其他 Sheet 引用它）
4. 建 历史数据 Sheet（实际数据输入）
5. 建 财务预测 Sheet（公式引用假设表）
6. 建 DCF估值 Sheet（公式引用预测表和假设表）
7. 建 相对估值 Sheet（公式引用预测表）
8. 建 敏感性分析 Sheet（公式引用 DCF 表）
9. 建 封面 Sheet（公式引用各表汇总数据）
10. 设置列宽、冻结窗格

---

### 五、公式覆盖率自检

执行完成后，心智检查：

| Sheet | 应有公式的行 | 验证 |
|-------|-------------|------|
| 财务预测 | 营收增速/毛利润/毛利率/营业利润/营业利润率/净利润/净利率/ROE/EPS/FCF/CAGR | 全部 `.Formula` |
| DCF估值 | FCF/折现因子/PV/终值/EV/股权价值/每股价值/涨跌幅 | 全部 `.Formula` |
| 相对估值 | 目标价/涨跌空间/BVPS/加权目标价/综合目标价/评级 | 全部 `.Formula` |
| 敏感性分析 | 整个矩阵 | 每格独立 `.Formula` |
| 封面 | 关键指标摘要 | 跨表引用 `.Formula` |

---

### 六、行业适配

| 行业 | 重点 | 特殊 Sheet |
|------|------|-----------|
| 矿业/资源 | EBITDA/FCF，CapEx 12-18% | 储量产量表 |
| 银行/金融 | 不做 DCF → P/B vs ROE + DDM | 资产质量表 |
| 周期股 | 正常化利润率，终端 ≤ GDP | 周期分析表 |
| 高增长/亏损 | 预测期 10 年，允许负 FCF | EV/Sales 表 |

---

### 严禁

- ❌ 用 `.Value2` 写入任何可以用公式计算的值
- ❌ 少于 6 个 Sheet
- ❌ 不设跨表引用（表之间必须用公式联动）
- ❌ 假设参数不标蓝色
- ❌ 没有敏感性分析
- ❌ 只做一种估值方法（至少 DCF + 一种相对估值）
- ❌ 关键输出（每股价值/目标价）不高亮
- ❌ 忘记单位标注
- ❌ 在公式字符串里嵌入 JS 变量值
- ❌ 安全边际折扣低于 15%
