import { api } from '../../../utils/api-client'
Page({
  data: {
    categoryList: [
      { key: 'gossip', name: '灌水区' },
      { key: 'confession', name: '表白墙' },
      { key: 'melon', name: '吃瓜' },
      { key: 'job', name: '兼职' },
      { key: 'lost', name: '失物招领' },
      { key: 'study', name: '学习互助' }
    ],
    categoryIndex: 0,
    title: '',
    content: '',
    imgList: [] as string[],
    isAnonymous: false,
    submitting: false
  },

  onLoad() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      wx.redirectTo({
        url: '/pages/login/login?forceLogin=true&redirect=' + encodeURIComponent('/packageForum/pages/post/post')
      })
    }
  },

  onCategoryTap(e: any) {
    const index = e.currentTarget.dataset.index
    this.setData({ categoryIndex: index })
  },

  onCategoryChange(e: any) {
    this.setData({ categoryIndex: e.detail.value })
  },

  onTitleInput(e: any) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e: any) {
    this.setData({ content: e.detail.value })
  },

  onAnonymousChange(e: any) {
    this.setData({ isAnonymous: e.detail.value })
  },

  chooseImage() {
    const remaining = 9 - this.data.imgList.length
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' })
        const tempFiles = res.tempFiles
        const uploadedUrls: string[] = []

        for (const file of tempFiles) {
          try {
            const compressedPath = await this.compressImage(file.tempFilePath)
            const cloudPath = 'forum/' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '.jpg'
            const uploadRes = await api.uploadFile({
              cloudPath,
              filePath: compressedPath
            })
            uploadedUrls.push(uploadRes.fileID)
          } catch (err) {
            console.error('上传失败:', err)
          }
        }

        wx.hideLoading()
        this.setData({
          imgList: [...this.data.imgList, ...uploadedUrls]
        })
      }
    })
  },

  compressImage(filePath: string): Promise<string> {
    return new Promise((resolve) => {
      wx.compressImage({
        src: filePath,
        quality: 70,
        success: (res) => resolve(res.tempFilePath),
        fail: () => resolve(filePath)
      })
    })
  },

  deleteImage(e: any) {
    const index = e.currentTarget.dataset.index
    const imgList = [...this.data.imgList]
    imgList.splice(index, 1)
    this.setData({ imgList })
  },

  async submitPost() {
    const { title, content, imgList, isAnonymous, categoryList, categoryIndex, submitting } = this.data

    if (submitting) return

    if (!title.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' })
      return
    }

    if (!content.trim()) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    const app = getApp()
    const userInfo = app.getUserInfo() || {}

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中...', mask: true })

    try {
      const res = await api.call({
        name: 'forum',
        data: {
          action: 'createPost',
          data: {
            title: title.trim(),
            content: content.trim(),
            imgList,
            category: categoryList[categoryIndex].key,
            isAnonymous,
            nickname: userInfo.nickName || '',
            avatar: userInfo.avatarUrl || ''
          }
        }
      }) as any

      wx.hideLoading()

      if (res.result && res.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      } else {
        const msg = res.result && res.result.msg ? res.result.msg : '发布失败'
        wx.showToast({ title: msg, icon: 'none', duration: 2000 })
        this.setData({ submitting: false })
      }
    } catch (err: any) {
      wx.hideLoading()
      console.error('发帖失败:', err)
      const errMsg = err.message || '发布失败，请重试'
      wx.showToast({ title: errMsg, icon: 'none', duration: 2000 })
      this.setData({ submitting: false })
    }
  }
})
