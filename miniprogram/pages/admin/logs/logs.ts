import { api } from '../../../utils/api-client'
Page({
  data: {
    shopId: '',
    logs: [] as any[],
    loading: true
  },

  onLoad(options: any) {
    if (options.shopId) {
      this.setData({ shopId: options.shopId })
      this.loadLogs(options.shopId)
    }
  },

  async loadLogs(shopId: string) {
    this.setData({ loading: true })
    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: {
          action: 'getShopLogs',
          data: { shopId }
        }
      }) as any

      if (res.result && res.result.code === 0) {
        this.setData({
          logs: (res.result.data && res.result.data.list) ? res.result.data.list : [],
          loading: false
        })
      } else {
        wx.showToast({ title: (res.result && res.result.message) ? res.result.message : '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  }
})
