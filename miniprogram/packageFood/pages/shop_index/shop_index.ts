import { api } from '../../../utils/api-client'
Page({
  data: {
    shopId: '',
    shopInfo: null as any,
    orders: [] as any[],
    currentTab: 'pending',
    stats: {
      pending: 0,
      processing: 0,
      ready: 0,
      todaySales: 0
    }
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageFood/pages/shop_index/shop_index')
      })
      return
    }
    const shopId = wx.getStorageSync('food_shop_id')
    if (!shopId) {
      wx.redirectTo({ url: '/packageFood/pages/shop_login/shop_login' })
      return
    }
    this.setData({ shopId })
    this.loadShopInfo()
  },

  onShow() {
    if (this.data.shopId) {
      this.loadOrders()
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadShopInfo(), this.loadOrders()]).then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadShopInfo() {
    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'getShopDetail',
          data: { shopId: this.data.shopId }
        }
      }) as any

      if (res.result.success) {
        this.setData({ shopInfo: res.result.shop })
      }
    } catch (err) {
      console.error(err)
    }
  },

  async loadOrders() {
    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'getShopOrders',
          data: { 
            shopId: this.data.shopId,
            status: this.data.currentTab 
          }
        }
      }) as any

      if (res.result.success) {
        const orders = res.result.list || []
        const stats = res.result.stats || { pending: 0, processing: 0, ready: 0, todaySales: 0 }
        this.setData({ orders, stats })
      }
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  switchTab(e: any) {
    this.setData({ currentTab: e.currentTarget.dataset.status }, () => {
      this.loadOrders()
    })
  },

  acceptOrder(e: any) {
    this.updateStatus(e.currentTarget.dataset.id, 'processing')
  },

  rejectOrder(e: any) {
    wx.showModal({
      title: '拒单理由',
      editable: true,
      placeholderText: '请输入理由',
      success: (res) => {
        if (res.confirm) {
          this.updateStatus(e.currentTarget.dataset.id, 'cancelled', res.content)
        }
      }
    })
  },

  readyOrder(e: any) {
    this.updateStatus(e.currentTarget.dataset.id, 'ready')
  },

  completeOrder(e: any) {
    this.updateStatus(e.currentTarget.dataset.id, 'completed')
  },

  async updateStatus(orderId: string, status: string, rejectReason?: string) {
    wx.showLoading({ title: '处理中...' })
    try {
      const res = await api.call({
        name: 'food_manager',
        data: {
          action: 'updateOrderStatus',
          data: { 
            orderId, 
            status, 
            rejectReason,
            shopId: this.data.shopId
          }
        }
      }) as any

      wx.hideLoading()
      if (res.result.success) {
        wx.showToast({ title: '操作成功', icon: 'success' })
        this.loadOrders()
      } else {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  goToDishManage() {
    wx.navigateTo({ url: '/packageFood/pages/shop_dish/shop_dish' })
  },

  goToSettings() {
    wx.navigateTo({ url: '/packageFood/pages/shop_settings/shop_settings' })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('food_shop_id')
          wx.removeStorageSync('shop_info')
          wx.redirectTo({ url: '/packageFood/pages/shop_login/shop_login' })
        }
      }
    })
  }
})
