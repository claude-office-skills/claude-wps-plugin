# Changelog

All notable changes to Claude for WPS Excel will be documented in this file.

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
