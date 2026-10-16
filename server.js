'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT) || 3000;
const BLOG_PASSWORD = process.env.BLOG_PASSWORD || '';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGES_DIR = path.join(ROOT, 'images');
const DB_DIR = path.join(ROOT, 'db');

const SESSION_TTL = 14 * 24 * 3600 * 1000;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const BODY_MAX_BYTES = 16 * 1024 * 1024;
const ALLOWED_IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

/* ---------- 数据库 ---------- */
const db = new Database(path.join(DB_DIR, 'blog.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
`);

/* ---------- 鉴权 ---------- */
const sessions = new Map();
const loginFails = new Map();

const passwordHash = crypto.createHash('sha256').update(BLOG_PASSWORD).digest();

function checkPassword(pw) {
  const given = crypto.createHash('sha256').update(String(pw)).digest();
  return crypto.timingSafeEqual(given, passwordHash);
}

function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function getLockRemainingMs(ip, now) {
  const entry = loginFails.get(ip);
  if (!entry || !entry.lockedUntil) return 0;
  if (entry.lockedUntil <= now) {
    loginFails.delete(ip);
    return 0;
  }
  return entry.lockedUntil - now;
}

function recordLoginFail(ip, now) {
  const entry = loginFails.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILS) {
    entry.lockedUntil = now + LOGIN_LOCK_MS;
    entry.count = 0;
  }
  loginFails.set(ip, entry);
}

function getTokenFromReq(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'sid') return part.slice(eq + 1).trim();
  }
  return null;
}

function getSessionToken(req) {
  const token = getTokenFromReq(req);
  if (!token) return null;
  const exp = sessions.get(token);
  if (exp === undefined) return null;
  if (exp <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function createSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
  );
}

/* ---------- HTTP 工具 ---------- */
function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function isJsonContentType(req) {
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return ct === 'application/json';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { status: 400 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch (e) {
    throw Object.assign(new Error('无效的 JSON'), { status: 400 });
  }
}

function requireAuth(req, res) {
  if (!getSessionToken(req)) {
    sendError(res, 401, '未登录或会话已过期');
    return false;
  }
  return true;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function getFolderOr404(res, id) {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!folder) sendError(res, 404, '文件夹不存在');
  return folder || null;
}

function getPostOr404(res, id) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) sendError(res, 404, '文章不存在');
  return post || null;
}

/* ---------- API 处理 ---------- */
const stmts = {
  listFolders: () => db.prepare('SELECT * FROM folders ORDER BY sort_order, id').all(),
  insertFolder: db.prepare('INSERT INTO folders (name, parent_id, sort_order) VALUES (?, ?, ?)'),
  countSubtreePosts: db.prepare(`
    WITH RECURSIVE sub(id) AS (
      SELECT ? UNION ALL
      SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
    )
    SELECT COUNT(*) AS n FROM posts WHERE folder_id IN (SELECT id FROM sub)
  `),
  deleteFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
  listPosts: db.prepare('SELECT * FROM posts ORDER BY created_at DESC, id DESC'),
  insertPost: db.prepare(
    'INSERT INTO posts (title, content, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ),
  deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
  insertImage: db.prepare('INSERT INTO images (filename, created_at) VALUES (?, ?)'),
  listImages: db.prepare('SELECT filename FROM images'),
  deleteImageByName: db.prepare('DELETE FROM images WHERE filename = ?'),
  allPostContents: db.prepare('SELECT content FROM posts')
};

function isDescendantOf(candidateId, ancestorId) {
  let cur = candidateId;
  const seen = new Set();
  while (cur !== null && cur !== undefined) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(cur);
    if (!row) return false;
    cur = row.parent_id;
  }
  return false;
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  const isWrite = method === 'POST' || method === 'PATCH' || method === 'DELETE';

  if (isWrite && !isJsonContentType(req)) {
    sendError(res, 400, '写操作必须使用 application/json');
    return;
  }
  const body = isWrite ? await readJsonBody(req) : null;

  let m;

  /* --- session --- */
  if (method === 'GET' && pathname === '/api/session') {
    sendJson(res, 200, { loggedIn: getSessionToken(req) !== null });
    return;
  }
  if (method === 'POST' && pathname === '/api/login') {
    const ip = getClientIp(req);
    const now = Date.now();
    const lockLeft = getLockRemainingMs(ip, now);
    if (lockLeft > 0) {
      sendError(res, 401, `失败次数过多,请 ${Math.ceil(lockLeft / 60000)} 分钟后再试`);
      return;
    }
    if (!isNonEmptyString(body.password) || !checkPassword(body.password)) {
      recordLoginFail(ip, now);
      sendError(res, 401, '口令错误');
      return;
    }
    loginFails.delete(ip);
    createSession(res);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (method === 'POST' && pathname === '/api/logout') {
    if (!requireAuth(req, res)) return;
    sessions.delete(getSessionToken(req));
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    sendJson(res, 200, { ok: true });
    return;
  }

  /* --- folders --- */
  if (pathname === '/api/folders' && method === 'GET') {
    sendJson(res, 200, stmts.listFolders());
    return;
  }
  if (pathname === '/api/folders' && method === 'POST') {
    if (!requireAuth(req, res)) return;
    if (!isNonEmptyString(body.name)) {
      sendError(res, 400, '文件夹名称不能为空');
      return;
    }
    let parentId = body.parent_id === undefined || body.parent_id === null ? null : body.parent_id;
    if (parentId !== null) {
      if (!isInt(parentId) || !getFolderOr404(res, parentId)) return;
    }
    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM folders WHERE parent_id IS ?')
      .get(parentId);
    const info = stmts.insertFolder.run(body.name.trim(), parentId, maxOrder.m + 1);
    sendJson(res, 200, db.prepare('SELECT * FROM folders WHERE id = ?').get(info.lastInsertRowid));
    return;
  }
  m = pathname.match(/^\/api\/folders\/(\d+)$/);
  if (m && method === 'PATCH') {
    if (!requireAuth(req, res)) return;
    const id = Number(m[1]);
    const folder = getFolderOr404(res, id);
    if (!folder) return;

    const sets = [];
    const params = [];
    if ('name' in body) {
      if (!isNonEmptyString(body.name)) {
        sendError(res, 400, '文件夹名称不能为空');
        return;
      }
      sets.push('name = ?');
      params.push(body.name.trim());
    }
    if ('parent_id' in body) {
      const pid = body.parent_id === null ? null : body.parent_id;
      if (pid !== null) {
        if (!isInt(pid) || !getFolderOr404(res, pid)) return;
        if (pid === id || isDescendantOf(pid, id)) {
          sendError(res, 400, '不能移动到自身或其子文件夹内');
          return;
        }
      }
      sets.push('parent_id = ?');
      params.push(pid);
    }
    if ('sort_order' in body) {
      if (!isInt(body.sort_order)) {
        sendError(res, 400, 'sort_order 必须是整数');
        return;
      }
      sets.push('sort_order = ?');
      params.push(body.sort_order);
    }
    if (sets.length === 0) {
      sendError(res, 400, '没有可更新的字段');
      return;
    }
    params.push(id);
    db.prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    sendJson(res, 200, db.prepare('SELECT * FROM folders WHERE id = ?').get(id));
    return;
  }
  if (m && method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const id = Number(m[1]);
    if (!getFolderOr404(res, id)) return;
    const count = stmts.countSubtreePosts.get(id);
    stmts.deleteFolder.run(id);
    sendJson(res, 200, { ok: true, deletedPosts: count.n });
    return;
  }

  /* --- posts --- */
  if (pathname === '/api/posts' && method === 'GET') {
    sendJson(res, 200, stmts.listPosts.all());
    return;
  }
  if (pathname === '/api/posts' && method === 'POST') {
    if (!requireAuth(req, res)) return;
    if (!isNonEmptyString(body.title)) {
      sendError(res, 400, '文章标题不能为空');
      return;
    }
    const content = typeof body.content === 'string' ? body.content : '';
    let folderId = body.folder_id === undefined || body.folder_id === null ? null : body.folder_id;
    if (folderId !== null) {
      if (!isInt(folderId) || !getFolderOr404(res, folderId)) return;
    }
    const now = Date.now();
    const info = stmts.insertPost.run(body.title.trim(), content, folderId, now, now);
    sendJson(res, 200, db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
    return;
  }
  m = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (m && method === 'PATCH') {
    if (!requireAuth(req, res)) return;
    const id = Number(m[1]);
    const post = getPostOr404(res, id);
    if (!post) return;

    const sets = [];
    const params = [];
    if ('title' in body) {
      if (!isNonEmptyString(body.title)) {
        sendError(res, 400, '文章标题不能为空');
        return;
      }
      sets.push('title = ?');
      params.push(body.title.trim());
    }
    if ('content' in body) {
      if (typeof body.content !== 'string') {
        sendError(res, 400, 'content 必须是字符串');
        return;
      }
      sets.push('content = ?');
      params.push(body.content);
    }
    if ('folder_id' in body) {
      const fid = body.folder_id === null ? null : body.folder_id;
      if (fid !== null) {
        if (!isInt(fid) || !getFolderOr404(res, fid)) return;
      }
      sets.push('folder_id = ?');
      params.push(fid);
    }
    if (sets.length === 0) {
      sendError(res, 400, '没有可更新的字段');
      return;
    }
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    sendJson(res, 200, db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
    return;
  }
  if (m && method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const id = Number(m[1]);
    if (!getPostOr404(res, id)) return;
    stmts.deletePost.run(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  /* --- upload / cleanup --- */
  if (pathname === '/api/upload' && method === 'POST') {
    if (!requireAuth(req, res)) return;
    if (!isNonEmptyString(body.filename)) {
      sendError(res, 400, '缺少 filename');
      return;
    }
    const ext = path.extname(body.filename).slice(1).toLowerCase();
    if (!ALLOWED_IMG_EXT.has(ext)) {
      sendError(res, 400, '仅支持 png/jpg/jpeg/gif/webp');
      return;
    }
    if (typeof body.base64 !== 'string' || !body.base64) {
      sendError(res, 400, '缺少 base64 数据');
      return;
    }
    const b64 = body.base64.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) {
      sendError(res, 400, '图片数据无法解析');
      return;
    }
    if (buf.length > UPLOAD_MAX_BYTES) {
      sendError(res, 400, '图片超过 10MB');
      return;
    }
    // 文件名避开下划线: markdown.js 的斜体规则会把 `_xxx_` 处理成 <em>,污染 src
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buf);
    stmts.insertImage.run(filename, Date.now());
    sendJson(res, 200, { url: '/images/' + filename });
    return;
  }
  if (pathname === '/api/images/cleanup' && method === 'POST') {
    if (!requireAuth(req, res)) return;
    const referenced = new Set();
    for (const row of stmts.allPostContents.all()) {
      const matches = row.content.matchAll(/\/images\/([A-Za-z0-9_.\-]+)/g);
      for (const mm of matches) referenced.add(mm[1]);
    }
    let removed = 0;
    for (const img of stmts.listImages.all()) {
      if (referenced.has(img.filename)) continue;
      try {
        fs.unlinkSync(path.join(IMAGES_DIR, img.filename));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      stmts.deleteImageByName.run(img.filename);
      removed += 1;
    }
    sendJson(res, 200, { removed });
    return;
  }

  sendError(res, 404, '接口不存在');
}

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(res, baseDir, relPath) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
    sendError(res, 404, 'Not found');
    return;
  }
  let target = filePath;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  } catch (e) {
    /* 文件不存在,交由 readFile 报 404 */
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      sendError(res, 404, 'Not found');
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(data);
  });
}

/* ---------- 服务器 ---------- */
const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    sendError(res, 400, '非法的 URL');
    return;
  }

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    if (pathname.startsWith('/images/')) {
      serveStatic(res, IMAGES_DIR, pathname.slice('/images/'.length));
      return;
    }
    serveStatic(res, PUBLIC_DIR, pathname.slice(1));
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) {
      sendError(res, status, status === 500 ? '服务器内部错误' : err.message);
    } else {
      res.end();
    }
    if (status === 500) console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`Blog running at http://localhost:${PORT}`);
});
