# Claude for WPS Excel 插件

WPS Office Excel AI 助手——通过自然语言对话操控表格，由 Claude API 驱动。

## 版本日志

### v1.1.0 (2026-02-25) — Cowork 风格模块化重构

**Phase 3: Skills/Commands 模块化**（借鉴 Anthropic Cowork + OpenClaw 架构）
- 插件清单 `.claude-plugin/plugin.json` + 行为定义 `AGENTS.md`
- SYSTEM_PROMPT 拆分为 4 个 bundled skills（`wps-core-api`、`chart-creation`、`template-generation`、`code-rules`）
- Skill Loader：按用户输入关键词**按需匹配**加载 skill，减少 token 消耗
- 9 个 QuickActionCards 迁移为 `commands/*.md` 文件，前端从 API 动态加载
- 新增 API 端点：`GET /commands`、`GET /skills`
- 三层 skill 目录：`bundled/`（内置）→ `managed/`（社区）→ `workspace/`（用户自定义）
- 清理所有 agent debug 日志代码
- health-check 增强：返回 skill/command 加载数量

### v1.0.0 (2026-02-25) — MVP 完整版

**Phase 1: 基础架构**
- React Task Pane (Vite + React + TypeScript) 侧边栏 UI
- Express Proxy Server (:3001) 本地代理，调用 claude CLI 执行 AI 对话 (SSE 流式)
- WPS Plugin Host (`main.js`) 运行在 WPS 上下文，通过 `.Value2` 读取表格数据
- 数据通路：Plugin Host → proxy → Task Pane
- 模型选择器：Sonnet 4.6 / Opus 4.6 / Haiku 4.5
- WPS 加载项打包：`manifest.xml` + `ribbon.xml`

**Phase 2: 侧边栏二次开发**
- 代码执行桥：Task Pane → proxy 队列 → Plugin Host 执行 → 结果回传
- Markdown 渲染 (`react-markdown` + `remark-gfm`)，流式纯文本/完成后 Markdown
- 代码块语法高亮 (shiki) + Run/复制按钮
- QuickActionCards 9 个快捷操作（通用 4 + 选区 5）
- 附件菜单：剪贴板读取、PDF 提取、图片上传
- SYSTEM_PROMPT：300+ 行 WPS ET API 完整参考
- 中止生成时恢复用户输入

---

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

### 2. 安装依赖 & 启动开发服务器

```bash
npm install
npm run dev
```

开发服务器启动在 `http://localhost:5173`。

### 3. 在 WPS Office 中加载

#### 方法 A：直接网页预览（无需 WPS）
浏览器打开 `http://localhost:5173` 即可预览插件 UI，此时工作在 Mock 模式（模拟 WPS 数据）。

#### 方法 B：WPS Office 加载项（完整功能）
1. 打开 WPS Excel
2. 菜单：**开发工具 → 加载项 → 浏览**
3. 选择项目根目录下的 `manifest.xml`
4. 插件出现在 Ribbon 栏 **开始 → Claude AI → 打开 Claude**

> **注意**：WPS Web 加载项要求 HTTPS。本地开发时，WPS 允许 `localhost` 使用 HTTP。

## 项目结构

```
src/
├── api/
│   ├── claudeClient.ts   # Claude API 调用（流式响应）
│   └── wpsAdapter.ts     # WPS JS API 封装
├── components/
│   ├── CodeBlock.tsx     # 代码块组件（含执行按钮）
│   └── MessageBubble.tsx # 消息气泡组件
├── types.ts              # TypeScript 类型定义
├── App.tsx               # 主应用（对话逻辑）
└── App.module.css        # 样式
manifest.xml              # WPS 加载项清单
```

## 使用示例

在 WPS 中选中数据区域，然后在对话框输入：

- `"删除 A 列中的重复内容，保留第一条"`
- `"把 B 列的日期统一转换成 YYYY-MM-DD 格式"`
- `"统计 C 列的平均值和总和"`
- `"删除所有空白行"`
- `"把第一行设置为加粗并填充灰色背景"`

Claude 会生成 WPS JS 代码，点击 `[run]` 执行即可。

## 后续计划

- [ ] Phase 3：Skills/Commands 模块化重构（借鉴 Anthropic Cowork 插件架构）
- [ ] Phase 3：清理 debug 日志，按需加载 system prompt
- [ ] Phase 4：MCP 连接器支持外部数据源
- [ ] Phase 4：操作历史 + 撤销功能
- [ ] Phase 5：跨应用上下文（表格 → 演示 → 文档）
- [ ] Phase 5：企业版后端（API Key 集中管理、审计日志）
