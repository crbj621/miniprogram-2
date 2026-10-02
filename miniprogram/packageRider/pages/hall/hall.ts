import { api } from '../../../utils/api-client'
Page({
  data: {
    loading: false,
    list: [] as any[]
  },

  onShow() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageRider/pages/hall/hall')
      })
      return
    }
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'rider',
        data: { action: 'listAvailableOrders' }
      }) as any

      if (res.result && res.result.code === 0) {
        this.setData({ list: (res.result.data && res.result.data.list) ? res.result.data.list : [] })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '加载失败', icon: 'none' })
        if (res.result && res.result.message === '请先注册骑手') {
          wx.redirectTo({ url: '/packageRider/pages/register/register' })
        }
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async accept(e: any) {
    const id = e.currentTarget.dataset.id
    wx.showLoading({ title: '接单中...' })
    try {
      const res = await api.call({
        name: 'rider',
        data: { action: 'acceptOrder', data: { orderId: id } }
      }) as any

      wx.hideLoading()
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '接单成功', icon: 'success' })
        setTimeout(() => {
          wx.navigateTo({ url: '/packageRider/pages/my/my' })
        }, 600)
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '接单失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '接单失败', icon: 'none' })
    }
  },

  goMy() {
    wx.navigateTo({ url: '/packageRider/pages/my/my' })
  }
})
