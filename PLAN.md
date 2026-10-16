# 个人 Blog 开发计划（知识库型 · 渐进式）

> 定稿 2026-10-15。本文件是**唯一权威开发计划**：按阶段推进，每阶段任务全部勾选、验收通过后再进下一阶段。
> 技术底座：Node（唯一依赖 `better-sqlite3`）+ 零依赖 vanilla JS 前端；手写 `js/markdown.js` **不改动**。
> 上下文断了/开新会话：让 AI 直接读本文件继续，不依赖历史对话。

---

## 0. 定位（一句话）

单人自用**知识库型 blog**，部署到自己的服务器：**blog 读侧全公开，editor 写侧要口令**。
明确不做：全文搜索、草稿、多用户、SEO、旧 localStorage 数据迁移。

---

## 1. 已确认需求（不再讨论）

### 主页 `index.html`
- `body` **flex 纵向三段**：header / main / footer
- header：`icon.jpg` 作圆形头像（同图兼 favicon）+ 座右铭 **"千里之行始于足下"**
- footer：**©2026**
- main **flex 横向**：左树 + 右信息流，两者**互相独立**：
  - **左树**：Windows 式文件夹，任意嵌套；文件夹内文章以 **lnk 式节点**展示；点文章节点 → **新标签**直达；点文件夹只展开/折叠，**不筛选**右侧；展开状态用 localStorage 记忆
  - **右信息流**：**全部文章**（含未分类）按发布时间倒序，**按年份分组**（年份大标题 + 锚点），有**跳年按钮**（下拉列出年份 → 平滑滚动定位），每条显示标题 + 发布日期，点击 → **新标签**

### 阅读页 `post.html`
- 独立页面，所有文章链接一律 `target="_blank" rel="noopener"`，**不占主页**
- `?id=xxx` 取文章，`markdown.toHtml()` 渲染，显示创建/编辑日期，提供"编辑"入口 → `editor.html?id=`
- 文章不存在时给出返回首页提示

### 管理端 `editor.html`（**切换式**双窗口）
- **口令门**：未登录先输口令（`hizqh`），登录后进入
- **管理窗口**：左 = 树（悬停按钮：新建子文件夹 / 新建文章 / 重命名 / 移动 / 删除）；右 = 文章列表（顶部**搜索框**，范围切换：当前文件夹 / 全部 / 未分类）
- **写作窗口**：标题输入 + 左 textarea（等宽字体）/ 右**实时预览**并排；**保存 = 按钮 + Ctrl+S**，无自动保存；保存后返回管理窗口
- 点文章或新建 → 切到写作窗口；写作窗口带"返回管理"

### 图片
- **Ctrl+V 粘贴截图**自动上传并插入，另有"导入图片"按钮从文件夹选
- 全部落 `images/` 文件夹，markdown 插入 `![](/images/xxx)`
- 上传接口需登录；`/images/*` 访问公开
- 上传走 **JSON + base64**（免 multipart 解析，守住单依赖）

### 数据规则
- 文章**单归属**文件夹，`folder_id` 可空 = **未分类**；未分类只出现在信息流和 editor，**不进主页树**
- 无草稿：保存即入库
- 删除文件夹 = **递归删**，确认弹窗必须写明"含 N 篇文章"
- 时间戳统一用 `Date.now()` 毫秒整数

### 鉴权（服务器部署）
- 口令只存服务端 `.env`，前端永远拿不到明文；比对用 `crypto.timingSafeEqual`
- 登录失败限速（内存计数：连续错 5 次锁 10 分钟/IP）
- **读接口全公开**；**写接口 + 上传**必须 session cookie（`HttpOnly` + `SameSite=Strict`）
- session 存内存 Map（32 字节随机 token，14 天过期），服务重启需重新登录
- 非 JSON content-type 的请求一律拒绝写操作（防简单 CSRF）

---

## 2. 架构

