---
name: formula-operations
description: 公式运算规范 — .Formula 写入、常用公式模板、纠错方法、WPS 特有限制
version: 1.0.0
tags: [formula, function, calculation, correction]
modes: [agent, plan, ask]
context:
  keywords: [公式, 函数, SUM, VLOOKUP, IF, COUNTIF, SUMIF, INDEX, MATCH, 计算, 求和, 汇总, 纠错, 错误, VALUE, REF, NAME, 写公式, 平均, 最大, 最小, AVERAGE, MAX, MIN]
  selectionHint:
    hasFormulas: true
---

## 公式写入规范

### 核心原则：用 .Formula 写公式，不用 .Value2 写计算结果

```javascript
// ✅ 正确：写入公式，Excel 自动计算
ws.Range("D2").Formula = "=B2*C2";
ws.Range("D20").Formula = "=SUM(D2:D19)";

// ❌ 错误：用 JS 算好再写入值（用户无法调参）
ws.Range("D2").Value2 = b2 * c2;
```

### 公式拖填（批量写入）

```javascript
// 方法1: 逐行写入（最可靠）
for (var r = 2; r <= lastRow; r++) {
  ws.Range("D" + r).Formula = "=B" + r + "*C" + r;
}

// 方法2: 首行写入 + AutoFill
ws.Range("D2").Formula = "=B2*C2";
ws.Range("D2").AutoFill(ws.Range("D2:D" + lastRow));
```

### 常用公式模板

| 场景 | 公式 |
|------|------|
| 求和 | `=SUM(B2:B100)` |
| 条件求和 | `=SUMIF(A2:A100,"条件",B2:B100)` |
| 多条件求和 | `=SUMIFS(C2:C100,A2:A100,"条件1",B2:B100,">0")` |
| 计数 | `=COUNTA(A2:A100)` |
| 条件计数 | `=COUNTIF(A2:A100,"条件")` |
| 平均值 | `=AVERAGE(B2:B100)` |
| 查找匹配 | `=VLOOKUP(查找值,表区域,列号,0)` |
| 灵活查找 | `=INDEX(返回区域,MATCH(查找值,查找区域,0))` |
| 条件判断 | `=IF(条件,"是","否")` |
| 嵌套判断 | `=IF(A2>90,"优",IF(A2>60,"及格","不及格"))` |
| 百分比 | `=B2/SUM(B$2:B$100)` |
| 环比增长 | `=(B3-B2)/B2` |
| 排名 | `=RANK(B2,B$2:B$100)` |
| 文本拼接 | `=A2&"-"&B2` |

### 公式纠错方法

```javascript
// 读取公式内容（不是值）
var formula = ws.Range("D2").Formula;

// 常见错误及修复思路
// #VALUE! → 数据类型不匹配，检查是否文本混在数字中
// #REF!   → 引用了被删除的单元格
// #NAME?  → 函数名拼写错误或不存在
// #DIV/0! → 除数为零，用 =IF(B2=0,0,A2/B2)
// #N/A    → VLOOKUP 找不到值，用 =IFERROR(VLOOKUP(...),"未找到")
```

### WPS 特有注意事项

- WPS 中 `.FormulaR1C1` 可能不稳定，优先用 `.Formula`（A1 格式）
- 数组公式 `{=...}` 在 WPS 加载项中支持有限，优先用辅助列拆解
- 跨工作表引用格式：`='表名'!A1`
- 公式中的中文引号会导致错误，确保用英文双引号
