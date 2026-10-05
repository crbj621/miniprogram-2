import { withSharing } from '../../../utils/page-share'
import { withPageCopy } from '../../../utils/page-copy'
import { api } from '../../../utils/api-client'
import { getSavedCampusTheme } from '../../../utils/campus-theme'
Page(withSharing(withPageCopy('forum', {
  refreshPage() { return this.selectComponent("#page-refresh").refresh(() => this.loadPosts()) },
  data: {
    theme: getSavedCampusTheme('forum'),
    categories: [] as Array<{key: string, name: string}>,
    categoryOptions: [{ key: '', name: '全部分区' }] as Array<{key: string, name: string}>,
    categoryIndex: 0,
    categoryExpanded: false,
    categoriesLoading: false,
    categoriesError: false,
    posts: [] as any[],
    currentCategory: '',
    activeTab: 'latest',
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    unreadCount: 0,
    showAnnouncement: false,
    announcement: null as any
  },

  onLoad() {
    this.loadCategories()
    this.loadPosts()
    this.checkAnnouncement()
  },

  onShow() {
    this.setData({ theme: getSavedCampusTheme('forum') })
    this.loadUnreadCount()
  },

  onHide() {
    this.closeCategoryMenu()
  },

  toggleCategoryMenu() {
    if (this.data.categoriesLoading) return
    this.setData({ categoryExpanded: !this.data.categoryExpanded })
  },

  closeCategoryMenu() {
    if (this.data.categoryExpanded) this.setData({ categoryExpanded: false })
  },

  async checkAnnouncement() {
    const lastAnnouncementId = wx.getStorageSync('lastReadAnnouncementId')
    
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getAnnouncement' }
      }) as any
      
      if (res.result && res.result.success && res.result.announcement) {
        const announcement = res.result.announcement
        if (announcement._id !== lastAnnouncementId) {
          this.setData({ 
            showAnnouncement: true, 
            announcement: announcement 
          })
        }
      }
    } catch (err) {
      console.error('检查公告失败:', err)
    }
  },

  onCloseAnnouncement() {
    if (this.data.announcement) {
      wx.setStorageSync('lastReadAnnouncementId', this.data.announcement._id)
    }
    this.setData({ showAnnouncement: false })
  },

  async loadCategories() {
    this.setData({ categoriesLoading: true, categoriesError: false })
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getCategories' }
      }) as any
      if (res.result && res.result.success) {
        const categories = res.result.categories || []
        const categoryOptions = [{ key: '', name: '全部分区' }, ...categories]
        const categoryIndex = Math.max(0, categoryOptions.findIndex(item => item.key === this.data.currentCategory))
        this.setData({ categories, categoryOptions, categoryIndex })
      } else throw new Error('分类读取失败')
    } catch (err) {
      console.error('加载分类失败:', err)
      this.setData({ categoriesError: true })
    } finally {
      this.setData({ categoriesLoading: false })
    }
  },

  onCategoryChange(e: any) {
    const categoryIndex = Number(e.currentTarget.dataset.index)
    const category = this.data.categoryOptions[categoryIndex]
    if (!category) return
    this.closeCategoryMenu()
    if (category.key === this.data.currentCategory) return
    this.setData({ categoryIndex, currentCategory: category.key, posts: [], page: 1, hasMore: true })
    this.loadPosts()
  },

  async loadPosts(append = false) {
    const requestId = this.postRequestId = (this.postRequestId || 0) + 1
    const page = append ? this.data.page + 1 : 1
    this.setData({ loading: true })

    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'getPosts',
          data: {
            category: this.data.currentCategory,
            orderBy: this.data.activeTab,
            page,
            pageSize: 10
          }
        }
      }) as any
      if (requestId !== this.postRequestId) return false

      if (res.result && res.result.success) {
        const posts = res.result.posts.map((post: any) => ({
          ...post,
          createTimeText: this.formatTime(post.createTime)
        }))
        this.setData({
          posts: append ? [...this.data.posts, ...posts] : posts,
          page,
          hasMore: res.result.hasMore
        })
        return true
      }
      throw new Error((res.result && res.result.msg) || '动态加载失败')
    } catch (err) {
      if (requestId !== this.postRequestId) return false
      console.error('加载动态失败:', err)
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' })
      return false
    } finally {
      if (requestId === this.postRequestId) this.setData({ loading: false, refreshing: false })
    }
  },

  async loadUnreadCount() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      this.setData({ unreadCount: 0 })
      return
    }
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getUnreadCount' }
      }) as any
      if (res.result && res.result.success) {
        this.setData({ unreadCount: res.result.count })
      }
    } catch (err) {
      console.error('获取未读数失败:', err)
    }
  },

  formatTime(date: any): string {
    if (!date) return ''
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'
    
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  },

  onTabTap(e: any) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab, page: 1, posts: [] })
    this.loadPosts()
  },

  onRefresh() {
    this.setData({ refreshing: true, page: 1 })
    this.loadPosts()
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.loadPosts(true)
  },

  onAvatarTap(e: any) {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageForum/pages/index/index')
      })
      return
    }
    const openid = e.currentTarget.dataset.openid
    const name = e.currentTarget.dataset.name
    const avatar = e.currentTarget.dataset.avatar
    const myOpenid = app.getOpenIdSync()
    
    if (!openid || openid === myOpenid) return
    
    wx.navigateTo({
      url: '/packageForum/pages/chat/chat?toOpenid=' + openid + '&toName=' + encodeURIComponent(name || '用户') + '&toAvatar=' + encodeURIComponent(avatar || ''),
      fail: (err) => {
        console.error('跳转聊天页面失败:', err)
      }
    })
  },

  goToDetail(e: any) {
    wx.navigateTo({
      url: '/packageForum/pages/detail/detail?id=' + e.currentTarget.dataset.id,
      fail: (err) => {
        console.error('跳转详情页面失败:', err)
      }
    })
  },

  goToPost() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageForum/pages/post/post')
      })
      return
    }
    wx.navigateTo({ 
      url: '/packageForum/pages/post/post',
      fail: (err) => {
        console.error('跳转发帖页面失败:', err)
      }
    })
  },

  goToMine() {
    wx.navigateTo({ 
      url: '/pages/profile/profile?source=forum',
      fail: (err) => {
        console.error('跳转我的页面失败:', err)
      }
    })
  },

  goToMessages() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.navigateTo({
        url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageForum/pages/messages/messages')
      })
      return
    }
    wx.navigateTo({ 
      url: '/packageForum/pages/messages/messages',
      fail: (err) => {
        console.error('跳转消息页面失败:', err)
      }
    })
  },

  goToSearch() {
    wx.navigateTo({ 
      url: '/packageForum/pages/list/list?search=1',
      fail: (err) => {
        console.error('跳转搜索页面失败:', err)
      }
    })
  }
})))
