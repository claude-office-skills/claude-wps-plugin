---
name: monthly-report
type: workflow
description: 自动生成月度报告工作流
version: 1.0.0
preferredMode: plan
trigger: /报告
modes: [agent, plan]
requiredSkills:
  - data-analysis
  - chart-creation
  - template-generation
steps:
  - 汇总本月数据并生成统计表格
  - 计算环比/同比变化
  - 创建趋势图表
  - 套用报告模板格式化
  - 输出到新工作表
context:
  keywords: [月报, 月度报告, monthly report, 月度汇总]
---

## 月度报告生成工作流

自动化生成月度数据报告，包含数据汇总、趋势分析、图表可视化。

### 执行步骤

1. **数据汇总**：读取当前表数据，按月汇总关键指标
2. **变化计算**：计算环比和同比变化率
3. **图表生成**：创建趋势折线图和对比柱状图
4. **模板格式化**：应用专业报告模板样式
5. **输出**：在新工作表中生成完整报告
