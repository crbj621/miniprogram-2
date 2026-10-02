var CLOUD_CONFIG = {
  apiBaseUrl: window.location.origin + window.location.pathname.split('/admin')[0],
  appName: '智慧校园',
  pageSize: 20
};

var CONFIG = {
  apiBaseUrl: CLOUD_CONFIG.apiBaseUrl,
  appName: '智慧校园',
  pageSize: 20
};

var MENU_ITEMS = [
  { id: 'dashboard', name: '控制台', icon: 'home', page: 'dashboard.html' },
  { id: 'posts', name: '动态管理', icon: 'file-alt', page: 'posts.html' },
  { id: 'orders', name: '订单管理', icon: 'shopping-cart', page: 'orders.html' },
  { id: 'menus', name: '菜单管理', icon: 'utensils', page: 'menus.html' },
  { id: 'users', name: '用户管理', icon: 'users', page: 'users.html' },
  { id: 'admins', name: '管理员', icon: 'user-shield', page: 'admins.html' },
  { id: 'announcements', name: '公告管理', icon: 'bullhorn', page: 'announcements.html' },
  { id: 'logs', name: '操作日志', icon: 'history', page: 'logs.html' },
  { id: 'cleanup', name: '数据清理', icon: 'broom', page: 'cleanup.html' },
  { id: 'settings', name: '系统设置', icon: 'cog', page: 'settings.html' }
];

var ORDER_STATUS = {
  'pending': '待处理',
  'confirmed': '已确认',
  'preparing': '制作中',
  'ready': '待取餐',
  'completed': '已完成',
  'cancelled': '已取消'
};

var POST_STATUS = {
  'normal': '正常',
  'deleted': '已删除',
  'hidden': '已隐藏'
};

var USER_STATUS = {
  'normal': '正常',
  'banned': '已禁言'
};

var ADMIN_ROLE = {
  'super': '超级管理员',
  'normal': '普通管理员'
};
