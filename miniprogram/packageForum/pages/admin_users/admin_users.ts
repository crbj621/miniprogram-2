import { api } from '../../../utils/api-client'
Page({
  data: {
    statusList: [
      { key: '', name: '全部状态' },
      { key: 'normal', name: '正常' },
      { key: 'banned', name: '禁言' }
    ],
    statusIndex: 0,
    keyword: '',
    users: [] as any[],
    page: 1,
    hasMore: true,
    loading: false
  },

  onLoad() {
    this.loadUsers()
  },

  onStatusChange(e: any) {
    this.setData({ statusIndex: e.detail.value, page: 1, users: [], hasMore: true })
    this.loadUsers()
  },

  onKeywordInput(e: any) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.setData({ page: 1, users: [], hasMore: true })
    this.loadUsers()
  },

  onPullDownRefresh() {
    this.setData({ page: 1, users: [], hasMore: true })
    this.loadUsers().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  async loadUsers() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const { statusList, statusIndex, keyword, page } = this.data
      const data: any = { page, pageSize: 20 }
      if (statusList[statusIndex].key) data.status = statusList[statusIndex].key
      if (keyword) data.keyword = keyword

      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getUsers', data }
      }) as any

      if (res.result.code === 0) {
        this.setData({
          users: page === 1 ? res.result.data.list : [...this.data.users, ...res.result.data.list],
          hasMore: res.result.data.list.length >= 20,
          page: page + 1
        })
      }
    } catch (err) {
      console.error('加载用户失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    this.loadUsers()
  },

  async updateUserStatus(e: any) {
    const userId = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status

    wx.showModal({
      title: status === 'banned' ? '禁言用户' : '解除禁言',
      content: status === 'banned' ? '确定要禁言该用户吗？' : '确定要解除该用户的禁言吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await api.call({
              name: 'globalAdmin',
              data: { action: 'updateUser', data: { id: userId, status: status } }
            }) as any

            if (result.result.code === 0) {
              wx.showToast({ title: '操作成功', icon: 'success' })
              this.setData({ page: 1, users: [], hasMore: true })
              this.loadUsers()
            }
          } catch (err) {
            wx.showToast({ title: '操作失败', icon: 'none' })
          }
        }
      }
    })
  }
})
