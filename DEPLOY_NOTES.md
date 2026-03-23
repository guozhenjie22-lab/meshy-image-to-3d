# 部署经验总结

## 服务器信息

| 项目 | 值 |
|------|----|
| 系统 | Ubuntu 22.04 64位 |
| 公网 IP | `8.145.34.254` |
| Node.js | v20（服务器已预装） |
| Nginx | v1.28，使用 `conf.d` 模式 |
| 进程管理 | PM2 |
| 项目目录 | `/home/meshy-app` |
| 访问地址 | http://8.145.34.254 |

---

## 首次部署

```bash
# 1. 上传部署脚本（本地执行）
scp deploy.sh root@8.145.34.254:/root/deploy.sh

# 2. SSH 登录并执行
ssh root@8.145.34.254 "bash /root/deploy.sh"
```

> **注意**：deploy.sh 必须是 LF 换行（已通过 `.gitattributes` 保证），
> 否则在 Linux 执行会报 `$'\r': command not found` 错误。

---

## 后续更新代码

```bash
# 本地推送代码后，执行：
ssh root@8.145.34.254 "cd /home/meshy-app && git pull origin master && pm2 reload meshy-app"
```

或者使用 `update.sh`：

```bash
scp update.sh root@8.145.34.254:/root/update.sh
ssh root@8.145.34.254 "bash /root/update.sh"
```

---

## 架构说明

```
用户浏览器
    │
    ▼ :80
  Nginx (/etc/nginx/conf.d/meshy-app.conf)
    │
    ▼ 反向代理到 127.0.0.1:8765
  Node.js server.js（PM2 守护）
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
- **现象**：访问 IP 显示的是另一个项目（founderbook），不是当前项目
- **原因**：服务器上已有其他项目也监听 80 端口，且 `server_name` 为具体 IP，优先级高于 `_`
- **解决**：删除旧项目的 Nginx 配置和 PM2 进程，确保 80 端口只有一个 server 块

### 3. Nginx 配置路径
- **现象**：脚本中用 `sites-available/sites-enabled` 软链接方式创建配置，但 `sites-enabled` 目录不存在
- **原因**：该服务器的 Nginx 是官方源安装，使用 `conf.d/*.conf` 模式，没有 Ubuntu 默认的 `sites-*` 目录
- **解决**：配置文件直接写入 `/etc/nginx/conf.d/meshy-app.conf`

### 4. SSH heredoc 在单行命令中失效
- **现象**：通过 `ssh host "cat > file << 'EOF' ... EOF"` 写入文件时，heredoc 不生效
- **原因**：heredoc 语法依赖 shell 的多行解析，单行 ssh 命令中不可靠
- **解决**：改用 `printf` 写入文件，或先 `scp` 上传再执行

---

## 常用运维命令

```bash
# 查看服务状态
ssh root@8.145.34.254 "pm2 list"

# 查看实时日志
ssh root@8.145.34.254 "pm2 logs meshy-app --lines 50"

# 重启服务
ssh root@8.145.34.254 "pm2 restart meshy-app"

# 查看 Nginx 状态
ssh root@8.145.34.254 "systemctl status nginx"

# 查看端口占用
ssh root@8.145.34.254 "ss -tlnp | grep LISTEN"
```
