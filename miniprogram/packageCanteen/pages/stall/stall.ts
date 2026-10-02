import { callCanteen } from '../../utils/api'

Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: { id: '', stall: null as any, dishes: [] as any[], loading: true },
  onLoad(options: any) { this.setData({ id: options.id || '' }) },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    try {
      const result = await callCanteen('detail', { stallId: this.data.id })
      this.setData({ stall: result.stall, dishes: result.dishes, loading: false })
      wx.setNavigationBarTitle({ title: result.stall.name })
      return true
    } catch (error: any) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      return false
    }
  },
  goDish(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + e.currentTarget.dataset.id }) },
  preview() { if (this.data.stall && this.data.stall.image) wx.previewImage({ urls: [this.data.stall.image] }) }
})
