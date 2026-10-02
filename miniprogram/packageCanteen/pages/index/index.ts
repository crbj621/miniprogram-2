import { callCanteen } from '../../utils/api'

Page({
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: {
    stalls: [] as any[], dishes: [] as any[], keyword: '', tab: 'stalls',
    loading: true, randomMode: 'quality', picked: null as any, pickedStall: null as any,
    randomMessage: '',
    picking: false
  },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    const requestId = this.listRequestId = (this.listRequestId || 0) + 1
    this.setData({ loading: true })
    try {
      const result = await callCanteen('list', { keyword: this.data.keyword })
      if (requestId !== this.listRequestId) return
      this.setData({ stalls: result.stalls || [], dishes: result.dishes || [], loading: false })
      return true
    } catch (error: any) {
      if (requestId !== this.listRequestId) return
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '加载失败', icon: 'none' })
      return false
    }
  },
  onKeyword(e: any) { this.setData({ keyword: e.detail.value }) },
  search() { this.load() },
  switchTab(e: any) { this.setData({ tab: e.currentTarget.dataset.tab }) },
  selectMode(e: any) { this.setData({ randomMode: e.currentTarget.dataset.mode, picked: null, randomMessage: '' }) },
  async pick() {
    if (this.data.picking) return
    const mode = this.data.randomMode
    this.setData({ picking: true })
    try {
      const result = await callCanteen('random', { mode })
      if (mode !== this.data.randomMode) return
      this.setData({ picked: result.dish || null, pickedStall: result.stall || null, randomMessage: result.msg || '' })
    } catch (error: any) {
      wx.showToast({ title: error.message || '抽取失败', icon: 'none' })
    } finally { this.setData({ picking: false }) }
  },
  goStall(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/stall/stall?id=' + e.currentTarget.dataset.id }) },
  goSubmit() { wx.navigateTo({ url: '/packageCanteen/pages/submit/submit' }) },
  goDish(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + e.currentTarget.dataset.id }) },
  goPicked() {
    if (this.data.picked) wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + this.data.picked._id })
  }
})
