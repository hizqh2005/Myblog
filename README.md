# 个人知识库 Blog

> 单人自用的知识库型博客，本地 localhost 运行。读侧（浏览文章）完全公开，写侧（editor 管理端）需要口令。
> 权威开发计划见 [PLAN.md](PLAN.md)（需求、API 全表、6 阶段清单均已全部完成）。

---

## 一、这个项目是干什么的

- **主页**：左侧 Windows 式文件夹树（任意嵌套，文章是 lnk 式节点），右侧按年份分组的全量文章信息流（带跳年按钮），两侧相互独立、互不筛选
- **阅读页**：独立页面，所有文章链接一律在**新标签**打开，不占主页
- **管理端**（`editor.html`）：口令门 → 双窗口切换：
  - **管理窗口**：左树（悬停出按钮：新建子文件夹/新建文章/重命名/移动/删除）+ 右文章列表（标题搜索 + 范围切换：当前文件夹/全部/未分类）
  - **写作窗口**：标题 + 左 textarea / 右实时预览，保存 = 按钮或 Ctrl+S，无自动保存
- **图片**：写作时 Ctrl+V 粘贴截图自动上传，也可"导入图片"；全部落在 `images/`，公开访问
- **不做**：全文搜索、草稿、多用户、SEO、旧数据迁移

---

## 二、怎么启动

```bash
cd /home/zqh/Work/Blog
npm i          # 首次运行才需要装依赖
npm start      # = node --env-file=.env server.js
```

打开浏览器访问：

| 地址 | 说明 |
|---|---|
| http://localhost:3000 | 主页 |
| http://localhost:3000/editor.html | 管理端（口令在 `.env`，默认 `hizqh`） |
| http://localhost:3000/post.html?id=1 | 阅读页 |

配置在 `.env`：

```
PORT=3000             # 改端口
BLOG_PASSWORD=hizqh    # 改管理口令
```

> 注意：登录会话存在内存里，**服务重启后需要重新输口令**；数据存在 `db/blog.db`，重启不丢。

---

## 三、架构与目录结构

```
Blog/
├── server.js            # 后端唯一入口：静态托管 + REST API + 鉴权 + SQLite
├── package.json         # 唯一依赖 better-sqlite3；npm start 脚本
├── .env                 # 端口、管理口令（不进代码）
├── PLAN.md              # 权威开发计划（需求/API/进度勾选）
├── README.md            # 本文件
├── db/blog.db           # SQLite 数据库（启动时自动建表）
├── images/              # 上传的图片，公开访问 /images/*
└── public/              # 前端（被 server.js 静态托管，纯静态零依赖）
    ├── index.html       # 主页：树 + 年份信息流
    ├── post.html        # 阅读页
    ├── editor.html      # 管理端（口令门 + 双窗口）
    ├── icon.jpg         # 头像 + favicon
    ├── css/style.css    # 全部样式（三个页面共用）
    └── js/
        ├── store.js     # 数据层：fetch 封装 /api/*，页面只跟它打交道
        └── markdown.js  # 手写 markdown 解析器【约定不动，见下方注意事项】
```

### 运行时数据流

```
浏览器页面 ──调用──▶ store.js ──fetch──▶ server.js ──读写──▶ db/blog.db
                                              │
                          写接口(POST/PATCH/DELETE)全部过 session 鉴权
                          图片上传 ──────────────▶ images/
```

- **前端零依赖 vanilla JS**，无构建步骤，改完刷新页面即生效
- 页面结构 + 业务逻辑内联在各自 `.html` 末尾的 `<script>` 里；公共数据层是 `store.js`

### 数据库三张表（启动自动 `CREATE TABLE IF NOT EXISTS`）

| 表 | 字段 | 说明 |
|---|---|---|
| `folders` | id, name, parent_id, sort_order | 文件夹树，`parent_id` 自引用，**级联删除** |
| `posts` | id, title, content, folder_id, created_at, updated_at | 文章，`folder_id` 可空 = 未分类，指向 folders 级联删除 |
| `images` | id, filename, created_at | 上传图片记录，供"清理未引用"扫描用 |

时间戳统一是 `Date.now()` 毫秒整数。

### API 一览（详细语义见 PLAN.md 第 2 节）

| 鉴权 | 接口 |
|---|---|
| 公开（读） | `GET /api/session`、`GET /api/folders`、`GET /api/posts`（全量含正文）、`GET /images/*` |
| 公开+限速 | `POST /api/login`（连错 5 次锁 10 分钟/IP） |
| 登录后（写） | `POST /api/logout`、`folders` 的增改删、`posts` 的增改删、`POST /api/upload`、`POST /api/images/cleanup` |

安全要点：口令只在 `.env`（比对用 `crypto.timingSafeEqual`）；session 是 HttpOnly + SameSite=Strict cookie；写操作必须 JSON content-type（防简单 CSRF）。

---

## 四、想改什么 → 去哪个文件

