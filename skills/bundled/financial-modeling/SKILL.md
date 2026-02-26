---
name: financial-modeling
description: 金融建模核心原则 — DCF/财务预测/估值模型的 Excel 实现规范
version: 1.0.0
tags: [finance, dcf, valuation, model, forecast]
modes: [agent, plan, ask]
context:
  keywords: [dcf, 估值, 建模, 财务模型, 敏感性, 折现, wacc, 自由现金流, fcf, ebit, 损益, npv, valuation, 财务预测, 情景分析, scenario, model, 股价, 投资]
---

## 金融建模核心原则（DCF / 财务预测 / 估值模型）

当用户要求生成 DCF、财务模型、估值分析、敏感性分析时，你生成的不是文字报告，而是**专业金融分析师可以直接调参使用的 Excel 模型**。

### 黄金法则
1. **假设与计算分离**：所有输入假设放在独立区域（蓝色字体 Font.Color=0xFF0000 标记），计算单元格全部用公式引用假设
2. **公式驱动**：所有计算必须用 .Formula 写入 Excel 公式（=SUM, =NPV, =IF 等），绝不用 .Value2 硬编码计算结果
3. **可调参**：用户修改任何一个假设值（如增长率、WACC），整个模型自动联动更新
4. **专业配色**：假设输入=蓝色字体(0xFF0000)，计算公式=黑色字体(0x000000)，表头=深色背景白字

### 模型结构（从上到下）
- **区域 A（核心假设面板）** — 收入增长率、毛利率、WACC、终端增长率、税率、CapEx比率等，蓝色字体可编辑
- **区域 B（P&L 预测表）** — 列=年份（历史2-3年 + 预测5年），行=Revenue/COGS/Gross Profit/SG&A/R&D/EBIT/Net Income。预测列全部用公式=上年*(1+增长率)
- **区域 C（FCF + DCF 计算）** — EBIT → Tax → D&A → CapEx → NWC → FCF → 折现因子 → PV of FCF → 终端价值 → 企业价值 → 股权价值 → 每股价值
- **区域 D（敏感性分析 7×7）** — WACC vs 终端增长率矩阵，每格用公式计算，当前假设对应值高亮

### 公式写入方式
\`\`\`javascript
// 用 .Formula 写公式（关键！不要用 .Value2 写计算结果）
ws.Range("D10").Formula = "=C10*(1+$C$3)";      // 收入预测=上年*(1+增长率)
ws.Range("D12").Formula = "=D10*$C$4";            // COGS=收入*COGS比率
ws.Range("D14").Formula = "=D10-D12";             // 毛利=收入-COGS
ws.Range("D20").Formula = "=D14-D16-D17-D18";    // EBIT=毛利-费用
ws.Range("D22").Formula = "=D20*(1-$C$6)";       // 税后EBIT
ws.Range("D25").Formula = "=D22+D23-D24-D26";    // FCF
ws.Range("C30").Formula = "=NPV($C$5,D25:H25)";  // NPV
ws.Range("C31").Formula = "=H25*(1+$C$7)/($C$5-$C$7)"; // 终端价值
ws.Range("C32").Formula = "=C31/(1+$C$5)^5";     // 终端价值折现
ws.Range("C33").Formula = "=C30+C32";             // 企业价值

// 敏感性分析格子公式（每格独立计算）
ws.Range(cellAddr).Formula = "=NPV(" + waccRef + ",D25:H25)+" +
  "H25*(1+" + gRef + ")/(" + waccRef + "-" + gRef + ")/(1+" + waccRef + ")^5";
\`\`\`

### 格式规范
- 假设输入：Font.Color = 0xFF0000 (蓝色)，用户一眼可识别可编辑项
- 百分比：NumberFormat = "0.0%"
- 金额（百万）：NumberFormat = "#,##0.0"
- 每股价值：NumberFormat = "#,##0.00"
- 敏感性表当前值：Interior.Color = 0x80FFFF (淡黄高亮)

### 严禁
- ❌ 用 .Value2 写入计算结果（必须用 .Formula 写公式）
- ❌ 只输出文字描述模型结构（必须生成实际代码创建表格）
- ❌ 忽略敏感性分析表
- ❌ 假设值和公式混在一起
- ❌ 不标记可调参数（必须用蓝色字体）