```
Blog/
├── server.js              # Node：静态文件 + REST API + 鉴权
├── package.json           # 依赖仅 better-sqlite3；npm start = node --env-file=.env server.js
├── .env                   # PORT=3000 / BLOG_PASSWORD=hizqh
├── PLAN.md                # 本文件
├── db/blog.db              # SQLite（启动时自动建表）
├── images/                 # 上传图片
└── public/
    ├── index.html          # 主页
    ├── post.html           # 阅读页（新标签）
    ├── editor.html         # 管理端（口令门）
    ├── icon.jpg            # 头像 + favicon
    ├── css/style.css        # 现有样式扩展
    └── js/
        ├── store.js         # localStorage → fetch /api/*（对外形状保持兼容）
        └── markdown.js      # 不动
```

### 数据库（启动时 `CREATE TABLE IF NOT EXISTS`，并 `PRAGMA foreign_keys = ON`）

```sql
folders(id INTEGER PK, name TEXT, parent_id INTEGER FK→folders ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0)
posts(id INTEGER PK, title TEXT, content TEXT, folder_id INTEGER FK→posts→folders ON DELETE CASCADE,
      created_at INTEGER, updated_at INTEGER)
images(id INTEGER PK, filename TEXT UNIQUE, created_at INTEGER)
```

### API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/session` | 公开 | `{loggedIn: bool}` |
| POST | `/api/login` | 公开+限速 | `{password}` → 种 cookie |
| POST | `/api/logout` | 登录 | 清 session |
| GET | `/api/folders` | 公开 | flat 数组，前端自己建树 |
| POST | `/api/folders` | 登录 | `{name, parent_id}` |
| PATCH | `/api/folders/:id` | 登录 | `{name?, parent_id?, sort_order?}` |
| DELETE | `/api/folders/:id` | 登录 | 级联删（先统计 N 篇文章回给前端做确认） |
| GET | `/api/posts` | 公开 | 全量含 content（个人规模一次拉） |
| POST | `/api/posts` | 登录 | `{title, content, folder_id?}` |
| PATCH | `/api/posts/:id` | 登录 | `{title?, content?, folder_id?}` |
| DELETE | `/api/posts/:id` | 登录 | |
| POST | `/api/upload` | 登录 | `{filename, base64}`；扩展名白名单 png/jpg/jpeg/gif/webp，≤10MB；文件名 = `时间戳-随机.扩展名`（连字符不是下划线:markdown.js 的 `_..._` 斜体规则会污染 src,而 markdown.js 约定不动）；返回 `{url}` |
| POST | `/api/images/cleanup` | 登录 | 扫全部 post.content，删除未引用的图片文件+记录，返回清理数 |
| GET | `/images/*` | 公开 | 静态图片 |

---

## 3. 分阶段实施

### 阶段 1：后端骨架（server.js + DB + 鉴权）
- [x] `npm init -y`，`npm i better-sqlite3`，写 `npm start` 脚本（`node --env-file=.env server.js`）
- [x] `.env`（PORT=3000、BLOG_PASSWORD）+ `db/`、`images/` 目录
- [x] server.js：静态服务 `public/` 与 `images/`、JSON body 解析、启动建表 + 外键 pragma
- [x] 登录/登出/session 接口（timingSafeEqual、失败限速、HttpOnly cookie）
- [x] `requireAuth` 中间件挂全部写接口
- [x] folders CRUD（DELETE 返回被删文章数）
- [x] posts CRUD、upload、images cleanup 接口
- [x] 统一错误 JSON（400/401/404）

**验收**：curl 登录拿 cookie → 建文件夹/文章成功；不带 cookie 写入返回 401；直连服务端口能打开 404 或空静态页。

### 阶段 2：`store.js` 换后端
- [x] 对外保持旧形状：`list/get/create/update/remove`，新增 `folders.*`、`session.login/logout/status`、`upload(file)`
- [x] fetch 封装：JSON、`credentials: 'same-origin'`、401 统一抛错由页面处理
- [x] 删除全部 localStorage 逻辑
- [x] 旧 `index.html` / `editor.html` 在本阶段仍可运行（还指向旧 UI，下阶段改）

