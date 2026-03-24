# 部署经验总结

## 服务器信息

| 项目 | 值 |
|------|----|
| 系统 | Ubuntu 22.04 64位 |
| 公网 IP | `8.145.34.254` |
| 域名 | `founderbook.com.cn` |
| Node.js | v20（服务器已预装） |
| Nginx | v1.28，使用 `conf.d` 模式 |
| 进程管理 | PM2 |
| 项目目录 | `/home/meshy-app` |
| 访问地址 | https://founderbook.com.cn |

---

## 部署与更新

### 首次部署

服务器上还没有仓库，需要先上传 `deploy.sh` 再执行：

```bash
scp deploy.sh root@8.145.34.254:/root/deploy.sh
ssh root@8.145.34.254 "bash /root/deploy.sh"
```

### 后续更新

`deploy.sh` 已在仓库中，直接在服务器上执行，无需从本地上传：

```bash
ssh root@8.145.34.254 "cd /home/meshy-app && git pull origin master && bash deploy.sh"
```

`deploy.sh` 会自动跳过已完成的步骤（已安装的依赖、已有的 Nginx 配置），部署完成后自动打印 PM2 状态、应用日志和 Nginx 状态。

---

## 架构说明

```
用户浏览器
    │
    ▼ :443 (HTTPS)  或  :80 → 自动跳转 443
  Nginx (/etc/nginx/conf.d/meshy-app.conf)
  证书由 Certbot (Let's Encrypt) 管理，90 天自动续期
    │
    ▼ 反向代理到 127.0.0.1:8765（仅服务器内部可达）
  Node.js server.js（PM2 守护，开机自启）
```

---

## HTTPS 配置（Let's Encrypt + Certbot）

### 工具说明

| 工具 | 作用 |
|------|------|
| **Let's Encrypt** | 免费 CA 机构，提供受信任的 TLS 证书，有效期 90 天 |
| **Certbot** | Let's Encrypt 官方客户端，自动申请/续期证书，支持 Nginx 插件一键配置 |
| **snap** | Ubuntu 通用包管理器，推荐用来安装 Certbot（版本最新、依赖独立） |
| **Nginx `--nginx` 插件** | Certbot 自动修改 Nginx 配置，加入 SSL 证书路径并配置 HTTP→HTTPS 跳转 |

### 前提条件

- 域名 A 记录已解析到服务器公网 IP
- 云服务器安全组已开放 **TCP 80**（Certbot HTTP-01 验证用）和 **TCP 443** 入方向
- Nginx `server_name` 必须是真实域名（不能是 `_` 通配），否则 Certbot 验证失败

### 操作步骤

```bash
# 1. 将 Nginx 的 server_name 改为真实域名
ssh root@8.145.34.254 "sed -i 's/server_name _;/server_name founderbook.com.cn www.founderbook.com.cn;/' /etc/nginx/conf.d/meshy-app.conf && nginx -t && systemctl reload nginx"

# 2. 安装 Certbot
ssh root@8.145.34.254 "snap install --classic certbot && ln -sf /snap/bin/certbot /usr/bin/certbot"

# 3. 申请证书，自动配置 Nginx（非交互式）
ssh root@8.145.34.254 "certbot --nginx -d founderbook.com.cn -d www.founderbook.com.cn --non-interactive --agree-tos --email 2171929105@qq.com"
```

执行完毕后 Certbot 自动完成：
1. 通过 HTTP-01 验证域名所有权
2. 下载证书到 `/etc/letsencrypt/live/founderbook.com.cn/`
3. 修改 Nginx 配置，加入 SSL 证书路径
4. 配置 80 端口永久跳转到 443

### 证书自动续期

Certbot 安装时已自动注册 systemd 定时任务，每天检查两次，剩余 < 30 天时自动续期，**无需手动干预**。到期前 Let's Encrypt 会发邮件到 `2171929105@qq.com` 提醒（由 Let's Encrypt 服务器发出，非本机）。

```bash
# 验证续期流程（不会真正操作）
ssh root@8.145.34.254 "certbot renew --dry-run"

# 查看定时任务状态
ssh root@8.145.34.254 "systemctl status snap.certbot.renew.timer"
```

### 最终 Nginx 配置（Certbot 自动生成）

```nginx
server {
    listen 80;
    server_name founderbook.com.cn www.founderbook.com.cn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name founderbook.com.cn www.founderbook.com.cn;

    ssl_certificate     /etc/letsencrypt/live/founderbook.com.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/founderbook.com.cn/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

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
}
```

---

## 踩坑记录

### 1. CRLF 换行符问题
- **现象**：shell 脚本在 Linux 执行报 `bash: $'\r': command not found`
- **原因**：Windows 上编辑的文件换行符为 CRLF，Linux bash 不识别 `\r`
- **解决**：在 `.gitattributes` 中强制 `.sh` 文件使用 LF
  ```
  *.sh text eol=lf
  ```

### 2. Nginx 多项目 80 端口冲突
- **现象**：访问 IP 显示的是另一个项目，不是当前项目
- **原因**：服务器上已有其他项目也监听 80 端口，`server_name` 为具体 IP，优先级高于 `_`
- **解决**：删除旧项目的 Nginx 配置和 PM2 进程，确保 80 端口只有一个 server 块

### 3. Nginx 配置路径
- **现象**：脚本中用 `sites-available/sites-enabled` 软链接方式创建配置，但 `sites-enabled` 目录不存在
- **原因**：该服务器的 Nginx 是官方源安装，使用 `conf.d/*.conf` 模式，没有 Ubuntu 默认的 `sites-*` 目录
- **解决**：配置文件直接写入 `/etc/nginx/conf.d/meshy-app.conf`

### 4. SSH heredoc 在单行命令中失效
- **现象**：通过 `ssh host "cat > file << 'EOF' ... EOF"` 写入文件时，heredoc 不生效
- **原因**：heredoc 语法依赖 shell 的多行解析，单行 ssh 命令中不可靠
- **解决**：改用 `printf` 写入文件，或先 `scp` 上传再执行

### 5. Certbot 报 "Another instance is already running"
- **现象**：执行 `certbot renew --dry-run` 时提示已有实例在运行
- **原因**：上一条 certbot 命令的后台进程还未退出，锁文件未释放
- **解决**：等待约 10 秒后重试，或 `pkill -f certbot` 后再执行

### 6. Nginx server_name 为 `_` 导致 Certbot 验证失败
- **现象**：Certbot 申请证书时提示无法验证域名
- **原因**：`server_name _` 是通配写法，Certbot HTTP-01 验证要求能通过域名访问到服务器
- **解决**：申请证书前先将 `server_name` 改为真实域名，`nginx -t && systemctl reload nginx`

---

## 常用运维命令

```bash
# 更新代码并重启服务
ssh root@8.145.34.254 "cd /home/meshy-app && git pull origin master && bash deploy.sh"

# 查看 PM2 进程状态
ssh root@8.145.34.254 "pm2 list"

# 查看应用实时日志
ssh root@8.145.34.254 "pm2 logs meshy-app --lines 50"

# 重启服务
ssh root@8.145.34.254 "pm2 restart meshy-app"

# 查看 Nginx 状态
ssh root@8.145.34.254 "systemctl status nginx"

# 查看端口占用
ssh root@8.145.34.254 "ss -tlnp | grep LISTEN"

# 查看证书到期时间
ssh root@8.145.34.254 "certbot certificates"
```
