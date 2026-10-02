function initSidebar(activeId) {
  var sidebar = document.getElementById('sidebar');
  var admin = JSON.parse(localStorage.getItem('adminInfo') || '{}');
  
  var menuHtml = MENU_ITEMS.map(function(item) {
    if (item.id === 'admins' && admin.role !== 'super') return '';
    if (item.id === 'cleanup' && admin.role !== 'super') return '';
    if (item.id === 'logs' && admin.role !== 'super') return '';
    if (item.id === 'settings' && admin.role !== 'super') return '';
    
    return '<a href="' + item.page + '" class="menu-item ' + (item.id === activeId ? 'active' : '') + '">' +
      '<i class="fas fa-' + item.icon + '"></i>' +
      '<span>' + item.name + '</span>' +
    '</a>';
  }).join('');

  sidebar.innerHTML = 
    '<div class="sidebar-header">' +
      '<h2><i class="fas fa-school"></i> 校园小程序</h2>' +
      '<p>管理后台</p>' +
    '</div>' +
    '<nav class="sidebar-nav">' +
      menuHtml +
    '</nav>' +
    '<div class="sidebar-footer">' +
      '<button onclick="logout()"><i class="fas fa-sign-out-alt"></i> 退出登录</button>' +
    '</div>';
}

function showConfirm(message) {
  return new Promise(function(resolve) {
    if (confirm(message)) {
      resolve(true);
    } else {
      resolve(false);
    }
  });
}

function escapeHtml(text) {
  if (!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, length) {
  length = length || 50;
  if (!text) return '';
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
}

function getStatusBadge(status, statusMap) {
  var className = '';
  var text = statusMap[status] || status;
  
  if (status === 'normal' || status === 'active' || status === 'completed') {
    className = 'success';
  } else if (status === 'pending' || status === 'preparing') {
    className = 'warning';
  } else if (status === 'banned' || status === 'cancelled' || status === 'deleted') {
    className = 'danger';
  } else {
    className = 'info';
  }
  
  return '<span class="status-badge ' + className + '">' + text + '</span>';
}
