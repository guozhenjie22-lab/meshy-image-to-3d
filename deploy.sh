#!/bin/bash
# ============================================================
# 一键部署脚本 - meshy-image-to-3d
# 适用：Ubuntu 22.04，Nginx 反代 Node.js (端口 8765)
# 用法：bash deploy.sh
# ============================================================

set -e

APP_NAME="meshy-app"
APP_DIR="/home/meshy-app"
REPO="https://github.com/guozhenjie22-lab/meshy-image-to-3d"
NODE_PORT=8765
NGINX_CONF="/etc/nginx/conf.d/meshy-app.conf"

echo "========================================"
echo "  开始部署 meshy-image-to-3d"
echo "========================================"

# ── 1. 安装系统依赖 ───────────────────────────────────────
echo "[1/5] 安装系统依赖..."
apt-get update -y -q
apt-get install -y -q git nginx curl
echo "  Node: $(node -v)   npm: $(npm -v)"

# ── 2. 安装 PM2 ───────────────────────────────────────────
echo "[2/5] 安装 PM2..."
npm install -g pm2 --quiet

# ── 3. 拉取 / 更新代码 ────────────────────────────────────
echo "[3/5] 拉取代码..."
if [ -d "$APP_DIR/.git" ]; then
  echo "  检测到已有仓库，执行 git pull..."
  cd "$APP_DIR"
  git pull origin master
else
  echo "  首次克隆仓库..."
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 4. PM2 启动/重启 Node 服务 ────────────────────────────
echo "[4/5] 启动 Node 服务 (PM2)..."
if pm2 describe "$APP_NAME" &> /dev/null; then
  pm2 reload "$APP_NAME"
  echo "  已重载 $APP_NAME"
else
  pm2 start server.js --name "$APP_NAME"
  echo "  已启动 $APP_NAME"
fi
pm2 startup systemd -u root --hp /root | tail -n1 | bash || true
pm2 save

# ── 5. 配置 Nginx 反向代理 ────────────────────────────────
echo "[5/5] 配置 Nginx..."
# 写入 Nginx 配置（conf.d 模式）
cat > "$NGINX_CONF" << 'NGINXEOF'
server {
    listen 80;
    server_name _;

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

# 测试并重载 Nginx
nginx -t
systemctl reload nginx
systemctl enable nginx

# ── 完成 ─────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  ✅ 部署完成！"
echo "  访问地址：http://$(curl -s ifconfig.me 2>/dev/null || echo '你的服务器IP')"
echo "  PM2 状态：pm2 list"
echo "  Nginx 状态：systemctl status nginx"
echo "========================================"
