import { withSharing } from '../../../utils/page-share'
import { callCanteen } from '../../utils/api'

Page(withSharing({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: { id: '', stall: null as any, dishes: [] as any[], photos: [] as any[], meal: 'all', loading: true },
  onLoad(options: any) { this.setData({ id: options.id || '', meal: options.meal || 'all' }) },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    try {
      const result = await callCanteen('detail', { stallId: this.data.id, meal: this.data.meal })
      this.setData({ stall: result.stall, dishes: result.dishes, photos: result.photos || [], loading: false })
      wx.setNavigationBarTitle({ title: result.stall.name })
      return true
    } catch (error: any) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      return false
    }
  },
  goDish(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + e.currentTarget.dataset.id }) },
  contribute(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/submit/submit?kind=' + (e.currentTarget.dataset.kind || 'photo') + '&stallId=' + this.data.id }) },
  previewPhoto(e: any) { wx.previewImage({ current: e.currentTarget.dataset.image, urls: this.data.photos.map(row => row.image) }) },
  preview() { if (this.data.stall && this.data.stall.image) wx.previewImage({ urls: [this.data.stall.image] }) }
}))
