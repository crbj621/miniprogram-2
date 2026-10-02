import { api } from '../../../utils/api-client'
Page({
  data: {
    statusList: [
      { key: '', name: '全部状态' },
      { key: 'pending', name: '待处理' },
      { key: 'handled', name: '已处理' }
    ],
    statusIndex: 0,
    reports: [] as any[],
    page: 1,
    hasMore: true,
    loading: false
  },

  onLoad() {
    this.loadReports()
  },

  onStatusChange(e: any) {
    this.setData({ statusIndex: e.detail.value, page: 1, reports: [], hasMore: true })
    this.loadReports()
  },

  onPullDownRefresh() {
    this.setData({ page: 1, reports: [], hasMore: true })
    this.loadReports().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  async loadReports() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const { statusList, statusIndex, page } = this.data
      const data: any = { page, pageSize: 20 }
      if (statusList[statusIndex].key) data.status = statusList[statusIndex].key

      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getReports', data }
      }) as any

      if (res.result.code === 0) {
        this.setData({
          reports: page === 1 ? res.result.data.list : [...this.data.reports, ...res.result.data.list],
          hasMore: res.result.data.list.length >= 20,
          page: page + 1
        })
      }
    } catch (err) {
      console.error('加载举报失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    this.loadReports()
  },

  async handleReport(e: any) {
    const reportId = e.currentTarget.dataset.id
    const deletePost = e.currentTarget.dataset.delete === 'true'

    wx.showModal({
      title: deletePost ? '删除动态' : '忽略举报',
      content: deletePost ? '确定要删除被举报的动态吗？' : '确定要忽略这条举报吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await api.call({
              name: 'globalAdmin',
              data: { 
                action: 'handleReport', 
                data: { 
                  reportId, 
                  status: 'handled',
                  deletePost: deletePost
                } 
              }
            }) as any

            if (result.result.code === 0) {
              wx.showToast({ title: '处理成功', icon: 'success' })
              this.setData({ page: 1, reports: [], hasMore: true })
              this.loadReports()
            }
          } catch (err) {
            wx.showToast({ title: '处理失败', icon: 'none' })
          }
        }
      }
    })
  }
})
