import { api } from '../../../utils/api-client'
Page({
  data: {
    postId: '',
    post: {} as any,
    comments: [] as any[],
    commentContent: '',
    replyTo: '',
    replyToName: '',
    showReportModal: false,
    reportReason: '',
    currentOpenid: '',
    commentSubmitting: false,
    postActionLoading: false
  },

  onLoad(options: any) {
    const app = getApp()
    this.setData({
      postId: options.id,
      currentOpenid: app.getOpenIdSync()
    })
    this.loadPostDetail()
    this.loadComments()
  },

  async loadPostDetail() {
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'getPostDetail',
          data: { postId: this.data.postId }
        }
      }) as any

      if (res.result && res.result.success) {
        const post = res.result.post
        post.createTimeText = this.formatTime(post.createTime)
        this.setData({ post })
      }
    } catch (err) {
      console.error('加载动态失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadComments() {
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'getComments',
          data: { postId: this.data.postId }
        }
      }) as any

      if (res.result && res.result.success) {
        const comments = res.result.comments.map((item: any) => ({
          ...item,
          createTimeText: this.formatTime(item.createTime)
        }))
        this.setData({ comments })
      }
    } catch (err) {
      console.error('加载评论失败:', err)
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

  onCommentInput(e: any) {
    this.setData({ commentContent: e.detail.value })
  },

  ensureLoggedIn() {
    const app = getApp()
    if (app.isLoggedIn()) return true
    wx.showModal({
      title: '登录后再互动',
      content: '登录后可以评论、点赞、收藏和举报校园动态。',
      confirmText: '去登录',
      success: (result) => {
        if (result.confirm) {
          const redirect = encodeURIComponent('/packageForum/pages/detail/detail?id=' + this.data.postId)
          wx.navigateTo({ url: '/pages/login/login?forceLogin=true&redirect=' + redirect })
        }
      }
    })
    return false
  },

  async onSubmitComment() {
    if (!this.ensureLoggedIn() || this.data.commentSubmitting) return
    const content = this.data.commentContent.trim()
    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }

    const app = getApp()
    const userInfo = app.getUserInfo()

    this.setData({ commentSubmitting: true })
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'createComment',
          data: {
            postId: this.data.postId,
            content: content,
            replyTo: this.data.replyTo,
            nickname: (userInfo && userInfo.nickName) || '',
            avatar: (userInfo && userInfo.avatarUrl) || ''
          }
        }
      }) as any

      if (res.result && res.result.success) {
        this.setData({
          commentContent: '',
          replyTo: '',
          replyToName: ''
        })
        this.loadComments()
        this.loadPostDetail()
        wx.showToast({ title: '评论成功', icon: 'success' })
      } else {
        wx.showToast({ title: res.result.msg || '评论失败', icon: 'none' })
      }
    } catch (err) {
      console.error('评论失败:', err)
      wx.showToast({ title: '评论失败', icon: 'none' })
    } finally {
      this.setData({ commentSubmitting: false })
    }
  },

  onReplyComment(e: any) {
    const id = e.currentTarget.dataset.id
    const nickname = e.currentTarget.dataset.nickname
    this.setData({
      replyTo: id,
      replyToName: nickname
    })
  },

  async onLikePost() {
    if (!this.ensureLoggedIn() || this.data.postActionLoading) return
    this.setData({ postActionLoading: true })
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'likePost',
          data: { postId: this.data.postId }
        }
      }) as any

      if (res.result && res.result.success) {
        const post = this.data.post
        post.isLiked = res.result.liked
        post.likeCount = Number(res.result.likeCount || 0)
        this.setData({ post })
      }
    } catch (err) {
      console.error('点赞失败:', err)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      this.setData({ postActionLoading: false })
    }
  },

  async onCollectPost() {
    if (!this.ensureLoggedIn() || this.data.postActionLoading) return
    this.setData({ postActionLoading: true })
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'collectPost',
          data: { postId: this.data.postId }
        }
      }) as any

      if (res.result && res.result.success) {
        const post = this.data.post
        post.isCollected = res.result.collected
        post.collectCount = Number(res.result.collectCount || 0)
        this.setData({ post })
        wx.showToast({ title: post.isCollected ? '收藏成功' : '已取消收藏', icon: 'success' })
      }
    } catch (err) {
      console.error('收藏失败:', err)
      wx.showToast({ title: '操作失败', icon: 'none' })
    } finally {
      this.setData({ postActionLoading: false })
    }
  },

  async onLikeComment(e: any) {
    if (!this.ensureLoggedIn()) return
    const commentId = e.currentTarget.dataset.id
    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'likeComment',
          data: { commentId }
        }
      }) as any

      if (res.result && res.result.success) {
        const comments = this.data.comments.map((item: any) => {
          if (item._id === commentId) {
            return {
              ...item,
              isLiked: res.result.liked,
              likeCount: Number(res.result.likeCount || 0)
            }
          }
          return item
        })
        this.setData({ comments })
      }
    } catch (err) {
      console.error('点赞失败:', err)
    }
  },

  async onDeleteComment(e: any) {
    const commentId = e.currentTarget.dataset.id
    
    const confirm = await wx.showModal({
      title: '确认删除',
      content: '确定要删除这条评论吗？'
    })
    
    if (!confirm.confirm) return

    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'deleteComment',
          data: { commentId }
        }
      }) as any

      if (res.result && res.result.success) {
        this.loadComments()
        this.loadPostDetail()
        wx.showToast({ title: '删除成功', icon: 'success' })
      }
    } catch (err) {
      console.error('删除失败:', err)
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },

  async onDeletePost() {
    const confirm = await wx.showModal({
      title: '确认删除',
      content: '确定要删除这条动态吗？'
    })
    
    if (!confirm.confirm) return

    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'deletePost',
          data: { postId: this.data.postId }
        }
      }) as any

      if (res.result && res.result.success) {
        wx.showToast({ title: '删除成功', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    } catch (err) {
      console.error('删除失败:', err)
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },

  onShowReport() {
    if (!this.ensureLoggedIn()) return
    this.setData({ showReportModal: true })
  },

  onHideReport() {
    this.setData({ showReportModal: false, reportReason: '' })
  },

  onReportInput(e: any) {
    this.setData({ reportReason: e.detail.value })
  },

  async onSubmitReport() {
    if (!this.data.reportReason.trim()) {
      wx.showToast({ title: '请输入举报理由', icon: 'none' })
      return
    }

    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'reportPost',
          data: {
            postId: this.data.postId,
            reason: this.data.reportReason
          }
        }
      }) as any

      if (res.result && res.result.success) {
        this.onHideReport()
        wx.showToast({ title: '举报成功', icon: 'success' })
      }
    } catch (err) {
      console.error('举报失败:', err)
      wx.showToast({ title: '举报失败', icon: 'none' })
    }
  },

  onPreviewImage(e: any) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({
      current: url,
      urls: this.data.post.imgList
    })
  },

  goBack() {
    wx.navigateBack()
  },

  onAvatarTap(e: any) {
    const openid = e.currentTarget.dataset.openid
    const name = e.currentTarget.dataset.name || '用户'
    const avatar = e.currentTarget.dataset.avatar || ''
    
    if (!openid) return
    
    const app = getApp()
    const currentOpenid = app.getOpenIdSync()
    
    if (openid === currentOpenid) {
      wx.navigateTo({ url: '/pages/profile/profile?source=forum' })
    } else {
      const url = '/packageForum/pages/chat/chat?toOpenid=' + openid + 
                  '&toName=' + encodeURIComponent(name) + 
                  '&toAvatar=' + encodeURIComponent(avatar)
      wx.navigateTo({ url: url })
    }
  }
})
