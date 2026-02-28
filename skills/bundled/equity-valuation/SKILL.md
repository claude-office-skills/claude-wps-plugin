---
name: equity-valuation
description: 股票估值报告引擎 — 数据质量门控/多方法估值/质量评估/风险矩阵/决策框架的 Excel 完整估值工作簿
version: 1.0.0
tags: [equity, valuation, investment, report, dcf, multiples, risk]
modes: [agent, plan, ask]
context:
  keywords: [估值报告, 投资分析, 股票分析, 投资备忘录, 目标价, 买入, 卖出, 持有, 基本面, 便宜, 贵, 低估, 高估, 投资价值, 值不值得买, 选股, 对比分析, 质量评估, 风险评估, 置信度, 安全边际, margin of safety, investment memo, thesis, risk register]
---

## 股票估值报告引擎（决策级完整工作簿）

当用户要求"给这只股票估值"/"值不值得买"/"对比 A 和 B"/"写投资备忘录"时，你生成的是**包含完整估值逻辑链的多 Sheet Excel 工作簿** — 从数据验证到最终投资结论，每步可审计、可调参。

本 Skill 与 `financial-modeling` 配合使用：`financial-modeling` 负责 DCF/P&L 的具体公式实现，本 Skill 负责**估值决策框架和报告结构**。

---

### 工作簿结构（7 个 Sheet）

| # | Sheet 名称 | 核心内容 |
|---|-----------|---------|
| 1 | 数据总览 | 数据源/日期/质量评分/置信度等级 |
| 2 | 核心假设 | Bull/Base/Bear 三情景参数面板 |
| 3 | 相对估值 | P/E / P/B / EV/EBITDA 同行对比表 |
| 4 | DCF 模型 | FCF预测 + 折现 + 终端价值（调用 financial-modeling 规范） |
| 5 | 质量评估 | 6维企业质量打分矩阵 |
| 6 | 风险矩阵 | 风险事件 × 概率 × 影响 × 监控触发器 |
| 7 | 估值结论 | 三角验证 + 安全边际 + 投资结论仪表盘 |

---

### Sheet 1：数据总览与质量门控

这是模型的"入口检查"——先验证数据质量再做估值：

```javascript
// 数据质量评分（公式驱动）
// 完整性得分 = 已填字段数 / 总必填字段数
ws.Range("C8").Formula = "=COUNTA(C12:C25)/14";
ws.Range("C8").NumberFormat = "0%";

// 时效性标记
ws.Range("C9").Value2 = "2024-12-31";  // 最新财报期（蓝色可编辑）
ws.Range("D9").Formula = '=IF(TODAY()-DATEVALUE(C9)>180,"⚠ 超过6个月","✓ 近期")';

// 置信度等级（自动判断）
ws.Range("C10").Formula = '=IF(C8>=0.85,"High",IF(C8>=0.6,"Medium","Low"))';
// High = 可做完整估值三角验证
// Medium = 可估值但需加宽区间
// Low = 仅定性方向判断，跳过精确 DCF

// 必填数据清单（缺失项红色标记）
var fields = ["收入(TTM)","净利润","EBITDA","总资产","总负债",
  "股东权益","经营现金流","CapEx","总股数","当前股价",
  "Beta","行业","同行公司","最近分红"];
```

**关键规则**：如果置信度为 Low，自动跳过 DCF Sheet，仅生成相对估值 + 质量评估 + 定性结论。

---

### Sheet 3：相对估值表

```javascript
// 表头
var headers = ["公司","P/E(TTM)","P/E(Fwd)","P/B","EV/EBITDA","EV/Sales","ROE","股息率"];

// 目标公司行（从数据总览引用）
// 同行公司行（用户提供或AI建议3-5家）
// 行业中位数行 = MEDIAN 公式

// 隐含价值列（每个倍数一列）
ws.Range("I5").Formula = "=MEDIAN(B6:B10)*'数据总览'!$C$17";  // 隐含P/E价值

// 折溢价标记（条件格式）
// 低于中位数 10%+ → 绿色  |  高于中位数 10%+ → 红色  |  区间内 → 无色

// 估值评分
ws.Range("I12").Formula = '=COUNTIF(I5:I9,">"&\'数据总览\'!$C$20)/5';
// 高于当前股价的方法数占比 → 越高越"便宜"
```

---

### Sheet 5：质量评估矩阵（6 维度）

```javascript
var dimensions = [
  { name: "护城河与定价权",   weight: 0.20 },
  { name: "治理与资本配置",   weight: 0.15 },
  { name: "盈利质量(现金转化)", weight: 0.20 },
  { name: "资产负债风险",     weight: 0.15 },
  { name: "周期性与外部依赖",  weight: 0.15 },
  { name: "执行力与历史兑现",  weight: 0.15 }
];

// 每维度: 评分(1-5) + 证据描述 + 权重
// 综合质量分 = 加权平均
ws.Range("E12").Formula = "=SUMPRODUCT(C5:C10,D5:D10)";
// 1-2 = Weak | 3 = Neutral | 4-5 = Strong

// 评分为蓝色可编辑（Font.Color = 0xFF0000）
// 权重也可调
```

