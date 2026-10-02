var app = null;
var functions = null;
var db = null;

function useSelfHostedServer() {
  return /^https?:\/\//i.test(CLOUD_CONFIG.apiBaseUrl);
}

async function serverRequest(path, options, needsAdmin) {
  var settings = options || {};
  var headers = settings.headers || {};
  var token = localStorage.getItem('adminToken') || '';
  if (needsAdmin && token) headers.Authorization = 'Bearer ' + token;
  if (settings.body && !(settings.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    settings.body = JSON.stringify(settings.body);
  }
  settings.headers = headers;

  var response = await fetch(CLOUD_CONFIG.apiBaseUrl.replace(/\/+$/, '') + path, settings);
  var result = await response.json().catch(function() {
    return { code: -1, message: '服务器返回格式错误' };
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('adminToken');
      if (needsAdmin) localStorage.removeItem('adminInfo');
    }
    throw new Error(result.message || result.errMsg || '服务器请求失败');
  }
  return result;
}

function createCommandOperator(type, value) {
  var operator = { __wxOperator: type, value: value };
  operator.and = function(other) {
    return createCommandOperator('and', [operator, other]);
  };
  return operator;
}

function createServerDatabase() {
  function Query(collectionName) {
    this.collectionName = collectionName;
    this.queryData = {};
    this.orders = [];
    this.skipCount = 0;
    this.limitCount = null;
  }

  Query.prototype.where = function(query) {
    this.queryData = query || {};
    return this;
  };
  Query.prototype.orderBy = function(field, direction) {
    this.orders.push({ field: field, direction: direction });
    return this;
  };
  Query.prototype.skip = function(count) {
    this.skipCount = Number(count || 0);
    return this;
  };
  Query.prototype.limit = function(count) {
    this.limitCount = Number(count || 0);
    return this;
  };
  Query.prototype.payload = function(operation, data) {
    return {
      collection: this.collectionName,
      operation: operation,
      query: this.queryData,
      orders: this.orders,
      skip: this.skipCount,
      limit: this.limitCount,
      data: data
    };
  };
  Query.prototype.execute = function(operation, data) {
    return serverRequest('/api/admin/database', {
      method: 'POST',
      body: this.payload(operation, data)
    }, true);
  };
  Query.prototype.get = function() {
    return this.execute('get');
  };
  Query.prototype.count = function() {
    return this.execute('count');
  };
  Query.prototype.update = function(options) {
    return this.execute('update', options || {});
  };
  Query.prototype.remove = function() {
    return this.execute('remove');
  };
  Query.prototype.add = function(options) {
    return this.execute('add', options || {});
  };
  Query.prototype.doc = function(documentId) {
    var query = this;
    function execute(operation, data) {
      var payload = query.payload(operation, data);
      payload.documentId = documentId;
      return serverRequest('/api/admin/database', {
        method: 'POST',
        body: payload
      }, true);
    }
    return {
      get: function() {
        return execute('get');
      },
      set: function(options) {
        return execute('set', options || {});
      },
      update: function(options) {
        return execute('update', options || {});
      },
      remove: function() {
        return execute('remove');
      }
    };
  };

  return {
    command: {
      gt: function(value) { return createCommandOperator('gt', value); },
      gte: function(value) { return createCommandOperator('gte', value); },
      lt: function(value) { return createCommandOperator('lt', value); },
      lte: function(value) { return createCommandOperator('lte', value); },
      neq: function(value) { return createCommandOperator('neq', value); },
      in: function(value) { return createCommandOperator('in', value); },
      remove: function() { return createCommandOperator('remove', null); },
      or: function(value) { return createCommandOperator('or', value); }
    },
    serverDate: function() {
      return { __serverDate: true };
    },
    collection: function(name) {
      return new Query(name);
    }
  };
}

function initServer() {
  if (!app) {
    if (useSelfHostedServer()) {
      functions = {
        callFunction: async function(options) {
          var result = await serverRequest(
            '/api/functions/' + encodeURIComponent(options.name),
            { method: 'POST', body: options.data || {} },
            true
          );
          return { result: result };
        }
      };
      db = createServerDatabase();
      app = { selfHosted: true };
    } else {
      throw new Error('请通过服务器管理后台地址打开页面');
    }
  }
  return app;
}

async function callCloudFunction(name, data) {
  initServer();
  
  try {
    var result = await functions.callFunction({
      name: name,
      data: data
    });
    console.log('云函数返回:', name, result);
    return result.result;
  } catch (err) {
    console.error('云函数调用失败:', name, err);
    throw err;
  }
}

async function adminLogin(account, password) {
  try {
    var result = await serverRequest('/api/auth/admin', {
      method: 'POST', body: { account: account, password: password }
    }, false);
    if (result.code === 0 && result.data && result.data.token) {
      localStorage.setItem('adminToken', result.data.token);
    }
    return result;
  } catch (err) {
    return { code: -1, message: err.message || '网络错误' };
  }
}

async function resetPassword(account, verifyPassword, newPassword) {
  try {
    return await serverRequest('/api/auth/admin/reset-password', {
      method: 'POST', body: { account: account, verifyPassword: verifyPassword, newPassword: newPassword }
    }, false);
  } catch (err) {
    return { code: -1, message: err.message || '网络错误' };
  }
}

function checkLogin() {
  var adminInfo = localStorage.getItem('adminInfo');
  if (!adminInfo || (useSelfHostedServer() && !localStorage.getItem('adminToken'))) {
    window.location.href = 'index.html';
    return null;
  }
  return JSON.parse(adminInfo);
}

async function logout() {
  if (useSelfHostedServer() && localStorage.getItem('adminToken')) {
    try {
      await serverRequest('/api/auth/admin/logout', { method: 'POST' }, true);
    } catch (err) {
      console.warn('服务端退出失败，将继续清理浏览器登录状态', err);
    }
  }
  localStorage.removeItem('adminInfo');
  localStorage.removeItem('adminToken');
  window.location.href = 'index.html';
}

function showNotification(message, type) {
  type = type || 'info';
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:white;z-index:9999;animation:slideIn 0.3s ease;';
  
  if (type === 'success') {
    toast.style.background = '#28a745';
  } else if (type === 'error') {
    toast.style.background = '#dc3545';
  } else if (type === 'warning') {
    toast.style.background = '#ffc107';
    toast.style.color = '#333';
  } else {
    toast.style.background = '#667eea';
  }
  
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.remove();
  }, 3000);
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  var date = new Date(timestamp);
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  var h = String(date.getHours()).padStart(2, '0');
  var min = String(date.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + h + ':' + min;
}

async function uploadImage(file) {
  initServer();
  var formData = new FormData();
  formData.append('file', file);
  formData.append('cloudPath', 'admin/' + Date.now() + '_' + file.name);
  var result = await serverRequest('/api/files/upload', { method: 'POST', body: formData }, true);
  return { fileID: result.fileID, tempFileURL: result.fileID };
}

function downloadFile(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
