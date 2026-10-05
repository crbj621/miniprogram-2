import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { callCanteen } from '../../utils/api'
import { getSavedCampusTheme } from '../../../utils/campus-theme'

Page(withSharing(withPageCopy('canteen', {
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.load()) },
  data: {
    theme: getSavedCampusTheme('canteen'),
    stalls: [] as any[], dishes: [] as any[], keyword: '', tab: 'stalls', meal: 'all',
    meals: [{ key: 'all', label: '全部' }, { key: 'breakfast', label: '早餐' }, { key: 'lunch', label: '午餐' }, { key: 'dinner', label: '晚餐' }],
    loading: true, randomMode: 'quality', picked: null as any, pickedStall: null as any,
    randomMessage: '',
    picking: false
  },
  onShow() { this.setData({ theme: getSavedCampusTheme('canteen') }); this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    const requestId = this.listRequestId = (this.listRequestId || 0) + 1
    this.setData({ loading: true })
    try {
      const result = await callCanteen('list', { keyword: this.data.keyword, meal: this.data.meal })
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
  chooseMeal(e: any) {
    const meal = e.currentTarget.dataset.meal
    if (!this.data.meals.some(row => row.key === meal) || meal === this.data.meal) return
    this.pickVersion = (this.pickVersion || 0) + 1
    this.setData({ meal, picked: null, pickedStall: null, randomMessage: '', picking: false })
    return this.load()
  },
  selectMode(e: any) { this.pickVersion = (this.pickVersion || 0) + 1; this.setData({ randomMode: e.currentTarget.dataset.mode, picked: null, randomMessage: '', picking: false }) },
  async pick() {
    if (this.data.picking) return
    const mode = this.data.randomMode, meal = this.data.meal, version = this.pickVersion = (this.pickVersion || 0) + 1
    this.setData({ picking: true })
    try {
      const result = await callCanteen('random', { mode, meal })
      if (version !== this.pickVersion) return
      this.setData({ picked: result.dish || null, pickedStall: result.stall || null, randomMessage: result.msg || '' })
    } catch (error: any) {
      if (version === this.pickVersion) wx.showToast({ title: error.message || '抽取失败', icon: 'none' })
    } finally { if (version === this.pickVersion) this.setData({ picking: false }) }
  },
  goStall(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/stall/stall?id=' + e.currentTarget.dataset.id + '&meal=' + this.data.meal }) },
  goSubmit() { wx.navigateTo({ url: '/packageCanteen/pages/submit/submit' }) },
  goDish(e: any) { wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + e.currentTarget.dataset.id }) },
  goPicked() {
    if (this.data.picked) wx.navigateTo({ url: '/packageCanteen/pages/dish/dish?id=' + this.data.picked._id })
  }
})))
