import { api } from '../../../utils/api-client'

Page({
  data: { runList: [] as any[], isEmpty: true, loading: false, hasMore: false, error: '' },
  requestId: 0,
  offset: 0,
  historyOpenid: '',
  onLoad() {
    if (!getApp().isLoggedIn()) wx.redirectTo({ url: '/pages/login/login?forceLogin=true&redirect=' +
      encodeURIComponent('/packageProfile/pages/history/history') })
  },
  onShow() { if (getApp().isLoggedIn()) this.loadRunHistory() },
  async loadRunHistory() { await this.fetchHistory(true) },
  async loadMore() { if (this.data.hasMore && !this.data.loading) await this.fetchHistory(false) },
  onReachBottom() { this.loadMore() },
  async onPullDownRefresh() { try { await this.loadRunHistory() } finally { wx.stopPullDownRefresh() } },
  async fetchHistory(reset: boolean) {
    const openid = wx.getStorageSync('openid'), requestId = ++this.requestId
    if (openid !== this.historyOpenid) {
      this.historyOpenid = openid
      this.offset = 0
      this.setData({ runList: [], isEmpty: true, hasMore: false })
    }
    this.setData({ loading: true, error: '' })
    try {
      const response: any = await api.call({ name: 'getUserRunStats', data: { action: 'history', offset: reset ? 0 : this.offset, limit: 20 } })
      if (requestId !== this.requestId || openid !== wx.getStorageSync('openid')) return
      const result = response.result
      if (!result || !result.success || !Array.isArray(result.data)) throw new Error(result?.errMsg || '记录加载失败')
      const previous = reset ? [] : this.data.runList
      const ids = new Set(previous.map((row: any) => row._id))
      const runList = previous.concat(result.data.filter((row: any) => !ids.has(row._id)).map((row: any) => ({
        ...row, time: row.endedAt ? new Date(row.endedAt + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : row.time
      })))
      this.offset = (reset ? 0 : this.offset) + result.data.length
      this.setData({ runList, isEmpty: !runList.length, hasMore: !!result.hasMore })
    } catch (error: any) { if (requestId === this.requestId) this.setData({ error: error.message || '网络异常，请重试' }) }
    finally { if (requestId === this.requestId) this.setData({ loading: false }) }
  },
  onShareAppMessage() { return { title: '一起记录校园跑', path: '/pages/index/index' } }
})
