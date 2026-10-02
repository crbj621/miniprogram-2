import { api } from '../../../utils/api-client'
Page({
  data: {
    logs: [] as any[],
    page: 1,
    hasMore: true,
    loading: false
  },

  onLoad() {
    this.loadLogs()
  },

  async loadLogs() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const { page } = this.data

      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getOperationLogs', data: { module: 'forum', page, pageSize: 20 } }
      }) as any

      if (res.result && res.result.code === 0) {
        const list = (res.result.data && res.result.data.list) ? res.result.data.list : []
        this.setData({
          logs: page === 1 ? list : [...this.data.logs, ...list],
          hasMore: list.length >= 20,
          page: page + 1
        })
      }
    } catch (err) {
      console.error('加载日志失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    this.loadLogs()
  }
})