---

### Sheet 6：风险矩阵

```javascript
// 结构: 风险事件 | 类别 | 概率(1-5) | 影响(1-5) | 风险分 | 监控触发器 | 状态
// 风险分 = 概率 × 影响（公式）
ws.Range("E5").Formula = "=C5*D5";

// 前置填充常见风险类别
var riskCategories = ["宏观/政策","行业竞争","执行/管理","财务/流动性","估值/市场情绪","ESG/合规"];

// 风险热力图配色（条件格式）
// 风险分 >= 15 → 红色 | 10-14 → 橙色 | 5-9 → 黄色 | < 5 → 绿色
```

---

### Sheet 7：估值结论仪表盘

这是整个工作簿的"一页纸摘要"：

```javascript
// ── 区域 A：公允价值三角验证 ──
ws.Range("C5").Formula = "='DCF 模型'!C27";       // DCF 价值
ws.Range("C6").Formula = "='相对估值'!I13";        // 相对估值中位数
ws.Range("C7").Formula = "='核心假设'!C30";        // 情景加权价值

// 综合公允价值（权重可调，蓝色）
ws.Range("C9").Formula = "=D5*C5+D6*C6+D7*C7";
ws.Range("C9").Font.Size = 18;
ws.Range("C9").Font.Bold = true;

// ── 区域 B：安全边际 ──
ws.Range("C12").Value2 = 0.20;  // 安全边际折扣（蓝色可调）
ws.Range("C13").Formula = "=C9*(1-C12)";  // 安全买入价
ws.Range("C13").Interior.Color = 0x90EE90;

ws.Range("C14").Formula = "='数据总览'!C20";  // 当前股价
ws.Range("C15").Formula = "=C14/C9-1";        // 折溢价率

// ── 区域 C：投资结论 ──
ws.Range("C17").Formula = '=IF(C14<=C13,"Attractive ✓",IF(C14<=C9,"Watchlist","Caution ⚠"))';
ws.Range("C17").Font.Size = 16;

// ── 区域 D：数据仪表盘 ──
ws.Range("C20").Formula = "='数据总览'!C10";   // 置信度
ws.Range("C21").Formula = "='质量评估'!E12";   // 质量评分
ws.Range("C22").Formula = "=MAX('风险矩阵'!E5:E15)"; // 最高风险分

// ── 区域 E：触发器 ──
ws.Range("A25").Value2 = "增仓触发";  // 什么条件下增加仓位
ws.Range("A26").Value2 = "减仓触发";  // 什么条件下减少仓位
ws.Range("A27").Value2 = "论点失效";  // 什么情况下整个投资逻辑作废
ws.Range("A28").Value2 = "投资期限";
// 这四行 B 列为蓝色可编辑文本
```

---

### 决策标签定义

| 标签 | 含义 | 条件 |
|------|------|------|
| **Attractive** | 估值折价 + 质量可接受 + 风险可控 | 当前价 ≤ 安全买入价 |
| **Watchlist** | 信号混合，等待触发器 | 安全买入价 < 当前价 ≤ 公允价值 |
| **Caution** | 估值偏高或风险过大 | 当前价 > 公允价值 |

---

### 与其他 Skill 的协作

- **financial-modeling**：DCF 计算的具体公式实现（本 Skill 负责决策框架，financial-modeling 负责财务引擎）
- **data-analysis**：当用户先要分析历史数据再做估值时，data-analysis 处理统计，本 Skill 处理估值
- **chart-creation**：估值结论仪表盘中的图表（估值区间图、风险热力图）

---

### Ask 模式下的行为

在 Ask 模式（只读分析）下，不生成 Excel 模型，而是以**结构化文本**输出估值分析：
1. 执行摘要（一段话）
2. 数据来源与质量
3. 核心论点（Bull/Base/Bear）
4. 估值数据（引用数字）
5. 质量评估（表格）
6. 风险清单
7. 公允价值区间与安全边际
8. 结论标签 + 置信度

---

### 格式规范

继承 financial-modeling 的所有格式规范，额外增加：
- 质量评分 4-5 → 绿色背景 | 3 → 无色 | 1-2 → 红色背景
- 风险分 ≥ 15 → 红色 | 10-14 → 橙色 | < 10 → 绿色
- 结论标签字号 16px，Attractive=绿字, Watchlist=橙字, Caution=红字
- 仪表盘区域用加粗边框分隔
