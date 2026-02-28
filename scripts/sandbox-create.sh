#!/usr/bin/env bash
set -euo pipefail

# ── 沙箱隔离环境创建脚本 ──────────────────────────────────────
#
# 使用 Git worktree 创建一个独立的工作副本：
#   - 代码完全隔离：修改不影响主目录
#   - 共享 .git 历史：不需要重新 clone
#   - 独立 node_modules：不污染主环境
#   - 独立端口：沙箱用 3002，主环境用 3001
#
# 用法：
#   ./scripts/sandbox-create.sh [沙箱名称]
#
# 示例：
#   ./scripts/sandbox-create.sh           → 创建 sandbox-20260228-183045
#   ./scripts/sandbox-create.sh tdd-loop  → 创建 sandbox-tdd-loop

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOX_ROOT="$(cd "$PROJECT_DIR/.." && pwd)/.sandboxes"

SANDBOX_NAME="${1:-$(date +%Y%m%d-%H%M%S)}"
SANDBOX_DIR="$SANDBOX_ROOT/sandbox-$SANDBOX_NAME"
SANDBOX_BRANCH="sandbox/$SANDBOX_NAME"
SANDBOX_PORT=3002

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  创建开发沙箱: $SANDBOX_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 创建沙箱目录
mkdir -p "$SANDBOX_ROOT"

# 2. 创建独立分支 + worktree
cd "$PROJECT_DIR"
echo ""
echo "[1/5] 创建 Git worktree..."

if git worktree list | grep -q "$SANDBOX_DIR"; then
  echo "  沙箱已存在: $SANDBOX_DIR"
  echo "  使用 sandbox-destroy.sh $SANDBOX_NAME 删除后重建"
  exit 1
fi

git worktree add -b "$SANDBOX_BRANCH" "$SANDBOX_DIR" HEAD
echo "  ✓ worktree: $SANDBOX_DIR"
echo "  ✓ branch:   $SANDBOX_BRANCH"

# 2.5. 同步未提交的文件（确保新增的测试/脚本/配置也在沙箱中）
echo ""
echo "[1.5/5] 同步未提交的文件..."
SYNC_FILES=(
  "proxy-server.js"
  "package.json"
  "vitest.config.ts"
  "playwright.config.ts"
  "Dockerfile"
  "docker-compose.yml"
  ".dockerignore"
  "AGENTS.md"
)
for f in "${SYNC_FILES[@]}"; do
  if [ -f "$PROJECT_DIR/$f" ]; then
    cp "$PROJECT_DIR/$f" "$SANDBOX_DIR/$f"
  fi
done
# 同步目录
for d in tests scripts; do
  if [ -d "$PROJECT_DIR/$d" ]; then
    mkdir -p "$SANDBOX_DIR/$d"
    cp -r "$PROJECT_DIR/$d/" "$SANDBOX_DIR/$d/"
  fi
done
echo "  ✓ 已同步 ${#SYNC_FILES[@]} 个文件 + tests/ + scripts/"

# 3. 安装依赖
echo ""
echo "[2/5] 安装 npm 依赖..."
cd "$SANDBOX_DIR"
npm ci --silent 2>/dev/null || npm install --silent
echo "  ✓ node_modules 已安装"

# 4. 配置沙箱端口（避免和主环境冲突）
echo ""
echo "[3/5] 配置沙箱端口 ($SANDBOX_PORT)..."

# 创建沙箱专用环境变量文件
cat > "$SANDBOX_DIR/.env.sandbox" << EOF
# 沙箱环境配置 — 自动生成，请勿手动编辑
SANDBOX_NAME=$SANDBOX_NAME
SANDBOX_PORT=$SANDBOX_PORT
SANDBOX_DIR=$SANDBOX_DIR
NODE_ENV=development
EOF
echo "  ✓ .env.sandbox 已创建"

# 5. 创建沙箱启动脚本
echo ""
echo "[4/5] 创建启动脚本..."

mkdir -p "$SANDBOX_DIR/scripts"

cat > "$SANDBOX_DIR/scripts/sandbox-start.sh" << 'STARTEOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SANDBOX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SANDBOX_DIR/.env.sandbox"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  启动沙箱: $SANDBOX_NAME"
echo "  端口:     $SANDBOX_PORT"
echo "  目录:     $SANDBOX_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查端口占用
if lsof -i ":$SANDBOX_PORT" -t >/dev/null 2>&1; then
  echo "⚠️  端口 $SANDBOX_PORT 已被占用"
  echo "   运行: lsof -i :$SANDBOX_PORT 查看进程"
  exit 1
fi

cd "$SANDBOX_DIR"

# 用沙箱端口启动 proxy-server
PORT=$SANDBOX_PORT node proxy-server.js &
PROXY_PID=$!
echo "✓ proxy-server 已启动 (PID: $PROXY_PID, 端口: $SANDBOX_PORT)"

# 等待健康检查
for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:$SANDBOX_PORT/health" >/dev/null 2>&1; then
    echo "✓ 服务就绪"
    break
  fi
  sleep 1
done

echo ""
echo "可用命令:"
echo "  npm run test:unit        — 单元测试"
echo "  npm run test:api         — API 测试 (需改 baseURL)"
echo "  npx vitest --watch       — 监听模式"
echo ""
echo "按 Ctrl+C 停止沙箱..."
wait $PROXY_PID
STARTEOF

chmod +x "$SANDBOX_DIR/scripts/sandbox-start.sh"
echo "  ✓ sandbox-start.sh 已创建"

# 6. 创建 Claude Code 的沙箱 CLAUDE.md
cat > "$SANDBOX_DIR/CLAUDE.md" << CLAUDEEOF
# 沙箱环境 — $SANDBOX_NAME

这是一个隔离的开发沙箱。你可以自由修改此目录下的任何文件。

## 限制

- 只修改此目录下的文件，不要访问父目录
- proxy-server 运行在端口 $SANDBOX_PORT（不是 3001）
- 测试时用 BASE_URL=http://127.0.0.1:$SANDBOX_PORT

## 测试命令

\`\`\`bash
npx vitest run                           # 单元测试
npx playwright test --project=api        # API 测试（需先启动 proxy）
\`\`\`
CLAUDEEOF

echo ""
echo "[5/5] 完成!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  沙箱创建成功!"
echo ""
echo "  目录: $SANDBOX_DIR"
echo "  分支: $SANDBOX_BRANCH"
echo "  端口: $SANDBOX_PORT"
echo ""
echo "  进入沙箱:"
echo "    cd $SANDBOX_DIR"
echo ""
echo "  启动服务:"
echo "    ./scripts/sandbox-start.sh"
echo ""
echo "  在沙箱中启动 Claude Code (全自动 TDD):"
echo "    cd $SANDBOX_DIR"
echo "    claude --dangerously-skip-permissions"
echo ""
echo "  删除沙箱:"
echo "    ./scripts/sandbox-destroy.sh $SANDBOX_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
