import { api } from '../../../utils/api-client'
Page({
  data: {
    statusList: [
      { key: '', name: '全部状态' },
      { key: 'normal', name: '正常' },
      { key: 'hidden', name: '已隐藏' },
      { key: 'deleted', name: '已删除' }
    ],
    statusIndex: 0,
    categoryList: [
      { key: '', name: '全部分类' },
      { key: 'gossip', name: '灌水区' },
      { key: 'confession', name: '表白墙' },
      { key: 'melon', name: '吃瓜' },
      { key: 'job', name: '兼职' },
      { key: 'lost', name: '失物招领' },
      { key: 'study', name: '学习互助' }
    ],
    categoryIndex: 0,
    posts: [] as any[],
    page: 1,
    hasMore: true,
    loading: false
  },

  onLoad() {
    this.loadPosts()
  },

  onStatusChange(e: any) {
    this.setData({ statusIndex: e.detail.value, page: 1, posts: [], hasMore: true })
    this.loadPosts()
  },

  onCategoryChange(e: any) {
    this.setData({ categoryIndex: e.detail.value, page: 1, posts: [], hasMore: true })
    this.loadPosts()
  },

  onPullDownRefresh() {
    this.setData({ page: 1, posts: [], hasMore: true })
    this.loadPosts().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  async loadPosts() {
    if (this.data.loading || !this.data.hasMore) return

    this.setData({ loading: true })

    try {
      const { statusList, statusIndex, categoryList, categoryIndex, page } = this.data
      const data: any = { page, pageSize: 20 }
      if (statusList[statusIndex].key) data.status = statusList[statusIndex].key
      if (categoryList[categoryIndex].key) data.category = categoryList[categoryIndex].key

      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'getPosts', data }
      }) as any

      if (res.result.code === 0) {
        this.setData({
          posts: page === 1 ? res.result.data.list : [...this.data.posts, ...res.result.data.list],
          hasMore: res.result.data.list.length >= 20,
          page: page + 1
        })
      }
    } catch (err) {
      console.error('加载动态失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  loadMore() {
    this.loadPosts()
  },

  async deletePost(e: any) {
    const postId = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条动态吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await api.call({
              name: 'globalAdmin',
              data: { action: 'deletePost', data: { id: postId } }
            }) as any

            if (result.result.code === 0) {
              wx.showToast({ title: '删除成功', icon: 'success' })
              this.setData({ page: 1, posts: [], hasMore: true })
              this.loadPosts()
            }
          } catch (err) {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  async toggleTop(e: any) {
    const postId = e.currentTarget.dataset.id
    const isTop = e.currentTarget.dataset.top

    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'setPostTop', data: { id: postId, isTop: !isTop } }
      }) as any

      if (res.result.code === 0) {
        wx.showToast({ title: res.result.message, icon: 'success' })
        this.setData({ page: 1, posts: [], hasMore: true })
        this.loadPosts()
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  async toggleEssence(e: any) {
    const postId = e.currentTarget.dataset.id
    const isEssence = e.currentTarget.dataset.essence

    try {
      const res = await api.call({
        name: 'globalAdmin',
        data: { action: 'setPostEssence', data: { id: postId, isEssence: !isEssence } }
      }) as any

      if (res.result.code === 0) {
        wx.showToast({ title: res.result.message, icon: 'success' })
        this.setData({ page: 1, posts: [], hasMore: true })
        this.loadPosts()
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
