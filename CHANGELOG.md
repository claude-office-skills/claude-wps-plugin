# Changelog

All notable changes to Claude for WPS Excel will be documented in this file.

## [2.1.0] - 2026-02-28

### Added
- **Multi-Agent 并行执行**：支持多 Agent Tab 并行运行、语义命名、持久化
- **Cursor 风格左侧侧边栏**：始终可见的 Tab 栏 + Agent 列表面板
- **金融数据连接器**（skills/connectors/financial-data/）：基于 yfinance 自动获取财务数据，支持 Cover/Income/Balance/CF 多维度字段
- **DCF 估值模型 v3.0**（skills/bundled/financial-modeling/）：Bloomberg/Macabacus 风格 7-Sheet 结构，三色字体规则，动态敏感性分析矩阵
- **Docker 部署支持**：新增 Dockerfile + docker-compose.yml
- **PlanEditor 组件**：步骤规划编辑器
- **UpdateNotification 组件**：版本更新通知
- **E2E 测试框架**：Playwright 配置 + vitest 单元测试

### Changed
- **ModeSelector 下拉化**：Agent/Plan/Ask 模式从水平 Tab 改为 Cursor 风格下拉抽屉，与 ModelSelector 统一交互
- **统一配色方案**：--accent 保留 Claude 橙用于按钮交互，新增 --ui-accent 钢蓝色用于状态标签/徽章等非交互元素
- **代码块颜色精简**：去除亮紫和亮绿，统一为低饱和灰/灰绿色调
- **去除 Emoji**：全局替换为专业字符图标，提升专业感
- **对话区域 Cursor 化**：移除 You/Agent 标签，用户消息用区域色块区分
- **DiffPanel 弱化设计**：修改区域改为线框色块，5 行摘要
- **Provenance 精简**：底部仅显示技能标签，隐藏模型名
- **动态 Auto-Continuation**：根据任务复杂度自动调整续执行上限（简单 2 步 / 中等 4 步 / 复杂 8 步）
- **System Prompt 优化**：明确分步执行规则，防止简单任务过度优化

### Fixed
- 修复 32000 token 超限导致的 Thinking 死循环（任务拆解 + 动态续执行）
- 修复代码块溢出容器问题
- 修复 WPS 大规模写入崩溃（ScreenUpdating=false + 批量操作）
- 修复 Sheet 创建弹窗干扰（DisplayAlerts=false 静默创建）
- 修复 DCF 公式 #REF!/#NAME? 错误（强制 Sheet 名一致性）
- 修复用户输入框被截断、流输出截流问题
- 修复执行结果区域无法滚动查看

## [2.0.0] - 2026-02-27

### Added
- **Multi-Agent 基础设施**：状态管理器、Tab 栏、Agent 列表面板
- **Agent 语义命名**：根据首条消息自动命名
- **键盘快捷键**：Tab 关闭、Agent 切换
- **Proxy 多会话支持**：每个 Agent 独立会话上下文

## [1.5.0] - 2026-02-26

### Added
- **单元格逐行动画**：Claude 生成表格数据后，逐行逐单元格填充，提供可视化"AI 正在工作"效果
- **DiffPanel 组件**：代码执行前后的变更对比展示（`src/components/DiffPanel.tsx`）
- **选区引用功能**：聊天时可引用当前选中的单元格区域作为上下文
- **新建子表检测**：当 Claude 代码创建新 Sheet 时，自动调整 diff 基准为空白状态

### Changed
- 侧边栏默认位置从右侧改为**左侧**
- 加载动画颜色从紫色（#8b5cf6）改为 **Excel 品牌绿**（#217346）
- Ribbon 标题从 "Claude for WPS" 改为 "Claude for Excel"

### Fixed
- 修复单元格动画中 `ws.Cells` 不可用的问题，改用 `ws.Range("A1").Value2` 语法
- 修复代码执行后白屏问题（dist 构建过时导致 React mount 失败）
- 修复流式输出中断问题（SSE 流恢复正常 token 逐步输出）
- 修复 TaskPane 崩溃后无法重新打开的问题

## [1.4.0] - 2026-02-26

### Added
- 多模式交互（Agent / Plan / Ask）
- MCP 连接器系统（Web Search / Knowledge Base）
- 工作流模板
- Fork 友好化（.env.example, install 脚本）

## [1.3.0] - 2026-02-26

### Added
- 会话持久化 + 历史面板
- MessageBubble / ModelSelector memo 优化
- 交互增强（快捷指令卡片、剪贴板粘贴）

## [1.2.0] - 2026-02-25

### Added
- 数据驱动能力（图表创建、条件格式、数据分析）
- 上下文感知 Skill 匹配

## [1.1.0] - 2026-02-25

### Added
- Cowork 风格 Skills/Commands 模块化重构
- 9 个内置 Skills + 14 个 Commands
