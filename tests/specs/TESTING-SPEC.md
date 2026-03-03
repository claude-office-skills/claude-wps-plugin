# claude-wps-plugin 测试规格 (SPEC)

## 项目架构

```
前端 (React + Vite)  →  proxy-server (Express:3001)  →  Claude CLI / yfinance
     ↑                        ↑
  WPS Task Pane          WPS Plugin Host (main.js)
```

## 测试层级

### Layer 1: 单元测试 (Vitest)

纯函数测试，不依赖网络和外部服务。

| 模块 | 函数 | 测试要点 |
|------|------|----------|
| proxy-server | `matchSkills()` | 关键词匹配、权重排序、上限截断、always 优先 |
| proxy-server | `parseFrontmatter()` | YAML 解析、空 frontmatter、格式错误 |
| proxy-server | `smartSampleContext()` | 大表采样、小表完整、统计摘要 |
| proxy-server | `buildSystemPrompt()` | Skill 注入、图表关键词检测、mode 集成 |
| claudeClient | `extractCodeBlocks()` | 多语言代码块、嵌套、空输入 |
| App | `parsePlanSteps()` | Plan 模式步骤解析、非 plan 模式返回 undefined |
| wpsAdapter | `getMockContext()` | Mock 数据结构正确性 |

### Layer 2: API 集成测试 (Playwright request)

测试 proxy-server HTTP 端点，使用真实数据。

| 端点 | 方法 | 测试要点 |
|------|------|----------|
| `/health` | GET | 返回 status:ok、skills 数量 > 0 |
| `/finance-data/:ticker` | GET | AAPL 返回完整财务数据、601899.SS (A股)、缓存命中 |
| `/finance-data/:ticker/price` | GET | 价格数组非空、OHLCV 字段齐全 |
| `/skills` | GET | 返回数组、包含 financial-modeling |
| `/modes` | GET | 返回模式数组、包含 agent/plan/ask |
| `/commands` | GET | 返回命令数组 |
| `/sessions` | GET | 返回会话列表 |
| `/chat` | POST | SSE 流式响应（需 Claude CLI 可用） |
| `/wps-context` | GET | 返回 WPS 上下文或默认值 |

### Layer 3: 浏览器 E2E (Playwright)

模拟用户在 Web 界面操作。

| 场景 | 测试要点 |
|------|----------|
| 页面加载 | 显示 Claude 图标、聊天输入框可见 |
| 发送消息 | 输入文字 → 发送 → 出现 assistant 消息气泡 |
| 模型切换 | 点击模型选择器 → 切换到 Haiku → 显示更新 |
| 主题切换 | 点击主题按钮 → 颜色方案改变 |
| 新建 Agent | 点击 + → 新标签页出现 |
| 快捷操作卡片 | 显示快捷操作 → 点击 → 自动填入 prompt |

## 真实用户数据场景

### 金融数据场景 (Yahoo Finance)
- 美股: AAPL, MSFT, GOOGL
- A股: 601899.SS (紫金矿业), 000858.SZ (五粮液)
- 港股: 0700.HK (腾讯)

### Skill 匹配场景
- "帮我做苹果公司的DCF估值" → 匹配 financial-modeling + equity-valuation
- "分析这些销售数据" → 匹配 data-analysis
- "画一个折线图" → 匹配 chart 关键词 + 图表样式覆盖

## 完成标准

- [ ] 单元测试覆盖率 ≥ 60%
- [ ] API 测试全部通过（/health, /finance-data, /skills, /modes）
- [ ] 浏览器 E2E 核心流程通过（加载、发消息、主题切换）
- [ ] 所有测试可通过 `npm test` 一键运行
