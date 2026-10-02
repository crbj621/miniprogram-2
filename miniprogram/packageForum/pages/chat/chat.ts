import { api } from '../../../utils/api-client'
Page({
  data: {
    toOpenid: '',
    toName: '',
    toAvatar: '',
    myAvatar: '',
    messages: [] as any[],
    inputContent: '',
    loading: false,
    scrollToView: ''
  },

  onLoad(options: any) {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' +
          encodeURIComponent('/packageForum/pages/messages/messages')
      })
      return
    }
    if (!options.toOpenid || options.toOpenid === app.getOpenIdSync()) {
      wx.showToast({ title: '聊天对象无效', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    const userInfo = app.getUserInfo()
    
    this.setData({
      toOpenid: options.toOpenid || '',
      toName: decodeURIComponent(options.toName || '用户'),
      toAvatar: decodeURIComponent(options.toAvatar || ''),
      myAvatar: (userInfo && userInfo.avatarUrl) || ''
    })
    
    wx.setNavigationBarTitle({ title: this.data.toName })
    this.loadMessages()
  },

  onShow() {
    const app = getApp()
    if (app.isLoggedIn()) this.loadMessages()
  },

  async loadMessages() {
    if (!this.data.toOpenid) return
    
    this.setData({ loading: true })
    
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'getChatMessages',
          data: { toOpenid: this.data.toOpenid }
        }
      }) as any

      if (res.result && res.result.success) {
        const app = getApp()
        const myOpenid = app.getOpenIdSync()
        
        const messages = res.result.messages.map((item: any) => ({
          ...item,
          isMine: item.fromOpenid === myOpenid
        }))
        
        this.setData({ messages })
        
        if (messages.length > 0) {
          this.setData({ scrollToView: 'msg-' + (messages.length - 1) })
        }
        
        this.markAsRead()
      }
    } catch (err) {
      console.error('加载消息失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async markAsRead() {
    try {
      await api.call({
        name: 'forum',
        data: {
          action: 'markChatRead',
          data: { toOpenid: this.data.toOpenid }
        }
      })
    } catch (err) {
      console.error('标记已读失败:', err)
    }
  },

  onInput(e: any) {
    this.setData({ inputContent: e.detail.value })
  },

  async onSend() {
    const content = this.data.inputContent.trim()
    if (!content) return
    
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    const userInfo = app.getUserInfo()
    
    this.setData({ inputContent: '' })
    
    const tempMsg = {
      _id: 'temp_' + Date.now(),
      content: content,
      fromOpenid: app.getOpenIdSync(),
      toOpenid: this.data.toOpenid,
      isMine: true
    }
    
    this.setData({
      messages: [...this.data.messages, tempMsg],
      scrollToView: 'msg-' + this.data.messages.length
    })
    
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'sendChatMessage',
          data: {
            toOpenid: this.data.toOpenid,
            content: content,
            fromName: (userInfo && userInfo.nickName) || '用户',
            fromAvatar: (userInfo && userInfo.avatarUrl) || ''
          }
        }
      }) as any

      if (res.result && res.result.success) {
        const messages = this.data.messages.map((m: any) => {
          if (m._id === tempMsg._id) {
            return { ...m, _id: res.result.messageId }
          }
          return m
        })
        this.setData({ messages })
      }
    } catch (err) {
      console.error('发送消息失败:', err)
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack()
  }
})
