---
name: template-generation
description: SaaS 级管理系统模板生成规范 — 结构层、数据层、格式层、功能层
version: 1.0.0
tags: [template, management, system, saas]
context:
  keywords: [模板, 管理系统, 管理表, 创建, 生成, 报表, 仪表板, 系统, dashboard]
---

## 核心任务：生成可直接使用的 SaaS 级管理系统

用户让你创建的不是简单表头，而是完整可用的管理系统，类似于稻壳模板商城中那种专业级 Excel 管理系统。
表格就是画布，你生成的系统需要用户能真正用起来。

## 管理系统/模板必须包含以下全部内容（缺一不可）

### 结构层

- ✅ 系统标题行（合并居中、16pt 加粗、品牌色背景白字）
- ✅ 副标题/统计周期行
- ✅ 表头行（粗体、白字、深色背景、居中）

### 数据层（最关键！）

- ✅ 至少 10-15 行真实感测试数据：使用真实中文姓名（张三、李四、王芳...）、真实日期（2024-01-15）、真实金额、真实手机号格式（138xxxx1234）、真实地址
- ✅ 公式列：金额=数量×单价，合计=SUM，完成率=已完成/总数
- ✅ 汇总行：合计/平均值/最大值等统计
- ✅ 状态列：用不同背景色区分状态（绿=已完成、蓝=进行中、橙=待处理、红=逾期）

### 格式层

- ✅ 交替行背景色（偶数行浅色）
- ✅ 全区域边框（Borders.LineStyle = 1）
- ✅ 合理列宽（按内容设置，用 ws.Range("A:A").ColumnWidth）
- ✅ 数字格式（金额 #,##0.00、日期 yyyy-mm-dd、百分比 0.0%、电话 @）

### 功能层（让用户真正能用）

- ✅ 数据验证/下拉菜单（如状态列：已完成/进行中/待处理）使用 ws.Range().Validation.Add(3,1,1,"选项1,选项2,选项3")
- ✅ 条件格式化状态列：不同状态不同颜色
- ✅ 表头筛选：ws.Range("A行:Z行").AutoFilter()

## 参考代码模式

```javascript
function CL(c){var s="";while(c>0){c--;s=String.fromCharCode(65+(c%26))+s;c=Math.floor(c/26);}return s;}

var ws = Application.ActiveSheet;
var wb = Application.ActiveWorkbook;
ws.Name = "订单管理";
ws.Range("A1:P100").Clear();

// 标题
ws.Range("A1:K1").Merge();
ws.Range("A1").Value2 = "销售订单管理系统";
ws.Range("A1").Font.Size = 16;
ws.Range("A1").Font.Bold = true;
ws.Range("A1").Font.Color = 0xFFFFFF;
ws.Range("A1").Interior.Color = 0x8B4513;
ws.Range("A1").HorizontalAlignment = -4108;
ws.Range("1:1").RowHeight = 40;

// 表头
var h = ["序号","订单编号","客户名称","联系电话","产品名称","数量","单价(元)","金额(元)","下单日期","订单状态","备注"];
ws.Range("A3:K3").Value2 = [h];
ws.Range("A3:K3").Font.Bold = true;
ws.Range("A3:K3").Font.Color = 0xFFFFFF;
ws.Range("A3:K3").Interior.Color = 0x8B4513;
ws.Range("A3:K3").HorizontalAlignment = -4108;

// 测试数据用 Range(CL(c)+r) 写入
// 交替行色、状态列条件格式、公式列、汇总行、数据验证、筛选...
```
