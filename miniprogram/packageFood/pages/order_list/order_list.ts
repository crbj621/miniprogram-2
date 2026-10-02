import { callFoodFunction } from '../../utils/food-cloud'

Page({
  data: {
    orders: [] as any[],
    loading: true,
    currentTab: 'all'
  },

  onLoad() {
    this.ensureLogin()
  },

  onShow() {
    if (this.ensureLogin()) this.loadOrders()
  },

  ensureLogin() {
    const app = getApp()
    if (app.isLoggedIn()) return true
    wx.redirectTo({
      url: '/pages/login/login?forceLogin=true&redirect=' +
        encodeURIComponent('/packageFood/pages/order_list/order_list')
    })
    return false
  },

  onPullDownRefresh() {
    this.loadOrders().then(() => wx.stopPullDownRefresh())
  },

  switchTab(e: any) {
    this.setData({ currentTab: e.currentTarget.dataset.status }, () => {
      this.loadOrders()
    })
  },

  async loadOrders() {
    this.setData({ loading: true })
    try {
      const res = await callFoodFunction('getUserOrders', { status: this.data.currentTab })
      this.setData({
        orders: res.list || [],
        loading: false
      })
    } catch (err: any) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  goToDetail(e: any) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/packageFood/pages/order_detail/order_detail?id=${id}`
    })
  },

  cancelOrder(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消订单',
      content: '确定要取消该订单吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await callFoodFunction('updateOrderStatus', { orderId: id, status: 'cancelled' }, { showLoading: true, loadingTitle: '取消中' })
            wx.showToast({ title: '已取消', icon: 'success' })
            this.loadOrders()
          } catch (err: any) {
            wx.showToast({ title: err.message || '取消失败', icon: 'none' })
          }
        }
      }
    })
  }
})