**验收**：浏览器控制台 `store.create('t','c')` 落库，`store.list()` 能读回。

### 阶段 3：主页（flex 骨架 → 树 → 信息流）
- [x] 三段 flex 布局 + header（头像+座右铭）+ footer（©2026）
- [x] 树组件：flat → 树渲染；折叠 chevron；展开状态存 localStorage（如 `blog_tree_open`）；文件夹按 sort_order、文章按 createdAt 倒序；文章节点 = lnk 样式链接（新标签）
- [x] 信息流：全量 posts 按年倒序分组（`<h2 id="year-2026">`）；条目标题+日期（新标签）；跳年下拉按钮 → `scrollTo` 锚点
- [x] 空状态提示（无文章/无文件夹）
- [x] 首页文章链接从旧 hash 路由 `#/post/id` 改为 `post.html?id=`

**验收**：树展开记忆、点文章新标签打开（此时 post.html 还没做，404 属预期）、年份分区与跳年正常、点文件夹右侧不动。

### 阶段 4：阅读页 `post.html`
- [x] `?id=` 取文、渲染 markdown、日期、"编辑"链到 `editor.html?id=`
- [x] 不存在提示；`<link rel="icon" href="icon.jpg">` 全页面补上
- [x] 主页/树/信息流的链接全部联调

**验收**：主页点任意文章 → 新标签正常阅读 → 点编辑进 editor（此时应停在口令门）。

### 阶段 5：editor 切换式双窗口
- [x] 口令门：`session.status()` 检查 → 输入口令 → `login`，失败提示+次数感知
- [x] 管理窗口：左树（悬停按钮全套：新建子文件夹/新建文章/重命名/移动/删除[弹窗写明含 N 篇]）+ 根级"新建文件夹"
- [x] 管理窗口右侧：搜索框（按标题模糊过滤）+ 范围切换（当前文件夹/全部/未分类）+ 条目（点击进写作、删除、"归入文件夹…"）
- [x] 切换状态机：管理 ⇄ 写作；写作携带 `postId` 或 `{folder_id}`（树上新建时）
- [x] 写作窗口：标题 + textarea/实时预览并排（input 即渲）；保存按钮 + Ctrl+S；未保存离开确认
- [x] 保存后回管理窗口并刷新列表

**验收**：完整走通 口令 → 建目录 → 建文章 → 搜索 → 编辑 → 删除；口令错拒绝。

### 阶段 6：图片链路 + 收尾
- [x] `store.upload(file)`：FileReader → base64 → `/api/upload`
- [x] textarea `paste` 监听：剪贴板图片 → 上传 → 光标处插入 `![](/images/xxx)`
- [x] 工具栏"导入图片"按钮（`<input type=file accept=image/* multiple>`）
- [x] 管理窗口"清理未引用图片"按钮 → `/api/images/cleanup`
- [x] 收尾：窄屏响应式（树可收起）、空状态复查、页面 title 统一、跑一遍全流程

**验收**：editor 里 Ctrl+V 截图 → 预览即时显示 → 保存 → 主页信息流和阅读页正常显示图片。

---

## 4. 贯穿约定（每阶段都要守住）

1. 前端零依赖 vanilla JS；`markdown.js` 不动；`style.css` 只增不推翻
2. 口令/端口只在 `.env`；写接口全部过 `requireAuth`
3. 所有文章打开方式 = 新标签（`target="_blank" rel="noopener"`）
4. 时间戳 = `Date.now()` 毫秒整数；文章标题渲染前 `escapeHtml`
5. 不做：全文搜索、草稿、自动保存、localStorage 迁移、多用户
6. 删文件夹必须递归确认（写明含 N 篇文章）；图片孤儿清理靠扫描内容，不实时维护引用关系

## 5. 运行

```bash
npm i
npm start          # = node --env-file=.env server.js
# 打开 http://localhost:3000
```

`.env`：

```
PORT=3000
BLOG_PASSWORD=hizqh
```
