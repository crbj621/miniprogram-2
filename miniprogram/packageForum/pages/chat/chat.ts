import { withSharing } from '../../../utils/page-share'
import { api } from '../../../utils/api-client'
import { createKeyboardViewport } from '../../../utils/keyboard-viewport'
Page(withSharing({
  data: {
    toOpenid: '',
    toName: '',
    toAvatar: '',
    myAvatar: '',
    messages: [] as any[],
    inputContent: '',
    sending: false,
    keyboardViewportHeight: 0,
    keyboardHeight: 0,
    loading: false,
    scrollToView: ''
  },

  keyboardViewport: null as ReturnType<typeof createKeyboardViewport>,
  messagesRequestId: 0,

  onLoad(options: any) {
    this.keyboardViewport = createKeyboardViewport(this)
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
    if (this.keyboardViewport) this.keyboardViewport.start()
    const app = getApp()
    if (app.isLoggedIn()) this.loadMessages()
  },

  onHide() { if (this.keyboardViewport) this.keyboardViewport.stop() },
  onUnload() { if (this.keyboardViewport) this.keyboardViewport.stop() },
  onResize(event: any) { if (this.keyboardViewport) this.keyboardViewport.resize(event) },
  onKeyboardHeightChange(event: any) { if (this.keyboardViewport) this.keyboardViewport.onHeightChange(event) },

  onComposerFocus(event: any) {
    if (!this.keyboardViewport) return
    this.keyboardViewport.start()
    this.keyboardViewport.onHeightChange(event)
    if (this.data.messages.length) this.setData({ scrollToView: 'msg-' + (this.data.messages.length - 1) })
  },

  async loadMessages() {
    if (!this.data.toOpenid) return
    const requestId = ++this.messagesRequestId
    
    this.setData({ loading: true })
    
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'getChatMessages',
          data: { toOpenid: this.data.toOpenid }
        }
      }) as any

      if (requestId !== this.messagesRequestId) return
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
      if (requestId === this.messagesRequestId) this.setData({ loading: false })
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
    const draft = this.data.inputContent
    const content = draft.trim()
    if (!content || this.data.sending) return
    
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    const userInfo = app.getUserInfo()
    
    this.setData({ sending: true })
    
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

      if (!res.result || !res.result.success) throw new Error((res.result && res.result.errMsg) || '发送失败，请重试')
      // A list request started before this send must not erase the new message.
      this.messagesRequestId++
      const message = {
        _id: res.result.messageId,
        content,
        fromOpenid: app.getOpenIdSync(),
        toOpenid: this.data.toOpenid,
        isMine: true
      }
      const messages = this.data.messages.some((item: any) => item._id === message._id)
        ? this.data.messages : [...this.data.messages, message]
      this.setData({
        messages,
        loading: false,
        inputContent: this.data.inputContent === draft ? '' : this.data.inputContent,
        scrollToView: 'msg-' + (messages.length - 1)
      })
    } catch (err) {
      console.error('发送消息失败:', err)
      wx.showToast({ title: '发送失败，内容已保留', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },

  goBack() {
    wx.navigateBack()
  }
}))
