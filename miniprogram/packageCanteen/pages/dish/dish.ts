import { callCanteen, canReview } from '../../utils/api'

Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: { id: '', dish: null as any, stall: null as any, reviews: [] as any[],
    score: 0, count: 0, myScore: 0, comment: '', saving: false, stars: [1, 2, 3, 4, 5] },
  onLoad(options: any) { this.setData({ id: options.id || '' }) },
  onShow() { if (this.data.id) this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    try {
      const result = await callCanteen('reviews', { dishId: this.data.id })
      const mine = (result.reviews || []).find((row: any) => row.mine)
      this.setData({ dish: result.dish, stall: result.stall, reviews: result.reviews,
        score: result.score, count: result.count, myScore: mine ? mine.score : 0,
        comment: mine ? mine.comment : '' })
      wx.setNavigationBarTitle({ title: result.dish.name })
      return true
    } catch (error: any) { wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      return false }
  },
  selectScore(e: any) { this.setData({ myScore: Number(e.currentTarget.dataset.score) }) },
  onComment(e: any) { this.setData({ comment: e.detail.value }) },
  preview() { if (this.data.dish && this.data.dish.image) wx.previewImage({ urls: [this.data.dish.image] }) },
  async submit() {
    if (this.data.saving) return
    if (!canReview()) {
      wx.navigateTo({ url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageCanteen/pages/dish/dish?id=' + this.data.id) })
      return
    }
    this.setData({ saving: true })
    try {
      await callCanteen('saveReview', { dishId: this.data.id, score: this.data.myScore, comment: this.data.comment })
      wx.showToast({ title: '评价已发布', icon: 'success' })
      await this.load()
    } catch (error: any) { wx.showToast({ title: error.message || '发布失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
