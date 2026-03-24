#!/bin/bash
# ============================================================
# 部署/更新脚本 - meshy-image-to-3d
# 适用：Ubuntu 22.04，Nginx 反代 Node.js (端口 8765)
# 用法：bash deploy.sh
#   首次运行：自动安装依赖、克隆代码、配置 Nginx
#   再次运行：拉取最新代码、重启服务（跳过已完成的步骤）
# ============================================================

set -e

APP_NAME="meshy-app"
APP_DIR="/home/meshy-app"
REPO="https://github.com/guozhenjie22-lab/meshy-image-to-3d"
NODE_PORT=8765
NGINX_CONF="/etc/nginx/conf.d/meshy-app.conf"

echo "========================================"
echo "  部署/更新 meshy-image-to-3d"
echo "========================================"

# ── 1. 安装系统依赖（已安装则跳过）─────────────────────────
if ! command -v nginx &> /dev/null; then
  echo "[1/4] 安装系统依赖..."
  apt-get update -y -q
  apt-get install -y -q git nginx curl
else
  echo "[1/4] 系统依赖已就绪，跳过"
fi
echo "  Node: $(node -v)   npm: $(npm -v)"

# ── 2. 安装 PM2（已安装则跳过）──────────────────────────────
if ! command -v pm2 &> /dev/null; then
  echo "[2/4] 安装 PM2..."
  npm install -g pm2 --quiet
else
  echo "[2/4] PM2 已就绪，跳过"
fi

# ── 3. 拉取 / 更新代码 ────────────────────────────────────
echo "[3/4] 同步代码..."
if [ -d "$APP_DIR/.git" ]; then
  echo "  检测到已有仓库，拉取最新代码..."
  cd "$APP_DIR"
  git fetch --all
  git reset --hard origin/master
  echo "  当前版本: $(git log -1 --format='%h %s')"
else
  echo "  首次克隆仓库..."
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 4. PM2 启动/重启 Node 服务 ────────────────────────────
echo "[4/4] 启动/重载服务..."
if pm2 describe "$APP_NAME" &> /dev/null; then
  pm2 reload "$APP_NAME"
  echo "  已重载 $APP_NAME"
else
  pm2 start server.js --name "$APP_NAME"
  pm2 startup systemd -u root --hp /root | tail -n1 | bash || true
  echo "  已启动 $APP_NAME"
fi
pm2 save

# ── 5. 配置 Nginx（已有配置则跳过）──────────────────────────
if [ ! -f "$NGINX_CONF" ]; then
  echo "[+] 写入 Nginx 配置..."
  cat > "$NGINX_CONF" << 'NGINXEOF'
server {
    listen 80;
    server_name founderbook.com.cn www.founderbook.com.cn;

    client_max_body_size 20M;

    location / {
        proxy_pass         http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location ~* \.(css|js|png|jpg|ico|glb)$ {
        proxy_pass       http://127.0.0.1:8765;
        proxy_set_header Host $host;
        expires          7d;
        add_header       Cache-Control public;
    }
}
NGINXEOF
  nginx -t
  systemctl reload nginx
  systemctl enable nginx
else
  echo "[+] Nginx 配置已存在，跳过（如需重置请手动删除 $NGINX_CONF）"
fi

# ── 完成 ─────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  ✅ 完成！"
echo "  访问地址：https://founderbook.com.cn"
echo "  PM2 状态：pm2 list"
echo "  查看日志：pm2 logs $APP_NAME"
echo "  Nginx 状态：systemctl status nginx"
echo "========================================"
