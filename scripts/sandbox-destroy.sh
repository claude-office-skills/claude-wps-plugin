#!/usr/bin/env bash
set -euo pipefail

# ── 沙箱销毁脚本 ─────────────────────────────────────────────
#
# 用法：
#   ./scripts/sandbox-destroy.sh <沙箱名称>
#
# 示例：
#   ./scripts/sandbox-destroy.sh tdd-loop

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOX_ROOT="$(cd "$PROJECT_DIR/.." && pwd)/.sandboxes"

SANDBOX_NAME="${1:?用法: sandbox-destroy.sh <沙箱名称>}"
SANDBOX_DIR="$SANDBOX_ROOT/sandbox-$SANDBOX_NAME"
SANDBOX_BRANCH="sandbox/$SANDBOX_NAME"

if [ ! -d "$SANDBOX_DIR" ]; then
  echo "沙箱不存在: $SANDBOX_DIR"
  echo ""
  echo "已有的沙箱:"
  git -C "$PROJECT_DIR" worktree list 2>/dev/null | grep sandbox || echo "  (无)"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  销毁沙箱: $SANDBOX_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 停止沙箱中可能运行的进程
if [ -f "$SANDBOX_DIR/.env.sandbox" ]; then
  source "$SANDBOX_DIR/.env.sandbox"
  PIDS=$(lsof -i ":${SANDBOX_PORT:-3002}" -t 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "[1/3] 停止沙箱进程 (端口 ${SANDBOX_PORT:-3002})..."
    echo "$PIDS" | xargs kill 2>/dev/null || true
    echo "  ✓ 进程已停止"
  else
    echo "[1/3] 无运行中的沙箱进程"
  fi
else
  echo "[1/3] 跳过进程检查"
fi

# 2. 移除 worktree
echo "[2/3] 移除 Git worktree..."
cd "$PROJECT_DIR"
git worktree remove --force "$SANDBOX_DIR" 2>/dev/null || rm -rf "$SANDBOX_DIR"
echo "  ✓ worktree 已移除"

# 3. 删除分支
echo "[3/3] 删除分支 $SANDBOX_BRANCH..."
git branch -D "$SANDBOX_BRANCH" 2>/dev/null || true
echo "  ✓ 分支已删除"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  沙箱 $SANDBOX_NAME 已销毁"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
