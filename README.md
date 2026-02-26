# Claude for WPS Excel 插件

WPS Office Excel AI 助手——通过自然语言对话操控表格，由 Claude API 驱动。

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.4.0-green)
![Platform](https://img.shields.io/badge/platform-WPS%20Office-red)

## 功能特性

- **自然语言对话**：直接用中文描述需求，AI 自动生成并执行 WPS JS 代码
- **三种交互模式**：Agent（自动执行）/ Plan（步骤规划）/ Ask（只读分析）
- **实时上下文感知**：自动读取当前工作表、选区数据，智能匹配 Skill
- **代码执行桥**：生成的代码可一键在 WPS 中执行，支持结果回传 + 一键修复
- **流式响应**：SSE 流式输出，Markdown 渲染 + 代码块语法高亮
- **会话历史**：自动保存对话记录，支持多会话切换和恢复
- **模块化 Skills/Commands**：可扩展的技能和命令体系（9 Skills + 14 Commands）
- **连接器系统**：通过 MCP 协议接入外部数据源（网络搜索、企业知识库）
- **工作流模板**：预定义多步骤任务（如月度报告自动生成）
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
       │ WPS ET API          │ Claude CLI (SSE)       │ 用户对话
       │ 读写表格数据        │ Skill/Mode 匹配       │ Markdown 渲染
       │ 代码执行            │ Session 持久化         │ 代码高亮+执行
       │                     │ MCP Connectors         │ 模式切换
```

## 快速开始

### 前置条件

- **Node.js** >= 18
- **Claude CLI**：`npm install -g @anthropic-ai/claude-code && claude login`
- **WPS Office**（可选，浏览器可独立预览）

### 1. 克隆并配置

```bash
git clone https://github.com/claude-office-skills/claude-wps-plugin.git
cd claude-wps-plugin
cp .env.example .env
```

编辑 `.env` 选择模型（默认 Sonnet 4.5）：

```
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

### 3. 使用方式

#### 方法 A：浏览器预览（无需 WPS）
打开 `http://localhost:5173` 即可预览插件 UI，工作在 Mock 模式（模拟 WPS 数据）。

#### 方法 B：WPS Office 加载项（完整功能）

**自动安装**（推荐）：
```bash
# macOS 一键启动 + 注入 WPS
bash install-to-wps.sh

# 或双击「启动插件.command」
```

**手动安装**：
1. 确保 proxy 和 dev server 已启动
2. 打开 WPS Excel → **开发工具 → 加载项 → 浏览**
3. 选择项目根目录下的 `manifest.xml`
4. 插件出现在 Ribbon 栏 → 点击 **打开 Claude**

### 4. 构建生产包

```bash
npm run build          # Vite 前端构建
npm run build:dist     # 完整分发包（Skill 嵌入 + 混淆 + tarball）
```

## 项目结构

```
claude-wps-plugin/
├── src/                           # React 前端（TaskPane 侧边栏）
│   ├── api/
│   │   ├── claudeClient.ts        # Claude API 调用（SSE 流式响应）
│   │   ├── wpsAdapter.ts          # WPS JS API 封装 + Mock 模式
│   │   └── sessionStore.ts        # 会话持久化（CRUD + 记忆）
│   ├── components/
│   │   ├── CodeBlock.tsx           # 代码块（语法高亮 + Run/Copy）
│   │   ├── MessageBubble.tsx       # 消息气泡（Markdown 渲染）
│   │   ├── QuickActionCards.tsx    # 快捷命令卡片（按模式切换）
│   │   ├── ModeSelector.tsx        # 交互模式选择器（Agent/Plan/Ask）
│   │   ├── ModelSelector.tsx       # AI 模型选择器
│   │   ├── AttachmentMenu.tsx      # 附件菜单（剪贴板/PDF/图片）
│   │   └── HistoryPanel.tsx        # 历史会话面板
│   ├── App.tsx                     # 主应用（对话 + 状态管理）
│   └── types.ts                    # TypeScript 类型定义
├── proxy-server.js                 # Express 代理服务器（:3001）
├── skills/                         # 技能系统
│   ├── bundled/                    # 内置 Skills（9 个）
│   │   ├── wps-core-api/           #   WPS ET API 完整参考
│   │   ├── code-rules/             #   代码生成规范
│   │   ├── data-cleaning/          #   数据清洗
│   │   ├── formula-operations/     #   公式运算
│   │   ├── conditional-formatting/ #   条件格式
│   │   ├── data-analysis/          #   数据分析
│   │   ├── financial-modeling/     #   金融建模
│   │   ├── chart-creation/         #   图表创建
│   │   └── template-generation/    #   模板生成
│   ├── modes/                      # 交互模式（3 个）
│   │   ├── agent/                  #   自动执行模式
│   │   ├── plan/                   #   步骤规划模式
│   │   └── ask/                    #   只读分析模式
│   ├── connectors/                 # MCP 连接器（2 个）
│   │   ├── web-search/             #   网络搜索
│   │   └── knowledge-base/         #   企业知识库
│   └── workflows/                  # 工作流模板（1 个）
│       └── monthly-report/         #   月度报告生成
├── commands/                       # 快捷命令（14 个 .md 文件）
├── wps-addon/                      # WPS 加载项运行时
│   ├── main.js                     #   Plugin Host 入口
│   ├── ribbon.xml                  #   Ribbon 栏 UI 定义
│   └── *.png                       #   图标资源
├── manifest.xml                    # WPS 加载项清单
├── .claude-plugin/plugin.json      # 插件元数据
├── .mcp.json                       # MCP 连接器配置
├── AGENTS.md                       # AI Agent 行为定义
├── CONNECTORS.md                   # 连接器使用说明
├── build-dist.mjs                  # 生产构建脚本
├── install-to-wps.sh               # 自动安装脚本
└── 启动插件.command                 # macOS 双击启动器
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

### 交互模式

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| **Agent** | 直接操作表格 | 自动生成并执行代码，快速完成任务 |
| **Plan** | 复杂多步骤任务 | 先输出计划，逐步确认后执行 |
| **Ask** | 数据分析咨询 | 只读模式，纯文本回答，不生成代码 |

## 自定义与扩展

### 添加自定义 Skill

在 `skills/bundled/` 下创建新目录，编写 `SKILL.md`：

```markdown
---
name: my-custom-skill
description: 我的自定义技能
version: 1.0.0
context:
  keywords: [关键词1, 关键词2]
  always: false
---

## 技能描述

在此编写 System Prompt 内容...
```

### 添加自定义 Command

在 `commands/` 下创建 `.md` 文件：

```markdown
---
icon: 🎯
label: 我的命令
description: 命令描述
scope: general
---

命令的 prompt 内容...
```

### 配置 MCP 连接器

编辑 `.mcp.json` 填入你的 MCP 服务器地址：

```json
{
  "mcpServers": {
    "tavily-search": {
      "type": "http",
      "url": "https://your-tavily-mcp-endpoint"
    }
  }
}
```

详见 `CONNECTORS.md`。

## Fork 指南

Fork 本项目后，你可能需要修改以下内容：

| 文件 | 需要改什么 |
|------|-----------|
| `.env` | 选择你偏好的 Claude 模型 |
| `.mcp.json` | 配置你的 MCP 连接器 URL |
| `.claude-plugin/plugin.json` | 修改 `author` 字段为你的信息 |
| `manifest.xml` | 修改 `ProviderName` 和 `Id` |
| `skills/bundled/` | 添加/修改内置技能 |
| `commands/` | 添加/修改快捷命令 |
| `skills/modes/` | 自定义交互模式行为 |

### 扩展架构

```
skills/
├── bundled/     → 内置技能（随插件分发）
├── modes/       → 交互模式定义
├── connectors/  → MCP 数据源连接器
├── workflows/   → 多步骤工作流模板
├── managed/     → 社区技能（预留）
└── workspace/   → 用户自定义技能（预留）
```

所有技能文件均采用 **Markdown + YAML frontmatter** 格式，无需修改代码即可扩展功能。

## 版本日志

### v1.4.0 (2026-02-26) — 多模式交互 + 连接器 + 工作流

**交互模式系统**
- 新增 `ModeSelector` 组件，支持 Agent / Plan / Ask 三种模式切换
- 模式定义文件化（`skills/modes/*.md`），通过 frontmatter `enforcement` 控制行为
- Ask 模式禁止生成代码块，Plan 模式先规划后执行
- QuickActionCards 根据当前模式动态切换推荐操作
- `/modes` API 端点返回模式元数据和快捷操作

**MCP 连接器**
- 新增连接器架构（`skills/connectors/`），通过 `~~category` 占位符实现工具无关设计
- 内置 `web-search`（网络搜索）和 `knowledge-base`（企业知识库）连接器
- `.mcp.json` 配置文件，支持替换为任意同类 MCP 服务器
- `CONNECTORS.md` 文档说明连接器约定

**工作流模板**
- 新增工作流架构（`skills/workflows/`），预定义多步骤任务
- 内置 `monthly-report` 工作流（月度报告自动生成）
- 工作流可指定首选模式、所需技能、触发关键词

**plugin.json 升级**
- 完整声明 modes / connectors / workflows 能力清单

### v1.3.0 (2026-02-26) — 会话持久化 + 交互增强

**会话历史管理**
- 新增 `sessionStore.ts`：会话 CRUD + 自动标题生成 + 用户记忆
- 新增 `HistoryPanel` 组件：历史会话列表、切换、删除
- 启动时自动恢复最近一次会话
- 消息变化后 1s 去抖自动保存

**交互体验优化**
- Proxy 连接检测改为自动重试（最多 10 次，间隔 2s）
- 代码执行失败支持一键"重试修复"
- 剪贴板增强：支持粘贴图片（macOS PNGf）和 HTML 表格
- System Prompt 强化：上下文优先级、代码长度限制、ActiveSheet 强制

**WPS Plugin Host 增强**
- 重构为后台同步架构：定时推送上下文 + 轮询执行代码队列
- TaskPane 管理：持久化面板 ID，支持 toggle 显示/隐藏

**工程化**
- 新增 `build-dist.mjs` 生产构建脚本
- `npm start` 一键启动 proxy + dev

### v1.2.0 (2026-02-25) — 数据驱动的能力补齐

- 新增 5 个 Skills：`data-cleaning`、`formula-operations`、`conditional-formatting`、`data-analysis`、`financial-modeling`
- 新增 5 个 Commands：`smart-split`、`freeze-header`、`fill-cells`、`beautify-table`、`conditional-format`
- 上下文感知 Skill 匹配：用户消息关键词 + 选区特征自动加载对应 Skill

### v1.1.0 (2026-02-25) — Cowork 风格模块化重构

- Skills/Commands 模块化（借鉴 Anthropic Cowork + OpenClaw 架构）
- Skill Loader 按需匹配加载，减少 token 消耗
- 三层 skill 目录：`bundled/` → `managed/` → `workspace/`

### v1.0.0 (2026-02-25) — MVP 完整版

- React Task Pane (Vite + React + TypeScript) 侧边栏 UI
- Express Proxy Server (:3001)，通过 claude CLI 执行 AI 对话 (SSE 流式)
- WPS Plugin Host 上下文同步 + 代码执行桥
- Markdown 渲染 + 代码块语法高亮 + 9 个快捷操作
- 附件菜单：剪贴板读取、PDF 提取、图片上传

---

## 后续计划

- [x] Phase 3：Skills/Commands 模块化重构（v1.1.0）
- [x] Phase 4：数据驱动能力补齐 + 上下文感知（v1.2.0）
- [x] Phase 5A：会话持久化 + 交互增强（v1.3.0）
- [x] Phase 5B：多模式交互 + 连接器 + 工作流（v1.4.0）
- [ ] Phase 6：操作历史 + 撤销功能
- [ ] Phase 6：高级 Agent 任务拆解（分步执行 + 逐步确认）
- [ ] Phase 7：跨应用上下文（表格 → 演示 → 文档）
- [ ] Phase 8：企业版后端（API Key 集中管理、审计日志）

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | CSS Modules |
| AI | Claude CLI (SSE 流式) |
| 代理 | Express 5 |
| 宿主 | WPS Office JS API (ET) |
| 连接器 | MCP (Model Context Protocol) |
| 渲染 | react-markdown + remark-gfm + react-syntax-highlighter |

## 贡献指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/my-feature`
3. 提交更改：`git commit -m "feat: 添加新功能"`
4. 推送分支：`git push origin feat/my-feature`
5. 创建 Pull Request

### Commit 规范

```
feat: 新功能
fix: 修复 Bug
refactor: 重构（非新增功能/非修复）
docs: 文档更新
chore: 构建/工具链
```

### 添加新 Skill

参见 [自定义与扩展](#自定义与扩展) 部分，所有技能均为 Markdown 文件，无需修改代码。

## 相关项目

| 项目 | 说明 |
|------|------|
| [claude-wps-ppt-plugin](https://github.com/claude-office-skills/claude-wps-ppt-plugin) | Claude for WPS PowerPoint |
| [claude-wps-word-plugin](https://github.com/claude-office-skills/claude-wps-word-plugin) | Claude for WPS Word |

## License

[MIT](./LICENSE)