| 你想改的东西 | 去哪里改 |
|---|---|
| 主页布局 / 树 / 信息流结构与逻辑 | [public/index.html](public/index.html) 末尾 `<script>` |
| 阅读页展示 / 编辑入口 | [public/post.html](public/post.html) |
| 管理端（口令门、树按钮、搜索、写作窗口、图片粘贴） | [public/editor.html](public/editor.html) |
| 颜色 / 字体 / 间距 / 响应式断点 | [public/css/style.css](public/css/style.css)（只增不推翻） |
| 前端与后端的对接方式（字段名、请求形状） | [public/js/store.js](public/js/store.js) |
| 接口逻辑 / 鉴权 / 上传规则 / 建表 | [server.js](server.js) |
| 端口 / 管理口令 | [.env](.env) |
| markdown 渲染行为 | [public/js/markdown.js](public/js/markdown.js) ⚠️ 见注意事项 |
| 页面标题 / favicon | 各 `.html` 的 `<head>` |
| 需求与计划本身 | [PLAN.md](PLAN.md)（唯一权威） |

---

## 五、注意事项（改代码前先看）

1. **`markdown.js` 不要动** —— 项目约定它是手写零依赖解析器。已知它的 `_..._` 斜体规则会误伤含下划线的 URL，因此**上传图片文件名用连字符**（`时间戳-随机.png`），别改回下划线。
2. **所有文章链接必须 `target="_blank" rel="noopener"`** —— 阅读页永远在新标签打开，不占主页。
3. **写接口全部过 `requireAuth`** —— 在 server.js 里新增写路由时别漏挂。
4. **删文件夹是递归删** —— 前端确认弹窗必须写明"含 N 篇文章"（editor.html 里 `countSubtreePosts`）。
5. **页面里标题渲染前要 `escapeHtml`** —— 三个页面都有该函数。
6. **作者样式里的 `display` 会压过 `hidden` 属性** —— style.css 顶部有全局 `[hidden]{display:none!important}` 兜底，新写带 display 的容器时依赖它控制显隐。
7. 无构建、无测试框架 —— 验证方式就是启动后在浏览器把全流程走一遍（建目录 → 写文章 → 粘图 → 保存 → 主页/阅读页确认）。

---

## 六、`npm i` 时的 install-scripts 警告（要不要管）

```text
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   better-sqlite3@13.0.3 (install: node-gyp rebuild)
```

**含义**：npm 的供应链安全策略——包在安装时可以执行任意脚本（有攻击风险），新版 npm 默认只放行你批准过的包。better-sqlite3 声明了一个安装脚本（`node-gyp rebuild` 本地编译），没被批准，所以被拦下并提醒。

**要不要管**：

- 如果输出是 `up to date`（没有真正重装任何包）→ **无害，直接忽略**，脚本根本没被触发
- 本项目的 better-sqlite3 用的是**包内预编译二进制**，正常情况下不依赖那个编译脚本，`require('better-sqlite3')` 直接可用

**什么时候才要处理**：删掉 `node_modules` 重装（或换机器/升版本）后，启动报 `Could not locate the bindings file` 这类错，说明预编译产物缺失、编译脚本又被拦了：

```bash
npm install-scripts approve better-sqlite3
npm i
```

---

## 七、部署到自己的服务器

前提：服务器装了 **Node.js ≥ 20**（`npm start` 里的 `--env-file` 需要它）。

### 步骤 1：把代码弄上服务器

```bash
# 方式 A：git（推荐，方便以后更新）
git clone <你的仓库地址> /opt/Blog && cd /opt/Blog

# 方式 B：直接拷
scp -r ~/Work/Blog user@服务器:/opt/Blog
```

### 步骤 2：装依赖、配环境

```bash
cd /opt/Blog
npm i
# 若报 bindings 错误 → npm install-scripts approve better-sqlite3 && npm i
```

服务器上的 `.env`（**口令别沿用本地的**）：

```bash
PORT=3000
BLOG_PASSWORD=换成一个强口令
```

```bash
chmod 600 .env    # 收紧权限，只有服务账号能读
```

### 步骤 3：常驻运行（systemd，开机自启 + 崩了自动拉起）

创建 `/etc/systemd/system/blog.service`：

```ini
[Unit]
Description=Personal Blog
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/Blog
ExecStart=/usr/bin/node --env-file=.env server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now blog
systemctl status blog        # 看状态
journalctl -u blog -f        # 看日志
```

> 不想用 systemd 也行：`pm2 start server.js --name blog` 或最简单的 `npm start` 前台跑（关掉终端就停）。

### 步骤 4：对外暴露（二选一）

**方式 A：直接开端口（最简单，个人用够了）**

```bash
ufw allow 3000/tcp
# 访问 http://服务器IP:3000
```

**方式 B：nginx 反代 + HTTPS（有域名、想加密时推荐）**

```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    client_max_body_size 16m;   # 必须!否则图片上传被 nginx 挡掉

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

此时 3000 端口只留本机（防火墙不放行），对外全走 nginx。

> ⚠️ `client_max_body_size 16m` 别漏——后端收图片走 JSON+base64（≤10MB 原图 ≈ 14MB 请求体），nginx 默认只放 1m。

### 步骤 5：备份（数据就两处）

```bash
# db/blog.db 是 SQLite 单文件,images/ 是图片
tar czf backup_$(date +%F).tar.gz /opt/Blog/db /opt/Blog/images
# 建议 cron 定时 + 异地存
```

### 部署后注意

- **登录会话存内存**：服务器每次重启 blog 服务，都得重新输口令登录（数据不丢，丢的只是登录态）
- **读侧全公开**：文章/图片任何人拿到 URL 就能看，这是需求设定；口令只保护写操作
- 改了端口后，nginx `proxy_pass` 也要跟着改
