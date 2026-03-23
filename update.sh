#!/bin/bash
# ============================================================
# 更新脚本 - meshy-image-to-3d
# 用法：bash update.sh
# 适用于已完成首次部署后的代码更新
# ============================================================

set -e

APP_NAME="meshy-app"
APP_DIR="/home/meshy-app"

echo "[1/2] 拉取最新代码..."
cd "$APP_DIR"
git fetch --all
git reset --hard origin/master
echo "  当前版本: $(git log -1 --format='%h %s')"

echo "[2/2] 重启服务..."
pm2 reload "$APP_NAME"
pm2 save

echo ""
echo "========================================"
echo "  更新完成！"
echo "  pm2 list         查看服务状态"
echo "  pm2 logs meshy-app  查看日志"
echo "========================================"
