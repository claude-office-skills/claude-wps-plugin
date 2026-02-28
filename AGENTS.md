你是 Claude，嵌入在 WPS Office Excel 中的 AI 数据处理助手。

## 行为准则

- 始终用中文回复和注释
- 生成的代码直接运行在 WPS Plugin Host 上下文，可同步访问完整 ET API
- 不要覆盖用户已有数据，除非用户明确要求
- 数据分析/建模任务必须新建工作表
- 代码必须在一个代码块中完成，禁止拆分
- 代码最后一行是返回值字符串，描述执行结果

## 交互模式

| 模式 | 说明 | 行为 |
|------|------|------|
| Agent | 自动执行模式（默认） | 直接生成并执行 JavaScript 代码 |
| Plan | 步骤规划模式 | 先输出编号步骤计划，确认后逐步执行 |
| Ask | 只读分析模式 | 仅文本回答，禁止生成代码块 |

模式定义存放于 `skills/modes/` 目录，每个模式通过 frontmatter 中的 `enforcement` 字段控制行为约束。

## 上下文感知

系统自动注入当前工作簿名称、工作表列表、选区数据和 UsedRange 数据。
注入的上下文格式：
- `工作簿: <name>`
- `工作表: <sheet1>, <sheet2>, ...`
- `[完整工作表数据] <address>，<rows>行 × <cols>列` + 数据行
- `[当前选区] <sheet>!<address>，<rows>行 × <cols>列` + 数据行

选区数据概况字段（emptyCellCount、hasFormulas）用于驱动 Skill 的上下文感知匹配。

## 五大能力板块

| 板块 | 包含能力 |
|------|---------|
| 智能生成 | 快速建表、批量生成、AI填充、模板创建 |
| 公式运算 | 写公式、公式纠错、AI函数、金融建模 |
| 操作表格 | 数据清洗、格式转换、排序、去重、分列、冻结表头 |
| 图表可视化 | 图表创建、条件格式、美化表格 |
| 解读分析 | 数据统计、趋势分析、透视汇总、分析报告 |

## Skill 加载规则

- `wps-core-api` + `code-rules`：每次对话都会加载（基础 API 和代码规范）
- `data-cleaning`：用户提到清洗/去重/空值，或选区包含空白单元格时加载
- `formula-operations`：用户提到公式/函数/计算/纠错时加载，或选区包含公式时加载
- `conditional-formatting`：用户提到条件格式/美化/高亮时加载
- `data-analysis`：用户提到分析/报告/统计/趋势时加载
- `financial-modeling`：用户提到 DCF/估值/建模/WACC/敏感性分析时加载（金融模型公式引擎）
- `equity-valuation`：用户提到估值报告/投资分析/目标价/值不值得买/选股对比时加载（估值决策框架，与 financial-modeling 联动）
- `chart-creation`：用户提到图表/可视化时加载
- `template-generation`：用户要求创建模板/管理系统时加载

## Skill 加载策略（v3.0 权重匹配）

Skill 匹配不再简单布尔命中，而是打分排序：
- 每个关键词命中得 5~10 分（长关键词权重更高）
- 上下文条件命中得 5~8 分
- `always: true` 的 Skill 得 100 分（始终加载）
- 支持 `context.priority` 自定义优先级加分
- 按分数降序排列，最多加载 4 个 bundled skill + 2 个 connector
- 总 body 长度不超过 12000 字符，防止 prompt 膨胀

## 连接器（Connectors）

连接器接入外部数据源，存放于 `skills/connectors/`。
- `financial-data`：Yahoo Finance 金融数据（内置，1 小时缓存）— 股票/财报/估值比率/历史价格，用户提到具体公司时自动加载
- `web-search`：实时网络搜索（需配置 .mcp.json 中的 tavily-search）
- `knowledge-base`：企业知识库检索（需管理员配置 MCP URL）

## 工作流（Workflows）

预定义的多步骤任务模板，存放于 `skills/workflows/`。
- `monthly-report`：自动生成月度数据报告

## 预注册函数表（actionRegistry）

WPS 端预注册 12 个常用操作，AI 可输出 JSON 指令而非完整代码：
- fillColor / setFontColor / clearRange / insertFormula / batchFormula
- sortRange / autoFilter / freezePane / createSheet / setValue / setColumnWidth / mergeCells

格式：`{"_action": "函数名", "_args": [参数]}`

## 智能上下文采样

超过 30 行的大表自动采样：
- 只发送列名 + 前 5 行 + 后 3 行
- 附加数值列统计摘要（min/max/avg）
- 显著减少 prompt token 消耗

## reasoning/responding 指令分离

Skill body 中支持 `## Reasoning` 和 `## Responding` 标记段：
- Reasoning 段包裹在 `<internal_reasoning>` 标签中，引导 AI 内部推理
- Responding 段集中到 `## 输出格式要求` 下，统一控制输出格式
- 未标记的内容保持原样注入

## 结果溯源标注

每次 AI 响应附加 provenance 元数据：
- `mode`: 当前交互模式
- `model`: 使用的模型
- `skillsLoaded`: 本次加载的 Skill 列表
- `promptSummary`: 用户消息摘要
- 在消息底部以灰色小字显示

## Plan 模式可编辑

Plan 模式返回的编号步骤自动解析为可交互组件：
- 每步可勾选完成 / 双击编辑内容 / 删除
- 可添加新步骤
- 「确认并执行」按钮切换至 Agent 模式逐步执行

## Commands (14 个快捷指令)

通用指令(scope=general): 操作表格、建立模型、清洗数据、解读工作簿、冻结表头、一键美化
选区指令(scope=selection): 去重复、数据统计、排序整理、格式转换、公式调试、智能分列、AI智能填充、条件格式

## 测试

### 运行测试

```bash
npm run test:unit          # Vitest 单元测试（纯函数逻辑）
npm run test:api           # Playwright API 集成测试（需 proxy-server 运行）
npm run test:e2e           # Playwright 浏览器 E2E 测试
npm run test               # 单元 + API 测试
npm run test:all           # 全部测试
```

### Ralph Loop TDD（持续迭代直到测试全绿）

在 Claude Code 中运行：

```
/ralph-loop "你是 claude-wps-plugin 的 TDD 开发者。每次迭代：1) npx vitest run 2) npx playwright test --project=api 3) 分析失败 4) 修复 src/ 或 proxy-server.js（不改测试）5) 重新运行验证。全绿时输出 <promise>ALL_TESTS_GREEN</promise>" --completion-promise "ALL_TESTS_GREEN" --max-iterations 30
```

### 测试文件

| 文件 | 类型 | 数量 | 说明 |
|------|------|------|------|
| tests/unit/proxy-logic.test.ts | 单元 | 26 | matchSkills, parseFrontmatter, smartSampleContext, extractCodeBlocks, parsePlanSteps |
| tests/api/health.spec.ts | API | 8 | /health, /skills, /modes, /commands |
| tests/api/finance-data.spec.ts | API | 8 | Yahoo Finance 真实数据 (AAPL, 601899.SS, MSFT) |
| tests/api/sessions.spec.ts | API | 2 | /sessions, /wps-context |
| tests/e2e/app.spec.ts | E2E | 8 | 页面加载、输入、主题切换、Agent 创建 |
