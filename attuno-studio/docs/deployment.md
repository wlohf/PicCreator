# Ubuntu 部署与更新

这套流程面向 Ubuntu VPS：后端用 systemd 常驻运行，前端用 Nginx 托管构建产物，`/api` 由 Nginx 反代到 FastAPI。后续更新通过 `deploy/update.sh` 完成。

## 推荐目录

```bash
/opt/attuno/PicCreator        # Git 代码目录
/var/lib/attuno               # 用户数据、结果图片、账号数据
/etc/systemd/system/          # API 服务
/etc/nginx/sites-available/   # Nginx 站点配置
```

运行数据不要放在 Git 工作树里。后端服务模板默认设置：

```bash
ATTUNO_STUDIO_DATA_DIR=/var/lib/attuno
APP_HOST=127.0.0.1
APP_PORT=8787
```

## 1. 安装系统依赖

Ubuntu 服务器先准备 Git、Python、Nginx 和 Node.js 20+：

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nginx curl ca-certificates

# Node.js 版本需要 >= 20。可用你习惯的 nvm / NodeSource / 面板工具安装。
node --version
npm --version
```

如果 `node --version` 小于 20，先升级 Node.js，再继续。

## 2. 准备部署用户和代码目录

示例使用 `attuno` 用户运行服务：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin attuno || true
sudo mkdir -p /opt/attuno /var/lib/attuno
sudo chown -R "$USER:$USER" /opt/attuno
sudo chown -R attuno:attuno /var/lib/attuno

cd /opt/attuno
git clone <你的仓库地址> PicCreator
cd /opt/attuno/PicCreator
```

如果你用当前登录用户运行服务，把 service 文件里的 `User=` 和 `Group=` 改成对应用户即可。

## 3. 首次安装项目依赖

```bash
cd /opt/attuno/PicCreator
bash deploy/install.sh
```

脚本会做这些事：

- 创建 `attuno-studio/.venv`
- 安装 `requirements.txt`
- 安装前端依赖并执行 `npm run build`
- 如果缺少 `.env` / `config.json`，从示例文件复制一份
- 创建 `/var/lib/attuno`

脚本不会覆盖已有的 `.env` 或 `config.json`。

## 4. 配置 API Key 和模型

编辑：

```bash
nano /opt/attuno/PicCreator/attuno-studio/.env
nano /opt/attuno/PicCreator/attuno-studio/config.json
```

至少确认这些密钥和模型配置可用：

```env
LLM_API_KEY=...
VISION_API_KEY=...
IMAGE_API_KEY=...
```

如果用前端登录后的“模型与 API”设置保存配置，非默认用户的配置会写入 `/var/lib/attuno/users/<user>/config/`。

## 5. 安装 systemd 服务

```bash
sudo cp deploy/attuno-api.service.example /etc/systemd/system/attuno-api.service
sudo nano /etc/systemd/system/attuno-api.service
```

检查并按你的实际路径调整这些字段：

```ini
User=attuno
Group=attuno
WorkingDirectory=/opt/attuno/PicCreator/attuno-studio
ExecStart=/opt/attuno/PicCreator/attuno-studio/.venv/bin/python /opt/attuno/PicCreator/attuno-studio/api_server.py
Environment=ATTUNO_STUDIO_DATA_DIR=/var/lib/attuno
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now attuno-api
sudo systemctl status attuno-api
curl http://127.0.0.1:8787/api/health
```

如果服务用户需要写 `.env` / `config.json`，确保 `attuno-studio/` 对该用户可写；更推荐手动维护默认配置，把用户运行数据放到 `/var/lib/attuno`。

## 6. 安装 Nginx 站点

```bash
sudo cp deploy/nginx.attuno.conf.example /etc/nginx/sites-available/attuno
sudo nano /etc/nginx/sites-available/attuno
```

至少改两处：

```nginx
server_name 你的域名或服务器IP;
root /opt/attuno/PicCreator/attuno-studio/ui-prototype/dist;
```

启用站点：

```bash
sudo ln -sfn /etc/nginx/sites-available/attuno /etc/nginx/sites-enabled/attuno
sudo nginx -t
sudo systemctl reload nginx
```

访问：

```text
http://你的域名或服务器IP/
```

## 7. 后续更新

以后更新代码时，在服务器运行：

```bash
cd /opt/attuno/PicCreator
bash deploy/update.sh
```

更新脚本会依次执行：

1. `git pull --ff-only`
2. 安装/刷新 Python 依赖
3. `npm ci` 或 `npm install`
4. `npm run build`
5. `systemctl restart attuno-api`
6. 检查 `http://127.0.0.1:8787/api/health`
7. `nginx -t` 后 reload Nginx

常用覆盖项：

```bash
SKIP_GIT_PULL=1 bash deploy/update.sh        # 本地已经手动更新代码
RELOAD_NGINX=0 bash deploy/update.sh         # 只重启 API，不 reload Nginx
ATTUNO_SERVICE_NAME=my-api bash deploy/update.sh
ATTUNO_HEALTH_URL=http://127.0.0.1:8787/api/health bash deploy/update.sh
```

## 8. 回滚和备份

更新前建议备份数据和配置：

```bash
sudo tar -czf "attuno-data-$(date +%F).tar.gz" -C /var/lib attuno
cp attuno-studio/.env "attuno-env-$(date +%F).bak"
cp attuno-studio/config.json "attuno-config-$(date +%F).bak"
```

如果更新后要回滚代码：

```bash
cd /opt/attuno/PicCreator
git log --oneline -5
git checkout <上一个可用提交>
bash deploy/update.sh
```

`deploy/update.sh` 默认使用 `git pull --ff-only`，不会强制覆盖服务器本地修改。

## 常见问题

**502 Bad Gateway**

后端服务没有启动或端口不对：

```bash
sudo systemctl status attuno-api
journalctl -u attuno-api -n 100 --no-pager
curl http://127.0.0.1:8787/api/health
```

**前端页面打开但 API 报错**

确认 Nginx `/api/` 反代配置仍指向：

```nginx
proxy_pass http://127.0.0.1:8787;
```

**SSE/生成过程很快断开**

确认 Nginx 配置保留了：

```nginx
proxy_buffering off;
proxy_read_timeout 900s;
proxy_send_timeout 900s;
```

**构建失败提示 Node 版本过低**

升级到 Node.js 20+ 后重新运行：

```bash
bash deploy/update.sh
```
