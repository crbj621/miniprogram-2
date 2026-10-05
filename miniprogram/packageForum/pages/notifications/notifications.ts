import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    notifications: [] as any[],
    loading: false,
    hasMore: true,
    page: 1,
    unreadCount: 0
  },

  onLoad() {
    if (this.ensureLogin()) this.loadNotifications()
  },

  onShow() {
    if (this.ensureLogin()) this.loadNotifications()
  },

  ensureLogin() {
    const app = getApp()
    if (app.isLoggedIn()) return true
    wx.redirectTo({
      url: '/pages/login/login?forceLogin=true&redirect=' +
        encodeURIComponent('/packageForum/pages/notifications/notifications')
    })
    return false
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
    
    const month = d.getMonth() + 1
    const day = d.getDate()
    return `${month}月${day}日`
  },

  async loadNotifications() {
    if (this.data.loading) return
    
    this.setData({ loading: true })
    
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'getNotifications',
          page: 1,
          pageSize: 20
        }
      }) as any

      if (res.result && res.result.success) {
        const notifications = res.result.notifications.map((item: any) => ({
          ...item,
          createTimeText: this.formatTime(item.createTime)
        }))
        this.setData({
          notifications,
          hasMore: res.result.hasMore
        })
      }
    } catch (err) {
      console.error('加载通知失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async goToPost(e: any) {
    const postId = e.currentTarget.dataset.id
    const notificationId = e.currentTarget.dataset.notificationId
    
    await this.markAsRead(notificationId)
    
    wx.navigateTo({
      url: `/packageForum/pages/detail/detail?id=${postId}`
    })
  },

  async markAsRead(notificationId: string) {
    try {
      await api.call({
        name: 'forum',
        data: {
          action: 'markNotificationRead',
          notificationId
        }
      })
      
      const notifications = this.data.notifications.map((item: any) => {
        if (item._id === notificationId) {
          return { ...item, isRead: true }
        }
        return item
      })
      this.setData({ notifications })
    } catch (err) {
      console.error('标记已读失败:', err)
    }
  },

  async markAllRead() {
    try {
      const promises = this.data.notifications
        .filter((item: any) => !item.isRead)
        .map((item: any) => api.call({
          name: 'forum',
          data: {
            action: 'markNotificationRead',
            notificationId: item._id
          }
        }))
      
      await Promise.all(promises)
      
      const notifications = this.data.notifications.map((item: any) => ({
        ...item,
        isRead: true
      }))
      this.setData({ notifications, unreadCount: 0 })
      
      wx.showToast({ title: '已全部标记为已读', icon: 'success' })
    } catch (err) {
      console.error('全部标记已读失败:', err)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack()
  }
}))
