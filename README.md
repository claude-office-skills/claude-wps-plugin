# Claude for WPS Excel 插件

WPS Office Excel AI 助手——通过自然语言对话操控表格，由 Claude API 驱动。

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.3.0-green)
![Platform](https://img.shields.io/badge/platform-WPS%20Office-red)

## 功能特性

- **自然语言对话**：直接用中文描述需求，AI 自动生成并执行 WPS JS 代码
- **实时上下文感知**：自动读取当前工作表、选区数据，无需手动指定
- **代码执行桥**：生成的代码可一键在 WPS 中执行，支持执行结果回传
- **流式响应**：SSE 流式输出，Markdown 渲染 + 代码块语法高亮
- **会话历史**：自动保存对话记录，支持多会话切换和恢复
- **模块化 Skills/Commands**：可扩展的技能和命令体系
- **14 个快捷命令**：覆盖数据清洗、公式、排序、图表等高频操作
- **9 个内置 Skills**：WPS API、图表、模板、数据分析、金融建模等
- **剪贴板增强**：支持粘贴文本、表格、图片
- **模型选择**：Sonnet 4.6 / Opus 4.6 / Haiku 4.5

## 架构概览

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  WPS Excel  │◄───►│  Proxy Server    │◄───►│  React TaskPane │
│  Plugin Host│     │  (Express :3001) │     │  (Vite :5173)   │
│  main.js    │     │  proxy-server.js │     │  src/App.tsx     │
└─────────────┘     └──────────────────┘     └─────────────────┘
       │                     │                        │
       │ WPS ET API          │ Claude API (SSE)       │ 用户对话
       │ 读写表格数据        │ 流式 AI 响应           │ Markdown 渲染
       │ 代码执行            │ Session 持久化         │ 代码高亮+执行
```

## 快速开始

### 1. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 Claude API Key：

```
VITE_CLAUDE_API_KEY=sk-ant-api03-xxxxxxxx
VITE_CLAUDE_MODEL=claude-sonnet-4-5
```

### 2. 安装依赖 & 启动

```bash
npm install

# 一键启动（Proxy + Dev Server）
npm start

# 或分别启动
npm run proxy   # 启动代理服务器 :3001
npm run dev     # 启动前端开发服务器 :5173
```

### 3. 在 WPS Office 中加载

#### 方法 A：直接网页预览（无需 WPS）
浏览器打开 `http://localhost:5173` 即可预览插件 UI，此时工作在 Mock 模式（模拟 WPS 数据）。

#### 方法 B：WPS Office 加载项（完整功能）
1. 打开 WPS Excel
2. 菜单：**开发工具 → 加载项 → 浏览**
3. 选择项目根目录下的 `manifest.xml`
4. 插件出现在 Ribbon 栏 **开始 → Claude AI → 打开 Claude**

> **注意**：WPS Web 加载项要求 HTTPS。本地开发时，WPS 允许 `localhost` 使用 HTTP。

### 4. 构建生产包

```bash
npm run build          # Vite 前端构建
npm run build:dist     # 完整分发包（含 skill 嵌入 + 混淆）
```

## 项目结构

```
claude-wps-plugin/
├── src/                        # React 前端（TaskPane 侧边栏）
│   ├── api/
│   │   ├── claudeClient.ts     # Claude API 调用（SSE 流式响应）
│   │   ├── wpsAdapter.ts       # WPS JS API 封装 + Mock 模式
│   │   └── sessionStore.ts     # 会话持久化（CRUD + 记忆）
│   ├── components/
│   │   ├── CodeBlock.tsx        # 代码块（语法高亮 + Run/Copy 按钮）
│   │   ├── MessageBubble.tsx    # 消息气泡（Markdown 渲染）
│   │   ├── QuickActionCards.tsx # 快捷命令卡片（动态加载）
│   │   ├── ModelSelector.tsx    # 模型选择器
│   │   ├── AttachmentMenu.tsx   # 附件菜单（剪贴板/PDF/图片）
│   │   └── HistoryPanel.tsx     # 历史会话面板
│   ├── App.tsx                  # 主应用（对话逻辑 + 状态管理）
│   └── types.ts                 # TypeScript 类型定义
├── proxy-server.js              # Express 代理服务器（:3001）
├── wps-addon/                   # WPS 加载项运行时
│   ├── main.js                  # Plugin Host 入口（上下文同步 + 代码执行桥）
│   ├── ribbon.xml               # Ribbon 栏 UI 定义
│   └── *.png                    # 图标资源
├── skills/                      # 技能系统（三层目录）
│   └── bundled/                 # 内置 Skills（9 个）
│       ├── wps-core-api/        # WPS ET API 完整参考
│       ├── chart-creation/      # 图表创建
│       ├── template-generation/ # 模板生成
│       ├── code-rules/          # 代码规范
│       ├── data-cleaning/       # 数据清洗
│       ├── formula-operations/  # 公式运算
│       ├── conditional-formatting/ # 条件格式
│       ├── data-analysis/       # 数据分析
│       └── financial-modeling/  # 金融建模
├── commands/                    # 快捷命令（14 个 .md 文件）
├── manifest.xml                 # WPS 加载项清单
├── build-dist.mjs               # 生产构建脚本
├── .claude-plugin/plugin.json   # 插件元数据
└── AGENTS.md                    # AI Agent 行为定义
```

## 使用示例

在 WPS 中选中数据区域，然后在对话框输入：

- `"删除 A 列中的重复内容，保留第一条"`
- `"把 B 列的日期统一转换成 YYYY-MM-DD 格式"`
- `"统计 C 列的平均值和总和"`
- `"删除所有空白行"`
- `"把第一行设置为加粗并填充灰色背景"`
- `"生成一个销售数据柱状图"`
- `"智能填充缺失的邮编数据"`

Claude 会生成 WPS JS 代码，点击 `[Run]` 执行即可。执行失败时可一键重试修复。

## 版本日志

### v1.3.0 (2026-02-26) — 会话持久化 + 交互增强

**会话历史管理**
- 新增 `sessionStore.ts`：会话 CRUD + 自动标题生成 + 用户记忆
- 新增 `HistoryPanel` 组件：历史会话列表、切换、删除
- 启动时自动恢复最近一次会话
- 消息变化后 1s 去抖自动保存

**交互体验优化**
- Proxy 连接检测改为自动重试（最多 10 次，间隔 2s），避免启动顺序问题
- 代码执行失败时支持一键"重试修复"（自动构造修复 prompt 发送给 Claude）
- 剪贴板增强：支持粘贴图片（macOS `PNGf` 格式）、HTML 表格自动解析
- Cmd+V 粘贴表格数据自动附加为上下文
- 附件区分表格类型和普通附件的展示

**System Prompt 强化**
- 新增上下文优先级规则：始终以最新 ActiveSheet 为准，忽略对话历史中的旧表名
- 新增代码长度限制（3000 字符），强制使用循环 + `Math.random()` 生成大数据
- 强制使用 `Application.ActiveSheet`，禁止硬编码 sheet 名称

**WPS Plugin Host 增强 (`wps-addon/main.js`)**
- 重构为后台同步架构：定时推送上下文 + 轮询执行代码队列
- TaskPane 管理：持久化面板 ID，支持 toggle 显示/隐藏
- UsedRange 数据采集：除选区外同时上报当前工作表已用区域
- 空上下文保护：workbookName 为空时不覆盖已有上下文

**工程化**
- 新增 `build-dist.mjs` 生产构建脚本（skill 嵌入 + terser 混淆 + tarball 打包）
- `package.json` 新增 `npm start`（一键启动 proxy + dev）、`npm run build:dist`
- 清理所有调试日志代码

### v1.2.0 (2026-02-25) — 数据驱动的能力补齐

**Phase 4A: 新增 5 个 Skills（对齐五大能力板块）**
- `data-cleaning`：数据清洗最佳实践（空值/去重/格式统一/异常值检测/分列）
- `formula-operations`：公式运算规范（.Formula 写入/常用模板/纠错/WPS 限制）
- `conditional-formatting`：条件格式与美化（FormatConditions API/色阶/一键美化方案）
- `data-analysis`：数据解读与分析（统计方法/趋势/透视汇总/结论输出规范）
- `financial-modeling`：金融建模（从 proxy-server.js 硬编码迁移为标准 skill）

**Phase 4B: 新增 5 个 Commands（补齐高频缺失）**
- `smart-split`（智能分列，参考日活 15.7w）
- `freeze-header`（冻结表头，参考日活 8.7w）
- `fill-cells`（AI 智能填充，参考日活 1.8w）
- `beautify-table`（一键美化，用户调研 34% 需求）
- `conditional-format`（条件格式）

**Phase 4C: 上下文感知增强**
- `matchSkills()` 支持双维度匹配：用户消息关键词 + WPS 选区特征（空值/公式）
- Plugin Host 新增 `emptyCellCount`、`hasFormulas` 数据概况字段
- 选区含空白 → 自动加载 data-cleaning skill
- 选区含公式 → 自动加载 formula-operations skill

**Bugfix**
- 修复 `template-generation` 与 `wps-core-api` 的 Borders API 冲突
- 统一 BGR 颜色速查表，新增 RGB 等价列
- 删除 `buildSystemPrompt()` 中的 Borders 正则清理 hack
- 补充 4 个 Commands 的 `argument-hint` 空白问题

### v1.1.0 (2026-02-25) — Cowork 风格模块化重构

**Phase 3: Skills/Commands 模块化**（借鉴 Anthropic Cowork + OpenClaw 架构）
- 插件清单 `.claude-plugin/plugin.json` + 行为定义 `AGENTS.md`
- SYSTEM_PROMPT 拆分为 4 个 bundled skills（`wps-core-api`、`chart-creation`、`template-generation`、`code-rules`）
- Skill Loader：按用户输入关键词**按需匹配**加载 skill，减少 token 消耗
- 9 个 QuickActionCards 迁移为 `commands/*.md` 文件，前端从 API 动态加载
- 新增 API 端点：`GET /commands`、`GET /skills`
- 三层 skill 目录：`bundled/`（内置）→ `managed/`（社区）→ `workspace/`（用户自定义）
- health-check 增强：返回 skill/command 加载数量

### v1.0.0 (2026-02-25) — MVP 完整版

**Phase 1: 基础架构**
- React Task Pane (Vite + React + TypeScript) 侧边栏 UI
- Express Proxy Server (:3001) 本地代理，调用 Claude API 执行 AI 对话 (SSE 流式)
- WPS Plugin Host (`main.js`) 运行在 WPS 上下文，通过 `.Value2` 读取表格数据
- 数据通路：Plugin Host → proxy → Task Pane
- 模型选择器：Sonnet 4.6 / Opus 4.6 / Haiku 4.5
- WPS 加载项打包：`manifest.xml` + `ribbon.xml`

**Phase 2: 侧边栏二次开发**
- 代码执行桥：Task Pane → proxy 队列 → Plugin Host 执行 → 结果回传
- Markdown 渲染 (`react-markdown` + `remark-gfm`)，流式纯文本/完成后 Markdown
- 代码块语法高亮 + Run/复制按钮
- QuickActionCards 9 个快捷操作（通用 4 + 选区 5）
- 附件菜单：剪贴板读取、PDF 提取、图片上传
- SYSTEM_PROMPT：300+ 行 WPS ET API 完整参考
- 中止生成时恢复用户输入

---

## 后续计划

- [x] Phase 3：Skills/Commands 模块化重构（v1.1.0）
- [x] Phase 4A：数据驱动能力补齐 — 5 Skills + 5 Commands（v1.2.0）
- [x] Phase 4C：上下文感知 Skill 匹配（v1.2.0）
- [x] Phase 5A：会话持久化 + 交互增强（v1.3.0）
- [ ] Phase 5B：MCP 连接器支持外部数据源
- [ ] Phase 5C：操作历史 + 撤销功能
- [ ] Phase 6：高级 Agent 模式（任务拆解 + 分步执行 + 逐步确认）
- [ ] Phase 6：跨应用上下文（表格 → 演示 → 文档）
- [ ] Phase 7：企业版后端（API Key 集中管理、审计日志）

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | CSS Modules |
| AI | Claude API (SSE 流式) |
| 代理 | Express 5 |
| 宿主 | WPS Office JS API (ET) |
| 渲染 | react-markdown + remark-gfm + react-syntax-highlighter |

## License

MIT
