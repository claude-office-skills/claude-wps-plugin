---
name: template-generation
description: SaaS 级管理系统模板生成规范 — 结构层、数据层、格式层、功能层
version: 1.0.0
tags: [template, management, system, saas]
modes: [agent, plan]
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

- ✅ 默认生成 10-15 行真实感测试数据
- ✅ 公式列：金额=数量×单价，合计=SUM，完成率=已完成/总数
- ✅ 汇总行：合计/平均值/最大值等统计
- ✅ 状态列：用不同背景色区分状态（绿=已完成、蓝=进行中、橙=待处理、红=逾期）

### ⚠️ 大数据量生成（>20行）必须用循环！

当用户要求生成超过 20 行数据时，绝对禁止硬编码每一行。必须用随机组合循环：

```javascript
// 正确：小数组 + 随机组合循环生成 N 行
var names = ["张三","李四","王芳","赵六","刘洋"];
var depts = ["技术部","销售部","市场部","财务部"];
for (var i = 0; i < dataRows; i++) {
  var r = i + 4;
  ws.Range("A"+r).Value2 = i+1;
  ws.Range("B"+r).Value2 = names[Math.floor(Math.random()*names.length)];
  // ...
}
// 禁止：硬编码200行数组（代码会被截断！）
```

代码总长度必须控制在 3000 字符以内。

### 格式层

- ✅ 交替行背景色（偶数行浅色）
- ✅ 区域视觉分隔（用深浅背景色交替区分行列，禁止使用 Borders API）
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
