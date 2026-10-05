import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
Page(withSharing({
  data: {
    activeTab: 'notifications',
    notifications: [] as any[],
    conversations: [] as any[],
    unreadNotifications: 0,
    unreadChats: 0
  },

  onLoad() {
    this.ensureLogin()
  },

  onShow() {
    if (this.ensureLogin()) this.loadData()
  },

  ensureLogin() {
    const app = getApp()
    if (app.isLoggedIn()) return true
    wx.redirectTo({
      url: '/pages/login/login?forceLogin=true&redirect=' +
        encodeURIComponent('/packageForum/pages/messages/messages')
    })
    return false
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/packageForum/pages/index/index' })
    })
  },

  async loadData() {
    this.loadNotifications()
    this.loadConversations()
  },

  async loadNotifications() {
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getNotifications', data: { page: 1, pageSize: 50 } }
      }) as any

      if (res.result && res.result.success) {
        const notifications = res.result.notifications.map((item: any) => ({
          ...item,
          createTimeText: this.formatTime(item.createTime)
        }))
        const unreadNotifications = notifications.filter((n: any) => !n.isRead).length
        this.setData({ notifications, unreadNotifications })
      }
    } catch (err) {
      console.error('加载通知失败:', err)
    }
  },

  async loadConversations() {
    try {
      const res = await api.call({
        name: 'forum',
        data: { action: 'getConversations' }
      }) as any

      if (res.result && res.result.success) {
        const conversations = res.result.conversations.map((item: any) => ({
          ...item,
          lastTimeText: this.formatTime(item.lastTime)
        }))
        const unreadChats = conversations.reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0)
        this.setData({ conversations, unreadChats })
      }
    } catch (err) {
      console.error('加载会话失败:', err)
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
    this.setData({ activeTab: tab })
  },

  async onNotificationTap(e: any) {
    const item = e.currentTarget.dataset.item
    
    if (!item.isRead) {
      try {
        await api.call({
          name: 'forum',
          data: { action: 'markNotificationRead', data: { notificationId: item._id } }
        })
        this.loadNotifications()
      } catch (err) {
        console.error('标记已读失败:', err)
      }
    }
    
    if (item.postId) {
      wx.navigateTo({ url: '/packageForum/pages/detail/detail?id=' + item.postId })
    }
  },

  onChatTap(e: any) {
    const item = e.currentTarget.dataset.item
    wx.navigateTo({
      url: '/packageForum/pages/chat/chat?toOpenid=' + item.toOpenid + '&toName=' + encodeURIComponent(item.toName) + '&toAvatar=' + encodeURIComponent(item.toAvatar || '')
    })
  }
}))
