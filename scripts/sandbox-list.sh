#!/usr/bin/env bash
set -euo pipefail

# ── 列出所有沙箱 ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  当前沙箱列表"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$PROJECT_DIR"
WORKTREES=$(git worktree list 2>/dev/null | grep sandbox || true)

if [ -z "$WORKTREES" ]; then
  echo "  (无活跃沙箱)"
  echo ""
  echo "  创建沙箱: ./scripts/sandbox-create.sh [名称]"
else
  echo "$WORKTREES" | while read -r line; do
    DIR=$(echo "$line" | awk '{print $1}')
    BRANCH=$(echo "$line" | awk '{print $3}' | tr -d '[]')
    NAME=$(basename "$DIR" | sed 's/^sandbox-//')

    # 检查端口
    PORT="未知"
    if [ -f "$DIR/.env.sandbox" ]; then
      PORT=$(grep SANDBOX_PORT "$DIR/.env.sandbox" | cut -d= -f2)
    fi

    # 检查是否运行中
    RUNNING="停止"
    if lsof -i ":$PORT" -t >/dev/null 2>&1; then
      RUNNING="运行中"
    fi

    echo "  名称:   $NAME"
    echo "  目录:   $DIR"
    echo "  分支:   $BRANCH"
    echo "  端口:   $PORT"
    echo "  状态:   $RUNNING"
    echo "  ─────────────────────────"
  done
fi
echo ""
