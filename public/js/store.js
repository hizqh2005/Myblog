/* 数据存取: fetch 调 /api/*,读接口公开、写接口带 session cookie。 */
(function (global) {
  'use strict';

  function request(method, url, body) {
    var opts = { method: method, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('请求失败(' + res.status + ')'));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function normPost(p) {
    p.createdAt = p.created_at;
    p.updatedAt = p.updated_at;
    p.folderId = p.folder_id;
    return p;
  }

  function normFolder(f) {
    f.parentId = f.parent_id;
    f.sortOrder = f.sort_order;
    return f;
  }

  /* ---------- 文章 ---------- */
  function list() {
    return request('GET', '/api/posts').then(function (posts) {
      return posts.map(normPost);
    });
  }

  function get(id) {
    return list().then(function (posts) {
      return posts.find(function (p) { return p.id === Number(id); }) || null;
    });
  }

  function create(title, content, folderId) {
    return request('POST', '/api/posts', {
      title: title,
      content: content || '',
      folder_id: folderId == null ? null : Number(folderId)
    }).then(normPost);
  }

  /* update(id, {title?, content?, folder_id?}) */
  function update(id, patch) {
    if (typeof patch === 'string') patch = { title: patch, content: arguments[2] };
    var body = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.content !== undefined) body.content = patch.content;
    var fid = 'folder_id' in patch ? patch.folder_id : patch.folderId;
    if (fid !== undefined) body.folder_id = fid == null ? null : Number(fid);
    return request('PATCH', '/api/posts/' + id, body).then(normPost);
  }

  function remove(id) {
    return request('DELETE', '/api/posts/' + id, {});
  }

  /* ---------- 文件夹 ---------- */
  var folders = {
    list: function () {
      return request('GET', '/api/folders').then(function (fs) {
        return fs.map(normFolder);
      });
    },
    create: function (name, parentId) {
      return request('POST', '/api/folders', {
        name: name,
        parent_id: parentId == null ? null : Number(parentId)
      }).then(normFolder);
    },
    update: function (id, patch) {
      var body = {};
      if (patch.name !== undefined) body.name = patch.name;
      var pid = 'parent_id' in patch ? patch.parent_id : patch.parentId;
      if (pid !== undefined) body.parent_id = pid == null ? null : Number(pid);
      if (patch.sort_order !== undefined) body.sort_order = patch.sort_order;
      return request('PATCH', '/api/folders/' + id, body).then(normFolder);
    },
    remove: function (id) {
      return request('DELETE', '/api/folders/' + id, {});
    }
  };

  /* ---------- 登录 ---------- */
  var session = {
    status: function () {
      return request('GET', '/api/session');
    },
    login: function (password) {
      return request('POST', '/api/login', { password: password });
    },
    logout: function () {
      return request('POST', '/api/logout', {});
    }
  };

  /* ---------- 图片 ---------- */
  function upload(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.onload = function () {
        var dataUrl = String(reader.result);
        var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        var name = file.name || ('paste.' + ((file.type || 'image/png').split('/')[1] || 'png'));
        request('POST', '/api/upload', { filename: name, base64: base64 })
          .then(resolve, reject);
      };
      reader.readAsDataURL(file);
    });
  }

  function cleanupImages() {
    return request('POST', '/api/images/cleanup', {});
  }

  global.store = {
    list: list,
    get: get,
    create: create,
    update: update,
    remove: remove,
    folders: folders,
    session: session,
    upload: upload,
    cleanupImages: cleanupImages
  };
})(window);
