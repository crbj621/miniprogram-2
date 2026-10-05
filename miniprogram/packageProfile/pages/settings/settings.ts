import { withSharing } from '../../../utils/page-share'
Page(withSharing({
  data: {
    settings: {
      highAccuracy: true,
      autoSave: true,
      notifications: true
    }
  },

  onLoad() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageProfile/pages/settings/settings')
      });
      return;
    }
    this.loadSettings();
  },

  // 加载设置
  loadSettings() {
    const savedSettings = wx.getStorageSync('settings') || this.data.settings;
    this.setData({ settings: savedSettings });
  },

  // 保存设置
  saveSettings() {
    wx.setStorageSync('settings', this.data.settings);
    wx.showToast({ title: '设置已保存', icon: 'success' });
  },

  // 切换高精度定位
  toggleHighAccuracy(e: any) {
    const highAccuracy = e.detail.value;
    this.setData({
      'settings.highAccuracy': highAccuracy
    });
    this.saveSettings();
  },

  // 切换自动保存
  toggleAutoSave(e: any) {
    const autoSave = e.detail.value;
    this.setData({
      'settings.autoSave': autoSave
    });
    this.saveSettings();
  },

  // 切换通知
  toggleNotifications(e: any) {
    const notifications = e.detail.value;
    this.setData({
      'settings.notifications': notifications
    });
    this.saveSettings();
  },

  // 清除缓存
  clearCache() {
    wx.showModal({
      title: '确认清除',
      content: '确定要清除缓存吗？',
      success: (res) => {
        if (res.confirm) {
          // 清理临时界面数据，不应把用户意外退出登录。
          wx.removeStorageSync('current_order');
          wx.removeStorageSync('lastAnnouncementId');
          wx.removeStorageSync('lastReadAnnouncementId');
          wx.removeStorageSync('riderInfo');
          wx.removeStorageSync('settings');
          wx.showToast({ title: '缓存已清除', icon: 'success' });
          this.setData({
            settings: {
              highAccuracy: true,
              autoSave: true,
              notifications: true
            }
          });
        }
      }
    });
  },

  // 关于我们
  aboutUs() {
    wx.showModal({
      title: '关于校园跑',
      content: '校园生活服务小程序\n\n版本：1.0.0',
      showCancel: false
    });
  }
}));
