import { api } from '../../utils/api-client'
Page({
  data: {
    searchValue: '',
    friendsList: [] as any[],
    searchResults: [] as any[],
    showSearchResults: false
  },

  onLoad() {
    const app = getApp();
    if (!app.isLoggedIn()) {
      const redirect = encodeURIComponent('/pages/friends/friends');
      wx.redirectTo({ url: '/pages/login/login?forceLogin=true&redirect=' + redirect });
      return;
    }
    this.loadFriends();
  },

  onSearchInput(e: any) {
    const value = e.detail.value;
    this.setData({ searchValue: value });
    if (!value) this.setData({ searchResults: [], showSearchResults: false });
  },

  onSearchConfirm() {
    const keyword = (this.data.searchValue || '').trim();
    if (!keyword) {
      this.setData({ searchResults: [], showSearchResults: false });
      return;
    }

    const upper = keyword.toUpperCase();
    const searchType = /^[A-Z0-9]{6}$/.test(upper) ? 'id' : 'name';
    this.searchUsers(searchType === 'id' ? upper : keyword, searchType);
  },

  clearSearch() {
    this.setData({ searchValue: '', searchResults: [], showSearchResults: false });
  },

  searchUsers(keyword: string, searchType: 'id' | 'name') {
    api.call({
      name: 'searchUser',
      data: { keyword, searchType },
      success: (res: any) => {
        const openid = wx.getStorageSync('openid');
        const filteredResults = (res.result || []).filter((user: any) => user.openid !== openid);
        this.setData({ searchResults: filteredResults, showSearchResults: true });
      },
      fail: () => {
        this.setData({ searchResults: [], showSearchResults: false });
      }
    });
  },

  addFriend(e: any) {
    const friendOpenid = e.currentTarget.dataset.openid;
    
    wx.showLoading({ title: '添加中...' });
    api.call({
      name: 'addFriend',
      data: { friendOpenid },
      success: (res: any) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          wx.showToast({ title: '添加成功', icon: 'success' });
        } else {
          wx.showToast({ title: (res.result && res.result.errMsg) ? res.result.errMsg : '添加失败', icon: 'none' });
        }
        this.setData({ searchResults: [], showSearchResults: false, searchValue: '' });
        this.loadFriends();
      },
      fail: (err: any) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '添加失败', icon: 'none' });
      }
    });
  },

  deleteFriend(e: any) {
    const friendOpenid = e.currentTarget.dataset.openid;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个好友吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          api.call({
            name: 'deleteFriend',
            data: { friendOpenid },
            success: (res2: any) => {
              wx.hideLoading();
              if (res2.result && res2.result.success) {
                wx.showToast({ title: '已删除', icon: 'success' });
              } else {
                wx.showToast({ title: (res2.result && res2.result.errMsg) ? res2.result.errMsg : '删除失败', icon: 'none' });
              }
              this.loadFriends();
            },
            fail: (err: any) => {
              wx.hideLoading();
              wx.showToast({ title: err.message || '删除失败', icon: 'none' });
            }
          });
        }
      }
    });
  },

  loadFriends() {
    api.call({
      name: 'getFriends',
      success: (res: any) => {
        this.setData({ friendsList: res.result || [] });
      },
      fail: () => {
        this.setData({ friendsList: [] });
      }
    });
  }
});
